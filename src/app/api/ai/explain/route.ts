import { z } from 'zod';
import { callJson, readBody, reply } from '@/lib/ai/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Request = z.object({
  dataset: z.string().max(300),
  overall: z.number().nullable(),
  dimensions: z.array(z.object({ label: z.string(), score: z.number().nullable(), detail: z.string().max(1000) })).max(20),
  warnings: z.array(z.object({ severity: z.string(), column: z.string(), title: z.string(), detail: z.string().max(500) })).max(40),
  settings: z.string().max(1000),
});

const Output = z.object({
  summary: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  actions: z.array(z.string()),
});

const SYSTEM = `You explain synthetic-data quality results to a non-expert in plain English.
Use only the numbers provided; never invent scores. N/A means the check did not apply.
summary: 2–3 sentences. strengths and weaknesses: up to 4 short bullets each, citing the real numbers.
actions: up to 4 concrete setting changes in this app (e.g. "lower the Missing Value Rate", "switch email to Mask", "upload a source file", "raise the privacy budget ε").`;

export async function POST(request: globalThis.Request) {
  const parsed = await readBody(request, 'explain', Request);
  if ('response' in parsed) return parsed.response;
  const b = parsed.body;
  const prompt = [
    `Dataset: ${b.dataset}`,
    `Overall quality score: ${b.overall ?? 'N/A'} / 100`,
    `Dimensions:\n${b.dimensions.map(d => `- ${d.label}: ${d.score ?? 'N/A'} (${d.detail})`).join('\n')}`,
    `Warnings (${b.warnings.length}):\n${b.warnings.map(w => `- [${w.severity}] ${w.column}: ${w.title} — ${w.detail}`).join('\n') || 'none'}`,
    `Generation settings: ${b.settings}`,
  ].join('\n\n');
  return reply(await callJson({ schema: Output, system: SYSTEM, prompt, maxTokens: 1500 }));
}
