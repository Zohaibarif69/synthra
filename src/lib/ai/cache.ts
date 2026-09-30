// Server-only: AI answer cache and rate limiter.
//
// With Upstash Redis configured (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, or the KV_REST_API_*
// variables Vercel adds when you connect Upstash), both are shared by every server instance, which is
// what makes them work on Vercel. Without it they fall back to this process's memory, which is fine
// for local development. A Redis problem never breaks an AI request: it falls back to memory too.

import { createHash } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

/** How long a cached AI answer is reused. */
export const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
/** AI requests allowed per visitor, per route, per minute. */
export const RATE_LIMIT_PER_MINUTE = 20;
const WINDOW_MS = 60_000;
const KEY_PREFIX = 'synthra';

// ─── Connection ──────────────────────────────────────────────────────────────

let redis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '').trim();
  // One quick retry only: a slow or unreachable Redis must not slow AI requests down.
  redis = url && token ? new Redis({ url, token, retry: { retries: 1, backoff: () => 100 } }) : null;
  return redis;
}

/** After a Redis error, skip Redis for a minute (use memory) instead of paying the timeout on every request. */
const REDIS_COOLDOWN_MS = 60_000;
let redisDownUntil = 0;

function liveRedis(): Redis | null {
  const r = getRedis();
  return r && Date.now() >= redisDownUntil ? r : null;
}

export type CacheBackend = 'redis' | 'memory';

export function cacheBackend(): CacheBackend {
  return getRedis() ? 'redis' : 'memory';
}

let warned = false;
function redisFailed(err: unknown) {
  redisDownUntil = Date.now() + REDIS_COOLDOWN_MS;
  if (!warned) {
    warned = true;
    console.warn(`[synthra] Upstash Redis unavailable, using memory instead: ${(err as Error).message}`);
  }
}

// ─── Cache ───────────────────────────────────────────────────────────────────

/** Same question → same key. Only a hash is stored, never the prompt itself. */
export function cacheKey(parts: unknown[]): string {
  return `${KEY_PREFIX}:ai:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;
}

const MEMORY_MAX = 200;
const memory = new Map<string, { value: unknown; expires: number }>();

function memoryGet(key: string): unknown {
  const hit = memory.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) { memory.delete(key); return undefined; }
  // Re-insert so the Map order doubles as least-recently-used order.
  memory.delete(key);
  memory.set(key, hit);
  return hit.value;
}

function memorySet(key: string, value: unknown) {
  memory.set(key, { value, expires: Date.now() + CACHE_TTL_SECONDS * 1000 });
  while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value as string);
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const r = liveRedis();
  if (r) {
    try {
      const v = await r.get<T>(key);
      return v === null ? undefined : v;
    } catch (err) {
      redisFailed(err);
    }
  }
  return memoryGet(key) as T | undefined;
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  const r = liveRedis();
  if (r) {
    try {
      await r.set(key, value, { ex: CACHE_TTL_SECONDS });
      return;
    } catch (err) {
      redisFailed(err);
    }
  }
  memorySet(key, value);
}

// ─── Rate limit ──────────────────────────────────────────────────────────────

let limiter: Ratelimit | null | undefined;

function getLimiter(): Ratelimit | null {
  if (limiter !== undefined) return limiter;
  const r = getRedis();
  limiter = r
    ? new Ratelimit({ redis: r, limiter: Ratelimit.slidingWindow(RATE_LIMIT_PER_MINUTE, '60 s'), prefix: `${KEY_PREFIX}:rl`, timeout: 1500 })
    : null;
  return limiter;
}

const hits = new Map<string, number[]>();

function memoryLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter(t => now - t < WINDOW_MS);
  const limited = recent.length >= RATE_LIMIT_PER_MINUTE;
  if (!limited) recent.push(now);
  hits.set(key, recent);
  return limited;
}

export function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'local';
}

/** True when this visitor has used up this route's requests for the current minute. */
export async function isRateLimited(request: Request, route: string): Promise<boolean> {
  const key = `${route}:${clientIp(request)}`;
  const l = liveRedis() ? getLimiter() : null;
  if (l) {
    try {
      const res = await l.limit(key);
      // On a timeout the library lets the request through without counting it; count it here instead.
      if (res.reason !== 'timeout') return !res.success;
      redisFailed(new Error('rate limit check timed out'));
    } catch (err) {
      redisFailed(err);
    }
  }
  return memoryLimited(key);
}

/** Test helper: forget the connection and all in-memory state. */
export function resetCacheForTests() {
  redis = undefined;
  limiter = undefined;
  warned = false;
  redisDownUntil = 0;
  memory.clear();
  hits.clear();
}
