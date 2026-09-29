// Quality scores, warnings and per-column status, derived only from the validation metrics
// produced by validate.ts. Nothing here is hardcoded: missing inputs give N/A, not a number.

import type { ColumnValidationMetrics, RelationalResult, TabularResult, ValidationMetrics } from '../types';

export type Severity = 'high' | 'medium' | 'low';

export interface QualityDimension {
  id: string;
  label: string;
  /** 0–100, or null when the dimension cannot be computed for this result. */
  score: number | null;
  naReason?: string;
  /** How the score is computed (shown in a tooltip). */
  method: string;
  /** The real inputs behind this score. */
  detail: string;
}

export interface QualityWarning {
  column: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Set when several columns share this warning. */
  columns?: string[];
  /** One detail line per affected column (grouped warnings only). */
  details?: string[];
}

export interface ColumnQuality {
  column: string;
  type: string;
  /** 0–100 from 1 − KS (numeric) or 1 − TVD (categorical); null when not comparable. */
  fidelity: number | null;
  fidelityMethod?: 'KS' | 'TVD';
  nullRateOriginal?: number;
  nullRateSynthetic: number;
  status: 'ok' | 'warning' | 'issue';
}

export interface QualityReport {
  overall: number | null;
  dimensions: QualityDimension[];
  warnings: QualityWarning[];
  columns: ColumnQuality[];
}

interface DimensionResult {
  score: number | null;
  naReason?: string;
  detail: string;
}

interface DimensionDefinition {
  id: string;
  label: string;
  method: string;
  compute: (m: ValidationMetrics) => DimensionResult;
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const to100 = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 1000) / 10;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Null rate a column should have: the original file's rate if one was uploaded, else the configured rate. */
/**
 * The null-rate target is always the configured missing-value rate (0 for non-nullable columns), because
 * that is what the generator aims for. The Validation tab uses the same target and tolerance.
 */
function nullTarget(c: ColumnValidationMetrics): { target: number; tolerance: number } {
  return { target: c.nullRateTarget, tolerance: c.nullRateTolerance ?? 0.01 };
}

/** Per-column fidelity: 1 − KS statistic for numeric columns, 1 − TVD for categorical ones. */
function columnFidelity(c: ColumnValidationMetrics): { value: number; method: 'KS' | 'TVD' } | null {
  if (c.ks && Number.isFinite(c.ks.d)) return { value: 1 - c.ks.d, method: 'KS' };
  if (c.tvd) return { value: 1 - c.tvd.value, method: 'TVD' };
  return null;
}

// ─── Dimensions (add new ones to this list) ──────────────────────────────────

