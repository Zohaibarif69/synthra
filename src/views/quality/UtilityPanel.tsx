'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrainCircuit, Play } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { tabularEngine, type TstrSource } from '../../lib/engine/client';
import { tstrTargets, type TstrResult } from '../../lib/engine/tstr';
import { getTstrResult, setTstrResult } from '../../lib/resultStore';
import type { TabularResult } from '../../lib/types';

const RATING: Record<TstrResult['rating'], { label: string; cls: string }> = {
  excellent: { label: 'Excellent', cls: 'bg-[var(--color-success)]/15 text-[var(--color-success)]' },
  good: { label: 'Good', cls: 'bg-[var(--color-success)]/15 text-[var(--color-success)]' },
  fair: { label: 'Fair', cls: 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]' },
  poor: { label: 'Poor', cls: 'bg-[var(--color-error)]/15 text-[var(--color-error)]' },
  'n/a': { label: 'Not reliable', cls: 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]' },
};

const METRIC: Record<TstrResult['metric'], { name: string; guess: string; fmt: (v: number) => string }> = {
  auc: { name: 'AUC', guess: 'Random guessing', fmt: v => v.toFixed(3) },
  accuracy: { name: 'Accuracy', guess: 'Always the most common answer', fmt: v => `${(v * 100).toFixed(1)}%` },
  r2: { name: 'R²', guess: 'Always the average', fmt: v => v.toFixed(3) },
};

