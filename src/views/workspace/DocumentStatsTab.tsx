'use client';

import React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DocumentResult } from '../../lib/types';
import { formatMoney } from '../../lib/engine/regions';

const tooltipStyle = { fontSize: 12, borderRadius: 6, border: '1px solid var(--color-border)' };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4">
      <p className="text-xs text-[var(--color-text-muted)] mb-1">{label}</p>
      <p className="text-lg font-semibold text-[var(--color-text-primary)] font-mono">{value}</p>
    </div>
  );
}

/** Summary numbers computed from the generated documents. */
export function DocumentStatsTab({ result }: { result: DocumentResult }) {
  if (result.invoices) {
    const inv = result.invoices;
    const cur = inv[0]?.currency ?? 'USD', loc = inv[0]?.intlLocale ?? 'en-US';
    const money = (c: number) => formatMoney(c, cur, loc);
    const totals = inv.map(i => i.totalCents);
    const sum = totals.reduce((a, b) => a + b, 0);
    const lines = inv.map(i => i.lines.length);
    const byLines = Array.from({ length: 8 }, (_, k) => ({ lines: String(k + 1), invoices: lines.filter(l => l === k + 1).length }));
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Invoices" value={inv.length.toLocaleString()} />
          <Stat label="Grand total" value={money(sum)} />
          <Stat label="Average invoice" value={money(inv.length ? Math.round(sum / inv.length) : 0)} />
          <Stat label={`Total ${inv[0]?.taxLabel ?? 'tax'}`} value={money(inv.reduce((a, i) => a + i.taxCents, 0))} />
          <Stat label="Line items" value={lines.reduce((a, b) => a + b, 0).toLocaleString()} />
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4">
          <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">Invoices by number of line items</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byLines} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="lines" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="invoices" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  const st = result.statements ?? [];
  const cur = st[0]?.currency ?? 'USD', loc = st[0]?.intlLocale ?? 'en-US';
  const money = (c: number) => formatMoney(c, cur, loc);
  const tx = st.flatMap(s => s.transactions);
  const lowest = tx.reduce((a, t) => Math.min(a, t.balanceCents), Infinity);
  const byCategory = [...tx.reduce((m, t) => m.set(t.category, (m.get(t.category) ?? 0) + 1), new Map<string, number>())]
    .map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Statements" value={st.length.toLocaleString()} />
        <Stat label="Transactions" value={tx.length.toLocaleString()} />
        <Stat label="Total credits" value={money(st.reduce((a, s) => a + s.totalCreditsCents, 0))} />
        <Stat label="Total debits" value={money(st.reduce((a, s) => a + s.totalDebitsCents, 0))} />
        <Stat label="Lowest balance" value={Number.isFinite(lowest) ? money(lowest) : '—'} />
      </div>
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4">
        <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">Transactions by category</h4>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={byCategory} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="category" tick={{ fontSize: 10 }} interval={0} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="count" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
