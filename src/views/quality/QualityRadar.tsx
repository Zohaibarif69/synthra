'use client';

import React from 'react';
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { QualityDimension } from '../../lib/engine/quality';

/** Radar of the available dimensions only; "Overall" is deliberately not an axis. */
export function QualityRadar({ dimensions }: { dimensions: QualityDimension[] }) {
  const data = dimensions.filter(d => d.score !== null).map(d => ({ dimension: d.label, score: d.score }));
  const skipped = dimensions.filter(d => d.score === null);

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">Quality Radar</h3>
      {data.length >= 3 ? (
        <ResponsiveContainer width="100%" height={240}>
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke="var(--color-border)" />
            <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} />
            <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10 }} angle={90} />
            <Radar dataKey="score" name="Score" stroke="var(--color-primary)" fill="var(--color-primary)" fillOpacity={0.25} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid var(--color-border)' }} />
          </RadarChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-xs text-[var(--color-text-muted)] py-16 text-center">
          A radar needs at least 3 scored dimensions ({data.length} available). Upload a source file to unlock fidelity and correlation.
        </p>
      )}
      {skipped.length > 0 && data.length >= 3 && (
        <p className="text-[11px] text-[var(--color-text-muted)]">Not shown (N/A): {skipped.map(d => d.label).join(', ')}</p>
      )}
    </div>
  );
}
