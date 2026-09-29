// Column business rules: range (min/max), allowed values, regex pattern and column comparison.
// enforceRules() rewrites violating values (deterministically); checkRules() counts violations.

import type { Cell, ColumnRule, ColumnSchema } from '../types';
import type { Rng } from './random';
import { toNumber } from './infer';
import { defaultDateFormat, formatDate, parseDateWithFormat } from './dates';

const DAY_MS = 86_400_000;
const isDate = (c: ColumnSchema) => c.type === 'date' || c.type === 'datetime';
const isNumeric = (c: ColumnSchema) => c.type === 'integer' || c.type === 'float';

export function describeColumnRule(r: ColumnRule): string {
  switch (r.kind) {
    case 'range': return `${r.column} between ${r.min ?? '−∞'} and ${r.max ?? '∞'}`;
    case 'allowed': return `${r.column} in {${r.values.join(', ')}}`;
    case 'pattern': return `${r.column} matches /${r.regex}/`;
    case 'compare': return `${r.column} ${r.op} ${r.other}`;
  }
}

/** Rules that apply to one table ("table.column" → "column"); tabular data uses the rules as they are. */
export function rulesForTable(rules: ColumnRule[] | undefined, table?: string): ColumnRule[] {
  if (!rules?.length) return [];
  if (!table) return rules;
  const p = `${table}.`;
  const strip = (c: string) => (c.startsWith(p) ? c.slice(p.length) : null);
  const out: ColumnRule[] = [];
  for (const r of rules) {
    const column = strip(r.column);
    if (!column) continue;
    if (r.kind === 'compare') {
      const other = strip(r.other);
      if (other) out.push({ ...r, column, other });
    } else {
      out.push({ ...r, column });
    }
  }
  return out;
}

/** Numeric view of a cell for comparisons (epoch ms for dates). */
function numeric(v: Cell, col: ColumnSchema): number | null {
  if (v === null) return null;
  if (isDate(col)) return parseDateWithFormat(String(v), col.format);
  return toNumber(v);
}

function bound(b: number | string | undefined, col: ColumnSchema): number | undefined {
  if (b === undefined || b === '') return undefined;
  if (isDate(col)) {
    const ts = parseDateWithFormat(String(b), 'YYYY-MM-DD');
    return ts ?? undefined;
  }
  const n = typeof b === 'number' ? b : Number(b);
  return Number.isFinite(n) ? n : undefined;
}

function toCell(x: number, col: ColumnSchema): Cell {
  if (isDate(col)) return formatDate(col.type === 'date' ? Math.floor(x / DAY_MS) * DAY_MS : Math.round(x / 1000) * 1000, col.format ?? defaultDateFormat(col.type as 'date' | 'datetime'));
  if (col.type === 'integer') return Math.round(x);
  return Math.round(x * 100) / 100;
}

/** Smallest meaningful step for a column (1, 0.01 or one day). */
function unit(col: ColumnSchema): number {
  return isDate(col) ? DAY_MS : col.type === 'integer' ? 1 : 0.01;
}

function allowedMatch(v: Cell, values: string[], col: ColumnSchema): boolean {
  if (isNumeric(col)) {
    const n = toNumber(v);
    return n !== null && values.some(a => Number(a) === n);
  }
  return values.includes(String(v));
}

type CompareOp = '<' | '<=' | '>' | '>=' | '!=';

function compareOk(a: number, b: number, op: CompareOp): boolean {
  switch (op) {
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    case '!=': return a !== b;
  }
}

function safeRegex(src: string): RegExp | null {
  try { return new RegExp(src); } catch { return null; }
}

/** Returns an error message if the rule cannot be applied to this schema. */
export function ruleProblem(r: ColumnRule, schema: ColumnSchema[]): string | null {
  const col = schema.find(c => c.name === r.column);
  if (!col) return `Column "${r.column}" does not exist.`;
  if (r.kind === 'range') {
    if (!isNumeric(col) && !isDate(col)) return `${r.column}: min/max needs a number or date column.`;
    const lo = bound(r.min, col), hi = bound(r.max, col);
    if (lo === undefined && hi === undefined) return `${r.column}: enter a min, a max, or both${isDate(col) ? ' (YYYY-MM-DD)' : ''}.`;
    if (lo !== undefined && hi !== undefined && lo > hi) return `${r.column}: min is greater than max.`;
  }
  if (r.kind === 'allowed' && !r.values.length) return `${r.column}: add at least one allowed value.`;
  if (r.kind === 'pattern') {
    if (!safeRegex(r.regex)) return `${r.column}: invalid regular expression.`;
    if (parseRegex(r.regex) === null) {
      return `${r.column}: pattern uses features the generator can't produce (lookarounds, back-references or negated classes).`;
    }
  }
  if (r.kind === 'compare') {
    const other = schema.find(c => c.name === r.other);
    if (!other) return `Column "${r.other}" does not exist.`;
    const kindOf = (c: ColumnSchema) => (isDate(c) ? 'date' : isNumeric(c) ? 'number' : 'other');
    if (kindOf(col) === 'other' || kindOf(col) !== kindOf(other)) return `${r.column} and ${r.other} must both be numbers or both be dates.`;
  }
  return null;
}

