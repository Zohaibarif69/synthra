// TSTR: "Train on Synthetic, Test on Real". Measures whether synthetic data is useful for machine learning.
//
//   1. The uploaded rows are split once, by seed: 75% train, 25% test. The test rows are held out.
//   2. A fresh generator learns ONLY from the train rows and produces a synthetic training set.
//   3. The same model (a small random forest) is trained twice, on the real train rows (TRTR) and on the
//      synthetic rows (TSTR), and both are scored on the held-out real test rows.
//   4. Utility = (TSTR − baseline) ÷ (TRTR − baseline): how much of the real data's predictive skill, above
//      simply guessing, the synthetic data keeps.
//
// Runs in the Web Worker, so nothing is sent anywhere.

import type { Cell, ColumnSchema, DatasetProfile, GenerationConfig } from '../types';
import type { OriginalData } from './protocol';
import { buildProfile, numericView } from './profile';
import { columnKind } from './infer';
import { createRng } from './random';
import { forbiddenValues, runTabularPipeline } from './pipeline';

export type TstrTask = 'classification' | 'regression';

export interface TstrTarget {
  column: string;
  task: TstrTask;
  /** Number of classes (classification). */
  classes?: number;
}

export interface TstrResult {
  target: string;
  task: TstrTask;
  /** ROC AUC (yes/no targets), accuracy (several classes) or R² (numbers), 0–1. */
  metric: 'auc' | 'accuracy' | 'r2';
  /** Model trained on real train rows, tested on real test rows. */
  real: number;
  /** Model trained on synthetic rows, tested on the same real test rows. */
  synthetic: number;
  /** Guessing: AUC 0.5, the most common class (accuracy) or the mean (R² = 0). */
  baseline: number;
  /** Accuracy (yes/no), macro F1 (several classes) or mean absolute error (numbers). */
  secondary: { name: string; real: number; synthetic: number };
  /**
   * Share of the real data's skill above the baseline that the synthetic data keeps, in %, 0–100:
   * (synthetic − baseline) ÷ (real − baseline). A model that only learns to guess the majority class scores 0.
   * Null when the target isn't predictable even from real data.
   */
  utility: number | null;
  rating: 'excellent' | 'good' | 'fair' | 'poor' | 'n/a';
  /** False when even real data can't beat the baseline, so the test says nothing about the synthetic data. */
  predictable: boolean;
  rows: { realTrain: number; syntheticTrain: number; realTest: number };
  features: string[];
  excluded: { column: string; reason: string }[];
  model: string;
  durationMs: number;
}

const TEST_SHARE = 0.25;
const MIN_ROWS = 60;
const MAX_TRAIN = 8000;
const MAX_TEST = 5000;
const MAX_CLASSES = 20;
const MAX_CATEGORIES = 30;
const BINS = 32;
const TREES = 25;
const MAX_DEPTH = 10;
const MIN_LEAF = 3;

// ─── Which columns can be a target / a feature ────────────────────────────────

const HIDDEN_TRANSFORMS = new Set(['mask', 'hash']);

function excludedReason(col: ColumnSchema, p: DatasetProfile['columns'][number] | undefined): string | null {
  const kind = p?.kind ?? columnKind(col);
  if (kind === 'identifier') return 'identifier';
  if (col.unique) return 'unique key';
  if (col.privacyLevel === 'high') return 'personal data';
  if (col.privacyTransform && HIDDEN_TRANSFORMS.has(col.privacyTransform)) return `${col.privacyTransform}ed in the export`;
  if (kind === 'text') return 'free text';
  if (kind === 'categorical' && p && p.uniqueCount > MAX_CATEGORIES) return `more than ${MAX_CATEGORIES} categories`;
  return null;
}

/** Columns that make sense to predict, most useful first (classification before regression). */
export function tstrTargets(schema: ColumnSchema[], profile: DatasetProfile | undefined | null): TstrTarget[] {
  if (!profile) return [];
  const out: TstrTarget[] = [];
  for (const col of schema) {
    const p = profile.columns.find(c => c.name === col.name) ?? profile.columns.find(c => c.name === col.sourceColumn);
    if (!p || excludedReason(col, p)) continue;
    const distinct = p.uniqueCount;
    if (p.kind === 'boolean' || (p.kind === 'categorical' && distinct >= 2 && distinct <= MAX_CLASSES)) {
      if (distinct >= 2) out.push({ column: col.name, task: 'classification', classes: distinct });
    } else if (p.kind === 'numeric') {
      if (distinct >= 2 && distinct <= 10) out.push({ column: col.name, task: 'classification', classes: distinct });
      else if (distinct > 10) out.push({ column: col.name, task: 'regression' });
    }
  }
  return out.sort((a, b) => targetRank(a) - targetRank(b));
}

