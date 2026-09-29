// File serializers for generated data. Output is built as an array of string chunks (a few thousand
// rows each) so large datasets become a Blob without one giant string. Pure and deterministic: the same
// data always serializes to the same bytes (no timestamps inside files).

import type { Cell, ColumnSchema, Relationship } from '../types';
import { toNumber } from './infer';
import { formatDate, parseDateWithFormat } from './dates';

export const CHUNK_ROWS = 5000;

export interface ExportTable {
  name: string;
  schema: ColumnSchema[];
  data: ArrayLike<Cell>[];
  rowCount: number;
}

export function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'dataset';
}

/** e.g. "customers_synthetic_2026-09-29.csv" (date = when the dataset was generated). */
export function exportFileName(datasetName: string, createdAt: string, ext: string): string {
  return `${slugify(datasetName)}_${createdAt.slice(0, 10)}.${ext}`;
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * CSV/formula-injection guard: spreadsheet apps run a cell starting with =, +, -, @, tab or carriage
 * return as a formula. Such text is prefixed with a single quote so it opens as plain text. Plain
 * numbers such as "-12.5" or "+3" are left untouched.
 */
export function csvSafeText(s: string): string {
  if (!s || !/^[=+\-@\t\r]/.test(s)) return s;
  return PLAIN_NUMBER.test(s) ? s : `'${s}`;
}

function csvField(v: Cell | undefined): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? csvSafeText(v) : String(v);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV with a UTF-8 BOM and CRLF line endings, so Excel opens it with the right encoding. */
export function csvParts(t: ExportTable, bom = true): string[] {
  const parts = [(bom ? '﻿' : '') + t.schema.map(c => csvField(c.name)).join(',') + '\r\n'];
  const cols = t.data.length;
  for (let start = 0; start < t.rowCount; start += CHUNK_ROWS) {
    const end = Math.min(t.rowCount, start + CHUNK_ROWS);
    const lines: string[] = [];
    for (let i = start; i < end; i++) {
      let line = '';
      for (let c = 0; c < cols; c++) line += (c ? ',' : '') + csvField(t.data[c][i]);
      lines.push(line);
    }
    parts.push(lines.join('\r\n') + '\r\n');
  }
  return parts;
}

// ─── JSON ────────────────────────────────────────────────────────────────────

function rowsJsonParts(t: ExportTable, indent: string): string[] {
  const parts: string[] = [];
  const names = t.schema.map(c => JSON.stringify(c.name));
  for (let start = 0; start < t.rowCount; start += CHUNK_ROWS) {
    const end = Math.min(t.rowCount, start + CHUNK_ROWS);
    const rows: string[] = [];
    for (let i = start; i < end; i++) {
      rows.push(`${indent}{${names.map((n, c) => `${n}:${JSON.stringify(t.data[c][i] ?? null)}`).join(',')}}`);
    }
    parts.push((start ? ',\n' : '') + rows.join(',\n'));
  }
  return parts;
}

/** A JSON array of row objects. */
export function jsonParts(t: ExportTable): string[] {
  return ['[\n', ...rowsJsonParts(t, '  '), '\n]\n'];
}

/** {"table": [rows], ...} for relational data, tables in dependency order. */
export function relationalJsonParts(tables: ExportTable[]): string[] {
  const parts = ['{\n'];
  tables.forEach((t, i) => {
    parts.push(`${i ? ',\n' : ''}  ${JSON.stringify(t.name)}: [\n`, ...rowsJsonParts(t, '    '), '\n  ]');
  });
  parts.push('\n}\n');
  return parts;
}

// ─── SQL ─────────────────────────────────────────────────────────────────────

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const BOOL_TRUE = new Set(['true', 'yes', 'y', 't', '1']);

function sqlType(col: ColumnSchema, values: ArrayLike<Cell>, rowCount: number): string {
  switch (col.type) {
    case 'integer': return 'BIGINT';
    case 'float': {
      let decimals = 0;
      for (let i = 0; i < rowCount && decimals < 6; i++) {
        const v = values[i];
        if (v === null) continue;
        const s = String(v), dot = s.indexOf('.');
        if (dot >= 0) decimals = Math.max(decimals, s.length - dot - 1);
      }
      return `NUMERIC(20, ${Math.min(6, Math.max(2, decimals))})`;
    }
    case 'boolean': return 'BOOLEAN';
    case 'date': return 'DATE';
    case 'datetime': return 'TIMESTAMP';
    case 'uuid': return 'CHAR(36)';
    default: {
      let max = 1;
      for (let i = 0; i < rowCount; i++) {
        const v = values[i];
        if (v !== null && String(v).length > max) max = String(v).length;
      }
      return max > 1000 ? 'TEXT' : `VARCHAR(${Math.max(16, 2 ** Math.ceil(Math.log2(max)))})`;
    }
  }
}

function sqlLiteral(v: Cell, col: ColumnSchema): string {
  if (v === null || v === undefined) return 'NULL';
  switch (col.type) {
    case 'integer':
    case 'float': {
      const n = toNumber(v);
      return n === null ? 'NULL' : String(n);
    }
    case 'boolean':
      return typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : BOOL_TRUE.has(String(v).toLowerCase()) ? 'TRUE' : 'FALSE';
    case 'date':
    case 'datetime': {
      const ts = parseDateWithFormat(String(v), col.format);
      return ts === null ? 'NULL' : `'${formatDate(ts, col.type === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm:ss')}'`;
    }
    default:
      return `'${String(v).replace(/'/g, "''")}'`;
  }
}

/**
 * CREATE TABLE statements (types, PRIMARY KEY, FOREIGN KEY) followed by INSERTs, tables in dependency
 * order so every foreign key refers to rows that are already inserted.
 */
export function sqlParts(tables: ExportTable[], relationships: Relationship[], joinTables: { table: string; columns: string[] }[]): string[] {
  const parts: string[] = ['-- Synthetic data generated by Synthra. Tables are in dependency order.\n\n'];
  for (const t of tables) {
    const join = joinTables.find(j => j.table === t.name);
    const parentKeys = relationships.filter(r => r.parentTable === t.name).map(r => r.parentColumn);
    const pk = join ? join.columns : (parentKeys.length ? [parentKeys[0]] : t.schema.filter(c => c.unique && c.semanticType === 'Identifier').slice(0, 1).map(c => c.name));
    const lines = t.schema.map((c, i) => {
      let hasNull = false;
      for (let r = 0; r < t.rowCount && !hasNull; r++) if (t.data[i][r] === null) hasNull = true;
      return `  ${ident(c.name)} ${sqlType(c, t.data[i], t.rowCount)}${hasNull ? '' : ' NOT NULL'}`;
    });
    if (pk.length) lines.push(`  PRIMARY KEY (${pk.map(ident).join(', ')})`);
    for (const r of relationships.filter(x => x.childTable === t.name)) {
      lines.push(`  FOREIGN KEY (${ident(r.childColumn)}) REFERENCES ${ident(r.parentTable)} (${ident(r.parentColumn)})`);
    }
    // Other unique columns that are referenced as keys but aren't the primary key.
    for (const k of parentKeys.slice(1)) if (!pk.includes(k)) lines.push(`  UNIQUE (${ident(k)})`);
    parts.push(`CREATE TABLE ${ident(t.name)} (\n${lines.join(',\n')}\n);\n\n`);
  }
  for (const t of tables) {
    if (!t.rowCount) continue;
    const head = `INSERT INTO ${ident(t.name)} (${t.schema.map(c => ident(c.name)).join(', ')}) VALUES\n`;
    for (let start = 0; start < t.rowCount; start += 500) {
      const end = Math.min(t.rowCount, start + 500);
      const rows: string[] = [];
      for (let i = start; i < end; i++) rows.push(`(${t.schema.map((c, ci) => sqlLiteral(t.data[ci][i], c)).join(', ')})`);
      parts.push(head + rows.join(',\n') + ';\n');
    }
    parts.push('\n');
  }
  return parts;
}
