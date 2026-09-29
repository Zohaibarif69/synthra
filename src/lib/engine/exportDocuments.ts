// Browser-side exports: invoice/bank statement PDF, CSV and JSON, the Quality report PDF, and downloads.

import type { BankStatement, Invoice } from '../types';
import { formatDate } from './dates';
import { isoToTs, SYNTHETIC_FOOTER, SYNTHETIC_WATERMARK } from './regions';
import { csvSafeText } from './export';
import type { QualityReport } from './quality';

/** Triggers a download and returns the object URL (kept alive so the file can be downloaded again). */
export function downloadBlob(blob: Blob, fileName: string, existingUrl?: string): string {
  const url = existingUrl ?? URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return url;
}

// ─── Text helpers ────────────────────────────────────────────────────────────

const decimal = (cents: number) => (cents / 100).toFixed(2);

/**
 * Money for PDFs. The built-in PDF fonts can't draw every currency symbol (₹) or the narrow spaces some
 * locales use, so amounts are written with the ISO code and plain spaces, e.g. "PKR 1,728.70".
 */
function pdfMoney(cents: number, currency: string, intlLocale: string): string {
  let s: string;
  try {
    s = new Intl.NumberFormat(intlLocale, { style: 'currency', currency, currencyDisplay: 'code' }).format(cents / 100);
  } catch {
    s = `${currency} ${decimal(cents)}`;
  }
  return s.replace(/[  ]/g, ' ');
}

const pdfText = (s: string) => s.replace(/[  ]/g, ' ').replace(/[—–]/g, '-').replace(/[^\x20-\xFF]/g, '?');