/** Names that usually mean "the thing to predict". */
const OUTCOME_NAME = /(^|_)(churn(ed)?|default(ed)?|fraud(ulent)?|target|label|class|outcome|result|converted|purchased?|approved|rejected|survived|attrition|left|pass(ed)?|fail(ed)?|success(ful)?|won|win|admitted|hired|retained|clicked|responded|subscribed|cancell?ed|renewed|returned|y)(_|$)/i;
/** Describe who someone is rather than an outcome; rarely what anyone wants to predict. */
const DEMOGRAPHIC_NAME = /(^|_)(gender|sex|city|country|region|province|state|nationality|religion|ethnicity|language|marital_status)(_|$)/i;

/**
 * Best first choice first: outcome-like names, then yes/no, then categories with few values, then numbers,
 * and demographic columns (gender, city…) last.
 * The first target is the default in the UI, so it should be the one a person would pick.
 */
function targetRank(t: TstrTarget): number {
  const outcome = OUTCOME_NAME.test(t.column) ? 0 : DEMOGRAPHIC_NAME.test(t.column) ? 2000 : 1000;
  const kind = t.task === 'regression' ? 500 : t.classes === 2 ? 0 : 100 + (t.classes ?? 0);
  return outcome + kind;
}

// ─── Encoding ─────────────────────────────────────────────────────────────────

type Kind = 'num' | 'cat';

function catKey(col: ColumnSchema, v: Cell | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (col.type === 'boolean') {
    const s = String(v).trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 't'].includes(s)) return 'true';
    if (['false', '0', 'no', 'n', 'f'].includes(s)) return 'false';
    return s;
  }
  const s = String(v).trim().toLowerCase();
  return s === '' ? null : s;
}

interface Dataset {
  /** Feature columns: numeric values (NaN = missing) or category codes (-1 = missing/unknown). */
  x: Float64Array[];
  /** Class index (classification) or value (regression). */
  y: Float64Array;
  n: number;
}

/** Vocabulary shared by all three datasets, so codes mean the same thing everywhere (codes carry no labels). */
class Vocab {
  private maps: Map<string, number>[] = [];
  code(f: number, key: string | null): number {
    if (key === null) return -1;
    const m = (this.maps[f] ??= new Map());
    let c = m.get(key);
    if (c === undefined) { c = m.size; m.set(key, c); }
    return c;
  }
  size(f: number): number { return this.maps[f]?.size ?? 0; }
}

// ─── Random forest (histogram-based CART) ─────────────────────────────────────

interface Binned {
  /** Per feature: bin (numeric, 0..BINS-1, BINS = missing) or category code (+1, 0 = missing). */
  cols: Uint16Array[];
  width: number[];
}

/** Numeric features → quantile bins learned from the training set; categories → code + 1. */
function binner(train: Dataset, kinds: Kind[]) {
  const edges = kinds.map((k, f) => {
    if (k === 'cat') return null;
    const vals = Array.from(train.x[f]).filter(v => !Number.isNaN(v)).sort((a, b) => a - b);
    if (!vals.length) return [] as number[];
    const e: number[] = [];
    for (let b = 1; b < BINS; b++) {
      const q = vals[Math.min(vals.length - 1, Math.floor((b / BINS) * vals.length))];
      if (!e.length || q > e[e.length - 1]) e.push(q);
    }
    return e;
  });
  return (d: Dataset, vocab: Vocab): Binned => {
    const cols = kinds.map((k, f) => {
      const out = new Uint16Array(d.n);
      const col = d.x[f];
      if (k === 'cat') {
        for (let i = 0; i < d.n; i++) out[i] = col[i] < 0 ? 0 : col[i] + 1;
      } else {
        const e = edges[f]!;
        for (let i = 0; i < d.n; i++) {
          const v = col[i];
          if (Number.isNaN(v)) { out[i] = BINS; continue; }
          let lo = 0, hi = e.length;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (v <= e[mid]) hi = mid; else lo = mid + 1; }
          out[i] = lo;
        }
      }
      return out;
    });
    const width = kinds.map((k, f) => (k === 'cat' ? vocab.size(f) + 1 : BINS + 1));
    return { cols, width };
  };
}

