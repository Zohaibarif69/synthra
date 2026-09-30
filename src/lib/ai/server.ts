// Server-only AI helpers for the /api/ai/* route handlers. Never import this from client code:
// it reads GEMINI_API_KEY, which must stay on the server.
//
// Talks to the Gemini REST API (generateContent) with plain fetch rather than the SDK: the endpoint is
// stable, needs no extra dependency, and works with a free Google AI Studio key.

import * as z from 'zod';
import type { AiResponse } from '../types';
import { cacheGet, cacheKey, cacheSet, isRateLimited, RATE_LIMIT_PER_MINUTE } from './cache';

/**
 * Model to use. Override with GEMINI_MODEL in .env.local. The default is Google's alias for the current
 * Flash model, which is on the free tier; if the account can't use it, the fallbacks below are tried.
 */
export const AI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-flash-latest';
/** Tried in order only when a model name is not found (404) for this key. */
const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'];
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 15_000;

function apiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null;
}

/** Null key → every route answers "AI unavailable" and the app uses rule-based fallbacks. */
export function aiConfigured(): boolean {
  return apiKey() !== null;
}

function stripFences(text: string): string {
  const t = text.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return m ? m[1] : t;
}

type Failure = Extract<AiResponse<never>, { ok: false }>;
const fail = (code: Failure['code'], message: string): Failure => ({ ok: false, code, message });

interface GeminiPart { text?: string; thought?: boolean }
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string; details?: { reason?: string }[] };
}

/** JSON Schema for the zod schema, without keys Gemini's schema subset rejects. */
function geminiSchema(schema: z.ZodType): unknown {
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === '$schema' || k === 'additionalProperties' || k === '$id') continue;
      // zod's .int() adds ±2^53 bounds that add nothing and can trip the schema check.
      if ((k === 'minimum' || k === 'maximum') && typeof v === 'number' && Math.abs(v) >= Number.MAX_SAFE_INTEGER) continue;
      out[k] = clean(v);
    }
    return out;
  };
  return clean(z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' }));
}

type Attempt = { ok: true; body: GeminiResponse } | { ok: false; status: number; body: GeminiResponse | null; timeout?: boolean; network?: boolean };

async function post(model: string, key: string, payload: unknown): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => null)) as GeminiResponse | null;
    return res.ok && body ? { ok: true, body } : { ok: false, status: res.status, body };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    return { ok: false, status: 0, body: null, timeout: aborted, network: !aborted };
  } finally {
    clearTimeout(timer);
  }
}

function toFailure(a: Extract<Attempt, { ok: false }>): Failure {
  if (a.timeout) return fail('timeout', `AI did not answer within ${TIMEOUT_MS / 1000}s.`);
  if (a.network) return fail('error', 'AI unavailable: could not reach the Gemini API.');
  // A non-JSON error page means something between us and Google answered (a proxy or firewall), not Google.
  if (!a.body?.error) return fail('error', `AI unavailable: the Gemini API could not be reached (HTTP ${a.status} from a network proxy or firewall, not from Google). Try another network.`);
  const msg = a.body?.error?.message ?? `HTTP ${a.status}`;
  const reasons = (a.body?.error?.details ?? []).map(d => d.reason ?? '');
  if (reasons.includes('API_KEY_INVALID') || a.status === 401 || a.status === 403 || /api key/i.test(msg)) {
    return fail('auth', 'AI unavailable: the GEMINI_API_KEY was rejected. Check the key in Google AI Studio.');
  }
  if (a.status === 429) return fail('rate_limited', 'Gemini free-tier limit reached. Wait a minute (or until tomorrow for the daily limit) and try again.');
  if (/location is not supported|user location/i.test(msg)) return fail('error', 'AI unavailable: the Gemini API is not available in this region.');
  if (a.status === 400) return fail('error', `AI request rejected: ${msg}`);
  return fail('error', `AI error ${a.status}: ${msg}`);
}

/**
 * One model call that must return JSON matching `schema`. Uses Gemini's JSON mode with a response
 * schema; if Gemini rejects the schema, retries with JSON mode only and the schema in the prompt.
 * The reply is always validated with zod before use.
 */
