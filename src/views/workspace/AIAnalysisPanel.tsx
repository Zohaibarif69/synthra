'use client';

import React from 'react';
import { Sparkles, CheckCircle } from 'lucide-react';
import { Badge, PrivacyBadge } from '../../components/common/Badge';
import type { ColumnSchema, DatasetProfile } from '../../lib/types';
import { summarizeSchema } from '../../lib/engine/infer';

export function AIAnalysisPanel({ analyzing, schema, profile, rowCount }: {
  analyzing: boolean;
  schema: ColumnSchema[];
  /** Present when the schema was detected from an uploaded file. */
  profile?: DatasetProfile | null;
  rowCount?: number;
}) {
  if (analyzing) {
    return (
      <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={15} className="text-[var(--color-primary)]" />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">Schema Analysis</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border border-[var(--color-primary)] border-t-transparent rounded-full spinning shrink-0" />
          <span className="text-xs text-[var(--color-text-secondary)]">Detecting types, semantic fields and PII in every column...</span>
        </div>
      </div>
    );
  }

  if (!schema.length) return null;

  const detected = !!profile;
  const summary = summarizeSchema(schema, profile);
  const piiColumns = schema.filter(c => summary.piiFields.includes(c.name));

  return (
    <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={15} className="text-[var(--color-primary)]" />
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">Schema Analysis</span>
        {detected ? <><Badge variant="success">Complete</Badge></> : <Badge variant="muted">Manual schema</Badge>}
      </div>
      {profile && (
        <div className="space-y-1.5 mb-3">
          {[
            `${schema.length} columns detected from ${rowCount?.toLocaleString() ?? profile.rowCount.toLocaleString()} rows`,
            'Data types identified from values',
            'Semantic fields identified',
            `${piiColumns.length} privacy-sensitive field${piiColumns.length === 1 ? '' : 's'} flagged`,
          ].map(item => (
            <div key={item} className="flex items-center gap-2">
              <CheckCircle size={13} className="text-[var(--color-success)] shrink-0" />
              <span className="text-xs text-[var(--color-text-secondary)]">{item}</span>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-[var(--color-surface)] rounded p-2">
          <p className="text-[var(--color-text-muted)]">Columns</p>
          <p className="font-semibold text-[var(--color-text-primary)]">{schema.length}</p>
        </div>
        <div className="bg-[var(--color-surface)] rounded p-2">
          <p className="text-[var(--color-text-muted)]">PII fields</p>
          <p className="font-semibold text-[var(--color-error)]">{piiColumns.length}</p>
        </div>
        <div className="bg-[var(--color-surface)] rounded p-2">
          <p className="text-[var(--color-text-muted)]">Numeric</p>
          <p className="font-semibold text-[var(--color-text-primary)]">{summary.numericCount}</p>
        </div>
        <div className="bg-[var(--color-surface)] rounded p-2">
          <p className="text-[var(--color-text-muted)]">Categorical</p>
          <p className="font-semibold text-[var(--color-text-primary)]">{summary.categoricalCount}</p>
        </div>
        <div className="bg-[var(--color-surface)] rounded p-2">
          <p className="text-[var(--color-text-muted)]">Dates</p>
          <p className="font-semibold text-[var(--color-text-primary)]">{summary.dateCount}</p>
        </div>
        <div className="bg-[var(--color-surface)] rounded p-2">
          <p className="text-[var(--color-text-muted)]">Rows analyzed</p>
          <p className="font-semibold text-[var(--color-text-primary)]">{profile ? profile.rowCount.toLocaleString() : '—'}</p>
        </div>
      </div>
      {piiColumns.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">PII fields</p>
          <div className="space-y-1">
            {piiColumns.map(c => (
              <div key={c.name} className="flex items-center justify-between text-xs">
                <span className="font-mono text-[var(--color-text-primary)]">{c.name}</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[var(--color-text-muted)]">{c.semanticType}</span>
                  {c.privacyLevel && <PrivacyBadge level={c.privacyLevel} />}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
