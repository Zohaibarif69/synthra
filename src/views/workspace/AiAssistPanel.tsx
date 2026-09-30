'use client';

import React, { useMemo, useState } from 'react';
import { Sparkles, FlaskConical, X } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { AiBadge, AiUnavailable } from '../../components/common/AiBadge';
import type { AiEdgeCase, ColumnProfile, ColumnSchema, DatasetProfile, GenerationConfig } from '../../lib/types';
import { aiPost, fetchColumnValues, useAiStatus } from '../../lib/ai/client';
import { AI_EDGE_RATE } from '../../lib/engine/tabular';

const BATCH = 50;
const TEXT_NAME_RE = /(desc|description|review|note|comment|message|bio|summary|feedback|product|item|title|remarks|content)/i;

function profileFor(col: ColumnSchema, profile?: DatasetProfile | null): ColumnProfile | undefined {
  return profile?.columns.find(p => p.name === (col.sourceColumn ?? col.name));
}

/** Short, PII-free description of what was learned about a column, for the edge-case prompt. */
function summarize(col: ColumnSchema, p?: ColumnProfile): string | undefined {
  if (!p) return undefined;
  const parts: string[] = [];
  if (typeof p.min === 'number' && typeof p.max === 'number') parts.push(`range ${p.min}–${p.max}`);
  else if (p.min !== undefined && p.max !== undefined) parts.push(`${p.min} → ${p.max}`);
  if (p.nullRate) parts.push(`${(p.nullRate * 100).toFixed(1)}% missing`);
  if (col.privacyLevel !== 'high' && (p.kind === 'categorical' || p.kind === 'boolean') && p.topValues?.length) {
    parts.push(`values like ${p.topValues.slice(0, 3).map(t => t.value).join(', ')}`);
  }
  return parts.join(', ') || undefined;
}

