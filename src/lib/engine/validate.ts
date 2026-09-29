// Validation of generated tabular data. Every check reports the real numbers it measured.

import type {
  BankStatement, BankStatementConfig, Invoice, InvoiceConfig,
  Cell, ColumnSchema, ConsistencyRule, DatasetProfile, GenerationConfig, Relationship, RelationshipMetric, RuleMetric,
  ValidationCheck, ValidationMetrics, ValidationResult, ValidationStatus,
} from '../types';
import { toNumber } from './infer';
import { parseDateWithFormat } from './dates';
import { numericView, pearson } from './profile';
import { checkRules } from './rules';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOOL_WORDS = new Set(['true', 'false', 'yes', 'no', 'y', 'n', 't', 'f', '0', '1']);

/** FLAG.NONE from tabular.ts; only unmodified cells are "base" values for fidelity checks. */
const FLAG_NONE = 0;

const KS_MAX_SAMPLE = 2000;

export interface ValidationData {
  schema: ColumnSchema[];
  /** Column-major values aligned with schema. */
  data: ArrayLike<Cell>[];
  flags?: Uint8Array[];
  rowCount: number;
}

export interface ValidationInput {
  generated: ValidationData;
  config: GenerationConfig;
  requestedRows: number;
  synthetic: DatasetProfile;
  /** Uploaded data, keyed by source column name. */
  original?: {
    profile: DatasetProfile;
    columns: Record<string, ArrayLike<Cell>>;
    rowCount: number;
  };
}

export function isValidForType(v: Cell, col: ColumnSchema): boolean {
  switch (col.type) {
    case 'integer': {
      const n = toNumber(v);
      return n !== null && Number.isInteger(n);
    }
    case 'float':
      return toNumber(v) !== null;
    case 'boolean':
      return typeof v === 'boolean' || BOOL_WORDS.has(String(v).toLowerCase());
    case 'date':
    case 'datetime':
      return parseDateWithFormat(String(v), col.format) !== null;
    case 'email':
      return typeof v === 'string' && EMAIL_RE.test(v);
    case 'uuid':
      return typeof v === 'string' && UUID_RE.test(v);
    default:
      return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
  }
}

// ─── Statistics helpers ──────────────────────────────────────────────────────

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const num = (x: number) => (Math.abs(x) >= 1000 ? x.toLocaleString('en-US', { maximumFractionDigits: 1 }) : x.toFixed(Math.abs(x) < 10 ? 3 : 2));

function worst(statuses: ValidationStatus[]): ValidationStatus {
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('warning')) return 'warning';
  return 'passed';
}

function meanStd(values: number[]): { mean: number; std: number } {
  const n = values.length;
  if (!n) return { mean: NaN, std: NaN };
  let s = 0;
  for (const v of values) s += v;
  const mean = s / n;
  let sq = 0;
  for (const v of values) sq += (v - mean) ** 2;
  return { mean, std: n > 1 ? Math.sqrt(sq / (n - 1)) : 0 };
}

