'use client';

import React from 'react';
import { Badge, PrivacyBadge } from '../../components/common/Badge';
import type { ColumnSchema } from '../../lib/types';

export function SchemaTable({ columns }: { columns: ColumnSchema[]; onEdit?: (i: number, col: ColumnSchema) => void }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[var(--color-surface-2)] text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
            <th className="text-left px-4 py-3 font-medium">Field</th>
            <th className="text-left px-3 py-3 font-medium">Type</th>
            <th className="text-left px-3 py-3 font-medium hidden md:table-cell">Semantic</th>
            <th className="text-left px-3 py-3 font-medium hidden lg:table-cell">Nullable</th>
            <th className="text-left px-3 py-3 font-medium hidden lg:table-cell">Unique</th>
            <th className="text-left px-3 py-3 font-medium hidden xl:table-cell">Pattern</th>
            <th className="text-left px-3 py-3 font-medium">Privacy</th>
          </tr>
        </thead>
        <tbody>
          {columns.map(col => (
            <tr key={col.name} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)] transition-colors">
              <td className="px-4 py-3">
                <span className="font-mono text-xs font-medium text-[var(--color-text-primary)]">{col.name}</span>
              </td>
              <td className="px-3 py-3">
                <Badge variant="muted">{col.type}</Badge>
              </td>
              <td className="px-3 py-3 hidden md:table-cell">
                <span className="text-xs text-[var(--color-text-secondary)]">{col.semanticType ?? '—'}</span>
              </td>
              <td className="px-3 py-3 hidden lg:table-cell">
                <span className={`text-xs ${col.nullable ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-secondary)]'}`}>{col.nullable ? 'Yes' : 'No'}</span>
              </td>
              <td className="px-3 py-3 hidden lg:table-cell">
                <span className="text-xs text-[var(--color-text-secondary)]">{col.unique ? 'Yes' : 'No'}</span>
              </td>
              <td className="px-3 py-3 hidden xl:table-cell">
                <span className="text-xs text-[var(--color-text-muted)]">{col.detectedPattern ?? '—'}</span>
              </td>
              <td className="px-3 py-3">
                {col.privacyLevel && <PrivacyBadge level={col.privacyLevel} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
