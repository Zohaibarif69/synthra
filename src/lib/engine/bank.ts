// Bank statement generator. Balances are integer cents and computed as
// balance = previous − debit + credit, starting from the opening balance.

import type { BankStatement, BankStatementConfig, BankTransaction } from '../types';
import { createRng, type Rng } from './random';
import { createFaker, PK_FEMALE_FIRST, PK_LAST, PK_MALE_FIRST } from './locales';
import { currencyRate, DAY_MS, isoToTs, region, TEST_ID_PREFIX, tsToIso } from './regions';

interface Category {
  id: string;
  direction: 'debit' | 'credit';
  /** Amount range in USD before currency scaling. */
  minUsd: number;
  maxUsd: number;
  merchants: string[];
}

const PERSONAL: [Category, number][] = [
  [{ id: 'groceries', direction: 'debit', minUsd: 8, maxUsd: 140, merchants: ['Greenleaf Market', 'Imtiaz Superstore', 'FreshMart', 'Al-Fatah', 'Metro Cash & Carry', 'Daily Basket'] }, 28],
  [{ id: 'dining', direction: 'debit', minUsd: 5, maxUsd: 60, merchants: ['Café Aroma', 'Burger Point', 'Spice Garden', 'Pizza Corner', 'Chai Stop'] }, 12],
  [{ id: 'fuel', direction: 'debit', minUsd: 15, maxUsd: 80, merchants: ['PSO Fuel Station', 'Shell Station', 'Total Parco', 'Attock Petroleum'] }, 12],
  [{ id: 'utilities', direction: 'debit', minUsd: 20, maxUsd: 150, merchants: ['Electric Supply Co.', 'City Gas', 'Water Board', 'FiberNet Internet', 'Mobile Postpaid'] }, 8],
  [{ id: 'shopping', direction: 'debit', minUsd: 10, maxUsd: 250, merchants: ['Daraz Online', 'Outfitters', 'Home Store', 'Pharmacy Plus', 'Book Hub'] }, 12],
  [{ id: 'transfer_out', direction: 'debit', minUsd: 20, maxUsd: 500, merchants: ['Transfer to savings', 'IBFT to A. Khan', 'Raast payment', 'Family support'] }, 8],
  [{ id: 'atm', direction: 'debit', minUsd: 20, maxUsd: 200, merchants: ['ATM withdrawal'] }, 6],
  [{ id: 'subscription', direction: 'debit', minUsd: 3, maxUsd: 25, merchants: ['Streaming subscription', 'Cloud storage', 'Music subscription'] }, 4],
  [{ id: 'transfer_in', direction: 'credit', minUsd: 20, maxUsd: 400, merchants: ['Transfer from savings', 'IBFT from family', 'Refund', 'Raast received'] }, 10],
];

const SAVINGS: [Category, number][] = [
  [{ id: 'transfer_in', direction: 'credit', minUsd: 50, maxUsd: 800, merchants: ['Transfer from current account', 'Deposit', 'Cheque deposit'] }, 40],
  [{ id: 'transfer_out', direction: 'debit', minUsd: 50, maxUsd: 600, merchants: ['Transfer to current account', 'Term deposit placement', 'IBFT'] }, 30],
  [{ id: 'atm', direction: 'debit', minUsd: 20, maxUsd: 200, merchants: ['ATM withdrawal'] }, 15],
  [{ id: 'utilities', direction: 'debit', minUsd: 20, maxUsd: 150, merchants: ['Electric Supply Co.', 'City Gas'] }, 5],
];

