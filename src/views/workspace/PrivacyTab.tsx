'use client';

import React from 'react';
import { Shield, ArrowRight } from 'lucide-react';
import { Badge, PrivacyBadge } from '../../components/common/Badge';
import { EmptyState } from '../../components/common/EmptyState';
import type { Cell, PrivacyTransform, TabularResult } from '../../lib/types';

const TRANSFORM_LABELS: Record<PrivacyTransform, string> = {
  preserve: 'Preserved',
  mask: 'Masked',
  hash: 'Hashed (SHA-256)',
  synthetic: 'Synthetic (faker)',
  noise: 'Differential noise',
};

function show(v: Cell): string {
  if (v === null) return '—';
  const s = String(v);
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}

export function PrivacyTab({ result }: { result: TabularResult | null }) {
  if (!result) {
    return <EmptyState icon={<Shield size={32} />} title="Privacy report not available" description="Privacy transforms run for tabular generation." />;
  }

  const reports = result.privacy;
  const high = reports.filter(r => r.level === 'high');
  const transformed = reports.filter(r => r.transform !== 'preserve');
  const leakCheck = result.validation.checks.find(c => c.name === 'Privacy: No Original PII Values');
  const leaked = result.validation.metrics?.columns.reduce((a, c) => a + (c.leakedValues ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4">
          <p className="text-xs text-[var(--color-text-muted)]">High-privacy fields</p>
          <p className="text-2xl font-semibold text-[var(--color-error)]">{high.length}</p>
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4">
          <p className="text-xs text-[var(--color-text-muted)]">Columns transformed</p>
          <p className="text-2xl font-semibold text-[var(--color-success)]">{transformed.length}</p>
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4">
          <p className="text-xs text-[var(--color-text-muted)]">Original PII values found</p>
          <p className={`text-2xl font-semibold ${leaked ? 'text-[var(--color-error)]' : 'text-[var(--color-text-primary)]'}`}>
            {leakCheck ? (leaked ?? 0).toLocaleString() : '—'}
          </p>
          {!leakCheck && <p className="text-[11px] text-[var(--color-text-muted)]">Needs an uploaded file</p>}
        </div>
      </div>

      {leakCheck && (
        <p className={`text-xs ${leakCheck.status === 'passed' ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>{leakCheck.message}</p>
      )}

      <div className="space-y-2">
        {!reports.length && <p className="text-sm text-[var(--color-text-secondary)]">No sensitive or transformed columns in this schema.</p>}
        {reports.map(r => (
          <div key={r.column} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <Shield size={15} className="text-[var(--color-primary)]" />
                <span className="font-mono text-sm font-medium text-[var(--color-text-primary)]">{r.column}</span>
                {r.level && <PrivacyBadge level={r.level} />}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={r.transform === 'preserve' ? 'muted' : 'success'}>{TRANSFORM_LABELS[r.transform]}</Badge>
                {r.changed > 0 && <span className="text-xs text-[var(--color-text-muted)]">{r.changed.toLocaleString()} values changed</span>}
              </div>
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 ml-7">{r.note}</p>
            {r.examples.length > 0 && (
              <div className="mt-2 ml-7 space-y-1">
                {r.examples.map((ex, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs font-mono">
                    {r.transform === 'preserve' || r.transform === 'synthetic' ? (
                      <span className="text-[var(--color-text-secondary)]">{show(ex.after)}</span>
                    ) : (
                      <>
                        <span className="text-[var(--color-text-muted)] line-through decoration-[var(--color-border-strong)]">{show(ex.before)}</span>
                        <ArrowRight size={11} className="text-[var(--color-text-muted)] shrink-0" />
                        <span className="text-[var(--color-text-primary)]">{show(ex.after)}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        “Before” values are this run’s generated values just before the transform; the uploaded file’s real values are never shown or copied.
      </p>
    </div>
  );
}