/** Evenly strided subsample of an ascending array (keeps the distribution shape). */
function strideSample(sorted: Float64Array, max: number): Float64Array {
  if (sorted.length <= max) return sorted;
  const out = new Float64Array(max);
  const step = (sorted.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out[i] = sorted[Math.round(i * step)];
  return out;
}

/** Two-sample Kolmogorov–Smirnov test with the asymptotic p-value. */
export function ksTest(a: number[], b: number[]): { d: number; p: number; n: number; m: number } {
  const x = strideSample(Float64Array.from(a).sort(), KS_MAX_SAMPLE);
  const y = strideSample(Float64Array.from(b).sort(), KS_MAX_SAMPLE);
  const n = x.length, m = y.length;
  if (!n || !m) return { d: NaN, p: NaN, n, m };
  let i = 0, j = 0, d = 0;
  while (i < n && j < m) {
    const v = Math.min(x[i], y[j]);
    while (i < n && x[i] <= v) i++;
    while (j < m && y[j] <= v) j++;
    d = Math.max(d, Math.abs(i / n - j / m));
  }
  const en = Math.sqrt((n * m) / (n + m));
  const lambda = (en + 0.12 + 0.11 / en) * d;
  let p = 0;
  for (let k = 1; k <= 100; k++) {
    const term = 2 * (k % 2 ? 1 : -1) * Math.exp(-2 * k * k * lambda * lambda);
    p += term;
    if (Math.abs(term) < 1e-10) break;
  }
  return { d, p: Math.min(1, Math.max(0, p)), n, m };
}

function baseNumbers(col: ColumnSchema, values: ArrayLike<Cell>, flags?: Uint8Array): number[] {
  const view = numericView(col, values);
  const out: number[] = [];
  for (let i = 0; i < view.length; i++) {
    if (flags && flags[i] !== FLAG_NONE) continue;
    if (!Number.isNaN(view[i])) out.push(view[i]);
  }
  return out;
}

function originalNumbers(col: ColumnSchema, values: ArrayLike<Cell>): number[] {
  return baseNumbers(col, values);
}

/** Canonical text of a value so "12.50" and 12.5, or two spellings of one date, compare equal. */
function canonical(v: Cell | undefined, col: ColumnSchema): string {
  if (v === null || v === undefined) return '';
  if (col.type === 'integer' || col.type === 'float') {
    const n = toNumber(v);
    return n === null ? String(v) : String(n);
  }
  if (col.type === 'date' || col.type === 'datetime') {
    const ts = parseDateWithFormat(String(v), col.format);
    return ts === null ? String(v) : String(ts);
  }
  if (col.type === 'boolean') return String(v).toLowerCase();
  return String(v).trim();
}

// ─── Checks ──────────────────────────────────────────────────────────────────

function checkRowCount(input: ValidationInput): ValidationCheck {
  const { rowCount } = input.generated;
  const ok = rowCount === input.requestedRows;
  return {
    name: 'Row Count',
    status: ok ? 'passed' : 'failed',
    message: ok ? `Exactly ${rowCount.toLocaleString()} rows generated` : `Generated ${rowCount.toLocaleString()} rows but ${input.requestedRows.toLocaleString()} were requested`,
    detail: `Seed ${input.config.seed ?? '—'}`,
  };
}

function checkSchema(input: ValidationInput, m: ValidationMetrics): ValidationCheck {
  const { schema, data, rowCount } = input.generated;
  const missing = schema.filter((_, c) => !data[c] || data[c].length !== rowCount).map(c => c.name);
  const bad: string[] = [];
  let invalidTotal = 0;
  let cells = 0;
  schema.forEach((col, c) => {
    const values = data[c];
    if (!values) return;
    let invalid = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v === null) continue;
      cells++;
      if (!isValidForType(v, col)) invalid++;
    }
    m.columns[c].invalid = invalid;
    if (invalid) { bad.push(`${col.name} (${invalid.toLocaleString()} not ${col.type})`); invalidTotal += invalid; }
  });
  const ok = !missing.length && !invalidTotal;
  return {
    name: 'Schema Validity',
    status: ok ? 'passed' : 'failed',
    message: ok
      ? `All ${schema.length} columns present with the expected types`
      : `${missing.length ? `Missing columns: ${missing.join(', ')}. ` : ''}${invalidTotal ? `${invalidTotal.toLocaleString()} values have the wrong type` : ''}`.trim(),
    detail: bad.length ? bad.slice(0, 6).join(' · ') : `${cells.toLocaleString()} non-null values checked, 0 invalid`,
  };
}

function checkUniqueness(input: ValidationInput, m: ValidationMetrics): ValidationCheck {
  const { schema, data } = input.generated;
  // Masking deliberately merges values (a****@example.com), so masked columns can't stay unique.
  const masked = schema.filter(c => c.unique && c.privacyTransform === 'mask').map(c => c.name);
  const unique = schema.map((col, c) => ({ col, c, values: data[c] })).filter(x => x.col.unique && x.col.privacyTransform !== 'mask');
  if (!unique.length) {
    return {
      name: 'Unique Constraints', status: 'passed', message: 'No columns are marked unique',
      detail: masked.length ? `Not checked because masked: ${masked.join(', ')}` : 'Nothing to check',
    };
  }
  const details: string[] = [];
  let failed = false;
  for (const { col, c, values } of unique) {
    const seen = new Set<string>();
    let dup = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v === null) continue;
      const k = String(v);
      if (seen.has(k)) dup++;
      else seen.add(k);
    }
    m.columns[c].duplicates = dup;
    if (dup) failed = true;
    details.push(`${col.name}: ${dup ? `${dup.toLocaleString()} duplicates` : `${seen.size.toLocaleString()} unique`}`);
  }
  return {
    name: 'Unique Constraints',
    status: failed ? 'failed' : 'passed',
    message: failed ? 'Duplicate values found in unique columns' : `${unique.map(u => u.col.name).join(', ')} contain no duplicates`,
    detail: details.join(' · ') + (masked.length ? ` · not checked because masked: ${masked.join(', ')}` : ''),
  };
}

/**
 * Allowed gap between a column's synthetic null rate and its target: 3 binomial standard errors, at
 * least 1 point. Shared by the Validation tab and the Quality page so both judge null rates the same way.
 */
export function nullRateTolerance(target: number, rowCount: number): number {
  return Math.max(0.01, 3 * Math.sqrt((Math.max(target, 0.001) * (1 - target)) / Math.max(1, rowCount)));
}

