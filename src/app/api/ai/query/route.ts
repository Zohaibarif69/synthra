import { z } from 'zod';
import { callJson, readBody, reply } from '@/lib/ai/server';
import { SEMANTIC_TYPES } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOCALES = ['PK', 'US', 'GB', 'IN', 'DE', 'FR', 'CA', 'AU'] as const;
const CURRENCIES = ['PKR', 'USD', 'GBP', 'INR', 'EUR', 'CAD', 'AUD'] as const;

const Request = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bank'), text: z.string().min(1).max(1000), today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ kind: z.literal('tabular'), text: z.string().min(1).max(1000) }),
]);

/** Every field nullable: null means "not mentioned, keep the current setting". */
const BankOutput = z.object({
  count: z.number().int().nullable(),
  accountType: z.enum(['checking', 'savings', 'business']).nullable(),
  locale: z.enum(LOCALES).nullable(),
  currency: z.enum(CURRENCIES).nullable(),
  startingBalance: z.number().nullable(),
  dateFrom: z.string().nullable(),
  dateTo: z.string().nullable(),
  transactionCount: z.number().int().nullable(),
  minAmount: z.number().nullable(),
  maxAmount: z.number().nullable(),
  minBalance: z.number().nullable(),
  preventNegative: z.boolean().nullable(),
  understood: z.array(z.string()),
});

const TabularOutput = z.object({
  rowCount: z.number().int().nullable(),
  locale: z.enum(LOCALES).nullable(),
  columns: z.array(z.object({
    name: z.string(),
    type: z.enum(['string', 'integer', 'float', 'boolean', 'date', 'datetime', 'email', 'uuid']),
    semanticType: z.enum(SEMANTIC_TYPES),
    nullable: z.boolean(),
    unique: z.boolean(),
    privacyLevel: z.enum(['low', 'medium', 'high']),
    min: z.number().nullable(),
    max: z.number().nullable(),
    allowedValues: z.array(z.string()),
  })),
});

const isoDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null);

export async function POST(request: globalThis.Request) {
  const parsed = await readBody(request, 'query', Request);
  if ('response' in parsed) return parsed.response;
  const b = parsed.body;

  if (b.kind === 'bank') {
    const outcome = await callJson({
      schema: BankOutput,
      system: `You convert a request for synthetic bank statements into settings. Today is ${b.today}.
Use null for anything not mentioned. Dates as YYYY-MM-DD ("last 90 days" ends today). "never below X" or "balance over X" is minBalance.
"understood" lists each setting you extracted as a short plain-English phrase.
The request may be in English, Urdu (Urdu script) or Roman Urdu, e.g. "پچھلے 90 دن" or "pichle 90 din" = last 90 days,
"بچت اکاؤنٹ" = savings account, "500 سے کم نہ ہو" = never below 500. Always write "understood" in English.`,
      prompt: b.text,
      maxTokens: 1500,
    });
    if (!outcome.ok) return reply(outcome);
    const d = outcome.data;
    // Discard impossible values instead of passing them on.
    const pos = (n: number | null, max: number) => (n !== null && Number.isFinite(n) && n > 0 && n <= max ? n : null);
    const dateFrom = isoDate(d.dateFrom), dateTo = isoDate(d.dateTo);
    return reply({
      ...outcome,
      data: {
        ...d,
        count: pos(d.count, 10_000),
        transactionCount: pos(d.transactionCount, 5_000),
        dateFrom: dateFrom && dateTo && dateFrom > dateTo ? null : dateFrom,
        dateTo: dateFrom && dateTo && dateFrom > dateTo ? null : dateTo,
        minAmount: d.minAmount !== null && d.minAmount >= 0 ? d.minAmount : null,
        maxAmount: d.maxAmount !== null && d.maxAmount > 0 ? d.maxAmount : null,
      },
    });
  }

  const outcome = await callJson({
    schema: TabularOutput,
    system: `You design a table schema for a synthetic data generator from a plain-English request.
Use snake_case column names. Include an id column (integer, Identifier, unique, not nullable) unless the request clearly doesn't want one.
Use min/max for numeric ranges mentioned (e.g. "age 18-60"), allowedValues for explicit lists of categories, otherwise null / [].
privacyLevel high for names, emails, phones, addresses and official IDs. rowCount and locale null if not mentioned.
The request may be in English, Urdu (Urdu script) or Roman Urdu, e.g. "1000 پاکستانی گاہک، نام، شہر، فون اور عمر 18 سے 60".
Understand it in any of these, but always answer in English: column names in English snake_case (name, city, phone, age).
Urdu requests about Pakistan imply locale "PK".`,
    prompt: b.text,
    maxTokens: 3000,
  });
  if (!outcome.ok) return reply(outcome);
  const seen = new Set<string>();
  const columns = outcome.data.columns
    .map(c => ({ ...c, name: c.name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 60) }))
    .filter(c => c.name && !seen.has(c.name) && seen.add(c.name))
    .slice(0, 60);
  if (!columns.length) return reply({ ok: false, code: 'invalid_output', message: 'The model returned no columns.' });
  const rowCount = outcome.data.rowCount !== null && outcome.data.rowCount > 0 ? Math.min(1_000_000, outcome.data.rowCount) : null;
  return reply({ ...outcome, data: { ...outcome.data, rowCount, columns } });
}