export const QUALITY_DIMENSIONS: DimensionDefinition[] = [
  {
    id: 'fidelity',
    label: 'Statistical Fidelity',
    method: 'For each numeric column: 1 − KS statistic between original and synthetic values. For each categorical column: 1 − total variation distance between category frequencies. Averaged across columns. Injected outliers and edge cases are excluded.',
    compute: m => {
      if (!m.hasOriginal) return { score: null, naReason: 'N/A — no source data', detail: 'Upload a file to compare against.' };
      const cols = m.columns.map(c => ({ c, f: columnFidelity(c) })).filter(x => x.f);
      if (!cols.length) return { score: null, naReason: 'N/A — no comparable columns', detail: 'No numeric or categorical columns match the source.' };
      return {
        score: to100(mean(cols.map(x => x.f!.value))),
        detail: cols.map(x => `${x.c.column}: ${to100(x.f!.value)} (${x.f!.method})`).join(' · '),
      };
    },
  },
  {
    id: 'uniqueness',
    label: 'Uniqueness',
    method: 'Share of unique-marked columns that contain zero duplicate values.',
    compute: m => {
      const cols = m.columns.filter(c => c.unique);
      if (!cols.length) return { score: null, naReason: 'N/A — no unique columns', detail: 'No column is marked unique.' };
      const clean = cols.filter(c => !c.duplicates);
      return {
        score: to100(clean.length / cols.length),
        detail: `${clean.length} of ${cols.length} unique columns have no duplicates` +
          (clean.length < cols.length ? ` (${cols.filter(c => c.duplicates).map(c => `${c.column}: ${c.duplicates} duplicates`).join(', ')})` : ''),
      };
    },
  },
  {
    id: 'nulls',
    label: 'Null Distribution',
    method: 'Per column: max(0, 1 − 2 × |synthetic null rate − target|), averaged. The target is the configured missing-value rate (0 for non-nullable columns), the same target the Validation tab uses.',
    compute: m => {
      if (!m.columns.length) return { score: null, naReason: 'N/A — no columns', detail: '' };
      const scored = m.columns.map(c => {
        const { target } = nullTarget(c);
        return { c, target, score: Math.max(0, 1 - 2 * Math.abs(c.nullRateSynthetic - target)) };
      });
      const worst = [...scored].sort((a, b) => a.score - b.score).slice(0, 3);
      return {
        score: to100(mean(scored.map(s => s.score))),
        detail: 'Target = configured rate. Lowest: ' +
          worst.map(w => `${w.c.column} ${pct(w.c.nullRateSynthetic)} vs ${pct(w.target)}`).join(' · '),
      };
    },
  },
  {
    id: 'privacy',
    label: 'Privacy',
    method: 'Share of high-privacy columns in which no synthetic value (after masking, hashing, noise or synthetic replacement) matches a value from the uploaded file. Comparison is case-insensitive.',
    compute: m => {
      if (!m.hasOriginal) return { score: null, naReason: 'N/A — no source data', detail: 'Upload a file to check for leaked values.' };
      const cols = m.columns.filter(c => c.leakedValues !== undefined);
      if (!cols.length) return { score: null, naReason: 'N/A — no high-privacy columns', detail: 'No column is marked high privacy.' };
      const clean = cols.filter(c => !c.leakedValues);
      return {
        score: to100(clean.length / cols.length),
        detail: cols.map(c => `${c.column} (${c.transform ?? 'preserve'}): ${c.leakedValues} leaked`).join(' · '),
      };
    },
  },
  {
    id: 'referential',
    label: 'Referential Integrity',
    method: 'Percentage of foreign key values that point to an existing parent row, across all relationships (empty foreign keys count as invalid).',
    compute: m => {
      const rels = (m.relationships ?? []).filter(r => r.fkValues + r.nullFks > 0);
      if (!rels.length) return { score: null, naReason: 'N/A — no relationships', detail: 'Only relational generation has foreign keys.' };
      const total = rels.reduce((a, r) => a + r.fkValues + r.nullFks, 0);
      const valid = rels.reduce((a, r) => a + r.fkValues - r.orphans, 0);
      return {
        score: to100(valid / total),
        detail: `${valid.toLocaleString()} of ${total.toLocaleString()} foreign keys valid · ` + rels.map(r => `${r.label}: ${r.orphans} orphans`).join(' · '),
      };
    },
  },
  {
    id: 'rules',
    label: 'Cross-table Totals',
    method: 'Percentage of parent rows whose rule column equals the aggregate of its children (e.g. orders.total = SUM(quantity × unit_price)), within 0.01.',
    compute: m => {
      const rules = m.rules ?? [];
      if (!rules.length) return { score: null, naReason: 'N/A — no rules defined', detail: 'Define cross-table rules in the relational designer.' };
      const total = rules.reduce((a, r) => a + r.parentsChecked, 0);
      const ok = total - rules.reduce((a, r) => a + r.mismatches, 0);
      return { score: total ? to100(ok / total) : null, naReason: total ? undefined : 'N/A — no parent rows', detail: rules.map(r => `${r.label}: ${r.mismatches} mismatches`).join(' · ') };
    },
  },
  {
    id: 'columnRules',
    label: 'Business Rules',
    method: 'Percentage of rows that satisfy every column business rule (min/max, allowed values, regex pattern, column A < column B). Rules are defined on the configure step.',
    compute: m => {
      const r = m.columnRules;
      if (!r || !r.rules.length) return { score: null, naReason: 'N/A — no rules defined', detail: 'Add business rules on the configure step.' };
      return {
        score: r.rows ? to100(r.passing / r.rows) : null,
        naReason: r.rows ? undefined : 'N/A — no rows',
        detail: `${r.passing.toLocaleString()} of ${r.rows.toLocaleString()} rows pass · ` + r.rules.map(x => `${x.label}: ${x.violations} violations`).join(' · '),
      };
    },
  },
  {
    id: 'documents',
    label: 'Document Consistency',
    method: 'Percentage of generated documents that pass every check: invoices whose line amounts, subtotal, tax and total reconcile exactly and whose dates are in range; statements whose running and closing balances reconcile, dates are in range and sorted, and minimum balance / amount limits hold.',
    compute: m => {
      const d = m.documents;
      if (!d) return { score: null, naReason: 'N/A — no documents', detail: 'Only invoice and bank statement generation produce documents.' };
      if (!d.total) return { score: null, naReason: 'N/A — 0 documents', detail: '' };
      return { score: to100(d.consistent / d.total), detail: `${d.consistent.toLocaleString()} of ${d.total.toLocaleString()} ${d.kind === 'invoice' ? 'invoices' : 'statements'} fully consistent` };
    },
  },
  {
    id: 'correlation',
    label: 'Correlation',
    method: '1 − mean absolute difference between the original and synthetic Pearson correlation matrices (numeric column pairs), using unmodified values.',
    compute: m => {
      if (!m.hasOriginal) return { score: null, naReason: 'N/A — no source data', detail: 'Upload a file to compare against.' };
      if (!m.correlations.length) return { score: null, naReason: 'N/A — fewer than 2 numeric columns', detail: 'Needs at least two numeric columns.' };
      const diffs = m.correlations.map(p => Math.abs(p.synthetic - p.original));
      return {
        score: to100(1 - mean(diffs)),
        detail: `Mean |Δr| ${mean(diffs).toFixed(3)} over ${diffs.length} pair${diffs.length === 1 ? '' : 's'}: ` +
          m.correlations.slice(0, 4).map(p => `${p.a}×${p.b} ${p.original.toFixed(2)}→${p.synthetic.toFixed(2)}`).join(', '),
      };
    },
  },
];

