'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, AlertTriangle } from 'lucide-react';
import type { Cell, ColumnSchema, DatasetProfile, GenerationConfig } from '../../lib/types';
import type { RelationalDesign } from '../../lib/designStore';
import { FLAG } from '../../lib/engine/tabular';
import { forbiddenValues, runRelationalPipeline, runTabularPipeline } from '../../lib/engine/pipeline';
import { columnValues } from '../../lib/engine/profile';
import { getDataset } from '../../lib/engine/store';

const PREVIEW_ROWS = 20;
const DEBOUNCE_MS = 300;
/** Used until the user sets a seed, so the preview is stable while they edit. */
const PREVIEW_SEED = 1;

const FLAG_LABEL: Record<number, string> = {
  [FLAG.NULL]: 'missing value', [FLAG.OUTLIER]: 'outlier', [FLAG.BOUNDARY]: 'boundary value', [FLAG.RARE]: 'rare category',
  [FLAG.LONG_TEXT]: 'long text', [FLAG.DUPLICATE]: 'near-duplicate', [FLAG.AI_EDGE]: 'AI edge case',
};

interface PreviewTable {
  name: string;
  columns: string[];
  rows: Cell[][];
  flags: number[][];
  totalRows: number;
}

export function LivePreview({ config, schema, profile, fileId, design }: {
  config: GenerationConfig;
  /** Tabular: the schema being configured. */
  schema?: ColumnSchema[];
  profile?: DatasetProfile | null;
  fileId?: string | null;
  /** Relational: the design; the preview caps parent tables to a few rows. */
  design?: RelationalDesign;
}) {
  const [tables, setTables] = useState<PreviewTable[]>([]);
  const [active, setActive] = useState(0);
  const [ms, setMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runId = useRef(0);

  // Upload values that high-privacy columns must avoid (same protection as the full run).
  const forbidden = useMemo(() => {
    if (!schema || !fileId) return undefined;
    const ds = getDataset(fileId);
    if (!ds) return undefined;
    const cols: Record<string, Cell[]> = {};
    for (const c of schema) if (c.sourceColumn && c.privacyLevel === 'high') cols[c.sourceColumn] = columnValues(ds.rows, c.sourceColumn);
    return forbiddenValues(schema, cols);
  }, [schema, fileId]);

  const key = JSON.stringify({ config, schema, design: design && { t: design.tables, r: design.relationships, u: design.rules } });

  useEffect(() => {
    const id = ++runId.current;
    setBusy(true);
    const timer = setTimeout(async () => {
      const started = performance.now();
      const seeded = { ...config, seed: config.seed ?? PREVIEW_SEED };
      try {
        let out: PreviewTable[];
        if (design) {
          if (!design.tables.length) throw new Error('Add at least one table to see a preview.');
          const small = design.tables.map(t => ({ ...t, rowCount: Math.min(t.rowCount ?? PREVIEW_ROWS, 5) }));
          const profiles = Object.fromEntries(Object.entries(design.sources).map(([k, s]) => [k, s.profile]));
          const { gen } = await runRelationalPipeline({ tables: small, relationships: design.relationships, rules: design.rules, config: seeded, profiles });
          out = gen.order.map(name => {
            const s = gen.tables.get(name)!;
            return pick(name, s.schema, s.table.data, s.table.flags, s.table.rowCount);
          });
        } else {
          if (!schema?.length) throw new Error('Define at least one column to see a preview.');
          const { table, schema: outSchema } = await runTabularPipeline({
            schema, config: { ...seeded, rowCount: PREVIEW_ROWS }, profile, forbidden,
          });
          out = [pick('dataset', outSchema, table.data, table.flags, table.rowCount)];
        }
        if (id !== runId.current) return;
        setTables(out);
        setActive(a => Math.min(a, out.length - 1));
        setError(null);
        setMs(Math.round(performance.now() - started));
      } catch (e) {
        if (id !== runId.current) return;
        setError((e as Error).message || 'Preview failed.');
      } finally {
        if (id === runId.current) setBusy(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, forbidden]);

  const t = tables[active];

  return (
    <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5 space-y-3" aria-label="Live preview">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Eye size={15} className="text-[var(--color-primary)]" />
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Live Preview</h3>
          <span className="text-xs text-[var(--color-text-muted)]" aria-live="polite">
            {busy ? 'Updating…' : ms !== null ? `${t?.totalRows ?? 0} rows in ${ms} ms` : ''}
          </span>
        </div>
        {tables.length > 1 && (
          <select value={active} onChange={e => setActive(Number(e.target.value))} aria-label="Preview table"
            className="px-2 py-1 text-xs border border-[var(--color-border)] rounded bg-[var(--color-surface)] text-[var(--color-text-primary)]">
            {tables.map((x, i) => <option key={x.name} value={i}>{x.name} ({x.totalRows} rows)</option>)}
          </select>
        )}
      </div>
      <p className="text-[11px] text-[var(--color-text-muted)]">
        Sample rows with your current settings. Highlighted cells are edge cases.
      </p>
      {error && (
        <p className="flex items-start gap-1.5 text-xs text-[var(--color-warning)]"><AlertTriangle size={12} className="shrink-0 mt-0.5" /> {error}</p>
      )}
      {t && !error && (
        <div className={`overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] max-h-96 transition-opacity ${busy ? 'opacity-60' : ''}`}>
          <table className="w-full text-xs">
            <thead className="sticky top-0">
              <tr className="bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
                {t.columns.map(c => <th key={c} scope="col" className="text-left px-3 py-2 font-medium whitespace-nowrap">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((row, i) => (
                <tr key={i} className="border-t border-[var(--color-border)]">
                  {row.map((v, c) => {
                    const f = t.flags[i][c];
                    const text = v === null ? '—' : String(v);
                    return (
                      <td key={c} title={f ? `Injected: ${FLAG_LABEL[f]}` : undefined}
                        className={`px-3 py-1.5 font-mono whitespace-nowrap max-w-[14rem] truncate ${f ? 'bg-[var(--color-warning-bg)]' : ''} ${v === null ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-secondary)]'}`}>
                        {text.length > 60 ? `${text.slice(0, 60)}…` : text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function pick(name: string, schema: ColumnSchema[], data: Cell[][], flags: Uint8Array[], rowCount: number): PreviewTable {
  const n = Math.min(PREVIEW_ROWS, rowCount);
  return {
    name,
    columns: schema.map(c => c.name),
    rows: Array.from({ length: n }, (_, i) => data.map(col => col[i])),
    flags: Array.from({ length: n }, (_, i) => flags.map(f => f[i])),
    totalRows: rowCount,
  };
}