type Node =
  | { leaf: true; value: Float64Array }
  | { leaf: false; f: number; cat: boolean; t: number; left: Node; right: Node };

interface TreeCtx {
  data: Binned;
  y: Float64Array;
  classes: number; // 0 = regression
  kinds: Kind[];
  rng: ReturnType<typeof createRng>;
  mtry: number;
}

function leafValue(ctx: TreeCtx, idx: Int32Array): Float64Array {
  if (ctx.classes) {
    const p = new Float64Array(ctx.classes);
    for (let i = 0; i < idx.length; i++) p[ctx.y[idx[i]]]++;
    for (let c = 0; c < ctx.classes; c++) p[c] /= idx.length;
    return p;
  }
  let s = 0;
  for (let i = 0; i < idx.length; i++) s += ctx.y[idx[i]];
  return Float64Array.of(idx.length ? s / idx.length : 0);
}

function impurity(ctx: TreeCtx, counts: Float64Array, n: number, sum: number, sq: number): number {
  if (!n) return 0;
  if (ctx.classes) {
    let g = 1;
    for (let c = 0; c < ctx.classes; c++) { const p = counts[c] / n; g -= p * p; }
    return g * n;
  }
  return sq - (sum * sum) / n; // n × variance
}

function grow(ctx: TreeCtx, idx: Int32Array, depth: number): Node {
  const n = idx.length;
  const K = ctx.classes;
  // Stop: depth, size, or pure node.
  if (depth >= MAX_DEPTH || n < 2 * MIN_LEAF) return { leaf: true, value: leafValue(ctx, idx) };
  if (K) {
    const first = ctx.y[idx[0]];
    let pure = true;
    for (let i = 1; i < n && pure; i++) if (ctx.y[idx[i]] !== first) pure = false;
    if (pure) return { leaf: true, value: leafValue(ctx, idx) };
  }

  // Parent totals.
  const tot = new Float64Array(Math.max(1, K));
  let tSum = 0, tSq = 0;
  for (let i = 0; i < n; i++) {
    const y = ctx.y[idx[i]];
    if (K) tot[y]++; else { tSum += y; tSq += y * y; }
  }
  const parent = impurity(ctx, tot, n, tSum, tSq);

  // Random subset of features.
  const F = ctx.kinds.length;
  const order = Array.from({ length: F }, (_, f) => f);
  for (let i = F - 1; i > 0; i--) { const j = ctx.rng.int(0, i); [order[i], order[j]] = [order[j], order[i]]; }

  let best = { gain: 1e-9, f: -1, t: -1, cat: false };
  for (const f of order.slice(0, ctx.mtry)) {
    const col = ctx.data.cols[f];
    const W = ctx.data.width[f];
    const stride = Math.max(1, K);
    const cnt = new Float64Array(W * stride);
    const nb = new Float64Array(W), sb = new Float64Array(W), qb = new Float64Array(W);
    for (let i = 0; i < n; i++) {
      const r = idx[i], b = col[r], y = ctx.y[r];
      nb[b]++;
      if (K) cnt[b * stride + y]++; else { sb[b] += y; qb[b] += y * y; }
    }
    const cat = ctx.kinds[f] === 'cat';
    const left = new Float64Array(stride);
    let ln = 0, ls = 0, lq = 0;
    for (let b = 0; b < W; b++) {
      if (!nb[b]) continue;
      if (cat) { left.fill(0); ln = 0; ls = 0; lq = 0; } // one category vs the rest
      ln += nb[b];
      if (K) for (let c = 0; c < K; c++) left[c] += cnt[b * stride + c]; else { ls += sb[b]; lq += qb[b]; }
      const rn = n - ln;
      if (ln < MIN_LEAF || rn < MIN_LEAF) continue;
      let li: number, ri: number;
      if (K) {
        const right = new Float64Array(K);
        for (let c = 0; c < K; c++) right[c] = tot[c] - left[c];
        li = impurity(ctx, left, ln, 0, 0); ri = impurity(ctx, right, rn, 0, 0);
      } else {
        li = impurity(ctx, left, ln, ls, lq); ri = impurity(ctx, left, rn, tSum - ls, tSq - lq);
      }
      const gain = parent - li - ri;
      if (gain > best.gain) best = { gain, f, t: b, cat };
    }
  }
  if (best.f < 0) return { leaf: true, value: leafValue(ctx, idx) };

  const col = ctx.data.cols[best.f];
  const goesLeft = (r: number) => (best.cat ? col[r] === best.t : col[r] <= best.t);
  let nl = 0;
  for (let i = 0; i < n; i++) if (goesLeft(idx[i])) nl++;
  const L = new Int32Array(nl), R = new Int32Array(n - nl);
  let a = 0, c = 0;
  for (let i = 0; i < n; i++) { const r = idx[i]; if (goesLeft(r)) L[a++] = r; else R[c++] = r; }
  return { leaf: false, f: best.f, cat: best.cat, t: best.t, left: grow(ctx, L, depth + 1), right: grow(ctx, R, depth + 1) };
}