// ─── Warnings ────────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

function columnWarnings(c: ColumnValidationMetrics): QualityWarning[] {
  const out: QualityWarning[] = [];
  const w = (severity: Severity, title: string, detail: string) => out.push({ column: c.column, severity, title, detail });

  if (c.invalid > 0) w('high', 'Values with the wrong type', `${c.invalid.toLocaleString()} values are not valid ${c.type}.`);
  if (c.duplicates) w('high', 'Duplicates in a unique column', `${c.duplicates.toLocaleString()} duplicate values in a column marked unique.`);
  if (c.leakedValues) {
    w('high', 'Original PII value in synthetic data',
      `${c.leakedValues.toLocaleString()} values in this high-privacy column (${c.transform ?? 'preserve'}) also appear in the uploaded file. Use mask, hash or synthetic.`);
  }

  if (c.ks && c.ks.p < 0.05) {
    w(c.ks.d >= 0.2 ? 'high' : 'medium', 'Distribution differs significantly from the original',
      `KS statistic D = ${c.ks.d.toFixed(3)}, p = ${c.ks.p < 0.001 ? c.ks.p.toExponential(1) : c.ks.p.toFixed(3)} (< 0.05, so the distributions differ).`);
  }

  if (c.tvd && c.tvd.value > c.tvd.tolerance) {
    w(c.tvd.value > 2 * c.tvd.tolerance ? 'high' : 'medium', 'Category frequencies differ from the original',
      `Total variation distance ${c.tvd.value.toFixed(3)} exceeds tolerance ${c.tvd.tolerance.toFixed(3)}.`);
  }

  for (const s of c.categoryShares ?? []) {
    // Categories seen fewer than 5 times in the source are too small to judge.
    if (s.originalCount < 5 || s.original <= 0) continue;
    const rel = (s.synthetic - s.original) / s.original;
    if (Math.abs(rel) > 0.5) {
      w(Math.abs(rel) > 1 ? 'medium' : 'low', `Category "${s.value}" share changed`,
        `${s.original.toFixed(1)}% in original vs ${s.synthetic.toFixed(1)}% in synthetic (${rel > 0 ? '+' : ''}${(rel * 100).toFixed(0)}% relative, limit ±50%).`);
    }
  }

  const { target, tolerance } = nullTarget(c);
  const nullDiff = Math.abs(c.nullRateSynthetic - target);
  if (nullDiff > tolerance) {
    w(nullDiff > 0.15 || (target === 0 && c.nullRateSynthetic > 0) ? 'high' : 'medium', 'Null rate differs from target',
      `${pct(c.nullRateSynthetic)} missing in synthetic vs ${pct(target)} configured (${(nullDiff * 100).toFixed(1)} points apart, tolerance ±${(tolerance * 100).toFixed(1)}).`);
  }

  if (c.mean && c.std) {
    const scale = Math.max(Math.abs(c.mean.original), c.std.original, 1e-9);
    const md = Math.abs(c.mean.synthetic - c.mean.original) / scale;
    const sd = c.std.original > 0 ? Math.abs(c.std.synthetic - c.std.original) / c.std.original : 0;
    if (Math.max(md, sd) > 0.1) {
      w(Math.max(md, sd) > 0.3 ? 'high' : 'medium', 'Mean or spread drifted from the original',
        `Mean ${c.mean.original.toFixed(2)} → ${c.mean.synthetic.toFixed(2)} (${pct(md)}), std ${c.std.original.toFixed(2)} → ${c.std.synthetic.toFixed(2)} (${pct(sd)}); limit 10%.`);
    }
  }
  return out;
}

