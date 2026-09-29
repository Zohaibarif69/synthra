// Relational generation: tables are generated in dependency order with the tabular generator,
// then foreign keys are set to real parent keys (respecting cardinality) and rule columns
// (e.g. orders.total = SUM(order_items.quantity * order_items.unit_price)) are computed from children.

import type {
  Cell, ColumnSchema, ConsistencyRule, DatasetProfile, ForbiddenLog, GenerationConfig, Relationship, TableSchema,
} from '../types';
import { generateTabular, type GeneratedTable } from './tabular';
import { createRng, type Rng } from './random';
import { normalizeName, toNumber } from './infer';

export class RelationalDesignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelationalDesignError';
  }
}

export interface JoinSpec {
  table: string;
  /** Relationship whose parent drives link counts (the N:N "A" side). */
  relA: Relationship;
  relB: Relationship;
  sourceId: string;
}

export interface ExpandedDesign {
  tables: TableSchema[];
  relationships: Relationship[];
  joins: JoinSpec[];
}

const isNumeric = (t: ColumnSchema['type']) => t === 'integer' || t === 'float';

// ─── Design helpers ──────────────────────────────────────────────────────────

/** Replaces every N:N relationship with a join table and two 1:N relationships. */
export function expandRelationships(tables: TableSchema[], relationships: Relationship[]): ExpandedDesign {
  const outTables = tables.map(t => ({ ...t, columns: [...t.columns] }));
  const outRels: Relationship[] = [];
  const joins: JoinSpec[] = [];
  for (const rel of relationships) {
    if (rel.cardinality !== 'N:N') { outRels.push(rel); continue; }
    const a = tables.find(t => t.name === rel.parentTable);
    const b = tables.find(t => t.name === rel.childTable);
    const ka = a?.columns.find(c => c.name === rel.parentColumn);
    const kb = b?.columns.find(c => c.name === rel.childColumn);
    if (!a || !b || !ka || !kb) continue;
    const name = rel.joinTable || `${a.name}_${b.name}`;
    const colA = ka.name === kb.name ? `${a.name}_${ka.name}` : ka.name;
    const colB = ka.name === kb.name ? `${b.name}_${kb.name}` : kb.name;
    const fk = (c: ColumnSchema, n: string): ColumnSchema => ({
      name: n, type: c.type, format: c.format, semanticType: 'Identifier', nullable: false, unique: false, privacyLevel: 'low', privacyTransform: 'preserve',
    });
    outTables.push({ name, columns: [fk(ka, colA), fk(kb, colB)] });
    const relA: Relationship = { id: `${rel.id}_a`, parentTable: a.name, parentColumn: ka.name, childTable: name, childColumn: colA, cardinality: '1:N', minChildren: rel.minChildren, maxChildren: rel.maxChildren };
    const relB: Relationship = { id: `${rel.id}_b`, parentTable: b.name, parentColumn: kb.name, childTable: name, childColumn: colB, cardinality: '1:N' };
    outRels.push(relA, relB);
    joins.push({ table: name, relA, relB, sourceId: rel.id });
  }
  return { tables: outTables, relationships: outRels, joins };
}

/** Parent-before-child order. Throws RelationalDesignError naming the cycle if there is one. */
export function topoOrder(tables: TableSchema[], relationships: Relationship[]): string[] {
  const names = tables.map(t => t.name);
  const parents = new Map<string, Set<string>>(names.map(n => [n, new Set()]));
  for (const r of relationships) {
    if (r.parentTable === r.childTable) {
      throw new RelationalDesignError(`Cycle detected: ${r.childTable}.${r.childColumn} references its own table. Self-references are not supported.`);
    }
    parents.get(r.childTable)?.add(r.parentTable);
  }
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (n: string) => {
    if (state.get(n) === 'done') return;
    if (state.get(n) === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(n)), n];
      throw new RelationalDesignError(`Cycle detected: ${cycle.join(' → ')}. Relationships must not loop back to an earlier table.`);
    }
    state.set(n, 'visiting');
    stack.push(n);
    for (const p of parents.get(n) ?? []) visit(p);
    stack.pop();
    state.set(n, 'done');
    order.push(n);
  };
  names.forEach(visit);
  return order;
}

