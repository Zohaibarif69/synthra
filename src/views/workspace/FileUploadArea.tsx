'use client';

import React, { useState, useRef } from 'react';
import { Upload, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { Progress } from '../../components/common/Progress';
import { useToast } from '../../components/common/Toast';
import type { UploadResult } from '../../lib/types';
import { uploadDataset } from '../../lib/api';
import { formatBytes } from '../../lib/formatters';

type UploadState = 'idle' | 'drag' | 'reading' | 'error';

export function FileUploadArea({ current, onUploaded, onRemove }: {
  current: UploadResult | null;
  onUploaded: (result: UploadResult) => void;
  onRemove: () => void;
}) {
  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState<number | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function handleFile(file: File) {
    setFileName(file.name);
    setError('');
    setProgress(null);
    setState('reading');
    try {
      const result = await uploadDataset(file, f => setProgress(f * 100));
      setState('idle');
      onUploaded(result);
      toast.success(`Read ${result.rowCount.toLocaleString()} rows × ${result.columnCount} columns from ${file.name}`);
    } catch (err) {
      setState('error');
      setError((err as Error).message || 'Unable to read this file.');
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setState('idle');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".csv,.tsv,.txt,.json,.jsonl,.ndjson"
      className="hidden"
      onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); e.target.value = ''; }}
    />
  );

  if (current && state !== 'reading' && state !== 'error') {
    return (
      <div className="border border-[var(--color-success)]/40 bg-[var(--color-success-bg)] rounded-[var(--radius-lg)] p-4">
        {fileInput}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-[var(--color-success)] shrink-0" />
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">{current.fileName}</p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                {formatBytes(current.fileSizeMb)} · {current.columnCount} columns · {current.rowCount.toLocaleString()} rows
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => inputRef.current?.click()} className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] underline">Replace</button>
            <button onClick={onRemove} className="text-xs text-[var(--color-error)] hover:underline">Remove</button>
          </div>
        </div>
        {current.warnings?.map(w => (
          <p key={w} className="flex items-start gap-1.5 text-xs text-[var(--color-warning)] mt-2">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {w}
          </p>
        ))}
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="border border-[var(--color-error)]/40 bg-[var(--color-error-bg)] rounded-[var(--radius-lg)] p-6 text-center">
        <XCircle size={24} className="text-[var(--color-error)] mx-auto mb-2" />
        <p className="text-sm font-medium text-[var(--color-text-primary)] mb-1">Unable to process this file.</p>
        <p className="text-xs text-[var(--color-text-secondary)] mb-3">{error}</p>
        <Button variant="outline" size="sm" onClick={() => setState('idle')}>Try Again</Button>
      </div>
    );
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); if (state !== 'reading') setState('drag'); }}
      onDragLeave={() => { if (state === 'drag') setState('idle'); }}
      onDrop={onDrop}
      onClick={() => state === 'idle' && inputRef.current?.click()}
      className={`border-2 border-dashed rounded-[var(--radius-lg)] p-8 text-center cursor-pointer transition-all ${
        state === 'drag' ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]' : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-surface-2)]'
      }`}
    >
      {fileInput}
      {state === 'reading' && (
        <div>
          <Upload size={24} className="mx-auto mb-3 text-[var(--color-primary)]" />
          <p className="text-sm text-[var(--color-text-secondary)] mb-3">Reading {fileName}...</p>
          <Progress value={progress ?? undefined} indeterminate={progress === null} className="max-w-xs mx-auto" />
        </div>
      )}
      {(state === 'idle' || state === 'drag') && (
        <div>
          <Upload size={24} className={`mx-auto mb-3 ${state === 'drag' ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'}`} />
          <p className="text-sm font-medium text-[var(--color-text-primary)] mb-1">Upload your dataset</p>
          <p className="text-xs text-[var(--color-text-secondary)] mb-3">Drag & drop your file here, or</p>
          <Button variant="outline" size="sm" onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}>Browse Files</Button>
          <p className="text-xs text-[var(--color-text-muted)] mt-3">CSV, JSON · Max 50 MB · Processed in your browser</p>
        </div>
      )}
    </div>
  );
}
