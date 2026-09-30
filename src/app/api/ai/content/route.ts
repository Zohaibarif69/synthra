import { z } from 'zod';
import { callJson, readBody, reply } from '@/lib/ai/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_VALUES = 50;

const Request = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('column'),
    column: z.string(),
    table: z.string().optional(),
    semanticType: z.string().optional(),
    otherColumns: z.array(z.string()).max(100),
    /** Non-sensitive example values from the upload, if any. */
    examples: z.array(z.string()).max(10),
    locale: z.string(),
    avgLength: z.number().optional(),
    count: z.number().int().positive().max(MAX_VALUES),
  }),
  z.object({
    kind: z.literal('invoice_items'),
    business: z.string().max(300),
    locale: z.string(),
    count: z.number().int().positive().max(MAX_VALUES),
  }),
]);

const Values = z.object({ values: z.array(z.string()) });
const Items = z.object({
  items: z.array(z.object({ name: z.string(), unit: z.string(), minUsd: z.number(), maxUsd: z.number() })),
});

export async function POST(request: globalThis.Request) {
  const parsed = await readBody(request, 'content', Request);
  if ('response' in parsed) return parsed.response;
  const b = parsed.body;

  if (b.kind === 'invoice_items') {
    const outcome = await callJson({
      schema: Items,
      system: 'You write realistic invoice line items (products or services) for a synthetic invoice generator. Prices are typical unit prices in US dollars.',
      prompt: `Business: ${b.business || 'general B2B supplier'}. Region: ${b.locale}. Give ${b.count} distinct line items with a short name, a unit (e.g. hrs, pcs, mo, kg, licence) and a realistic unit price range in USD (minUsd < maxUsd).`,
      maxTokens: 6000,
    });
    if (!outcome.ok) return reply(outcome);
    const items = outcome.data.items
      .filter(i => i.name.trim() && Number.isFinite(i.minUsd) && Number.isFinite(i.maxUsd) && i.minUsd > 0 && i.maxUsd >= i.minUsd)
      .slice(0, b.count)
      .map(i => ({ ...i, name: i.name.trim().slice(0, 80), unit: i.unit.trim().slice(0, 12) || 'pcs' }));
    if (!items.length) return reply({ ok: false, code: 'invalid_output', message: 'The model returned no usable line items.' });
    return reply({ ...outcome, data: { items } });
  }

  const outcome = await callJson({
    schema: Values,
    system: 'You write realistic, varied, fictional values for one text column of a synthetic dataset. Never use real people\'s names or real personal data. Match the language and style of the region.',
    prompt: [
      `Column: "${b.column}"${b.table ? ` in table "${b.table}"` : ''}${b.semanticType ? ` (type: ${b.semanticType})` : ''}.`,
      `Other columns in the table: ${b.otherColumns.join(', ') || 'none'}.`,
      b.examples.length ? `Style examples from the source data: ${b.examples.map(e => JSON.stringify(e)).join(', ')}.` : '',
      `Region/locale: ${b.locale}.`,
      b.avgLength ? `Typical length: about ${Math.round(b.avgLength)} characters.` : '',
      `Return ${b.count} distinct values.`,
    ].filter(Boolean).join('\n'),
    maxTokens: 8000,
  });
  if (!outcome.ok) return reply(outcome);
  const values = [...new Set(outcome.data.values.map(v => v.trim()).filter(Boolean))].slice(0, b.count).map(v => v.slice(0, 2000));
  if (!values.length) return reply({ ok: false, code: 'invalid_output', message: 'The model returned no usable values.' });
  return reply({ ...outcome, data: { values } });
}
