import { describe, expect, it } from 'vitest';
import type { ColumnValidationMetrics, ValidationMetrics } from '../../types';
import { computeQuality } from '../quality';
import { runTabularPipeline } from '../pipeline';
import { buildProfile } from '../profile';
import { validateTabular } from '../validate';
import { config, customerSchema } from './helpers';

const metric = (over: Partial<ColumnValidationMetrics>): ColumnValidationMetrics => ({
  column: 'c', type: 'integer', invalid: 0, unique: false, nullRateSynthetic: 0, nullRateTarget: 0, ...over,
});
const dim = (m: ValidationMetrics, id: string) => computeQuality({ metrics: m, rowCount: 100 }).dimensions.find(d => d.id === id)!;

describe('quality score formulas', () => {
  it('fidelity = mean of (1 − KS D) and (1 − TVD)', () => {
    const m: ValidationMetrics = {
      hasOriginal: true, correlations: [],
      columns: [
        metric({ column: 'age', ks: { d: 0.1, p: 0.5, n: 100, m: 100 } }),
        metric({ column: 'city', type: 'string', tvd: { value: 0.3, tolerance: 0.1 } }),
      ],
    };
    expect(dim(m, 'fidelity').score).toBe(80); // mean(0.9, 0.7)
  });

  it('null distribution = mean of max(0, 1 − 2·|synthetic − target|)', () => {
    const m: ValidationMetrics = {
      hasOriginal: false, correlations: [],
      columns: [metric({ nullRateSynthetic: 0.1, nullRateTarget: 0.1 }), metric({ nullRateSynthetic: 0.3, nullRateTarget: 0.1 })],
    };
    expect(dim(m, 'nulls').score).toBe(80); // mean(1, 0.6)
  });

  it('uniqueness, referential integrity, totals and business rules are percentages of real counts', () => {
    const m: ValidationMetrics = {
      hasOriginal: false, correlations: [],
      columns: [metric({ unique: true, duplicates: 0 }), metric({ unique: true, duplicates: 3 })],
      relationships: [{ id: 'r', label: 'o.c → c.id', cardinality: '1:N', fkValues: 190, nullFks: 10, orphans: 0, cardinalityViolations: 0, cardinalityDetail: '' } as never],
      rules: [{ id: 'x', label: 'total', parentsChecked: 50, mismatches: 5, maxDiff: 1 } as never],
      columnRules: { rows: 200, passing: 150, rules: [{ label: 'age range', violations: 50 }] },
    };
    expect(dim(m, 'uniqueness').score).toBe(50);
    expect(dim(m, 'referential').score).toBe(95);
    expect(dim(m, 'rules').score).toBe(90);
    expect(dim(m, 'columnRules').score).toBe(75);
  });

  it('says N/A instead of inventing a number when there is nothing to compare', () => {
    const m: ValidationMetrics = { hasOriginal: false, correlations: [], columns: [metric({})] };
    const q = computeQuality({ metrics: m, rowCount: 10 });
    for (const id of ['fidelity', 'privacy', 'referential', 'correlation', 'documents']) {
      const d = q.dimensions.find(x => x.id === id)!;
      expect(d.score).toBeNull();
      expect(d.naReason).toMatch(/N\/A/);
    }
    // Overall is the mean of the dimensions that do have a score.
    const scored = q.dimensions.filter(d => d.score !== null).map(d => d.score!);
    expect(q.overall).toBeCloseTo(scored.reduce((a, b) => a + b, 0) / scored.length, 1);
  });
});

describe('quality from generated data', () => {
  const score = async (nullRate: number, target: number) => {
    const schema = customerSchema();
    const { table, schema: out } = await runTabularPipeline({ schema, config: config({ nullRate, rowCount: 2000 }) });
    const synthetic = buildProfile(out.map((c, i) => ({ column: c, values: table.data[i] })), table.rowCount, { includeSensitiveValues: true });
    // Validate against a lower configured target to simulate "30% nulls where 0% was expected".
    const validation = validateTabular({ generated: { schema: out, data: table.data, flags: table.flags, rowCount: table.rowCount }, config: config({ nullRate: target, rowCount: 2000 }), requestedRows: 2000, synthetic });
    return computeQuality({ metrics: validation.metrics, rowCount: table.rowCount });
  };

  it('null rate far from the target lowers the score and raises a warning', async () => {
    const good = await score(0.1, 0.1);
    const bad = await score(0.3, 0);
    const nulls = (q: typeof good) => q.dimensions.find(d => d.id === 'nulls')!.score!;
    expect(nulls(bad)).toBeLessThan(nulls(good));
    expect(bad.warnings.some(w => w.title.startsWith('Null rate'))).toBe(true);
    expect(good.warnings.some(w => w.title.startsWith('Null rate'))).toBe(false);
  });
});