function predictTree(node: Node, data: Binned, r: number): Float64Array {
  let cur = node;
  while (!cur.leaf) {
    const v = data.cols[cur.f][r];
    cur = (cur.cat ? v === cur.t : v <= cur.t) ? cur.left : cur.right;
  }
  return cur.value;
}

function trainAndPredict(train: Dataset, test: Dataset, kinds: Kind[], vocab: Vocab, classes: number, seed: number): { pred: Float64Array; score: Float64Array } {
  const bin = binner(train, kinds);
  const tr = bin(train, vocab), te = bin(test, vocab);
  const rng = createRng(seed);
  const F = kinds.length;
  const mtry = Math.max(1, classes ? Math.round(Math.sqrt(F)) : Math.round(F / 3));
  const trees: Node[] = [];
  for (let t = 0; t < TREES; t++) {
    const idx = new Int32Array(train.n);
    for (let i = 0; i < train.n; i++) idx[i] = rng.int(0, train.n - 1); // bootstrap sample
    trees.push(grow({ data: tr, y: train.y, classes, kinds, rng, mtry }, idx, 0));
  }
  const pred = new Float64Array(test.n);
  const score = new Float64Array(test.n); // probability of class 1 (yes/no targets)
  for (let r = 0; r < test.n; r++) {
    if (classes) {
      const p = new Float64Array(classes);
      for (const tree of trees) { const v = predictTree(tree, te, r); for (let c = 0; c < classes; c++) p[c] += v[c]; }
      let bestC = 0;
      for (let c = 1; c < classes; c++) if (p[c] > p[bestC]) bestC = c;
      pred[r] = bestC;
      if (classes === 2) score[r] = p[1] / trees.length;
    } else {
      let s = 0;
      for (const tree of trees) s += predictTree(tree, te, r)[0];
      pred[r] = s / trees.length;
    }
  }
  return { pred, score };
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

function accuracy(y: Float64Array, p: Float64Array): number {
  let ok = 0;
  for (let i = 0; i < y.length; i++) if (y[i] === p[i]) ok++;
  return y.length ? ok / y.length : 0;
}

/** ROC AUC by ranks (Mann–Whitney U); ties share their average rank. */
function auc(y: Float64Array, score: Float64Array): number {
  const idx = Array.from({ length: y.length }, (_, i) => i).sort((a, b) => score[a] - score[b]);
  let pos = 0, rankSum = 0;
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && score[idx[j + 1]] === score[idx[i]]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (y[idx[k]] === 1) { pos++; rankSum += rank; }
    i = j + 1;
  }
  const neg = y.length - pos;
  return pos && neg ? (rankSum - (pos * (pos + 1)) / 2) / (pos * neg) : 0.5;
}

function macroF1(y: Float64Array, p: Float64Array, classes: number): number {
  let sum = 0, used = 0;
  for (let c = 0; c < classes; c++) {
    let tp = 0, fp = 0, fn = 0;
    for (let i = 0; i < y.length; i++) {
      if (p[i] === c && y[i] === c) tp++; else if (p[i] === c) fp++; else if (y[i] === c) fn++;
    }
    if (tp + fn === 0) continue; // class not in the test set
    used++;
    sum += tp ? (2 * tp) / (2 * tp + fp + fn) : 0;
  }
  return used ? sum / used : 0;
}

function r2(y: Float64Array, p: Float64Array): number {
  let mean = 0;
  for (let i = 0; i < y.length; i++) mean += y[i];
  mean /= y.length || 1;
  let res = 0, tot = 0;
  for (let i = 0; i < y.length; i++) { res += (y[i] - p[i]) ** 2; tot += (y[i] - mean) ** 2; }
  return tot ? 1 - res / tot : 0;
}

