'use client';

import React, { useState } from 'react';
import { ListChecks, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/common/Button';
import type { ColumnRule, ColumnSchema } from '../../lib/types';
import { describeColumnRule, ruleProblem } from '../../lib/engine/rules';

const selectCls = 'w-full px-2 py-1.5 text-xs border border-[var(--color-border)] rounded-[var(--radius-md)] bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none';
const inputCls = 'w-full px-2 py-1.5 text-xs font-mono border border-[var(--color-border)] rounded-[var(--radius-md)] bg-transparent text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none';

type Kind = ColumnRule['kind'];
const KIND_LABELS: Record<Kind, string> = { range: 'Min / max', allowed: 'Allowed values', pattern: 'Regex pattern', compare: 'Compare with column' };

export function BusinessRulesEditor({ schema, rules, onChange }: {
  schema: ColumnSchema[];
  rules: ColumnRule[];
  onChange: (rules: ColumnRule[]) => void;
}) {
  const [column, setColumn] = useState('');
  const [kind, setKind] = useState<Kind>('range');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [values, setValues] = useState('');
  const [regex, setRegex] = useState('');
  const [op, setOp] = useState<'<' | '<=' | '>' | '>=' | '!='>('<');
  const [other, setOther] = useState('');
  const [error, setError] = useState('');

  const col = column || schema[0]?.name || '';
  const colDef = schema.find(c => c.name === col);
  const isDate = colDef?.type === 'date' || colDef?.type === 'datetime';
  const otherCol = other || schema.find(c => c.name !== col)?.name || '';

  const add = () => {
    setError('');
    const id = `cr_${Date.now().toString(36)}`;
    const num = (s: string) => (s.trim() === '' ? undefined : isDate ? s.trim() : Number(s));
    const rule: ColumnRule =
      kind === 'range' ? { id, kind, column: col, min: num(min), max: num(max) }
      : kind === 'allowed' ? { id, kind, column: col, values: values.split(',').map(v => v.trim()).filter(Boolean) }
      : kind === 'pattern' ? { id, kind, column: col, regex }
      : { id, kind, column: col, op, other: otherCol };
    const problem = ruleProblem(rule, schema);
    if (problem) return setError(problem);
    onChange([...rules, rule]);
    setMin(''); setMax(''); setValues(''); setRegex('');
  };

  return (
    <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5 space-y-3">
      <div className="flex items-center gap-2">
        <ListChecks size={15} className="text-[var(--color-primary)]" />
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Business Rules</h3>
        <span className="text-xs text-[var(--color-text-muted)]">Every generated row follows these rules.</span>
      </div>

      {rules.length > 0 && (
        <div className="space-y-1.5">
          {rules.map(r => {
            const problem = ruleProblem(r, schema);
            return (
              <div key={r.id} className="flex items-center justify-between gap-2 bg-[var(--color-surface-2)] rounded-[var(--radius-md)] px-3 py-1.5">
                <span className="font-mono text-xs text-[var(--color-text-primary)]">{describeColumnRule(r)}</span>
                {problem && <span className="text-[11px] text-[var(--color-warning)]">{problem}</span>}
                <button onClick={() => onChange(rules.filter(x => x.id !== r.id))} className="text-[var(--color-text-muted)] hover:text-[var(--color-error)]" aria-label="Remove rule">
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {schema.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
          <div>
            <label className="text-xs text-[var(--color-text-muted)] block mb-1">Column</label>
            <select aria-label="Column" value={col} onChange={e => setColumn(e.target.value)} className={selectCls}>
              {schema.map(c => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)] block mb-1">Rule</label>
            <select aria-label="Rule" value={kind} onChange={e => setKind(e.target.value as Kind)} className={selectCls}>
              {(Object.keys(KIND_LABELS) as Kind[]).map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
          </div>
          {kind === 'range' && (
            <div className="grid grid-cols-2 gap-1">
              <div>
                <label className="text-xs text-[var(--color-text-muted)] block mb-1">Min</label>
                <input aria-label="Min" value={min} onChange={e => setMin(e.target.value)} placeholder={isDate ? 'YYYY-MM-DD' : '—'} className={inputCls} />
              </div>
              <div>
                <label className="text-xs text-[var(--color-text-muted)] block mb-1">Max</label>
                <input aria-label="Max" value={max} onChange={e => setMax(e.target.value)} placeholder={isDate ? 'YYYY-MM-DD' : '—'} className={inputCls} />
              </div>
            </div>
          )}
          {kind === 'allowed' && (
            <div>
              <label className="text-xs text-[var(--color-text-muted)] block mb-1">Values (comma separated)</label>
              <input aria-label="Values (comma separated)" value={values} onChange={e => setValues(e.target.value)} placeholder="Active, Pending, Closed" className={inputCls} />
            </div>
          )}
          {kind === 'pattern' && (
            <div>
              <label className="text-xs text-[var(--color-text-muted)] block mb-1">Regex</label>
              <input aria-label="Regex" value={regex} onChange={e => setRegex(e.target.value)} placeholder="^[A-Z]{3}-\d{4}$" className={inputCls} />
            </div>
          )}
          {kind === 'compare' && (
            <div className="grid grid-cols-[3.5rem_1fr] gap-1">
              <div>
                <label className="text-xs text-[var(--color-text-muted)] block mb-1">Op</label>
                <select aria-label="Op" value={op} onChange={e => setOp(e.target.value as typeof op)} className={selectCls}>
                  {(['<', '<=', '>', '>=', '!='] as const).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--color-text-muted)] block mb-1">Column B</label>
                <select aria-label="Column B" value={otherCol} onChange={e => setOther(e.target.value)} className={selectCls}>
                  {schema.filter(c => c.name !== col).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </div>
            </div>
          )}
          <Button size="sm" icon={<Plus size={13} />} onClick={add}>Add Rule</Button>
        </div>
      )}
      {error && <p className="text-xs text-[var(--color-error)]">{error}</p>}
    </section>
  );
}
