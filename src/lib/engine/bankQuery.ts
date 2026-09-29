// Rule-based parser for bank statement requests such as
// "last 90 days, balance over 500, 40 transactions, savings account".
// This is the fallback that later AI parsing builds on.

import type { BankStatementConfig } from '../types';
import { region, tsToIso, DAY_MS } from './regions';

export interface ParsedBankQuery {
  config: BankStatementConfig;
  /** What was understood, in plain language (shown to the user before generating). */
  understood: string[];
  /** Parts of the text that matched no rule. */
  ignored: string[];
}

const NUM = String.raw`(\d[\d,]*(?:\.\d+)?\s*[km]?)`;

function toNumber(s: string): number {
  const t = s.trim().toLowerCase().replace(/,/g, '');
  const mult = t.endsWith('k') ? 1_000 : t.endsWith('m') ? 1_000_000 : 1;
  return parseFloat(t) * mult;
}

const CURRENCY_WORDS: [RegExp, string][] = [
  [/\b(pkr|rupees?|rs\.?)\b/i, 'PKR'], [/\b(usd|dollars?|\$)/i, 'USD'], [/\b(gbp|pounds?|£)/i, 'GBP'],
  [/\b(eur|euros?|€)/i, 'EUR'], [/\b(inr)\b/i, 'INR'], [/\b(cad)\b/i, 'CAD'], [/\b(aud)\b/i, 'AUD'],
];
const LOCALE_WORDS: [RegExp, string][] = [
  [/\bpakistan(i)?\b/i, 'PK'], [/\b(usa|united states|america(n)?)\b/i, 'US'], [/\b(uk|united kingdom|britain|british)\b/i, 'GB'],
  [/\bindia(n)?\b/i, 'IN'], [/\bgerman(y)?\b/i, 'DE'], [/\bfran(ce|ch)\b/i, 'FR'], [/\bcanad(a|ian)\b/i, 'CA'], [/\baustralia(n)?\b/i, 'AU'],
];

// ─── Dates ───────────────────────────────────────────────────────────────────

