'use client';

import React from 'react';
import type { QualityDimension } from '../../lib/engine/quality';
import { formatScore, scoreVar } from './scoreStyle';

export function DimensionBars({ dimensions }: { dimensions: QualityDimension[] }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">Dimensions</h3>
      <div className="space-y-4">
        {dimensions.map(d => (
          <div key={d.id}>
            <div className="flex justify-between mb-1">
              <span className="text-xs text-[var(--color-text-secondary)]">{d.label}</span>
              <span className="text-xs font-mono" style={{ color: scoreVar(d.score) }}>{d.score === null ? d.naReason : formatScore(d.score)}</span>
            </div>
            <div className="h-1.5 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
              {d.score !== null && (
                <div className="h-full rounded-full transition-all duration-300" style={{ width: `${d.score}%`, background: scoreVar(d.score) }} />
              )}
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1 truncate" title={d.detail}>{d.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
