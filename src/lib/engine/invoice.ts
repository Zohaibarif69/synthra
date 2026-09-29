// Invoice generator. All money is integer cents: amount = qty × unitPrice, subtotal = Σ amounts,
// tax = round(subtotal × rate%), total = subtotal + tax — so every invoice reconciles exactly.

import type { Invoice, InvoiceConfig, InvoiceLine, Party } from '../types';
import { createRng, type Rng } from './random';
import { createFaker, fillPattern, PK_AREAS, PK_CITIES, PK_LAST } from './locales';
import { currencyRate, DAY_MS, isoToTs, region, TEST_ID_PREFIX, tsToIso } from './regions';

interface CatalogItem { name: string; unit: string; minUsd: number; maxUsd: number; maxQty: number }

const CATALOG: CatalogItem[] = [
  { name: 'Web development', unit: 'hrs', minUsd: 25, maxUsd: 90, maxQty: 60 },
  { name: 'UI/UX design', unit: 'hrs', minUsd: 20, maxUsd: 80, maxQty: 40 },
  { name: 'Cloud hosting (monthly)', unit: 'mo', minUsd: 20, maxUsd: 400, maxQty: 12 },
  { name: 'API access subscription', unit: 'mo', minUsd: 50, maxUsd: 800, maxQty: 12 },
  { name: 'Technical support', unit: 'hrs', minUsd: 15, maxUsd: 60, maxQty: 30 },
  { name: 'Onboarding & training', unit: 'session', minUsd: 100, maxUsd: 600, maxQty: 4 },
  { name: 'Software licence', unit: 'seat', minUsd: 10, maxUsd: 120, maxQty: 50 },
  { name: 'Data migration', unit: 'job', minUsd: 300, maxUsd: 2500, maxQty: 2 },
  { name: 'Security audit', unit: 'job', minUsd: 800, maxUsd: 5000, maxQty: 1 },
  { name: 'Laptop (14")', unit: 'pcs', minUsd: 600, maxUsd: 1600, maxQty: 10 },
  { name: 'Wireless mouse', unit: 'pcs', minUsd: 8, maxUsd: 40, maxQty: 50 },
  { name: 'Office chair', unit: 'pcs', minUsd: 80, maxUsd: 350, maxQty: 20 },
  { name: 'Printer paper (A4, ream)', unit: 'ream', minUsd: 3, maxUsd: 8, maxQty: 100 },
  { name: 'Toner cartridge', unit: 'pcs', minUsd: 25, maxUsd: 90, maxQty: 20 },
  { name: 'Network switch (24-port)', unit: 'pcs', minUsd: 120, maxUsd: 600, maxQty: 5 },
  { name: 'Consulting', unit: 'hrs', minUsd: 50, maxUsd: 200, maxQty: 30 },
  { name: 'Delivery charges', unit: 'trip', minUsd: 5, maxUsd: 60, maxQty: 10 },
  { name: 'Annual maintenance contract', unit: 'yr', minUsd: 500, maxUsd: 4000, maxQty: 1 },
  { name: 'Cotton fabric', unit: 'm', minUsd: 2, maxUsd: 9, maxQty: 500 },
  { name: 'Packaging boxes', unit: 'pcs', minUsd: 0.5, maxUsd: 3, maxQty: 1000 },
];

const PK_COMPANY_WORDS = ['Traders', 'Enterprises', 'Textiles', 'Industries', 'Solutions', 'Technologies', 'Foods', 'Pharma', 'Logistics', 'Builders'];
const PK_COMPANY_SUFFIX = ['(Pvt) Ltd', 'Ltd', '& Co.', '(SMC-Pvt) Ltd'];

/** Rounds a price to whole units for currencies where cents are unusual (PKR, INR). */
function priceCents(rng: Rng, item: CatalogItem, currency: string): number {
  const major = rng.float(item.minUsd, item.maxUsd) * currencyRate(currency);
  const whole = currency === 'PKR' || currency === 'INR';
  return whole ? Math.max(1, Math.round(major)) * 100 : Math.max(1, Math.round(major * 100));
}

export function generateInvoices(config: InvoiceConfig, seed: number, onProgress?: (done: number) => void): Invoice[] {
  const rng = createRng(seed).derive('invoices');
  const faker = createFaker(config.locale, seed);
  const tpl = region(config.locale);
  const from = isoToTs(config.dateFrom);
  const to = isoToTs(config.dateTo);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) throw new Error('Invoice date range is invalid: "Date From" must be on or before "Date To".');
  const days = Math.round((to - from) / DAY_MS);
  const year = new Date(from).getUTCFullYear();

  const company = (): Party => {
    const pk = config.locale === 'PK';
    return {
      name: pk ? `${rng.pick(PK_LAST)} ${rng.pick(PK_COMPANY_WORDS)} ${rng.pick(PK_COMPANY_SUFFIX)}` : faker.company.name(),
      address: pk
        ? `Plot ${rng.int(1, 250)}, ${rng.pick(PK_AREAS)}, ${rng.weightedPick(PK_CITIES.map(c => c[0]), PK_CITIES.map(c => c[1]))}`
        : `${faker.location.streetAddress()}, ${faker.location.city()}`,
      taxIdLabel: tpl.taxIdLabel,
      taxId: TEST_ID_PREFIX + fillPattern(rng, tpl.taxIdPattern),
    };
  };

  // AI-written items for the seller's business replace the built-in catalogue when available.
  const catalog: CatalogItem[] = config.aiCatalog?.length
    ? config.aiCatalog.map(a => ({ name: a.name, unit: a.unit, minUsd: a.minUsd, maxUsd: a.maxUsd, maxQty: a.unit === 'hrs' ? 40 : 20 }))
    : CATALOG;

  const invoices: Invoice[] = [];
  for (let i = 0; i < config.count; i++) {
    const issueTs = from + rng.int(0, days) * DAY_MS;
    const terms = rng.pick([7, 15, 30, 45]);
    const items = [...catalog];
    const lineCount = rng.int(1, Math.min(8, items.length));
    const lines: InvoiceLine[] = [];
    for (let l = 0; l < lineCount; l++) {
      // Distinct products per invoice.
      const item = items.splice(rng.int(0, items.length - 1), 1)[0];
      const qty = rng.int(1, item.maxQty);
      const unitPriceCents = priceCents(rng, item, config.currency);
      lines.push({ description: item.name, unit: item.unit, qty, unitPriceCents, amountCents: qty * unitPriceCents });
    }
    const subtotalCents = lines.reduce((a, l) => a + l.amountCents, 0);
    const taxCents = Math.round((subtotalCents * config.taxRate) / 100);
    invoices.push({
      number: `INV-${year}-${String(i + 1).padStart(5, '0')}`,
      seller: company(),
      buyer: company(),
      issueDate: tsToIso(issueTs),
      dueDate: tsToIso(issueTs + terms * DAY_MS),
      currency: config.currency,
      intlLocale: tpl.intlLocale,
      dateFormat: tpl.dateFormat,
      taxLabel: tpl.taxLabel,
      taxRate: config.taxRate,
      lines,
      subtotalCents,
      taxCents,
      totalCents: subtotalCents + taxCents,
    });
    if (onProgress && i % 25 === 0) onProgress(i + 1);
  }
  return invoices;
}
