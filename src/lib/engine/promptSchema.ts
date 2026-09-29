// Rule-based fallback for "describe your dataset" prompts, e.g.
// "generate 1000 Pakistani customers with name, city, phone, age 18-60".
// Used when AI is unavailable; the AI route returns the same shape.

import type { ColumnRule, ColumnSchema } from '../types';
import { defaultPrivacy, normalizeName } from './infer';

export interface PromptSchema {
  rowCount: number | null;
  locale: string | null;
  columns: ColumnSchema[];
  rules: ColumnRule[];
}

const LOCALE_WORDS: [RegExp, string][] = [
  [/\bpakistan(i)?\b/i, 'PK'], [/\b(usa|american|united states)\b/i, 'US'], [/\b(uk|british|united kingdom)\b/i, 'GB'],
  [/\bindia(n)?\b/i, 'IN'], [/\bgerman(y)?\b/i, 'DE'], [/\b(french|france)\b/i, 'FR'], [/\bcanad(a|ian)\b/i, 'CA'], [/\baustralia(n)?\b/i, 'AU'],
];

/** name pattern → [type, semantic type] */
const GUESSES: [RegExp, ColumnSchema['type'], string][] = [
  [/(^|_)e_?mail/, 'email', 'Email'],
  [/(^|_)(phone|mobile|cell)/, 'string', 'Phone'],
  [/(^|_)(first_|last_|full_)?name$/, 'string', 'Person Name'],
  [/(^|_)(city|town)$/, 'string', 'City'],
  [/(^|_)country$/, 'string', 'Country'],
  [/(^|_)(address|street)/, 'string', 'Address'],
  [/(^|_)age$/, 'integer', 'Age'],
  [/(^|_)(dob|birth|date|signup|joined|created)/, 'date', 'Date'],
  [/(^|_)(price|amount|salary|balance|total|cost|income)/, 'float', 'Currency'],
  [/(^|_)(qty|quantity|count|units)/, 'integer', 'Quantity'],
  [/(^|_)(status)$/, 'string', 'Status'],
  [/(^|_)(gender|category|type|segment|department)$/, 'string', 'Category'],
  [/(^|_)(company|employer)/, 'string', 'Company'],
  [/(^|_)(url|website)/, 'string', 'URL'],
  [/(^|_)(description|notes?|review|comment|bio)/, 'string', 'Description'],
  [/(^|_)(is_|has_|active|verified)/, 'boolean', 'Category'],
  [/(^|_)id$/, 'integer', 'Identifier'],
];

export function parsePromptSchema(text: string): PromptSchema {
  const t = text.trim();
  // Column list: whatever follows "with" / "columns" / ":"; split on commas and "and".
  const listMatch = /\b(?:with|columns?|fields?)\b\s*:?\s*(.+)$/i.exec(t) ?? /:\s*(.+)$/.exec(t);
  // The row count is a number before the column list (so "age 18-60" is never read as a count).
  const head = listMatch ? t.slice(0, listMatch.index) : t;
  const count = /\b(\d[\d,]*)(\s*k\b)?/i.exec(head);
  let rowCount: number | null = null;
  if (count) {
    rowCount = parseInt(count[1].replace(/,/g, ''), 10) * (count[2] ? 1000 : 1);
    if (!(rowCount > 0)) rowCount = null;
  }
  const locale = LOCALE_WORDS.find(([re]) => re.test(t))?.[1] ?? null;

  const parts = (listMatch?.[1] ?? '').split(/,|\band\b|;/i).map(s => s.trim()).filter(Boolean);

  const columns: ColumnSchema[] = [{ name: 'id', type: 'integer', semanticType: 'Identifier', nullable: false, unique: true, privacyLevel: 'medium', privacyTransform: 'preserve' }];
  const rules: ColumnRule[] = [];
  for (const part of parts) {
    const range = /(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)/.exec(part);
    const name = normalizeName(part.replace(range?.[0] ?? '', '').replace(/\b(between|from|of|aged)\b/gi, ' '));
    if (!name || columns.some(c => c.name === name)) continue;
    const guess = GUESSES.find(([re]) => re.test(name));
    const type = guess?.[1] ?? (range ? (range[1].includes('.') || range[2].includes('.') ? 'float' : 'integer') : 'string');
    const semanticType = guess?.[2] ?? (range ? 'Quantity' : 'Other');
    const p = defaultPrivacy(name, semanticType);
    columns.push({
      name, type, semanticType, nullable: semanticType !== 'Identifier', unique: type === 'email',
      privacyLevel: p.level, privacyTransform: p.transform,
    });
    if (range && (type === 'integer' || type === 'float')) {
      rules.push({ id: `pr_${name}`, kind: 'range', column: name, min: Number(range[1]), max: Number(range[2]) });
    }
  }
  return { rowCount, locale, columns: columns.length > 1 ? columns : [], rules };
}
