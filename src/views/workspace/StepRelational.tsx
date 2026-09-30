'use client';

import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronRight, Play, Plus, Upload } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { useToast } from '../../components/common/Toast';
import type { AiRelationshipSuggestion, AiSchemaResult, TableSchema } from '../../lib/types';
import { AiBadge, AiUnavailable } from '../../components/common/AiBadge';
import { aiPost, fetchAiStatus, schemaRequestTable } from '../../lib/ai/client';
import type { RelationalDesign, TableSource } from '../../lib/designStore';
import { analyzeSchema, uploadDataset } from '../../lib/api';
import { getDataset } from '../../lib/engine/store';
import { designProblems, detectRelationships, estimateRowCounts } from '../../lib/engine/relational';
import { EXAMPLE_RELATIONAL } from '../../lib/mockData';
import { RelationalVisualizer } from './RelationalVisualizer';
import { RelationshipEditor } from './RelationshipEditor';
import { RulesEditor } from './RulesEditor';
import { TableCard } from './TableCard';

export type { RelationalDesign, TableSource } from '../../lib/designStore';

function tableNameFromFile(fileName: string, taken: Set<string>): string {
  const base = fileName.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'table';
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
  return name;
}

export function StepRelational({ design, onChange, onNext, library }: {
  design: RelationalDesign;
  onChange: (d: RelationalDesign) => void;
  onNext: () => void;
  /** Save/load schema controls. */
  library?: React.ReactNode;
}) {
  const { tables, relationships, rules, sources } = design;
  const [uploading, setUploading] = useState(false);
  const [aiRels, setAiRels] = useState<{ status: 'idle' | 'loading' | 'done' | 'unavailable'; message?: string; model?: string; list: AiRelationshipSuggestion[] }>({ status: 'idle', list: [] });
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const problems = useMemo(() => designProblems(tables, relationships, rules), [tables, relationships, rules]);
  const estimates = useMemo(() => estimateRowCounts(tables, relationships), [tables, relationships]);

  const set = (patch: Partial<RelationalDesign>) => onChange({ ...design, ...patch });

  const addTable = () => {
    const taken = new Set(tables.map(t => t.name));
    let n = tables.length + 1;
    while (taken.has(`table_${n}`)) n++;
    set({
      tables: [...tables, {
        name: `table_${n}`, rowCount: 100,
        columns: [{ name: 'id', type: 'integer', semanticType: 'Identifier', nullable: false, unique: true, privacyLevel: 'medium', privacyTransform: 'preserve' }],
      }],
    });
  };

  const renameTable = (oldName: string, newName: string) => {
    const rn = (n: string) => (n === oldName ? newName : n);
    const nextSources = { ...sources };
    if (sources[oldName]) { nextSources[newName] = sources[oldName]; delete nextSources[oldName]; }
    onChange({
      tables: tables.map(t => (t.name === oldName ? { ...t, name: newName } : t)),
      relationships: relationships.map(r => ({ ...r, parentTable: rn(r.parentTable), childTable: rn(r.childTable) })),
      rules: rules.map(r => ({ ...r, parentTable: rn(r.parentTable), childTable: rn(r.childTable) })),
      sources: nextSources,
    });
  };

  const removeTable = (name: string) => {
    const nextSources = { ...sources };
    delete nextSources[name];
    onChange({
      tables: tables.filter(t => t.name !== name),
      relationships: relationships.filter(r => r.parentTable !== name && r.childTable !== name),
      rules: rules.filter(r => r.parentTable !== name && r.childTable !== name),
      sources: nextSources,
    });
  };

  const handleFiles = async (files: FileList) => {
    setUploading(true);
    const taken = new Set(tables.map(t => t.name));
    const newTables: TableSchema[] = [];
    const newSources: Record<string, TableSource> = { ...sources };
    for (const file of Array.from(files)) {
      try {
        const up = await uploadDataset(file);
        const analysis = await analyzeSchema(up.fileId);
        const name = tableNameFromFile(file.name, taken);
        taken.add(name);
        newTables.push({ name, columns: analysis.columns, rowCount: up.rowCount });
        newSources[name] = { fileId: up.fileId, fileName: file.name, profile: analysis.profile ?? null };
      } catch (err) {
        toast.error(`${file.name}: ${(err as Error).message}`);
      }
    }
    const allTables = [...tables, ...newTables];
    // Detect foreign keys across every table that came from a file.
    const uploaded = allTables.filter(t => newSources[t.name]);
    const detected = detectRelationships(uploaded.map(t => {
      const ds = getDataset(newSources[t.name].fileId);
      return { name: t.name, columns: t.columns, values: (c: string) => ds?.rows.map(r => r[c] ?? null) ?? [] };
    }));
    const known = new Set(relationships.map(r => `${r.childTable}.${r.childColumn}`));
    const added = detected.filter(r => !known.has(`${r.childTable}.${r.childColumn}`));
    const nextRels = [...relationships, ...added];
    onChange({ tables: allTables, relationships: nextRels, rules, sources: newSources });
    setUploading(false);
    if (newTables.length) {
      toast.success(`Added ${newTables.length} table${newTables.length === 1 ? '' : 's'}; detected ${added.length} foreign key${added.length === 1 ? '' : 's'}`);
    }

    // Second opinion from the model on relationships between the uploaded tables.
    if (uploaded.length < 2) return;
    const status = await fetchAiStatus();
    if (!status.configured) {
      setAiRels({ status: 'idle', list: [] });
      return;
    }
    setAiRels({ status: 'loading', list: [] });
    const res = await aiPost<AiSchemaResult>('schema', {
      tables: uploaded.slice(0, 20).map(t => schemaRequestTable(t.name, getDataset(newSources[t.name].fileId)!, t.columns)),
    });
    if (!res.ok) {
      setAiRels({ status: 'unavailable', message: res.message, list: [] });
      return;
    }
    const linked = new Set(nextRels.map(r => `${r.childTable}.${r.childColumn}`));
    setAiRels({ status: 'done', model: res.model, list: res.data.relationships.filter(r => !linked.has(`${r.childTable}.${r.childColumn}`)) });
  };

  const addAiRelationship = (s: AiRelationshipSuggestion) => {
    set({
      relationships: [...relationships, {
        id: `ai_${s.parentTable}_${s.parentColumn}_${s.childTable}_${s.childColumn}`,
        parentTable: s.parentTable, parentColumn: s.parentColumn, childTable: s.childTable, childColumn: s.childColumn,
        cardinality: s.cardinality,
        ...(s.cardinality === 'N:N' ? { joinTable: `${s.parentTable}_${s.childTable}`, minChildren: 1, maxChildren: 3 } : {}),
      }],
    });
    setAiRels(a => ({ ...a, list: a.list.filter(x => x !== s) }));
  };

  const loadExample = () => {
    onChange({
      tables: EXAMPLE_RELATIONAL.tables.map(t => ({ ...t, columns: t.columns.map(c => ({ ...c })) })),
      relationships: EXAMPLE_RELATIONAL.relationships.map(r => ({ ...r })),
      rules: EXAMPLE_RELATIONAL.rules.map(r => ({ ...r, terms: [...r.terms] })),
      sources: {},
    });
  };

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">Relational Dataset</h2>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">Define tables, link them, and keep totals consistent.</p>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" icon={<Plus size={14} />} onClick={addTable}>Add Table</Button>
          <Button variant="outline" size="sm" icon={<Upload size={14} />} loading={uploading} onClick={() => inputRef.current?.click()}>
            Upload CSVs
          </Button>
          <input ref={inputRef} type="file" multiple accept=".csv,.tsv,.txt,.json,.jsonl,.ndjson" className="hidden"
            onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }} />
          <Button variant="ghost" size="sm" icon={<Play size={14} />} onClick={loadExample}>
            Load example (customers → orders → order_items)
          </Button>
        </div>
        {library && <div className="mt-3">{library}</div>}
      </div>

      {tables.length > 0 && (
        <>
          <RelationalVisualizer tables={tables} relationships={relationships} />

          <div className="space-y-2">
            {tables.map((t, i) => (
              <TableCard
                key={i}
                table={t}
                estimate={estimates[t.name]}
                sourceName={sources[t.name]?.fileName}
                onChange={next => set({ tables: tables.map(x => (x.name === t.name ? next : x)) })}
                onRename={n => renameTable(t.name, n)}
                onRemove={() => removeTable(t.name)}
              />
            ))}
          </div>

          <RelationshipEditor
            tables={tables}
            relationships={relationships}
            onChange={(rels, nextTables) => set({ relationships: rels, ...(nextTables ? { tables: nextTables } : {}) })}
          />
          {aiRels.status !== 'idle' && (
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4 space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">AI-suggested relationships</h3>
                {aiRels.status === 'done' && <AiBadge title={`Suggestions from ${aiRels.model}`} />}
              </div>
              {aiRels.status === 'loading' && <p className="text-xs text-[var(--color-text-secondary)]">Analysing relationships…</p>}
              {aiRels.status === 'unavailable' && <AiUnavailable message="Couldn't reach AI." detail={aiRels.message} />}
              {aiRels.status === 'done' && !aiRels.list.length && <p className="text-xs text-[var(--color-text-muted)]">No additional relationships found.</p>}
              {aiRels.list.map(s => (
                <div key={`${s.childTable}.${s.childColumn}`} className="flex items-center justify-between gap-3 bg-[var(--color-surface-2)] rounded-[var(--radius-md)] px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-[var(--color-text-primary)]">{s.childTable}.{s.childColumn} → {s.parentTable}.{s.parentColumn} <span className="text-[var(--color-text-muted)]">[{s.cardinality}]</span></p>
                    <p className="text-[11px] text-[var(--color-text-muted)]">{s.reason}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => addAiRelationship(s)}>Add</Button>
                </div>
              ))}
            </div>
          )}
          <RulesEditor tables={tables} relationships={relationships} rules={rules} onChange={r => set({ rules: r })} />
        </>
      )}

      {tables.length > 0 && problems.length > 0 && (
        <div className="bg-[var(--color-warning-bg)] border border-[var(--color-warning)]/30 rounded-[var(--radius-lg)] p-3 space-y-1">
          {problems.map(p => (
            <p key={p} className="flex items-start gap-1.5 text-xs text-[var(--color-warning)]"><AlertTriangle size={12} className="shrink-0 mt-0.5" /> {p}</p>
          ))}
        </div>
      )}

      <Button iconRight={<ChevronRight size={15} />} onClick={onNext} disabled={problems.length > 0}>Continue to Configuration</Button>
    </div>
  );
}
