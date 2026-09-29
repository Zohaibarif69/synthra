// The generation pipeline shared by the Web Worker (full runs) and the live preview (20 rows):
// generate → privacy transforms → business rules (→ cross-table totals for relational data).

import type {
  Cell, ColumnSchema, ConsistencyRule, DatasetProfile, ForbiddenLog, GenerationConfig, PrivacyColumnReport,
  Relationship, TableSchema,
} from '../types';
import { generateTabular, type GeneratedTable, type GenerateProgress } from './tabular';
import { applyPrivacy, DEFAULT_EPSILON, effectiveType } from './privacy';
import { createRng } from './random';
import { enforceRules, rulesForTable } from './rules';
import { applyRules, generateRelational, type GeneratedRelational, type RelationalProgress } from './relational';

/** Lower-cased upload values of each high-privacy column; the generator must never output them. */
export function forbiddenValues(schema: ColumnSchema[], columns?: Record<string, ArrayLike<Cell>> | null): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  if (!columns) return out;
  for (const col of schema) {
    const src = col.sourceColumn ? columns[col.sourceColumn] : undefined;
    if (col.privacyLevel !== 'high' || !src) continue;
    const set = new Set<string>();
    for (let i = 0; i < src.length; i++) {
      const v = src[i];
      if (v !== null && v !== undefined) set.add(String(v).trim().toLowerCase());
    }
    out[col.name] = set;
  }
  return out;
}

export interface TabularPipelineResult {
  table: GeneratedTable;
  /** Output schema (masked/hashed columns become text). */
  schema: ColumnSchema[];
  privacy: PrivacyColumnReport[];
}

export async function runTabularPipeline(input: {
  schema: ColumnSchema[];
  config: GenerationConfig & { seed: number };
  profile?: DatasetProfile | null;
  forbidden?: Record<string, Set<string>>;
  forbiddenReplay?: ForbiddenLog;
  onGenerate?: GenerateProgress;
  onPrivacy?: (fraction: number) => void;
}): Promise<TabularPipelineResult> {
  const table = generateTabular(
    { schema: input.schema, config: input.config, profile: input.profile, forbidden: input.forbidden, forbiddenReplay: input.forbiddenReplay },
    input.onGenerate,
  );
  const privacy = await applyPrivacy({
    schema: input.schema, data: table.data, epsilon: input.config.privacyEpsilon ?? DEFAULT_EPSILON,
    rng: createRng(input.config.seed).derive('privacy'), profile: input.profile, onProgress: input.onPrivacy,
  });
  // Masked/hashed columns now hold text; everything after this point sees the output types.
  const schema = input.schema.map(c => ({ ...c, type: effectiveType(c) }));
  // Business rules are applied last so nothing (edge cases, noise) can break them afterwards.
  enforceRules(schema, table.data, table.rowCount, input.config.columnRules ?? [], createRng(input.config.seed).derive('rules'));
  return { table, schema, privacy };
}

export interface RelationalPipelineResult {
  gen: GeneratedRelational;
  privacyByTable: Map<string, PrivacyColumnReport[]>;
}

export async function runRelationalPipeline(input: {
  tables: TableSchema[];
  relationships: Relationship[];
  rules: ConsistencyRule[];
  config: GenerationConfig & { seed: number };
  profiles: Record<string, DatasetProfile | null | undefined>;
  forbidden?: Record<string, Record<string, Set<string>>>;
  forbiddenReplay?: Record<string, ForbiddenLog>;
  onGenerate?: RelationalProgress;
  onPrivacy?: (fraction: number, table: string) => void;
}): Promise<RelationalPipelineResult> {
  const gen = generateRelational(
    {
      tables: input.tables, relationships: input.relationships, rules: input.rules, config: input.config, profiles: input.profiles,
      forbidden: input.forbidden, forbiddenReplay: input.forbiddenReplay,
    },
    input.onGenerate,
  );

  // Privacy transforms and business rules, except on key/foreign-key columns (links must keep matching).
  const linked = new Set(gen.design.relationships.flatMap(r => [`${r.parentTable}.${r.parentColumn}`, `${r.childTable}.${r.childColumn}`]));
  const privacyByTable = new Map<string, PrivacyColumnReport[]>();
  for (const [i, name] of gen.order.entries()) {
    const stored = gen.tables.get(name)!;
    const schema = stored.schema.map(c => (linked.has(`${name}.${c.name}`) ? { ...c, privacyTransform: 'preserve' as const } : c));
    privacyByTable.set(name, await applyPrivacy({
      schema, data: stored.table.data, epsilon: input.config.privacyEpsilon ?? DEFAULT_EPSILON,
      rng: createRng(input.config.seed).derive(`privacy:${name}`), profile: input.profiles[name],
    }));
    stored.schema = schema.map(c => ({ ...c, type: effectiveType(c) }));
    const tableRules = rulesForTable(input.config.columnRules, name)
      .filter(r => !linked.has(`${name}.${r.column}`) && (r.kind !== 'compare' || !linked.has(`${name}.${r.other}`)));
    enforceRules(stored.schema, stored.table.data, stored.table.rowCount, tableRules, createRng(input.config.seed).derive(`rules:${name}`));
    input.onPrivacy?.((i + 1) / gen.order.length, name);
  }

  // Rule columns (e.g. order totals) are computed last, from the final child values.
  applyRules(gen, input.rules);
  return { gen, privacyByTable };
}
