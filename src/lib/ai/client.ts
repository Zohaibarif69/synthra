// Browser-side access to the /api/ai/* routes. The API key never reaches the browser; these calls go to
// our own server, which returns { ok: false, ... } whenever AI is unavailable so callers can fall back.

import { useEffect, useState } from 'react';
import type { AiResponse, Cell, ColumnSchema, ParsedDataset } from '../types';
import { maskValue } from '../engine/privacy';

/** Browser-side limits, a little above the server's so the server's clearer message arrives first. */
const CLIENT_TIMEOUT_MS: Record<string, number> = { schema: 60_000 };
const DEFAULT_CLIENT_TIMEOUT_MS = 30_000;
const SAMPLE_ROWS = 10;
const MAX_VALUE_CHARS = 80;

export const AI_FALLBACK_MESSAGE = 'AI unavailable, using rule-based detection';

export async function aiPost<T>(route: 'schema' | 'content' | 'edge-cases' | 'query' | 'explain', body: unknown): Promise<AiResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS[route] ?? DEFAULT_CLIENT_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/ai/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as AiResponse<T> | null;
    if (json && typeof json === 'object' && 'ok' in json) return json;
    return { ok: false, code: 'error', message: `AI unavailable: the AI route answered with HTTP ${res.status}.` };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    return { ok: false, code: aborted ? 'timeout' : 'error', message: aborted ? 'AI did not answer in time.' : 'AI unavailable: could not reach the AI route.' };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Status ──────────────────────────────────────────────────────────────────

export interface AiStatus {
  configured: boolean;
  /** Where AI answers are cached and rate limits counted: shared Upstash Redis, or this server's memory. */
  cache?: 'redis' | 'memory';
  model: string | null;
}

let statusPromise: Promise<AiStatus> | null = null;

export function fetchAiStatus(): Promise<AiStatus> {
  statusPromise ??= fetch('/api/ai/status')
    .then(r => r.json() as Promise<AiStatus>)
    .catch(() => ({ configured: false, model: null }));
  return statusPromise;
}

/** null while loading. `configured` only means a key is set; each call still reports its own success. */
export function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    let alive = true;
    fetchAiStatus().then(s => { if (alive) setStatus(s); });
    return () => { alive = false; };
  }, []);
  return status;
}

// ─── Request builders ────────────────────────────────────────────────────────

function sampleValue(v: Cell | undefined, col: ColumnSchema | undefined): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  // Columns the rules already flag as high-privacy are masked before leaving the browser.
  const safe = col?.privacyLevel === 'high' ? maskValue(v, col) : v;
  if (typeof safe === 'string') return safe.length > MAX_VALUE_CHARS ? `${safe.slice(0, MAX_VALUE_CHARS)}…` : safe;
  return safe;
}

/** Column names + up to 10 sample rows (long values truncated, detected PII masked). */
export function schemaRequestTable(name: string, dataset: ParsedDataset, schema: ColumnSchema[]) {
  const bySource = new Map(schema.map(c => [c.sourceColumn ?? c.name, c]));
  return {
    name,
    columns: dataset.columns,
    sampleRows: dataset.rows.slice(0, SAMPLE_ROWS).map(row =>
      Object.fromEntries(dataset.columns.map(c => [c, sampleValue(row[c], bySource.get(c))]))),
  };
}

// ─── Content cache ───────────────────────────────────────────────────────────

const contentCache = new Map<string, string[]>();

/** Batch of AI values for one free-text column; cached per column + context so it is fetched once. */
export async function fetchColumnValues(req: {
  column: string; table?: string; semanticType?: string; otherColumns: string[]; examples: string[]; locale: string; avgLength?: number; count: number;
}): Promise<AiResponse<{ values: string[] }>> {
  const key = JSON.stringify([req.table, req.column, req.semanticType, req.locale, req.count]);
  const cached = contentCache.get(key);
  if (cached) return { ok: true, source: 'ai', model: 'cached', data: { values: cached } };
  const res = await aiPost<{ values: string[] }>('content', { kind: 'column', ...req });
  if (res.ok) contentCache.set(key, res.data.values);
  return res;
}
