import { describe, expect, it } from 'vitest';
import type { BankStatementConfig, InvoiceConfig } from '../../types';
import { generateInvoices } from '../invoice';
import { generateStatements } from '../bank';
import { REGIONS, SYNTHETIC_FOOTER, TEST_ID_PREFIX } from '../regions';
import { invoicesCsv, invoicesPdf, markSynthetic, statementsCsv, statementsPdf } from '../exportDocuments';
import { csvParts, csvSafeText } from '../export';
import { parsePeriod, parseBankQuery } from '../bankQuery';
import { computeQuality, groupWarnings } from '../quality';
import { nullRateTolerance } from '../validate';
import type { ValidationMetrics } from '../../types';

/** Real banks that must never appear in generated documents (a forgery risk). */
const REAL_BANKS = [
  'habib', 'hbl', 'mcb', 'united bank', 'ubl', 'meezan', 'alfalah', 'allied bank', 'askari', 'faysal', 'standard chartered',
  'national bank of pakistan', 'bank al habib', 'hsbc', 'barclays', 'lloyds', 'natwest', 'chase', 'wells fargo', 'citi',
  'bank of america', 'state bank of india', 'hdfc', 'icici', 'deutsche bank', 'commerzbank', 'bnp', 'societe generale',
  'rbc', 'td bank', 'scotiabank', 'commonwealth bank', 'westpac', 'anz', 'nab', 'first national bank', 'summit bank',
  'banque atlantique', 'liberty savings',
];

const invoiceConfig: InvoiceConfig = { count: 3, locale: 'PK', currency: 'PKR', taxRate: 17, dateFrom: '2026-01-01', dateTo: '2026-03-31' };
const bankConfig: BankStatementConfig = {
  count: 3, accountType: 'checking', locale: 'PK', currency: 'PKR', startingBalance: 10_000,
  dateFrom: '2026-01-01', dateTo: '2026-03-31', transactionCount: 30,
};

describe('document misuse safeguards', () => {
  it('no region uses a real bank name, and every bank name is clearly fictional', () => {
    for (const r of Object.values(REGIONS)) {
      for (const bank of r.banks) {
        const lower = bank.toLowerCase();
        for (const real of REAL_BANKS) expect(lower.includes(real), `${bank} looks like ${real}`).toBe(false);
        expect(/\b(test|sample|demo)\b/i.test(bank), `${bank} is not clearly fictional`).toBe(true);
      }
    }
  });

  it('tax IDs and account numbers are marked TEST-', () => {
    for (const locale of Object.keys(REGIONS)) {
      const inv = generateInvoices({ ...invoiceConfig, locale, currency: REGIONS[locale].currency }, 1);
      for (const i of inv) {
        expect(i.seller.taxId.startsWith(TEST_ID_PREFIX)).toBe(true);
        expect(i.buyer.taxId.startsWith(TEST_ID_PREFIX)).toBe(true);
      }
      const st = generateStatements({ ...bankConfig, locale, currency: REGIONS[locale].currency }, 1);
      for (const s of st) expect(s.accountNumber.startsWith(TEST_ID_PREFIX)).toBe(true);
    }
  });

  it('invoice and statement PDFs carry the watermark and footer on every page', async () => {
    const pdfText = async (b: Blob) => Buffer.from(await b.arrayBuffer()).toString('latin1');
    const inv = await pdfText(await invoicesPdf(generateInvoices(invoiceConfig, 2)));
    const st = await pdfText(await statementsPdf(generateStatements({ ...bankConfig, transactionCount: 120 }, 2)));
    for (const raw of [inv, st]) {
      const pages = (raw.match(/\/Type \/Page\b/g) ?? []).length;
      expect(pages).toBeGreaterThan(0);
      expect((raw.match(/SYNTHETIC - FOR TESTING ONLY/g) ?? []).length).toBeGreaterThanOrEqual(pages);
      expect((raw.match(/Not a real financial document/g) ?? []).length).toBeGreaterThanOrEqual(pages);
    }
  });

  it('JSON and CSV document exports are marked synthetic', async () => {
    const inv = generateInvoices(invoiceConfig, 3);
    for (const d of markSynthetic(inv)) {
      expect(d.synthetic).toBe(true);
      expect(d.notice).toBe(SYNTHETIC_FOOTER);
    }
    const invCsv = await invoicesCsv(inv).text();
    const stCsv = await statementsCsv(generateStatements(bankConfig, 3)).text();
    for (const csv of [invCsv, stCsv]) {
      const [header, first] = csv.replace(/^\uFEFF/, '').split('\r\n');
      expect(header.split(',').at(-1)).toBe('synthetic');
      expect(first.split(',').at(-1)).toBe('true');
    }
  });
});

