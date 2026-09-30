'use client';

import { ErrorPanel } from '@/components/common/ErrorBoundary';

/** Route-level error UI (Next.js App Router): shown instead of a blank page when a route throws. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPanel error={error} onRetry={reset} />;
}