function checkNullRate(input: ValidationInput, m: ValidationMetrics): ValidationCheck {
  const { schema, data, rowCount } = input.generated;
  const target = input.config.edgeCases.missingValues ? input.config.nullRate : 0;
  const tolerance = nullRateTolerance(target, rowCount);
  let nullableNulls = 0, nullableCells = 0, strictNulls = 0;
  const off: string[] = [];
  const strictBad: string[] = [];
  schema.forEach((col, c) => {
    let nulls = 0;
    const values = data[c];
    for (let i = 0; i < values.length; i++) if (values[i] === null) nulls++;
    const nullable = col.nullable && !(col.semanticType === 'Identifier' && col.unique);
    const cm = m.columns[c];
    cm.nullRateSynthetic = values.length ? nulls / values.length : 0;
    cm.nullRateTarget = nullable ? target : 0;
    cm.nullRateTolerance = nullable ? tolerance : 0;
    const orig = input.original?.profile.columns.find(p => p.name === (col.sourceColumn ?? col.name));
    if (orig) cm.nullRateOriginal = orig.nullRate;
    if (nullable) {
      nullableNulls += nulls;
      nullableCells += values.length;
      const rate = values.length ? nulls / values.length : 0;
      if (Math.abs(rate - target) > tolerance) off.push(`${col.name} ${pct(rate)}`);
    } else if (nulls) {
      strictNulls += nulls;
      strictBad.push(`${col.name} (${nulls})`);
    }
  });
  const overall = nullableCells ? nullableNulls / nullableCells : 0;
  const status: ValidationStatus = strictNulls ? 'failed' : off.length ? 'warning' : 'passed';
  return {
    name: 'Null Rate',
    status,
    message: nullableCells
      ? `${pct(overall)} missing in nullable columns (target ${pct(target)}, tolerance ±${pct(tolerance)})`
      : 'No nullable columns in schema',
    detail: [
      strictBad.length ? `Nulls in non-nullable columns: ${strictBad.join(', ')}` : 'Non-nullable columns: 0 nulls',
      off.length ? `Outside tolerance: ${off.slice(0, 5).join(', ')}` : '',
    ].filter(Boolean).join(' · '),
  };
}

interface NumericPair {
  col: ColumnSchema;
  c: number;
  synthetic: number[];
  original: number[];
}

function numericPairs(input: ValidationInput): NumericPair[] {
  const { original } = input;
  if (!original) return [];
  const { schema, data, flags } = input.generated;
  const out: NumericPair[] = [];
  schema.forEach((col, c) => {
    const kind = input.synthetic.columns[c]?.kind;
    if (kind !== 'numeric') return;
    const src = original.columns[col.sourceColumn ?? col.name];
    if (!src) return;
    const origCol = original.profile.columns.find(p => p.name === (col.sourceColumn ?? col.name));
    if (!origCol || origCol.kind !== 'numeric') return;
    out.push({ col, c, synthetic: baseNumbers(col, data[c], flags?.[c]), original: originalNumbers({ ...col, type: origCol.type as ColumnSchema['type'] }, src) });
  });
  return out.filter(p => p.synthetic.length > 1 && p.original.length > 1);
}

function checkMoments(pairs: NumericPair[], m: ValidationMetrics): ValidationCheck {
  const rows: { name: string; status: ValidationStatus; text: string; worst: number }[] = [];
  for (const { col, c, synthetic, original } of pairs) {
    const s = meanStd(synthetic);
    const o = meanStd(original);
    m.columns[c].mean = { original: o.mean, synthetic: s.mean };
    m.columns[c].std = { original: o.std, synthetic: s.std };
    const scale = Math.max(Math.abs(o.mean), o.std, 1e-9);
    const meanDiff = Math.abs(s.mean - o.mean) / scale;
    const stdDiff = o.std > 0 ? Math.abs(s.std - o.std) / o.std : s.std > 0 ? 1 : 0;
    const w = Math.max(meanDiff, stdDiff);
    rows.push({
      name: col.name,
      status: w <= 0.1 ? 'passed' : w <= 0.3 ? 'warning' : 'failed',
      worst: w,
      text: `${col.name}: mean ${num(s.mean)} vs ${num(o.mean)} (${pct(meanDiff)}), std ${num(s.std)} vs ${num(o.std)} (${pct(stdDiff)})`,
    });
  }
  rows.sort((a, b) => b.worst - a.worst);
  const status = worst(rows.map(r => r.status));
  const within = rows.filter(r => r.status === 'passed').length;
  return {
    name: 'Statistical Fidelity (mean/std)',
    status,
    message: `${within} of ${rows.length} numeric columns within 10% of the original`,
    detail: rows.slice(0, 4).map(r => r.text).join(' · ') + ' (injected outliers/edge cases excluded)',
  };
}

function checkKs(pairs: NumericPair[], m: ValidationMetrics): ValidationCheck {
  const rows = pairs.map(({ col, c, synthetic, original }) => ({ col, c, ...ksTest(synthetic, original) }))
    .filter(r => !Number.isNaN(r.d))
    .sort((a, b) => a.p - b.p);
  for (const r of rows) m.columns[r.c].ks = { d: r.d, p: r.p, n: r.n, m: r.m };
  const differ = rows.filter(r => r.p < 0.05);
  return {
    name: 'Distribution Similarity (KS test)',
    status: differ.length ? 'warning' : 'passed',
    message: differ.length
      ? `${differ.length} of ${rows.length} numeric columns differ from the original (p < 0.05)`
      : `All ${rows.length} numeric columns match the original distribution (p ≥ 0.05)`,
    detail: rows.slice(0, 5).map(r => `${r.col.name}: D=${r.d.toFixed(3)}, p=${r.p < 0.001 ? r.p.toExponential(1) : r.p.toFixed(3)}`).join(' · ')
      + (rows.some(r => r.n === KS_MAX_SAMPLE || r.m === KS_MAX_SAMPLE) ? ` (up to ${KS_MAX_SAMPLE.toLocaleString()} values per side)` : ''),
  };
}

