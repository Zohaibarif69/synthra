// Summaries of generated data for the Statistics tab: dataset totals, histograms and CSV size.

import type { Cell, ColumnSchema, DatasetProfile, DatasetStatistics, HistogramBin, NumericHistogram } from '../types';
import { numericView, quantileSorted } from './profile';

const HISTOGRAM_BINS = 20;
const MAX_HISTOGRAMS = 12;

/** Totals plus per-column stats. Outliers are counted with Tukey's rule (outside 1.5×IQR). */
export function datasetStatistics(schema: ColumnSchema[], data: ArrayLike<Cell>[], profile: DatasetProfile): DatasetStatistics {
  let missing = 0;
  let outliers = 0;
  profile.columns.forEach((p, c) => {
    missing += p.nullCount;
    if (p.kind !== 'numeric' || !p.quantiles) return;
    const q1 = p.quantiles[25], q3 = p.quantiles[75];
    const iqr = q3 - q1;
    if (!(iqr > 0)) return;
    const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
    const view = numericView(schema[c], data[c]);
    for (let i = 0; i < view.length; i++) if (view[i] < lo || view[i] > hi) outliers++;
  });
  const cells = profile.rowCount * profile.columnCount;
  return {
    rowCount: profile.rowCount,
    columnCount: profile.columnCount,
    missingValues: missing,
    missingRate: cells ? missing / cells : 0,
    outlierCount: outliers,
    columns: profile.columns,
  };
}

function binLabel(x: number): string {
  const a = Math.abs(x);
  if (a >= 1e6) return (x / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return (x / 1e3).toFixed(0) + 'K';
  if (a >= 100) return x.toFixed(0);
  if (a >= 1) return x.toFixed(1);
  return x.toFixed(2);
}

function counts(view: Float64Array, lo: number, hi: number): { bins: number[]; below: number; above: number; n: number } {
  const bins = new Array<number>(HISTOGRAM_BINS).fill(0);
  let below = 0, above = 0, n = 0;
  const width = (hi - lo) / HISTOGRAM_BINS;
  for (let i = 0; i < view.length; i++) {
    const v = view[i];
    if (Number.isNaN(v)) continue;
    n++;
    if (v < lo) below++;
    else if (v > hi) above++;
    else bins[width > 0 ? Math.min(HISTOGRAM_BINS - 1, Math.floor((v - lo) / width)) : 0]++;
  }
  return { bins, below, above, n };
}

/**
 * Histogram per numeric column on shared bin edges (the original range when a file was uploaded),
 * as % of non-null values so datasets of different sizes compare directly.
 */
export function numericHistograms(
  schema: ColumnSchema[],
  data: ArrayLike<Cell>[],
  synthetic: DatasetProfile,
  original?: { profile: DatasetProfile; columns: Record<string, ArrayLike<Cell>> },
): NumericHistogram[] {
  const out: NumericHistogram[] = [];
  schema.forEach((col, c) => {
    if (out.length >= MAX_HISTOGRAMS) return;
    const sp = synthetic.columns[c];
    if (sp.kind !== 'numeric') return;
    const key = col.sourceColumn ?? col.name;
    const op = original?.profile.columns.find(p => p.name === key);
    const src = original?.columns[key];
    const useOriginal = !!(op && op.kind === 'numeric' && src && typeof op.min === 'number' && typeof op.max === 'number');

    const synthView = numericView(col, data[c]);
    let lo: number, hi: number;
    if (useOriginal) {
      lo = op!.min as number;
      hi = op!.max as number;
    } else {
      // Without an original, use the synthetic 1st–99th percentile so injected outliers don't flatten the chart.
      const sorted = Float64Array.from(synthView.filter(v => !Number.isNaN(v))).sort();
      if (!sorted.length) return;
      lo = quantileSorted(sorted, 0.01);
      hi = quantileSorted(sorted, 0.99);
    }
    if (!(hi >= lo)) return;

    const s = counts(synthView, lo, hi);
    const o = useOriginal ? counts(numericView({ ...col, type: op!.type as ColumnSchema['type'] }, src!), lo, hi) : null;
    const share = (x: number, n: number) => (n ? (x / n) * 100 : 0);
    const width = (hi - lo) / HISTOGRAM_BINS;

    const bins: HistogramBin[] = [];
    if (s.below || o?.below) bins.push({ label: `< ${binLabel(lo)}`, synthetic: share(s.below, s.n), ...(o ? { original: share(o.below, o.n) } : {}) });
    for (let b = 0; b < HISTOGRAM_BINS; b++) {
      bins.push({ label: binLabel(lo + b * width), synthetic: share(s.bins[b], s.n), ...(o ? { original: share(o.bins[b], o.n) } : {}) });
    }
    if (s.above || o?.above) bins.push({ label: `> ${binLabel(hi)}`, synthetic: share(s.above, s.n), ...(o ? { original: share(o.above, o.n) } : {}) });
    out.push({ column: col.name, bins });
  });
  return out;
}

function csvFieldBytes(v: Cell): number {
  if (v === null) return 0;
  const s = typeof v === 'string' ? v : String(v);
  let bytes = s.length;
  let quotes = 0;
  let needsQuoting = false;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code > 0x7f) bytes += code > 0x7ff ? 2 : 1;
    if (code === 34) quotes++;
    if (code === 34 || code === 44 || code === 10 || code === 13) needsQuoting = true;
  }
  return needsQuoting ? bytes + quotes + 2 : bytes;
}

/** Exact UTF-8 size of the data serialized as CSV (header row, comma separators, \n line endings). */
export function csvSizeBytes(schema: ColumnSchema[], data: ArrayLike<Cell>[], rowCount: number): number {
  let total = schema.reduce((a, c) => a + csvFieldBytes(c.name), 0) + Math.max(0, schema.length - 1) + 1;
  for (let c = 0; c < schema.length; c++) {
    const values = data[c];
    for (let i = 0; i < rowCount; i++) total += csvFieldBytes(values[i]);
  }
  total += rowCount * (Math.max(0, schema.length - 1) + 1);
  return total;
}
