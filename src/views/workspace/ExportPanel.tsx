'use client';

import React, { useEffect, useState } from 'react';
import { Download, CheckCircle } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { useToast } from '../../components/common/Toast';
import type { DocumentResult, Generation, RelationalResult, TabularResult } from '../../lib/types';
import { tabularEngine } from '../../lib/engine/client';
import { exportFileName } from '../../lib/engine/export';
import { downloadBlob, invoicesCsv, invoicesPdf, jsonBlob, markSynthetic, statementsCsv, statementsPdf } from '../../lib/engine/exportDocuments';
import type { ExportFormat } from '../../lib/engine/protocol';

type Format = ExportFormat | 'pdf';

const LABELS: Record<Format, string> = {
  csv: 'CSV',
  json: 'JSON',
  zip: 'ZIP — one CSV per table',
  sql: 'SQL — CREATE TABLE + INSERT',
  pdf: 'PDF',
};

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function ExportPanel({ gen, result, relational, documents }: {
  gen: Generation;
  result?: TabularResult | null;
  relational?: RelationalResult | null;
  documents?: DocumentResult | null;
}) {
  const formats: Format[] = documents ? ['pdf', 'csv', 'json'] : relational ? ['zip', 'json', 'sql'] : ['csv', 'json'];
  const [format, setFormat] = useState<Format>(formats[0]);
  const [state, setState] = useState<'idle' | 'preparing' | 'ready' | 'error'>('idle');
  const [file, setFile] = useState<{ name: string; size: number; url: string; blob: Blob } | null>(null);
  const [error, setError] = useState('');
  const toast = useToast();

  // Free the previous file's memory when it is replaced or the panel closes.
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);

  const build = async (): Promise<{ blob: Blob; ext: string }> => {
    if (documents) {
      const inv = documents.invoices, st = documents.statements ?? [];
      if (format === 'pdf') return { blob: inv ? await invoicesPdf(inv) : await statementsPdf(st), ext: 'pdf' };
      if (format === 'csv') return { blob: inv ? invoicesCsv(inv) : statementsCsv(st), ext: 'csv' };
      return { blob: jsonBlob(inv ? markSynthetic(inv) : markSynthetic(st)), ext: 'json' };
    }
    const jobId = relational?.jobId ?? result?.jobId;
    if (!jobId) throw new Error('Nothing to export.');
    return tabularEngine.exportData(jobId, format as ExportFormat);
  };

  const handleExport = async () => {
    setState('preparing');
    setError('');
    try {
      const { blob, ext } = await build();
      const name = exportFileName(gen.name, gen.createdAt, ext);
      const url = downloadBlob(blob, name);
      setFile({ name, size: blob.size, url, blob });
      setState('ready');
      toast.success(`Downloaded ${name} (${formatSize(blob.size)})`);
    } catch (err) {
      setState('error');
      setError((err as Error).message || 'Export failed.');
    }
  };

  const rows = documents
    ? documents.invoices ? `${documents.invoices.length.toLocaleString()} invoices` : `${documents.statements?.length.toLocaleString()} statements · ${documents.rowCount.toLocaleString()} transactions`
    : relational ? `${relational.tables.length} tables · ${relational.rowCount.toLocaleString()} rows` : `${gen.rowCount.toLocaleString()} rows`;

  return (
    <div className="max-w-md space-y-4">
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">Export Dataset</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-[var(--color-text-secondary)] block mb-1.5">Format</label>
            <select aria-label="Format" value={format} onChange={e => { setFormat(e.target.value as Format); setState('idle'); }}
              className="w-full px-3 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none">
              {formats.map(f => <option key={f} value={f}>{LABELS[f]}</option>)}
            </select>
          </div>
          <div className="text-xs text-[var(--color-text-muted)] bg-[var(--color-surface-2)] rounded p-3 space-y-0.5">
            <p><strong className="text-[var(--color-text-secondary)]">{rows}</strong> · {LABELS[format]}</p>
            <p className="font-mono">{exportFileName(gen.name, gen.createdAt, format)}</p>
            {format === 'csv' && !documents && <p>UTF-8 with BOM and CRLF line endings, so Excel opens it correctly.</p>}
          </div>
        </div>
        {(state === 'idle' || state === 'error') && (
          <Button className="w-full mt-4" icon={<Download size={15} />} onClick={handleExport}>Export {format.toUpperCase()}</Button>
        )}
        {state === 'preparing' && (
          <div className="mt-4 text-sm text-[var(--color-text-secondary)] flex items-center gap-2">
            <div className="w-3.5 h-3.5 border-2 border-[var(--color-primary)] border-t-transparent rounded-full spinning" />
            Building {format.toUpperCase()} file...
          </div>
        )}
        {state === 'ready' && file && (
          <div className="mt-4 space-y-2">
            <p className="flex items-center gap-1.5 text-sm text-[var(--color-success)]">
              <CheckCircle size={14} /> {file.name} · {formatSize(file.size)}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" icon={<Download size={13} />} onClick={() => downloadBlob(file.blob, file.name, file.url)}>Download again</Button>
              <Button variant="outline" size="sm" onClick={() => setState('idle')}>Export another format</Button>
            </div>
          </div>
        )}
        {state === 'error' && <p className="text-sm text-[var(--color-error)] mt-3">{error}</p>}
      </div>
    </div>
  );
}