function csvField(v: string | number): string {
  const s = typeof v === 'string' ? csvSafeText(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvBlob(header: string[], rows: (string | number)[][]): Blob {
  const lines = [header.join(','), ...rows.map(r => r.map(csvField).join(','))];
  return new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
}

export function jsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' });
}

/** Invoices or statements for JSON export: every document is explicitly marked as synthetic. */
export function markSynthetic<T extends object>(docs: T[]): (T & { synthetic: true; notice: string })[] {
  return docs.map(d => ({ ...d, synthetic: true as const, notice: SYNTHETIC_FOOTER }));
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

/** One row per line item. */
export function invoicesCsv(invoices: Invoice[]): Blob {
  const header = ['invoice_number', 'issue_date', 'due_date', 'seller', 'seller_tax_id', 'buyer', 'buyer_tax_id', 'currency',
    'line_no', 'description', 'unit', 'qty', 'unit_price', 'amount', 'subtotal', 'tax_label', 'tax_rate', 'tax', 'total', 'synthetic'];
  const rows = invoices.flatMap(inv => inv.lines.map((l, i) => [
    inv.number, inv.issueDate, inv.dueDate, inv.seller.name, inv.seller.taxId, inv.buyer.name, inv.buyer.taxId, inv.currency,
    i + 1, l.description, l.unit, l.qty, decimal(l.unitPriceCents), decimal(l.amountCents),
    decimal(inv.subtotalCents), inv.taxLabel, inv.taxRate, decimal(inv.taxCents), decimal(inv.totalCents), 'true',
  ]));
  return csvBlob(header, rows);
}

/** One row per transaction. */
export function statementsCsv(statements: BankStatement[]): Blob {
  const header = ['statement_id', 'bank', 'account_holder', 'account_number', 'account_type', 'currency', 'date', 'description', 'category', 'debit', 'credit', 'balance', 'synthetic'];
  const rows = statements.flatMap(s => s.transactions.map(t => [
    s.id, s.bankName, s.accountHolder, s.accountNumber, s.accountType, s.currency, t.date, t.description, t.category,
    t.debitCents ? decimal(t.debitCents) : '', t.creditCents ? decimal(t.creditCents) : '', decimal(t.balanceCents), 'true',
  ]));
  return csvBlob(header, rows);
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

type AutoTable = typeof import('jspdf-autotable').default;

async function loadPdf() {
  const [pdfModule, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  // The ESM build exposes a default export; CommonJS interop (e.g. Node) nests it one level deeper.
  const at = autoTableModule as unknown as { default?: unknown; autoTable?: unknown };
  const nested = at.default as { default?: unknown; autoTable?: unknown } | undefined;
  const autoTable = [at.default, nested?.default, at.autoTable, nested?.autoTable].find(f => typeof f === 'function') as AutoTable;
  const nestedPdf = (pdfModule as unknown as { default?: { jsPDF: typeof pdfModule.jsPDF; GState: typeof pdfModule.GState } }).default;
  const jsPDF = pdfModule.jsPDF ?? nestedPdf!.jsPDF;
  const GState = pdfModule.GState ?? nestedPdf!.GState;
  return { jsPDF, autoTable, GState };
}

const GREY: [number, number, number] = [100, 116, 139];
const DARK: [number, number, number] = [15, 23, 42];
const PRIMARY: [number, number, number] = [99, 102, 241];

type PdfDoc = InstanceType<Awaited<ReturnType<typeof loadPdf>>['jsPDF']>;

/**
 * Misuse safeguard: every page of a generated document gets a diagonal "SYNTHETIC — FOR TESTING ONLY"
 * watermark and a footer, so the PDF can't pass as a real invoice or bank statement.
 */
export function stampSynthetic(doc: PdfDoc, GState: Awaited<ReturnType<typeof loadPdf>>['GState']): void {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.saveGraphicsState();
    doc.setGState(new GState({ opacity: 0.14 }));
    // jsPDF can't centre rotated text, so compute the start point: the text runs along (cos θ, −sin θ)
    // from its start, and must be centred on the page and fit inside it.
    const text = pdfText(SYNTHETIC_WATERMARK);
    const angle = (Math.atan2(H, W) * 180) / Math.PI;
    const rad = (angle * Math.PI) / 180;
    doc.setFont('helvetica', 'bold').setFontSize(40).setTextColor(220, 38, 38);
    const maxWidth = Math.hypot(W, H) * 0.72;
    if (doc.getTextWidth(text) > maxWidth) doc.setFontSize((40 * maxWidth) / doc.getTextWidth(text));
    const w = doc.getTextWidth(text);
    const lift = doc.getFontSize() * 0.35; // move the baseline so the glyphs, not the baseline, are centred
    const x = W / 2 - (w / 2) * Math.cos(rad) + lift * Math.sin(rad);
    const y = H / 2 + (w / 2) * Math.sin(rad) + lift * Math.cos(rad);
    doc.text(text, x, y, { angle });
    doc.restoreGraphicsState();
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(185, 28, 28);
    doc.text(pdfText(`${SYNTHETIC_FOOTER}  -  Page ${p} of ${pages}`), W / 2, H - 20, { align: 'center' });
  }
}

/** One invoice per A4 page, laid out like the on-screen preview. */
export async function invoicesPdf(invoices: Invoice[]): Promise<Blob> {
  const { jsPDF, autoTable, GState } = await loadPdf();
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  invoices.forEach((inv, n) => {
    if (n) doc.addPage();
    const money = (c: number) => pdfMoney(c, inv.currency, inv.intlLocale);
    const date = (iso: string) => formatDate(isoToTs(iso), inv.dateFormat);
    doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(...DARK).text('INVOICE', 40, 60);
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...GREY).text(`#${inv.number}`, 40, 78);
    const right = (text: string, y: number, bold = false) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal').setTextColor(...(bold ? DARK : GREY)).text(pdfText(text), W - 40, y, { align: 'right' });
    };
    right(inv.seller.name, 60, true);
    right(inv.seller.address, 74);
    right(`${inv.seller.taxIdLabel}: ${inv.seller.taxId}`, 88);
    right(`Invoice Date: ${date(inv.issueDate)}`, 106);
    right(`Due: ${date(inv.dueDate)}`, 120);
    doc.setFont('helvetica', 'bold').setTextColor(...GREY).text('Billed to:', 40, 150);
    doc.setTextColor(...DARK).text(pdfText(inv.buyer.name), 40, 165);
    doc.setFont('helvetica', 'normal').setTextColor(...GREY).text(pdfText(inv.buyer.address), 40, 179);
    doc.text(`${inv.buyer.taxIdLabel}: ${inv.buyer.taxId}`, 40, 193);
    autoTable(doc, {
      startY: 215,
      head: [['Item', 'Qty', 'Unit price', 'Amount']],
      body: inv.lines.map(l => [pdfText(l.description), `${l.qty} ${l.unit}`, money(l.unitPriceCents), money(l.amountCents)]),
      foot: [
        ['', '', 'Subtotal', money(inv.subtotalCents)],
        ['', '', `${inv.taxLabel} (${inv.taxRate}%)`, money(inv.taxCents)],
        ['', '', 'Total', money(inv.totalCents)],
      ],
      theme: 'striped',
      styles: { fontSize: 9 },
      headStyles: { fillColor: PRIMARY },
      footStyles: { fillColor: [241, 245, 249], textColor: DARK, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      margin: { left: 40, right: 40, bottom: 40 },
    });
  });
  stampSynthetic(doc, GState);
  return doc.output('blob');
}

/** One formatted statement per account; long statements continue onto further pages. */
export async function statementsPdf(statements: BankStatement[]): Promise<Blob> {
  const { jsPDF, autoTable, GState } = await loadPdf();
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  statements.forEach((s, n) => {
    if (n) doc.addPage();
    const money = (c: number) => pdfMoney(c, s.currency, s.intlLocale);
    const date = (iso: string) => formatDate(isoToTs(iso), s.dateFormat);
    doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...DARK).text('BANK STATEMENT', 40, 60);
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...GREY);
    doc.text(pdfText(s.bankName), 40, 78);
    doc.text(pdfText(s.accountHolder), 40, 92);
    doc.text(`Account: ${s.accountNumber}`, W - 40, 60, { align: 'right' });
    doc.text(`${s.accountType[0].toUpperCase()}${s.accountType.slice(1)} account`, W - 40, 74, { align: 'right' });
    doc.text(`${date(s.periodFrom)} - ${date(s.periodTo)}`, W - 40, 88, { align: 'right' });
    autoTable(doc, {
      startY: 110,
      body: [
        ['Opening balance', money(s.openingBalanceCents)],
        ['Total credits', money(s.totalCreditsCents)],
        ['Total debits', money(s.totalDebitsCents)],
        ['Closing balance', money(s.closingBalanceCents)],
      ],
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
      tableWidth: 260,
      margin: { left: 40 },
    });
    autoTable(doc, {
      startY: 200,
      head: [['Date', 'Description', 'Debit', 'Credit', 'Balance']],
      body: s.transactions.map(t => [
        date(t.date), pdfText(t.description), t.debitCents ? money(t.debitCents) : '', t.creditCents ? money(t.creditCents) : '', money(t.balanceCents),
      ]),
      theme: 'striped',
      styles: { fontSize: 8 },
      headStyles: { fillColor: PRIMARY },
      columnStyles: { 2: { halign: 'right', textColor: [185, 28, 28] }, 3: { halign: 'right', textColor: [21, 128, 61] }, 4: { halign: 'right' } },
      margin: { left: 40, right: 40, bottom: 40 },
    });
  });
  stampSynthetic(doc, GState);
  return doc.output('blob');
}