const MONTHS: [RegExp, number][] = [
  [/^jan/, 0], [/^feb/, 1], [/^mar/, 2], [/^apr/, 3], [/^may/, 4], [/^jun/, 5],
  [/^jul/, 6], [/^aug/, 7], [/^sep/, 8], [/^oct/, 9], [/^nov/, 10], [/^dec/, 11],
];
const MON = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const ORD = String.raw`(?:st|nd|rd|th)?`;
/** A date or month, without a bare year (so "between 1000 and 5000" stays an amount range). */
const DATE = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{1,2}${ORD}\s+${MON}(?:,?\s+\d{4})?|${MON}\s+\d{1,2}${ORD},?\s+\d{4}|${MON}\s+\d{1,2}${ORD}(?!\d)|${MON}(?:\s+\d{4})?)`;
/** A year on its own; not when it is really a count ("2000 transactions"). */
const YEAR = String.raw`(?:19|20)\d{2}(?!\s*(?:transactions?|txns?|entries|rows|statements?|accounts?|k\b|m\b|\d))`;
const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

interface DateToken {
  from: number;
  to: number;
  /** The year was not written and was guessed (latest one not in the future). */
  yearGuessed: boolean;
}

const utc = (y: number, m: number, d: number) => Date.UTC(y, m, d);
const monthIndex = (s: string) => MONTHS.find(([re]) => re.test(s))?.[1] ?? -1;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Resolves one written date or month to the day range it covers, or null when it is not a valid date. */
function resolveDate(token: string, todayTs: number): DateToken | null {
  const t = token.trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
  const today = new Date(todayTs);
  const guessYear = (m: number, d = 1) => (utc(today.getUTCFullYear(), m, d) > todayTs ? today.getUTCFullYear() - 1 : today.getUTCFullYear());
  const day = (y: number, m: number, d: number): DateToken | null => {
    if (m < 0 || d < 1 || d > lastDay(y, m)) return null;
    const ts = utc(y, m, d);
    return { from: ts, to: ts, yearGuessed: false };
  };
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) return day(+m[1], +m[2] - 1, +m[3]);
  if ((m = new RegExp(String.raw`^(\d{1,2})${ORD} (${MON})(?: (\d{4}))?$`).exec(t))) {
    const mon = monthIndex(m[2]);
    const r = day(m[3] ? +m[3] : guessYear(mon, +m[1]), mon, +m[1]);
    return r && { ...r, yearGuessed: !m[3] };
  }
  if ((m = new RegExp(String.raw`^(${MON}) (\d{1,2})${ORD}(?: (\d{4}))?$`).exec(t))) {
    const mon = monthIndex(m[1]);
    const r = day(m[3] ? +m[3] : guessYear(mon, +m[2]), mon, +m[2]);
    return r && { ...r, yearGuessed: !m[3] };
  }
  if ((m = new RegExp(String.raw`^(${MON})(?: (\d{4}))?$`).exec(t))) {
    const mon = monthIndex(m[1]);
    const y = m[2] ? +m[2] : guessYear(mon);
    return { from: utc(y, mon, 1), to: utc(y, mon, lastDay(y, mon)), yearGuessed: !m[2] };
  }
  if ((m = new RegExp(String.raw`^(${YEAR})$`).exec(t))) return { from: utc(+m[1], 0, 1), to: utc(+m[1], 11, 31), yearGuessed: false };
  return null;
}

interface Period {
  from: string;
  to: string;
  label: string;
  /** Text to remove from the query. */
  matched: string;
}

/**
 * Finds the statement period in the query. Supported: "between X and Y", "from X to/until Y",
 * "since X", "in/during/for X" (a month, "March 2026" or a year), "this month", "this year",
 * "year to date", and "last/past N days/weeks/months/years" (N may be a word, e.g. "last two weeks").
 * X and Y can be ISO dates (2026-01-31), "1 March 2026", "March 1, 2026", "March 2026" or "March".
 */
export function parsePeriod(text: string, today: Date = new Date()): Period | null {
  const todayTs = utc(today.getFullYear(), today.getMonth(), today.getDate());
  const iso = tsToIso;

  const range = new RegExp(String.raw`\b(?:between|from)\s+(${DATE})\s+(?:and|to|until|till|through|-)\s+(${DATE})\b`).exec(text);
  if (range) {
    const a = resolveDate(range[1], todayTs), b = resolveDate(range[2], todayTs);
    if (a && b) {
      let from = a.from;
      // "from November to February": the start month belongs to the year before.
      if (from > b.to && a.yearGuessed) from = utc(new Date(from).getUTCFullYear() - 1, new Date(from).getUTCMonth(), new Date(from).getUTCDate());
      const [lo, hi] = from <= b.to ? [from, b.to] : [b.from, a.to];
      return { from: iso(lo), to: iso(hi), label: `${range[1].trim()} to ${range[2].trim()}`, matched: range[0] };
    }
  }

  const since = new RegExp(String.raw`\b(?:since|starting(?:\s+from)?|after)\s+(${DATE}|${YEAR})\b`).exec(text);
  if (since) {
    const a = resolveDate(since[1], todayTs);
    if (a && a.from <= todayTs) return { from: iso(a.from), to: iso(todayTs), label: `since ${since[1].trim()}`, matched: since[0] };
  }

  const within = new RegExp(String.raw`\b(?:in|during|for|of)\s+(?:the\s+month\s+of\s+)?(${MON}(?:\s+\d{4})?|${YEAR})\b`).exec(text);
  if (within) {
    const a = resolveDate(within[1], todayTs);
    if (a) return { from: iso(a.from), to: iso(a.to), label: `in ${within[1].trim()}`, matched: within[0] };
  }

  const current = /\b(this\s+month|month\s+to\s+date|mtd|this\s+year|year\s+to\s+date|ytd)\b/.exec(text);
  if (current) {
    const d = new Date(todayTs);
    const monthly = /month|mtd/.test(current[1]);
    const from = monthly ? utc(d.getUTCFullYear(), d.getUTCMonth(), 1) : utc(d.getUTCFullYear(), 0, 1);
    return { from: iso(from), to: iso(todayTs), label: current[1], matched: current[0] };
  }

  const rel = new RegExp(String.raw`\b(?:last|past|previous)\s+(\d+|${Object.keys(WORD_NUMBERS).join('|')})?\s*(day|week|month|year)s?\b`).exec(text);
  if (rel) {
    const n = rel[1] ? (/^\d+$/.test(rel[1]) ? parseInt(rel[1], 10) : WORD_NUMBERS[rel[1]]) : 1;
    const unitDays = { day: 1, week: 7, month: 30, year: 365 }[rel[2] as 'day' | 'week' | 'month' | 'year'];
    return {
      from: iso(todayTs - (n * unitDays - 1) * DAY_MS), to: iso(todayTs),
      label: `last ${n} ${rel[2]}${n === 1 ? '' : 's'}`, matched: rel[0],
    };
  }
  return null;
}

/**
 * Applies every recognised phrase on top of `base`. `today` anchors relative ranges ("last 90 days")
 * and is passed in so results are reproducible.
 */
export function parseBankQuery(text: string, base: BankStatementConfig, today: Date = new Date()): ParsedBankQuery {
  const config: BankStatementConfig = { ...base };
  const understood: string[] = [];
  let rest = ` ${text.toLowerCase()} `;
  const consume = (re: RegExp) => { rest = rest.replace(re, ' '); };
  const drop = (matched: string) => { rest = rest.replace(matched, ' '); };
  const money = (n: number) => n.toLocaleString('en-US');

  // Period. The first matching form wins: explicit range, "since X", "in X", "this month/year", "last N units".
  const period = parsePeriod(rest, today);
  if (period) {
    config.dateFrom = period.from;
    config.dateTo = period.to;
    understood.push(`Period: ${period.from} to ${period.to} (${period.label})`);
    drop(period.matched);
  }

  const tx = new RegExp(String.raw`\b(\d+)\s*(?:transactions?|txns?|entries|rows)\b`).exec(rest);
  if (tx) { config.transactionCount = parseInt(tx[1], 10); understood.push(`${config.transactionCount} transactions per statement`); consume(/\b\d+\s*(?:transactions?|txns?|entries|rows)\b/); }

  const st = /\b(\d+)\s*(?:statements?|accounts?)\b/.exec(rest);
  if (st) { config.count = parseInt(st[1], 10); understood.push(`${config.count} statement${config.count === 1 ? '' : 's'}`); consume(/\b\d+\s*(?:statements?|accounts?)\b/); }

  const type = /\b(savings?|checking|current|business|corporate)\b(?:\s+account)?/.exec(rest);
  if (type) {
    const t = type[1];
    config.accountType = t.startsWith('saving') ? 'savings' : t === 'business' || t === 'corporate' ? 'business' : 'checking';
    understood.push(`Account type: ${config.accountType}`);
    consume(/\b(savings?|checking|current|business|corporate)\b(?:\s+account)?/);
  }

  const floor = new RegExp(String.raw`\b(?:never\s+(?:go(?:es)?\s+)?(?:below|under|less than)|(?:minimum|min)\s+balance(?:\s+of)?|balance\s+(?:over|above|at least|>=?|of at least|never below))\s*` + NUM).exec(rest);
  if (floor) {
    config.minBalance = toNumber(floor[1]);
    understood.push(`Balance never below ${money(config.minBalance)}`);
    drop(floor[0]);
  }
  if (/\b(no overdraft|never negative|no negative balance|never overdrawn)\b/.test(rest)) {
    config.preventNegative = true;
    understood.push('Balance never negative');
    consume(/\b(no overdraft|never negative|no negative balance|never overdrawn)\b/);
  }

  const opening = new RegExp(String.raw`\b(?:start(?:ing)?|opening|initial)\s+(?:balance\s+)?(?:of\s+)?` + NUM).exec(rest);
  if (opening) {
    config.startingBalance = toNumber(opening[1]);
    understood.push(`Opening balance ${money(config.startingBalance)}`);
    drop(opening[0]);
  }

  const between = new RegExp(String.raw`\b(?:amounts?\s+)?between\s+` + NUM + String.raw`\s+and\s+` + NUM).exec(rest);
  if (between) {
    config.minAmount = toNumber(between[1]);
    config.maxAmount = toNumber(between[2]);
    understood.push(`Transaction amounts ${money(config.minAmount)}–${money(config.maxAmount)}`);
    drop(between[0]);
  } else {
    const maxA = new RegExp(String.raw`\b(?:max(?:imum)?|up to|at most)\s+(?:amount|transaction)?\s*(?:of\s+)?` + NUM).exec(rest);
    if (maxA) { config.maxAmount = toNumber(maxA[1]); understood.push(`Transactions up to ${money(config.maxAmount)}`); drop(maxA[0]); }
    const minA = new RegExp(String.raw`\b(?:min(?:imum)?|at least)\s+(?:amount|transaction)\s*(?:of\s+)?` + NUM).exec(rest);
    if (minA) { config.minAmount = toNumber(minA[1]); understood.push(`Transactions at least ${money(config.minAmount)}`); drop(minA[0]); }
  }

  for (const [re, loc] of LOCALE_WORDS) {
    if (re.test(rest)) {
      config.locale = loc;
      config.currency = region(loc).currency;
      understood.push(`Region: ${loc} (${config.currency})`);
      consume(re);
      break;
    }
  }
  for (const [re, cur] of CURRENCY_WORDS) {
    if (re.test(rest)) { config.currency = cur; understood.push(`Currency: ${cur}`); consume(re); break; }
  }

  // Keep the opening balance above the floor, otherwise the constraint cannot hold from day one.
  const floorValue = config.minBalance ?? (config.preventNegative ? 0 : undefined);
  if (floorValue !== undefined && config.startingBalance < floorValue) {
    config.startingBalance = Math.ceil(floorValue * 2);
    understood.push(`Opening balance raised to ${money(config.startingBalance)} so it starts above the minimum`);
  }

  const ignored = rest.split(/[,;.]|\band\b/).map(s => s.trim()).filter(s => s && !/^(with|a|an|the|for|of|account|please|generate|make|create|give me|i want)$/.test(s));
  return { config, understood, ignored };
}
