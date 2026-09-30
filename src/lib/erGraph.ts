// Pure graph model for the ER diagram: which columns each table node shows, which handles it
// renders, and which handles each relationship edge connects. Kept free of React so it can be tested.

import dagre from 'dagre';
import type { ColumnSchema, Relationship, TableSchema } from './types';

export const MAX_VISIBLE_COLUMNS = 6;
export const NODE_WIDTH = 260;
export const NODE_HEADER_HEIGHT = 48;
export const NODE_ROW_HEIGHT = 26;
/** Handle used when an edge's column is hidden behind "+N more". */
export const MORE_COLUMN = '__more';

export function handleId(column: string, side: 'source' | 'target'): string {
  return `${column}::${side}`;
}

export interface ErColumn {
  name: string;
  type: ColumnSchema['type'];
  isPk: boolean;
  isFk: boolean;
}

export interface ErTable {
  name: string;
  columnCount: number;
  /** Columns rendered as rows (and handles). */
  visible: ErColumn[];
  hiddenCount: number;
  width: number;
  height: number;
}

export interface ErEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  relationship: Relationship;
}

export interface ErGraph {
  tables: ErTable[];
  edges: ErEdge[];
  /** Relationships that cannot be drawn (missing table/column), in plain language. */
  problems: string[];
}

/** Handle ids a table node renders; every edge must connect to one of these. */
export function renderedHandles(t: ErTable): Set<string> {
  const ids = new Set<string>();
  for (const c of t.visible) { ids.add(handleId(c.name, 'source')); ids.add(handleId(c.name, 'target')); }
  if (t.hiddenCount > 0) { ids.add(handleId(MORE_COLUMN, 'source')); ids.add(handleId(MORE_COLUMN, 'target')); }
  return ids;
}

export function buildErGraph(tables: TableSchema[], relationships: Relationship[], expanded: ReadonlySet<string> = new Set()): ErGraph {
  const problems: string[] = [];
  const pk = new Set<string>();
  const fk = new Set<string>();
  for (const r of relationships) {
    pk.add(`${r.parentTable}.${r.parentColumn}`);
    // In N:N both ends are keys of their own tables; the foreign keys live in the join table.
    if (r.cardinality === 'N:N') pk.add(`${r.childTable}.${r.childColumn}`);
    else fk.add(`${r.childTable}.${r.childColumn}`);
  }

  const erTables: ErTable[] = tables.map(t => {
    const cols: ErColumn[] = t.columns.map(c => ({
      name: c.name,
      type: c.type,
      isPk: pk.has(`${t.name}.${c.name}`) || (!!c.unique && c.semanticType === 'Identifier' && !fk.has(`${t.name}.${c.name}`)),
      isFk: fk.has(`${t.name}.${c.name}`),
    }));
    const showAll = expanded.has(t.name) || cols.length <= MAX_VISIBLE_COLUMNS;
    const visible = showAll ? cols : cols.slice(0, MAX_VISIBLE_COLUMNS);
    const hiddenCount = cols.length - visible.length;
    return {
      name: t.name,
      columnCount: cols.length,
      visible,
      hiddenCount,
      width: NODE_WIDTH,
      height: NODE_HEADER_HEIGHT + (visible.length + (hiddenCount > 0 ? 1 : 0)) * NODE_ROW_HEIGHT + 8,
    };
  });

  const edges: ErEdge[] = [];
  for (const r of relationships) {
    const parent = erTables.find(t => t.name === r.parentTable);
    const child = erTables.find(t => t.name === r.childTable);
    const parentDef = tables.find(t => t.name === r.parentTable);
    const childDef = tables.find(t => t.name === r.childTable);
    if (!parent || !child || !parentDef || !childDef) {
      problems.push(`${r.childTable}.${r.childColumn} → ${r.parentTable}.${r.parentColumn}: table not found`);
      continue;
    }
    if (!parentDef.columns.some(c => c.name === r.parentColumn) || !childDef.columns.some(c => c.name === r.childColumn)) {
      problems.push(`${r.childTable}.${r.childColumn} → ${r.parentTable}.${r.parentColumn}: column not found`);
      continue;
    }
    const pVisible = parent.visible.some(c => c.name === r.parentColumn);
    const cVisible = child.visible.some(c => c.name === r.childColumn);
    edges.push({
      id: r.id,
      source: r.parentTable,
      target: r.childTable,
      sourceHandle: handleId(pVisible ? r.parentColumn : MORE_COLUMN, 'source'),
      targetHandle: handleId(cVisible ? r.childColumn : MORE_COLUMN, 'target'),
      relationship: r,
    });
  }
  return { tables: erTables, edges, problems };
}

/** Left-to-right layout by dependency (parents left, children right). Returns top-left positions. */
export function layoutErGraph(graph: ErGraph): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 110, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const t of graph.tables) g.setNode(t.name, { width: t.width, height: t.height });
  for (const e of graph.edges) if (e.source !== e.target) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const out: Record<string, { x: number; y: number }> = {};
  for (const t of graph.tables) {
    const n = g.node(t.name);
    // dagre returns centres; React Flow positions are top-left corners.
    out[t.name] = { x: n.x - t.width / 2, y: n.y - t.height / 2 };
  }
  return out;
}