describe('CSV formula injection guard', () => {
  it.each([
    ['=HYPERLINK("http://evil")', `'=HYPERLINK("http://evil")`],
    ['+cmd|calc', "'+cmd|calc"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tsecret', "'\tsecret"],
    ['-12.5', '-12.5'],
    ['+3', '+3'],
    ['-1e5', '-1e5'],
    ['plain text', 'plain text'],
    ['', ''],
  ])('%j → %j', (input, expected) => expect(csvSafeText(input)).toBe(expected));

  it('tabular CSV export neutralises formulas but keeps numbers numeric', () => {
    const csv = csvParts({
      name: 't', rowCount: 3,
      schema: [{ name: 'note', type: 'string' }, { name: 'amount', type: 'float' }] as never,
      data: [['=1+1', 'ok', '@x'], [-12.5, 3, -0.5]],
    } as never, false).join('');
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe("'=1+1,-12.5");
    expect(lines[2]).toBe('ok,3');
    expect(lines[3]).toBe("'@x,-0.5");
  });
});

describe('bank query periods', () => {
  const today = new Date(2026, 8, 29); // 29 Sep 2026
  const base: BankStatementConfig = bankConfig;
  it.each([
    ['between 2026-01-01 and 2026-03-31', '2026-01-01', '2026-03-31'],
    ['from 2026-02-01 to 2026-02-28', '2026-02-01', '2026-02-28'],
    ['from january 2026 to march 2026', '2026-01-01', '2026-03-31'],
    ['from 1 march 2026 until 15 april 2026', '2026-03-01', '2026-04-15'],
    ['between march 5, 2026 and april 2, 2026', '2026-03-05', '2026-04-02'],
    ['from november to february', '2025-11-01', '2026-02-28'],
    ['in march 2026', '2026-03-01', '2026-03-31'],
    ['during march', '2026-03-01', '2026-03-31'],
    ['in december', '2025-12-01', '2025-12-31'],
    ['in 2025', '2025-01-01', '2025-12-31'],
    ['since january', '2026-01-01', '2026-09-29'],
    ['since 2026-06-15', '2026-06-15', '2026-09-29'],
    ['this month', '2026-09-01', '2026-09-29'],
    ['year to date', '2026-01-01', '2026-09-29'],
    ['last 2 weeks', '2026-09-16', '2026-09-29'],
    ['last two weeks', '2026-09-16', '2026-09-29'],
    ['last year', '2025-09-30', '2026-09-29'],
    ['last 90 days', '2026-07-02', '2026-09-29'],
  ])('%s', (q, from, to) => {
    const p = parsePeriod(q, today);
    expect(p?.from).toBe(from);
    expect(p?.to).toBe(to);
    const parsed = parseBankQuery(q, base, today);
    expect(parsed.config.dateFrom).toBe(from);
    expect(parsed.config.dateTo).toBe(to);
    expect(parsed.ignored).toEqual([]);
  });

  it('amount ranges and counts are not mistaken for dates', () => {
    const p = parseBankQuery('between 1000 and 5000, 2000 transactions, in march 2026', base, today);
    expect(p.config.minAmount).toBe(1000);
    expect(p.config.maxAmount).toBe(5000);
    expect(p.config.transactionCount).toBe(2000);
    expect(p.config.dateFrom).toBe('2026-03-01');
  });

  it('full demo query parses completely', () => {
    const p = parseBankQuery('savings account between 2026-01-01 and 2026-03-31, never below 500, 40 transactions', base, today);
    expect(p.config).toMatchObject({ accountType: 'savings', dateFrom: '2026-01-01', dateTo: '2026-03-31', minBalance: 500, transactionCount: 40 });
    expect(p.ignored).toEqual([]);
  });
});

describe('Validation and Quality agree on null rates', () => {
  const col = (column: string, nullRateSynthetic: number, nullRateOriginal: number) => ({
    column, type: 'string' as const, invalid: 0, unique: false, nullRateSynthetic, nullRateOriginal,
    nullRateTarget: 0.05, nullRateTolerance: nullRateTolerance(0.05, 2000),
  });

  it('a column on the configured target gets no warning even if the source file had another null rate', () => {
    const m = { hasOriginal: true, correlations: [], columns: [col('city', 0.049, 0), col('tier', 0.052, 0), col('salary', 0.05, 0.05)] } as unknown as ValidationMetrics;
    const q = computeQuality({ metrics: m, rowCount: 2000 });
    expect(q.warnings.filter(w => w.title.startsWith('Null rate'))).toHaveLength(0);
  });

  it('columns outside tolerance are warned about once, grouped', () => {
    const m = { hasOriginal: true, correlations: [], columns: [col('a', 0.2, 0), col('b', 0.2, 0), col('c', 0.05, 0)] } as unknown as ValidationMetrics;
    const q = computeQuality({ metrics: m, rowCount: 2000 });
    const nullWarnings = q.warnings.filter(w => w.title.startsWith('Null rate'));
    expect(nullWarnings).toHaveLength(1);
    expect(nullWarnings[0].columns).toEqual(['a', 'b']);
    expect(nullWarnings[0].details).toHaveLength(2);
    expect(q.columns.find(c => c.column === 'a')?.status).not.toBe('ok');
    expect(q.columns.find(c => c.column === 'c')?.status).toBe('ok');
  });

  it('groupWarnings leaves single warnings untouched', () => {
    const w = { column: 'x', severity: 'low' as const, title: 'T', detail: 'd' };
    expect(groupWarnings([w])).toEqual([w]);
  });
});
