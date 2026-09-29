// Column privacy transforms, applied to generated data after edge cases and before profiling.
//   preserve  – no change
//   mask      – partial redaction (emails, phones/IDs, names, other text)
//   hash      – SHA-256 via Web Crypto, shortened; same input → same hash
//   synthetic – handled at generation time: the column ignores learned values and is produced by faker
//   noise     – Laplace noise on numbers, scale = sensitivity / ε

import type { Cell, ColumnSchema, DatasetProfile, PrivacyColumnReport, PrivacyTransform } from '../types';
import type { Rng } from './random';
import { toNumber } from './infer';

export const DEFAULT_EPSILON = 1;
export const MIN_EPSILON = 0.1;
export const MAX_EPSILON = 10;
/** Sensitivity used for noise: this share of the column's value range. */
export const NOISE_SENSITIVITY_SHARE = 0.05;
const HASH_LENGTH = 16;
const EXAMPLES = 3;

export function isNumericType(type: ColumnSchema['type']): boolean {
  return type === 'integer' || type === 'float';
}

/** Transforms that make sense for a column type (noise is numeric only). */
export function allowedTransforms(col: ColumnSchema): PrivacyTransform[] {
  return isNumericType(col.type)
    ? ['preserve', 'noise', 'hash', 'synthetic']
    : ['preserve', 'mask', 'hash', 'synthetic'];
}

/** Type a column's values have after its transform (masking/hashing produce text). */
export function effectiveType(col: ColumnSchema): ColumnSchema['type'] {
  if (col.privacyTransform === 'hash') return 'string';
  if (col.privacyTransform === 'mask' && col.type !== 'email') return 'string';
  return col.type;
}

// ─── Mask ────────────────────────────────────────────────────────────────────

function maskEmail(s: string): string {
  const at = s.lastIndexOf('@');
  if (at <= 0) return maskText(s);
  return `${s[0]}****${s.slice(at)}`;
}

/** Keeps the last 4 digits; every other digit or letter becomes '*', separators stay. */
function maskKeepLast4(s: string): string {
  let digitsSeen = 0;
  const totalDigits = (s.match(/\d/g) ?? []).length;
  let out = '';
  for (const ch of s) {
    if (/\d/.test(ch)) {
      digitsSeen++;
      out += digitsSeen > totalDigits - 4 ? ch : '*';
    } else if (/[a-z]/i.test(ch)) {
      out += totalDigits >= 4 ? '*' : ch;
    } else {
      out += ch;
    }
  }
  return totalDigits ? out : maskText(s);
}

/** First letter of each word, the rest starred: "Ali Khan" → "A** K***". */
function maskName(s: string): string {
  return s.split(/(\s+)/).map(w => (/\s/.test(w) || !w ? w : w[0] + '*'.repeat(Math.max(0, w.length - 1)))).join('');
}

function maskText(s: string): string {
  return s.length <= 1 ? '*' : s[0] + '*'.repeat(Math.min(s.length - 1, 12));
}

export function maskValue(v: Cell, col: ColumnSchema): Cell {
  if (v === null) return null;
  const s = String(v);
  const semantic = col.semanticType ?? '';
  if (col.type === 'email' || semantic === 'Email' || /@/.test(s)) return maskEmail(s);
  if (semantic === 'Phone' || semantic === 'Identifier' || /\d{4}/.test(s)) return maskKeepLast4(s);
  if (semantic === 'Person Name' || semantic === 'Address' || semantic === 'Company') return maskName(s);
  return maskText(s);
}

// ─── Hash ────────────────────────────────────────────────────────────────────

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

// ─── Noise ───────────────────────────────────────────────────────────────────

