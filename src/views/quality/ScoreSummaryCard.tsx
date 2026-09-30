'use client';

import React from 'react';
import type { QualityDimension } from '../../lib/engine/quality';
import { InfoTip } from './InfoTip';
import { formatScore, scoreVar } from './scoreStyle';

export function ScoreSummaryCard({ overall, dimensions }: { overall: number | null; dimensions: QualityDimension[] }) {
  const available = dimensions.filter(d => d.score !== null);
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5">
      <div className="flex flex-col md:flex-row md:items-center gap-6">
        <div className="shrink-0">
          <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide flex items-center gap-1.5">
            Overall Quality
            <InfoTip>
              Average of the dimensions that could be computed ({available.map(d => d.label).join(', ') || 'none'}).
              Dimensions shown as N/A are skipped, not counted as zero.
            </InfoTip>
          </p>
          <p className="text-4xl font-bold font-mono mt-1" style={{ color: scoreVar(overall) }}>{formatScore(overall)}</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">{available.length} of {dimensions.length} dimensions available</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 flex-1">
          {dimensions.map(d => (
            <div key={d.id} className="bg-[var(--color-surface-2)] rounded-[var(--radius-md)] p-3">
              <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5">
                {d.label}
                <InfoTip align="right">
                  <span className="block font-medium text-[var(--color-text-primary)] mb-1">How it is computed</span>
                  {d.method}
                  <span className="block mt-2 font-mono text-[11px] break-words">{d.detail}</span>
                </InfoTip>
              </p>
              <p className="text-xl font-semibold font-mono mt-0.5" style={{ color: scoreVar(d.score) }}>{formatScore(d.score)}</p>
              {d.naReason && <p className="text-[11px] text-[var(--color-text-muted)]">{d.naReason}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
