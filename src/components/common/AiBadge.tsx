import React from 'react';
import { Sparkles } from 'lucide-react';

/** Marks a result that really came from the model. Never render it for rule-based output. */
export function AiBadge({ title }: { title?: string }) {
  return (
    <span
      title={title ?? 'Produced by the AI model'}
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-[var(--color-primary-light)] text-[var(--color-primary)] border border-[var(--color-primary)]/30"
    >
      <Sparkles size={9} /> AI
    </span>
  );
}

/**
 * Quiet note shown when an AI call didn't run: the built-in engine carries on, so this is a status,
 * not an error. The technical reason is available on hover for debugging.
 */
export function AiUnavailable({ message, detail }: { message?: string; detail?: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]" title={detail}>
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] opacity-60 shrink-0" aria-hidden="true" />
      {message ?? 'Using built-in detection'}
    </p>
  );
}
