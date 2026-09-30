import { describe, expect, it } from 'vitest';
import type { ParsedDataset } from '../../types';
import { getDataset, MAX_DATASETS, putDataset } from '../store';

const ds = (rows: number): ParsedDataset => ({
  fileName: 'x.csv', fileSizeBytes: 1, format: 'csv', columns: ['a'], rows: Array.from({ length: rows }, (_, i) => ({ a: String(i) })), warnings: [],
});

describe('upload store', () => {
  it('keeps every table of a multi-file relational upload (was: only the last 3)', () => {
    const ids = ['customers', 'orders', 'order_items', 'products', 'payments', 'shipments'].map(() => putDataset(ds(10)));
    for (const id of ids) expect(getDataset(id)).toBeDefined();
  });

  it('drops the oldest uploads only beyond the limits, never the newest', () => {
    const ids = Array.from({ length: MAX_DATASETS + 2 }, () => putDataset(ds(5)));
    expect(getDataset(ids[0])).toBeUndefined();
    expect(getDataset(ids[ids.length - 1])).toBeDefined();
    const huge = putDataset(ds(2_100_000));
    expect(getDataset(huge)).toBeDefined();
  });
});