/** Problems that block generation, in plain language. */
export function designProblems(tables: TableSchema[], relationships: Relationship[], rules: ConsistencyRule[]): string[] {
  const problems: string[] = [];
  if (!tables.length) problems.push('Add at least one table.');
  const names = tables.map(t => t.name.trim());
  if (names.some(n => !n)) problems.push('Every table needs a name.');
  const dupTable = names.find((n, i) => n && names.indexOf(n) !== i);
  if (dupTable) problems.push(`Table names must be unique ("${dupTable}").`);
  for (const t of tables) {
    if (!t.columns.length) problems.push(`Table "${t.name}" has no columns.`);
    const cols = t.columns.map(c => c.name.trim());
    if (cols.some(c => !c)) problems.push(`Table "${t.name}" has a column without a name.`);
    const dup = cols.find((c, i) => c && cols.indexOf(c) !== i);
    if (dup) problems.push(`Table "${t.name}" has two columns named "${dup}".`);
  }
  const col = (t: string, c: string) => tables.find(x => x.name === t)?.columns.find(x => x.name === c);
  for (const r of relationships) {
    if (!col(r.parentTable, r.parentColumn)) problems.push(`Relationship: ${r.parentTable}.${r.parentColumn} does not exist.`);
    if (!col(r.childTable, r.childColumn)) problems.push(`Relationship: ${r.childTable}.${r.childColumn} does not exist.`);
    if (r.minChildren !== undefined && r.maxChildren !== undefined && r.minChildren > r.maxChildren) {
      problems.push(`Relationship ${r.parentTable} → ${r.childTable}: min (${r.minChildren}) is greater than max (${r.maxChildren}).`);
    }
  }
  const drivers = new Map<string, number>();
  for (const r of relationships) if (r.cardinality !== 'N:N' && r.maxChildren !== undefined) drivers.set(r.childTable, (drivers.get(r.childTable) ?? 0) + 1);
  for (const [t, n] of drivers) if (n > 1) problems.push(`Table "${t}" has ${n} relationships with min/max children; only one can set its row count.`);
  for (const rule of rules) {
    const parent = col(rule.parentTable, rule.parentColumn);
    if (!parent) problems.push(`Rule: ${rule.parentTable}.${rule.parentColumn} does not exist.`);
    else if (!isNumeric(parent.type)) problems.push(`Rule: ${rule.parentTable}.${rule.parentColumn} must be a number column.`);
    if (!relationships.some(r => r.parentTable === rule.parentTable && r.childTable === rule.childTable && r.cardinality !== 'N:N')) {
      problems.push(`Rule on ${rule.parentTable}.${rule.parentColumn}: no 1:1 or 1:N relationship links ${rule.childTable} to ${rule.parentTable}.`);
    }
    if (rule.aggregate !== 'COUNT') {
      if (!rule.terms.length) problems.push(`Rule on ${rule.parentTable}.${rule.parentColumn}: pick at least one ${rule.childTable} column.`);
      for (const term of rule.terms) {
        const c = col(rule.childTable, term);
        if (!c) problems.push(`Rule: ${rule.childTable}.${term} does not exist.`);
        else if (!isNumeric(c.type)) problems.push(`Rule: ${rule.childTable}.${term} must be a number column.`);
      }
    }
  }
  if (!problems.length) {
    try {
      const expanded = expandRelationships(tables, relationships);
      topoOrder(expanded.tables, expanded.relationships);
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  return problems;
}

// ─── Foreign key detection for uploaded tables ───────────────────────────────

export interface DetectionTable {
  name: string;
  columns: ColumnSchema[];
  values: (column: string) => Cell[];
}

const ID_NAME_RE = /(^id$|_id$|id$|_key$|_code$|_no$|_number$|_ref$)/i;

function singular(name: string): string {
  const n = normalizeName(name);
  if (n.endsWith('ies')) return n.slice(0, -3) + 'y';
  if (n.endsWith('ses')) return n.slice(0, -2);
  if (n.endsWith('s')) return n.slice(0, -1);
  return n;
}

/**
 * A column B.x is a foreign key to A.y when y is unique in A and either every value of B.x exists
 * in A.y (and x looks like an identifier), or x is named after A's key (customer_id → customers.customer_id).
 */
export function detectRelationships(tables: DetectionTable[]): Relationship[] {
  const out: Relationship[] = [];
  for (const b of tables) {
    for (const bc of b.columns) {
      const bValues = b.values(bc.name).filter((v): v is Exclude<Cell, null> => v !== null).map(String);
      if (!bValues.length) continue;
      let best: { rel: Relationship; score: number } | null = null;
      for (const a of tables) {
        if (a === b) continue;
        for (const ac of a.columns) {
          if (!ac.unique) continue;
          const aSet = new Set(a.values(ac.name).filter(v => v !== null).map(String));
          const contained = bValues.every(v => aSet.has(v));
          const bn = normalizeName(bc.name), an = normalizeName(ac.name);
          // The name must point at A: customers.customer_id ← orders.customer_id, or customers.id ← orders.customer_id.
          const owner = singular(a.name);
          const named = (bn === an && an.startsWith(owner)) || (an === 'id' && bn === `${owner}_id`) || bn === `${owner}_${an}`;
          const idLike = ID_NAME_RE.test(bc.name) || bc.semanticType === 'Identifier';
          const score = (contained && idLike ? 2 : 0) + (named ? 1 : 0);
          if (score === 0 || (!contained && !named)) continue;
          if (!best || score > best.score) {
            const perParent = new Map<string, number>();
            for (const v of bValues) perParent.set(v, (perParent.get(v) ?? 0) + 1);
            const counts = [...aSet].map(k => perParent.get(k) ?? 0);
            const oneToOne = bc.unique === true || counts.every(c => c <= 1);
            best = {
              score,
              rel: {
                id: `det_${a.name}_${ac.name}_${b.name}_${bc.name}`,
                parentTable: a.name, parentColumn: ac.name, childTable: b.name, childColumn: bc.name,
                cardinality: oneToOne ? '1:1' : '1:N',
                ...(oneToOne || !contained ? {} : { minChildren: Math.min(...counts), maxChildren: Math.max(...counts) }),
                detected: true,
              },
            };
          }
        }
      }
      if (best) out.push(best.rel);
    }
  }
  // Only one relationship per child table may drive its row count.
  const driven = new Set<string>();
  for (const r of out) {
    if (r.maxChildren === undefined) continue;
    if (driven.has(r.childTable)) { delete r.minChildren; delete r.maxChildren; }
    else driven.add(r.childTable);
  }
  return out;
}

// ─── Generation ──────────────────────────────────────────────────────────────

export interface RelationalJobInput {
  tables: TableSchema[];
  relationships: Relationship[];
  rules: ConsistencyRule[];
  config: GenerationConfig & { seed: number };
  profiles?: Record<string, DatasetProfile | null | undefined>;
  forbidden?: Record<string, Record<string, Set<string>>>;
  forbiddenReplay?: Record<string, ForbiddenLog>;
}

export interface GeneratedRelational {
  design: ExpandedDesign;
  order: string[];
  tables: Map<string, { schema: ColumnSchema[]; table: GeneratedTable }>;
}

export type RelationalProgress = (stage: 'generate' | 'links', fraction: number, detail: string) => void;

function hashSeed(seed: number, key: string): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) % 2_147_483_647;
}

