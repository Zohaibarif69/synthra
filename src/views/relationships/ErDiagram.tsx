'use client';

import '@xyflow/react/dist/style.css';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, Controls, MarkerType, MiniMap, ReactFlow, applyNodeChanges, useReactFlow,
  type Connection, type Edge, type IsValidConnection, type NodeChange, type OnNodeDrag,
} from '@xyflow/react';
import { AlertTriangle, LayoutGrid, Network } from 'lucide-react';
import Link from 'next/link';
import { Button } from '../../components/common/Button';
import { useRelationalDesign } from '../../lib/designStore';
import { useLatestResult } from '../../lib/resultStore';
import { buildErGraph, layoutErGraph, MORE_COLUMN } from '../../lib/erGraph';
import { estimateRowCounts } from '../../lib/engine/relational';
import type { Relationship } from '../../lib/types';
import { TableNode, type TableNodeType } from './TableNode';
import { RelationshipEdge, type RelationshipEdgeType } from './RelationshipEdge';
import { RelationshipModal, type PendingLink } from './RelationshipModal';
import { migrateLegacyKey } from '../../lib/localStore';

const POSITIONS_KEY = 'synthra:er-positions';
type Positions = Record<string, { x: number; y: number }>;

function loadPositions(): Positions {
  migrateLegacyKey(POSITIONS_KEY);
  try { return JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? '{}') as Positions; } catch { return {}; }
}
function savePositions(p: Positions) {
  try { localStorage.setItem(POSITIONS_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

/** Follows the app's `.dark` class on <html>. */
function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains('dark'));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

const nodeTypes = { table: TableNode };
const edgeTypes = { relationship: RelationshipEdge };
const columnOf = (handle?: string | null) => (handle ?? '').split('::')[0];

export function ErDiagram() {
  const [design, setDesign] = useRelationalDesign();
  const latest = useLatestResult();
  const dark = useIsDark();
  const { fitView } = useReactFlow();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingLink | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<TableNodeType[]>([]);
  const saved = useRef<Positions>({});
  useEffect(() => { saved.current = loadPositions(); }, []);

  const graph = useMemo(() => buildErGraph(design.tables, design.relationships, expanded), [design.tables, design.relationships, expanded]);
  const auto = useMemo(() => layoutErGraph(graph), [graph]);
  const estimates = useMemo(() => estimateRowCounts(design.tables, design.relationships), [design.tables, design.relationships]);

  // Real per-edge integrity from the latest relational generation (Phase 5 validation).
  const relMetrics = latest?.relational?.relationalValidation.metrics?.relationships ?? [];
  const generatedRows = new Map((latest?.relational?.tables ?? []).map(t => [t.tableName, t.rowCount]));
  const orphansFor = (r: Relationship): number | undefined => {
    const ms = relMetrics.filter(m => m.id === r.id || m.id === `${r.id}_a` || m.id === `${r.id}_b`);
    return ms.length ? ms.reduce((a, m) => a + m.orphans + m.nullFks, 0) : undefined;
  };

  const connected = useMemo(() => {
    if (!selected) return null;
    const set = new Set([selected]);
    for (const r of design.relationships) {
      if (r.parentTable === selected) set.add(r.childTable);
      if (r.childTable === selected) set.add(r.parentTable);
    }
    return set;
  }, [selected, design.relationships]);

  const toggleExpand = useCallback((table: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(table)) next.delete(table); else next.add(table);
      return next;
    });
  }, []);

  // Keep React Flow's measured sizes and dragged positions; only data and new tables change here.
  useEffect(() => {
    setNodes(prev => graph.tables.map(t => {
      const old = prev.find(n => n.id === t.name);
      return {
        ...(old ?? {}),
        id: t.name,
        type: 'table' as const,
        position: old?.position ?? saved.current[t.name] ?? auto[t.name] ?? { x: 0, y: 0 },
        data: {
          table: t,
          expanded: expanded.has(t.name),
          dimmed: !!connected && !connected.has(t.name),
          highlighted: selected === t.name,
          rows: generatedRows.get(t.name) ?? estimates[t.name]?.rows,
          onToggleExpand: toggleExpand,
        },
      };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, auto, connected, selected, estimates, latest, toggleExpand]);

  const edges: RelationshipEdgeType[] = graph.edges.map(e => {
    const r = e.relationship;
    const dimmed = !!selected && r.parentTable !== selected && r.childTable !== selected;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: 'relationship',
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--color-text-muted)' },
      data: {
        cardinality: r.cardinality,
        range: r.cardinality !== '1:1' && r.maxChildren !== undefined ? `(${r.minChildren ?? 0}–${r.maxChildren})` : undefined,
        orphans: orphansFor(r),
        dimmed,
        onEdit: setEditingId,
      },
    };
  });

  const onNodesChange = useCallback((changes: NodeChange<TableNodeType>[]) => setNodes(ns => applyNodeChanges(changes, ns)), []);

  const onNodeDragStop: OnNodeDrag<TableNodeType> = useCallback((_e, _n, dragged) => {
    for (const n of dragged) saved.current[n.id] = n.position;
    savePositions(saved.current);
  }, []);

  const isValidConnection: IsValidConnection<Edge> = useCallback(c =>
    c.source !== c.target && columnOf(c.sourceHandle) !== MORE_COLUMN && columnOf(c.targetHandle) !== MORE_COLUMN, []);

  const onConnect = useCallback((c: Connection) => {
    setPending({ parentTable: c.source, parentColumn: columnOf(c.sourceHandle), childTable: c.target, childColumn: columnOf(c.targetHandle) });
  }, []);

  const autoLayout = () => {
    saved.current = {};
    savePositions({});
    setNodes(ns => ns.map(n => ({ ...n, position: auto[n.id] ?? n.position })));
    setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
  };

  const saveRelationship = (r: Relationship) => {
    setDesign(d => ({
      ...d,
      relationships: d.relationships.some(x => x.id === r.id) ? d.relationships.map(x => (x.id === r.id ? r : x)) : [...d.relationships, r],
    }));
    setPending(null);
    setEditingId(null);
  };

  const deleteRelationship = (id: string) => {
    setDesign(d => ({ ...d, relationships: d.relationships.filter(r => r.id !== id) }));
    setEditingId(null);
  };

  const editing = editingId ? design.relationships.find(r => r.id === editingId) ?? null : null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)] flex items-center gap-2"><Network size={18} className="text-[var(--color-primary)]" /> Relationships</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {design.tables.length} table{design.tables.length === 1 ? '' : 's'} · {design.relationships.length} relationship{design.relationships.length === 1 ? '' : 's'}
            {latest?.relational ? ' · integrity from the last generation' : ''}
          </p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
            <span className="flex items-center gap-1"><span className="px-1 rounded text-[10px] font-semibold" style={{ color: 'var(--color-pk)', background: 'var(--color-pk-bg)' }}>PK</span> primary key</span>
            <span className="flex items-center gap-1"><span className="px-1 rounded text-[10px] font-semibold" style={{ color: 'var(--color-fk)', background: 'var(--color-fk-bg)' }}>FK</span> foreign key</span>
            <span className="text-[var(--color-text-muted)]">Drag from a column’s right dot to another column to link them</span>
          </div>
          <Button variant="outline" size="sm" icon={<LayoutGrid size={13} />} onClick={autoLayout}>Auto layout</Button>
          <Link href="/workspace?type=relational" className="text-xs text-[var(--color-primary)] hover:underline">Open in Workspace →</Link>
        </div>
      </div>

      {graph.problems.length > 0 && (
        <div className="px-6 py-2 bg-[var(--color-warning-bg)] text-xs text-[var(--color-warning)] flex items-start gap-1.5">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          {graph.problems.length} relationship{graph.problems.length === 1 ? '' : 's'} could not be drawn: {graph.problems.join('; ')}
        </div>
      )}

      <div className="er-canvas flex-1 min-h-[520px]" style={{ background: 'var(--color-bg)' }}>
        <ReactFlow<TableNodeType, RelationshipEdgeType>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={(_e, n) => setSelected(s => (s === n.id ? null : n.id))}
          onPaneClick={() => setSelected(null)}
          onEdgeClick={(_e, e) => setEditingId(e.id)}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          colorMode={dark ? 'dark' : 'light'}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--color-border-strong)" gap={20} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor="var(--color-primary-light)"
            nodeStrokeColor="var(--color-primary)"
            maskColor={dark ? 'rgba(15, 23, 42, 0.6)' : 'rgba(241, 245, 249, 0.7)'}
          />
        </ReactFlow>
      </div>

      {(pending || editing) && (
        <RelationshipModal
          key={editing?.id ?? `${pending?.parentTable}.${pending?.parentColumn}-${pending?.childTable}.${pending?.childColumn}`}
          tables={design.tables}
          relationships={design.relationships}
          pending={pending}
          editing={editing}
          onSave={saveRelationship}
          onDelete={deleteRelationship}
          onClose={() => { setPending(null); setEditingId(null); }}
        />
      )}
    </div>
  );
}
