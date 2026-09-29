import Papa from 'papaparse';
import type { Cell, DataRow, ParsedDataset } from '../types';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** An upload problem with a message that is safe to show to the user as-is. */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

const MISSING_TOKENS = new Set(['', 'null', 'nan', 'n/a', 'na', '#n/a', 'undefined', 'nil']);

/** Trims strings and turns empty/"null"/"N/A"-style tokens into real nulls. */
export function normalizeCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim();
    return MISSING_TOKENS.has(s.toLowerCase()) ? null : s;
  }
  // Nested objects/arrays in JSON are kept as their JSON text.
  return JSON.stringify(v);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export async function parseFile(file: File, onProgress?: (fraction: number) => void): Promise<ParsedDataset> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ParseError(`"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The maximum file size is 50 MB.`);
  }
  if (file.size === 0) {
    throw new ParseError(`"${file.name}" is empty.`);
  }

  const ext = extensionOf(file.name);
  let result: ParsedDataset;
  if (ext === 'json' || ext === 'ndjson' || ext === 'jsonl') {
    result = await parseJson(file);
  } else if (ext === 'csv' || ext === 'tsv' || ext === 'txt' || ext === '') {
    result = await parseCsv(file, onProgress);
  } else {
    throw new ParseError(`".${ext}" files are not supported. Upload a CSV or JSON file.`);
  }

  if (result.columns.length === 0) {
    throw new ParseError(`No columns were found in "${file.name}".`);
  }
  if (result.rows.length === 0) {
    throw new ParseError(`"${file.name}" has column headers but no data rows.`);
  }
  onProgress?.(1);
  return result;
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

function parseCsv(file: File, onProgress?: (fraction: number) => void): Promise<ParsedDataset> {
  return new Promise((resolve, reject) => {
    const rows: DataRow[] = [];
    let fields: string[] = [];
    let badRows = 0;
    let firstBadRow: number | null = null;
    let checkedBinary = false;

    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h, i) => h.replace(/^﻿/, '').trim() || `column_${i + 1}`,
      chunk: (res, parser) => {
        if (!checkedBinary) {
          checkedBinary = true;
          const sample = res.data.slice(0, 20).map(r => Object.values(r).join('')).join('');
          if (sample.includes('\u0000') || (res.meta.fields ?? []).some(f => f.includes('\u0000'))) {
            parser.abort();
            reject(new ParseError(`"${file.name}" does not look like a text CSV file.`));
            return;
          }
        }
        if (!fields.length && res.meta.fields) fields = res.meta.fields;

        const badInChunk = new Set<number>();
        for (const err of res.errors) {
          if (err.type === 'FieldMismatch' && typeof err.row === 'number') badInChunk.add(err.row);
        }
        badRows += badInChunk.size;
        if (firstBadRow === null && badInChunk.size) firstBadRow = rows.length + Math.min(...badInChunk) + 2;

        for (const raw of res.data) {
          const row: DataRow = {};
          for (const f of fields) row[f] = normalizeCell(raw[f]);
          rows.push(row);
        }
        onProgress?.(Math.min(0.99, res.meta.cursor / file.size));
      },
      complete: () => {
        if (!fields.length) {
          reject(new ParseError(`"${file.name}" is empty.`));
          return;
        }
        const warnings: string[] = [];
        if (badRows > 0) {
          if (badRows > rows.length / 2) {
            reject(new ParseError(
              `Could not read "${file.name}": ${badRows.toLocaleString()} of ${rows.length.toLocaleString()} rows have a different number of fields than the header (first at line ${firstBadRow}). Check the delimiter and quoting.`
            ));
            return;
          }
          warnings.push(`${badRows.toLocaleString()} row${badRows === 1 ? '' : 's'} had a different number of fields than the header (first at line ${firstBadRow}). Missing fields were left empty and extra fields were ignored.`);
        }
        resolve({ fileName: file.name, fileSizeBytes: file.size, format: 'csv', columns: fields, rows, warnings });
      },
      error: (err) => reject(new ParseError(`Could not read "${file.name}": ${err.message}`)),
    });
  });
}

// ─── JSON ─────────────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function parseJson(file: File): Promise<ParsedDataset> {
  const text = (await file.text()).replace(/^﻿/, '');
  if (!text.trim()) throw new ParseError(`"${file.name}" is empty.`);

  let records: unknown[];
  try {
    const data: unknown = JSON.parse(text);
    if (Array.isArray(data)) {
      records = data;
    } else if (isPlainObject(data)) {
      // Accept a wrapper object such as { "data": [ {...}, ... ] }.
      const arrays = Object.values(data).filter(v => Array.isArray(v) && v.length > 0 && v.every(isPlainObject));
      if (arrays.length !== 1) {
        throw new ParseError(`"${file.name}" must contain an array of objects, e.g. [{"id": 1, "name": "..."}].`);
      }
      records = arrays[0] as unknown[];
    } else {
      throw new ParseError(`"${file.name}" must contain an array of objects, e.g. [{"id": 1, "name": "..."}].`);
    }
  } catch (err) {
    if (err instanceof ParseError) throw err;
    // Fall back to newline-delimited JSON (one object per line).
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    try {
      records = lines.map(l => JSON.parse(l));
    } catch {
      throw new ParseError(`"${file.name}" is not valid JSON: ${(err as Error).message}`);
    }
  }

  const bad = records.findIndex(r => !isPlainObject(r));
  if (bad >= 0) {
    throw new ParseError(`"${file.name}" must be an array of objects, but item ${bad + 1} is ${Array.isArray(records[bad]) ? 'an array' : typeof records[bad]}.`);
  }

  const columns: string[] = [];
  const seen = new Set<string>();
  for (const rec of records as Record<string, unknown>[]) {
    for (const key of Object.keys(rec)) {
      if (!seen.has(key)) { seen.add(key); columns.push(key); }
    }
  }
  const rows: DataRow[] = (records as Record<string, unknown>[]).map(rec => {
    const row: DataRow = {};
    for (const c of columns) row[c] = normalizeCell(rec[c]);
    return row;
  });

  return { fileName: file.name, fileSizeBytes: file.size, format: 'json', columns, rows, warnings: [] };
}
