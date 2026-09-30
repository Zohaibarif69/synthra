'use client';

import React from 'react';
import { Sparkles, RefreshCw, Shield } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { PrivacyBadge } from '../../components/common/Badge';
import type { GenerationConfig, ColumnSchema, DatasetProfile, PrivacyTransform } from '../../lib/types';
import { AiAssistPanel } from './AiAssistPanel';
import { describeColumnRule, ruleProblem } from '../../lib/engine/rules';
import { LOCALES, CURRENCIES, ROW_PRESETS } from '../../lib/constants';
import { generateSeed } from '../../lib/engine/random';
import { allowedTransforms, DEFAULT_EPSILON, MAX_EPSILON, MIN_EPSILON } from '../../lib/engine/privacy';
import { InfoTip } from '../quality/InfoTip';
import { BusinessRulesEditor } from './BusinessRulesEditor';

const EDGE_CASE_LABELS: Record<string, string> = {
  missingValues: 'Missing values',
  numericOutliers: 'Numeric outliers',
  rareCategories: 'Rare categories',
  boundaryValues: 'Boundary values',
  longText: 'Long text',
  duplicateLike: 'Near-duplicates',
};

export const MAX_ROWS = 1_000_000;

const TRANSFORM_LABELS: Record<PrivacyTransform, string> = {
  preserve: 'Preserve',
  mask: 'Mask',
  hash: 'Hash (SHA-256)',
  synthetic: 'Synthetic (faker)',
  noise: 'Differential noise',
};
const LEVEL_ORDER = { high: 0, medium: 1, low: 2 };

