import { z } from 'zod';
import { callJson, readBody, reply } from '@/lib/ai/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Request = z.object({
  columns: z.array(z.object({
    name: z.string(),
    type: z.string(),
    semanticType: z.string().optional(),
    /** Short learned summary, e.g. "range 18–74, 7% missing" — no raw PII values. */
    summary: z.string().max(300).optional(),
  })).min(1).max(200),
  locale: z.string(),
});

const Output = z.object({
  edgeCases: z.array(z.object({
    title: z.string(),
    column: z.string(),
    values: z.array(z.string()),
    compareWith: z.object({ column: z.string(), op: z.enum(['<', '>']) }).nullable(),
    reason: z.string(),
  })),
});

const SYSTEM = `You design edge cases for testing software with synthetic data.
Given a table schema, suggest 5–10 edge cases specific to THIS data (not generic ones): boundary values, unusual but valid formats,
Unicode/right-to-left text, plus-addressing in emails, zero or very large amounts, and cross-column logic breaks.
Each edge case targets one column. Either give 1–5 literal "values" to inject (as strings, valid for the column's type — numbers as digits, dates as YYYY-MM-DD),
or, for cross-column cases such as "order date before signup date", set compareWith {column, op} meaning the target column's value is placed before (<) or after (>) the other column's value, with values = [].
Use compareWith only between two date columns or two number columns. Title at most 8 words, reason at most 15 words.`;

export async function POST(request: globalThis.Request) {
  const parsed = await readBody(request, 'edge-cases', Request);
  if ('response' in parsed) return parsed.response;
  const { columns, locale } = parsed.body;
  const prompt = `Region: ${locale}\nColumns:\n${columns.map(c => `- ${c.name} (${c.type}${c.semanticType ? `, ${c.semanticType}` : ''})${c.summary ? `: ${c.summary}` : ''}`).join('\n')}`;
  const outcome = await callJson({ schema: Output, system: SYSTEM, prompt, maxTokens: 4000 });
  if (!outcome.ok) return reply(outcome);
  const byName = new Map(columns.map(c => [c.name, c]));
  const kindOf = (t?: string) => (t === 'date' || t === 'datetime' ? 'date' : t === 'integer' || t === 'float' ? 'number' : 'other');
  const edgeCases = outcome.data.edgeCases
    .filter(e => byName.has(e.column))
    .filter(e => !e.compareWith || (byName.has(e.compareWith.column) && e.compareWith.column !== e.column
      && kindOf(byName.get(e.column)!.type) !== 'other' && kindOf(byName.get(e.column)!.type) === kindOf(byName.get(e.compareWith.column)!.type)))
    .filter(e => e.compareWith || e.values.length)
    .slice(0, 12)
    .map((e, i) => ({
      id: `ai_edge_${i}`,
      title: e.title.slice(0, 80),
      column: e.column,
      values: e.compareWith ? [] : e.values.slice(0, 5).map(v => v.slice(0, 500)),
      ...(e.compareWith ? { compareWith: e.compareWith } : {}),
      reason: e.reason.slice(0, 160),
    }));
  return reply({ ...outcome, data: { edgeCases } });
}