/** One metrics object for a relational result: columns become "table.column", plus relationship/rule metrics. */
export function mergeRelationalMetrics(result: RelationalResult): ValidationMetrics {
  const merged: ValidationMetrics = {
    hasOriginal: result.tables.some(t => t.validation.metrics?.hasOriginal),
    columns: [],
    correlations: [],
    copiedRows: 0,
    relationships: result.relationalValidation.metrics?.relationships ?? [],
    rules: result.relationalValidation.metrics?.rules ?? [],
  };
  for (const t of result.tables) {
    const m = t.validation.metrics;
    if (!m) continue;
    const p = (s: string) => `${t.tableName}.${s}`;
    merged.columns.push(...m.columns.map(c => ({ ...c, column: p(c.column) })));
    merged.correlations.push(...m.correlations.map(c => ({ ...c, a: p(c.a), b: p(c.b) })));
    merged.copiedRows! += m.copiedRows ?? 0;
    if (m.columnRules?.rules.length) {
      const acc = merged.columnRules ??= { rows: 0, passing: 0, rules: [] };
      acc.rows += m.columnRules.rows;
      acc.passing += m.columnRules.passing;
      acc.rules.push(...m.columnRules.rules.map(r => ({ ...r, label: `${t.tableName}.${r.label}` })));
    }
  }
  return merged;
}

