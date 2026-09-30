// Test data with known relationships, for the TSTR and latent-correlation tests.
import Papa from 'papaparse';
import type { Cell } from '../../types';
import { createRng } from '../random';
import { normalizeCell } from '../parse';
import { inferSchema } from '../infer';
import { profileDataset } from '../profile';

/** Telecom churn: month-to-month contracts, short tenure, high bills and many support calls churn more. */
export function churnCsv(n = 3000, seed = 11): string {
  const r = createRng(seed);
  const lines = ['customer_id,full_name,email,city,age,tenure_months,contract,monthly_charges,support_calls,has_partner,churned,noise'];
  const cities = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Multan'];
  for (let i = 0; i < n; i++) {
    const contract = r.next() < 0.5 ? 'month-to-month' : r.next() < 0.6 ? 'one-year' : 'two-year';
    const tenure = Math.max(1, Math.round(contract === 'month-to-month' ? r.normal(12, 10) : r.normal(40, 15)));
    const charges = Math.round((40 + r.next() * 80) * 100) / 100;
    const calls = Math.max(0, Math.round(r.normal(2, 1.5)));
    const logit = -1 + (contract === 'month-to-month' ? 1.8 : -1.2) - 0.05 * tenure + 0.025 * (charges - 80) + 0.35 * (calls - 2);
    const churned = r.next() < 1 / (1 + Math.exp(-logit));
    const noise = r.next() < 0.5 ? 'a' : 'b'; // unrelated to everything
    lines.push([1000 + i, `Person ${i}`, `p${i}@mail.pk`, cities[i % 5], Math.round(r.normal(38, 12)), tenure, contract, charges, calls, r.next() < 0.5, churned, noise].join(','));
  }
  return lines.join('\n');
}

/** Parses a CSV like an upload: schema, profile and the original columns the worker receives. */
export function uploaded(csv: string) {
  const res = Papa.parse<Record<string, unknown>>(csv, { header: true, skipEmptyLines: true });
  const fields = res.meta.fields!;
  const rows = res.data.map(raw => Object.fromEntries(fields.map(f => [f, normalizeCell(raw[f])])));
  const ds = { fileName: 'test.csv', fileSizeBytes: csv.length, format: 'csv' as const, columns: fields, rows: rows as never, warnings: [] };
  const schema = inferSchema(ds).map(c => ({ ...c, sourceColumn: c.sourceColumn ?? c.name }));
  const profile = profileDataset(ds, schema);
  const columns: Record<string, Cell[]> = {};
  for (const c of schema) columns[c.sourceColumn!] = rows.map(r => (r[c.sourceColumn!] as Cell) ?? null);
  return { schema, profile, original: { columns, rowCount: rows.length } };
}