export async function callJson<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<AiResponse<z.infer<S>>> {
  const apiKeyValue = apiKey();
  if (!apiKeyValue) return fail('no_key', 'AI unavailable: no GEMINI_API_KEY is configured on the server.');

  const jsonSchema = geminiSchema(opts.schema);

  // Same question as before → reuse the model's earlier answer (shared across servers via Upstash).
  const key = cacheKey([AI_MODEL, opts.system, opts.prompt, jsonSchema]);
  const cached = await cacheGet<{ model: string; data: unknown }>(key);
  if (cached) {
    const checked = opts.schema.safeParse(cached.data);
    if (checked.success) return { ok: true, source: 'ai', model: cached.model, data: checked.data, cached: true };
  }
  const payload = (withSchema: boolean) => ({
    systemInstruction: { parts: [{ text: `${opts.system}\nReply with JSON only, matching the requested schema. No prose, no markdown.` }] },
    contents: [{
      role: 'user',
      parts: [{ text: withSchema ? opts.prompt : `${opts.prompt}\n\nReturn JSON that matches this JSON Schema exactly:\n${JSON.stringify(jsonSchema)}` }],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      ...(withSchema ? { responseJsonSchema: jsonSchema } : {}),
      // Newer Flash models "think" before answering and those tokens count here, so leave headroom.
      maxOutputTokens: Math.max(8192, (opts.maxTokens ?? 4096) * 2),
      temperature: 0.4,
    },
  });

  const models = [AI_MODEL, ...FALLBACK_MODELS.filter(m => m !== AI_MODEL)];
  let result: Attempt | null = null;
  let usedModel = AI_MODEL;
  for (const model of models) {
    usedModel = model;
    result = await post(model, apiKeyValue, payload(true));
    // Schema not accepted by this model → same model, schema described in the prompt instead.
    const keyProblem = !result.ok && (result.body?.error?.details ?? []).some(d => d.reason === 'API_KEY_INVALID');
    if (!result.ok && result.status === 400 && !keyProblem) result = await post(model, apiKeyValue, payload(false));
    if (result.ok || result.status !== 404) break;
  }
  if (!result) return fail('error', 'AI error: no model available.');
  if (!result.ok) {
    if (result.status === 404) return fail('error', `AI unavailable: none of the Gemini models (${models.join(', ')}) is available for this key. Set GEMINI_MODEL in .env.local.`);
    return toFailure(result);
  }

  const body = result.body;
  if (body.promptFeedback?.blockReason) return fail('refused', `The model declined this request (${body.promptFeedback.blockReason}).`);
  const cand = body.candidates?.[0];
  if (!cand) return fail('invalid_output', 'The model returned no answer.');
  if (cand.finishReason && /SAFETY|PROHIBITED|BLOCKLIST|RECITATION|SPII/.test(cand.finishReason)) {
    return fail('refused', `The model declined this request (${cand.finishReason}).`);
  }
  if (cand.finishReason === 'MAX_TOKENS') return fail('invalid_output', 'The model reply was cut off (too long).');

  const text = (cand.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? '').join('');
  let data: unknown;
  try {
    data = JSON.parse(stripFences(text));
  } catch {
    return fail('invalid_output', 'The model reply was not valid JSON.');
  }
  const checked = opts.schema.safeParse(data);
  if (!checked.success) return fail('invalid_output', 'The model reply did not have the expected shape.');
  await cacheSet(key, { model: usedModel, data: checked.data });
  return { ok: true, source: 'ai', model: usedModel, data: checked.data };
}

// ─── Route plumbing ──────────────────────────────────────────────────────────

const MAX_BODY_CHARS = 200_000;

/** Parses and validates the request body; returns a ready error response on failure. */
export async function readBody<S extends z.ZodType>(request: Request, route: string, schema: S): Promise<{ body: z.infer<S> } | { response: Response }> {
  if (await isRateLimited(request, route)) {
    return { response: Response.json(fail('rate_limited', `Too many AI requests. Limit is ${RATE_LIMIT_PER_MINUTE} per minute.`), { status: 429 }) };
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { response: Response.json(fail('bad_request', 'Could not read the request body.'), { status: 400 }) };
  }
  if (raw.length > MAX_BODY_CHARS) {
    return { response: Response.json(fail('bad_request', 'Request too large for the AI route.'), { status: 413 }) };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { response: Response.json(fail('bad_request', 'Request body must be JSON.'), { status: 400 }) };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { response: Response.json(fail('bad_request', `Invalid request: ${parsed.error.issues[0]?.message ?? 'bad shape'}`), { status: 400 }) };
  }
  return { body: parsed.data };
}

/** AI outcomes are always HTTP 200 so the browser can read the message and fall back. */
export function reply<T>(outcome: AiResponse<T>): Response {
  return Response.json(outcome, { status: 200 });
}
