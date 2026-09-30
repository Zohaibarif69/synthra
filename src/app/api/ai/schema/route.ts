import { z } from 'zod';
import { callJson, readBody, reply } from '@/lib/ai/server';
import { SEMANTIC_TYPES } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Request = z.object({
  tables: z.array(z.object({
    name: z.string(),
    columns: z.array(z.string()).max(200),
    /** Up to 10 rows; long values already truncated by the client. */
    sampleRows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(10),
  })).min(1).max(20),
});

const Output = z.object({
  columns: z.array(z.object({
    table: z.string(),
    column: z.string(),
    semanticType: z.enum(SEMANTIC_TYPES),
    pii: z.boolean(),
    privacyLevel: z.enum(['low', 'medium', 'high']),
    transform: z.enum(['preserve', 'mask', 'hash', 'synthetic', 'noise']),
    reason: z.string(),
  })),
  relationships: z.array(z.object({
    parentTable: z.string(),
    parentColumn: z.string(),
    childTable: z.string(),
    childColumn: z.string(),
    cardinality: z.enum(['1:1', '1:N', 'N:N']),
    reason: z.string(),
  })),
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
  const outcome = await callJson({ schema: Output, system: SYSTEM, prompt, maxTokens: 8000 });
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
