'use client';

import React, { useState } from 'react';
import { CheckCircle, Download, Eye, BarChart2, Shield, Database } from 'lucide-react';
import type { DocumentResult, Generation, RelationalResult, TabularResult } from '../../lib/types';
import { EmptyState } from '../../components/common/EmptyState';
import { InvoicePreview } from './InvoicePreview';
import { BankStatementPreview } from './BankStatementPreview';
import { DocumentStatsTab } from './DocumentStatsTab';
import { PreviewTab } from './PreviewTab';
import { StatisticsTab } from './StatisticsTab';
import { ValidationTab } from './ValidationTab';
import { PrivacyTab } from './PrivacyTab';
import { ExportPanel } from './ExportPanel';

export function ResultTabs({ gen, result, relational, documents, initialTab, tab: controlledTab, onTabChange }: {
  gen: Generation;
  result: TabularResult | null;
  relational?: RelationalResult | null;
  documents?: DocumentResult | null;
  initialTab?: string;
  /** When given, the parent owns the active tab (the Workspace links it to the stepper). */
  tab?: string;
  onTabChange?: (tab: string) => void;
}) {
  const [ownTab, setOwnTab] = useState(initialTab ?? 'preview');
  const tab = controlledTab ?? ownTab;
  const setTab = (t: string) => { setOwnTab(t); onTabChange?.(t); };
  const [tableIndex, setTableIndex] = useState(0);
  const tabs = [
    { id: 'preview', label: 'Preview', icon: <Eye size={14} /> },
    { id: 'statistics', label: 'Statistics', icon: <BarChart2 size={14} /> },
    { id: 'validation', label: 'Validation', icon: <CheckCircle size={14} /> },
    { id: 'privacy', label: 'Privacy', icon: <Shield size={14} /> },
    { id: 'export', label: 'Export', icon: <Download size={14} /> },
  ];
  const active = relational ? relational.tables[Math.min(tableIndex, relational.tables.length - 1)] ?? null : result;

  return (
    <div className="flex-1 flex flex-col">
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-0" role="tablist" aria-label="Result views">
          {tabs.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              aria-label={t.label}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {t.icon}
              <span className="hidden sm:block">{t.label}</span>
            </button>
          ))}
        </div>
        {relational && (
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] py-2">
            <Database size={13} className="text-[var(--color-primary)]" /> Table
            <select
              value={tableIndex}
              onChange={e => setTableIndex(Number(e.target.value))}
              className="px-2 py-1.5 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none"
            >
              {relational.tables.map((t, i) => <option key={t.tableName} value={i}>{t.tableName} ({t.rowCount.toLocaleString()} rows)</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="flex-1 p-6 overflow-auto">
        {documents ? (
          <>
            {tab === 'preview' && (documents.invoices
              ? <InvoicePreview invoices={documents.invoices} />
              : <BankStatementPreview statements={documents.statements ?? []} />)}
            {tab === 'statistics' && <DocumentStatsTab result={documents} />}
            {tab === 'validation' && <ValidationTab result={null} documents={documents} />}
            {tab === 'privacy' && (
              <EmptyState icon={<Shield size={32} />} title="No source data" description="Documents are generated from scratch, so no uploaded values need protecting." />
            )}
          </>
        ) : (
          <>
            {tab === 'preview' && <PreviewTab key={active?.tableName ?? 'dataset'} result={active} />}
            {tab === 'statistics' && <StatisticsTab key={active?.tableName ?? 'dataset'} result={active} />}
            {tab === 'validation' && <ValidationTab result={active} relational={relational ?? null} />}
            {tab === 'privacy' && <PrivacyTab result={active} />}
          </>
        )}
        {tab === 'export' && <ExportPanel gen={gen} result={result} relational={relational} documents={documents} />}
      </div>
    </div>
  );
}
