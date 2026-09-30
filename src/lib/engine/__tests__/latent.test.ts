import { describe, expect, it } from 'vitest';
import type { GenerationConfig } from '../../types';
import { normalInv } from '../latent';
import { generateTabular } from '../tabular';
import { churnCsv, uploaded } from './tstrData';

const config = { rowCount: 4000, seed: 5, nullRate: 0, outlierRate: 0, locale: 'PK', currency: 'PKR',
  edgeCases: { missingValues: false, numericOutliers: false, rareCategories: false, boundaryValues: false, longText: false, duplicateLike: false },
} as GenerationConfig & { seed: number };

/** Churn rate for month-to-month customers minus the rate for the others. */
function churnGap(schema: { name: string }[], data: unknown[][]) {
  const c = schema.findIndex(s => s.name === 'contract'), y = schema.findIndex(s => s.name === 'churned');
  let m = 0, mY = 0, o = 0, oY = 0;
  for (let i = 0; i < data[0].length; i++) {
    const churned = String(data[y][i]) === 'true';
    if (data[c][i] === 'month-to-month') { m++; if (churned) mY++; } else { o++; if (churned) oY++; }
  }
  return mY / m - oY / o;
}

describe('latent correlations (categories and yes/no columns keep their relationships)', () => {
  const { schema, profile, original } = uploaded(churnCsv());
  const realGap = churnGap(schema, schema.map(s => original.columns[s.sourceColumn!]));

  it('normalInv is accurate', () => {
    expect(normalInv(0.5)).toBeCloseTo(0, 9);
    expect(normalInv(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalInv(0.001)).toBeCloseTo(-3.090232, 5);
  });

  it('profiles learn relationships that involve categories', () => {
    const pair = profile.latentCorrelations!.find(c => [c.a, c.b].sort().join() === 'churned,contract');
    expect(pair).toBeDefined();
    expect(Math.abs(pair!.r)).toBeGreaterThan(0.3);
  });

  it('generated data keeps "month-to-month customers churn more"', () => {
    const t = generateTabular({ schema, config, profile });
    const gap = churnGap(schema, t.data);
    expect(realGap).toBeGreaterThan(0.3);
    expect(gap).toBeGreaterThan(realGap * 0.6);
  });

  it('profiles saved before this change (no latentCorrelations) still generate exactly as before', () => {
    const { latentCorrelations: _drop, ...old } = profile;
    const a = generateTabular({ schema, config, profile: old });
    const b = generateTabular({ schema, config, profile: old });
    expect(a.data).toEqual(b.data);
    // Old behaviour: categories independent of each other, so the relationship is (almost) gone.
    expect(Math.abs(churnGap(schema, a.data))).toBeLessThan(0.08);
  });
});
