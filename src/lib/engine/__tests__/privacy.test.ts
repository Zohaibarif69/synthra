import { describe, expect, it } from 'vitest';
import type { Cell, ColumnSchema, ParsedDataset } from '../../types';
import { applyPrivacy, maskValue } from '../privacy';
import { createRng } from '../random';
import { runTabularPipeline, forbiddenValues } from '../pipeline';
import { validateTabular } from '../validate';
import { inferSchema } from '../infer';
import { buildProfile, columnValues, profileDataset } from '../profile';
import { column, config, customerSchema } from './helpers';

const col = (over: Partial<ColumnSchema>): ColumnSchema => ({ name: 'x', type: 'string', nullable: true, ...over });

describe('masking', () => {
  it('keeps a hint and stars the rest', () => {
    expect(maskValue('ali.khan@example.com', col({ type: 'email', semanticType: 'Email' }))).toBe('a****@example.com');
    expect(maskValue('+92 300 1234567', col({ semanticType: 'Phone' }))).toBe('+** *** ***4567');
    expect(maskValue('Ali Khan', col({ semanticType: 'Person Name' }))).toBe('A** K***');
    expect(maskValue(null, col({ semanticType: 'Email' }))).toBeNull();
  });

  it('masks every value of a column set to "mask" in the pipeline', async () => {
    const schema = customerSchema().map(c => (c.name === 'email' ? { ...c, privacyTransform: 'mask' as const } : c));
    const { table, schema: out } = await runTabularPipeline({ schema, config: config() });
    const emails = column(out, table.data, 'email').filter(v => v !== null);
    expect(emails.length).toBeGreaterThan(0);
    for (const e of emails) expect(String(e)).toMatch(/^.\*{4}@[^@]+$/);
  });
});

describe('hashing', () => {
  it('same input → same hash, different input → different hash, never the input', async () => {
    const values: Cell[] = ['Karachi', 'Lahore', 'Karachi', null, 'Lahore', 'Quetta'];
    const schema = [col({ name: 'city', privacyTransform: 'hash' })];
    const data = [values.slice()];
    await applyPrivacy({ schema, data, epsilon: 1, rng: createRng(1) });
    const [h] = data;
    expect(h[0]).toBe(h[2]);
    expect(h[1]).toBe(h[4]);
    expect(h[0]).not.toBe(h[1]);
    expect(h[3]).toBeNull();
    for (const [i, v] of values.entries()) if (v !== null) expect(h[i]).not.toBe(v);
  });
});

describe('differential noise', () => {
  const ages = Array.from({ length: 2000 }, (_, i) => 20 + (i % 50));
  const noisy = async (epsilon: number) => {
    const data: Cell[][] = [ages.slice()];
    await applyPrivacy({ schema: [col({ name: 'age', type: 'integer', privacyTransform: 'noise' })], data, epsilon, rng: createRng(5) });
    return data[0].map(Number);
  };
  const meanAbsChange = (xs: number[]) => xs.reduce((a, x, i) => a + Math.abs(x - ages[i]), 0) / xs.length;

  it('changes values but keeps the mean close', async () => {
    const out = await noisy(1);
    expect(out.some((v, i) => v !== ages[i])).toBe(true);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.abs(mean(out) - mean(ages))).toBeLessThan(1);
  });

  it('smaller ε adds more noise', async () => {
    expect(meanAbsChange(await noisy(0.2))).toBeGreaterThan(meanAbsChange(await noisy(5)));
  });
});

describe('PII leak check', () => {
  const { dataset, schema, profile } = uploadedCustomers();
  const original = {
    profile, rowCount: dataset.rows.length,
    columns: Object.fromEntries(schema.map(c => [c.sourceColumn!, columnValues(dataset.rows, c.sourceColumn!)])),
  };
  const validate = (out: ColumnSchema[], data: Cell[][], rowCount: number) => validateTabular({
    generated: { schema: out, data, rowCount }, config: config(), requestedRows: rowCount, original,
    synthetic: buildProfile(out.map((c, i) => ({ column: c, values: data[i] })), rowCount, { includeSensitiveValues: true }),
  }).checks.find(c => c.name === 'Privacy: No Original PII Values');

  it('synthetic high-privacy values never repeat uploaded values', async () => {
    const forbidden = forbiddenValues(schema, original.columns);
    expect(Object.keys(forbidden).length).toBeGreaterThan(0);
    const { table, schema: out } = await runTabularPipeline({ schema, config: config(), profile, forbidden });
    for (const name of Object.keys(forbidden)) {
      for (const v of column(out, table.data, name)) if (v !== null) expect(forbidden[name].has(String(v).toLowerCase())).toBe(false);
    }
    expect(validate(out, table.data, table.rowCount)?.status).toBe('passed');
  });

  it('flags a leak when an original value is copied into the output', async () => {
    const { table, schema: out } = await runTabularPipeline({ schema, config: config({ rowCount: 50 }), profile });
    const nameIdx = out.findIndex(c => c.name === 'full_name');
    table.data[nameIdx][0] = dataset.rows[0].full_name;
    expect(validate(out, table.data, table.rowCount)?.status).toBe('failed');
  });
});

/** A small uploaded file, run through the real inference and profiling. */
function uploadedCustomers() {
  const first = ['Ali', 'Sara', 'Bilal', 'Ayesha', 'Omar', 'Fatima', 'Hamza', 'Zainab'];
  const last = ['Khan', 'Ahmed', 'Malik', 'Butt', 'Sheikh'];
  const rows = Array.from({ length: 40 }, (_, i) => {
    const name = `${first[i % first.length]} ${last[i % last.length]}`;
    return { customer_id: 1001 + i, full_name: name, email: `${name.toLowerCase().replace(' ', '.')}${i}@example.com`, age: 20 + ((i * 7) % 45) } as Record<string, Cell>;
  });
  const dataset: ParsedDataset = { fileName: 'customers.csv', fileSizeBytes: 0, format: 'csv', warnings: [], columns: ['customer_id', 'full_name', 'email', 'age'], rows };
  const schema = inferSchema(dataset);
  return { dataset, schema, profile: profileDataset(dataset, schema) };
}
