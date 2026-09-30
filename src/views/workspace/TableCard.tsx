'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Database, FileText, Trash2 } from 'lucide-react';
import type { ColumnSchema, TableSchema } from '../../lib/types';
import { ManualSchemaBuilder } from './ManualSchemaBuilder';
import { inputCls } from './RelationshipEditor';

export function TableCard({ table, estimate, sourceName, onChange, onRename, onRemove }: {
  table: TableSchema;
  estimate?: { rows: number; derived: boolean };
  sourceName?: string;
  onChange: (t: TableSchema) => void;
  onRename: (newName: string) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const derived = estimate?.derived;

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)]">
      <div className="flex items-center gap-3 p-3 flex-wrap">
        <button onClick={() => setOpen(o => !o)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]" aria-label={open ? 'Collapse' : 'Expand'}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <Database size={14} className="text-[var(--color-primary)]" />
        <input value={table.name} onChange={e => onRename(e.target.value.replace(/\s+/g, '_'))} className={`${inputCls} w-44 font-semibold`} aria-label="Table name" />
        <span className="text-xs text-[var(--color-text-muted)]">{table.columns.length} columns</span>
        {sourceName && (
          <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]"><FileText size={12} /> {sourceName}</span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs text-[var(--color-text-muted)]">Rows</label>
          {derived ? (
            <span className="text-xs font-mono text-[var(--color-text-secondary)]" title="Set by the relationship's min/max children per parent">
              ~{estimate!.rows.toLocaleString()} (from relationship)
            </span>
          ) : (
            <input aria-label="Rows"
              type="number"
              min={1}
              value={table.rowCount ?? ''}
              onChange={e => onChange({ ...table, rowCount: Math.max(1, Math.min(1_000_000, parseInt(e.target.value) || 1)) })}
              className={`${inputCls} w-24`}
            />
          )}
          <button onClick={onRemove} className="text-[var(--color-text-muted)] hover:text-[var(--color-error)]" aria-label="Remove table">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {open && (
        <div className="px-3 pb-3">
          <ManualSchemaBuilder schema={table.columns} onChange={(columns: ColumnSchema[]) => onChange({ ...table, columns })} />
        </div>
      )}
    </div>
  );
}
