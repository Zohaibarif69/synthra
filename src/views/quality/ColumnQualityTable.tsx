'use client';

import React from 'react';
import { Badge } from '../../components/common/Badge';
import type { ColumnQuality } from '../../lib/engine/quality';
import { formatScore, scoreVar } from './scoreStyle';

const STATUS = {
  ok: { variant: 'success' as const, label: 'OK' },
  warning: { variant: 'warning' as const, label: 'Warning' },
  issue: { variant: 'error' as const, label: 'Issue' },
};
const pct = (v: number | undefined) => (v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);

export function ColumnQualityTable({ columns }: { columns: ColumnQuality[] }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--color-border)]">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Columns</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--color-surface-2)] text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
              <th className="text-left px-4 py-3 font-medium">Column</th>
              <th className="text-left px-3 py-3 font-medium">Type</th>
              <th className="text-left px-3 py-3 font-medium">Fidelity</th>
              <th className="text-left px-3 py-3 font-medium">Null rate (original → synthetic)</th>
              <th className="text-left px-3 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {columns.map(c => (
              <tr key={c.column} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
                <td className="px-4 py-3 font-mono text-xs font-medium text-[var(--color-text-primary)]">{c.column}</td>
                <td className="px-3 py-3"><Badge variant="muted">{c.type}</Badge></td>
                <td className="px-3 py-3 font-mono text-xs" style={{ color: scoreVar(c.fidelity) }}>
                  {formatScore(c.fidelity)}{c.fidelityMethod && <span className="text-[var(--color-text-muted)]"> ({c.fidelityMethod})</span>}
                </td>
                <td className="px-3 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{pct(c.nullRateOriginal)} → {pct(c.nullRateSynthetic)}</td>
                <td className="px-3 py-3"><Badge variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
