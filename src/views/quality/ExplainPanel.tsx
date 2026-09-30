'use client';

import React, { useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { AiBadge, AiUnavailable } from '../../components/common/AiBadge';
import type { AiQualityExplanation, GenerationConfig } from '../../lib/types';
import type { QualityReport } from '../../lib/engine/quality';
import { aiPost, useAiStatus } from '../../lib/ai/client';

function describeSettings(config?: GenerationConfig): string {
  if (!config) return 'not recorded';
  const t = (config.columnRules?.length ?? 0);
  return [
    `rows ${config.rowCount}`,
    `missing values ${config.edgeCases.missingValues ? `${Math.round(config.nullRate * 100)}%` : 'off'}`,
    `outliers ${config.edgeCases.numericOutliers ? `${Math.round(config.outlierRate * 100)}%` : 'off'}`,
    `edge cases: ${Object.entries(config.edgeCases).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`,
    `locale ${config.locale}`,
    config.privacyEpsilon ? `privacy ε ${config.privacyEpsilon}` : '',
    t ? `${t} business rules` : '',
  ].filter(Boolean).join('; ');
}

/** Plain-English summary of the real quality results, written by the model on request. */
export function ExplainPanel({ report, datasetName, config }: { report: QualityReport; datasetName: string; config?: GenerationConfig }) {
  const status = useAiStatus();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ data: AiQualityExplanation; model: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const explain = async () => {
    setBusy(true);
    setError(null);
    const res = await aiPost<AiQualityExplanation>('explain', {
      dataset: datasetName,
      overall: report.overall,
      dimensions: report.dimensions.map(d => ({ label: d.label, score: d.score, detail: d.detail.slice(0, 1000) })),
      warnings: report.warnings.slice(0, 40).map(w => ({ severity: w.severity, column: w.column, title: w.title, detail: w.detail.slice(0, 500) })),
      settings: describeSettings(config),
    });
    if (res.ok) setResult({ data: res.data, model: res.model });
    else setError(res.message);
    setBusy(false);
  };

  const list = (title: string, items: string[], tone: string) => items.length > 0 && (
    <div>
      <p className={`text-xs font-semibold mb-1 ${tone}`}>{title}</p>
      <ul className="list-disc list-inside space-y-0.5 text-xs text-[var(--color-text-secondary)]">{items.map(i => <li key={i}>{i}</li>)}</ul>
    </div>
  );

  if (status && !status.configured) return null;

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <MessageSquareText size={15} className="text-[var(--color-primary)]" />
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Plain-English Summary</h3>
          {result && <AiBadge title={`Written by ${result.model} from the scores above`} />}
        </div>
        <Button size="sm" variant="outline" loading={busy} disabled={!status?.configured} onClick={explain}>
          {result ? 'Explain again' : 'Explain with AI'}
        </Button>
      </div>
      {error && <AiUnavailable message="Couldn't reach AI. Try again." detail={error} />}
      {result && (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-text-primary)]">{result.data.summary}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {list('What is good', result.data.strengths, 'text-[var(--color-success)]')}
            {list('What is weak', result.data.weaknesses, 'text-[var(--color-warning)]')}
            {list('What to change', result.data.actions, 'text-[var(--color-primary)]')}
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)]">Based on scores only. No data rows are shared.</p>
        </div>
      )}
    </div>
  );
}
