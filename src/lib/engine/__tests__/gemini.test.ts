import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';

type Call = { url: string; headers: Record<string, string>; body: any };
let calls: Call[] = [];

/** Fake Gemini: each queued reply is used once, in order. */
function fakeGemini(replies: { status: number; body: unknown }[]) {
  calls = [];
  const queue = [...replies];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const r = queue.shift() ?? { status: 500, body: { error: { message: 'no more replies' } } };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }));
}
const ok = (text: string, finishReason = 'STOP', extra: object = {}) => ({
  status: 200, body: { candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text }] }, finishReason }], ...extra },
});
const err = (status: number, message: string, reason?: string) => ({
  status, body: { error: { code: status, message, details: reason ? [{ reason }] : [] } },
});

const Schema = z.object({ name: z.string(), count: z.number().int() });
const load = async () => (await import('../../ai/server'));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('GEMINI_API_KEY', 'test-key'); vi.stubEnv('GEMINI_MODEL', '');
  for (const v of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) vi.stubEnv(v, '');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Gemini AI helper', () => {
  it('no key → "AI unavailable", no network call', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    fakeGemini([]);
    const { callJson, aiConfigured } = await load();
    expect(aiConfigured()).toBe(false);
    const r = await callJson({ schema: Schema, system: 's', prompt: 'p' });
    expect(r).toMatchObject({ ok: false, code: 'no_key' });
    expect(calls).toHaveLength(0);
  });

  it('sends the key in a header (not the URL), JSON mode + schema, and parses the answer (skipping thought parts)', async () => {
    fakeGemini([ok('{"name":"x","count":3}')]);
    const { callJson } = await load();
    const r = await callJson({ schema: Schema, system: 'sys', prompt: 'hello' });
    expect(r).toEqual({ ok: true, source: 'ai', model: 'gemini-flash-latest', data: { name: 'x', count: 3 } });
    const c = calls[0];
    expect(c.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent');
    expect(c.url).not.toContain('test-key');
    expect(c.headers['x-goog-api-key']).toBe('test-key');
    expect(c.body.generationConfig.responseMimeType).toBe('application/json');
    expect(c.body.generationConfig.responseJsonSchema).toMatchObject({ type: 'object', required: ['name', 'count'] });
    expect(JSON.stringify(c.body.generationConfig.responseJsonSchema)).not.toMatch(/\$schema|additionalProperties|9007199254740991/);
    expect(c.body.systemInstruction.parts[0].text).toContain('sys');
    expect(c.body.contents[0].parts[0].text).toBe('hello');
  });

  it('GEMINI_MODEL overrides the model', async () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-2.5-flash');
    fakeGemini([ok('{"name":"x","count":1}')]);
    const { callJson } = await load();
    const r = await callJson({ schema: Schema, system: 's', prompt: 'p' });
    expect(calls[0].url).toContain('/gemini-2.5-flash:generateContent');
    expect(r.ok && r.model).toBe('gemini-2.5-flash');
  });

  it('unknown model (404) → tries the next model', async () => {
    fakeGemini([err(404, 'models/gemini-flash-latest is not found'), ok('{"name":"y","count":2}')]);
    const { callJson } = await load();
    const r = await callJson({ schema: Schema, system: 's', prompt: 'p' });
    expect(calls.map(c => c.url.split('/').pop())).toEqual(['gemini-flash-latest:generateContent', 'gemini-2.5-flash:generateContent']);
    expect(r).toMatchObject({ ok: true, model: 'gemini-2.5-flash' });
  });

  it('schema rejected (400) → retries the same model with the schema in the prompt', async () => {
    fakeGemini([err(400, 'Invalid JSON schema'), ok('{"name":"z","count":5}')]);
    const { callJson } = await load();
    const r = await callJson({ schema: Schema, system: 's', prompt: 'p' });
    expect(r.ok).toBe(true);
    expect(calls[1].body.generationConfig.responseJsonSchema).toBeUndefined();
    expect(calls[1].body.contents[0].parts[0].text).toContain('JSON Schema');
  });

  it.each([
    [err(400, 'API key not valid. Please pass a valid API key.', 'API_KEY_INVALID'), 'auth'],
    [err(403, 'Permission denied'), 'auth'],
    [err(429, 'Resource has been exhausted (e.g. check quota).'), 'rate_limited'],
    [err(500, 'Internal error'), 'error'],
    [ok('{}', 'SAFETY'), 'refused'],
    [{ status: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } }, 'refused'],
    [ok('{"name":"x"', 'MAX_TOKENS'), 'invalid_output'],
    [ok('not json'), 'invalid_output'],
    [ok('{"name":"x","count":"three"}'), 'invalid_output'],
  ])('failure is reported honestly: %j → %s', async (reply, code) => {
    fakeGemini([reply, reply]);
    const { callJson } = await load();
    const r = await callJson({ schema: Schema, system: 's', prompt: 'p' });
    expect(r).toMatchObject({ ok: false, code });
  });

  it('a firewall/proxy block is reported as a network problem, not a bad key', async () => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Host not in allowlist', { status: 403, headers: { 'Content-Type': 'text/plain' } })));
    const { callJson } = await load();
    const r = await callJson({ schema: Schema, system: 's', prompt: 'p' });
    expect(r).toMatchObject({ ok: false, code: 'error' });
    expect(r.ok ? '' : r.message).toMatch(/proxy or firewall/);
  });

  it('an invalid key is not retried without the schema', async () => {
    fakeGemini([err(400, 'API key not valid', 'API_KEY_INVALID')]);
    const { callJson } = await load();
    await callJson({ schema: Schema, system: 's', prompt: 'p' });
    expect(calls).toHaveLength(1);
  });

  it('timeout → "timeout"', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })));
    const { callJson } = await load();
    const p = callJson({ schema: Schema, system: 's', prompt: 'p' });
    await vi.advanceTimersByTimeAsync(16_000);
    expect(await p).toMatchObject({ ok: false, code: 'timeout' });
    vi.useRealTimers();
  });
});

