import { describe, expect, it } from 'vitest';
import type { BankStatementConfig, InvoiceConfig } from '../../types';
import { generateInvoices } from '../invoice';
import { generateStatements } from '../bank';
import { parseBankQuery } from '../bankQuery';
import { validateInvoices, validateStatements } from '../validate';

const invoiceConfig: InvoiceConfig = { count: 20, locale: 'PK', currency: 'PKR', taxRate: 17, dateFrom: '2026-01-01', dateTo: '2026-12-31' };

describe('invoices', () => {
  const invoices = generateInvoices(invoiceConfig, 42);

  it('generates the requested number, deterministically', () => {
    expect(invoices).toHaveLength(20);
    expect(JSON.stringify(generateInvoices(invoiceConfig, 42))).toBe(JSON.stringify(invoices));
    expect(JSON.stringify(generateInvoices(invoiceConfig, 43))).not.toBe(JSON.stringify(invoices));
    expect(new Set(invoices.map(i => i.number)).size).toBe(20);
  });

  it('line amounts, subtotal, tax and total reconcile exactly (integer cents)', () => {
    for (const inv of invoices) {
      for (const l of inv.lines) expect(l.amountCents).toBe(l.qty * l.unitPriceCents);
      const subtotal = inv.lines.reduce((a, l) => a + l.amountCents, 0);
      expect(inv.subtotalCents).toBe(subtotal);
      expect(inv.taxCents).toBe(Math.round((subtotal * 17) / 100));
      expect(inv.totalCents).toBe(inv.subtotalCents + inv.taxCents);
      expect(inv.issueDate >= invoiceConfig.dateFrom && inv.issueDate <= invoiceConfig.dateTo).toBe(true);
    }
    expect(validateInvoices(invoices, invoiceConfig).checks.every(c => c.status === 'passed')).toBe(true);
  });

  it('uses the regional template (Pakistan → GST, NTN, PKR)', () => {
    expect(invoices[0].taxLabel).toMatch(/GST/);
    expect(invoices[0].seller.taxIdLabel).toMatch(/NTN/);
    expect(invoices[0].currency).toBe('PKR');
    const de = generateInvoices({ ...invoiceConfig, count: 1, locale: 'DE', currency: 'EUR', taxRate: 19 }, 1)[0];
    expect(de.taxLabel).not.toBe(invoices[0].taxLabel);
  });
});

describe('bank statements', () => {
  const base: BankStatementConfig = {
    count: 5, accountType: 'checking', locale: 'PK', currency: 'PKR', startingBalance: 10_000,
    dateFrom: '2026-01-01', dateTo: '2026-03-31', transactionCount: 60,
  };

  it('running balance = previous balance − debit + credit, and closing balance matches', () => {
    for (const s of generateStatements(base, 42)) {
      let balance = s.openingBalanceCents;
      for (const t of s.transactions) {
        balance = balance - t.debitCents + t.creditCents;
        expect(t.balanceCents).toBe(balance);
      }
      expect(s.closingBalanceCents).toBe(balance);
      const dates = s.transactions.map(t => t.date);
      expect([...dates].sort()).toEqual(dates);
    }
  });

  it('"last 90 days, never below 500" is parsed and holds in every row', () => {
    const today = new Date(2026, 8, 29);
    const parsed = parseBankQuery('last 90 days, never below 500', base, today);
    expect(parsed.config.minBalance).toBe(500);
    const statements = generateStatements(parsed.config, 42);
    for (const s of statements) {
      for (const t of s.transactions) expect(t.balanceCents).toBeGreaterThanOrEqual(50_000);
    }
    expect(validateStatements(statements, parsed.config).checks.every(c => c.status === 'passed')).toBe(true);
  });

  it('is deterministic for the same seed', () => {
    expect(JSON.stringify(generateStatements(base, 9))).toBe(JSON.stringify(generateStatements(base, 9)));
  });
});
