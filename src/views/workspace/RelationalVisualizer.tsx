'use client';

import React, { useMemo } from 'react';
import type { Relationship, TableSchema } from '../../lib/types';
import { estimateRowCounts, expandRelationships, topoOrder } from '../../lib/engine/relational';
import { RelationshipNode, NODE_HEADER, NODE_ROW, NODE_WIDTH } from './RelationshipNode';

const GAP_X = 72;
const GAP_Y = 24;
const PAD = 16;

export function RelationalVisualizer({ tables, relationships }: { tables: TableSchema[]; relationships: Relationship[] }) {
  const layout = useMemo(() => {
    const design = expandRelationships(tables, relationships);
    let order: string[];
    let error: string | null = null;
    try {
      order = topoOrder(design.tables, design.relationships);
    } catch (e) {
      error = (e as Error).message;
      order = design.tables.map(t => t.name);
    }
    // Column (level) = 1 + deepest parent, so parents sit left of their children.
    const level = new Map<string, number>();
    for (const name of order) {
      const parents = design.relationships.filter(r => r.childTable === name && r.parentTable !== name).map(r => level.get(r.parentTable) ?? 0);
      level.set(name, error ? 0 : parents.length ? Math.max(...parents) + 1 : 0);
    }
    const pos = new Map<string, { x: number; y: number }>();
    const colHeights: number[] = [];
    for (const name of order) {
      const t = design.tables.find(x => x.name === name)!;
      const lv = error ? order.indexOf(name) : level.get(name)!;
      const y = colHeights[lv] ?? PAD;
      pos.set(name, { x: PAD + lv * (NODE_WIDTH + GAP_X), y });
      colHeights[lv] = y + NODE_HEADER + t.columns.length * NODE_ROW + 8 + GAP_Y;
    }
    const width = PAD * 2 + Math.max(1, colHeights.length) * (NODE_WIDTH + GAP_X) - GAP_X;
    const height = Math.max(160, ...colHeights.filter(Boolean));
    return { design, pos, width, height, error, estimates: estimateRowCounts(tables, relationships) };
  }, [tables, relationships]);

  const { design, pos, width, height, error, estimates } = layout;
  const joinNames = new Set(design.joins.map(j => j.table));
  const totalRows = Object.values(estimates).reduce((a, e) => a + e.rows, 0);
  const rowY = (table: string, column: string) => {
    const t = design.tables.find(x => x.name === table);
    const i = Math.max(0, t?.columns.findIndex(c => c.name === column) ?? 0);
    return (pos.get(table)?.y ?? 0) + NODE_HEADER + 4 + i * NODE_ROW + NODE_ROW / 2;
  };

  return (
    <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Relationship Diagram</h3>
        <span className="text-xs text-[var(--color-text-muted)]">
          {design.tables.length} tables · {design.relationships.length} relationships · ~{totalRows.toLocaleString()} total rows
        </span>
      </div>
      {error && <p className="text-xs text-[var(--color-error)] mb-2">{error}</p>}
      <div className="overflow-auto">
        <div className="relative" style={{ width, height }}>
          <svg className="absolute inset-0 pointer-events-none" width={width} height={height}>
            {design.relationships.map(r => {
              const p = pos.get(r.parentTable), c = pos.get(r.childTable);
              if (!p || !c) return null;
              const x1 = p.x + NODE_WIDTH, y1 = rowY(r.parentTable, r.parentColumn);
              const x2 = c.x, y2 = rowY(r.childTable, r.childColumn);
              const back = x2 <= x1;
              const d = back
                ? `M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`
                : `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;
              const label = r.cardinality + (r.maxChildren !== undefined ? ` (${r.minChildren ?? 0}–${r.maxChildren})` : '');
              return (
                <g key={r.id}>
                  <path d={d} fill="none" stroke="var(--color-border-strong)" strokeWidth={1.5} strokeDasharray="4 2" />
                  <circle cx={x2} cy={y2} r={2.5} fill="var(--color-border-strong)" />
                  <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} fontSize={10} fill="var(--color-text-muted)" textAnchor="middle">{label}</text>
                </g>
              );
            })}
          </svg>
          {design.tables.map(t => {
            const p = pos.get(t.name);
            if (!p) return null;
            return (
              <RelationshipNode
                key={t.name}
                table={t}
                x={p.x}
                y={p.y}
                rows={estimates[t.name]?.rows}
                derived={estimates[t.name]?.derived}
                isJoin={joinNames.has(t.name)}
                keys={new Set(design.relationships.filter(r => r.parentTable === t.name).map(r => r.parentColumn))}
                foreignKeys={new Set(design.relationships.filter(r => r.childTable === t.name).map(r => r.childColumn))}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