describe('every AI route works end to end against the fake Gemini', () => {
  const post = (body: unknown) => new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': String(Math.random()) } });
  it.each([
    ['content', { kind: 'column', column: 'review', otherColumns: ['id'], examples: [], locale: 'PK', count: 3 }, { values: ['a', 'b', 'c'] }],
    ['content', { kind: 'invoice_items', business: 'textile exporter', locale: 'PK', count: 2 }, { items: [{ name: 'Cotton', unit: 'kg', minUsd: 1, maxUsd: 2 }] }],
    ['edge-cases', { columns: [{ name: 'age', type: 'integer' }], locale: 'PK' }, null],
    ['explain', { dataset: 'd', overall: 90, dimensions: [], warnings: [], settings: 's' }, null],
    ['query', { kind: 'tabular', text: '100 customers with name and age' }, null],
    ['query', { kind: 'bank', text: 'last 90 days', today: '2026-09-29' }, null],
    ['schema', { tables: [{ name: 't', columns: ['email'], sampleRows: [{ email: 'a****@x.com' }] }] }, null],
  ])('/api/ai/%s builds a schema Gemini accepts and returns an honest result', async (route, body, answer) => {
    fakeGemini([answer ? ok(JSON.stringify(answer)) : err(500, 'x'), err(500, 'x')]);
    const mod = await import(`../../../app/api/ai/${route}/route`);
    const res: Response = await mod.POST(post(body));
    const json = await res.json();
    expect(calls.length).toBeGreaterThan(0);
    const schema = calls[0].body.generationConfig.responseJsonSchema;
    expect(schema?.type).toBe('object');
    expect(JSON.stringify(schema)).not.toMatch(/\$schema/);
    if (answer) expect(json.ok).toBe(true);
    else expect(json).toMatchObject({ ok: false });
  });

  it('/api/ai/status reports the configured model', async () => {
    const mod = await import('../../../app/api/ai/status/route');
    expect(await mod.GET().json()).toEqual({ configured: true, model: 'gemini-flash-latest', cache: 'memory' });
  });
});

describe('schema review (the biggest AI job)', () => {
  const body = { tables: [{ name: 'dataset', columns: ['full_name', 'churned'], sampleRows: [{ full_name: 'A**** K***', churned: true }] }] };
  const answer = (semanticType: string) => ({
    columns: [
      { table: 'dataset', column: 'full_name', semanticType: 'Person Name', pii: true, privacyLevel: 'high', transform: 'synthetic', reason: 'A name' },
      { table: 'dataset', column: 'churned', semanticType, pii: false, privacyLevel: 'low', transform: 'preserve' },
    ],
    relationships: [],
  });
  const req = () => new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': String(Math.random()) } });

  it('an off-list value no longer throws away the whole review', async () => {
    fakeGemini([ok(JSON.stringify(answer('Boolean')))]); // "Boolean" is not one of the semantic types; reason missing
    const mod = await import('../../../app/api/ai/schema/route');
    const json = await (await mod.POST(req())).json();
    expect(json.ok).toBe(true);
    expect(json.data.columns).toHaveLength(2);
    expect(json.data.columns[1]).toMatchObject({ column: 'churned', semanticType: 'Other', reason: '' });
    expect(json.data.columns[0].semanticType).toBe('Person Name');
    expect(JSON.stringify(calls[0].body.generationConfig.responseJsonSchema)).not.toContain('"default"');
  });

  it('a slow answer (20 s) now succeeds instead of timing out at 15 s', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer('Category')) }] }, finishReason: 'STOP' }] }), { status: 200 })), 20_000);
      init.signal!.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    })));
    const mod = await import('../../../app/api/ai/schema/route');
    const pending = mod.POST(req());
    await vi.advanceTimersByTimeAsync(21_000);
    const json = await (await pending).json();
    vi.useRealTimers();
    expect(json.ok).toBe(true);
  });

  it('gives up at 45 s with a clear timeout code', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })));
    const mod = await import('../../../app/api/ai/schema/route');
    const pending = mod.POST(req());
    await vi.advanceTimersByTimeAsync(46_000);
    const json = await (await pending).json();
    vi.useRealTimers();
    expect(json).toMatchObject({ ok: false, code: 'timeout' });
    expect(json.message).toMatch(/45s/);
  });
});

