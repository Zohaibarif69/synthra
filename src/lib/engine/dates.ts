// Date parsing/formatting shared by inference, profiling and generation.
// All timestamps are treated as UTC so output never depends on the viewer's timezone.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAME_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i;

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:([T ])(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/;
const YMD_RE = /^(\d{4})([/.])(\d{1,2})\2(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const DMY_RE = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;

export interface ParsedDate {
  ts: number;
  hasTime: boolean;
  format: string;
}

function utc(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const ts = Date.UTC(y, mo - 1, d, h, mi, s);
  const dt = new Date(ts);
  // Rejects impossible dates such as 31/02.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return ts;
}

function timeSuffix(hasSeconds: boolean): string {
  return hasSeconds ? ' HH:mm:ss' : ' HH:mm';
}

/** Parses one date string. `dayFirst` decides between DD/MM/YYYY and MM/DD/YYYY. */
export function parseDateString(input: string, dayFirst = true): ParsedDate | null {
  const s = input.trim();
  if (!s || s.length > 40) return null;

  let m = ISO_RE.exec(s);
  if (m) {
    const [, y, mo, d, sep, h, mi, sec, zone] = m;
    let ts = utc(+y, +mo, +d, h ? +h : 0, mi ? +mi : 0, sec ? +sec : 0);
    if (ts === null) return null;
    if (!h) return { ts, hasTime: false, format: 'YYYY-MM-DD' };
    if (zone && zone !== 'Z') {
      const sign = zone[0] === '-' ? -1 : 1;
      const digits = zone.slice(1).replace(':', '');
      ts -= sign * (+digits.slice(0, 2) * 60 + +digits.slice(2, 4)) * 60000;
    }
    const format = sep === 'T'
      ? `YYYY-MM-DDTHH:mm${sec ? ':ss' : ''}${zone ? 'Z' : ''}`
      : `YYYY-MM-DD${timeSuffix(!!sec)}`;
    return { ts, hasTime: true, format };
  }

  m = YMD_RE.exec(s);
  if (m) {
    const [, y, sep, mo, d, h, mi, sec] = m;
    const ts = utc(+y, +mo, +d, h ? +h : 0, mi ? +mi : 0, sec ? +sec : 0);
    if (ts === null) return null;
    const format = `YYYY${sep}MM${sep}DD${h ? timeSuffix(!!sec) : ''}`;
    return { ts, hasTime: !!h, format };
  }

  m = DMY_RE.exec(s);
  if (m) {
    const [, a, sep, b, y, h, mi, sec, ampm] = m;
    let day = dayFirst ? +a : +b;
    let month = dayFirst ? +b : +a;
    // An impossible month means the other order was meant.
    if (month > 12 && day <= 12) [day, month] = [month, day];
    let hour = h ? +h : 0;
    if (ampm) {
      if (hour > 12) return null;
      if (/p/i.test(ampm) && hour < 12) hour += 12;
      if (/a/i.test(ampm) && hour === 12) hour = 0;
    }
    const ts = utc(+y, month, day, hour, mi ? +mi : 0, sec ? +sec : 0);
    if (ts === null) return null;
    const order = dayFirst ? `DD${sep}MM${sep}YYYY` : `MM${sep}DD${sep}YYYY`;
    return { ts, hasTime: !!h, format: order + (h ? timeSuffix(!!sec) : '') };
  }

  if (MONTH_NAME_RE.test(s) && /\b\d{4}\b/.test(s)) {
    const local = Date.parse(s);
    if (Number.isNaN(local)) return null;
    const dt = new Date(local);
    const hasTime = /\d{1,2}:\d{2}/.test(s);
    const ts = Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate(), dt.getHours(), dt.getMinutes(), dt.getSeconds());
    return { ts, hasTime, format: hasTime ? 'MMM DD, YYYY HH:mm' : 'MMM DD, YYYY' };
  }
  return null;
}

/** Decides a column's date format from sample strings. Returns the share of values that parsed. */
export function detectDateFormat(samples: string[]): { format: string; hasTime: boolean; ratio: number } | null {
  if (!samples.length) return null;
  // Evidence for day/month order: a first part > 12 means day-first, a second part > 12 means month-first.
  let dayFirst = true;
  for (const s of samples) {
    const m = DMY_RE.exec(s.trim());
    if (!m) continue;
    if (+m[1] > 12) { dayFirst = true; break; }
    if (+m[3] > 12) { dayFirst = false; break; }
  }
  const formats = new Map<string, number>();
  let parsed = 0;
  let hasTime = false;
  for (const s of samples) {
    const p = parseDateString(s, dayFirst);
    if (!p) continue;
    parsed++;
    if (p.hasTime) hasTime = true;
    formats.set(p.format, (formats.get(p.format) ?? 0) + 1);
  }
  if (!parsed) return null;
  let format = '';
  let best = -1;
  for (const [f, c] of formats) if (c > best) { best = c; format = f; }
  if (hasTime && !/HH/.test(format)) format += ' HH:mm:ss';
  return { format, hasTime, ratio: parsed / samples.length };
}

/** Parses a value using a column's detected format (day/month order comes from the format). */
export function parseDateWithFormat(value: string, format?: string): number | null {
  const dayFirst = !format || !format.startsWith('MM');
  return parseDateString(value, dayFirst)?.ts ?? null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function formatDate(ts: number, format = 'YYYY-MM-DD'): string {
  const d = new Date(ts);
  const parts: Record<string, string> = {
    YYYY: String(d.getUTCFullYear()),
    MMM: MONTHS[d.getUTCMonth()],
    MM: pad(d.getUTCMonth() + 1),
    DD: pad(d.getUTCDate()),
    HH: pad(d.getUTCHours()),
    mm: pad(d.getUTCMinutes()),
    ss: pad(d.getUTCSeconds()),
  };
  return format.replace(/YYYY|MMM|MM|DD|HH|mm|ss/g, t => parts[t]);
}

export function defaultDateFormat(type: 'date' | 'datetime'): string {
  return type === 'datetime' ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD';
}