// ─── Regex → string (subset) ─────────────────────────────────────────────────

type RNode =
  | { t: 'chars'; chars: string[]; min: number; max: number }
  | { t: 'group'; alts: RNode[][]; min: number; max: number };

const DIGITS = '0123456789'.split('');
const WORD = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split('');
const ALNUM = WORD.slice(0, 62);

/** Parses the supported subset (literals, classes, groups, alternation, quantifiers); null if unsupported. */
export function parseRegex(pattern: string): RNode[][] | null {
  const src = pattern.replace(/^\^/, '').replace(/(?<!\\)\$$/, '');
  let i = 0;
  let failed = false;

  const escape = (c: string): string[] => (c === 'd' ? DIGITS : c === 'w' ? WORD : c === 's' ? [' '] : [c]);

  const parseClass = (): string[] => {
    const chars: string[] = [];
    if (src[i] === '^') { failed = true; return chars; }
    while (i < src.length && src[i] !== ']') {
      const c = src[i++];
      if (c === '\\') { chars.push(...escape(src[i++])); continue; }
      if (src[i] === '-' && src[i + 1] && src[i + 1] !== ']') {
        const end = src[i + 1];
        i += 2;
        for (let k = c.charCodeAt(0); k <= end.charCodeAt(0); k++) chars.push(String.fromCharCode(k));
        continue;
      }
      chars.push(c);
    }
    i++; // ]
    return chars;
  };

  const quant = (): [number, number] => {
    const c = src[i];
    if (c === '?') { i++; return [0, 1]; }
    if (c === '*') { i++; return [0, 3]; }
    if (c === '+') { i++; return [1, 4]; }
    if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i));
      if (m) {
        i += m[0].length;
        const lo = +m[1];
        return [lo, m[2] ? (m[3] ? +m[3] : lo + 3) : lo];
      }
    }
    return [1, 1];
  };

  const parseSeq = (): RNode[] => {
    const seq: RNode[] = [];
    while (i < src.length && src[i] !== '|' && src[i] !== ')') {
      const c = src[i++];
      let node: RNode;
      if (c === '(') {
        if (src[i] === '?') { if (src[i + 1] === ':') i += 2; else { failed = true; return seq; } }
        const alts = parseAlts();
        i++; // )
        node = { t: 'group', alts, min: 1, max: 1 };
      } else if (c === '[') {
        node = { t: 'chars', chars: parseClass(), min: 1, max: 1 };
      } else if (c === '\\') {
        const e = src[i++];
        if (/[1-9bBDWS]/.test(e)) { failed = true; return seq; }
        node = { t: 'chars', chars: escape(e), min: 1, max: 1 };
      } else if (c === '.') {
        node = { t: 'chars', chars: ALNUM, min: 1, max: 1 };
      } else {
        node = { t: 'chars', chars: [c], min: 1, max: 1 };
      }
      [node.min, node.max] = quant();
      if (src[i] === '?') i++; // lazy modifier: same output
      seq.push(node);
    }
    return seq;
  };

  const parseAlts = (): RNode[][] => {
    const alts = [parseSeq()];
    while (src[i] === '|') { i++; alts.push(parseSeq()); }
    return alts;
  };

  const tree = parseAlts();
  return failed || i < src.length ? null : tree;
}

/** Generates a string matching a supported pattern; null if the pattern is unsupported. */
export function generateFromRegex(pattern: string, rng: Rng): string | null {
  const tree = parseRegex(pattern);
  if (!tree) return null;
  const gen = (seq: RNode[]): string => seq.map(n => {
    let s = '';
    const times = rng.int(n.min, n.max);
    for (let k = 0; k < times; k++) s += n.t === 'chars' ? (n.chars.length ? rng.pick(n.chars) : '') : gen(rng.pick(n.alts));
    return s;
  }).join('');
  return gen(rng.pick(tree));
}

// ─── Enforce & check ─────────────────────────────────────────────────────────

