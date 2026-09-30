'use client';

import React, { useState } from 'react';
import { ChevronRight, Pencil } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { useToast } from '../../components/common/Toast';
import type { ColumnSchema, DatasetProfile, SchemaAnalysis, UploadResult } from '../../lib/types';
import { analyzeSchema } from '../../lib/api';
import { FileUploadArea } from './FileUploadArea';
import { SchemaTable } from './SchemaTable';
import { ManualSchemaBuilder } from './ManualSchemaBuilder';
import { AIAnalysisPanel } from './AIAnalysisPanel';
import { AiSchemaReview, type AiSchemaState } from './AiSchemaReview';
import { DescribeSchemaBox, type DescribedSchema } from './DescribeSchemaBox';
import type { AiColumnSuggestion } from '../../lib/types';

function schemaProblem(schema: ColumnSchema[]): string | null {
  if (!schema.length) return null;
  const names = schema.map(c => c.name.trim());
  if (names.some(n => !n)) return 'Every column needs a name.';
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) return `Column names must be unique ("${dup}" appears more than once).`;
  return null;
}

export function StepInputTabular({
  upload, schema, profile, onAnalyzed, onSchemaChange, onClear, onNext, library, aiSchema, onAiChoose, onAiRetry, onDescribed,
}: {
  onAiRetry?: () => void;
  aiSchema?: AiSchemaState;
  onAiChoose?: (column: string, choice: 'ai' | 'rules', ai: AiColumnSuggestion) => void;
  /** A schema built from a plain-English description (AI or rule-based). */
  onDescribed?: (r: DescribedSchema) => void;
  upload: UploadResult | null;
  schema: ColumnSchema[];
  profile: DatasetProfile | null;
  onAnalyzed: (upload: UploadResult, analysis: SchemaAnalysis) => void;
  onSchemaChange: (schema: ColumnSchema[]) => void;
  onClear: () => void;
  onNext: () => void;
  /** Save/load schema controls. */
  library?: React.ReactNode;
}) {
  const [inputMode, setInputMode] = useState<'upload' | 'manual'>(upload || !schema.length ? 'upload' : 'manual');
  const [analyzing, setAnalyzing] = useState(false);
  const toast = useToast();

  const handleUploaded = async (result: UploadResult) => {
    setAnalyzing(true);
    try {
      const analysis = await analyzeSchema(result.fileId);
      onAnalyzed(result, analysis);
    } catch (err) {
      toast.error((err as Error).message || 'Schema analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const problem = schemaProblem(schema);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">Upload your dataset</h2>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">Upload a CSV or JSON file, or define a schema manually.</p>
        {library && <div className="mb-4">{library}</div>}
        {onDescribed && !upload && (
          <div className="mb-4 max-w-3xl">
            <DescribeSchemaBox onResult={r => { onDescribed(r); setInputMode('manual'); }} />
          </div>
        )}
        <div className="flex gap-2 mb-4">
          {(['upload', 'manual'] as const).map(m => (
            <button
              key={m}
              onClick={() => setInputMode(m)}
              className={`px-3 py-1.5 text-sm rounded-[var(--radius-md)] border transition-colors ${inputMode === m ? 'bg-[var(--color-primary-light)] border-[var(--color-primary)] text-[var(--color-primary)] font-medium' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'}`}
            >
              {m === 'upload' ? 'Upload File' : upload ? 'Edit Schema' : 'Define Manually'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {inputMode === 'upload' ? (
            <>
              <FileUploadArea current={upload} onUploaded={handleUploaded} onRemove={onClear} />
              {!analyzing && upload && schema.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Detected Schema</h3>
                    <button
                      onClick={() => setInputMode('manual')}
                      className="flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline"
                    >
                      <Pencil size={12} /> Edit schema
                    </button>
                  </div>
                  <SchemaTable columns={schema} />
                </div>
              )}
              {!analyzing && upload && aiSchema && onAiChoose && (
                <AiSchemaReview schema={schema} state={aiSchema} onChoose={onAiChoose} onRetry={onAiRetry} />
              )}
            </>
          ) : (
            <>
              {upload && (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Editing the schema detected from <span className="font-mono">{upload.fileName}</span>. Learned distributions stay linked to renamed columns.
                </p>
              )}
              <ManualSchemaBuilder schema={schema} onChange={onSchemaChange} />
            </>
          )}
          {problem && <p className="text-xs text-[var(--color-error)]">{problem}</p>}
        </div>
        <div>
          <AIAnalysisPanel analyzing={analyzing} schema={schema} profile={profile} rowCount={upload?.rowCount} />
        </div>
      </div>

      <Button
        onClick={onNext}
        disabled={analyzing || schema.length === 0 || !!problem}
        iconRight={<ChevronRight size={15} />}
      >
        Continue to Configuration
      </Button>
    </div>
  );
}
