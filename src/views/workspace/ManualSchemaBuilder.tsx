'use client';

import React, { useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/common/Button';
import type { ColumnSchema, PrivacyLevel } from '../../lib/types';
import { DATA_TYPES, SEMANTIC_TYPES } from '../../lib/constants';
import { defaultPrivacy } from '../../lib/engine/infer';
import { allowedTransforms } from '../../lib/engine/privacy';

const DEFAULT_COLUMNS: ColumnSchema[] = [
  { name: 'id', type: 'integer', semanticType: 'Identifier', nullable: false, unique: true, privacyLevel: 'medium', privacyTransform: 'preserve' },
  { name: 'name', type: 'string', semanticType: 'Person Name', nullable: true, unique: false, privacyLevel: 'high', privacyTransform: 'synthetic' },
  { name: 'email', type: 'email', semanticType: 'Email', nullable: true, unique: true, privacyLevel: 'high', privacyTransform: 'synthetic' },
];

export function ManualSchemaBuilder({ schema, onChange }: { schema: ColumnSchema[]; onChange: (s: ColumnSchema[]) => void }) {
  // Start from a small example schema when nothing has been defined or detected yet.
  useEffect(() => {
    if (!schema.length) onChange(DEFAULT_COLUMNS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cols = schema;

  const addRow = () => onChange([...cols, { name: `column_${cols.length + 1}`, type: 'string', nullable: true, unique: false, privacyLevel: 'low', privacyTransform: 'preserve' }]);
  const removeRow = (i: number) => onChange(cols.filter((_, ci) => ci !== i));
  const updateRow = (i: number, patch: Partial<ColumnSchema>) => {
    onChange(cols.map((c, ci) => {
      if (ci !== i) return c;
      const next = { ...c, ...patch };
      // A changed type invalidates the detected format (e.g. a date pattern).
      if (patch.type && patch.type !== c.type) delete next.format;
      // e.g. 'noise' only applies to numbers.
      if (next.privacyTransform && !allowedTransforms(next).includes(next.privacyTransform)) next.privacyTransform = 'preserve';
      return next;
    }));
  };
  const updateSemantic = (i: number, semanticType: string) => {
    const p = defaultPrivacy(cols[i].name, semanticType);
    updateRow(i, { semanticType: semanticType || undefined, privacyLevel: p.level, privacyTransform: p.transform });
  };

  return (
    <div>
      <datalist id="semantic-types">
        {SEMANTIC_TYPES.map(s => <option key={s} value={s} />)}
      </datalist>
      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] mb-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--color-surface-2)] text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
              <th className="text-left px-3 py-2.5 font-medium">Column Name</th>
              <th className="text-left px-3 py-2.5 font-medium">Data Type</th>
              <th className="text-left px-3 py-2.5 font-medium">Semantic</th>
              <th className="text-left px-3 py-2.5 font-medium">Privacy</th>
              <th className="text-left px-3 py-2.5 font-medium">Nullable</th>
              <th className="text-left px-3 py-2.5 font-medium">Unique</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {cols.map((col, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-3 py-2">
                  <input
                    aria-label={`Column ${i + 1} name`}
                    value={col.name}
                    onChange={e => updateRow(i, { name: e.target.value })}
                    className="w-full px-2 py-1 text-xs font-mono border border-[var(--color-border)] rounded bg-transparent focus:border-[var(--color-primary)] outline-none"
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    aria-label={`${col.name || `Column ${i + 1}`} data type`}
                    value={col.type}
                    onChange={e => updateRow(i, { type: e.target.value as ColumnSchema['type'] })}
                    className="w-full px-2 py-1 text-xs border border-[var(--color-border)] rounded bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none"
                  >
                    {DATA_TYPES.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    aria-label={`${col.name || `Column ${i + 1}`} semantic type`}
                    value={col.semanticType ?? ''}
                    list="semantic-types"
                    onChange={e => updateSemantic(i, e.target.value)}
                    placeholder="Optional"
                    className="w-full px-2 py-1 text-xs border border-[var(--color-border)] rounded bg-transparent focus:border-[var(--color-primary)] outline-none text-[var(--color-text-secondary)]"
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    aria-label={`${col.name || `Column ${i + 1}`} privacy level`}
                    value={col.privacyLevel ?? 'low'}
                    onChange={e => updateRow(i, { privacyLevel: e.target.value as PrivacyLevel })}
                    className="w-full px-2 py-1 text-xs border border-[var(--color-border)] rounded bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </td>
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" checked={col.nullable} onChange={e => updateRow(i, { nullable: e.target.checked })}
                    aria-label={`${col.name || `Column ${i + 1}`} nullable`} className="accent-[var(--color-primary)]" />
                </td>
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" checked={col.unique ?? false} onChange={e => updateRow(i, { unique: e.target.checked })}
                    aria-label={`${col.name || `Column ${i + 1}`} unique`} className="accent-[var(--color-primary)]" />
                </td>
                <td className="px-3 py-2">
                  <button onClick={() => removeRow(i)} aria-label={`Remove column ${col.name || i + 1}`} className="text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button variant="outline" size="sm" icon={<Plus size={14} />} onClick={addRow}>Add Column</Button>
    </div>
  );
}
