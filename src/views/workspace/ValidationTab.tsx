'use client';

import React from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react';
import { Badge } from '../../components/common/Badge';
import { EmptyState } from '../../components/common/EmptyState';
import type { DocumentResult, RelationalResult, TabularResult, ValidationResult } from '../../lib/types';

const iconMap = {
  passed: <CheckCircle size={15} className="text-[var(--color-success)] shrink-0" />,
  warning: <AlertTriangle size={15} className="text-[var(--color-warning)] shrink-0" />,
  failed: <XCircle size={15} className="text-[var(--color-error)] shrink-0" />,
};
const badgeMap = { passed: 'success' as const, warning: 'warning' as const, failed: 'error' as const };

function ValidationBlock({ title, v }: { title: string; v: ValidationResult }) {
  const counts = {
    passed: v.checks.filter(c => c.status === 'passed').length,
    warning: v.checks.filter(c => c.status === 'warning').length,
    failed: v.checks.filter(c => c.status === 'failed').length,
  };
  const banner = {
    passed: { cls: 'bg-[var(--color-success-bg)] border-[var(--color-success)]/20', icon: <CheckCircle size={18} className="text-[var(--color-success)]" />, text: 'All checks passed' },
    warning: { cls: 'bg-[var(--color-warning-bg)] border-[var(--color-warning)]/20', icon: <AlertTriangle size={18} className="text-[var(--color-warning)]" />, text: `${counts.warning} warning${counts.warning === 1 ? '' : 's'}` },
    failed: { cls: 'bg-[var(--color-error-bg)] border-[var(--color-error)]/20', icon: <XCircle size={18} className="text-[var(--color-error)]" />, text: `${counts.failed} failed check${counts.failed === 1 ? '' : 's'}` },
  }[v.overall];

  return (
    <div className="space-y-4">
      <div className={`rounded-[var(--radius-lg)] p-4 border ${banner.cls}`}>
        <div className="flex items-center gap-2">
          {banner.icon}
          <span className="font-semibold text-sm">{title} — {banner.text}</span>
          <span className="text-xs text-[var(--color-text-muted)] ml-auto">{counts.passed} passed · {counts.warning} warnings · {counts.failed} failed</span>
        </div>
      </div>
      <div className="space-y-2">
        {v.checks.map(check => (
          <div key={check.name} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                {iconMap[check.status]}
                <span className="text-sm font-medium text-[var(--color-text-primary)]">{check.name}</span>
              </div>
              <Badge variant={badgeMap[check.status]}>{check.status.toUpperCase()}</Badge>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)] ml-5">{check.message}</p>
            {check.detail && <p className="text-xs text-[var(--color-text-muted)] ml-5 mt-0.5 font-mono break-words">{check.detail}</p>}
          </div>
        ))}
      </div>
      {!!v.notes?.length && (
        <div className="space-y-1">
          {v.notes.map(n => (
            <p key={n} className="flex items-start gap-1.5 text-xs text-[var(--color-text-muted)]">
              <Info size={12} className="shrink-0 mt-0.5" /> {n}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function ValidationTab({ result, relational, documents }: { result: TabularResult | null; relational?: RelationalResult | null; documents?: DocumentResult | null }) {
  if (documents) {
    return <ValidationBlock title={documents.kind === 'invoice' ? 'Invoice Validation' : 'Bank Statement Validation'} v={documents.validation} />;
  }
  if (!result) {
    return <EmptyState icon={<CheckCircle size={32} />} title="Validation not available" description="Validation runs for tabular and relational generation." />;
  }
  return (
    <div className="space-y-8">
      {relational && <ValidationBlock title="Cross-table Validation" v={relational.relationalValidation} />}
      <ValidationBlock title={result.tableName ? `Table ${result.tableName}` : 'Data Validation'} v={result.validation} />
    </div>
  );
}
