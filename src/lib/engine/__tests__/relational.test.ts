import { describe, expect, it } from 'vitest';
import type { Cell, ConsistencyRule, Relationship, TableSchema } from '../../types';
import { computeRuleValues, designProblems } from '../relational';
import { runRelationalPipeline } from '../pipeline';
import { validateRelational } from '../validate';
import { computeQuality } from '../quality';
import { column, config, idCol } from './helpers';

const tables: TableSchema[] = [
  { name: 'customers', rowCount: 100, columns: [idCol('customer_id'), { name: 'name', type: 'string', semanticType: 'Person Name', nullable: true, privacyLevel: 'high' }] },
  { name: 'orders', rowCount: 300, columns: [idCol('order_id'), idCol('customer_id', false), { name: 'order_date', type: 'date', semanticType: 'Date', nullable: false }, { name: 'total_amount', type: 'float', semanticType: 'Currency', nullable: false }] },
  { name: 'order_items', rowCount: 750, columns: [idCol('item_id'), idCol('order_id', false), { name: 'quantity', type: 'integer', semanticType: 'Quantity', nullable: false }, { name: 'unit_price', type: 'float', semanticType: 'Currency', nullable: true }] },
];
const relationships: Relationship[] = [
  { id: 'r1', parentTable: 'customers', parentColumn: 'customer_id', childTable: 'orders', childColumn: 'customer_id', cardinality: '1:N', minChildren: 1, maxChildren: 5 },
  { id: 'r2', parentTable: 'orders', parentColumn: 'order_id', childTable: 'order_items', childColumn: 'order_id', cardinality: '1:N', minChildren: 1, maxChildren: 4 },
];
const rules: ConsistencyRule[] = [
  { id: 'rule1', parentTable: 'orders', parentColumn: 'total_amount', childTable: 'order_items', aggregate: 'SUM', terms: ['quantity', 'unit_price'] },
];

async function run(t = tables, rels = relationships, rls = rules, seed = 42) {
  const { gen } = await runRelationalPipeline({ tables: t, relationships: rels, rules: rls, config: config({ seed }), profiles: {} });
  const view = (n: string) => {
    const s = gen.tables.get(n)!;
    return { name: n, schema: s.schema, data: s.table.data, rowCount: s.table.rowCount };
  };
  const validation = validateRelational({
    tables: gen.order.map(view),
    relationships: gen.design.relationships,
    joins: gen.design.joins.map(j => ({ table: j.table, colA: j.relA.childColumn, colB: j.relB.childColumn })),
    rules: rls,
    computeRule: rule => {
      const rel = gen.design.relationships.find(r => r.parentTable === rule.parentTable && r.childTable === rule.childTable);
      return rel ? computeRuleValues(rule, view(rule.parentTable), view(rule.childTable), rel) : null;
    },
  });
  return { gen, view, validation };
}

const keySet = (values: Cell[]) => new Set(values.map(String));

describe('relational generation', () => {
  it('generates parents before children and is deterministic', async () => {
    const a = await run(), b = await run();
    expect(a.gen.order).toEqual(['customers', 'orders', 'order_items']);
    const dump = (r: typeof a) => JSON.stringify(r.gen.order.map(n => r.gen.tables.get(n)!.table.data));
    expect(dump(a)).toBe(dump(b));
  });

  it('has zero orphan foreign keys (referential integrity 100)', async () => {
    const { view, validation } = await run();
    for (const r of relationships) {
      const parent = view(r.parentTable), child = view(r.childTable);
      const keys = keySet(column(parent.schema, parent.data, r.parentColumn));
      const fks = column(child.schema, child.data, r.childColumn);
      expect(fks.every(v => v !== null && keys.has(String(v)))).toBe(true);
    }
    const ri = computeQuality({ metrics: validation.metrics, rowCount: 1 }).dimensions.find(d => d.id === 'referential');
    expect(ri?.score).toBe(100);
  });

  it('respects the 1:N min/max children per parent', async () => {
    const { view } = await run();
    const customers = view('customers'), orders = view('orders');
    const counts = new Map<string, number>();
    for (const v of column(orders.schema, orders.data, 'customer_id')) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
    expect(customers.rowCount).toBe(100);
    for (const k of column(customers.schema, customers.data, 'customer_id')) {
      const n = counts.get(String(k)) ?? 0;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it('order totals equal SUM(quantity × unit_price) of their items', async () => {
    const { view } = await run();
    const orders = view('orders'), items = view('order_items');
    const expected = new Map<string, number>();
    const oid = column(items.schema, items.data, 'order_id'), qty = column(items.schema, items.data, 'quantity'), price = column(items.schema, items.data, 'unit_price');
    for (let i = 0; i < items.rowCount; i++) {
      if (qty[i] === null || price[i] === null) continue;
      expected.set(String(oid[i]), (expected.get(String(oid[i])) ?? 0) + Number(qty[i]) * Number(price[i]));
    }
    const ids = column(orders.schema, orders.data, 'order_id'), totals = column(orders.schema, orders.data, 'total_amount');
    for (let i = 0; i < orders.rowCount; i++) {
      expect(Math.abs(Number(totals[i]) - (expected.get(String(ids[i])) ?? 0))).toBeLessThanOrEqual(0.01);
    }
  });

  it('1:1 gives every parent exactly one child', async () => {
    const t: TableSchema[] = [
      { name: 'users', rowCount: 40, columns: [idCol('user_id')] },
      { name: 'profiles', rowCount: 40, columns: [idCol('profile_id'), idCol('user_id', true)] },
    ];
    const rels: Relationship[] = [{ id: 'o', parentTable: 'users', parentColumn: 'user_id', childTable: 'profiles', childColumn: 'user_id', cardinality: '1:1' }];
    const { view, validation } = await run(t, rels, []);
    const fks = column(view('profiles').schema, view('profiles').data, 'user_id').map(String);
    expect(new Set(fks).size).toBe(fks.length);
    expect(fks.length).toBe(40);
    expect(validation.checks.every(c => c.status === 'passed')).toBe(true);
  });

  it('N:N creates a join table with valid, unique pairs', async () => {
    const t: TableSchema[] = [
      { name: 'students', rowCount: 50, columns: [idCol('student_id')] },
      { name: 'courses', rowCount: 10, columns: [idCol('course_id'), { name: 'title', type: 'string', nullable: false }] },
    ];
    const rels: Relationship[] = [{ id: 'nn', parentTable: 'students', parentColumn: 'student_id', childTable: 'courses', childColumn: 'course_id', cardinality: 'N:N', minChildren: 2, maxChildren: 4, joinTable: 'enrollments' }];
    const { gen, view } = await run(t, rels, []);
    expect(gen.order).toContain('enrollments');
    const e = view('enrollments');
    const students = keySet(column(view('students').schema, view('students').data, 'student_id'));
    const courses = keySet(column(view('courses').schema, view('courses').data, 'course_id'));
    const [a, b] = [e.data[0], e.data[1]];
    const pairs = new Set<string>();
    for (let i = 0; i < e.rowCount; i++) {
      expect(students.has(String(a[i]))).toBe(true);
      expect(courses.has(String(b[i]))).toBe(true);
      pairs.add(`${a[i]}|${b[i]}`);
    }
    expect(pairs.size).toBe(e.rowCount);
  });

  it('rejects a relationship cycle', () => {
    const cyc: Relationship[] = [...relationships, { id: 'r3', parentTable: 'order_items', parentColumn: 'item_id', childTable: 'customers', childColumn: 'customer_id', cardinality: '1:N' }];
    expect(designProblems(tables, cyc, []).join(' ')).toMatch(/cycle/i);
  });
});