/** AI content pools and edge cases are keyed "table.column" for relational jobs; give each table its own. */
function aiForTable(config: GenerationConfig, table: string): Pick<GenerationConfig, 'aiContent' | 'aiEdgeCases'> {
  const p = `${table}.`;
  const strip = (c: string) => (c.startsWith(p) ? c.slice(p.length) : null);
  const aiContent = Object.fromEntries(Object.entries(config.aiContent ?? {}).flatMap(([k, v]) => {
    const c = strip(k);
    return c ? [[c, v]] : [];
  }));
  const aiEdgeCases = (config.aiEdgeCases ?? []).flatMap(e => {
    const column = strip(e.column);
    if (!column) return [];
    if (!e.compareWith) return [{ ...e, column }];
    const other = strip(e.compareWith.column);
    return other ? [{ ...e, column, compareWith: { ...e.compareWith, column: other } }] : [];
  });
  return { aiContent, aiEdgeCases };
}

function pickDistinct(rng: Rng, n: number, k: number): number[] {
  // Partial Fisher–Yates over indices 0..n-1.
  const idx = Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < Math.min(k, n); i++) {
    const j = rng.int(i, n - 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
    out.push(idx[i]);
  }
  return out;
}

function roundFor(col: ColumnSchema, x: number): number {
  return col.type === 'integer' ? Math.round(x) : Math.round(x * 100) / 100;
}

