import { AI_MODEL, aiConfigured } from '@/lib/ai/server';
import { cacheBackend } from '@/lib/ai/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Whether a key is configured (not whether a call will succeed — failures are reported per request). */
export function GET() {
  return Response.json({ configured: aiConfigured(), model: aiConfigured() ? AI_MODEL : null, cache: cacheBackend() });
}
