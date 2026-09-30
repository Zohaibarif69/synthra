// Learns statistics from data. Used for the uploaded file (to drive generation) and
// for generated rows (for the Statistics and Validation tabs).

import type {
  Cell, ColumnProfile, ColumnSchema, DataRow, DatasetProfile, NumericCorrelation, ParsedDataset,
} from '../types';
import { columnKind, decimalsOf, toNumber } from './infer';
import { formatDate, parseDateWithFormat } from './dates';
import { latentCorrelations } from './latent';

export interface ProfileInput {
  column: ColumnSchema;
  values: ArrayLike<Cell>;
}

export interface ProfileOptions {
  /** Keep top values of high-privacy columns. Off for real uploads so real PII never leaves the profile. */
  includeSensitiveValues?: boolean;
  /** Max categories kept per column. */
  maxTopValues?: number;
  /** Compute latent correlations for the generator (default true; off for profiles of generated data). */
  latent?: boolean;
}

const MAX_CORRELATION_COLUMNS = 30;

export function sortedNumbers(values: number[]): Float64Array {
  const arr = Float64Array.from(values);
  arr.sort();
  return arr;
}

/** Linear-interpolated quantile of an ascending array, q in [0, 1]. */
export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  const pos = (n - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function numericSummary(nums: number[]) {
  const sorted = sortedNumbers(nums);
  const n = sorted.length;
  if (!n) return {};
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (sorted[i] - mean) ** 2;
  const quantiles: number[] = [];
  for (let p = 0; p <= 100; p++) quantiles.push(quantileSorted(sorted, p / 100));
  return {
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median: quantileSorted(sorted, 0.5),
    stdDev: n > 1 ? Math.sqrt(sq / (n - 1)) : 0,
    quantiles,
  };
}

/** Numeric view of a column: numbers, or epoch ms for dates. NaN where missing/invalid. */
export function numericView(column: ColumnSchema, values: ArrayLike<Cell>): Float64Array {
  const out = new Float64Array(values.length);
  const isDate = column.type === 'date' || column.type === 'datetime';
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) { out[i] = NaN; continue; }
    const x = isDate ? parseDateWithFormat(String(v), column.format) : toNumber(v);
    out[i] = x === null ? NaN : x;
  }
  return out;
}

export function profileColumn(column: ColumnSchema, values: ArrayLike<Cell>, opts: ProfileOptions = {}): ColumnProfile {
  const n = values.length;
  const counts = new Map<string, number>();
  let nullCount = 0;
  let totalLength = 0;
  let minLength = Infinity;
  let maxLength = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v === null || v === undefined) { nullCount++; continue; }
    const s = typeof v === 'string' ? v : String(v);
    counts.set(s, (counts.get(s) ?? 0) + 1);
    totalLength += s.length;
    if (s.length < minLength) minLength = s.length;
    if (s.length > maxLength) maxLength = s.length;
  }
  const nonNull = n - nullCount;
  const kind = columnKind(column, counts.size, nonNull);

  const profile: ColumnProfile = {
    name: column.name,
    type: column.type,
    kind,
    nullCount,
    nullRate: n ? nullCount / n : 0,
    uniqueCount: counts.size,
    invalidCount: 0,
  };

  if (column.type === 'integer' || column.type === 'float') {
    const nums: number[] = [];
    let decimals = 0;
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (v === null || v === undefined) continue;
      const x = toNumber(v);
      if (x === null) { profile.invalidCount++; continue; }
      nums.push(x);
      if (column.type === 'float' && decimals < 6) decimals = Math.max(decimals, decimalsOf(v, x));
    }
    Object.assign(profile, numericSummary(nums), { decimals: Math.min(decimals, 6) });
  } else if (column.type === 'date' || column.type === 'datetime') {
    const ts: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (v === null || v === undefined) continue;
      const t = parseDateWithFormat(String(v), column.format);
      if (t === null) profile.invalidCount++;
      else ts.push(t);
    }
    const s = numericSummary(ts);
    if (s.min !== undefined && s.max !== undefined) {
      profile.minTs = s.min;
      profile.maxTs = s.max;
      profile.quantiles = s.quantiles;
      profile.min = formatDate(s.min, column.format);
      profile.max = formatDate(s.max, column.format);
    }
  } else if (nonNull) {
    profile.avgLength = totalLength / nonNull;
    profile.minLength = minLength;
    profile.maxLength = maxLength;
  }

  const sensitive = column.privacyLevel === 'high' && !opts.includeSensitiveValues;
  const wantValues = kind === 'categorical' || kind === 'boolean' || kind === 'text' || kind === 'identifier';
  if (wantValues && !sensitive && nonNull) {
    const limit = kind === 'categorical' || kind === 'boolean' ? (opts.maxTopValues ?? 200) : 20;
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit);
    profile.topValues = top.map(([value, count]) => ({ value, count, pct: (count / nonNull) * 100 }));
    const covered = top.reduce((a, [, c]) => a + c, 0);
    profile.otherPct = ((nonNull - covered) / nonNull) * 100;
  }
  return profile;
}

/** Pearson correlation over rows where both values are present. */
export function pearson(a: Float64Array, b: Float64Array): { r: number; n: number } | null {
  let n = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i]) || Number.isNaN(b[i])) continue;
    n++; sa += a[i]; sb += b[i];
  }
  if (n < 3) return null;
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i]) || Number.isNaN(b[i])) continue;
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  if (va === 0 || vb === 0) return null;
  return { r: cov / Math.sqrt(va * vb), n };
}

export function buildProfile(inputs: ProfileInput[], rowCount: number, opts: ProfileOptions = {}): DatasetProfile {
  const columns = inputs.map(i => profileColumn(i.column, i.values, opts));

  const numeric = inputs
    .map((input, idx) => ({ input, profile: columns[idx] }))
    .filter(x => x.profile.kind === 'numeric')
    .slice(0, MAX_CORRELATION_COLUMNS)
    .map(x => ({ name: x.input.column.name, view: numericView(x.input.column, x.input.values) }));

  const correlations: NumericCorrelation[] = [];
  for (let i = 0; i < numeric.length; i++) {
    for (let j = i + 1; j < numeric.length; j++) {
      const c = pearson(numeric[i].view, numeric[j].view);
      if (c) correlations.push({ a: numeric[i].name, b: numeric[j].name, r: Math.round(c.r * 10000) / 10000, n: c.n });
    }
  }
  const profile: DatasetProfile = { rowCount, columnCount: inputs.length, columns, correlations };
  if (opts.latent !== false) profile.latentCorrelations = latentCorrelations(inputs, columns, numericView, MAX_CORRELATION_COLUMNS);
  return profile;
}

export function columnValues(rows: DataRow[], key: string): Cell[] {
  return rows.map(r => r[key] ?? null);
}

/** Profile of an uploaded file, using its inferred schema. Real PII values are never stored. */
export function profileDataset(dataset: ParsedDataset, schema: ColumnSchema[]): DatasetProfile {
  return buildProfile(
    schema.map(column => ({ column, values: columnValues(dataset.rows, column.sourceColumn ?? column.name) })),
    dataset.rows.length,
  );
}