/** Aggregates product(terms) over each parent's children. Parents without children get SUM/COUNT 0, others null. */
export function computeRuleValues(
  rule: ConsistencyRule,
  parent: { schema: ColumnSchema[]; data: Cell[][]; rowCount: number },
  child: { schema: ColumnSchema[]; data: Cell[][]; rowCount: number },
  rel: Relationship,
): (number | null)[] {
  const pKey = parent.schema.findIndex(c => c.name === rel.parentColumn);
  const cKey = child.schema.findIndex(c => c.name === rel.childColumn);
  const termIdx = rule.terms.map(t => child.schema.findIndex(c => c.name === t));
  const target = parent.schema.find(c => c.name === rule.parentColumn)!;
  const index = new Map<string, number>();
  for (let i = 0; i < parent.rowCount; i++) {
    const k = parent.data[pKey][i];
    if (k !== null) index.set(String(k), i);
  }
  const sum = new Float64Array(parent.rowCount);
  const count = new Float64Array(parent.rowCount);
  const min = new Float64Array(parent.rowCount).fill(Infinity);
  const max = new Float64Array(parent.rowCount).fill(-Infinity);
  for (let i = 0; i < child.rowCount; i++) {
    const p = index.get(String(child.data[cKey][i]));
    if (p === undefined) continue;
    let x = 1;
    if (rule.aggregate !== 'COUNT') {
      let ok = true;
      for (const t of termIdx) {
        const n = toNumber(child.data[t][i]);
        if (n === null) { ok = false; break; }
        x *= n;
      }
      if (!ok) continue;
    }
    sum[p] += x; count[p]++;
    if (x < min[p]) min[p] = x;
    if (x > max[p]) max[p] = x;
  }
  return Array.from({ length: parent.rowCount }, (_, p) => {
    switch (rule.aggregate) {
      case 'COUNT': return count[p];
      case 'SUM': return roundFor(target, sum[p]);
      case 'AVG': return count[p] ? roundFor(target, sum[p] / count[p]) : null;
      case 'MIN': return count[p] ? roundFor(target, min[p]) : null;
      case 'MAX': return count[p] ? roundFor(target, max[p]) : null;
    }
  });
}

export function generateRelational(input: RelationalJobInput, onProgress?: RelationalProgress): GeneratedRelational {
  const design = expandRelationships(input.tables, input.relationships);
  const order = topoOrder(design.tables, design.relationships);
  const out = new Map<string, { schema: ColumnSchema[]; table: GeneratedTable }>();
  const rng = createRng(input.config.seed).derive('relational');

  // Columns referenced by a relationship on the parent side are keys: unique and never null.
  const keyCols = new Set(design.relationships.map(r => `${r.parentTable}.${r.parentColumn}`));
  const fkCols = new Set(design.relationships.map(r => `${r.childTable}.${r.childColumn}`));

  order.forEach((name, t) => {
    const def = design.tables.find(x => x.name === name)!;
    const incoming = design.relationships.filter(r => r.childTable === name);
    const join = design.joins.find(j => j.table === name);
    const tRng = rng.derive(`table:${name}`);

    // ── Row count and parent assignment for the driving relationship ──
    let rowCount = Math.max(0, Math.floor(def.rowCount ?? input.config.rowCount));
    const parentOf = new Map<string, Int32Array>(); // relationship id → parent row per child row
    const parentRows = (r: Relationship) => out.get(r.parentTable)!.table.rowCount;

    if (join) {
      const nA = parentRows(join.relA), nB = parentRows(join.relB);
      const lo = Math.max(0, join.relA.minChildren ?? 1), hi = Math.max(lo, join.relA.maxChildren ?? Math.max(lo, 3));
      const aIdx: number[] = [], bIdx: number[] = [];
      for (let a = 0; a < nA; a++) {
        for (const b of pickDistinct(tRng, nB, tRng.int(lo, hi))) { aIdx.push(a); bIdx.push(b); }
      }
      rowCount = aIdx.length;
      parentOf.set(join.relA.id, Int32Array.from(aIdx));
      parentOf.set(join.relB.id, Int32Array.from(bIdx));
    } else {
      const driving = incoming.find(r => r.cardinality === '1:1') ?? incoming.find(r => r.cardinality === '1:N' && r.maxChildren !== undefined);
      if (driving?.cardinality === '1:1') {
        const n = parentRows(driving);
        rowCount = Math.min(def.rowCount ?? n, n);
        parentOf.set(driving.id, Int32Array.from(pickDistinct(tRng, n, rowCount)).sort());
      } else if (driving) {
        const n = parentRows(driving);
        const lo = Math.max(0, driving.minChildren ?? 0), hi = Math.max(lo, driving.maxChildren ?? lo);
        const idx: number[] = [];
        for (let p = 0; p < n; p++) { const k = tRng.int(lo, hi); for (let j = 0; j < k; j++) idx.push(p); }
        rowCount = idx.length;
        parentOf.set(driving.id, Int32Array.from(idx));
      }
      // Other relationships: each child row gets a uniformly random parent.
      for (const r of incoming) {
        if (parentOf.has(r.id)) continue;
        const n = parentRows(r);
        if (r.cardinality === '1:1') {
          rowCount = Math.min(rowCount, n);
          parentOf.set(r.id, Int32Array.from(pickDistinct(tRng, n, rowCount)));
        } else {
          parentOf.set(r.id, Int32Array.from({ length: rowCount }, () => (n ? tRng.int(0, n - 1) : -1)));
        }
      }
      for (const [id, arr] of parentOf) if (arr.length > rowCount) parentOf.set(id, arr.slice(0, rowCount));
    }

    // ── Generate the table's own columns ──
    const schema = def.columns.map(c => {
      const key = `${name}.${c.name}`;
      if (keyCols.has(key)) return { ...c, unique: true, nullable: false };
      if (fkCols.has(key)) {
        const oneToOne = incoming.some(r => r.childColumn === c.name && r.cardinality === '1:1');
        return { ...c, nullable: false, unique: oneToOne, privacyTransform: 'preserve' as const };
      }
      return c;
    });
    const table = generateTabular(
      {
        schema, config: { ...input.config, rowCount, seed: hashSeed(input.config.seed, name), ...aiForTable(input.config, name) }, profile: input.profiles?.[name],
        forbidden: input.forbidden?.[name], forbiddenReplay: input.forbiddenReplay?.[name],
      },
      (_stage, f) => onProgress?.('generate', (t + f) / order.length, name),
    );

    // ── Foreign keys: copy the parent's key value for the assigned parent row ──
    for (const r of incoming) {
      const c = schema.findIndex(x => x.name === r.childColumn);
      const parent = out.get(r.parentTable)!;
      const pc = parent.schema.findIndex(x => x.name === r.parentColumn);
      const assign = parentOf.get(r.id)!;
      for (let i = 0; i < rowCount; i++) {
        table.data[c][i] = assign[i] >= 0 ? parent.table.data[pc][assign[i]] : null;
        table.flags[c][i] = 0;
      }
    }
    out.set(name, { schema, table });
    onProgress?.('generate', (t + 1) / order.length, name);
  });

  return { design, order, tables: out };
}