function checkCategories(input: ValidationInput, m: ValidationMetrics): ValidationCheck | null {
  const { original } = input;
  if (!original) return null;
  const { schema, data, flags } = input.generated;
  const rows: { text: string; status: ValidationStatus; tvd: number }[] = [];
  schema.forEach((col, c) => {
    const kind = input.synthetic.columns[c]?.kind;
    if (kind !== 'categorical' && kind !== 'boolean') return;
    const orig = original.profile.columns.find(p => p.name === (col.sourceColumn ?? col.name));
    if (!orig?.topValues?.length) return;
    const counts = new Map<string, number>();
    let n = 0;
    const values = data[c];
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v === null || (flags && flags[c][i] !== FLAG_NONE)) continue;
      const k = String(v);
      counts.set(k, (counts.get(k) ?? 0) + 1);
      n++;
    }
    if (!n) return;
    const keys = new Set([...counts.keys(), ...orig.topValues.map(t => t.value)]);
    let tvd = 0;
    for (const k of keys) {
      const po = (orig.topValues.find(t => t.value === k)?.pct ?? 0) / 100;
      const ps = (counts.get(k) ?? 0) / n;
      tvd += Math.abs(po - ps);
    }
    tvd += (orig.otherPct ?? 0) / 100;
    tvd /= 2;
    const origN = orig.topValues.reduce((a, t) => a + t.count, 0);
    // Sampling noise grows with the number of categories and shrinks with row count.
    const noise = Math.sqrt((keys.size / (2 * Math.PI)) * (1 / n + 1 / Math.max(1, origN)));
    const tol = Math.max(0.1, 1.5 * noise);
    m.columns[c].tvd = { value: tvd, tolerance: tol };
    m.columns[c].categoryShares = orig.topValues.slice(0, 50).map(t => ({
      value: t.value,
      original: t.pct,
      synthetic: ((counts.get(t.value) ?? 0) / n) * 100,
      originalCount: t.count,
    }));
    rows.push({
      tvd,
      status: tvd <= tol ? 'passed' : tvd <= 2 * tol ? 'warning' : 'failed',
      text: `${col.name}: TVD ${tvd.toFixed(3)} (tolerance ${tol.toFixed(3)}, ${keys.size} categories)`,
    });
  });
  if (!rows.length) return null;
  rows.sort((a, b) => b.tvd - a.tvd);
  const passed = rows.filter(r => r.status === 'passed').length;
  return {
    name: 'Category Distribution',
    status: worst(rows.map(r => r.status)),
    message: `${passed} of ${rows.length} categorical columns match the original frequencies`,
    detail: rows.slice(0, 4).map(r => r.text).join(' · '),
  };
}

function checkCorrelations(input: ValidationInput, pairs: NumericPair[], m: ValidationMetrics): ValidationCheck | null {
  const { original } = input;
  if (!original || pairs.length < 2) return null;
  const { schema, data, flags, rowCount } = input.generated;
  const views = new Map<string, Float64Array>();
  for (const p of pairs) {
    const c = schema.indexOf(p.col);
    const view = numericView(p.col, data[c]);
    if (flags) for (let i = 0; i < view.length; i++) if (flags[c][i] !== FLAG_NONE) view[i] = NaN;
    views.set(p.col.sourceColumn ?? p.col.name, view);
  }
  const diffs: { text: string; diff: number }[] = [];
  for (const oc of original.profile.correlations) {
    const a = views.get(oc.a), b = views.get(oc.b);
    if (!a || !b) continue;
    const s = pearson(a, b);
    if (!s) continue;
    const diff = Math.abs(s.r - oc.r);
    m.correlations.push({ a: oc.a, b: oc.b, original: oc.r, synthetic: s.r });
    diffs.push({ diff, text: `${oc.a}×${oc.b}: ${s.r.toFixed(2)} vs ${oc.r.toFixed(2)}` });
  }
  if (!diffs.length) return null;
  diffs.sort((x, y) => y.diff - x.diff);
  const noise = 2 / Math.sqrt(Math.max(4, Math.min(rowCount, original.rowCount)));
  const maxDiff = diffs[0].diff;
  const meanDiff = diffs.reduce((a, d) => a + d.diff, 0) / diffs.length;
  const tol = 0.1 + noise;
  return {
    name: 'Correlation Preservation',
    status: maxDiff <= tol ? 'passed' : maxDiff <= 2 * tol ? 'warning' : 'failed',
    message: `Max |Δr| ${maxDiff.toFixed(3)}, mean |Δr| ${meanDiff.toFixed(3)} across ${diffs.length} column pairs (tolerance ${tol.toFixed(2)})`,
    detail: diffs.slice(0, 4).map(d => d.text).join(' · ') + ' (synthetic vs original)',
  };
}

