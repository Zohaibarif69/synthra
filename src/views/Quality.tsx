'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileText, Gauge, Sparkles } from 'lucide-react';
import { exportFileName } from '../lib/engine/export';
import { downloadBlob, qualityReportPdf } from '../lib/engine/exportDocuments';
import { Button } from '../components/common/Button';
import { EmptyState } from '../components/common/EmptyState';
import { useToast } from '../components/common/Toast';
import { latestTstrResult, resultTables, useLatestResult } from '../lib/resultStore';
import { computeQuality, mergeRelationalMetrics } from '../lib/engine/quality';
import { formatRelativeTime } from '../lib/formatters';
import { ScoreSummaryCard } from './quality/ScoreSummaryCard';
import { DimensionBars } from './quality/DimensionBars';
import { QualityRadar } from './quality/QualityRadar';
import { ColumnComparison } from './quality/ColumnComparison';
import { WarningsList } from './quality/WarningsList';
import { ColumnQualityTable } from './quality/ColumnQualityTable';
import { ExplainPanel } from './quality/ExplainPanel';
import { UtilityPanel } from './quality/UtilityPanel';

export function Quality() {
  const router = useRouter();
  const toast = useToast();
  const latest = useLatestResult();
  const [tableIndex, setTableIndex] = useState(0);
  const [pdfBusy, setPdfBusy] = useState(false);

  const report = useMemo(() => {
    if (!latest) return null;
    if (latest.documents) return computeQuality({ metrics: latest.documents.validation.metrics, rowCount: latest.documents.rowCount });
    if (latest.relational) return computeQuality({ metrics: mergeRelationalMetrics(latest.relational), rowCount: latest.relational.rowCount });
    return latest.result ? computeQuality(latest.result) : null;
  }, [latest]);

  if (!latest || !report) {
    return (
      <div className="p-8">
        <EmptyState
          icon={<Gauge size={32} />}
          title="No generated data yet"
          description="Generate a dataset to see its quality report."
          action={{ label: 'Generate Data', onClick: () => router.push('/workspace') }}
        />
      </div>
    );
  }

  const { generation, sourceName, relational, documents } = latest;
  const tables = resultTables(latest);
  const selected = tables.length ? tables[Math.min(tableIndex, tables.length - 1)] : null;
  const rowCount = documents?.rowCount ?? relational?.rowCount ?? selected?.rowCount ?? 0;
  const seed = documents?.seed ?? relational?.seed ?? selected?.seed ?? 0;

  const exportReport = () => {
    const payload = {
      report: 'Synthra Quality Report',
      exportedAt: new Date().toISOString(),
      dataset: {
        name: generation.name,
        type: generation.type,
        source: sourceName ?? null,
        rows: rowCount,
        tables: tables.map(t => ({ name: t.tableName ?? 'dataset', rows: t.rowCount, columns: t.columnCount })),
        seed,
        generationTimeMs: generation.generationTimeMs ?? null,
        config: generation.config ?? null,
      },
      overallScore: report.overall,
      mlUtility: latestTstrResult() ?? null,
      dimensions: report.dimensions,
      warnings: report.warnings,
      columns: report.columns,
      validation: {
        ...(relational ? { relational: relational.relationalValidation } : {}),
        ...(documents ? { documents: documents.validation } : {}),
        tables: tables.map(t => ({ table: t.tableName ?? 'dataset', overall: t.validation.overall, checks: t.validation.checks, notes: t.validation.notes ?? [], metrics: t.validation.metrics ?? null })),
      },
      ...(relational ? { relationships: relational.relationships, rules: relational.rules } : {}),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const name = exportFileName(`quality-report ${generation.name} seed${seed}`, generation.createdAt, 'json');
    const url = downloadBlob(blob, name);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    toast.success(`Downloaded ${name} (${(blob.size / 1024).toFixed(1)} KB)`);
  };

  const exportPdf = async () => {
    setPdfBusy(true);
    try {
      const blob = await qualityReportPdf(report, {
        title: `${generation.name} · ${rowCount.toLocaleString()} rows · seed ${seed}`,
        subtitle: `Generated ${new Date(generation.createdAt).toLocaleString()}${sourceName ? ` · compared with ${sourceName}` : ''}`,
      });
      const name = exportFileName(`quality-report ${generation.name} seed${seed}`, generation.createdAt, 'pdf');
      const url = downloadBlob(blob, name);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success(`Downloaded ${name} (${(blob.size / 1024).toFixed(1)} KB)`);
    } catch (err) {
      toast.error(`PDF export failed: ${(err as Error).message}`);
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-1">Quality Observatory</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {generation.name} · {relational ? `${tables.length} tables · ` : ''}{rowCount.toLocaleString()} rows · seed {seed}
            {documents ? '' : sourceName ? ` · compared with ${sourceName}` : ' · no source file (fidelity and correlation are N/A)'}
            {' · '}generated {formatRelativeTime(generation.createdAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" icon={<Sparkles size={14} />} onClick={() => router.push('/workspace')}>New Generation</Button>
          <Button variant="outline" icon={<FileText size={14} />} loading={pdfBusy} onClick={exportPdf}>Export PDF</Button>
          <Button icon={<Download size={14} />} onClick={exportReport}>Export quality report (JSON)</Button>
        </div>
      </div>

      <ScoreSummaryCard overall={report.overall} dimensions={report.dimensions} />

      <ExplainPanel report={report} datasetName={generation.name} config={generation.config} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DimensionBars dimensions={report.dimensions} />
        <QualityRadar dimensions={report.dimensions} />
      </div>

      {latest.result && <UtilityPanel key={generation.id} result={latest.result} source={latest.tstrSource} />}

      {selected && <div className="space-y-2">
        {tables.length > 1 && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">Table</label>
            <select aria-label="Table"
              value={tableIndex}
              onChange={e => setTableIndex(Number(e.target.value))}
              className="px-3 py-1.5 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none"
            >
              {tables.map((t, i) => <option key={t.tableName} value={i}>{t.tableName} ({t.rowCount.toLocaleString()} rows)</option>)}
            </select>
          </div>
        )}
        <ColumnComparison key={selected.tableName ?? 'dataset'} result={selected} />
      </div>}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <WarningsList warnings={report.warnings} />
        <ColumnQualityTable columns={report.columns} />
      </div>
    </div>
  );
}
