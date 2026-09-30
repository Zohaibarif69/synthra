// Tabular synthetic data generator. Pure and deterministic: the same schema, profile
// and config (including seed) always produce identical rows. Runs inside a Web Worker.

import type { Faker } from '@faker-js/faker';
import type {
  Cell, ColumnKind, ColumnProfile, ColumnSchema, DatasetProfile, ForbiddenLog, GenerationConfig, InjectedCounts,
} from '../types';
import { columnKind, normalizeName, toNumber } from './infer';
import { defaultDateFormat, formatDate, parseDateWithFormat } from './dates';
import { createRng, type Rng } from './random';
import {
  COUNTRY_NAMES, PK_AREAS, PK_CITIES, PK_FEMALE_FIRST, PK_LAST, PK_MALE_FIRST, PK_PROVINCES,
  createFaker, fillPattern, phoneNumber, postalCode,
} from './locales';

export const FLAG = { NONE: 0, NULL: 1, OUTLIER: 2, BOUNDARY: 3, RARE: 4, LONG_TEXT: 5, DUPLICATE: 6, AI_EDGE: 7 } as const;

/** Share of rows that receive each ticked AI edge case. */
export const AI_EDGE_RATE = 0.01;

/**
 * Share of rows affected by each edge-case toggle (null/outlier rates come from the config).
 * Unique columns are never touched by outliers, boundary values, long text or near-duplicates.
 */
export const EDGE_RATES = { rareCategory: 0.02, boundary: 0.01, longText: 0.01, duplicateLike: 0.02 };

export interface TabularJobInput {
  schema: ColumnSchema[];
  config: GenerationConfig & { seed: number };
  /** Profile learned from the uploaded file, if any. */
  profile?: DatasetProfile | null;
  /**
   * Values (lower-cased) a column must never output, keyed by column name. Used for high-privacy
   * columns so no real value from the upload can appear in the synthetic data by chance.
   */
  forbidden?: Record<string, Set<string>>;
  /** Replays the re-draws of an earlier run when the upload is no longer available. */
  forbiddenReplay?: ForbiddenLog;
}

export interface GeneratedTable {
  schema: ColumnSchema[];
  rowCount: number;
  /** Column-major data: data[column][row]. */
  data: Cell[][];
  /** Per-cell marker of what was injected (see FLAG). */
  flags: Uint8Array[];
  injected: InjectedCounts;
  forbiddenLog: ForbiddenLog;
}

export type GenerateProgress = (stage: 'generate' | 'edge', fraction: number) => void;

// Fixed anchors so output never depends on today's date.
const DEFAULT_DATE_MIN = Date.UTC(2024, 0, 1);
const DEFAULT_DATE_MAX = Date.UTC(2026, 0, 1);
const DOB_MIN = Date.UTC(1946, 0, 1);
const DOB_MAX = Date.UTC(2008, 0, 1);
const DAY_MS = 86_400_000;

const EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net', 'mail.example.com'];

// ─── Math helpers ────────────────────────────────────────────────────────────

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Lower-triangular Cholesky factor of a correlation matrix, adding jitter if it is not positive definite. */
export function cholesky(matrix: number[][]): number[][] {
  const n = matrix.length;
  for (const jitter of [0, 1e-6, 1e-4, 1e-2, 0.05, 0.2, 1]) {
    const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = matrix[i][j] + (i === j ? jitter : 0);
        for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
        if (i === j) {
          if (sum <= 0) { ok = false; break; }
          L[i][j] = Math.sqrt(sum);
        } else {
          L[i][j] = sum / L[j][j];
        }
      }
    }
    if (ok) {
      // Rescale rows so each variable keeps unit variance after jitter.
      for (let i = 0; i < n; i++) {
        const norm = Math.sqrt(L[i].reduce((a, v) => a + v * v, 0));
        for (let j = 0; j < n; j++) L[i][j] /= norm;
      }
      return L;
    }
  }
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

function interpolateQuantiles(q: number[], u: number): number {
  const pos = Math.min(1, Math.max(0, u)) * (q.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(q.length - 1, lo + 1);
  return q[lo] + (q[hi] - q[lo]) * (pos - lo);
}

function roundTo(x: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}

function zipfWeights(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 1 / (i + 1));
}

