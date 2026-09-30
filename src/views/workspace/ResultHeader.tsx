'use client';

import React from 'react';
import Link from 'next/link';
import { BrainCircuit, CheckCircle } from 'lucide-react';
import { useLatestResult } from '../../lib/resultStore';
import { tstrTargets } from '../../lib/engine/tstr';
import { Badge } from '../../components/common/Badge';
import type { Generation } from '../../lib/types';
import type { HistoryEntry } from '../../lib/historyStore';
import { formatBytes, formatDuration } from '../../lib/formatters';

export function ResultHeader({ gen, regeneratedFrom }: { gen: Generation; regeneratedFrom?: HistoryEntry | null }) {
  // Shortcut to the TSTR test, shown only when it can run: a single table learned from an upload, with a
  // column worth predicting. Otherwise it would lead to a card that says "not available".
  const latest = useLatestResult();
  const canTstr = !!(latest && latest.generation.id === gen.id && latest.result && latest.tstrSource
    && tstrTargets(latest.tstrSource.schema, latest.result.originalProfile).length);
  return (
    <div className="px-6 py-5 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={18} className="text-[var(--color-success)]" />
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Generation Complete</h2>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {regeneratedFrom
              ? `Regenerated "${regeneratedFrom.name}" from History with the same seed and configuration (originally ${new Date(regeneratedFrom.createdAt).toLocaleString()}).`
              : 'Your synthetic dataset is ready and saved to History.'}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {canTstr && (
            <Link
              href="/quality#ml-utility"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--color-primary-light)] text-[var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-white transition-colors"
            >
              <BrainCircuit size={13} /> Test ML utility (TSTR) →
            </Link>
          )}
          <Link href="/quality" className="text-xs text-[var(--color-primary)] hover:underline">Open Quality Observatory →</Link>
          <Badge variant="success">Completed</Badge>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 mt-4 text-xs text-[var(--color-text-muted)]">
        <span><span className="font-mono font-medium text-[var(--color-text-primary)]">{gen.rowCount.toLocaleString()}</span> rows</span>
        {!!gen.columnCount && <span><span className="font-mono font-medium text-[var(--color-text-primary)]">{gen.columnCount}</span> columns</span>}
        {!!gen.tableCount && <span><span className="font-mono font-medium text-[var(--color-text-primary)]">{gen.tableCount}</span> tables</span>}
        {!!gen.fileSizeMb && <span><span className="font-mono font-medium text-[var(--color-text-primary)]">{formatBytes(gen.fileSizeMb)}</span> as CSV</span>}
        {!!gen.generationTimeMs && <span>Generated in <span className="font-mono font-medium text-[var(--color-text-primary)]">{formatDuration(gen.generationTimeMs)}</span></span>}
        {gen.config?.seed !== undefined && <span>Seed <span className="font-mono font-medium text-[var(--color-text-primary)]">{gen.config.seed}</span></span>}
      </div>
    </div>
  );
}
