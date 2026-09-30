'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ConfirmModal } from '../components/common/Modal';
import { useToast } from '../components/common/Toast';
import type {
  DataType, GenerationConfig, ColumnSchema, TableSchema, Generation, DatasetProfile, UploadResult,
  SchemaAnalysis, TabularResult, RelationalResult, DocumentResult, ValidationStatus, AiColumnSuggestion, AiSchemaResult,
} from '../lib/types';
import { EXAMPLE_RELATIONAL } from '../lib/mockData';
import { STEPS } from '../lib/constants';
import { generateSeed } from '../lib/engine/random';
import { estimateRowCounts } from '../lib/engine/relational';
import { allowedTransforms } from '../lib/engine/privacy';
import { computeQuality, mergeRelationalMetrics } from '../lib/engine/quality';
import type { EngineJob } from '../lib/engine/client';
import { setLatestResult } from '../lib/resultStore';
import { useRelationalDesign, type RelationalDesign } from '../lib/designStore';
import { addHistory, getHistoryEntry, type HistoryEntry, type StoredJob } from '../lib/historyStore';
import { getSettings } from '../lib/settingsStore';
import type { SavedSchema } from '../lib/schemaLibrary';
import { Stepper } from './workspace/Stepper';
import { StepSelectType } from './workspace/StepSelectType';
import { StepInputTabular } from './workspace/StepInputTabular';
import { StepRelational } from './workspace/StepRelational';
import { StepDocuments, type DocumentRequest } from './workspace/StepDocuments';
import { ConfigurationPanel } from './workspace/ConfigurationPanel';
import { GenerationProgress } from './workspace/GenerationProgress';
import { ResultHeader } from './workspace/ResultHeader';
import { ResultTabs } from './workspace/ResultTabs';
import { SchemaLibraryBar } from './workspace/SchemaLibraryBar';
import { LivePreview } from './workspace/LivePreview';
import { AI_SCHEMA_IDLE, type AiSchemaState } from './workspace/AiSchemaReview';
import type { DescribedSchema } from './workspace/DescribeSchemaBox';
import { aiPost, fetchAiStatus, schemaRequestTable } from '../lib/ai/client';
import { getDataset } from '../lib/engine/store';
import { region } from '../lib/engine/regions';

/** Starting configuration, from Settings. */
function defaultConfig(): GenerationConfig {
  const s = getSettings();
  return {
    rowCount: s.defaultRowCount,
    nullRate: s.defaultNullRate / 100,
    outlierRate: s.defaultOutlierRate / 100,
    locale: s.defaultLocale,
    currency: s.defaultCurrency,
    edgeCases: {
      missingValues: true,
      numericOutliers: true,
      rareCategories: false,
      boundaryValues: true,
      longText: false,
      duplicateLike: false,
    },
  };
}

function exampleDesign(): RelationalDesign {
  return {
    tables: EXAMPLE_RELATIONAL.tables.map(t => ({ ...t, columns: t.columns.map(c => ({ ...c })) })),
    relationships: EXAMPLE_RELATIONAL.relationships.map(r => ({ ...r })),
    rules: EXAMPLE_RELATIONAL.rules.map(r => ({ ...r, terms: [...r.terms] })),
    sources: {},
  };
}

/** What History keeps to rerun a job: config, schema, seed and learned statistics — never rows. */
function storedJobFor(job: EngineJob, result: TabularResult | RelationalResult | DocumentResult): StoredJob {
  if (job.kind === 'documents') return job;
  if (job.kind === 'relational') {
    const rel = result as RelationalResult;
    return {
      kind: 'relational', tables: job.tables, relationships: job.relationships, rules: job.rules, config: job.config,
      profiles: Object.fromEntries(job.tables.map(t => [t.name, job.sources[t.name]?.profile ?? job.profiles?.[t.name] ?? null])),
      forbiddenReplay: Object.fromEntries(rel.tables.map(t => [t.tableName ?? '', t.forbiddenLog ?? {}])),
    };
  }
  return { kind: 'tabular', schema: job.schema, config: job.config, profile: job.profile ?? null, forbiddenReplay: (result as TabularResult).forbiddenLog };
}