function mae(y: Float64Array, p: Float64Array): number {
  let s = 0;
  for (let i = 0; i < y.length; i++) s += Math.abs(y[i] - p[i]);
  return y.length ? s / y.length : 0;
}

export function utilityRating(u: number | null): TstrResult['rating'] {
  if (u === null) return 'n/a';
  return u >= 90 ? 'excellent' : u >= 75 ? 'good' : u >= 50 ? 'fair' : 'poor';
}

// ─── The test ─────────────────────────────────────────────────────────────────

const round4 = (x: number) => Math.round(x * 10000) / 10000;

function take(values: ArrayLike<Cell> | undefined, idx: number[]): Cell[] {
  return idx.map(i => (values ? values[i] ?? null : null));
}

export async function runTstr(input: {
  schema: ColumnSchema[];
  config: GenerationConfig & { seed: number };
  original: OriginalData;
  target: string;
}): Promise<TstrResult> {
  const started = performance.now();
  const { schema, config, original } = input;
  const targetCol = schema.find(c => c.name === input.target);
  if (!targetCol) throw new Error(`Column "${input.target}" is not in the schema.`);
  const src = (c: ColumnSchema) => original.columns[c.sourceColumn ?? c.name];
  const targetValues = src(targetCol);
  if (!targetValues) throw new Error(`The uploaded file has no data for "${input.target}".`);

  // Task from the full-upload profile of the target.
  const fullTargetProfile = buildProfile([{ column: targetCol, values: targetValues }], original.rowCount).columns[0];
  const regression = fullTargetProfile.kind === 'numeric' && fullTargetProfile.uniqueCount > 10;
  const task: TstrTask = regression ? 'regression' : 'classification';

  // 1. Split rows that have a target value: 75% train / 25% test, fixed by the seed.
  const rng = createRng(config.seed).derive('tstr:split');
  const usable: number[] = [];
  for (let i = 0; i < original.rowCount; i++) if (targetValues[i] !== null && targetValues[i] !== undefined) usable.push(i);
  if (usable.length < MIN_ROWS) throw new Error(`Needs at least ${MIN_ROWS} uploaded rows with a value in "${input.target}" (found ${usable.length}).`);
  for (let i = usable.length - 1; i > 0; i--) { const j = rng.int(0, i); [usable[i], usable[j]] = [usable[j], usable[i]]; }
  const nTest = Math.min(MAX_TEST, Math.max(15, Math.round(usable.length * TEST_SHARE)));
  const testIdx = usable.slice(0, nTest);
  const trainIdx = usable.slice(nTest);
  const trainForModel = trainIdx.slice(0, MAX_TRAIN);

  // 2. A generator that has only ever seen the train rows.
  const trainProfile = buildProfile(schema.map(column => ({ column, values: take(src(column), trainIdx) })), trainIdx.length);
  const trainColumns: Record<string, Cell[]> = {};
  for (const [k, v] of Object.entries(original.columns)) trainColumns[k] = take(v, trainIdx);
  const synth = await runTabularPipeline({
    schema,
    config: { ...config, rowCount: trainForModel.length },
    profile: trainProfile,
    forbidden: forbiddenValues(schema, trainColumns),
  });

  // 3. Features: everything usable except the target.
  const features: { col: ColumnSchema; kind: Kind }[] = [];
  const excluded: { column: string; reason: string }[] = [];
  for (const col of schema) {
    if (col.name === input.target) continue;
    const p = trainProfile.columns.find(c => c.name === col.name);
    const reason = !src(col) ? 'not in the uploaded file' : excludedReason(col, p);
    if (reason) { excluded.push({ column: col.name, reason }); continue; }
    const kind = p?.kind ?? columnKind(col);
    features.push({ col, kind: kind === 'numeric' || kind === 'datetime' ? 'num' : 'cat' });
  }
  if (!features.length) throw new Error('No usable feature columns: every other column is an identifier, personal data or free text.');

  const vocab = new Vocab();
  const labels = new Vocab(); // classification: class names → 0..K-1
  const synthIndex = new Map(synth.schema.map((c, i) => [c.name, i]));

  const build = (get: (col: ColumnSchema) => ArrayLike<Cell>, rows: number, keep: (i: number) => boolean): Dataset => {
    const tv = get(targetCol);
    const rowsKept: number[] = [];
    for (let i = 0; i < rows; i++) {
      if (!keep(i)) continue;
      const v = tv[i];
      if (v === null || v === undefined) continue;
      if (regression && Number.isNaN(numericView(targetCol, [v])[0])) continue;
      rowsKept.push(i);
    }
    const x = features.map(({ col, kind }, f) => {
      const vals = get(col);
      const out = new Float64Array(rowsKept.length);
      if (kind === 'num') {
        const view = numericView(col, rowsKept.map(i => vals[i] ?? null));
        out.set(view);
      } else {
        rowsKept.forEach((r, i) => { out[i] = vocab.code(f, catKey(col, vals[r])); });
      }
      return out;
    });
    const y = new Float64Array(rowsKept.length);
    if (regression) y.set(numericView(targetCol, rowsKept.map(i => tv[i])));
    else rowsKept.forEach((r, i) => { y[i] = labels.code(0, catKey(targetCol, tv[r])); });
    return { x, y, n: rowsKept.length };
  };

  const realAt = (idx: number[]) => (col: ColumnSchema) => take(src(col), idx);
  const realTrain = build(realAt(trainForModel), trainForModel.length, () => true);
  const realTest = build(realAt(testIdx), testIdx.length, () => true);
  const synthTrain = build(col => {
    const c = synthIndex.get(col.name);
    return c === undefined ? new Array<Cell>(synth.table.rowCount).fill(null) : synth.table.data[c];
  }, synth.table.rowCount, () => true);
  if (synthTrain.n < MIN_LEAF * 4) throw new Error(`The synthetic data has almost no values in "${input.target}".`);

  const classes = regression ? 0 : labels.size(0);
  const kinds = features.map(f => f.kind);
  const seed = createRng(config.seed).derive('tstr:model').int(1, 2 ** 31 - 1);
  const { pred: predReal, score: scoreReal } = trainAndPredict(realTrain, realTest, kinds, vocab, classes, seed);
  const { pred: predSynth, score: scoreSynth } = trainAndPredict(synthTrain, realTest, kinds, vocab, classes, seed);
  const binary = classes === 2;

  let real: number, synthetic: number, baseline: number, secondary: TstrResult['secondary'];
  if (regression) {
    real = r2(realTest.y, predReal);
    synthetic = r2(realTest.y, predSynth);
    baseline = 0;
    secondary = { name: 'Mean absolute error', real: mae(realTest.y, predReal), synthetic: mae(realTest.y, predSynth) };
  } else if (binary) {
    // AUC uses the model's confidence, so it is far steadier than accuracy when one answer dominates.
    real = auc(realTest.y, scoreReal);
    synthetic = auc(realTest.y, scoreSynth);
    baseline = 0.5;
    secondary = { name: 'Accuracy', real: accuracy(realTest.y, predReal), synthetic: accuracy(realTest.y, predSynth) };
  } else {
    real = accuracy(realTest.y, predReal);
    synthetic = accuracy(realTest.y, predSynth);
    const counts = new Float64Array(classes);
    for (let i = 0; i < realTrain.n; i++) counts[realTrain.y[i]]++;
    let major = 0;
    for (let c = 1; c < classes; c++) if (counts[c] > counts[major]) major = c;
    let hit = 0;
    for (let i = 0; i < realTest.n; i++) if (realTest.y[i] === major) hit++;
    baseline = realTest.n ? hit / realTest.n : 0;
    secondary = { name: 'Macro F1', real: macroF1(realTest.y, predReal, classes), synthetic: macroF1(realTest.y, predSynth, classes) };
  }

  // Only meaningful when real data clearly beats guessing; otherwise small wobbles swing the ratio.
  const predictable = regression ? real >= 0.1 : binary ? real >= 0.6 : real - baseline >= 0.05;
  // Skill above the baseline, so "always guess the majority class" can't look like a good score.
  const utility = predictable ? Math.round(Math.max(0, Math.min(1, (synthetic - baseline) / (real - baseline))) * 1000) / 10 : null;

  return {
    target: input.target,
    task,
    metric: regression ? 'r2' : binary ? 'auc' : 'accuracy',
    real: round4(real),
    synthetic: round4(synthetic),
    baseline: round4(baseline),
    secondary: { name: secondary.name, real: round4(secondary.real), synthetic: round4(secondary.synthetic) },
    utility,
    rating: utilityRating(utility),
    predictable,
    rows: { realTrain: realTrain.n, syntheticTrain: synthTrain.n, realTest: realTest.n },
    features: features.map(f => f.col.name),
    excluded,
    model: `Random forest (${TREES} trees, depth ≤ ${MAX_DEPTH})`,
    durationMs: Math.round(performance.now() - started),
  };
}