function checkPrivacy(input: ValidationInput, m: ValidationMetrics): ValidationCheck | null {
  const { original } = input;
  if (!original) return null;
  const { schema, data, rowCount } = input.generated;
  const cols = schema.map((col, c) => ({ col, values: data[c], src: original.columns[col.sourceColumn ?? col.name] }))
    .filter(x => x.src);
  if (!cols.length) return null;
  const originalRows = new Set<string>();
  for (let i = 0; i < original.rowCount; i++) {
    originalRows.add(cols.map(x => canonical(x.src[i], x.col)).join('\u0001'));
  }
  let copies = 0;
  for (let i = 0; i < rowCount; i++) {
    if (originalRows.has(cols.map(x => canonical(x.values[i], x.col)).join('\u0001'))) copies++;
  }
  m.copiedRows = copies;
  const rate = rowCount ? copies / rowCount : 0;
  return {
    name: 'Privacy: No Copied Rows',
    status: copies === 0 ? 'passed' : rate <= 0.05 ? 'warning' : 'failed',
    message: copies === 0
      ? `None of the ${rowCount.toLocaleString()} rows is an exact copy of an original row`
      : `${copies.toLocaleString()} rows (${pct(rate, 2)}) exactly match an original row`,
    detail: `Compared ${cols.length} columns against ${original.rowCount.toLocaleString()} original rows`
      + (copies ? ' · with few low-cardinality columns some matches can occur by chance' : ''),
  };
}

/** After transforms, no high-privacy column may contain a value that exists in the uploaded file. */
function checkPiiLeak(input: ValidationInput, m: ValidationMetrics): ValidationCheck | null {
  const { original } = input;
  if (!original) return null;
  const { schema, data } = input.generated;
  const cols = schema.map((col, c) => ({ col, c, src: col.sourceColumn ? original.columns[col.sourceColumn] : undefined }))
    .filter(x => x.col.privacyLevel === 'high' && x.src);
  if (!cols.length) return null;
  const rows: string[] = [];
  let leakedTotal = 0;
  let checked = 0;
  for (const { col, c, src } of cols) {
    const real = new Set<string>();
    for (let i = 0; i < src!.length; i++) {
      const v = src![i];
      if (v !== null && v !== undefined) real.add(String(v).trim().toLowerCase());
    }
    let leaked = 0;
    const values = data[c];
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v === null) continue;
      checked++;
      if (real.has(String(v).trim().toLowerCase())) leaked++;
    }
    m.columns[c].leakedValues = leaked;
    leakedTotal += leaked;
    rows.push(`${col.name} (${col.privacyTransform ?? 'preserve'}): ${leaked ? `${leaked.toLocaleString()} original values` : '0 original values'}`);
  }
  return {
    name: 'Privacy: No Original PII Values',
    status: leakedTotal ? 'failed' : 'passed',
    message: leakedTotal
      ? `${leakedTotal.toLocaleString()} values in high-privacy columns also appear in the uploaded file`
      : `None of ${checked.toLocaleString()} values in ${cols.length} high-privacy column${cols.length === 1 ? '' : 's'} appears in the uploaded file`,
    detail: rows.join(' · '),
  };
}

// ─── Documents ───────────────────────────────────────────────────────────────

function docResult(checks: ValidationCheck[], kind: 'invoice' | 'bank_statement', total: number, consistent: number): ValidationResult {
  return {
    overall: worst(checks.map(c => c.status)),
    checks,
    notes: [],
    metrics: { hasOriginal: false, columns: [], correlations: [], documents: { kind, total, consistent } },
  };
}

const money = (cents: number) => (cents / 100).toFixed(2);

export function validateInvoices(invoices: Invoice[], config: InvoiceConfig): ValidationResult {
  const from = config.dateFrom, to = config.dateTo;
  let lineErrors = 0, subtotalErrors = 0, taxErrors = 0, totalErrors = 0, dateErrors = 0;
  const examples: string[] = [];
  let consistent = 0;
  for (const inv of invoices) {
    let ok = true;
    const badLines = inv.lines.filter(l => l.amountCents !== l.qty * l.unitPriceCents).length;
    const subtotal = inv.lines.reduce((a, l) => a + l.amountCents, 0);
    const tax = Math.round((subtotal * inv.taxRate) / 100);
    if (badLines) { lineErrors += badLines; ok = false; }
    if (subtotal !== inv.subtotalCents) { subtotalErrors++; ok = false; }
    if (tax !== inv.taxCents) { taxErrors++; ok = false; }
    if (inv.subtotalCents + inv.taxCents !== inv.totalCents) { totalErrors++; ok = false; }
    if (inv.issueDate < from || inv.issueDate > to || inv.dueDate < inv.issueDate) { dateErrors++; ok = false; }
    if (!ok && examples.length < 3) examples.push(`${inv.number}: subtotal ${money(inv.subtotalCents)} vs ${money(subtotal)}, total ${money(inv.totalCents)}`);
    if (ok) consistent++;
  }
  const numbers = new Set(invoices.map(i => i.number));
  const lineTotal = invoices.reduce((a, i) => a + i.lines.length, 0);
  const grand = invoices.reduce((a, i) => a + i.totalCents, 0);
  const mathErrors = lineErrors + subtotalErrors + taxErrors + totalErrors;
  const checks: ValidationCheck[] = [
    {
      name: 'Invoice Count',
      status: invoices.length === config.count ? 'passed' : 'failed',
      message: `${invoices.length.toLocaleString()} invoices generated (requested ${config.count.toLocaleString()})`,
      detail: `${numbers.size.toLocaleString()} unique invoice numbers${numbers.size !== invoices.length ? ` — ${invoices.length - numbers.size} duplicates` : ''}`,
    },
    {
      name: 'Totals Reconcile',
      status: mathErrors ? 'failed' : 'passed',
      message: mathErrors
        ? `${mathErrors} arithmetic errors across ${invoices.length - consistent} invoices`
        : `All ${invoices.length.toLocaleString()} invoices: amount = qty × price, subtotal = Σ lines, tax = subtotal × ${config.taxRate}%, total = subtotal + tax`,
      detail: mathErrors
        ? `Line ${lineErrors}, subtotal ${subtotalErrors}, tax ${taxErrors}, total ${totalErrors}. ${examples.join(' · ')}`
        : `${lineTotal.toLocaleString()} line items checked in integer cents · grand total ${money(grand)} ${config.currency}`,
    },
    {
      name: 'Dates In Range',
      status: dateErrors ? 'failed' : 'passed',
      message: dateErrors ? `${dateErrors} invoices have an issue date outside ${from} – ${to} or a due date before issue` : `All issue dates within ${from} – ${to}; all due dates on or after issue`,
      detail: invoices.length ? `Earliest ${invoices.reduce((a, i) => (i.issueDate < a ? i.issueDate : a), invoices[0].issueDate)}, latest ${invoices.reduce((a, i) => (i.issueDate > a ? i.issueDate : a), invoices[0].issueDate)}` : '',
    },
  ];
  return docResult(checks, 'invoice', invoices.length, consistent);
}