export function ConfigurationPanel({
  config, onChange, schema, onSchemaChange, onNext, rowCountNote, profile, preview,
}: {
  /** Live preview panel shown under the settings. */
  preview?: React.ReactNode;
  config: GenerationConfig;
  onChange: (c: GenerationConfig) => void;
  schema: ColumnSchema[];
  /** Learned from an upload; used for AI prompts (summaries only, no raw PII). */
  profile?: DatasetProfile | null;
  onSchemaChange: (s: ColumnSchema[]) => void;
  onNext: () => void;
  /** Relational generation: row counts come from the tables, so the row input is replaced by this note. */
  rowCountNote?: string;
}) {
  const set = (key: keyof GenerationConfig, value: unknown) => onChange({ ...config, [key]: value });
  // Sensitive columns first.
  const orderedFields = [...schema].sort((a, b) => LEVEL_ORDER[a.privacyLevel ?? 'low'] - LEVEL_ORDER[b.privacyLevel ?? 'low']);
  const setTransform = (name: string, t: PrivacyTransform) =>
    onSchemaChange(schema.map(c => (c.name === name ? { ...c, privacyTransform: t } : c)));
  const usesNoise = schema.some(c => c.privacyTransform === 'noise');
  const epsilon = config.privacyEpsilon ?? DEFAULT_EPSILON;
  // Problems that would make generation fail or ignore something the user asked for.
  const blockers = [
    ...(!schema.length ? ['The schema has no columns. Go back and define or upload one.'] : []),
    ...(!rowCountNote && !(config.rowCount >= 1) ? ['Row count must be at least 1.'] : []),
    ...(config.columnRules ?? []).flatMap(r => {
      const p = ruleProblem(r, schema);
      return p ? [`Business rule “${describeColumnRule(r)}”: ${p} Fix or remove it.`] : [];
    }),
  ];

  return (
    <div className="p-6 max-w-5xl grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        {/* Row count */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">Generation Parameters</h3>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-[var(--color-text-secondary)] block mb-1.5">Number of Rows</label>
              {rowCountNote ? (
                <p className="text-sm text-[var(--color-text-secondary)]">{rowCountNote}</p>
              ) : (
              <div className="flex gap-2 items-center">
                <input aria-label="Number of Rows"
                  type="number"
                  value={config.rowCount}
                  onChange={e => set('rowCount', Math.min(MAX_ROWS, Math.max(1, parseInt(e.target.value) || 1)))}
                  min={1}
                  max={MAX_ROWS}
                  className="w-32 px-3 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm font-mono bg-transparent text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none"
                />
                <div className="flex gap-1">
                  {ROW_PRESETS.map(p => (
                    <button
                      key={p.value}
                      onClick={() => set('rowCount', p.value)}
                      className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${config.rowCount === p.value ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-[var(--color-text-secondary)] block mb-1.5">Locale</label>
                <select aria-label="Locale" value={config.locale} onChange={e => set('locale', e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none">
                  {LOCALES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--color-text-secondary)] block mb-1.5">Currency</label>
                <select aria-label="Currency" value={config.currency} onChange={e => set('currency', e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none">
                  {CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>

            <div className={config.edgeCases.missingValues ? '' : 'opacity-50'}>
              <label className="text-xs font-medium text-[var(--color-text-secondary)] block mb-1.5">
                Missing Value Rate — {Math.round(config.nullRate * 100)}%
                {!config.edgeCases.missingValues && <span className="font-normal text-[var(--color-text-muted)]"> (enable “Missing Values” below)</span>}
              </label>
              <input aria-label="Missing value rate in percent" type="range" min={0} max={50} value={Math.round(config.nullRate * 100)}
                disabled={!config.edgeCases.missingValues}
                onChange={e => set('nullRate', parseInt(e.target.value) / 100)}
                className="w-full accent-[var(--color-primary)]" />
              <div className="flex justify-between text-xs text-[var(--color-text-muted)] mt-0.5">
                <span>0%</span><span>Applied to nullable columns</span><span>50%</span>
              </div>
            </div>

            <div className={config.edgeCases.numericOutliers ? '' : 'opacity-50'}>
              <label className="text-xs font-medium text-[var(--color-text-secondary)] block mb-1.5">
                Outlier Rate — {Math.round(config.outlierRate * 100)}%
                {!config.edgeCases.numericOutliers && <span className="font-normal text-[var(--color-text-muted)]"> (enable “Numeric Outliers” below)</span>}
              </label>
              <input aria-label="Outlier rate in percent" type="range" min={0} max={20} value={Math.round(config.outlierRate * 100)}
                disabled={!config.edgeCases.numericOutliers}
                onChange={e => set('outlierRate', parseInt(e.target.value) / 100)}
                className="w-full accent-[var(--color-primary)]" />
              <div className="flex justify-between text-xs text-[var(--color-text-muted)] mt-0.5">
                <span>0%</span><span>20%</span>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--color-text-secondary)] block mb-1.5">Random Seed</label>
              <div className="flex gap-2">
                <input aria-label="Random Seed"
                  type="number"
                  value={config.seed ?? ''}
                  placeholder="Auto"
                  onChange={e => {
                    const n = parseInt(e.target.value);
                    set('seed', Number.isFinite(n) && n >= 0 ? n : undefined);
                  }}
                  className="w-28 px-3 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm font-mono bg-transparent text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none"
                />
                <button
                  onClick={() => set('seed', generateSeed())}
                  className="px-3 py-2 text-xs border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw size={12} /> Randomize
                </button>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">Same seed, same data. Leave empty for a random one.</p>
            </div>
          </div>
        </section>

        {/* Edge cases */}
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">Edge Cases</h3>
          <div className="grid grid-cols-2 gap-2">
            {(Object.entries(config.edgeCases) as [keyof typeof config.edgeCases, boolean][]).map(([key, val]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer hover:text-[var(--color-text-primary)] transition-colors">
                <input
                  type="checkbox"
                  checked={val}
                  onChange={e => set('edgeCases', { ...config.edgeCases, [key]: e.target.checked })}
                  className="accent-[var(--color-primary)]"
                />
                {EDGE_CASE_LABELS[key] ?? key}
              </label>
            ))}
          </div>
        </section>

        <BusinessRulesEditor schema={schema} rules={config.columnRules ?? []} onChange={r => set('columnRules', r)} />

        <AiAssistPanel schema={schema} profile={profile} config={config} onChange={onChange} />
      </div>

      {/* Privacy panel */}
      <div className="space-y-4">
        {schema.length > 0 && (
          <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5">
            <div className="flex items-center gap-2 mb-4">
              <Shield size={15} className="text-[var(--color-primary)]" />
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Privacy Rules</h3>
            </div>
            <div className="space-y-2.5">
              {orderedFields.map(f => (
                <div key={f.name} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-mono font-semibold text-[var(--color-text-primary)] truncate">{f.name}</span>
                    {f.privacyLevel && f.privacyLevel !== 'low' && <PrivacyBadge level={f.privacyLevel} />}
                  </span>
                  <select
                    aria-label={`Privacy transform for ${f.name}`}
                    value={f.privacyTransform ?? 'preserve'}
                    onChange={e => setTransform(f.name, e.target.value as PrivacyTransform)}
                    className="shrink-0 px-2 py-1 text-xs border border-[var(--color-border)] rounded bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none"
                  >
                    {allowedTransforms(f).map(t => <option key={t} value={t}>{TRANSFORM_LABELS[t]}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {usesNoise && (
              <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                <label className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5 mb-1.5">
                  Privacy budget ε — {epsilon}
                  <InfoTip align="right">
                    Differential noise adds a small random amount to every number in the “Noise” columns, so no single
                    value can be traced back exactly. ε (epsilon) controls how much: a <strong>lower</strong> ε adds
                    <strong> more</strong> noise (more private, less accurate), a higher ε adds less. The noise follows a
                    Laplace distribution with scale = (5% of the column’s range) ÷ ε. At ε = 1 an age column spanning 18–80
                    typically moves by about ±3 years, while averages stay close.
                  </InfoTip>
                </label>
                <input aria-label="Privacy budget epsilon" type="range" min={MIN_EPSILON} max={MAX_EPSILON} step={0.1} value={epsilon}
                  onChange={e => set('privacyEpsilon', Number(e.target.value))}
                  className="w-full accent-[var(--color-primary)]" />
                <div className="flex justify-between text-xs text-[var(--color-text-muted)] mt-0.5">
                  <span>{MIN_EPSILON} · more private</span><span>{MAX_EPSILON} · more accurate</span>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Summary */}
        <section className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4">
          <h3 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase mb-3">Generation Summary</h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">Rows</span>
              <span className="font-mono font-medium">{rowCountNote ? 'Per table' : config.rowCount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">Null rate</span>
              <span className="font-mono">{config.edgeCases.missingValues ? `${Math.round(config.nullRate * 100)}%` : 'Off'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">Outlier rate</span>
              <span className="font-mono">{config.edgeCases.numericOutliers ? `${Math.round(config.outlierRate * 100)}%` : 'Off'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">Seed</span>
              <span className="font-mono">{config.seed ?? 'Auto'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">Locale</span>
              <span className="font-mono">{config.locale}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-text-muted)]">Currency</span>
              <span className="font-mono">{config.currency}</span>
            </div>
          </div>
        </section>

        {blockers.length > 0 && (
          <div role="alert" className="bg-[var(--color-error-bg)] border border-[var(--color-error)]/30 rounded-[var(--radius-md)] p-3 space-y-1">
            {blockers.map(b => <p key={b} className="text-xs text-[var(--color-error)]">{b}</p>)}
          </div>
        )}
        <Button className="w-full" icon={<Sparkles size={15} />} onClick={onNext} disabled={blockers.length > 0}>
          Generate Data
        </Button>
      </div>

      {preview && <div className="lg:col-span-3">{preview}</div>}
    </div>
  );
}
