import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';

const Schema = z.object({ name: z.string() });
const geminiOk = (name: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ name }) }] }, finishReason: 'STOP' }] }), { status: 200 });

/**
 * Minimal fake of the Upstash REST API as the SDK really uses it (checked against @upstash/redis):
 * commands are POSTed as JSON arrays, batched to /pipeline, and string results are base64-encoded.
 */
function fakeUpstash() {
  const store = new Map<string, string>();
  const log: string[][] = [];
  const enc = (v: unknown) => (typeof v === 'string' ? Buffer.from(v).toString('base64') : v);
  const run = (cmd: string[]): unknown => {
    log.push(cmd);
    const [op, key, value] = [cmd[0].toLowerCase(), cmd[1], cmd[2]];
    if (op === 'get') return store.get(key) ?? null;
    if (op === 'set') { store.set(key, value); return 'OK'; }
    if (op === 'evalsha' || op === 'eval') return [19, 20]; // sliding window: [remaining, limit] → allowed
    return null;
  };
  return {
    store, log,
    handle(url: string, body: unknown): Response {
      if (url.endsWith('/pipeline')) return Response.json((body as string[][]).map(c => ({ result: enc(run(c.map(String))) })));
      return Response.json({ result: enc(run((body as unknown[]).map(String))) });
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('GEMINI_API_KEY', 'k');
  vi.stubEnv('GEMINI_MODEL', '');
  for (const v of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) vi.stubEnv(v, '');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('AI answer cache (no Redis → memory)', () => {
  it('the same request is answered from cache without calling Gemini again', async () => {
    const fetchMock = vi.fn(async () => geminiOk('first'));
    vi.stubGlobal('fetch', fetchMock);
    const { callJson } = await import('../../ai/server');
    const a = await callJson({ schema: Schema, system: 's', prompt: 'same' });
    const b = await callJson({ schema: Schema, system: 's', prompt: 'same' });
    expect(a).toMatchObject({ ok: true, data: { name: 'first' } });
    expect(a.ok && a.cached).toBeFalsy();
    expect(b).toMatchObject({ ok: true, data: { name: 'first' }, cached: true, source: 'ai' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a different request is not served from cache', async () => {
    const fetchMock = vi.fn(async () => geminiOk('x'));
    vi.stubGlobal('fetch', fetchMock);
    const { callJson } = await import('../../ai/server');
    await callJson({ schema: Schema, system: 's', prompt: 'one' });
    await callJson({ schema: Schema, system: 's', prompt: 'two' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('failures are never cached', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 429, message: 'quota' } }), { status: 429 }))
      .mockResolvedValueOnce(geminiOk('later'));
    vi.stubGlobal('fetch', fetchMock);
    const { callJson } = await import('../../ai/server');
    expect(await callJson({ schema: Schema, system: 's', prompt: 'p' })).toMatchObject({ ok: false, code: 'rate_limited' });
    expect(await callJson({ schema: Schema, system: 's', prompt: 'p' })).toMatchObject({ ok: true, data: { name: 'later' } });
  });

  it('only a hash of the question is used as the key', async () => {
    const { cacheKey } = await import('../../ai/cache');
    const key = cacheKey(['secret prompt with a.b@mail.com']);
    expect(key).toMatch(/^synthra:ai:[0-9a-f]{64}$/);
    expect(key).not.toContain('mail');
  });
});

describe('with Upstash Redis', () => {
  it('reads and writes the cache in Redis, using the variables Vercel creates', async () => {
    vi.stubEnv('KV_REST_API_URL', 'https://fake.upstash.io');
    vi.stubEnv('KV_REST_API_TOKEN', 'tok');
    const up = fakeUpstash();
    const gemini = vi.fn(async () => geminiOk('from-redis'));
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) =>
      String(url).startsWith('https://fake.upstash.io') ? up.handle(String(url), JSON.parse(String(init.body))) : gemini()));
    const { callJson } = await import('../../ai/server');
    const { cacheBackend } = await import('../../ai/cache');
    expect(cacheBackend()).toBe('redis');
    await callJson({ schema: Schema, system: 's', prompt: 'p' });
    expect([...up.store.keys()].some(k => k.startsWith('synthra:ai:'))).toBe(true);
    // A new server instance (fresh modules, empty memory) still gets the cached answer from Redis.
    vi.resetModules();
    const again = await (await import('../../ai/server')).callJson({ schema: Schema, system: 's', prompt: 'p' });
    expect(again).toMatchObject({ ok: true, cached: true, data: { name: 'from-redis' } });
    expect(gemini).toHaveBeenCalledTimes(1);
  });

  it('if Redis is down, AI still works (falls back to memory)', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://down.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).startsWith('https://down.upstash.io') ? Promise.reject(new Error('network down')) : geminiOk('ok')));
    const { callJson } = await import('../../ai/server');
    expect(await callJson({ schema: Schema, system: 's', prompt: 'p' })).toMatchObject({ ok: true, data: { name: 'ok' } });
    expect(await callJson({ schema: Schema, system: 's', prompt: 'p' })).toMatchObject({ ok: true, cached: true });
  });
});

describe('rate limit', () => {
  const req = (ip: string) => new Request('http://x/api', { method: 'POST', headers: { 'x-forwarded-for': ip } });

  it('allows 20 AI requests per minute per visitor, then blocks; other visitors are unaffected', async () => {
    const { isRateLimited } = await import('../../ai/cache');
    for (let i = 0; i < 20; i++) expect(await isRateLimited(req('1.1.1.1'), 'schema')).toBe(false);
    expect(await isRateLimited(req('1.1.1.1'), 'schema')).toBe(true);
    expect(await isRateLimited(req('2.2.2.2'), 'schema')).toBe(false);
    expect(await isRateLimited(req('1.1.1.1'), 'query')).toBe(false);
  });

  it('a blocked visitor gets a clear 429 from the route', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk('x')));
    const route = await import('../../../app/api/ai/query/route');
    const body = JSON.stringify({ kind: 'tabular', text: 'x' });
    let last: Response | null = null;
    for (let i = 0; i < 21; i++) last = await route.POST(new Request('http://x', { method: 'POST', body, headers: { 'x-forwarded-for': '9.9.9.9' } }));
    expect(last!.status).toBe(429);
    expect((await last!.json()).message).toMatch(/20 per minute/);
  });

  it('uses Upstash for the limit when configured, and falls back to memory if Redis fails', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fake.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'tok');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const up = fakeUpstash();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => up.handle(String(url), JSON.parse(String(init.body)))));
    const { isRateLimited } = await import('../../ai/cache');
    expect(await isRateLimited(req('3.3.3.3'), 'schema')).toBe(false);
    expect(up.log.length).toBeGreaterThan(0);

    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('down'))));
    const fresh = await import('../../ai/cache');
    const started = Date.now();
    for (let i = 0; i < 20; i++) expect(await fresh.isRateLimited(req('4.4.4.4'), 'schema')).toBe(false);
    expect(await fresh.isRateLimited(req('4.4.4.4'), 'schema')).toBe(true);
    // Only the first check touches the dead Redis; the rest skip it, so 21 checks stay fast.
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