function jobFromHistory(entry: HistoryEntry): EngineJob {
  const j = entry.job;
  if (j.kind === 'documents') return j;
  if (j.kind === 'relational') {
    return { kind: 'relational', tables: j.tables, relationships: j.relationships, rules: j.rules, config: j.config, sources: {}, profiles: j.profiles, forbiddenReplay: j.forbiddenReplay };
  }
  return { kind: 'tabular', schema: j.schema, config: j.config, profile: j.profile ?? null, fileId: null, forbiddenReplay: j.forbiddenReplay };
}

function worstStatus(statuses: ValidationStatus[]): ValidationStatus {
  return statuses.includes('failed') ? 'failed' : statuses.includes('warning') ? 'warning' : 'passed';
}

/** The sidebar/URL name for a data type: invoices and bank statements both live under "documents". */
function urlTypeOf(t: DataType | string | null): string | null {
  if (!t) return null;
  return t === 'invoice' || t === 'bank_statement' || t === 'documents' ? 'documents' : t;
}

export function Workspace() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();

  const typeParam = searchParams.get('type') as DataType | null;
  const isDemo = searchParams.get('demo') === 'true';
  const regenerateId = searchParams.get('regenerate');
  const tabParam = searchParams.get('tab') ?? undefined;

  const [step, setStep] = useState(1);
  const [maxStep, setMaxStep] = useState(1);
  const [dataType, setDataType] = useState<DataType | null>(typeParam);
  const [schema, setSchema] = useState<ColumnSchema[]>([]);
  // Shared with the Relationships page, so edits there show up here and vice versa.
  const [design, setDesign] = useRelationalDesign();
  const [config, setConfig] = useState<GenerationConfig>(defaultConfig);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [profile, setProfile] = useState<DatasetProfile | null>(null);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [tabularResult, setTabularResult] = useState<TabularResult | null>(null);
  const [relationalResult, setRelationalResult] = useState<RelationalResult | null>(null);
  const [documentResult, setDocumentResult] = useState<DocumentResult | null>(null);
  const [job, setJob] = useState<EngineJob | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [aiSchema, setAiSchema] = useState<AiSchemaState>(AI_SCHEMA_IDLE);
  /** Set while rerunning a History entry, so the result keeps its name and links back to it. */
  const [regenOf, setRegenOf] = useState<HistoryEntry | null>(null);
  /** Active results tab. Steps 5 and 6 are views of the same results: the Export tab is step 6. */
  const [resultTab, setResultTab] = useState(tabParam ?? 'preview');

  // The sidebar links to ?type=documents, which opens the invoice/bank statement chooser.
  const isDocument = dataType === 'invoice' || dataType === 'bank_statement' || (dataType as string) === 'documents';
  const isRelational = dataType === 'relational';

  useEffect(() => {
    if (regenerateId) {
      const entry = getHistoryEntry(regenerateId);
      if (!entry) {
        toast.error('That history entry no longer exists.');
        return;
      }
      // Restore the saved inputs, then rerun with the same seed.
      const j = entry.job;
      setDataType(entry.type);
      if (j.kind === 'tabular') { setSchema(j.schema); setConfig(j.config); setProfile(j.profile ?? null); }
      if (j.kind === 'relational') { setDesign({ tables: j.tables, relationships: j.relationships, rules: j.rules, sources: {} }); setConfig(j.config); }
      if (j.kind === 'documents') setConfig(c => ({ ...c, seed: j.seed }));
      setRegenOf(entry);
      setJob(jobFromHistory(entry));
      setStep(4);
      setMaxStep(4);
      return;
    }
    if (typeParam) {
      setDataType(typeParam);
      setStep(2);
      setMaxStep(m => Math.max(m, 2));
    }
    if (isDemo) {
      // "Try demo" = the relational Load example, ready to configure.
      setDataType('relational');
      setDesign(exampleDesign());
      setStep(3);
      setMaxStep(m => Math.max(m, 3));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sidebar links (Tabular / Relational / Documents / Generate) keep the same page and only change ?type=,
  // so the page must follow the URL after the first render too, not just on load.
  const firstTypeRun = useRef(true);
  useEffect(() => {
    if (firstTypeRun.current) { firstTypeRun.current = false; return; }
    if (urlTypeOf(typeParam) === urlTypeOf(dataType)) return;
    // A different type was picked: start that type fresh at its input step (or at step 1 for "Generate").
    setGeneration(null);
    setTabularResult(null);
    setRelationalResult(null);
    setDocumentResult(null);
    setJob(null);
    setRegenOf(null);
    setDataType(typeParam);
    setStep(typeParam ? 2 : 1);
    setMaxStep(typeParam ? 2 : 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeParam]);

  // The other direction: choosing a type on the page updates ?type=, so the sidebar highlights it
  // and a page refresh keeps you in the same section.
  useEffect(() => {
    const t = urlTypeOf(dataType);
    if (!t || searchParams.get('type') === t) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('type', t);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataType]);

  const goToStep = (n: number) => {
    setStep(n);
    setMaxStep(s => Math.max(s, n));
  };

  const handleTypeSelect = (t: DataType) => setDataType(t);

  const handleAnalyzed = (result: UploadResult, analysis: SchemaAnalysis) => {
    // Detected PII columns start with the default behaviour chosen in Settings.
    const pii = getSettings().defaultPIIBehavior;
    const columns = analysis.columns.map(c =>
      c.privacyLevel === 'high' && c.privacyTransform === 'synthetic' && allowedTransforms(c).includes(pii) ? { ...c, privacyTransform: pii } : c);
    setUpload(result);
    setProfile(analysis.profile ?? null);
    setSchema(columns);
    runAiSchemaReview(result.fileId, columns);
  };

  /** Second opinion from the model on the rule-based schema. Rules stay in effect unless the user switches a column. */
  const runAiSchemaReview = async (fileId: string, columns: ColumnSchema[]) => {
    const dataset = getDataset(fileId);
    const status = await fetchAiStatus();
    // No key: the built-in detection is the whole answer, so no AI card is shown at all.
    if (!status.configured || !dataset) {
      setAiSchema({ status: 'idle', decisions: {} });
      return;
    }
    setAiSchema({ status: 'loading', decisions: {} });
    const res = await aiPost<AiSchemaResult>('schema', { tables: [schemaRequestTable('dataset', dataset, columns)] });
    setAiSchema(res.ok
      ? { status: 'done', model: res.model, columns: res.data.columns, decisions: {} }
      : { status: 'unavailable', message: res.message, decisions: {} });
  };

  const handleAiChoose = (column: string, choice: 'ai' | 'rules', ai: AiColumnSuggestion) => {
    setAiSchema(s => ({ ...s, decisions: { ...s.decisions, [column]: choice } }));
    setSchema(cols => cols.map(c => {
      if ((c.sourceColumn ?? c.name) !== column) return c;
      // Remember the rule-based values so "Keep rules" can restore them.
      const rules = c.ruleBased ?? { semanticType: c.semanticType, privacyLevel: c.privacyLevel, privacyTransform: c.privacyTransform };
      if (choice === 'rules') return { ...c, ...rules, ruleBased: rules };
      return {
        ...c,
        ruleBased: rules,
        semanticType: ai.semanticType,
        privacyLevel: ai.privacyLevel,
        privacyTransform: allowedTransforms(c).includes(ai.transform) ? ai.transform : c.privacyTransform,
      };
    }));
  };

  const handleDescribed = (r: DescribedSchema) => {
    setSchema(r.columns);
    setConfig(c => ({
      ...c,
      ...(r.rowCount ? { rowCount: r.rowCount } : {}),
      ...(r.locale ? { locale: r.locale, currency: region(r.locale).currency } : {}),
      columnRules: r.rules,
    }));
    toast.success(`${r.source === 'ai' ? 'AI drafted' : 'Created'} ${r.columns.length} columns${r.rules.length ? ` and ${r.rules.length} business rules` : ''} — review them before continuing`);
  };

  const handleClearUpload = () => {
    setUpload(null);
    setProfile(null);
    setSchema([]);
    setAiSchema(AI_SCHEMA_IDLE);
  };

  // Relational privacy rules are edited as "table.column" in the configuration panel.
  const flatSchema = useMemo(
    () => design.tables.flatMap(t => t.columns.map(c => ({ ...c, name: `${t.name}.${c.name}` }))),
    [design.tables],
  );
  const setFlatSchema = (cols: ColumnSchema[]) => {
    const byName = new Map(cols.map(c => [c.name, c.privacyTransform]));
    setDesign(d => ({
      ...d,
      tables: d.tables.map(t => ({ ...t, columns: t.columns.map(c => ({ ...c, privacyTransform: byName.get(`${t.name}.${c.name}`) ?? c.privacyTransform })) })),
    }));
  };
  const estimatedRows = useMemo(
    () => Object.values(estimateRowCounts(design.tables, design.relationships)).reduce((a, e) => a + e.rows, 0),
    [design.tables, design.relationships],
  );

  const handleGenerate = () => {
    // Pick a seed now so it is visible (and reusable) before generation starts.
    if (config.seed === undefined) setConfig(c => ({ ...c, seed: generateSeed() }));
    setShowConfirm(true);
  };

  const confirmGenerate = () => {
    setShowConfirm(false);
    const seeded = { ...config, seed: config.seed ?? generateSeed() };
    setTabularResult(null);
    setRelationalResult(null);
    setRegenOf(null);
    if (isRelational) {
      setJob({
        kind: 'relational',
        tables: design.tables as TableSchema[],
        relationships: design.relationships,
        rules: design.rules,
        config: seeded,
        sources: Object.fromEntries(Object.entries(design.sources).map(([k, s]) => [k, { fileId: s.fileId, profile: s.profile }])),
      });
    } else {
      setJob({ kind: 'tabular', schema, config: seeded, profile, fileId: upload?.fileId ?? null });
    }
    goToStep(4);
  };

  const saveToHistory = (gen: Generation, result: TabularResult | RelationalResult | DocumentResult, validation: ValidationStatus, qualityScore: number | null, sourceName?: string) => {
    if (!job) return;
    const { saved, reproducible } = addHistory({
      id: gen.id,
      name: gen.name,
      type: gen.type,
      createdAt: gen.createdAt,
      rowCount: gen.rowCount,
      columnCount: gen.columnCount,
      tableCount: gen.tableCount,
      sizeBytes: result.sizeBytes,
      generationTimeMs: result.generationTimeMs,
      seed: result.seed,
      validation,
      qualityScore,
      sourceName,
      job: storedJobFor(job, result),
      regeneratedFrom: regenOf?.id,
    });
    if (!saved) toast.warning('Generated, but it could not be saved to History: browser storage is full.');
    else if (!reproducible) toast.warning('Saved to History. This dataset is large, so regenerating may differ slightly.');
  };

  const handleEngineComplete = (result: TabularResult | RelationalResult | DocumentResult) => {
    const createdAt = new Date().toISOString();
    if ('kind' in result && (result.kind === 'invoice' || result.kind === 'bank_statement')) {
      const invoices = result.kind === 'invoice';
      const cfg = invoices ? result.invoiceConfig! : result.bankConfig!;
      const gen: Generation = {
        id: result.jobId,
        name: regenOf?.name ?? (invoices ? `${result.invoices!.length} invoices (${cfg.locale})` : `${result.statements!.length} bank statements (${cfg.locale})`),
        type: result.kind,
        status: 'completed',
        rowCount: result.rowCount,
        fileSizeMb: result.sizeBytes / (1024 * 1024),
        generationTimeMs: result.generationTimeMs,
        createdAt,
        config: { ...config, seed: result.seed },
      };
      setGeneration(gen);
      setDocumentResult(result);
      setLatestResult({ generation: gen, documents: result });
      saveToHistory(gen, result, result.validation.overall, computeQuality({ metrics: result.validation.metrics, rowCount: result.rowCount }).overall);
      setJob(null);
      setResultTab(tabParam ?? 'preview');
      goToStep(5);
      setMaxStep(6);
      return;
    }
    const relational = 'tables' in result ? result : null;
    const uploadedNames = regenOf ? (regenOf.sourceName ? [regenOf.sourceName] : [])
      : relational ? Object.values(design.sources).map(s => s.fileName) : upload ? [upload.fileName] : [];
    const gen: Generation = {
      id: result.jobId,
      name: regenOf?.name ?? (relational
        ? `Relational: ${relational.tables.map(t => t.tableName).join(', ')}`
        : upload ? `Synthetic ${upload.fileName.replace(/\.[^.]+$/, '')}` : 'Generated Dataset'),
      type: relational ? 'relational' : 'tabular',
      status: 'completed',
      rowCount: result.rowCount,
      columnCount: relational ? relational.tables.reduce((a, t) => a + t.columnCount, 0) : (result as TabularResult).columnCount,
      tableCount: relational ? relational.tables.length : undefined,
      fileSizeMb: result.sizeBytes / (1024 * 1024),
      generationTimeMs: result.generationTimeMs,
      createdAt,
      config: job && job.kind !== 'documents' ? job.config : undefined,
      schema: relational
        ? relational.tables.map(t => ({ name: t.tableName ?? 'table', columns: t.schema, rowCount: t.rowCount }))
        : [{ name: 'dataset', columns: (result as TabularResult).schema, rowCount: result.rowCount }],
    };
    setGeneration(gen);
    const sourceName = uploadedNames.join(', ') || undefined;
    if (relational) {
      setRelationalResult(relational);
      setLatestResult({ generation: gen, relational, sourceName });
      const quality = computeQuality({ metrics: mergeRelationalMetrics(relational), rowCount: relational.rowCount }).overall;
      saveToHistory(gen, relational, worstStatus([relational.relationalValidation.overall, ...relational.tables.map(t => t.validation.overall)]), quality, sourceName);
    } else {
      const tab = result as TabularResult;
      setTabularResult(tab);
      setLatestResult({ generation: gen, result: tab, sourceName });
      saveToHistory(gen, tab, tab.validation.overall, computeQuality(tab).overall, sourceName);
    }
    setJob(null);
    setResultTab(tabParam ?? 'preview');
      goToStep(5);
      setMaxStep(6);
  };

  const handleEngineCancel = () => {
    setJob(null);
    // Documents are configured on step 2; everything else on step 3.
    setStep(isDocument ? 2 : 3);
  };

  const handleDocGenerate = (req: DocumentRequest) => {
    const seed = config.seed ?? generateSeed();
    setTabularResult(null);
    setRelationalResult(null);
    setDocumentResult(null);
    setRegenOf(null);
    setJob(req.docType === 'invoice'
      ? { kind: 'documents', docType: 'invoice', invoiceConfig: req.invoiceConfig, seed }
      : { kind: 'documents', docType: 'bank_statement', bankConfig: req.bankConfig, seed });
    goToStep(4);
  };
  const setDocSeed = useCallback((seed: number | undefined) => setConfig(c => ({ ...c, seed })), []);

  const loadSaved = (s: SavedSchema) => {
    if (s.kind === 'tabular' && s.columns) {
      handleClearUpload();
      setSchema(s.columns.map(c => ({ ...c })));
    }
    if (s.kind === 'relational' && s.design) setDesign({ ...s.design, sources: {} });
    setConfig(c => ({ ...c, columnRules: s.columnRules ?? [] }));
  };

  const confirmMessage = isRelational
    ? `Generate ${design.tables.length} related tables (~${estimatedRows.toLocaleString()} rows)? Null rate: ${config.edgeCases.missingValues ? `${Math.round(config.nullRate * 100)}%` : 'off'}, Locale: ${config.locale}, Seed: ${config.seed ?? 'auto'}.`
    : `Generate ${config.rowCount.toLocaleString()} synthetic records? Null rate: ${config.edgeCases.missingValues ? `${Math.round(config.nullRate * 100)}%` : 'off'}, Outlier rate: ${config.edgeCases.numericOutliers ? `${Math.round(config.outlierRate * 100)}%` : 'off'}, Locale: ${config.locale}, Currency: ${config.currency}, Seed: ${config.seed ?? 'auto'}.`;

  return (
    <div className="flex flex-col h-full">
      <Stepper
        step={step}
        maxStep={maxStep}
        // No jumping while the engine runs; documents have no configure step; results only once they exist.
        canGo={n => step !== 4 && n !== 4 && !(isDocument && n === 3) && (n < 5 ? n <= maxStep : !!generation)}
        onGo={n => {
          // Steps 5 and 6 are tabs of the results screen, so the stepper opens the matching tab.
          if (n === 6) setResultTab('export');
          else if (n === 5 && resultTab === 'export') setResultTab('validation');
          setStep(n);
        }}
      />

      <ConfirmModal
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={confirmGenerate}
        title="Confirm Generation"
        confirmLabel="Generate Data"
        message={confirmMessage}
      />

      <div className="flex-1 overflow-auto">
        {step === 1 && (
          <StepSelectType
            selected={dataType}
            onSelect={handleTypeSelect}
            onNext={() => goToStep(2)}
          />
        )}

        {step === 2 && !isRelational && !isDocument && (
          <StepInputTabular
            upload={upload}
            schema={schema}
            profile={profile}
            onAnalyzed={handleAnalyzed}
            onSchemaChange={setSchema}
            onClear={handleClearUpload}
            onNext={() => goToStep(3)}
            library={
              <SchemaLibraryBar kind="tabular" canSave={schema.length > 0} current={() => ({ columns: schema, columnRules: config.columnRules })} onLoad={loadSaved} />
            }
            aiSchema={aiSchema}
            onAiChoose={handleAiChoose}
            onDescribed={handleDescribed}
          />
        )}

        {step === 2 && isRelational && (
          <StepRelational
            design={design}
            onChange={setDesign}
            onNext={() => goToStep(3)}
            library={
              <SchemaLibraryBar
                kind="relational"
                canSave={design.tables.length > 0}
                current={() => ({ design: { tables: design.tables, relationships: design.relationships, rules: design.rules }, columnRules: config.columnRules })}
                onLoad={loadSaved}
              />
            }
          />
        )}

        {step === 2 && isDocument && (
          <StepDocuments seed={config.seed} onSeedChange={setDocSeed} onNext={handleDocGenerate} />
        )}

        {step === 3 && !isDocument && (
          <ConfigurationPanel
            config={config}
            onChange={setConfig}
            schema={isRelational ? flatSchema : schema}
            onSchemaChange={isRelational ? setFlatSchema : setSchema}
            profile={isRelational ? null : profile}
            preview={isRelational
              ? <LivePreview config={config} design={design} />
              : <LivePreview config={config} schema={schema} profile={profile} fileId={upload?.fileId ?? null} />}
            onNext={handleGenerate}
            rowCountNote={isRelational ? `Set per table in the designer — ${design.tables.length} tables, ~${estimatedRows.toLocaleString()} rows in total.` : undefined}
          />
        )}

        {step === 4 && job && (
          <GenerationProgress key={regenOf?.id ?? 'new'} job={job} onComplete={handleEngineComplete} onCancel={handleEngineCancel} />
        )}

        {step >= 5 && generation && (
          <div className="flex flex-col h-full">
            <ResultHeader gen={generation} regeneratedFrom={regenOf} />
            <ResultTabs
              gen={generation}
              result={tabularResult}
              relational={relationalResult}
              documents={documentResult}
              tab={resultTab}
              onTabChange={t => { setResultTab(t); setStep(t === 'export' ? 6 : 5); setMaxStep(6); }}
            />
          </div>
        )}
      </div>

      {/* Step navigation */}
      {step > 1 && step < 4 && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3 flex justify-between items-center">
          <button
            onClick={() => setStep(s => Math.max(1, s - 1))}
            className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            ← Back
          </button>
          <span className="text-xs text-[var(--color-text-muted)]">Step {step} of {STEPS.length}</span>
        </div>
      )}
    </div>
  );
}