function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ─── Plans ───────────────────────────────────────────────────────────────────

interface Person {
  first: string;
  last: string;
}

interface RowCtx {
  i: number;
  z: Float64Array;
  flag: number;
  person(): Person;
}

interface CategoryPool {
  values: Cell[];
  weights: number[];
  rare: Cell[];
}

interface ColumnPlan {
  col: ColumnSchema;
  kind: ColumnKind;
  profile?: ColumnProfile;
  isKey: boolean;
  gen: (ctx: RowCtx) => Cell;
  pool?: CategoryPool;
  decimals: number;
}

function findProfile(col: ColumnSchema, profile?: DatasetProfile | null): ColumnProfile | undefined {
  // 'synthetic' means: fully replaced by faker, so learned values are ignored.
  if (col.privacyTransform === 'synthetic') return undefined;
  const p = profile?.columns.find(c => c.name === (col.sourceColumn ?? col.name));
  if (!p) return undefined;
  const numeric = (t: string) => t === 'integer' || t === 'float';
  const compatible = p.type === col.type || (numeric(p.type) && numeric(col.type));
  return compatible ? p : undefined;
}

function identifierPrefix(normName: string): string {
  const base = normName.replace(/(^|_)(id|uuid|guid|key|code|no|number|num|ref)$/, '').split('_').filter(Boolean).pop();
  return base ? base.slice(0, 3).toUpperCase() : 'ID';
}

function sensitivePattern(n: string, locale: string): string {
  if (/cnic|(^|_)nic/.test(n)) return '#####-#######-#';
  if (/ssn|social_security/.test(n)) return '###-##-####';
  if (/cvv|cvc/.test(n)) return '###';
  if (/card|cc_number/.test(n)) return '#### #### #### ####';
  if (/iban/.test(n)) return `${locale === 'PK' ? 'PK' : 'GB'}##AAAA################`;
  if (/routing/.test(n)) return '#########';
  if (/swift/.test(n)) return 'AAAA' + (locale === 'PK' ? 'PK' : 'GB') + 'AA';
  if (/passport/.test(n)) return 'AA#######';
  if (/licen/.test(n)) return 'A#######';
  if (/tax|ntn|tin/.test(n)) return '#######-#';
  if (/account|acct/.test(n)) return '##############';
  return '############';
}

