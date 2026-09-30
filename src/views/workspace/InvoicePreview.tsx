'use client';

import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Invoice } from '../../lib/types';
import { formatDate } from '../../lib/engine/dates';
import { formatMoney, isoToTs, SYNTHETIC_FOOTER, SYNTHETIC_WATERMARK } from '../../lib/engine/regions';

/**
 * Misuse safeguard: a diagonal "SYNTHETIC — FOR TESTING ONLY" watermark over the document preview.
 * Rendered above the content (pointer-events off) so it shows in screenshots too.
 */
export function SyntheticWatermark() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center select-none">
      <span className="-rotate-[30deg] whitespace-nowrap text-2xl font-bold tracking-widest text-red-600/15">{SYNTHETIC_WATERMARK}</span>
    </div>
  );
}

/** Footer line on every document preview. */
export function SyntheticFooter() {
  return (
    <p className="mt-4 pt-2 border-t border-dashed border-red-200 text-center text-[10px] font-semibold text-red-600" role="note">
      {SYNTHETIC_WATERMARK} · {SYNTHETIC_FOOTER}
    </p>
  );
}

export function DocPager({ index, total, label, onChange }: { index: number; total: number; label: string; onChange: (i: number) => void }) {
  return (
    <div className="flex items-center justify-between mb-2 text-xs text-[var(--color-text-muted)] max-w-lg">
      <span>{label} {total ? index + 1 : 0} of {total.toLocaleString()}</span>
      <div className="flex gap-1">
        <button disabled={index <= 0} onClick={() => onChange(index - 1)} aria-label="Previous"
          className="p-1 border border-[var(--color-border)] rounded disabled:opacity-40 hover:bg-[var(--color-surface-2)]"><ChevronLeft size={13} /></button>
        <button disabled={index >= total - 1} onClick={() => onChange(index + 1)} aria-label="Next"
          className="p-1 border border-[var(--color-border)] rounded disabled:opacity-40 hover:bg-[var(--color-surface-2)]"><ChevronRight size={13} /></button>
      </div>
    </div>
  );
}

export function InvoicePreview({ invoices, totalCount }: { invoices: Invoice[]; totalCount?: number }) {
  const [index, setIndex] = useState(0);
  const inv = invoices[Math.min(index, invoices.length - 1)];
  if (!inv) return <p className="text-xs text-[var(--color-text-muted)]">No invoices to preview.</p>;
  const money = (c: number) => formatMoney(c, inv.currency, inv.intlLocale);
  const date = (iso: string) => formatDate(isoToTs(iso), inv.dateFormat);

  return (
    <div>
      <DocPager index={index} total={invoices.length} label={totalCount && totalCount > invoices.length ? `Preview (first ${invoices.length} of ${totalCount.toLocaleString()}) · invoice` : 'Invoice'} onChange={setIndex} />
      <div className="relative overflow-hidden bg-white border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6 font-mono text-xs shadow-sm max-w-lg text-slate-700">
        <SyntheticWatermark />
        <div className="flex justify-between gap-4 mb-6">
          <div>
            <p className="text-base font-bold text-slate-900">INVOICE</p>
            <p className="text-slate-500">#{inv.number}</p>
          </div>
          <div className="text-right">
            <p className="font-semibold text-slate-900">{inv.seller.name}</p>
            <p className="text-slate-500">{inv.seller.address}</p>
            <p className="text-slate-500">{inv.seller.taxIdLabel}: {inv.seller.taxId}</p>
            <p className="text-slate-500 mt-1">Invoice Date: {date(inv.issueDate)}</p>
            <p className="text-slate-500">Due: {date(inv.dueDate)}</p>
          </div>
        </div>
        <div className="mb-5">
          <p className="font-semibold text-slate-600 mb-1">Billed to:</p>
          <p className="text-slate-900 font-semibold">{inv.buyer.name}</p>
          <p className="text-slate-500">{inv.buyer.address}</p>
          <p className="text-slate-500">{inv.buyer.taxIdLabel}: {inv.buyer.taxId}</p>
        </div>
        <div className="border-t border-slate-200 pt-3 mb-3">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 text-slate-500 mb-2">
            <span>Item</span><span className="text-right">Qty</span><span className="text-right">Price</span><span className="text-right">Amount</span>
          </div>
          {inv.lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 py-1 border-b border-slate-100">
              <span className="text-slate-900 truncate">{l.description}</span>
              <span className="text-right">{l.qty} {l.unit}</span>
              <span className="text-right">{money(l.unitPriceCents)}</span>
              <span className="text-right">{money(l.amountCents)}</span>
            </div>
          ))}
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-slate-600"><span>Subtotal</span><span>{money(inv.subtotalCents)}</span></div>
          <div className="flex justify-between text-slate-600"><span>{inv.taxLabel} ({inv.taxRate}%)</span><span>{money(inv.taxCents)}</span></div>
          <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-1 mt-1"><span>Total</span><span>{money(inv.totalCents)}</span></div>
        </div>
        <SyntheticFooter />
      </div>
    </div>
  );
}
