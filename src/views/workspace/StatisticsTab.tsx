'use client';

import React from 'react';
import { BarChart2 } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { Badge } from '../../components/common/Badge';
import { EmptyState } from '../../components/common/EmptyState';
import type { ColumnProfile, TabularResult } from '../../lib/types';

const COLORS = ['#6366F1', '#16A34A', '#D97706', '#2563EB', '#DC2626', '#0891B2', '#9333EA', '#DB2777'];
const ORIGINAL_FILL = 'var(--color-border-strong)';
const SYNTHETIC_FILL = 'var(--color-primary)';
const tooltipStyle = { fontSize: 12, borderRadius: 6, border: '1px solid var(--color-border)' };

function fmt(v: number | string | undefined, digits = 2): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return '—';
  return Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : Number(v.toFixed(digits)).toString();
}

function pctText(x: number) {
  return `${(x * 100).toFixed(1)}%`;
}

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4 ${className}`}>
      <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">{title}</h4>
      {children}
    </div>
  );
}

export function StatisticsTab({ result }: { result: TabularResult | null }) {
  if (!result) {
    return <EmptyState icon={<BarChart2 size={32} />} title="Statistics not available" description="Statistics are computed for tabular generation." />;
  }

  const stats = result.statistics;
  const columns = result.syntheticProfile.columns;
  const original = result.originalProfile;
  // Synthetic columns follow schema order; the original profile is keyed by source column name.
  const findOriginal = (index: number): ColumnProfile | undefined => {
    if (!original) return undefined;
    const key = result.schema[index]?.sourceColumn;
    return key ? original.columns.find(c => c.name === key) : undefined;
  };

  const categorical = columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => (c.kind === 'categorical' || c.kind === 'boolean') && c.topValues?.length);

  const barColumn = categorical[0];
  const pieColumn = categorical[1];
  const barData = barColumn
    ? barColumn.c.topValues!.slice(0, 8).map(t => {
        const o = findOriginal(barColumn.i)?.topValues?.find(v => v.value === t.value);
        return { value: t.value, synthetic: Number(t.pct.toFixed(2)), ...(original ? { original: Number((o?.pct ?? 0).toFixed(2)) } : {}) };
      })
    : [];
  const pieData = pieColumn ? pieColumn.c.topValues!.slice(0, 6).map(t => ({ value: t.value, count: t.count })) : [];

  const numericComparisons = original
    ? columns
        .map((c, i) => ({ s: c, o: findOriginal(i) }))
        .filter(x => x.o && (x.s.kind === 'numeric' || x.s.kind === 'categorical' || x.s.kind === 'boolean'))
    : [];

  const injected = result.injected;
  const injectedParts = [
    injected.nulls && `${injected.nulls.toLocaleString()} nulls`,
    injected.outliers && `${injected.outliers.toLocaleString()} outliers`,
    injected.boundaryValues && `${injected.boundaryValues.toLocaleString()} boundary values`,
    injected.rareCategories && `${injected.rareCategories.toLocaleString()} rare categories`,
    injected.longText && `${injected.longText.toLocaleString()} long texts`,
    injected.duplicateLikeRows && `${injected.duplicateLikeRows.toLocaleString()} near-duplicate rows`,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Rows', value: stats.rowCount.toLocaleString() },
          { label: 'Columns', value: stats.columnCount },
          { label: 'Missing Values', value: stats.missingValues.toLocaleString() },
          { label: 'Missing Rate', value: pctText(stats.missingRate) },
          { label: 'Outliers (1.5×IQR)', value: stats.outlierCount.toLocaleString() },
        ].map(s => (
          <div key={s.label} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4">
            <p className="text-xs text-[var(--color-text-muted)] mb-1">{s.label}</p>
            <p className="text-xl font-semibold text-[var(--color-text-primary)] font-mono">{s.value}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-[var(--color-text-muted)] -mt-3">
        Injected by edge-case settings: {injectedParts.length ? injectedParts.join(', ') : 'nothing'}.
        {original ? ' Grey = original upload, colour = synthetic.' : ''}
      </p>

      {(barColumn || pieColumn) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {barColumn && (
            <Card title={`${barColumn.c.name} — top values (% of rows)`}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={barData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="value" tick={{ fontSize: 11 }} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v}%`} />
                  {original && <Legend wrapperStyle={{ fontSize: 11 }} />}
                  {original && <Bar dataKey="original" name="Original" fill={ORIGINAL_FILL} radius={[3, 3, 0, 0]} />}
                  <Bar dataKey="synthetic" name="Synthetic" fill={SYNTHETIC_FILL} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}
          {pieColumn && (
            <Card title={`${pieColumn.c.name} — distribution (synthetic)`}>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="count" nameKey="value" label={({ value }) => value}>
                    {pieData.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          )}
        </div>
      )}

      {result.histograms.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">
            Numeric Distributions{original ? ' — original vs synthetic' : ''}
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {result.histograms.map(h => (
              <Card key={h.column} title={`${h.column} (% of non-null values)`}>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={h.bins} margin={{ top: 0, right: 0, left: -20, bottom: 0 }} barGap={0} barCategoryGap={1}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v).toFixed(2)}%`} />
                    {original && <Legend wrapperStyle={{ fontSize: 11 }} />}
                    {original && <Bar dataKey="original" name="Original" fill={ORIGINAL_FILL} />}
                    <Bar dataKey="synthetic" name="Synthetic" fill={SYNTHETIC_FILL} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            ))}
          </div>
        </div>
      )}

      {numericComparisons.length > 0 && (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--color-border)]">
            <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Original vs Synthetic</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--color-surface-2)] text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                  <th className="text-left px-4 py-3 font-medium">Column</th>
                  <th className="text-left px-3 py-3 font-medium">Mean (orig → synth)</th>
                  <th className="text-left px-3 py-3 font-medium">Std dev (orig → synth)</th>
                  <th className="text-left px-3 py-3 font-medium">Null rate (orig → synth)</th>
                  <th className="text-left px-3 py-3 font-medium">Top category (orig → synth)</th>
                </tr>
              </thead>
              <tbody>
                {numericComparisons.map(({ s, o }) => {
                  const numeric = s.kind === 'numeric';
                  const ot = o!.topValues?.[0];
                  const st = s.topValues?.[0];
                  return (
                    <tr key={s.name} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
                      <td className="px-4 py-3 font-mono text-xs font-medium text-[var(--color-text-primary)]">{s.name}</td>
                      <td className="px-3 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{numeric ? `${fmt(o!.mean)} → ${fmt(s.mean)}` : '—'}</td>
                      <td className="px-3 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{numeric ? `${fmt(o!.stdDev)} → ${fmt(s.stdDev)}` : '—'}</td>
                      <td className="px-3 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{pctText(o!.nullRate)} → {pctText(s.nullRate)}</td>
                      <td className="px-3 py-3 font-mono text-xs text-[var(--color-text-secondary)]">
                        {!numeric && ot && st ? `${ot.value} ${ot.pct.toFixed(1)}% → ${st.value} ${st.pct.toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Column stats */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--color-border)]">
          <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Column Statistics (synthetic)</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--color-surface-2)] text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                <th className="text-left px-4 py-3 font-medium">Column</th>
                <th className="text-left px-3 py-3 font-medium">Type</th>
                <th className="text-left px-3 py-3 font-medium">Nulls</th>
                <th className="text-left px-3 py-3 font-medium">Unique</th>
                <th className="text-left px-3 py-3 font-medium">Min</th>
                <th className="text-left px-3 py-3 font-medium">Max</th>
                <th className="text-left px-3 py-3 font-medium">Mean</th>
                <th className="text-left px-3 py-3 font-medium">Median</th>
                <th className="text-left px-3 py-3 font-medium">Std dev</th>
              </tr>
            </thead>
            <tbody>
              {columns.map(col => (
                <tr key={col.name} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
                  <td className="px-4 py-3 font-mono text-xs font-medium text-[var(--color-text-primary)]">{col.name}</td>
                  <td className="px-3 py-3"><Badge variant="muted">{col.type}</Badge></td>
                  <td className="px-3 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{col.nullCount.toLocaleString()} ({pctText(col.nullRate)})</td>
                  <td className="px-3 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{col.uniqueCount.toLocaleString()}</td>
                  <td className="px-3 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{fmt(col.min)}</td>
                  <td className="px-3 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{fmt(col.max)}</td>
                  <td className="px-3 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{fmt(col.mean)}</td>
                  <td className="px-3 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{fmt(col.median)}</td>
                  <td className="px-3 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{fmt(col.stdDev)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
