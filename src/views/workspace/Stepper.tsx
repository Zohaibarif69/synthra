'use client';

import React from 'react';
import { Check } from 'lucide-react';
import { STEPS } from '../../lib/constants';

/** Wizard progress. Steps that `canGo` allows are buttons, so the wizard can be driven from the keyboard. */
export function Stepper({ step, maxStep, canGo, onGo }: {
  step: number;
  maxStep: number;
  canGo?: (n: number) => boolean;
  onGo?: (n: number) => void;
}) {
  return (
    <nav aria-label="Wizard steps" className="px-6 py-3 bg-[var(--color-surface)] border-b border-[var(--color-border)] overflow-x-auto">
      <ol className="flex items-center gap-0">
        {STEPS.map((s, i) => {
          const n = i + 1;
          const isComplete = n < step;
          const isActive = n === step;
          const isReachable = n <= maxStep;
          const clickable = !isActive && !!onGo && (canGo?.(n) ?? isReachable);
          const content = (
            <>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                isComplete ? 'bg-[var(--color-success)] text-white' :
                isActive ? 'bg-[var(--color-primary)] text-white' :
                'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border border-[var(--color-border)]'
              }`}>
                {isComplete ? <Check size={12} aria-hidden /> : s.id}
              </span>
              <span className={`hidden sm:block text-xs font-medium leading-tight ${isActive ? 'text-[var(--color-primary)]' : isComplete ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]'}`}>
                {s.label}
              </span>
            </>
          );
          const label = `Step ${n}: ${s.label}${isComplete ? ' (done)' : ''}`;
          return (
            <li key={s.id} className="flex items-center shrink-0" aria-current={isActive ? 'step' : undefined}>
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onGo!(n)}
                  aria-label={`Go to ${label}`}
                  className="flex items-center gap-2 rounded-[var(--radius-md)] px-1 py-0.5 hover:bg-[var(--color-surface-2)] transition-colors"
                >
                  {content}
                </button>
              ) : (
                <span aria-label={label} className={`flex items-center gap-2 px-1 py-0.5 ${!isReachable ? 'opacity-40' : ''}`}>{content}</span>
              )}
              {i < STEPS.length - 1 && (
                <span aria-hidden className={`h-px w-8 mx-2 ${n < step ? 'bg-[var(--color-success)]' : 'bg-[var(--color-border)]'}`} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
