'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, Play, Download, Trash2, FolderOpen, Table, Receipt, Landmark } from 'lucide-react';
import { EmptyState } from '../components/common/EmptyState';
import { Badge } from '../components/common/Badge';
import { ConfirmModal } from '../components/common/Modal';
import { useToast } from '../components/common/Toast';
import { historyStore, type HistoryEntry } from '../lib/historyStore';
import { formatRelativeTime, formatBytes } from '../lib/formatters';

const typeIcon: Record<string, React.ReactNode> = {
  tabular: <Table size={14} />,
  relational: <Database size={14} />,
  invoice: <Receipt size={14} />,
  bank_statement: <Landmark size={14} />,
};

/** A dataset = one configuration + seed; it may have been generated several times. */
export function Datasets() {
  const router = useRouter();
  const toast = useToast();
  const entries = historyStore.use();
  const [deleteTarget, setDeleteTarget] = useState<HistoryEntry | null>(null);

  const datasets = useMemo(() => {
    const groups = new Map<string, { latest: HistoryEntry; runs: number }>();
    for (const e of entries) {
      const g = groups.get(e.fingerprint);
      if (!g) groups.set(e.fingerprint, { latest: e, runs: 1 });
      else g.runs++;
    }
    return [...groups.values()];
  }, [entries]);

  const handleDelete = () => {
    if (!deleteTarget) return;
    historyStore.set(list => list.filter(e => e.fingerprint !== deleteTarget.fingerprint));
    toast.success(`Deleted "${deleteTarget.name}" and its runs`);
    setDeleteTarget(null);
  };

  if (!datasets.length) {
    return (
      <div className="p-8">
        <EmptyState
          icon={<FolderOpen size={32} />}
          title="No datasets yet"
          description="Every dataset you generate is saved here (configuration and seed), ready to regenerate and export."
          action={{ label: 'Create Dataset', onClick: () => router.push('/workspace') }}
        />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-[1200px] mx-auto">
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Dataset"
        message={`Remove "${deleteTarget?.name}" and all its history runs from this browser? This cannot be undone.`}
        confirmLabel="Delete Dataset"
        danger
      />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-1">Datasets</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">{datasets.length} dataset{datasets.length === 1 ? '' : 's'} saved in this browser. Regenerate rebuilds the exact same data.</p>
        </div>
        <button
          onClick={() => router.push('/workspace')}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--color-primary)] text-white text-sm font-medium rounded-[var(--radius-md)] hover:bg-[var(--color-primary-hover)] transition-colors"
        >
          + New Dataset
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {datasets.map(({ latest: ds, runs }) => (
          <div key={ds.fingerprint} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5 hover:border-[var(--color-primary)]/40 transition-all">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1.5 bg-[var(--color-primary-light)] rounded text-[var(--color-primary)]">{typeIcon[ds.type]}</div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{ds.name}</p>
                  <p className="text-xs text-[var(--color-text-muted)] capitalize">{ds.type.replace('_', ' ')}{ds.sourceName ? ` · from ${ds.sourceName}` : ''}</p>
                </div>
              </div>
              <Badge variant={ds.validation === 'passed' ? 'success' : ds.validation === 'warning' ? 'warning' : 'error'}>{ds.validation}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
              <div>
                <p className="text-[var(--color-text-muted)]">Rows</p>
                <p className="font-mono font-semibold text-[var(--color-text-primary)]">{ds.rowCount.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[var(--color-text-muted)]">{ds.tableCount ? 'Tables' : 'Columns'}</p>
                <p className="font-mono font-semibold text-[var(--color-text-primary)]">{ds.tableCount ?? ds.columnCount ?? '—'}</p>
              </div>
              <div>
                <p className="text-[var(--color-text-muted)]">Size (CSV)</p>
                <p className="font-mono font-semibold text-[var(--color-text-primary)]">{formatBytes(ds.sizeBytes / (1024 * 1024))}</p>
              </div>
              <div>
                <p className="text-[var(--color-text-muted)]">Last generated</p>
                <p className="text-[var(--color-text-secondary)]">{formatRelativeTime(ds.createdAt)}{runs > 1 ? ` · ${runs} runs` : ''}</p>
              </div>
            </div>
            <div className="flex gap-2 border-t border-[var(--color-border)] pt-3">
              <button
                onClick={() => router.push(`/workspace?regenerate=${ds.id}`)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-[var(--color-primary)] border border-[var(--color-primary)]/30 rounded-[var(--radius-md)] hover:bg-[var(--color-primary-light)] transition-colors"
              >
                <Play size={11} /> Regenerate
              </button>
              <button
                onClick={() => router.push(`/workspace?regenerate=${ds.id}&tab=export`)}
                title="Regenerate and export"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--color-text-secondary)] border border-[var(--color-border)] rounded-[var(--radius-md)] hover:bg-[var(--color-surface-2)] transition-colors"
              >
                <Download size={11} />
              </button>
              <button
                onClick={() => setDeleteTarget(ds)}
                title="Delete"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--color-text-muted)] border border-[var(--color-border)] rounded-[var(--radius-md)] hover:bg-[var(--color-error-bg)] hover:text-[var(--color-error)] hover:border-[var(--color-error)]/30 transition-colors"
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
