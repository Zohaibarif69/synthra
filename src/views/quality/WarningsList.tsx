'use client';

import React from 'react';
import { AlertTriangle, CheckCircle, XCircle, Info } from 'lucide-react';
import { Badge } from '../../components/common/Badge';
import type { QualityWarning } from '../../lib/engine/quality';

const ICON = {
  high: <XCircle size={15} className="text-[var(--color-error)] shrink-0 mt-0.5" />,
  medium: <AlertTriangle size={15} className="text-[var(--color-warning)] shrink-0 mt-0.5" />,
  low: <Info size={15} className="text-[var(--color-info)] shrink-0 mt-0.5" />,
};
const BADGE = { high: 'error', medium: 'warning', low: 'info' } as const;

export function WarningsList({ warnings }: { warnings: QualityWarning[] }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">
        Warnings <span className="font-normal text-[var(--color-text-muted)]">({warnings.length})</span>
      </h3>
      {warnings.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-[var(--color-success)]">
          <CheckCircle size={15} /> No quality issues detected.
        </p>
      ) : (
        <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2.5 p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-2)]">
              {ICON[w.severity]}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {!w.columns && <span className="font-mono text-xs font-semibold text-[var(--color-text-primary)]">{w.column}</span>}
                  <span className="text-sm text-[var(--color-text-primary)]">{w.title}</span>
                  <Badge variant={BADGE[w.severity]}>{w.severity.toUpperCase()}</Badge>
                </div>
                {w.details ? (
                  <ul className="text-xs text-[var(--color-text-secondary)] mt-0.5 space-y-0.5">
                    {w.details.map((d, j) => <li key={j} className="font-mono break-words">{d}</li>)}
                  </ul>
                ) : (
                  <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{w.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