export function validateStatements(statements: BankStatement[], config: BankStatementConfig): ValidationResult {
  const floor = config.minBalance ?? (config.preventNegative ? 0 : undefined);
  const floorCents = floor === undefined ? undefined : Math.round(floor * 100);
  const minCents = config.minAmount !== undefined ? Math.round(config.minAmount * 100) : undefined;
  const maxCents = config.maxAmount !== undefined ? Math.round(config.maxAmount * 100) : undefined;
  let stepErrors = 0, closingErrors = 0, dateErrors = 0, orderErrors = 0, floorBreaches = 0, amountErrors = 0, countErrors = 0;
  let lowest = Infinity;
  let consistent = 0;
  for (const s of statements) {
    let ok = true;
    let balance = s.openingBalanceCents, debits = 0, credits = 0;
    let prevDate = '';
    for (const t of s.transactions) {
      balance = balance - t.debitCents + t.creditCents;
      debits += t.debitCents; credits += t.creditCents;
      if (balance !== t.balanceCents) { stepErrors++; ok = false; }
      if (t.date < s.periodFrom || t.date > s.periodTo) { dateErrors++; ok = false; }
      if (t.date < prevDate) { orderErrors++; ok = false; }
      prevDate = t.date;
      if (t.balanceCents < lowest) lowest = t.balanceCents;
      if (floorCents !== undefined && t.balanceCents < floorCents) { floorBreaches++; ok = false; }
      const amt = t.debitCents || t.creditCents;
      if ((minCents !== undefined && amt < minCents) || (maxCents !== undefined && amt > maxCents)) { amountErrors++; ok = false; }
    }
    if (s.openingBalanceCents + credits - debits !== s.closingBalanceCents || debits !== s.totalDebitsCents || credits !== s.totalCreditsCents) { closingErrors++; ok = false; }
    if (s.transactions.length !== config.transactionCount) { countErrors++; ok = false; }
    if (ok) consistent++;
  }
  const txTotal = statements.reduce((a, s) => a + s.transactions.length, 0);
  const checks: ValidationCheck[] = [
    {
      name: 'Statement Count',
      status: statements.length === config.count && !countErrors ? 'passed' : 'failed',
      message: `${statements.length} statements generated (requested ${config.count}), ${txTotal.toLocaleString()} transactions`,
      detail: countErrors ? `${countErrors} statements do not have ${config.transactionCount} transactions` : `Each statement has exactly ${config.transactionCount} transactions`,
    },
    {
      name: 'Balances Reconcile',
      status: stepErrors || closingErrors ? 'failed' : 'passed',
      message: stepErrors || closingErrors
        ? `${stepErrors} running-balance errors and ${closingErrors} closing-balance mismatches`
        : `Every running balance = previous − debit + credit; every closing balance = opening + credits − debits`,
      detail: statements.slice(0, 3).map(s => `${s.id}: ${money(s.openingBalanceCents)} + ${money(s.totalCreditsCents)} − ${money(s.totalDebitsCents)} = ${money(s.closingBalanceCents)}`).join(' · '),
    },
    {
      name: 'Dates In Range & Sorted',
      status: dateErrors || orderErrors ? 'failed' : 'passed',
      message: dateErrors || orderErrors ? `${dateErrors} transactions outside ${config.dateFrom} – ${config.dateTo}, ${orderErrors} out of order` : `All transactions within ${config.dateFrom} – ${config.dateTo}, sorted by date`,
      detail: `${txTotal.toLocaleString()} transactions checked`,
    },
  ];
  if (floorCents !== undefined) {
    checks.push({
      name: 'Minimum Balance',
      status: floorBreaches ? 'failed' : 'passed',
      message: floorBreaches ? `${floorBreaches} balances dropped below ${money(floorCents)}` : `Balance never below ${money(floorCents)}`,
      detail: `Lowest balance across all statements: ${Number.isFinite(lowest) ? money(lowest) : '—'}`,
    });
  }
  if (minCents !== undefined || maxCents !== undefined) {
    checks.push({
      name: 'Amount Limits',
      status: amountErrors ? 'failed' : 'passed',
      message: amountErrors ? `${amountErrors} transactions outside the amount limits` : `All amounts within ${minCents !== undefined ? money(minCents) : '0'} – ${maxCents !== undefined ? money(maxCents) : '∞'}`,
      detail: `${txTotal.toLocaleString()} transactions checked`,
    });
  }
  return docResult(checks, 'bank_statement', statements.length, consistent);
}