function laplace(rng: Rng, scale: number): number {
  const u = rng.next() - 0.5;
  return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

// ─── Apply ───────────────────────────────────────────────────────────────────

export interface PrivacyInput {
  schema: ColumnSchema[];
  data: Cell[][];
  epsilon: number;
  rng: Rng;
  /** Learned profile of the uploaded file, used for the noise sensitivity range. */
  profile?: DatasetProfile | null;
  onProgress?: (fraction: number) => void;
}

export async function applyPrivacy(input: PrivacyInput): Promise<PrivacyColumnReport[]> {
  const { schema, data, rng, profile } = input;
  const epsilon = Math.min(MAX_EPSILON, Math.max(MIN_EPSILON, input.epsilon || DEFAULT_EPSILON));
  const reports: PrivacyColumnReport[] = [];

  for (let c = 0; c < schema.length; c++) {
    const col = schema[c];
    const transform: PrivacyTransform = col.privacyTransform ?? 'preserve';
    const values = data[c];
    const report: PrivacyColumnReport = { column: col.name, level: col.privacyLevel, transform, changed: 0, examples: [], note: '' };
    const record = (i: number, before: Cell) => {
      if (before !== values[i]) report.changed++;
      if (report.examples.length < EXAMPLES && before !== null) report.examples.push({ before, after: values[i] });
    };

    if (transform === 'mask') {
      for (let i = 0; i < values.length; i++) {
        const before = values[i];
        values[i] = maskValue(before, col);
        record(i, before);
      }
      report.note = col.type === 'email' || col.semanticType === 'Email'
        ? 'First character and domain kept.'
        : col.semanticType === 'Person Name' ? 'First letter of each word kept.'
        : 'Last 4 digits kept for numbers/IDs, first character for text.';
    } else if (transform === 'hash') {
      const cache = new Map<string, string>();
      for (let i = 0; i < values.length; i++) {
        const before = values[i];
        if (before === null) continue;
        const key = String(before);
        let h = cache.get(key);
        if (h === undefined) {
          h = (await sha256Hex(key)).slice(0, HASH_LENGTH);
          cache.set(key, h);
        }
        values[i] = h;
        record(i, before);
      }
      report.note = `SHA-256, first ${HASH_LENGTH} hex characters. Identical inputs give identical hashes.`;
    } else if (transform === 'noise' && isNumericType(col.type)) {
      const learned = profile?.columns.find(p => p.name === (col.sourceColumn ?? col.name));
      let lo = typeof learned?.min === 'number' ? learned.min : Infinity;
      let hi = typeof learned?.max === 'number' ? learned.max : -Infinity;
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        for (const v of values) {
          const n = toNumber(v);
          if (n === null) continue;
          if (n < lo) lo = n;
          if (n > hi) hi = n;
        }
      }
      const range = Number.isFinite(hi - lo) ? hi - lo : 0;
      const sensitivity = range > 0 ? range * NOISE_SENSITIVITY_SHARE : 1;
      const scale = sensitivity / epsilon;
      const nonNegative = lo >= 0;
      const decimals = col.type === 'integer' ? 0 : Math.max(2, learned?.decimals ?? 2);
      const noiseRng = rng.derive(`noise:${col.name}`);
      for (let i = 0; i < values.length; i++) {
        const before = values[i];
        const n = toNumber(before);
        if (n === null) continue;
        let x = n + laplace(noiseRng, scale);
        if (nonNegative && x < 0) x = 0;
        const f = 10 ** decimals;
        values[i] = Math.round(x * f) / f;
        record(i, before);
      }
      report.note = `Laplace noise, scale ${scale.toPrecision(3)} = sensitivity ${sensitivity.toPrecision(3)} (5% of range ${range.toPrecision(3)}) ÷ ε ${epsilon}.`;
    } else if (transform === 'synthetic') {
      report.note = 'Generated by faker per semantic type; learned values from the upload are not used.';
    } else {
      report.note = 'No change.';
    }
    if (!report.examples.length) {
      for (let i = 0; i < values.length && report.examples.length < EXAMPLES; i++) {
        if (values[i] !== null) report.examples.push({ before: values[i], after: values[i] });
      }
    }

    if (transform !== 'preserve' || col.privacyLevel === 'high' || col.privacyLevel === 'medium') reports.push(report);
    input.onProgress?.((c + 1) / schema.length);
  }
  return reports;
}
