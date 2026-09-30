'use client';

import React from 'react';
import Link from 'next/link';
import { CheckCircle } from 'lucide-react';
import { Badge } from '../../components/common/Badge';
import type { Generation } from '../../lib/types';
import type { HistoryEntry } from '../../lib/historyStore';
import { formatBytes, formatDuration } from '../../lib/formatters';

export function ResultHeader({ gen, regeneratedFrom }: { gen: Generation; regeneratedFrom?: HistoryEntry | null }) {
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
        <div className="flex items-center gap-3">
          {(
            <Link href="/quality" className="text-xs text-[var(--color-primary)] hover:underline">Open Quality Observatory →</Link>
          )}
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