const BUSINESS: [Category, number][] = [
  [{ id: 'vendor', direction: 'debit', minUsd: 200, maxUsd: 6000, merchants: ['Vendor payment — Malik Traders', 'Vendor payment — Apex Supplies', 'Supplier invoice', 'Raw material purchase'] }, 30],
  [{ id: 'client', direction: 'credit', minUsd: 500, maxUsd: 12000, merchants: ['Client payment received', 'Invoice settlement', 'Customer transfer'] }, 28],
  [{ id: 'supplies', direction: 'debit', minUsd: 30, maxUsd: 900, merchants: ['Office supplies', 'IT equipment', 'Courier services'] }, 14],
  [{ id: 'utilities', direction: 'debit', minUsd: 100, maxUsd: 1200, merchants: ['Commercial electricity', 'Internet & telecom', 'Water & sewerage'] }, 8],
  [{ id: 'fuel', direction: 'debit', minUsd: 40, maxUsd: 400, merchants: ['Fleet fuel card'] }, 8],
  [{ id: 'tax', direction: 'debit', minUsd: 100, maxUsd: 3000, merchants: ['Tax payment', 'Withholding tax deposit'] }, 5],
  [{ id: 'transfer_in', direction: 'credit', minUsd: 200, maxUsd: 5000, merchants: ['Transfer from partner account', 'Loan disbursement'] }, 7],
];

export function effectiveMinBalance(config: BankStatementConfig): number | null {
  if (config.minBalance !== undefined && Number.isFinite(config.minBalance)) return config.minBalance;
  return config.preventNegative ? 0 : null;
}

function amountCents(rng: Rng, minUsd: number, maxUsd: number, config: BankStatementConfig, scale = 1): number {
  const rate = currencyRate(config.currency);
  let major = rng.float(minUsd, maxUsd) * rate * scale;
  if (config.minAmount !== undefined) major = Math.max(major, config.minAmount);
  if (config.maxAmount !== undefined) major = Math.min(major, config.maxAmount);
  return Math.max(1, Math.round(major * 100));
}

function holderName(rng: Rng, config: BankStatementConfig, faker: ReturnType<typeof createFaker>): string {
  if (config.accountType === 'business') {
    return config.locale === 'PK' ? `${rng.pick(PK_LAST)} Enterprises (Pvt) Ltd` : faker.company.name();
  }
  if (config.locale === 'PK') return `${rng.pick(rng.chance(0.5) ? PK_MALE_FIRST : PK_FEMALE_FIRST)} ${rng.pick(PK_LAST)}`;
  return faker.person.fullName();
}