// ─── Relational ──────────────────────────────────────────────────────────────

export interface RelationalValidationTable {
  name: string;
  schema: ColumnSchema[];
  data: ArrayLike<Cell>[];
  rowCount: number;
}

export interface RelationalValidationInput {
  tables: RelationalValidationTable[];
  /** Expanded relationships (N:N already turned into join tables). */
  relationships: Relationship[];
  /** Join tables whose (A, B) pairs must be unique. */
  joins: { table: string; colA: string; colB: string }[];
  rules: ConsistencyRule[];
  /** Recomputes a rule's expected parent values from the child rows. */
  computeRule: (rule: ConsistencyRule) => (number | null)[] | null;
}

export function validateRelational(input: RelationalValidationInput): ValidationResult {
  const table = (n: string) => input.tables.find(t => t.name === n);
  const col = (t: RelationalValidationTable, c: string) => t.data[t.schema.findIndex(x => x.name === c)];
  const relMetrics: RelationshipMetric[] = [];
  const ruleMetrics: RuleMetric[] = [];

  for (const r of input.relationships) {
    const parent = table(r.parentTable), child = table(r.childTable);
    const label = `${r.childTable}.${r.childColumn} → ${r.parentTable}.${r.parentColumn}`;
    if (!parent || !child) continue;
    const keys = col(parent, r.parentColumn);
    const fks = col(child, r.childColumn);
    const children = new Map<string, number>();
    for (let i = 0; i < parent.rowCount; i++) if (keys[i] !== null) children.set(String(keys[i]), 0);
    let orphans = 0, nullFks = 0, fkValues = 0;
    for (let i = 0; i < child.rowCount; i++) {
      const v = fks[i];
      if (v === null) { nullFks++; continue; }
      fkValues++;
      const k = String(v);
      const n = children.get(k);
      if (n === undefined) orphans++;
      else children.set(k, n + 1);
    }
    const counts = [...children.values()];
    let violations = 0;
    let detail: string;
    if (r.cardinality === '1:1') {
      violations = counts.filter(c => c > 1).length;
      detail = `${violations} parents with more than 1 child (max ${counts.length ? Math.max(...counts) : 0})`;
    } else if (r.minChildren !== undefined || r.maxChildren !== undefined) {
      const lo = r.minChildren ?? 0, hi = r.maxChildren ?? Infinity;
      violations = counts.filter(c => c < lo || c > hi).length;
      detail = `children per parent: min ${counts.length ? Math.min(...counts) : 0}, max ${counts.length ? Math.max(...counts) : 0} (allowed ${lo}–${hi === Infinity ? '∞' : hi}), ${violations} parents outside`;
    } else {
      detail = `children per parent: min ${counts.length ? Math.min(...counts) : 0}, max ${counts.length ? Math.max(...counts) : 0} (no limit set)`;
    }
    relMetrics.push({ id: r.id, label, cardinality: r.cardinality, fkValues, orphans, nullFks, cardinalityViolations: violations, cardinalityDetail: detail });
  }

  for (const j of input.joins) {
    const t = table(j.table);
    if (!t) continue;
    const a = col(t, j.colA), b = col(t, j.colB);
    const seen = new Set<string>();
    let dup = 0;
    for (let i = 0; i < t.rowCount; i++) {
      const k = `${a[i]}\u0001${b[i]}`;
      if (seen.has(k)) dup++;
      else seen.add(k);
    }
    relMetrics.push({
      id: `${j.table}_pairs`, label: `${j.table} (${j.colA}, ${j.colB}) pairs`, cardinality: 'N:N', fkValues: 0, orphans: 0, nullFks: 0,
      cardinalityViolations: dup, cardinalityDetail: `${dup} duplicate pairs among ${t.rowCount.toLocaleString()} links`,
    });
  }

  for (const rule of input.rules) {
    const parent = table(rule.parentTable);
    const expected = input.computeRule(rule);
    if (!parent || !expected) continue;
    const actual = col(parent, rule.parentColumn);
    let mismatches = 0, maxDiff = 0;
    for (let i = 0; i < parent.rowCount; i++) {
      const e = expected[i];
      const a = actual[i] === null || actual[i] === undefined ? null : toNumber(actual[i]);
      if (e === null && a === null) continue;
      const diff = e === null || a === null ? Infinity : Math.abs(e - a);
      if (diff > 0.01 + Math.abs(e ?? 0) * 1e-9) mismatches++;
      if (Number.isFinite(diff)) maxDiff = Math.max(maxDiff, diff);
    }
    const expr = rule.aggregate === 'COUNT' ? `COUNT(${rule.childTable})` : `${rule.aggregate}(${rule.terms.map(t => `${rule.childTable}.${t}`).join(' × ')})`;
    ruleMetrics.push({ id: rule.id, label: `${rule.parentTable}.${rule.parentColumn} = ${expr}`, parentsChecked: parent.rowCount, mismatches, maxDiff });
  }

  const checks: ValidationCheck[] = [];
  const fkRels = relMetrics.filter(r => r.cardinality !== 'N:N' || r.fkValues > 0);
  if (fkRels.length) {
    const orphans = fkRels.reduce((a, r) => a + r.orphans, 0);
    const nulls = fkRels.reduce((a, r) => a + r.nullFks, 0);
    const total = fkRels.reduce((a, r) => a + r.fkValues, 0);
    checks.push({
      name: 'Referential Integrity',
      status: orphans || nulls ? 'failed' : 'passed',
      message: orphans || nulls
        ? `${orphans.toLocaleString()} orphan rows and ${nulls.toLocaleString()} empty foreign keys across ${fkRels.length} relationships`
        : `0 orphan rows — all ${total.toLocaleString()} foreign key values point to an existing parent row`,
      detail: fkRels.map(r => `${r.label}: ${r.orphans} orphans / ${r.fkValues.toLocaleString()}`).join(' · '),
    });
  }
  if (relMetrics.length) {
    const bad = relMetrics.filter(r => r.cardinalityViolations);
    checks.push({
      name: 'Cardinality',
      status: bad.length ? 'failed' : 'passed',
      message: bad.length ? `${bad.length} of ${relMetrics.length} relationships break their cardinality` : `All ${relMetrics.length} relationships respect their cardinality`,
      detail: relMetrics.map(r => `${r.label} [${r.cardinality}]: ${r.cardinalityDetail}`).join(' · '),
    });
  }
  const notes: string[] = [];
  if (ruleMetrics.length) {
    const bad = ruleMetrics.filter(r => r.mismatches);
    checks.push({
      name: 'Totals Reconcile',
      status: bad.length ? 'failed' : 'passed',
      message: bad.length
        ? `${bad.reduce((a, r) => a + r.mismatches, 0).toLocaleString()} parent rows do not match their children`
        : `All ${ruleMetrics.reduce((a, r) => a + r.parentsChecked, 0).toLocaleString()} parent rows equal the aggregate of their children`,
      detail: ruleMetrics.map(r => `${r.label}: ${r.mismatches} mismatches in ${r.parentsChecked.toLocaleString()} rows, max diff ${r.maxDiff.toFixed(4)}`).join(' · '),
    });
  } else {
    notes.push('No cross-table consistency rules were defined, so totals were not reconciled.');
  }
  if (!relMetrics.length) notes.push('No relationships were defined.');

  return {
    overall: worst(checks.map(c => c.status)),
    checks,
    notes,
    metrics: { hasOriginal: false, columns: [], correlations: [], relationships: relMetrics, rules: ruleMetrics },
  };
}