export function AiAssistPanel({ schema, profile, config, onChange }: {
  schema: ColumnSchema[];
  profile?: DatasetProfile | null;
  config: GenerationConfig;
  onChange: (c: GenerationConfig) => void;
}) {
  const status = useAiStatus();
  const candidates = useMemo(() => schema.filter(c => {
    if (c.type !== 'string' || c.privacyLevel === 'high' || c.semanticType === 'Identifier') return false;
    const p = profileFor(c, profile);
    if (p && p.kind !== 'text') return false; // learned categories already give a realistic distribution
    return c.semanticType === 'Description' || c.semanticType === 'Other' || TEXT_NAME_RE.test(c.name);
  }), [schema, profile]);

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [contentBusy, setContentBusy] = useState(false);
  const [contentNote, setContentNote] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AiEdgeCase[] | null>(null);
  const [edgeBusy, setEdgeBusy] = useState(false);
  const [edgeNote, setEdgeNote] = useState<string | null>(null);

  const pools = config.aiContent ?? {};
  const ticked = new Set((config.aiEdgeCases ?? []).map(e => e.id));

  const fetchContent = async () => {
    setContentBusy(true);
    setContentNote(null);
    const next = { ...pools };
    const failures: string[] = [];
    for (const name of picked) {
      const col = schema.find(c => c.name === name);
      if (!col) continue;
      const p = profileFor(col, profile);
      const [table, column] = name.includes('.') ? [name.split('.')[0], name.split('.').slice(1).join('.')] : [undefined, name];
      const res = await fetchColumnValues({
        column, table, semanticType: col.semanticType,
        otherColumns: schema.map(c => c.name).filter(n => n !== name).slice(0, 60),
        examples: (p?.topValues ?? []).slice(0, 5).map(t => t.value),
        locale: config.locale, avgLength: p?.avgLength, count: BATCH,
      });
      if (res.ok) next[name] = res.data.values;
      else failures.push(`${name}: ${res.message}`);
    }
    onChange({ ...config, aiContent: next });
    setContentNote(failures.length ? failures.join(' · ') : null);
    setContentBusy(false);
  };

  const suggestEdges = async () => {
    setEdgeBusy(true);
    setEdgeNote(null);
    const res = await aiPost<{ edgeCases: AiEdgeCase[] }>('edge-cases', {
      locale: config.locale,
      columns: schema.slice(0, 200).map(c => ({ name: c.name, type: c.type, semanticType: c.semanticType, summary: summarize(c, profileFor(c, profile)) })),
    });
    if (res.ok) setSuggestions(res.data.edgeCases);
    else setEdgeNote(res.message);
    setEdgeBusy(false);
  };

  const toggleEdge = (e: AiEdgeCase) => {
    const list = config.aiEdgeCases ?? [];
    onChange({ ...config, aiEdgeCases: ticked.has(e.id) ? list.filter(x => x.id !== e.id) : [...list, e] });
  };

  const unavailable = status && !status.configured;
  // Without a key the card has nothing to offer; the built-in generator already covers everything.
  if (unavailable) return null;

  return (
    <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5 space-y-5">
      <div className="flex items-center gap-2">
        <Sparkles size={15} className="text-[var(--color-primary)]" />
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">AI Assistance</h3>
      </div>

      {/* ── Free-text content (only when the schema has free-text columns) ── */}
      {(candidates.length > 0 || Object.keys(pools).length > 0) && (
      <div className="space-y-2">
        <p className="text-xs font-medium text-[var(--color-text-secondary)]">Realistic text</p>
        {!candidates.length ? null : (
          <>
            <div className="flex flex-wrap gap-2">
              {candidates.map(c => (
                <label key={c.name} className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] border border-[var(--color-border)] rounded px-2 py-1 cursor-pointer">
                  <input type="checkbox" className="accent-[var(--color-primary)]" checked={picked.has(c.name)}
                    onChange={e => setPicked(s => { const n = new Set(s); if (e.target.checked) n.add(c.name); else n.delete(c.name); return n; })} />
                  <span className="font-mono">{c.name}</span>
                  {pools[c.name] && <AiBadge title={`${pools[c.name].length} AI values in use`} />}
                </label>
              ))}
            </div>
            <Button size="sm" variant="outline" loading={contentBusy} disabled={!picked.size || !!unavailable} onClick={fetchContent}>Fetch AI values</Button>
          </>
        )}
        {contentNote && <AiUnavailable message="Built-in text used for some columns" detail={contentNote} />}
        {Object.entries(pools).map(([name, values]) => (
          <div key={name} className="flex items-start justify-between gap-2 bg-[var(--color-surface-2)] rounded-[var(--radius-md)] px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs"><span className="font-mono text-[var(--color-text-primary)]">{name}</span> <AiBadge /> <span className="text-[var(--color-text-muted)]">{values.length} values, sampled per row</span></p>
              <p className="text-[11px] text-[var(--color-text-muted)] truncate">e.g. {values.slice(0, 3).map(v => `“${v}”`).join(', ')}</p>
            </div>
            <button onClick={() => { const n = { ...pools }; delete n[name]; onChange({ ...config, aiContent: n }); }}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-error)]" aria-label={`Stop using AI values for ${name}`}><X size={13} /></button>
          </div>
        ))}
      </div>
      )}

      {/* ── Edge cases ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5"><FlaskConical size={13} /> Data-specific edge cases</p>
          <Button size="sm" variant="outline" loading={edgeBusy} disabled={!schema.length || !!unavailable} onClick={suggestEdges}>Suggest edge cases</Button>
        </div>
        {edgeNote && <AiUnavailable message="Couldn't reach AI. Try again." detail={edgeNote} />}
        {(suggestions ?? config.aiEdgeCases ?? []).length > 0 && (
          <div className="space-y-1.5">
            {(suggestions ?? config.aiEdgeCases ?? []).map(e => (
              <label key={e.id} className="flex items-start gap-2 text-xs cursor-pointer">
                <input type="checkbox" className="mt-0.5 accent-[var(--color-primary)]" checked={ticked.has(e.id)} onChange={() => toggleEdge(e)} />
                <span className="min-w-0">
                  <span className="text-[var(--color-text-primary)] font-medium">{e.title}</span> <AiBadge />
                  <span className="block text-[var(--color-text-muted)]">
                    <span className="font-mono">{e.column}</span>
                    {e.compareWith ? ` placed ${e.compareWith.op === '<' ? 'before' : 'after'} ${e.compareWith.column}` : ` = ${e.values.map(v => JSON.stringify(v)).join(' | ')}`}
                    {' — '}{e.reason}
                  </span>
                </span>
              </label>
            ))}
            <p className="text-[11px] text-[var(--color-text-muted)]">Ticked cases are injected into {(AI_EDGE_RATE * 100).toFixed(0)}% of rows each. Values that don’t fit the column type are skipped; business rules still win.</p>
          </div>
        )}
      </div>
    </section>
  );
}