export function generateStatements(config: BankStatementConfig, seed: number, onProgress?: (done: number) => void): BankStatement[] {
  const rng = createRng(seed).derive('bank');
  const faker = createFaker(config.locale, seed);
  const tpl = region(config.locale);
  const from = isoToTs(config.dateFrom);
  const to = isoToTs(config.dateTo);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) throw new Error('Statement date range is invalid: "Date From" must be on or before "Date To".');
  if (config.minAmount !== undefined && config.maxAmount !== undefined && config.minAmount > config.maxAmount) {
    throw new Error('Minimum amount is greater than maximum amount.');
  }
  const days = Math.round((to - from) / DAY_MS);
  const floor = effectiveMinBalance(config);
  const floorCents = floor === null ? null : Math.round(floor * 100);
  const categories = config.accountType === 'business' ? BUSINESS : config.accountType === 'savings' ? SAVINGS : PERSONAL;
  const creditCats = categories.filter(([c]) => c.direction === 'credit');

  const statements: BankStatement[] = [];
  for (let s = 0; s < config.count; s++) {
    const plan: { ts: number; order: number; description: string; category: string; debit: number; credit: number }[] = [];
    let order = 0;

    // Monthly items: salary/client retainer credit and rent debit, once per month in range.
    const monthly: { day: number; description: string; category: string; direction: 'debit' | 'credit'; cents: number }[] = [];
    if (config.accountType === 'checking') {
      monthly.push({ day: 25, description: `Salary — ${faker.company.name()}`, category: 'salary', direction: 'credit', cents: amountCents(rng, 1500, 5000, config) });
      monthly.push({ day: 3, description: 'Rent — Landlord transfer', category: 'rent', direction: 'debit', cents: amountCents(rng, 400, 1500, config) });
    } else if (config.accountType === 'business') {
      monthly.push({ day: 28, description: 'Payroll run', category: 'salary', direction: 'debit', cents: amountCents(rng, 4000, 25000, config) });
      monthly.push({ day: 5, description: 'Office rent', category: 'rent', direction: 'debit', cents: amountCents(rng, 1000, 6000, config) });
    } else {
      monthly.push({ day: 28, description: 'Profit / interest credit', category: 'interest', direction: 'credit', cents: amountCents(rng, 5, 60, config) });
    }
    const start = new Date(from);
    for (let y = start.getUTCFullYear(), m = start.getUTCMonth(); Date.UTC(y, m, 1) <= to; m === 11 ? (y++, m = 0) : m++) {
      for (const item of monthly) {
        const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        const ts = Date.UTC(y, m, Math.min(item.day, lastDay));
        if (ts < from || ts > to || plan.length >= config.transactionCount) continue;
        plan.push({ ts, order: order++, description: item.description, category: item.category, debit: item.direction === 'debit' ? item.cents : 0, credit: item.direction === 'credit' ? item.cents : 0 });
      }
    }

    // Everyday transactions fill the rest of the requested count.
    while (plan.length < config.transactionCount) {
      const cat = rng.weightedPick(categories.map(c => c[0]), categories.map(c => c[1]));
      const cents = amountCents(rng, cat.minUsd, cat.maxUsd, config);
      plan.push({
        ts: from + rng.int(0, days) * DAY_MS, order: order++,
        description: rng.pick(cat.merchants), category: cat.id,
        debit: cat.direction === 'debit' ? cents : 0, credit: cat.direction === 'credit' ? cents : 0,
      });
    }
    plan.sort((a, b) => a.ts - b.ts || a.order - b.order);

    // Running balance, enforcing the minimum balance by shrinking or replacing debits that would breach it.
    const openingBalanceCents = Math.round(config.startingBalance * 100);
    let balance = openingBalanceCents;
    let debits = 0, credits = 0;
    const transactions: BankTransaction[] = [];
    for (const p of plan) {
      let { debit, credit, description, category } = p;
      if (floorCents !== null && debit > 0 && balance - debit < floorCents) {
        const room = balance - floorCents;
        const minCents = Math.round((config.minAmount ?? 0.01) * 100);
        if (room >= Math.max(1, minCents)) {
          debit = room;
        } else {
          // Not enough room for any debit: record an incoming transfer instead.
          const cat = creditCats.length ? rng.pick(creditCats)[0] : null;
          debit = 0;
          credit = amountCents(rng, cat?.minUsd ?? 50, cat?.maxUsd ?? 500, config);
          description = cat ? rng.pick(cat.merchants) : 'Transfer in';
          category = cat?.id ?? 'transfer_in';
        }
      }
      balance = balance - debit + credit;
      debits += debit;
      credits += credit;
      transactions.push({ date: tsToIso(p.ts), description, category, debitCents: debit, creditCents: credit, balanceCents: balance });
    }

    statements.push({
      id: `STMT-${String(s + 1).padStart(4, '0')}`,
      bankName: rng.pick(tpl.banks),
      accountHolder: holderName(rng, config, faker),
      accountNumber: `${TEST_ID_PREFIX}**** ${String(rng.int(0, 9999)).padStart(4, '0')}`,
      accountType: config.accountType,
      currency: config.currency,
      intlLocale: tpl.intlLocale,
      dateFormat: tpl.dateFormat,
      periodFrom: config.dateFrom,
      periodTo: config.dateTo,
      openingBalanceCents,
      closingBalanceCents: balance,
      totalDebitsCents: debits,
      totalCreditsCents: credits,
      transactions,
    });
    if (onProgress && s % 10 === 0) onProgress(s + 1);
  }
  return statements;
}
