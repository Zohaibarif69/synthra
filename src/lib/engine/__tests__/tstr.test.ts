import { describe, expect, it } from 'vitest';
import type { GenerationConfig } from '../../types';
import { runTstr, tstrTargets, utilityRating } from '../tstr';
import { churnCsv, uploaded } from './tstrData';

const config = (seed: number): GenerationConfig & { seed: number } => ({
  rowCount: 1000, seed, nullRate: 0, outlierRate: 0, locale: 'PK', currency: 'PKR',
  edgeCases: { missingValues: false, numericOutliers: false, rareCategories: false, boundaryValues: false, longText: false, duplicateLike: false },
} as GenerationConfig & { seed: number });

const data = uploaded(churnCsv());

describe('TSTR (train on synthetic, test on real)', () => {
  it('offers sensible targets and never IDs or personal data', () => {
    const targets = tstrTargets(data.schema, data.profile).map(t => t.column);
    expect(targets).toEqual(expect.arrayContaining(['churned', 'contract', 'tenure_months']));
    for (const bad of ['customer_id', 'full_name', 'email']) expect(targets).not.toContain(bad);
    expect(tstrTargets(data.schema, data.profile).find(t => t.column === 'churned')).toMatchObject({ task: 'classification', classes: 2 });
    expect(tstrTargets(data.schema, data.profile).find(t => t.column === 'tenure_months')?.task).toBe('regression');
    // The default (first) target is the outcome a person would pick.
    expect(tstrTargets(data.schema, data.profile)[0].column).toBe('churned');
  });

  it('synthetic data keeps most of the skill for a yes/no target (AUC), across seeds', async () => {
    for (const seed of [1, 2, 3]) {
      const r = await runTstr({ ...data, config: config(seed), target: 'churned' });
      expect(r.metric).toBe('auc');
      expect(r.predictable).toBe(true);
      expect(r.real).toBeGreaterThan(0.8);
      expect(r.utility).toBeGreaterThanOrEqual(85);
      expect(r.features).not.toEqual(expect.arrayContaining(['customer_id', 'full_name', 'email']));
      expect(r.excluded.map(e => e.column)).toEqual(expect.arrayContaining(['customer_id', 'full_name', 'email']));
    }
  }, 60_000);

  it('works for numbers (R²) and several classes (accuracy)', async () => {
    const tenure = await runTstr({ ...data, config: config(7), target: 'tenure_months' });
    expect(tenure.metric).toBe('r2');
    expect(tenure.predictable).toBe(true);
    expect(tenure.utility).toBeGreaterThan(50);
    const contract = await runTstr({ ...data, config: config(7), target: 'contract' });
    expect(contract.metric).toBe('accuracy');
    expect(contract.utility).toBeGreaterThan(40);
  }, 60_000);

  it('says "not reliable" instead of a number when even real data cannot predict the target', async () => {
    const r = await runTstr({ ...data, config: config(3), target: 'noise' });
    expect(r.predictable).toBe(false);
    expect(r.utility).toBeNull();
    expect(r.rating).toBe('n/a');
  }, 60_000);

  it('holds out real rows the generator never saw, and is reproducible', async () => {
    const a = await runTstr({ ...data, config: config(9), target: 'churned' });
    const b = await runTstr({ ...data, config: config(9), target: 'churned' });
    expect(a.rows.realTest).toBe(750);
    expect(a.rows.realTrain).toBe(2250);
    expect({ ...a, durationMs: 0 }).toEqual({ ...b, durationMs: 0 });
  }, 60_000);

  it('rejects uploads too small to test', async () => {
    const small = uploaded(churnCsv(40));
    await expect(runTstr({ ...small, config: config(1), target: 'churned' })).rejects.toThrow(/at least 60/);
  });

  it('puts outcome columns first and demographic columns last', () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ gender: i % 2 ? 'male' : 'female', city: ['A', 'B', 'C'][i % 3], passed: i % 3 ? 'yes' : 'no', score: (i * 7) % 100 }));
    const d = uploaded(['gender,city,passed,score', ...rows.map(r => `${r.gender},${r.city},${r.passed},${r.score}`)].join('\n'));
    const order = tstrTargets(d.schema, d.profile).map(t => t.column);
    expect(order[0]).toBe('passed');
    expect(order.indexOf('gender')).toBeGreaterThan(order.indexOf('score'));
  });

  it('rates utility on a clear scale', () => {
    expect([utilityRating(95), utilityRating(80), utilityRating(60), utilityRating(20), utilityRating(null)]).toEqual(['excellent', 'good', 'fair', 'poor', 'n/a']);
  });
});
