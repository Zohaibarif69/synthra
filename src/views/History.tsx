'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Trash2, Play, Pencil, Check, X, Table, Database, Receipt, Landmark, History as HistoryIcon } from 'lucide-react';
import { Badge } from '../components/common/Badge';
import { ConfirmModal } from '../components/common/Modal';
import { EmptyState } from '../components/common/EmptyState';
import { useToast } from '../components/common/Toast';
import { historyStore, removeHistory, renameHistory } from '../lib/historyStore';
import { formatRelativeTime, formatBytes } from '../lib/formatters';

const typeIcon: Record<string, React.ReactNode> = {
  tabular: <Table size={14} />,
  relational: <Database size={14} />,
  invoice: <Receipt size={14} />,
  bank_statement: <Landmark size={14} />,
};

const validationVariant = { passed: 'success', warning: 'warning', failed: 'error' } as const;

export function History() {
  const router = useRouter();
  const toast = useToast();
  const entries = historyStore.use();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const handleDelete = () => {
    if (!deleteTarget) return;
    const name = entries.find(e => e.id === deleteTarget)?.name;
    removeHistory(deleteTarget);
    setDeleteTarget(null);
    toast.success(`Removed "${name}" from history`);
  };

  const saveRename = () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (name) renameHistory(editing.id, name);
    setEditing(null);
  };

  return (
    <div className="p-6 lg:p-8 max-w-[1200px] mx-auto">
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete History Entry"
        message="This removes the saved configuration and seed from this browser. It cannot be undone, and the dataset can no longer be regenerated from History."
        confirmLabel="Delete"
        danger
      />

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-1">Generation History</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Every completed generation, saved in this browser with its configuration and seed (not the rows). Regenerate reproduces the same data.
        </p>
      </div>

      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] overflow-hidden">
        {entries.length === 0 ? (
          <EmptyState
            icon={<HistoryIcon size={32} />}
            title="No generations yet"
            description="Completed generations appear here automatically."
            action={{ label: 'Create Dataset', onClick: () => router.push('/workspace') }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--color-surface-2)] text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                  <th className="text-left px-5 py-3 font-medium">Name</th>
                  <th className="text-left px-3 py-3 font-medium">Type</th>
                  <th className="text-left px-3 py-3 font-medium">Rows</th>
                  <th className="text-left px-3 py-3 font-medium hidden md:table-cell">Size</th>
                  <th className="text-left px-3 py-3 font-medium hidden lg:table-cell">Seed</th>
                  <th className="text-left px-3 py-3 font-medium">Created</th>
                  <th className="text-left px-3 py-3 font-medium">Validation</th>
                  <th className="text-left px-3 py-3 font-medium hidden md:table-cell">Quality</th>
                  <th className="text-left px-3 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)] transition-colors">
                    <td className="px-5 py-3">
                      {editing?.id === e.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            aria-label="New name"
                            autoFocus
                            value={editing.name}
                            onChange={ev => setEditing({ id: e.id, name: ev.target.value })}
                            onKeyDown={ev => { if (ev.key === 'Enter') saveRename(); if (ev.key === 'Escape') setEditing(null); }}
                            className="px-2 py-1 text-sm border border-[var(--color-primary)] rounded bg-transparent text-[var(--color-text-primary)] outline-none"
                          />
                          <button onClick={saveRename} className="p-1 text-[var(--color-success)]" aria-label="Save name"><Check size={14} /></button>
                          <button onClick={() => setEditing(null)} className="p-1 text-[var(--color-text-muted)]" aria-label="Cancel"><X size={14} /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-[var(--color-text-muted)]">{typeIcon[e.type]}</span>
                          <span className="font-medium text-[var(--color-text-primary)]">{e.name}</span>
                          {e.regeneratedFrom && <Badge variant="muted">regenerated</Badge>}
                          {!e.reproducible && <Badge variant="warning">approximate</Badge>}
                          <button onClick={() => setEditing({ id: e.id, name: e.name })} className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]" aria-label="Rename">
                            <Pencil size={12} />
                          </button>
                        </div>
                      )}
                      {e.sourceName && <p className="text-xs text-[var(--color-text-muted)] ml-6">from {e.sourceName}</p>}
                    </td>
                    <td className="px-3 py-3"><span className="text-xs text-[var(--color-text-secondary)] capitalize">{e.type.replace('_', ' ')}</span></td>
                    <td className="px-3 py-3"><span className="text-sm font-mono text-[var(--color-text-secondary)]">{e.rowCount.toLocaleString()}</span></td>
                    <td className="px-3 py-3 hidden md:table-cell"><span className="text-xs text-[var(--color-text-muted)]">{formatBytes(e.sizeBytes / (1024 * 1024))}</span></td>
                    <td className="px-3 py-3 hidden lg:table-cell"><span className="text-xs font-mono text-[var(--color-text-muted)]">{e.seed}</span></td>
                    <td className="px-3 py-3"><span className="text-xs text-[var(--color-text-muted)]" title={new Date(e.createdAt).toLocaleString()}>{formatRelativeTime(e.createdAt)}</span></td>
                    <td className="px-3 py-3"><Badge variant={validationVariant[e.validation]}>{e.validation}</Badge></td>
                    <td className="px-3 py-3 hidden md:table-cell"><span className="text-xs font-mono text-[var(--color-text-secondary)]">{e.qualityScore === null ? 'N/A' : e.qualityScore.toFixed(1)}</span></td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => router.push(`/workspace?regenerate=${e.id}`)} title="Regenerate (same seed & config)"
                          className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--color-surface-2)] rounded transition-colors">
                          <Play size={14} />
                        </button>
                        <button onClick={() => router.push(`/workspace?regenerate=${e.id}&tab=export`)} title="Regenerate and open Export"
                          className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] rounded transition-colors">
                          <Download size={14} />
                        </button>
                        <button onClick={() => setDeleteTarget(e.id)} title="Delete"
                          className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-error-bg)] rounded transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {entries.some(e => !e.reproducible) && (
        <p className="text-xs text-[var(--color-text-muted)] mt-3">
          “approximate”: the learned statistics were too large for browser storage, so Regenerate uses defaults for those columns.
        </p>
      )}
      {entries.length > 0 && <p className="text-xs text-[var(--color-text-muted)] mt-2">Only completed runs are saved; failed or cancelled runs are not.</p>}
    </div>
  );
}