export function generateTabular(input: TabularJobInput, onProgress?: GenerateProgress): GeneratedTable {
  const { schema, config, profile } = input;
  const rowCount = Math.max(0, Math.floor(config.rowCount));
  const locale = config.locale;
  const root = createRng(config.seed);
  const faker: Faker = createFaker(locale, config.seed);
  const edge = config.edgeCases;

  // ── Person identity shared by name/email/username columns of the same row ──
  const personRng = root.derive('person');
  let personRow = -1;
  let person: Person = { first: '', last: '' };
  const personFor = (i: number): Person => {
    if (personRow === i) return person;
    personRow = i;
    const female = personRng.chance(0.5);
    if (locale === 'PK') {
      person = { first: personRng.pick(female ? PK_FEMALE_FIRST : PK_MALE_FIRST), last: personRng.pick(PK_LAST) };
    } else {
      person = { first: faker.person.firstName(female ? 'female' : 'male'), last: faker.person.lastName() };
    }
    return person;
  };

  // ── Build a plan per column ──
  const copulaColumns: { planIndex: number; name: string }[] = [];
  // Profiles learned by this version carry latent correlations; older saved profiles don't, and keep
  // generating exactly as before (numeric columns only in the copula).
  const latent = profile?.latentCorrelations;
  const latentNames = new Set((latent ?? []).flatMap(c => [c.a, c.b]));
  const plans: ColumnPlan[] = schema.map((col, index) => {
    const rng = root.derive(`col:${index}:${col.name}`);
    const p = findProfile(col, profile);
    const kind = p?.kind ?? columnKind(col);
    const n = normalizeName(col.name);
    const semantic = col.semanticType ?? '';
    const isKey = kind === 'identifier' && (col.unique ?? false) && col.privacyLevel !== 'high';
    const plan: ColumnPlan = { col, kind, profile: p, isKey, gen: () => null, decimals: p?.decimals ?? (col.type === 'float' ? 2 : 0) };

    const categorical = (pool: CategoryPool) => {
      plan.pool = pool;
      // With latent correlations, the category is read off this column's correlated normal value, so it keeps
      // its relationships with the other columns (e.g. contract type ↔ churn ↔ tenure).
      if (latent && p && latentNames.has(p.name) && pool.values.length >= 2) {
        const k = copulaColumns.length;
        copulaColumns.push({ planIndex: index, name: p.name });
        const total = pool.weights.reduce((a, w) => a + w, 0) || 1;
        const cum: number[] = [];
        let acc = 0;
        for (const w of pool.weights) { acc += w / total; cum.push(acc); }
        plan.gen = ctx => {
          if (edge.rareCategories && pool.rare.length && rng.chance(EDGE_RATES.rareCategory)) {
            ctx.flag = FLAG.RARE;
            return rng.pick(pool.rare);
          }
          const u = normalCdf(ctx.z[k]);
          let c = 0;
          while (c < cum.length - 1 && u > cum[c]) c++;
          return pool.values[c];
        };
        return;
      }
      plan.gen = ctx => {
        if (edge.rareCategories && pool.rare.length && rng.chance(EDGE_RATES.rareCategory)) {
          ctx.flag = FLAG.RARE;
          return rng.pick(pool.rare);
        }
        return rng.weightedPick(pool.values, pool.weights);
      };
    };
    const makePool = (entries: [Cell, number][]): CategoryPool => {
      const sorted = [...entries].sort((a, b) => b[1] - a[1]);
      const rareCount = sorted.length >= 4 ? Math.max(1, Math.floor(sorted.length / 4)) : 0;
      return {
        values: sorted.map(e => e[0]),
        weights: sorted.map(e => e[1]),
        rare: sorted.slice(sorted.length - rareCount).map(e => e[0]),
      };
    };

    // Free-text columns with an AI-written value pool sample from it (fetched once, never per row).
    const aiPool = config.aiContent?.[col.name];
    if (aiPool?.length && col.type === 'string' && kind !== 'identifier') {
      plan.gen = () => rng.pick(aiPool);
      return plan;
    }

    // Email / uuid types generate their own values whatever the semantic type says.
    if (col.type === 'email' || semantic === 'Email') {
      plan.gen = ctx => {
        const who = ctx.person();
        const sep = rng.pick(['.', '_', '']);
        const num = rng.chance(0.3) ? String(rng.int(1, 99)) : '';
        return `${slug(who.first)}${sep}${slug(who.last)}${num}@${rng.pick(EMAIL_DOMAINS)}`;
      };
      return plan;
    }
    if (col.type === 'uuid') {
      plan.gen = () => faker.string.uuid();
      return plan;
    }

    // Identifiers: sensitive numbers get realistic formats, keys are sequential.
    if (kind === 'identifier' || semantic === 'Identifier') {
      if (col.privacyLevel === 'high') {
        const pattern = sensitivePattern(n, locale);
        plan.gen = () => fillPattern(rng, pattern);
      } else if (/user_?name|login|handle|screen_name/.test(n)) {
        plan.gen = ctx => {
          const who = ctx.person();
          return faker.internet.username({ firstName: who.first, lastName: who.last });
        };
      } else if (col.type === 'integer' || col.type === 'float') {
        const min = typeof p?.min === 'number' ? Math.floor(p.min) : 1;
        const max = typeof p?.max === 'number' ? Math.floor(p.max) : Math.max(min, min + Math.ceil(rowCount / 5));
        plan.gen = col.unique ? ctx => min + ctx.i : () => rng.int(min, max);
      } else {
        const sample = p?.topValues?.[0]?.value;
        const m = sample ? /^(.*?)(\d+)(\D*)$/.exec(sample) : null;
        const prefix = m ? m[1] : `${identifierPrefix(n)}-`;
        const suffix = m ? m[3] : '';
        const width = m ? m[2].length : 6;
        const start = m ? Number(m[2]) : 1;
        plan.gen = col.unique
          ? ctx => `${prefix}${String(start + ctx.i).padStart(width, '0')}${suffix}`
          : () => `${prefix}${String(rng.int(start, start + Math.max(10, rowCount))).padStart(width, '0')}${suffix}`;
      }
      return plan;
    }

    if (kind === 'boolean' || col.type === 'boolean') {
      if (p?.topValues?.length) {
        categorical(makePool(p.topValues.map(t => [t.value === 'true' ? true : t.value === 'false' ? false : t.value, t.count])));
      } else {
        plan.gen = () => rng.chance(0.5);
      }
      return plan;
    }

    if (kind === 'numeric') {
      const integer = col.type === 'integer';
      const finish = (x: number) => (integer ? Math.round(x) : roundTo(x, plan.decimals));
      if (p?.quantiles && p.quantiles.length > 1) {
        // Gaussian copula: correlated normals are mapped through the learned percentiles.
        const k = copulaColumns.length;
        copulaColumns.push({ planIndex: index, name: p.name });
        const q = p.quantiles;
        plan.gen = ctx => finish(interpolateQuantiles(q, normalCdf(ctx.z[k])));
      } else if (typeof p?.mean === 'number' && typeof p.stdDev === 'number') {
        const { mean, stdDev } = p;
        const lo = typeof p.min === 'number' ? p.min : -Infinity;
        const hi = typeof p.max === 'number' ? p.max : Infinity;
        plan.gen = () => finish(Math.min(hi, Math.max(lo, rng.normal(mean, stdDev))));
      } else if (semantic === 'Age') {
        plan.gen = () => Math.round(Math.min(85, Math.max(18, rng.normal(36, 12))));
      } else if (semantic === 'Currency') {
        plan.gen = () => finish(Math.min(100_000, Math.max(1, Math.exp(rng.normal(Math.log(250), 1)))));
      } else if (semantic === 'Quantity') {
        plan.gen = () => Math.min(500, 1 + Math.floor(Math.exp(rng.normal(1.5, 0.8))));
      } else {
        plan.gen = () => finish(integer ? rng.int(0, 1000) : rng.float(0, 1000));
      }
      return plan;
    }

    if (kind === 'datetime') {
      const format = col.format ?? defaultDateFormat(col.type === 'datetime' ? 'datetime' : 'date');
      const isDob = /(^|_)(dob|date_of_birth|birth_?date|birthday)(_|$)/.test(n);
      const toCell = (ts: number) => formatDate(col.type === 'date' ? Math.floor(ts / DAY_MS) * DAY_MS : Math.round(ts / 1000) * 1000, format);
      if (p?.quantiles && p.quantiles.length > 1) {
        const q = p.quantiles;
        plan.gen = () => toCell(interpolateQuantiles(q, rng.next()));
      } else {
        const [lo, hi] = isDob ? [DOB_MIN, DOB_MAX] : [DEFAULT_DATE_MIN, DEFAULT_DATE_MAX];
        plan.gen = () => toCell(rng.float(lo, hi));
      }
      return plan;
    }

    if (kind === 'categorical' && p?.topValues?.length) {
      categorical(makePool(p.topValues.map(t => [t.value, t.count])));
      return plan;
    }

    // ── No usable profile: sensible defaults per semantic type ──
    switch (semantic) {
      case 'Person Name':
        plan.gen = ctx => {
          const who = ctx.person();
          if (/(^|_)(first|given)/.test(n)) return who.first;
          if (/(^|_)(last|sur|family)/.test(n)) return who.last;
          return `${who.first} ${who.last}`;
        };
        return plan;
      case 'Phone':
        plan.gen = () => phoneNumber(rng, locale);
        return plan;
      case 'Address':
        if (/(^|_)(state|province|region|county|district|territory)(_|$)/.test(n)) {
          categorical(makePool(locale === 'PK'
            ? PK_PROVINCES
            : Array.from({ length: 15 }, (_, i) => [faker.location.state(), 1 / (i + 1)] as [Cell, number])));
        } else if (/zip|postal|postcode|pin_code/.test(n)) {
          plan.gen = () => postalCode(rng, locale, faker);
        } else {
          plan.gen = () => locale === 'PK'
            ? `House ${rng.int(1, 999)}, Street ${rng.int(1, 60)}, ${rng.pick(PK_AREAS)}`
            : faker.location.streetAddress();
        }
        return plan;
      case 'City':
        categorical(makePool(locale === 'PK'
          ? PK_CITIES
          : Array.from({ length: 30 }, (_, i) => [faker.location.city(), 1 / (i + 1)] as [Cell, number])));
        return plan;
      case 'Country': {
        const home = COUNTRY_NAMES[locale] ?? 'United States';
        const others = Object.values(COUNTRY_NAMES).filter(c => c !== home);
        categorical(makePool([[home, 60], ...others.map((c, i) => [c, 40 / (others.length * (i + 1) * 0.5)] as [Cell, number])]));
        return plan;
      }
      case 'Company':
        plan.gen = () => faker.company.name();
        return plan;
      case 'URL':
        plan.gen = () => faker.internet.url();
        return plan;
      case 'Status':
        categorical(makePool([['Active', 55], ['Inactive', 20], ['Pending', 15], ['Suspended', 7], ['Closed', 3]]));
        return plan;
      case 'Description': {
        const target = p?.avgLength ?? 80;
        plan.gen = () => {
          let s = faker.lorem.sentence();
          while (s.length < target * rng.float(0.6, 1.4)) s += ' ' + faker.lorem.sentence();
          return s;
        };
        return plan;
      }
      case 'Category': {
        if (/gender|(^|_)sex(_|$)/.test(n)) categorical(makePool([['Male', 48], ['Female', 48], ['Other', 4]]));
        else {
          const names = ['Electronics', 'Clothing', 'Home & Kitchen', 'Sports', 'Books', 'Beauty', 'Toys', 'Grocery', 'Automotive', 'Health'];
          const w = zipfWeights(names.length);
          categorical(makePool(names.map((v, i) => [v, w[i]])));
        }
        return plan;
      }
    }

    // Generic strings: a few name-based hints, otherwise short lorem text of the learned length.
    if (/product|item/.test(n)) plan.gen = () => faker.commerce.productName();
    else if (/job|title|designation|position|occupation/.test(n)) plan.gen = () => faker.person.jobTitle();
    else if (/colou?r/.test(n)) plan.gen = () => faker.color.human();
    else {
      const target = p?.avgLength ?? 12;
      plan.gen = () => {
        let s = faker.lorem.word();
        while (s.length < target * rng.float(0.7, 1.3)) s += ' ' + faker.lorem.word();
        return s;
      };
    }
    return plan;
  });

  // ── High-privacy columns: never emit a value that exists in the upload ──
  // With the upload in memory we check values and log where we re-drew; without it (Regenerate after a
  // reload) we replay that log, so the output is identical without ever storing the uploaded values.
  const forbiddenLog: ForbiddenLog = {};
  plans.forEach(plan => {
    const name = plan.col.name;
    const blocked = input.forbidden?.[name];
    const replay = input.forbiddenReplay?.[name];
    if (!blocked?.size && !replay) return;
    const base = plan.gen;
    const rng = root.derive(`forbid:${name}`);
    const isBlocked = (v: Cell) => v !== null && !!blocked?.has(String(v).trim().toLowerCase());
    const bump = (v: Cell): Cell => (typeof v === 'number' ? v + 1 : `${v} ${String.fromCharCode(65 + rng.int(0, 25))}.`);
    plan.gen = ctx => {
      let v = base(ctx);
      let redraws = 0, suffixes = 0;
      if (blocked?.size) {
        for (; redraws < 20 && isBlocked(v); redraws++) {
          // Person-derived columns repeat the same person within a row, so draw a fresh person.
          personRow = -1;
          v = base(ctx);
        }
        while (isBlocked(v)) { v = bump(v); suffixes++; }
      } else if (replay?.[ctx.i]) {
        [redraws, suffixes] = replay[ctx.i];
        for (let k = 0; k < redraws; k++) { personRow = -1; v = base(ctx); }
        for (let k = 0; k < suffixes; k++) v = bump(v);
      }
      if (redraws || suffixes) (forbiddenLog[name] ??= {})[ctx.i] = [redraws, suffixes];
      return v;
    };
  });

  // ── Uniqueness: retry, then disambiguate deterministically ──
  plans.forEach(plan => {
    if (!plan.col.unique || plan.isKey) return;
    const base = plan.gen;
    const seen = new Set<string>();
    plan.gen = ctx => {
      let v = base(ctx);
      for (let t = 0; t < 8 && v !== null && seen.has(String(v)); t++) v = base(ctx);
      if (v !== null && seen.has(String(v))) {
        let k = ctx.i;
        const make = (): Cell => {
          if (typeof v === 'number') return plan.col.type === 'integer' ? (v as number) + k : roundTo((v as number) + k * 10 ** -Math.max(plan.decimals, 2), 6);
          const s = String(v);
          const at = s.indexOf('@');
          return at > 0 ? `${s.slice(0, at)}.${k}${s.slice(at)}` : `${s}-${k}`;
        };
        let candidate = make();
        while (seen.has(String(candidate))) { k += rowCount + 1; candidate = make(); }
        v = candidate;
      }
      if (v !== null) seen.add(String(v));
      return v;
    };
  });

  // ── Correlation structure for the copula ──
  const k = copulaColumns.length;
  const corr: number[][] = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 1 : 0)));
  if (profile) {
    for (const c of latent ?? profile.correlations) {
      const a = copulaColumns.findIndex(x => x.name === c.a);
      const b = copulaColumns.findIndex(x => x.name === c.b);
      if (a >= 0 && b >= 0) { corr[a][b] = c.r; corr[b][a] = c.r; }
    }
  }
  const L = cholesky(corr);
  const copulaRng = root.derive('copula');
  const eps = new Float64Array(k);

  // ── Generate rows ──
  const data: Cell[][] = plans.map(() => new Array<Cell>(rowCount));
  const flags: Uint8Array[] = plans.map(() => new Uint8Array(rowCount));
  const injected: InjectedCounts = { nulls: 0, outliers: 0, boundaryValues: 0, rareCategories: 0, longText: 0, duplicateLikeRows: 0 };
  const ctx: RowCtx = { i: 0, z: new Float64Array(k), flag: 0, person: () => personFor(ctx.i) };

  const progressEvery = Math.max(1000, Math.floor(rowCount / 200));
  for (let i = 0; i < rowCount; i++) {
    ctx.i = i;
    for (let a = 0; a < k; a++) eps[a] = copulaRng.normal();
    for (let a = 0; a < k; a++) {
      let s = 0;
      for (let b = 0; b <= a; b++) s += L[a][b] * eps[b];
      ctx.z[a] = s;
    }
    for (let c = 0; c < plans.length; c++) {
      ctx.flag = FLAG.NONE;
      data[c][i] = plans[c].gen(ctx);
      if (ctx.flag !== FLAG.NONE) {
        flags[c][i] = ctx.flag;
        if (ctx.flag === FLAG.RARE) injected.rareCategories++;
      }
    }
    if (onProgress && i % progressEvery === 0) onProgress('generate', i / rowCount);
  }
  onProgress?.('generate', 1);

  // ── Edge cases ──
  const edgeRng = root.derive('edge');
  const passes = 6;
  let pass = 0;
  const step = () => onProgress?.('edge', ++pass / passes);

  // Near-duplicate rows: copy an earlier row (except keys/unique columns) and perturb one field.
  if (edge.duplicateLike && rowCount > 1) {
    const copyable = plans.map((p, c) => ({ p, c })).filter(x => !x.p.isKey && !x.p.col.unique);
    const perturbable = copyable.filter(x => x.p.col.type === 'string' || x.p.kind === 'numeric');
    if (copyable.length) {
      for (let i = 1; i < rowCount; i++) {
        if (!edgeRng.chance(EDGE_RATES.duplicateLike)) continue;
        const j = edgeRng.int(0, i - 1);
        for (const { c } of copyable) { data[c][i] = data[c][j]; flags[c][i] = flags[c][j]; }
        if (perturbable.length) {
          const { p, c } = edgeRng.pick(perturbable);
          const v = data[c][i];
          if (typeof v === 'number') {
            data[c][i] = p.col.type === 'integer' ? v + edgeRng.pick([-1, 1]) : roundTo(v * edgeRng.float(0.99, 1.01), p.decimals);
          } else if (typeof v === 'string' && v.length > 1) {
            const pos = edgeRng.int(0, v.length - 2);
            const mode = edgeRng.int(0, 2);
            data[c][i] = mode === 0 ? v.slice(0, pos) + v[pos + 1] + v[pos] + v.slice(pos + 2)
              : mode === 1 ? v.slice(0, pos) + v.slice(pos + 1)
              : v.toUpperCase() === v ? v.toLowerCase() : v.toUpperCase();
          }
          flags[c][i] = FLAG.DUPLICATE;
        }
        injected.duplicateLikeRows++;
      }
    }
  }
  step();

  // Missing values in nullable columns at the configured rate.
  if (edge.missingValues && config.nullRate > 0) {
    plans.forEach((p, c) => {
      if (!p.col.nullable || p.isKey) return;
      for (let i = 0; i < rowCount; i++) {
        if (edgeRng.chance(config.nullRate)) { data[c][i] = null; flags[c][i] = FLAG.NULL; injected.nulls++; }
      }
    });
  }
  step();

  // Numeric outliers beyond the observed range, at the configured rate.
  const numericStats = (c: number) => {
    let min = Infinity, max = -Infinity, sum = 0, sq = 0, n = 0;
    for (const v of data[c]) {
      if (typeof v !== 'number') continue;
      n++; sum += v; sq += v * v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const mean = n ? sum / n : 0;
    return { min, max, n, std: n > 1 ? Math.sqrt(Math.max(0, sq / n - mean * mean)) : 0 };
  };
  if (edge.numericOutliers && config.outlierRate > 0) {
    plans.forEach((p, c) => {
      if (p.kind !== 'numeric' || p.col.unique) return;
      const s = numericStats(c);
      if (!s.n) return;
      const spread = s.std || Math.abs(s.max) || 1;
      for (let i = 0; i < rowCount; i++) {
        if (data[c][i] === null || !edgeRng.chance(config.outlierRate)) continue;
        const up = s.min >= 0 || edgeRng.chance(0.5);
        const x = up ? s.max + spread * edgeRng.float(1.5, 4) : s.min - spread * edgeRng.float(1.5, 4);
        data[c][i] = p.col.type === 'integer' ? Math.round(x) : roundTo(x, p.decimals);
        flags[c][i] = FLAG.OUTLIER;
        injected.outliers++;
      }
    });
  }
  step();

  // Boundary values: exact min, max or 0 for numbers; first/last date for dates.
  if (edge.boundaryValues) {
    plans.forEach((p, c) => {
      if ((p.kind !== 'numeric' && p.kind !== 'datetime') || p.col.unique) return;
      let choices: Cell[];
      if (p.kind === 'numeric') {
        const s = numericStats(c);
        const min = typeof p.profile?.min === 'number' ? p.profile.min : s.min;
        const max = typeof p.profile?.max === 'number' ? p.profile.max : s.max;
        if (!Number.isFinite(min) || !Number.isFinite(max)) return;
        choices = [min, max, 0];
      } else {
        const format = p.col.format ?? defaultDateFormat(p.col.type === 'datetime' ? 'datetime' : 'date');
        const lo = p.profile?.minTs ?? DEFAULT_DATE_MIN;
        const hi = p.profile?.maxTs ?? DEFAULT_DATE_MAX - DAY_MS;
        choices = [formatDate(lo, format), formatDate(hi, format)];
      }
      for (let i = 0; i < rowCount; i++) {
        if (data[c][i] === null || flags[c][i] !== FLAG.NONE || !edgeRng.chance(EDGE_RATES.boundary)) continue;
        data[c][i] = edgeRng.pick(choices);
        flags[c][i] = FLAG.BOUNDARY;
        injected.boundaryValues++;
      }
    });
  }
  step();

  // Very long strings in free-text columns.
  if (edge.longText) {
    const excluded = new Set(['Phone', 'URL', 'Email', 'Identifier']);
    plans.forEach((p, c) => {
      if (p.kind !== 'text' || p.col.type !== 'string' || p.col.unique || excluded.has(p.col.semanticType ?? '')) return;
      for (let i = 0; i < rowCount; i++) {
        if (data[c][i] === null || !edgeRng.chance(EDGE_RATES.longText)) continue;
        const target = edgeRng.int(500, 2000);
        let s = String(data[c][i]);
        while (s.length < target) s += ' ' + faker.lorem.sentence();
        data[c][i] = s.slice(0, target);
        flags[c][i] = FLAG.LONG_TEXT;
        injected.longText++;
      }
    });
  }
  step();

  // AI-suggested edge cases the user ticked: literal values, or a value placed before/after another column.
  const aiCases = config.aiEdgeCases ?? [];
  if (aiCases.length) {
    injected.aiEdgeCases = 0;
    const isDateCol = (col: ColumnSchema) => col.type === 'date' || col.type === 'datetime';
    const fmt = (col: ColumnSchema) => col.format ?? defaultDateFormat(col.type === 'datetime' ? 'datetime' : 'date');
    const numericOf = (v: Cell, col: ColumnSchema) => (v === null ? null : isDateCol(col) ? parseDateWithFormat(String(v), col.format) : toNumber(v));
    for (const ec of aiCases) {
      const c = plans.findIndex(p => p.col.name === ec.column);
      if (c < 0 || plans[c].isKey || plans[c].col.unique) continue;
      const col = plans[c].col;
      const caseRng = edgeRng.derive(`ai:${ec.id}`);
      if (ec.compareWith) {
        const o = plans.findIndex(p => p.col.name === ec.compareWith!.column);
        if (o < 0) continue;
        const other = plans[o].col;
        const unit = isDateCol(col) ? DAY_MS : col.type === 'integer' ? 1 : 0.01;
        for (let i = 0; i < rowCount; i++) {
          if (flags[c][i] !== FLAG.NONE || !caseRng.chance(AI_EDGE_RATE)) continue;
          const base = numericOf(data[o][i], other);
          if (base === null) continue;
          const shifted = base + (ec.compareWith.op === '<' ? -1 : 1) * unit * caseRng.int(1, 30);
          data[c][i] = isDateCol(col) ? formatDate(shifted, fmt(col)) : col.type === 'integer' ? Math.round(shifted) : roundTo(shifted, 2);
          flags[c][i] = FLAG.AI_EDGE;
          injected.aiEdgeCases++;
        }
        continue;
      }
      // Convert literal suggestions to the column's type; values that don't fit the type are dropped.
      const values: Cell[] = ec.values.map((v): Cell | undefined => {
        if (col.type === 'integer' || col.type === 'float') {
          const n = toNumber(v);
          return n === null || (col.type === 'integer' && !Number.isInteger(n)) ? undefined : n;
        }
        if (col.type === 'boolean') return /^(true|yes|1)$/i.test(v) ? true : /^(false|no|0)$/i.test(v) ? false : undefined;
        if (isDateCol(col)) {
          const ts = parseDateWithFormat(v, 'YYYY-MM-DD');
          return ts === null ? undefined : formatDate(ts, fmt(col));
        }
        if (col.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return undefined;
        return v;
      }).filter((v): v is Cell => v !== undefined);
      if (!values.length) continue;
      for (let i = 0; i < rowCount; i++) {
        if (flags[c][i] !== FLAG.NONE || !caseRng.chance(AI_EDGE_RATE)) continue;
        data[c][i] = caseRng.pick(values);
        flags[c][i] = FLAG.AI_EDGE;
        injected.aiEdgeCases++;
      }
    }
  }
  step();

  return { schema, rowCount, data, flags, injected, forbiddenLog };
}
