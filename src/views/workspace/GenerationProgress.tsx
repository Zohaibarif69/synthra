'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { Progress } from '../../components/common/Progress';
import { useToast } from '../../components/common/Toast';
import type { DocumentResult, GenerationStageId, RelationalResult, TabularResult } from '../../lib/types';
import { tabularEngine, GenerationCancelledError, type EngineJob } from '../../lib/engine/client';
import { formatDuration } from '../../lib/formatters';

interface Stage { id: GenerationStageId; label: string; weight: number }

const TABULAR_STAGES: Stage[] = [
  { id: 'prepare', label: 'Preparing model (distributions & correlations)', weight: 3 },
  { id: 'generate', label: 'Generating records', weight: 70 },
  { id: 'edge', label: 'Applying nulls, outliers & edge cases', weight: 10 },
  { id: 'privacy', label: 'Applying privacy transforms', weight: 5 },
  { id: 'profile', label: 'Computing statistics', weight: 10 },
  { id: 'validate', label: 'Validating', weight: 2 },
];

const RELATIONAL_STAGES: Stage[] = [
  { id: 'prepare', label: 'Ordering tables by dependency', weight: 2 },
  { id: 'generate', label: 'Generating tables & linking foreign keys', weight: 65 },
  { id: 'privacy', label: 'Applying privacy transforms', weight: 5 },
  { id: 'links', label: 'Computing cross-table totals', weight: 5 },
  { id: 'profile', label: 'Computing statistics', weight: 15 },
  { id: 'validate', label: 'Validating referential integrity & rules', weight: 8 },
];

const DOCUMENT_STAGES: Stage[] = [
  { id: 'generate', label: 'Generating documents', weight: 80 },
  { id: 'validate', label: 'Checking totals, balances & dates', weight: 20 },
];

export function GenerationProgress({ job, onComplete, onCancel }: {
  job: EngineJob;
  onComplete: (result: TabularResult | RelationalResult | DocumentResult) => void;
  onCancel: () => void;
}) {
  const relational = job.kind === 'relational';
  const documents = job.kind === 'documents';
  const stages = relational ? RELATIONAL_STAGES : documents ? DOCUMENT_STAGES : TABULAR_STAGES;
  const [stageIndex, setStageIndex] = useState(0);
  const [fraction, setFraction] = useState(0);
  const [detail, setDetail] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const started = useRef(false);
  const toast = useToast();

  useEffect(() => {
    // Guard against React strict-mode double effects starting two jobs.
    if (started.current) return;
    started.current = true;
    const onProgress = (stage: GenerationStageId, f: number, d?: string) => {
      const i = stages.findIndex(s => s.id === stage);
      if (i < 0) return;
      setStageIndex(i);
      setFraction(f);
      setDetail(d);
    };
    const run: Promise<TabularResult | RelationalResult | DocumentResult> =
      job.kind === 'relational' ? tabularEngine.generateRelational(job, onProgress)
      : job.kind === 'documents' ? tabularEngine.generateDocuments(job, onProgress)
      : tabularEngine.generate(job, onProgress);
    run
      .then(result => {
        setDone(true);
        setStageIndex(stages.length);
        const what = 'kind' in result && (result.kind === 'invoice' || result.kind === 'bank_statement')
          ? result.kind === 'invoice' ? `${result.invoices!.length.toLocaleString()} invoices` : `${result.statements!.length.toLocaleString()} statements (${result.rowCount.toLocaleString()} transactions)`
          : `${result.rowCount.toLocaleString()} rows${'tables' in result ? ` across ${result.tables.length} tables` : ''}`;
        toast.success(`Generated ${what} in ${formatDuration(result.generationTimeMs)}`);
        onComplete(result);
      })
      .catch(err => {
        if (err instanceof GenerationCancelledError) return;
        setError((err as Error).message || 'Generation failed.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = () => {
    tabularEngine.cancel();
    toast.info('Generation cancelled');
    onCancel();
  };

  const completedWeight = stages.slice(0, stageIndex).reduce((a, s) => a + s.weight, 0);
  const totalWeight = stages.reduce((a, s) => a + s.weight, 0);
  const progress = done ? 100 : ((completedWeight + (stages[stageIndex]?.weight ?? 0) * fraction) / totalWeight) * 100;
  const rowsDone = job.kind !== 'relational' && job.kind !== 'documents' && stages[stageIndex]?.id === 'generate' ? Math.floor(job.config.rowCount * fraction) : null;
  const title = job.kind === 'relational'
    ? `Generating ${job.tables.length} tables (seed ${job.config.seed})...`
    : job.kind === 'documents'
      ? `Generating ${job.docType === 'invoice' ? `${job.invoiceConfig!.count} invoices` : `${job.bankConfig!.count} bank statements`} (seed ${job.seed})...`
      : `Generating ${job.config.rowCount.toLocaleString()} rows (seed ${job.config.seed})...`;

  if (error) {
    return (
      <div className="p-8 max-w-lg">
        <div className="bg-[var(--color-surface)] border border-[var(--color-error)]/40 rounded-[var(--radius-lg)] p-6">
          <div className="flex items-center gap-2 mb-2">
            <XCircle size={18} className="text-[var(--color-error)]" />
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Generation Failed</h2>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">{error}</p>
          <Button variant="outline" size="sm" onClick={onCancel}>Back to Configuration</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-lg">
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6">
        <div className="flex items-center gap-2 mb-6">
          {!done && <div className="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full spinning" />}
          {done && <CheckCircle size={18} className="text-[var(--color-success)]" />}
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{done ? 'Generation Complete' : title}</h2>
        </div>
        <div className="space-y-3 mb-6">
          {stages.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2.5">
              {i < stageIndex ? (
                <CheckCircle size={15} className="text-[var(--color-success)] shrink-0" />
              ) : i === stageIndex ? (
                <div className="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full spinning shrink-0" />
              ) : (
                <div className="w-4 h-4 rounded-full border border-[var(--color-border)] shrink-0" />
              )}
              <span className={`text-sm ${i < stageIndex ? 'text-[var(--color-success)]' : i === stageIndex ? 'text-[var(--color-text-primary)] font-medium' : 'text-[var(--color-text-muted)]'}`}>
                {s.label}
                {i === stageIndex && rowsDone !== null && job.kind !== 'relational' && job.kind !== 'documents' && (
                  <span className="font-normal text-[var(--color-text-muted)]"> — {rowsDone.toLocaleString()} / {job.config.rowCount.toLocaleString()}</span>
                )}
                {i === stageIndex && (relational || documents) && detail && (
                  <span className="font-normal text-[var(--color-text-muted)]"> — {detail}</span>
                )}
              </span>
            </div>
          ))}
        </div>
        <Progress value={progress} label="Progress" />
        {!done && (
          <div className="mt-4 flex justify-end">
            <Button variant="outline" size="sm" onClick={handleCancel}>Cancel</Button>
          </div>
        )}
      </div>
    </div>
  );
}