/** Quality Observatory report as a PDF: scores, dimensions, warnings and per-column results. */
export async function qualityReportPdf(report: QualityReport, meta: { title: string; subtitle: string }): Promise<Blob> {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const score = (s: number | null) => (s === null ? 'N/A' : s.toFixed(1));
  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(...DARK).text('Quality Report', 40, 56);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...GREY).text(pdfText(meta.title), 40, 74);
  doc.text(pdfText(meta.subtitle), 40, 88);
  doc.setFont('helvetica', 'bold').setFontSize(28).setTextColor(...PRIMARY).text(score(report.overall), 40, 128);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...GREY).text('Overall score (average of available dimensions)', 110, 124);
  autoTable(doc, {
    startY: 145,
    head: [['Dimension', 'Score', 'Details']],
    body: report.dimensions.map(d => [d.label, d.score === null ? (d.naReason ?? 'N/A') : score(d.score), pdfText(d.detail)]),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: PRIMARY },
    columnStyles: { 0: { cellWidth: 110 }, 1: { cellWidth: 70 } },
    margin: { left: 40, right: 40 },
  });
  const after = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  autoTable(doc, {
    startY: after + 20,
    head: [['Severity', 'Column', 'Warning', 'Details']],
    body: report.warnings.length ? report.warnings.map(w => [w.severity.toUpperCase(), pdfText(w.column), pdfText(w.title), pdfText(w.detail)]) : [['-', '-', 'No quality issues detected', '']],
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: PRIMARY },
    columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 95 }, 2: { cellWidth: 120 } },
    margin: { left: 40, right: 40 },
  });
  const after2 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  if (report.columns.length) {
    autoTable(doc, {
      startY: after2 + 20,
      head: [['Column', 'Type', 'Fidelity', 'Null rate (orig -> synth)', 'Status']],
      body: report.columns.map(c => [
        pdfText(c.column), c.type, c.fidelity === null ? '-' : `${c.fidelity.toFixed(1)} (${c.fidelityMethod})`,
        `${c.nullRateOriginal === undefined ? '-' : (c.nullRateOriginal * 100).toFixed(1) + '%'} -> ${(c.nullRateSynthetic * 100).toFixed(1)}%`,
        c.status.toUpperCase(),
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: PRIMARY },
      margin: { left: 40, right: 40 },
    });
  }
  return doc.output('blob');
}
