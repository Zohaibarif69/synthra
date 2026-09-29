import { describe, expect, it } from 'vitest';
import type { Cell, ColumnSchema, Relationship } from '../../types';
import { csvParts, jsonParts, sqlParts } from '../export';
import { runTabularPipeline } from '../pipeline';
import { config, customerSchema, idCol } from './helpers';

const schema: ColumnSchema[] = [
  idCol('id'),
  { name: 'name', type: 'string', nullable: true },
  { name: 'score', type: 'float', nullable: true },
  { name: 'active', type: 'boolean', nullable: false },
  { name: 'joined', type: 'date', format: 'DD/MM/YYYY', nullable: false },
];
const data: Cell[][] = [
  [1, 2, 3],
  ['Plain', 'Has, comma', 'Say "hi"\nnew line'],
  [1.5, null, 2.25],
  [true, false, true],
  ['31/01/2026', '01/02/2026', '15/03/2026'],
];
const table = { name: 'people', schema, data, rowCount: 3 };

describe('CSV export', () => {
  const csv = csvParts(table).join('');

  it('starts with a UTF-8 BOM and a header row, uses CRLF', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')[0]).toBe('id,name,score,active,joined');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('quotes fields with commas, quotes and newlines (RFC 4180); nulls are empty', () => {
    expect(csv).toContain('1,Plain,1.5,true,31/01/2026\r\n');
    expect(csv).toContain('2,"Has, comma",,false,01/02/2026\r\n');
    expect(csv).toContain('3,"Say ""hi""\nnew line",2.25,true,15/03/2026\r\n');
  });

  it('is byte-identical for the same seed', async () => {
    const s = customerSchema();
    const a = await runTabularPipeline({ schema: s, config: config({ rowCount: 300 }) });
    const b = await runTabularPipeline({ schema: s, config: config({ rowCount: 300 }) });
    const text = (r: typeof a) => csvParts({ name: 't', schema: r.schema, data: r.table.data, rowCount: r.table.rowCount }).join('');
    expect(text(a)).toBe(text(b));
    expect(text(a).trim().split('\r\n')).toHaveLength(301);
  });
});

describe('JSON export', () => {
  it('is a valid array of row objects with nulls kept', () => {
    const rows = JSON.parse(jsonParts(table).join(''));
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual({ id: 2, name: 'Has, comma', score: null, active: false, joined: '01/02/2026' });
  });
});

describe('SQL export', () => {
  const orders = {
    name: 'orders',
    schema: [idCol('order_id'), idCol('person_id', false), { name: 'note', type: 'string', nullable: true } as ColumnSchema],
    data: [[10, 11], [1, 3], ["O'Brien", null]] as Cell[][],
    rowCount: 2,
  };
  const rel: Relationship = { id: 'r', parentTable: 'people', parentColumn: 'id', childTable: 'orders', childColumn: 'person_id', cardinality: '1:N' };
  const sql = sqlParts([table, orders], [rel], []).join('');

  it('creates tables with types, primary and foreign keys, parents first', () => {
    expect(sql).toMatch(/CREATE TABLE "people" \(\n  "id" BIGINT NOT NULL,/);
    expect(sql).toContain('"active" BOOLEAN NOT NULL');
    expect(sql).toContain('"joined" DATE NOT NULL');
    expect(sql).toContain('PRIMARY KEY ("id")');
    expect(sql).toContain('FOREIGN KEY ("person_id") REFERENCES "people" ("id")');
    expect(sql.indexOf('CREATE TABLE "people"')).toBeLessThan(sql.indexOf('CREATE TABLE "orders"'));
    expect(sql.indexOf('INSERT INTO "people"')).toBeLessThan(sql.indexOf('INSERT INTO "orders"'));
  });

  it('escapes strings, writes NULL, ISO dates and SQL booleans', () => {
    expect(sql).toContain("(1, 'Plain', 1.5, TRUE, '2026-01-31')");
    expect(sql).toContain("(2, 'Has, comma', NULL, FALSE, '2026-02-01')");
    expect(sql).toContain("(10, 1, 'O''Brien')");
    expect(sql).toContain('(11, 3, NULL)');
  });
});