function Bar({ label, value, max, fmt, tone }: { label: string; value: number; max: number; fmt: (v: number) => string; tone: string }) {
  const width = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-[var(--color-text-secondary)]">{label}</span>
        <span className="font-mono font-semibold text-[var(--color-text-primary)]">{fmt(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

/**
 * "Train on Synthetic, Test on Real": does a model trained only on the synthetic data still work on real data?
 * Available for single-table datasets generated from an uploaded file.
 */
export function UtilityPanel({ result, source }: { result: TabularResult; source?: TstrSource }) {
  const targets = useMemo(() => (source ? tstrTargets(source.schema, result.originalProfile) : []), [source, result.originalProfile]);
  const [target, setTarget] = useState(targets[0]?.column ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<TstrResult | undefined>(() => (targets[0] ? getTstrResult(targets[0].column) : undefined));
  const cardRef = useRef<HTMLDivElement>(null);
  const [spotlight, setSpotlight] = useState(false);

  // Arriving from the "Test ML utility" shortcut (/quality#ml-utility): scroll here and highlight briefly.
  useEffect(() => {
    if (window.location.hash !== '#ml-utility') return;
    const t = setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setSpotlight(true);
      setTimeout(() => setSpotlight(false), 2000);
    }, 150);
    return () => clearTimeout(t);
  }, []);

  const run = async () => {
    if (!source || !target) return;
    setBusy(true);
    setError(null);
    try {
      const r = await tabularEngine.runTstr(source, target);
      setTstrResult(r);
      setRes(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chooseTarget = (t: string) => {
    setTarget(t);
    setError(null);
    setRes(getTstrResult(t));
  };

  const m = res ? METRIC[res.metric] : null;
  const top = res ? Math.max(res.real, res.synthetic, res.baseline, 0.001) : 1;

  return (
    <div
      id="ml-utility"
      ref={cardRef}
      className={`scroll-mt-20 bg-[var(--color-surface)] border rounded-[var(--radius-lg)] p-5 space-y-4 transition-shadow duration-500 ${
        spotlight ? 'border-[var(--color-primary)] ring-4 ring-[var(--color-primary)]/20' : 'border-[var(--color-border)]'
      }`}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit size={16} className="text-[var(--color-primary)]" />
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">ML utility (TSTR)</h3>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1 max-w-2xl">
            Train on Synthetic, Test on Real: a model learns only from synthetic data, then predicts real rows it has
            never seen. The score is how much of a real-data model&apos;s skill it keeps.
          </p>
        </div>
        {source && targets.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="tstr-target" className="text-xs font-medium text-[var(--color-text-secondary)]">Predict</label>
            <select
              id="tstr-target"
              value={target}
              onChange={e => chooseTarget(e.target.value)}
              className="px-3 py-1.5 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none"
            >
              {targets.map(t => (
                <option key={t.column} value={t.column}>
                  {t.column} ({t.task === 'regression' ? 'number' : t.classes === 2 ? 'yes/no' : `${t.classes} classes`})
                </option>
              ))}
            </select>
            <Button size="sm" icon={<Play size={13} />} loading={busy} onClick={run}>{res ? 'Run again' : 'Run test'}</Button>
          </div>
        )}
      </div>

      {!source && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Available for single-table datasets generated from an uploaded file in this session: the test needs real rows to check against.
        </p>
      )}
      {source && !targets.length && (
        <p className="text-xs text-[var(--color-text-muted)]">
          No column is suitable to predict. It needs a yes/no, category (up to 20 values) or number column that isn&apos;t an ID or personal data.
        </p>
      )}
      {busy && <p className="text-xs text-[var(--color-text-secondary)]" role="status">Splitting rows, generating a training set and training two models…</p>}
      {error && <p className="text-xs text-[var(--color-error)]" role="alert">{error}</p>}

      {res && m && !busy && (
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6 items-start">
          <div className="space-y-2">
            <p className="text-4xl font-bold font-mono text-[var(--color-text-primary)]">
              {res.utility === null ? '—' : `${res.utility}%`}
            </p>
            <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${RATING[res.rating].cls}`}>{RATING[res.rating].label}</span>
            <p className="text-xs text-[var(--color-text-secondary)]">
              {res.predictable
                ? res.synthetic >= res.real
                  ? `A model trained only on synthetic data matches one trained on real data at predicting "${res.target}".`
                  : `A model trained only on synthetic data keeps ${res.utility}% of the real model's skill at predicting "${res.target}".`
                : `Even real data barely predicts "${res.target}" (${m.name} ${m.fmt(res.real)}), so this test can't judge the synthetic data. Try another column.`}
            </p>
          </div>

          <div className="space-y-3">
            <Bar label="Trained on real data" value={res.real} max={top} fmt={m.fmt} tone="bg-[var(--color-text-muted)]" />
            <Bar label="Trained on synthetic data" value={res.synthetic} max={top} fmt={m.fmt} tone="bg-[var(--color-primary)]" />
            <Bar label={m.guess} value={res.baseline} max={top} fmt={m.fmt} tone="bg-[var(--color-border)]" />
            <p className="text-xs text-[var(--color-text-muted)]">
              {m.name} on {res.rows.realTest.toLocaleString()} held-out real rows · {res.secondary.name}: real{' '}
              {res.secondary.name === 'Mean absolute error' ? res.secondary.real.toLocaleString() : `${(res.secondary.real * 100).toFixed(1)}%`}, synthetic{' '}
              {res.secondary.name === 'Mean absolute error' ? res.secondary.synthetic.toLocaleString() : `${(res.secondary.synthetic * 100).toFixed(1)}%`}
            </p>
            <details className="text-xs text-[var(--color-text-secondary)]">
              <summary className="cursor-pointer text-[var(--color-primary)]">How this was measured</summary>
              <ul className="mt-2 space-y-1 list-disc pl-5">
                <li>The upload was split once by seed: {res.rows.realTest.toLocaleString()} rows held out for testing, the rest for training.</li>
                <li>A fresh generator learned only from the training rows and produced {res.rows.syntheticTrain.toLocaleString()} synthetic rows, so the test rows were never seen.</li>
                <li>{res.model}, trained twice: on {res.rows.realTrain.toLocaleString()} real rows and on the synthetic rows.</li>
                <li>Score = (synthetic − guessing) ÷ (real − guessing), so a model that only guesses scores 0%.</li>
                <li>Features: {res.features.join(', ')}.</li>
                {res.excluded.length > 0 && <li>Not used: {res.excluded.map(e => `${e.column} (${e.reason})`).join(', ')}.</li>}
                <li>Ran in your browser in {(res.durationMs / 1000).toFixed(1)} s. No data was sent anywhere.</li>
              </ul>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}
