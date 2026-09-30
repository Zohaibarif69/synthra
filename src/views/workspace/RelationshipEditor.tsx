'use client';

import React, { useState } from 'react';
import { Link2, Plus, Trash2 } from 'lucide-react';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import type { Cardinality, ColumnSchema, Relationship, TableSchema } from '../../lib/types';

const NEW_COLUMN = '__new__';
export const selectCls = 'w-full px-2 py-1.5 text-xs border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none';
export const inputCls = 'w-full px-2 py-1.5 text-xs font-mono border border-[var(--color-border)] rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none';

function describe(r: Relationship): string {
  if (r.cardinality === 'N:N') {
    return `${r.parentTable}.${r.parentColumn} ⇄ ${r.childTable}.${r.childColumn} via ${r.joinTable || `${r.parentTable}_${r.childTable}`}`;
  }
  return `${r.childTable}.${r.childColumn} → ${r.parentTable}.${r.parentColumn}`;
}

export function RelationshipEditor({ tables, relationships, onChange }: {
  tables: TableSchema[];
  relationships: Relationship[];
  /** New relationship list, plus tables when a foreign key column was created. */
  onChange: (relationships: Relationship[], tables?: TableSchema[]) => void;
}) {
  const [parentTable, setParentTable] = useState('');
  const [parentColumn, setParentColumn] = useState('');
  const [childTable, setChildTable] = useState('');
  const [childColumn, setChildColumn] = useState('');
  const [cardinality, setCardinality] = useState<Cardinality>('1:N');
  const [minChildren, setMin] = useState('1');
  const [maxChildren, setMax] = useState('5');
  const [error, setError] = useState('');

  const cols = (t: string) => tables.find(x => x.name === t)?.columns ?? [];
  const pt = parentTable || tables[0]?.name || '';
  const ct = childTable || tables.find(t => t.name !== pt)?.name || '';
  const pc = parentColumn || cols(pt).find(c => c.unique)?.name || cols(pt)[0]?.name || '';
  const nn = cardinality === 'N:N';
  const childCols = cols(ct);
  const cc = childColumn || (nn ? childCols.find(c => c.unique)?.name : childCols.find(c => c.name === pc)?.name) || (nn ? childCols[0]?.name : NEW_COLUMN) || '';

  const add = () => {
    setError('');
    if (!pt || !ct) return setError('Pick both tables.');
    if (pt === ct) return setError('Parent and child must be different tables (self-references are not supported).');
    const lo = Number(minChildren), hi = Number(maxChildren);
    const limits = cardinality !== '1:1';
    if (limits && (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 0 || hi < lo)) return setError('Min/max must be whole numbers with min ≤ max.');

    let nextTables: TableSchema[] | undefined;
    let childCol = cc;
    if (!nn && cc === NEW_COLUMN) {
      const parentCol = cols(pt).find(c => c.name === pc)!;
      childCol = childCols.some(c => c.name === pc) ? `${pt}_${pc}` : pc;
      const fk: ColumnSchema = {
        name: childCol, type: parentCol.type, format: parentCol.format, semanticType: 'Identifier',
        nullable: false, unique: cardinality === '1:1', privacyLevel: 'low', privacyTransform: 'preserve',
      };
      nextTables = tables.map(t => (t.name === ct ? { ...t, columns: [...t.columns, fk] } : t));
    }
    const rel: Relationship = {
      id: `rel_${Date.now().toString(36)}`,
      parentTable: pt, parentColumn: pc, childTable: ct, childColumn: childCol, cardinality,
      ...(limits ? { minChildren: lo, maxChildren: hi } : {}),
      ...(nn ? { joinTable: `${pt}_${ct}` } : {}),
    };
    onChange([...relationships, rel], nextTables);
    setChildColumn('');
  };

  const update = (id: string, patch: Partial<Relationship>) => onChange(relationships.map(r => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link2 size={14} className="text-[var(--color-primary)]" />
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Relationships</h3>
      </div>

      {relationships.length > 0 && (
        <div className="space-y-2">
          {relationships.map(r => (
            <div key={r.id} className="flex items-center gap-3 flex-wrap bg-[var(--color-surface-2)] rounded-[var(--radius-md)] px-3 py-2">
              <span className="font-mono text-xs text-[var(--color-text-primary)] flex-1 min-w-48">{describe(r)}</span>
              {r.detected && <Badge variant="info">detected</Badge>}
              <select aria-label={`Cardinality of ${describe(r)}`} value={r.cardinality} onChange={e => update(r.id, { cardinality: e.target.value as Cardinality, ...(e.target.value === 'N:N' && !r.joinTable ? { joinTable: `${r.parentTable}_${r.childTable}` } : {}) })} className={`${selectCls} w-20`}>
                <option value="1:1">1:1</option>
                <option value="1:N">1:N</option>
                <option value="N:N">N:N</option>
              </select>
              {r.cardinality !== '1:1' && (
                <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                  {r.cardinality === 'N:N' ? 'links' : 'children'}
                  <input aria-label="Minimum per parent" type="number" min={0} value={r.minChildren ?? ''} placeholder="min" onChange={e => update(r.id, { minChildren: e.target.value === '' ? undefined : Number(e.target.value) })} className={`${inputCls} w-14`} />
                  –
                  <input aria-label="Maximum per parent" type="number" min={0} value={r.maxChildren ?? ''} placeholder="max" onChange={e => update(r.id, { maxChildren: e.target.value === '' ? undefined : Number(e.target.value) })} className={`${inputCls} w-14`} />
                </span>
              )}
              <button onClick={() => onChange(relationships.filter(x => x.id !== r.id))} className="text-[var(--color-text-muted)] hover:text-[var(--color-error)]" aria-label="Remove relationship">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {tables.length >= 2 ? (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <div>
            <label className="text-xs text-[var(--color-text-muted)] block mb-1">{nn ? 'Table A' : 'Parent table'}</label>
            <select aria-label={nn ? 'Table A' : 'Parent table'} value={pt} onChange={e => { setParentTable(e.target.value); setParentColumn(''); }} className={selectCls}>
              {tables.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)] block mb-1">{nn ? 'A key' : 'Parent key'}</label>
            <select aria-label={nn ? 'A key' : 'Parent key'} value={pc} onChange={e => setParentColumn(e.target.value)} className={selectCls}>
              {cols(pt).map(c => <option key={c.name} value={c.name}>{c.name}{c.unique ? ' (unique)' : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)] block mb-1">Cardinality</label>
            <select aria-label="Cardinality" value={cardinality} onChange={e => { setCardinality(e.target.value as Cardinality); setChildColumn(''); }} className={selectCls}>
              <option value="1:1">1:1</option>
              <option value="1:N">1:N</option>
              <option value="N:N">N:N (join table)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)] block mb-1">{nn ? 'Table B' : 'Child table'}</label>
            <select aria-label={nn ? 'Table B' : 'Child table'} value={ct} onChange={e => { setChildTable(e.target.value); setChildColumn(''); }} className={selectCls}>
              {tables.filter(t => t.name !== pt).map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)] block mb-1">{nn ? 'B key' : 'Foreign key column'}</label>
            <select aria-label={nn ? 'B key' : 'Foreign key column'} value={cc} onChange={e => setChildColumn(e.target.value)} className={selectCls}>
              {!nn && <option value={NEW_COLUMN}>+ new column</option>}
              {childCols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <Button size="sm" icon={<Plus size={13} />} onClick={add}>Add</Button>
          {cardinality !== '1:1' && (
            <div className="col-span-2 md:col-span-6 flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              {nn ? 'Links per' : 'Children per'} {pt || 'parent'} row:
              <input aria-label="Minimum per parent row" type="number" min={0} value={minChildren} onChange={e => setMin(e.target.value)} className={`${inputCls} w-16`} />
              to
              <input aria-label="Maximum per parent row" type="number" min={0} value={maxChildren} onChange={e => setMax(e.target.value)} className={`${inputCls} w-16`} />
              <span className="text-[var(--color-text-muted)]">
                {nn ? `— creates join table ${pt}_${ct}` : `— sets ${ct || 'the child'}’s row count from its parents`}
              </span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-[var(--color-text-muted)]">Add at least two tables to link them.</p>
      )}
      {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
    </div>
  );
}
