// Latent (Gaussian copula) correlations across numeric, categorical and boolean columns.
//
// The generator draws one correlated normal value per column per row and turns it into a cell. For that to
// keep relationships such as "month-to-month contracts churn more", every column needs a position on the
// same normal scale:
//   • numeric: normal scores of the ranks (Φ⁻¹ of the percentile);
//   • categorical / boolean: each category owns a slice of the normal scale, in the same order and with the
//     same widths the generator uses, and a value is placed at the slice's mean, E[Z | category].
// Correlations measured on these scores are corrected for the coarseness of categories (a category's score
// explains only part of the latent variable), giving the latent correlation the generator should use.

import type { Cell, ColumnProfile, ColumnSchema, NumericCorrelation } from '../types';

const MAX_LATENT_CATEGORIES = 50;
const MAX_R = 0.97;

/** Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function normalInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425, hi = 1 - lo;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > hi) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function normalPdf(z: number): number {
  return Number.isFinite(z) ? Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI) : 0;
}

/**
 * Categories in the order the generator lays them out on the normal scale: by count, descending, ties in
 * profile order (a stable sort, exactly like the generator's category pool).
 */
export function orderedCategories(top: NonNullable<ColumnProfile['topValues']>): { value: string; weight: number }[] {
  const total = top.reduce((a, t) => a + t.count, 0) || 1;
  return [...top].sort((a, b) => b.count - a.count).map(t => ({ value: t.value, weight: t.count / total }));
}

interface Scores {
  name: string;
  z: Float64Array;
  /** sd of E[Z | value]: 1 for continuous scores, < 1 for categories. */
  scale: number;
}

function numericScores(column: ColumnSchema, values: ArrayLike<Cell>, view: (c: ColumnSchema, v: ArrayLike<Cell>) => Float64Array): Scores | null {
  const x = view(column, values);
  const idx: number[] = [];
  for (let i = 0; i < x.length; i++) if (!Number.isNaN(x[i])) idx.push(i);
  if (idx.length < 3) return null;
  idx.sort((a, b) => x[a] - x[b]);
  const z = new Float64Array(x.length).fill(NaN);
  const m = idx.length;
  for (let i = 0; i < m;) {
    let j = i;
    while (j + 1 < m && x[idx[j + 1]] === x[idx[i]]) j++;
    const u = ((i + j) / 2 + 0.5) / m; // average rank of ties, as a percentile
    const score = normalInv(u);
    for (let k = i; k <= j; k++) z[idx[k]] = score;
    i = j + 1;
  }
  return { name: column.name, z, scale: 1 };
}

function categoricalScores(column: ColumnSchema, values: ArrayLike<Cell>, profile: ColumnProfile): Scores | null {
  const cats = orderedCategories(profile.topValues ?? []);
  if (cats.length < 2 || cats.length > MAX_LATENT_CATEGORIES) return null;
  const mean = new Map<string, number>();
  let cum = 0, variance = 0;
  for (const c of cats) {
    const a = normalInv(cum), b = normalInv(Math.min(1, cum + c.weight));
    const m = (normalPdf(a) - normalPdf(b)) / c.weight; // E[Z | Z in the category's slice]
    mean.set(c.value, m);
    variance += c.weight * m * m;
    cum += c.weight;
  }
  const z = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const m = v === null || v === undefined ? undefined : mean.get(typeof v === 'string' ? v : String(v));
    z[i] = m === undefined ? NaN : m;
  }
  return { name: column.name, z, scale: Math.sqrt(variance) };
}

function correlation(a: Float64Array, b: Float64Array): { r: number; n: number } | null {
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
  return va && vb ? { r: cov / Math.sqrt(va * vb), n } : null;
}

/** Latent correlations for every pair of numeric, categorical and boolean columns (up to `maxColumns`). */
export function latentCorrelations(
  inputs: { column: ColumnSchema; values: ArrayLike<Cell> }[],
  profiles: ColumnProfile[],
  numericView: (c: ColumnSchema, v: ArrayLike<Cell>) => Float64Array,
  maxColumns: number,
): NumericCorrelation[] {
  const scores: Scores[] = [];
  inputs.forEach((input, i) => {
    if (scores.length >= maxColumns) return;
    const p = profiles[i];
    const s = p.kind === 'numeric' ? numericScores(input.column, input.values, numericView)
      : p.kind === 'categorical' || p.kind === 'boolean' ? categoricalScores(input.column, input.values, p)
      : null;
    if (s && s.scale > 0) scores.push(s);
  });
  const out: NumericCorrelation[] = [];
  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) {
      const c = correlation(scores[i].z, scores[j].z);
      if (!c) continue;
      const r = Math.max(-MAX_R, Math.min(MAX_R, c.r / (scores[i].scale * scores[j].scale)));
      out.push({ a: scores[i].name, b: scores[j].name, r: Math.round(r * 10000) / 10000, n: c.n });
    }
  }
  return out;
}
