'use client';

import React, { useEffect, useState } from 'react';
import { Search, Eye } from 'lucide-react';
import { EmptyState } from '../../components/common/EmptyState';
import type { PreviewPage, TabularResult } from '../../lib/types';
import { tabularEngine } from '../../lib/engine/client';

const PAGE_SIZE = 10;

export function PreviewTab({ result }: { result: TabularResult | null }) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PreviewPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!result) return;
    let active = true;
    setLoading(true);
    tabularEngine.query(result.jobId, debounced, page, PAGE_SIZE, result.tableName)
      .then(p => { if (active) { setData(p); setError(null); } })
      .catch(err => { if (active) setError((err as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [result, debounced, page]);

  if (!result) {
    return <EmptyState icon={<Eye size={32} />} title="Preview not available" description="Row preview is available for tabular generation." />;
  }
  if (error) {
    return <EmptyState icon={<Eye size={32} />} title="Preview unavailable" description={error} />;
  }

  const columns = data?.columns ?? result.syntheticProfile.columns.map(c => c.name);
  const matched = data?.matched ?? result.rowCount;
  const pages = Math.max(1, Math.ceil(matched / PAGE_SIZE));
  const first = matched ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(matched, page * PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            aria-label="Search generated rows"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search all ${result.rowCount.toLocaleString()} generated rows...`}
            className="w-full pl-8 pr-3 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm bg-transparent text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
          />
        </div>
      </div>
      <div className={`overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] transition-opacity ${loading ? 'opacity-60' : ''}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--color-surface-2)] text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
              {columns.map(col => (
                <th key={col} scope="col" className="text-left px-4 py-3 font-medium whitespace-nowrap">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row, i) => (
              <tr key={i} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)] transition-colors">
                {columns.map(col => {
                  const v = row[col];
                  const text = v === null || v === undefined ? '—' : String(v);
                  return (
                    <td key={col} className="px-4 py-3 whitespace-nowrap max-w-xs">
                      <span
                        title={text.length > 60 ? `${text.length.toLocaleString()} characters` : undefined}
                        className={`block truncate font-mono text-xs ${v === null ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-secondary)]'}`}
                      >
                        {text}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
            {data && !data.rows.length && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-xs text-[var(--color-text-muted)]">No rows match “{debounced}”.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-[var(--color-text-muted)]">
        <span>
          {matched ? `Rows ${first.toLocaleString()}–${last.toLocaleString()} of ${matched.toLocaleString()}` : '0 rows'}
          {debounced && ` matching “${debounced}” (${result.rowCount.toLocaleString()} total)`}
        </span>
        <div className="flex gap-1" role="navigation" aria-label="Preview pages">
          <button aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-2 py-1 border border-[var(--color-border)] rounded disabled:opacity-40 hover:bg-[var(--color-surface-2)] transition-colors">‹</button>
          <span className="px-2 py-1" aria-live="polite">{page} / {pages.toLocaleString()}</span>
          <button aria-label="Next page" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="px-2 py-1 border border-[var(--color-border)] rounded disabled:opacity-40 hover:bg-[var(--color-surface-2)] transition-colors">›</button>
        </div>
      </div>
    </div>
  );
}