export function validateTabular(input: ValidationInput): ValidationResult {
  const m: ValidationMetrics = {
    hasOriginal: !!input.original,
    columns: input.generated.schema.map(col => ({
      column: col.name, type: col.type, invalid: 0, unique: !!col.unique && col.privacyTransform !== 'mask',
      nullRateSynthetic: 0, nullRateTarget: 0, privacyLevel: col.privacyLevel, transform: col.privacyTransform,
    })),
    correlations: [],
  };
  const checks: ValidationCheck[] = [checkRowCount(input), checkSchema(input, m), checkUniqueness(input, m), checkNullRate(input, m)];
  const notes: string[] = [];

  const rules = input.config.columnRules ?? [];
  if (rules.length) {
    const { schema, data, rowCount } = input.generated;
    const rc = checkRules(schema, data, rowCount, rules);
    m.columnRules = rc;
    const broken = rc.rules.filter(r => r.violations);
    checks.push({
      name: 'Business Rules',
      status: broken.length ? 'failed' : 'passed',
      message: broken.length
        ? `${(rc.rows - rc.passing).toLocaleString()} of ${rc.rows.toLocaleString()} rows break at least one rule`
        : `All ${rc.rows.toLocaleString()} rows satisfy ${rules.length} rule${rules.length === 1 ? '' : 's'}`,
      detail: rc.rules.map(r => `${r.label}: ${r.violations.toLocaleString()} violations`).join(' · '),
    });
  }

  if (!input.original) {
    notes.push('No file was uploaded, so comparisons with original data (mean/std, KS test, categories, correlations, copied rows) were not run.');
  } else {
    const pairs = numericPairs(input);
    if (pairs.length) {
      checks.push(checkMoments(pairs, m), checkKs(pairs, m));
    } else {
      notes.push('No numeric columns to compare with the original data.');
    }
    const cat = checkCategories(input, m);
    if (cat) checks.push(cat);
    else notes.push('No categorical columns to compare with the original data.');
    const corr = checkCorrelations(input, pairs, m);
    if (corr) checks.push(corr);
    else notes.push('Correlation check needs at least two numeric columns with learned correlations.');
    const priv = checkPrivacy(input, m);
    if (priv) checks.push(priv);
    const leak = checkPiiLeak(input, m);
    if (leak) checks.push(leak);
    else notes.push('No high-privacy columns to check for original values.');
  }

  return { overall: worst(checks.map(c => c.status)), checks, notes, metrics: m };
}