export function computeQuality(result: TabularResult | { metrics: ValidationMetrics | undefined; rowCount: number }): QualityReport {
  const m = 'validation' in result ? result.validation.metrics : result.metrics;
  if (!m) return { overall: null, dimensions: [], warnings: [], columns: [] };

  const dimensions: QualityDimension[] = QUALITY_DIMENSIONS.map(d => ({ id: d.id, label: d.label, method: d.method, ...d.compute(m) }));
  const available = dimensions.filter(d => d.score !== null).map(d => d.score as number);
  const overall = available.length ? Math.round(mean(available) * 10) / 10 : null;

  const warnings: QualityWarning[] = m.columns.flatMap(columnWarnings);
  for (const p of m.correlations) {
    const d = Math.abs(p.synthetic - p.original);
    if (d > 0.1) {
      warnings.push({
        column: `${p.a} × ${p.b}`,
        severity: d > 0.25 ? 'high' : 'medium',
        title: 'Correlation not preserved',
        detail: `r = ${p.original.toFixed(3)} in original vs ${p.synthetic.toFixed(3)} in synthetic (|Δr| ${d.toFixed(3)}, limit 0.1).`,
      });
    }
  }
  for (const r of m.relationships ?? []) {
    if (r.orphans || r.nullFks) {
      warnings.push({ column: r.label, severity: 'high', title: 'Orphan rows', detail: `${r.orphans.toLocaleString()} foreign key values have no parent row and ${r.nullFks.toLocaleString()} are empty (of ${(r.fkValues + r.nullFks).toLocaleString()}).` });
    }
    if (r.cardinalityViolations) {
      warnings.push({ column: r.label, severity: 'high', title: `Cardinality ${r.cardinality} broken`, detail: r.cardinalityDetail });
    }
  }
  for (const r of m.rules ?? []) {
    if (r.mismatches) {
      warnings.push({ column: r.label, severity: 'high', title: 'Totals do not reconcile', detail: `${r.mismatches.toLocaleString()} of ${r.parentsChecked.toLocaleString()} parent rows differ from their children (max difference ${r.maxDiff.toFixed(4)}).` });
    }
  }
  for (const r of m.columnRules?.rules ?? []) {
    if (r.violations) {
      warnings.push({ column: r.label.split(' ')[0], severity: 'high', title: 'Business rule broken', detail: `${r.label}: ${r.violations.toLocaleString()} rows violate this rule.` });
    }
  }
  if (m.documents && m.documents.consistent < m.documents.total) {
    warnings.push({
      column: m.documents.kind === 'invoice' ? 'invoices' : 'statements',
      severity: 'high',
      title: 'Documents do not reconcile',
      detail: `${(m.documents.total - m.documents.consistent).toLocaleString()} of ${m.documents.total.toLocaleString()} documents failed a total, balance, date or limit check.`,
    });
  }
  if (m.copiedRows) {
    const rate = m.copiedRows / Math.max(1, result.rowCount);
    warnings.push({
      column: '(all columns)',
      severity: rate > 0.05 ? 'high' : 'medium',
      title: 'Rows copied from the original',
      detail: `${m.copiedRows.toLocaleString()} rows (${pct(rate, 2)}) exactly match a row in the uploaded file.`,
    });
  }
  warnings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.column.localeCompare(b.column));

  const columns: ColumnQuality[] = m.columns.map(c => {
    const f = columnFidelity(c);
    const own = warnings.filter(w => w.column === c.column);
    return {
      column: c.column,
      type: c.type,
      fidelity: f ? to100(f.value) : null,
      fidelityMethod: f?.method,
      nullRateOriginal: c.nullRateOriginal,
      nullRateSynthetic: c.nullRateSynthetic,
      status: own.some(w => w.severity === 'high') ? 'issue' : own.length ? 'warning' : 'ok',
    };
  });

  return { overall, dimensions, warnings: groupWarnings(warnings), columns };
}

/**
 * Warnings of the same kind (same title and severity) are shown once, listing every affected column,
 * instead of repeating the same card per column. Per-column status is computed before grouping.
 */
export function groupWarnings(warnings: QualityWarning[]): QualityWarning[] {
  const groups = new Map<string, QualityWarning[]>();
  for (const w of warnings) {
    const key = `${w.severity}\u0000${w.title}`;
    const g = groups.get(key);
    if (g) g.push(w); else groups.set(key, [w]);
  }
  return [...groups.values()].map(g => g.length === 1 ? g[0] : {
    column: g.map(w => w.column).join(', '),
    severity: g[0].severity,
    title: `${g[0].title} (${g.length} columns)`,
    detail: g.map(w => `${w.column}: ${w.detail}`).join(' · '),
    columns: g.map(w => w.column),
    details: g.map(w => `${w.column}: ${w.detail}`),
  });
}

export function scoreColor(score: number | null): 'success' | 'warning' | 'error' | 'muted' {
  if (score === null) return 'muted';
  if (score >= 90) return 'success';
  if (score >= 70) return 'warning';
  return 'error';
}
