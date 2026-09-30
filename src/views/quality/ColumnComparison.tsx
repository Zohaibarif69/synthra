'use client';

import React, { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TabularResult } from '../../lib/types';

const tooltipStyle = { fontSize: 12, borderRadius: 6, border: '1px solid var(--color-border)' };

function num(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  return Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : Number(v.toFixed(3)).toString();
}
const pct = (v: number | undefined) => (v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);

export function ColumnComparison({ result }: { result: TabularResult }) {
  const [index, setIndex] = useState(0);
  const schema = result.schema;
  const col = schema[index];
  const synth = result.syntheticProfile.columns[index];
  const metrics = result.validation.metrics?.columns[index];
  const original = result.originalProfile?.columns.find(c => c.name === col?.sourceColumn);
  const histogram = result.histograms.find(h => h.column === col?.name);
  const hasOriginal = !!original;

  const categoryData = metrics?.categoryShares
    ? metrics.categoryShares.slice(0, 12).map(s => ({ label: s.value, original: Number(s.original.toFixed(2)), synthetic: Number(s.synthetic.toFixed(2)) }))
    : synth?.topValues && (synth.kind === 'categorical' || synth.kind === 'boolean')
      ? synth.topValues.slice(0, 12).map(t => ({ label: t.value, synthetic: Number(t.pct.toFixed(2)) }))
      : null;

  const chartData = histogram?.bins ?? categoryData;
  const chartTitle = histogram ? 'Histogram (% of non-null values)' : categoryData ? 'Category shares (% of non-null values)' : null;

  const rows: [string, string, string][] = [
    ['Mean', num(metrics?.mean?.original ?? (typeof original?.mean === 'number' ? original.mean : undefined)), num(metrics?.mean?.synthetic ?? synth?.mean)],
    ['Std dev', num(metrics?.std?.original ?? original?.stdDev), num(metrics?.std?.synthetic ?? synth?.stdDev)],
    ['Null rate', pct(metrics?.nullRateOriginal), pct(metrics?.nullRateSynthetic)],
    ['Distinct values', original ? original.uniqueCount.toLocaleString() : '—', synth ? synth.uniqueCount.toLocaleString() : '—'],
  ];

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Per-Column Comparison</h3>
        <select
          aria-label="Column to compare"
          value={index}
          onChange={e => setIndex(Number(e.target.value))}
          className="px-3 py-1.5 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none"
        >
          {schema.map((c, i) => <option key={c.name} value={i}>{c.name} ({c.type})</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          {chartData && chartTitle ? (
            <>
              <p className="text-xs text-[var(--color-text-muted)] mb-2">{chartTitle}{hasOriginal ? ' — original vs synthetic' : ' — synthetic only (no source file)'}</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }} barGap={0} barCategoryGap={histogram ? 1 : '15%'}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={histogram ? 'preserveStartEnd' : 0} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v).toFixed(2)}%`} />
                  {hasOriginal && <Legend wrapperStyle={{ fontSize: 11 }} />}
                  {hasOriginal && <Bar dataKey="original" name="Original" fill="var(--color-border-strong)" />}
                  <Bar dataKey="synthetic" name="Synthetic" fill="var(--color-primary)" />
                </BarChart>
              </ResponsiveContainer>
            </>
          ) : (
            <p className="text-xs text-[var(--color-text-muted)] py-16 text-center">
              No distribution chart for {synth?.kind ?? 'this'} columns (identifiers, free text and PII are generated fresh, not sampled).
            </p>
          )}
        </div>
        <div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                <th className="text-left py-2 font-medium">Metric</th>
                <th className="text-right py-2 font-medium">Original</th>
                <th className="text-right py-2 font-medium">Synthetic</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, o, s]) => (
                <tr key={label} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-2 text-[var(--color-text-secondary)]">{label}</td>
                  <td className="py-2 text-right font-mono">{hasOriginal ? o : '—'}</td>
                  <td className="py-2 text-right font-mono">{s}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 space-y-1 text-xs">
            {metrics?.ks ? (
              <>
                <p className="flex justify-between"><span className="text-[var(--color-text-muted)]">KS statistic D</span><span className="font-mono">{metrics.ks.d.toFixed(3)}</span></p>
                <p className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">KS p-value</span>
                  <span className="font-mono" style={{ color: metrics.ks.p < 0.05 ? 'var(--color-warning)' : 'var(--color-success)' }}>
                    {metrics.ks.p < 0.001 ? metrics.ks.p.toExponential(1) : metrics.ks.p.toFixed(3)}
                  </span>
                </p>
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  {metrics.ks.p < 0.05 ? 'p < 0.05: the distributions differ significantly.' : 'p ≥ 0.05: no significant difference detected.'}
                </p>
              </>
            ) : metrics?.tvd ? (
              <p className="flex justify-between"><span className="text-[var(--color-text-muted)]">Total variation distance</span><span className="font-mono">{metrics.tvd.value.toFixed(3)} (tol {metrics.tvd.tolerance.toFixed(3)})</span></p>
            ) : (
              <p className="text-[11px] text-[var(--color-text-muted)]">
                {hasOriginal ? 'KS test applies to numeric columns only.' : 'KS test needs an uploaded source file.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
