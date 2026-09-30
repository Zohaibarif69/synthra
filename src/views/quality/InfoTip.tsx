'use client';

import React from 'react';
import { Info } from 'lucide-react';

/** Hover/focus tooltip explaining how a number is computed. */
export function InfoTip({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <span className="relative inline-flex group align-middle">
      <button type="button" aria-label="How is this computed?" className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] focus:outline-none">
        <Info size={12} />
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full mt-1.5 z-30 w-72 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs font-normal leading-relaxed text-[var(--color-text-secondary)] shadow-lg opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${align === 'right' ? 'right-0' : 'left-0'}`}
      >
        {children}
      </span>
    </span>
  );
}
