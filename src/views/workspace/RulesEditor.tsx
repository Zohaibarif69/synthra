'use client';

import React, { useState } from 'react';
import { Calculator, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/common/Button';
import type { ConsistencyRule, Relationship, RuleAggregate, TableSchema } from '../../lib/types';
import { selectCls } from './RelationshipEditor';

const NONE = '';
const isNum = (t: string) => t === 'integer' || t === 'float';

export function describeRule(r: ConsistencyRule): string {
  const expr = r.aggregate === 'COUNT' ? `COUNT(${r.childTable})` : `${r.aggregate}(${r.terms.map(t => `${r.childTable}.${t}`).join(' × ')})`;
  return `${r.parentTable}.${r.parentColumn} = ${expr}`;
}

export function RulesEditor({ tables, relationships, rules, onChange }: {
  tables: TableSchema[];
  relationships: Relationship[];
  rules: ConsistencyRule[];
  onChange: (rules: ConsistencyRule[]) => void;
}) {
  const links = relationships.filter(r => r.cardinality !== 'N:N');
  const [linkId, setLinkId] = useState('');
  const [parentColumn, setParentColumn] = useState('');
  const [aggregate, setAggregate] = useState<RuleAggregate>('SUM');
  const [termA, setTermA] = useState('');
  const [termB, setTermB] = useState(NONE);
  const [error, setError] = useState('');

  const link = links.find(l => l.id === linkId) ?? links[0];
  const numCols = (t?: string) => tables.find(x => x.name === t)?.columns.filter(c => isNum(c.type)) ?? [];
  const parentCols = numCols(link?.parentTable).filter(c => c.name !== link?.parentColumn);
  const childCols = numCols(link?.childTable).filter(c => c.name !== link?.childColumn);
  const pc = parentColumn || parentCols[0]?.name || '';
  const a = termA || childCols[0]?.name || '';

  const add = () => {
    setError('');
    if (!link) return setError('Add a 1:1 or 1:N relationship first.');
    if (!pc) return setError(`${link.parentTable} has no number column to compute.`);
    if (aggregate !== 'COUNT' && !a) return setError(`${link.childTable} has no number column to aggregate.`);
    if (rules.some(r => r.parentTable === link.parentTable && r.parentColumn === pc)) return setError(`${link.parentTable}.${pc} already has a rule.`);
    onChange([...rules, {
      id: `rule_${Date.now().toString(36)}`,
      parentTable: link.parentTable, parentColumn: pc, childTable: link.childTable, aggregate,
      terms: aggregate === 'COUNT' ? [] : [a, ...(termB ? [termB] : [])],
    }]);
  };

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Calculator size={14} className="text-[var(--color-primary)]" />
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Consistency Rules</h3>
        <span className="text-xs text-[var(--color-text-muted)]">The parent value is computed from its child rows.</span>
      </div>

      {rules.length > 0 && (
        <div className="space-y-2">
          {rules.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-3 bg-[var(--color-surface-2)] rounded-[var(--radius-md)] px-3 py-2">
              <span className="font-mono text-xs text-[var(--color-text-primary)]">{describeRule(r)}</span>
              <button onClick={() => onChange(rules.filter(x => x.id !== r.id))} className="text-[var(--color-text-muted)] hover:text-[var(--color-error)]" aria-label="Remove rule">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {links.length ? (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <div className="col-span-2">
            <label className="text-xs text-[var(--color-text-muted)] block mb-1">Relationship</label>
            <select aria-label="Relationship" value={link?.id} onChange={e => { setLinkId(e.target.value); setParentColumn(''); setTermA(''); setTermB(NONE); }} className={selectCls}>
              {links.map(l => <option key={l.id} value={l.id}>{l.parentTable} ← {l.childTable}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)] block mb-1">{link?.parentTable} column =</label>
            <select aria-label="column =" value={pc} onChange={e => setParentColumn(e.target.value)} className={selectCls}>
              {parentCols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)] block mb-1">Aggregate</label>
            <select aria-label="Aggregate" value={aggregate} onChange={e => setAggregate(e.target.value as RuleAggregate)} className={selectCls}>
              {(['SUM', 'COUNT', 'AVG', 'MIN', 'MAX'] as const).map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          {aggregate !== 'COUNT' ? (
            <div className="grid grid-cols-2 gap-1 col-span-2 md:col-span-1">
              <div>
                <label className="text-xs text-[var(--color-text-muted)] block mb-1">{link?.childTable}</label>
                <select aria-label={`${link?.childTable} column`} value={a} onChange={e => setTermA(e.target.value)} className={selectCls}>
                  {childCols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--color-text-muted)] block mb-1">× (optional)</label>
                <select aria-label="× (optional)" value={termB} onChange={e => setTermB(e.target.value)} className={selectCls}>
                  <option value={NONE}>—</option>
                  {childCols.filter(c => c.name !== a).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </div>
            </div>
          ) : <div />}
          <Button size="sm" icon={<Plus size={13} />} onClick={add}>Add Rule</Button>
        </div>
      ) : (
        <p className="text-xs text-[var(--color-text-muted)]">Add a relationship first, e.g. orders.total = SUM(order_items.quantity × unit_price).</p>
      )}
      {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
    </div>
  );
}