export function enforceRules(schema: ColumnSchema[], data: Cell[][], rowCount: number, rules: ColumnRule[], rng: Rng): void {
  const idx = (name: string) => schema.findIndex(c => c.name === name);
  const valid = rules.filter(r => !ruleProblem(r, schema));
  // Rules can interact (a compare swap may leave a range), so repeat a few passes.
  for (let pass = 0; pass < 3; pass++) {
    for (const r of valid) {
      const c = idx(r.column);
      const col = schema[c];
      const values = data[c];
      const rrng = rng.derive(`${r.id}:${pass}`);
      if (r.kind === 'range') {
        const lo = bound(r.min, col), hi = bound(r.max, col);
        for (let i = 0; i < rowCount; i++) {
          const x = numeric(values[i], col);
          if (x === null || ((lo === undefined || x >= lo) && (hi === undefined || x <= hi))) continue;
          const spread = Math.max(unit(col), Math.abs(lo ?? hi ?? 1) * 0.1);
          const a = lo ?? (hi! - spread), b = hi ?? (lo! + spread);
          values[i] = toCell(col.type === 'integer' ? rrng.int(Math.ceil(a), Math.floor(b)) : rrng.float(a, b), col);
        }
      } else if (r.kind === 'allowed') {
        const opts = r.values.map(v => (isNumeric(col) ? Number(v) : v));
        for (let i = 0; i < rowCount; i++) {
          if (values[i] !== null && !allowedMatch(values[i], r.values, col)) values[i] = rrng.pick(opts);
        }
      } else if (r.kind === 'pattern') {
        const re = safeRegex(r.regex)!;
        for (let i = 0; i < rowCount; i++) {
          if (values[i] === null || re.test(String(values[i]))) continue;
          for (let t = 0; t < 10; t++) {
            const s = generateFromRegex(r.regex, rrng);
            if (s !== null && re.test(s)) { values[i] = isNumeric(col) && toNumber(s) !== null ? toNumber(s) : s; break; }
          }
        }
      } else {
        const o = idx(r.other);
        const other = data[o];
        const oc = schema[o];
        for (let i = 0; i < rowCount; i++) {
          const a = numeric(values[i], col), b = numeric(other[i], oc);
          if (a === null || b === null || compareOk(a, b, r.op)) continue;
          if (a !== b && compareOk(b, a, r.op)) {
            // Swapping keeps both columns' value distributions.
            const tmp = values[i]; values[i] = other[i]; other[i] = tmp;
          } else {
            // Equal values: move the other column one step in the needed direction.
            const step = unit(oc) * rrng.int(1, 3);
            const target = r.op === '<' || r.op === '<=' || r.op === '!=' ? a + step : a - step;
            other[i] = toCell(target, oc);
          }
        }
      }
    }
  }
}

export interface RuleCheck {
  rows: number;
  passing: number;
  rules: { label: string; violations: number }[];
}

export function checkRules(schema: ColumnSchema[], data: ArrayLike<Cell>[], rowCount: number, rules: ColumnRule[]): RuleCheck {
  const failing = new Uint8Array(rowCount);
  const out: RuleCheck['rules'] = [];
  for (const r of rules) {
    const problem = ruleProblem(r, schema);
    if (problem) { out.push({ label: `${describeColumnRule(r)} (not applied: ${problem})`, violations: 0 }); continue; }
    const c = schema.findIndex(x => x.name === r.column);
    const col = schema[c];
    const values = data[c];
    let violations = 0;
    const fail = (i: number) => { violations++; failing[i] = 1; };
    if (r.kind === 'range') {
      const lo = bound(r.min, col), hi = bound(r.max, col);
      for (let i = 0; i < rowCount; i++) {
        const x = numeric(values[i], col);
        if (x !== null && ((lo !== undefined && x < lo) || (hi !== undefined && x > hi))) fail(i);
      }
    } else if (r.kind === 'allowed') {
      for (let i = 0; i < rowCount; i++) if (values[i] !== null && !allowedMatch(values[i], r.values, col)) fail(i);
    } else if (r.kind === 'pattern') {
      const re = safeRegex(r.regex)!;
      for (let i = 0; i < rowCount; i++) if (values[i] !== null && !re.test(String(values[i]))) fail(i);
    } else {
      const o = schema.findIndex(x => x.name === r.other);
      for (let i = 0; i < rowCount; i++) {
        const a = numeric(values[i], col), b = numeric(data[o][i], schema[o]);
        if (a !== null && b !== null && !compareOk(a, b, r.op)) fail(i);
      }
    }
    out.push({ label: describeColumnRule(r), violations });
  }
  let passing = 0;
  for (let i = 0; i < rowCount; i++) if (!failing[i]) passing++;
  return { rows: rowCount, passing, rules: out };
}