/** Writes rule columns from their children. Deeper child tables first, so chained rules see final values. */
export function applyRules(gen: GeneratedRelational, rules: ConsistencyRule[]): void {
  const depth = (t: string) => gen.order.indexOf(t);
  const sorted = [...rules].sort((a, b) => depth(b.childTable) - depth(a.childTable));
  for (const rule of sorted) {
    const parent = gen.tables.get(rule.parentTable);
    const child = gen.tables.get(rule.childTable);
    const rel = gen.design.relationships.find(r => r.parentTable === rule.parentTable && r.childTable === rule.childTable);
    if (!parent || !child || !rel) continue;
    const values = computeRuleValues(
      rule,
      { schema: parent.schema, data: parent.table.data, rowCount: parent.table.rowCount },
      { schema: child.schema, data: child.table.data, rowCount: child.table.rowCount },
      rel,
    );
    const c = parent.schema.findIndex(x => x.name === rule.parentColumn);
    for (let i = 0; i < values.length; i++) { parent.table.data[c][i] = values[i]; parent.table.flags[c][i] = 0; }
  }
}

/** Rows each child table will roughly get, for the UI (exact counts are random within min/max). */
export function estimateRowCounts(tables: TableSchema[], relationships: Relationship[]): Record<string, { rows: number; derived: boolean }> {
  const out: Record<string, { rows: number; derived: boolean }> = {};
  let design: ExpandedDesign, order: string[];
  try {
    design = expandRelationships(tables, relationships);
    order = topoOrder(design.tables, design.relationships);
  } catch {
    tables.forEach(t => { out[t.name] = { rows: t.rowCount ?? 0, derived: false }; });
    return out;
  }
  for (const name of order) {
    const def = design.tables.find(t => t.name === name)!;
    const incoming = design.relationships.filter(r => r.childTable === name);
    const join = design.joins.find(j => j.table === name);
    const avg = (r: Relationship, lo0: number, hi0: number) => {
      const lo = r.minChildren ?? lo0, hi = r.maxChildren ?? Math.max(lo, hi0);
      return (out[r.parentTable]?.rows ?? 0) * (lo + hi) / 2;
    };
    const one = incoming.find(r => r.cardinality === '1:1');
    const drive = incoming.find(r => r.cardinality === '1:N' && r.maxChildren !== undefined);
    if (join) out[name] = { rows: Math.round(avg(join.relA, 1, 3)), derived: true };
    else if (one) out[name] = { rows: Math.min(def.rowCount ?? Infinity, out[one.parentTable]?.rows ?? 0), derived: true };
    else if (drive) out[name] = { rows: Math.round(avg(drive, 0, 0)), derived: true };
    else out[name] = { rows: def.rowCount ?? 0, derived: false };
  }
  return out;
}
