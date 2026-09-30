import { z } from 'zod';
import { callJson, readBody, reply } from '@/lib/ai/server';
import { SEMANTIC_TYPES } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Request = z.object({
  tables: z.array(z.object({
    name: z.string(),
    columns: z.array(z.string()).max(200),
    /** Up to 10 rows; long values already truncated by the client. */
    sampleRows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(10),
  })).min(1).max(20),
});

// Lenient: one odd value (a type name not on the list, a missing reason) falls back to a safe default
// instead of discarding the whole review. The rules sent to Gemini are unchanged.
const Output = z.object({
  columns: z.array(z.object({
    table: z.string(),
    column: z.string(),
    semanticType: z.enum(SEMANTIC_TYPES).catch('Other'),
    pii: z.boolean().catch(false),
    privacyLevel: z.enum(['low', 'medium', 'high']).catch('low'),
    transform: z.enum(['preserve', 'mask', 'hash', 'synthetic', 'noise']).catch('preserve'),
    reason: z.string().catch(''),
  })),
  relationships: z.array(z.object({
    parentTable: z.string(),
    parentColumn: z.string(),
    childTable: z.string(),
    childColumn: z.string(),
    cardinality: z.enum(['1:1', '1:N', 'N:N']).catch('1:N'),
    reason: z.string().catch(''),
  })).catch([]),
});

const SYSTEM = `You classify columns of tabular datasets for a synthetic data generator.
For every column give: semanticType (one of: ${SEMANTIC_TYPES.join(', ')}), whether it holds personally identifiable information (pii),
privacyLevel (high = directly identifies a person, e.g. name/email/phone/address/national ID; medium = quasi-identifier such as city, age, internal IDs; low = everything else),
a suggested transform (synthetic for names/emails/phones/addresses, mask or hash for official ID numbers, noise for sensitive numbers, preserve otherwise),
and a reason of at most 15 words. Some sample values may already be masked with * — judge them by the column name and format.
If there is more than one table, suggest foreign-key relationships (child column referencing a parent key) you are confident about; otherwise return an empty list.`;

export async function POST(request: globalThis.Request) {
  const parsed = await readBody(request, 'schema', Request);
  if ('response' in parsed) return parsed.response;
  const { tables } = parsed.body;
  const prompt = tables.map(t =>
    `Table "${t.name}" columns: ${t.columns.join(', ')}\nSample rows (JSON):\n${t.sampleRows.map(r => JSON.stringify(r)).join('\n')}`,
  ).join('\n\n');
  // The biggest AI job (every column, with reasons), so it gets more time than the others.
  const outcome = await callJson({ schema: Output, system: SYSTEM, prompt, maxTokens: 8000, timeoutMs: 45_000 });
  if (!outcome.ok) return reply(outcome);
  // Keep only suggestions for columns that actually exist.
  const known = new Set(tables.flatMap(t => t.columns.map(c => `${t.name}.${c}`)));
  return reply({
    ...outcome,
    data: {
      columns: outcome.data.columns.filter(c => known.has(`${c.table}.${c.column}`)),
      relationships: outcome.data.relationships.filter(r =>
        known.has(`${r.parentTable}.${r.parentColumn}`) && known.has(`${r.childTable}.${r.childColumn}`) && r.parentTable !== r.childTable),
    },
  });
}
