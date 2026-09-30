'use client';

import React, { useState } from 'react';
import { ArrowLeftRight, Trash2 } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import type { Cardinality, Relationship, TableSchema } from '../../lib/types';

export interface PendingLink {
  parentTable: string;
  parentColumn: string;
  childTable: string;
  childColumn: string;
}

const inputCls = 'w-16 px-2 py-1.5 text-xs font-mono border border-[var(--color-border)] rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none';
const selectCls = 'w-full px-3 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none';

function typeOf(tables: TableSchema[], table: string, column: string) {
  return tables.find(t => t.name === table)?.columns.find(c => c.name === column)?.type;
}

/** Create a relationship from a dragged connection, or edit/delete an existing one. */
export function RelationshipModal({ tables, relationships, pending, editing, onSave, onDelete, onClose }: {
  tables: TableSchema[];
  relationships: Relationship[];
  pending?: PendingLink | null;
  editing?: Relationship | null;
  onSave: (r: Relationship) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}) {
  const [link, setLink] = useState<PendingLink>(() => editing ?? pending!);
  const [cardinality, setCardinality] = useState<Cardinality>(editing?.cardinality ?? '1:N');
  const [min, setMin] = useState(String(editing?.minChildren ?? 1));
  const [max, setMax] = useState(String(editing?.maxChildren ?? 5));

  const pType = typeOf(tables, link.parentTable, link.parentColumn);
  const cType = typeOf(tables, link.childTable, link.childColumn);
  const numeric = (t?: string) => t === 'integer' || t === 'float';
  const problems: string[] = [];
  if (link.parentTable === link.childTable) problems.push('A table cannot reference itself.');
  if (pType && cType && pType !== cType && !(numeric(pType) && numeric(cType))) {
    problems.push(`Types don't match: ${link.parentTable}.${link.parentColumn} is ${pType}, ${link.childTable}.${link.childColumn} is ${cType}.`);
  }
  const duplicate = relationships.find(r => r.id !== editing?.id && r.childTable === link.childTable && r.childColumn === link.childColumn && r.cardinality !== 'N:N');
  if (duplicate && cardinality !== 'N:N') problems.push(`${link.childTable}.${link.childColumn} already references ${duplicate.parentTable}.${duplicate.parentColumn}.`);
  const lo = Number(min), hi = Number(max);
  const limits = cardinality !== '1:1';
  if (limits && (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 0 || hi < lo)) problems.push('Min/max must be whole numbers with min ≤ max.');

  const save = () => {
    if (problems.length) return;
    onSave({
      id: editing?.id ?? `rel_${Date.now().toString(36)}`,
      parentTable: link.parentTable,
      parentColumn: link.parentColumn,
      childTable: link.childTable,
      childColumn: link.childColumn,
      cardinality,
      ...(limits ? { minChildren: lo, maxChildren: hi } : {}),
      ...(cardinality === 'N:N' ? { joinTable: editing?.joinTable ?? `${link.parentTable}_${link.childTable}` } : {}),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Edit Relationship' : 'New Relationship'}
      footer={
        <>
          {editing && onDelete && (
            <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={() => onDelete(editing.id)} className="mr-auto">Delete</Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={problems.length > 0}>{editing ? 'Save' : 'Create'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <div className="flex-1 bg-[var(--color-surface-2)] rounded-[var(--radius-md)] px-3 py-2">
            <p className="text-[11px] text-[var(--color-text-muted)]">{cardinality === 'N:N' ? 'Table A' : 'Parent (primary key)'}</p>
            <p className="font-mono text-xs text-[var(--color-text-primary)]">{link.parentTable}.{link.parentColumn} <span className="text-[var(--color-text-muted)]">({pType})</span></p>
          </div>
          {!editing && (
            <button
              type="button"
              onClick={() => setLink({ parentTable: link.childTable, parentColumn: link.childColumn, childTable: link.parentTable, childColumn: link.parentColumn })}
              className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
              title="Swap parent and child"
              aria-label="Swap parent and child"
            >
              <ArrowLeftRight size={15} />
            </button>
          )}
          <div className="flex-1 bg-[var(--color-surface-2)] rounded-[var(--radius-md)] px-3 py-2">
            <p className="text-[11px] text-[var(--color-text-muted)]">{cardinality === 'N:N' ? 'Table B' : 'Child (foreign key)'}</p>
            <p className="font-mono text-xs text-[var(--color-text-primary)]">{link.childTable}.{link.childColumn} <span className="text-[var(--color-text-muted)]">({cType})</span></p>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-[var(--color-text-secondary)] block mb-1.5">Cardinality</label>
          <select aria-label="Cardinality" value={cardinality} onChange={e => setCardinality(e.target.value as Cardinality)} className={selectCls}>
            <option value="1:1">1:1 — each parent has at most one child</option>
            <option value="1:N">1:N — each parent has several children</option>
            <option value="N:N">N:N — many-to-many through a join table</option>
          </select>
        </div>
        {limits && (
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            {cardinality === 'N:N' ? 'Links' : 'Children'} per {link.parentTable} row:
            <input aria-label="Minimum per parent row" type="number" min={0} value={min} onChange={e => setMin(e.target.value)} className={inputCls} />
            to
            <input aria-label="Maximum per parent row" type="number" min={0} value={max} onChange={e => setMax(e.target.value)} className={inputCls} />
          </div>
        )}
        {problems.map(p => <p key={p} className="text-xs text-[var(--color-error)]">{p}</p>)}
      </div>
    </Modal>
  );
}
