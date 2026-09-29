import { describe, expect, it } from 'vitest';
import { createRng } from '../random';
import { generateTabular } from '../tabular';
import { runTabularPipeline } from '../pipeline';
import { column, config, customerSchema } from './helpers';

describe('seeded random number generator', () => {
  it('gives the same sequence for the same seed and a different one for another seed', () => {
    const a = createRng(42), b = createRng(42), c = createRng(43);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    const seqC = Array.from({ length: 20 }, () => c.next());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    expect(seqA.every(x => x >= 0 && x < 1)).toBe(true);
  });

  it('derived sub-streams are deterministic and independent', () => {
    const x = createRng(7).derive('privacy'), y = createRng(7).derive('privacy'), z = createRng(7).derive('rules');
    const take = (r: typeof x) => Array.from({ length: 10 }, () => r.next());
    const [sx, sy, sz] = [take(x), take(y), take(z)];
    expect(sx).toEqual(sy);
    expect(sx).not.toEqual(sz);
  });
});

describe('tabular generation', () => {
  it('same seed → identical data, different seed → different data', async () => {
    const schema = customerSchema();
    const a = await runTabularPipeline({ schema, config: config() });
    const b = await runTabularPipeline({ schema, config: config() });
    const c = await runTabularPipeline({ schema, config: config({ seed: 43 }) });
    expect(JSON.stringify(a.table.data)).toBe(JSON.stringify(b.table.data));
    expect(JSON.stringify(a.table.data)).not.toBe(JSON.stringify(c.table.data));
  });

  it.each([1, 20, 500, 12_345])('produces exactly %i rows', rowCount => {
    const schema = customerSchema();
    const t = generateTabular({ schema, config: config({ rowCount }) });
    expect(t.rowCount).toBe(rowCount);
    expect(t.data).toHaveLength(schema.length);
    for (const col of t.data) expect(col).toHaveLength(rowCount);
  });

  it.each([0, 0.1, 0.3])('null rate %f lands within ±3 points in nullable columns', nullRate => {
    const schema = customerSchema();
    const t = generateTabular({ schema, config: config({ rowCount: 5000, nullRate }) });
    let nulls = 0, cells = 0;
    schema.forEach((c, i) => {
      const values = t.data[i];
      if (!c.nullable) {
        expect(values.filter(v => v === null)).toHaveLength(0);
        return;
      }
      cells += values.length;
      nulls += values.filter(v => v === null).length;
    });
    expect(Math.abs(nulls / cells - nullRate)).toBeLessThanOrEqual(0.03);
  });

  it('adds no nulls when missing values are switched off', () => {
    const schema = customerSchema();
    const cfg = config({ nullRate: 0.4 });
    cfg.edgeCases = { ...cfg.edgeCases, missingValues: false };
    const t = generateTabular({ schema, config: cfg });
    expect(t.data.flat().filter(v => v === null)).toHaveLength(0);
  });

  it('unique columns contain no duplicates', () => {
    const schema = customerSchema();
    const t = generateTabular({ schema, config: config({ rowCount: 5000 }) });
    for (const name of ['id', 'email']) {
      const values = column(schema, t.data, name).filter(v => v !== null).map(String);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('values have the declared type', () => {
    const schema = customerSchema();
    const t = generateTabular({ schema, config: config({ rowCount: 1000 }) });
    for (const v of column(schema, t.data, 'id')) expect(Number.isInteger(Number(v))).toBe(true);
    for (const v of column(schema, t.data, 'email')) if (v !== null) expect(String(v)).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i);
  });
});
