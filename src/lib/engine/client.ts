// UI-side handle to the generation worker: start a job, follow its progress, cancel it,
// and page/search through generated rows that stay inside the worker.

import type {
  BankStatement, BankStatementConfig, Cell, ColumnSchema, ConsistencyRule, DatasetProfile, DocumentResult, ForbiddenLog,
  GenerationConfig, GenerationStageId, Invoice, InvoiceConfig, PreviewPage, RelationalResult, Relationship,
  TableSchema, TabularResult,
} from '../types';
import type { ExportFormat, OriginalData, WorkerRequest, WorkerResponse } from './protocol';
import type { TstrResult } from './tstr';
import { columnValues } from './profile';
import { getDataset } from './store';
import { generateInvoices } from './invoice';
import { generateStatements } from './bank';
import { validateInvoices, validateStatements } from './validate';

export class GenerationCancelledError extends Error {
  constructor() {
    super('Generation cancelled');
    this.name = 'GenerationCancelledError';
  }
}

export interface TabularJob {
  kind?: 'tabular';
  schema: ColumnSchema[];
  config: GenerationConfig & { seed: number };
  profile?: DatasetProfile | null;
  /** fileId of the upload the profile came from; its rows are used for comparisons. */
  fileId?: string | null;
  /** From a previous run (History → Regenerate) when the upload is not in memory. */
  forbiddenReplay?: ForbiddenLog;
}

export interface RelationalTableSource {
  fileId: string;
  profile: DatasetProfile | null;
}

export interface RelationalJob {
  kind: 'relational';
  tables: TableSchema[];
  relationships: Relationship[];
  rules: ConsistencyRule[];
  config: GenerationConfig & { seed: number };
  /** Uploaded source per table name. */
  sources: Record<string, RelationalTableSource | undefined>;
  /** Per-table profiles kept by History when the uploads are gone. */
  profiles?: Record<string, DatasetProfile | null>;
  forbiddenReplay?: Record<string, ForbiddenLog>;
}

export interface DocumentJob {
  kind: 'documents';
  docType: 'invoice' | 'bank_statement';
  invoiceConfig?: InvoiceConfig;
  bankConfig?: BankStatementConfig;
  seed: number;
}

export type EngineJob = TabularJob | RelationalJob | DocumentJob;

/** What the TSTR test needs to rebuild a train-only generator: the job's schema and settings, and its upload. */
export interface TstrSource {
  schema: ColumnSchema[];
  config: GenerationConfig & { seed: number };
  fileId: string;
}

const nextFrame = () => new Promise<void>(r => setTimeout(r, 0));

export type ProgressListener = (stage: GenerationStageId, fraction: number, detail?: string) => void;

interface ActiveJob {
  id: string;
  resolve: (r: TabularResult | RelationalResult) => void;
  reject: (e: Error) => void;
  onProgress: ProgressListener;
}

function originalFor(schema: ColumnSchema[], fileId: string | null | undefined): OriginalData | null {
  const dataset = fileId ? getDataset(fileId) : undefined;
  if (!dataset) return null;
  const columns: Record<string, Cell[]> = {};
  for (const col of schema) {
    const key = col.sourceColumn;
    if (key && dataset.columns.includes(key) && !(key in columns)) columns[key] = columnValues(dataset.rows, key);
  }
  return { columns, rowCount: dataset.rows.length };
}

class EngineClient {
  private worker: Worker | null = null;
  private job: ActiveJob | null = null;
  /** Job whose rows are currently held by the worker. */
  private dataJobId: string | null = null;
  private queries = new Map<number, { resolve: (p: PreviewPage) => void; reject: (e: Error) => void }>();
  private exports = new Map<number, { resolve: (r: { blob: Blob; ext: string }) => void; reject: (e: Error) => void }>();
  private tstrs = new Map<number, { resolve: (r: TstrResult) => void; reject: (e: Error) => void }>();
  private nextQueryId = 1;
  private jobCounter = 0;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./tabular.worker.ts', import.meta.url));
    w.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(e.data);
    w.onerror = (e) => {
      e.preventDefault();
      const err = new Error(e.message ? `Generation worker crashed: ${e.message}` : 'Generation worker crashed (possibly out of memory). Try fewer rows.');
      this.reset(err);
    };
    this.worker = w;
    return w;
  }

  private reset(err: Error) {
    this.worker?.terminate();
    this.worker = null;
    this.dataJobId = null;
    this.job?.reject(err);
    this.job = null;
    this.queries.forEach(q => q.reject(err));
    this.queries.clear();
    this.exports.forEach(q => q.reject(err));
    this.exports.clear();
    this.tstrs.forEach(q => q.reject(err));
    this.tstrs.clear();
  }

  private handle(msg: WorkerResponse) {
    switch (msg.type) {
      case 'progress':
        if (this.job?.id === msg.jobId) this.job.onProgress(msg.stage, msg.fraction, msg.detail);
        break;
      case 'done':
      case 'doneRelational':
        if (this.job?.id === msg.jobId) {
          this.dataJobId = msg.jobId;
          this.job.resolve(msg.result);
          this.job = null;
        }
        break;
      case 'error':
        if (this.job?.id === msg.jobId) {
          this.job.reject(new Error(msg.message));
          this.job = null;
        }
        break;
      case 'queryResult':
        this.queries.get(msg.requestId)?.resolve(msg.page);
        this.queries.delete(msg.requestId);
        break;
      case 'queryError':
        this.queries.get(msg.requestId)?.reject(new Error(msg.message));
        this.queries.delete(msg.requestId);
        break;
      case 'exportResult':
        this.exports.get(msg.requestId)?.resolve({ blob: msg.blob, ext: msg.ext });
        this.exports.delete(msg.requestId);
        break;
      case 'tstrResult':
        this.tstrs.get(msg.requestId)?.resolve(msg.result);
        this.tstrs.delete(msg.requestId);
        break;
      case 'tstrError':
        this.tstrs.get(msg.requestId)?.reject(new Error(msg.message));
        this.tstrs.delete(msg.requestId);
        break;
      case 'exportError':
        this.exports.get(msg.requestId)?.reject(new Error(msg.message));
        this.exports.delete(msg.requestId);
        break;
    }
  }

  private start(build: (id: string) => WorkerRequest, onProgress: ProgressListener): Promise<TabularResult | RelationalResult> {
    if (this.job) this.cancel();
    const worker = this.ensureWorker();
    const id = `gen_${Date.now().toString(36)}_${++this.jobCounter}`;
    return new Promise((resolve, reject) => {
      this.job = { id, resolve, reject, onProgress };
      this.dataJobId = null;
      worker.postMessage(build(id));
    });
  }

  generate(job: TabularJob, onProgress: ProgressListener): Promise<TabularResult> {
    const original = job.profile ? originalFor(job.schema, job.fileId) : null;
    return this.start(
      id => ({ type: 'generate', jobId: id, schema: job.schema, config: job.config, profile: job.profile ?? null, original, forbiddenReplay: job.forbiddenReplay }),
      onProgress,
    ) as Promise<TabularResult>;
  }

  generateRelational(job: RelationalJob, onProgress: ProgressListener): Promise<RelationalResult> {
    const profiles: Record<string, DatasetProfile | null> = {};
    const originals: Record<string, OriginalData | null> = {};
    for (const t of job.tables) {
      const src = job.sources[t.name];
      profiles[t.name] = src?.profile ?? job.profiles?.[t.name] ?? null;
      originals[t.name] = src?.profile ? originalFor(t.columns, src.fileId) : null;
    }
    return this.start(
      id => ({
        type: 'generateRelational', jobId: id, tables: job.tables, relationships: job.relationships, rules: job.rules,
        config: job.config, profiles, originals, forbiddenReplay: job.forbiddenReplay,
      }),
      onProgress,
    ) as Promise<RelationalResult>;
  }

  /** Asks the worker to serialize the generated rows; resolves only once the file exists. */
  exportData(jobId: string, format: ExportFormat): Promise<{ blob: Blob; ext: string }> {
    if (!this.worker || this.dataJobId !== jobId) {
      return Promise.reject(new Error('This generated dataset is no longer in memory. Use History → Regenerate to rebuild it, then export.'));
    }
    const requestId = this.nextQueryId++;
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      this.exports.set(requestId, { resolve, reject });
      worker.postMessage({ type: 'export', requestId, jobId, format });
    });
  }

  /**
   * TSTR utility test (Train on Synthetic, Test on Real) on the uploaded file, in the worker.
   * Needs the upload to still be in memory; it is re-read here and never leaves the browser.
   */
  runTstr(source: TstrSource, target: string): Promise<TstrResult> {
    const original = originalFor(source.schema, source.fileId);
    if (!original) return Promise.reject(new Error('The uploaded file is no longer in memory. Upload it again to run this test.'));
    const worker = this.ensureWorker();
    const requestId = this.nextQueryId++;
    return new Promise((resolve, reject) => {
      this.tstrs.set(requestId, { resolve, reject });
      worker.postMessage({ type: 'tstr', requestId, schema: source.schema, config: source.config, original, target });
    });
  }

  private docRun = 0;

  /**
   * Invoices and bank statements are small enough to build on the main thread; stages yield to the
   * browser in between so progress renders and Cancel is honoured.
   */
  async generateDocuments(job: DocumentJob, onProgress: ProgressListener): Promise<DocumentResult> {
    const run = ++this.docRun;
    const started = performance.now();
    const check = () => { if (run !== this.docRun) throw new GenerationCancelledError(); };
    const count = job.docType === 'invoice' ? job.invoiceConfig!.count : job.bankConfig!.count;
    onProgress('generate', 0, `0 / ${count}`);
    await nextFrame(); check();
    let invoices: Invoice[] | undefined;
    let statements: BankStatement[] | undefined;
    if (job.docType === 'invoice') invoices = generateInvoices(job.invoiceConfig!, job.seed);
    else statements = generateStatements(job.bankConfig!, job.seed);
    onProgress('generate', 1, `${count} / ${count}`);
    await nextFrame(); check();
    onProgress('validate', 0);
    const validation = invoices ? validateInvoices(invoices, job.invoiceConfig!) : validateStatements(statements!, job.bankConfig!);
    onProgress('validate', 1);
    await nextFrame(); check();
    const docs = invoices ?? statements!;
    return {
      jobId: `doc_${Date.now().toString(36)}_${run}`,
      kind: job.docType,
      seed: job.seed,
      invoices,
      statements,
      invoiceConfig: job.invoiceConfig,
      bankConfig: job.bankConfig,
      validation,
      rowCount: invoices ? invoices.length : statements!.reduce((a, s) => a + s.transactions.length, 0),
      sizeBytes: new TextEncoder().encode(JSON.stringify(docs)).length,
      generationTimeMs: Math.round(performance.now() - started),
    };
  }

  /** Stops the running job immediately (terminates the worker, or abandons a document run). */
  cancel() {
    this.docRun++;
    if (!this.job) return;
    this.reset(new GenerationCancelledError());
  }

  query(jobId: string, search: string, page: number, pageSize: number, table?: string): Promise<PreviewPage> {
    if (!this.worker || this.dataJobId !== jobId) {
      return Promise.reject(new Error('This generated dataset is no longer in memory. Generate it again.'));
    }
    const requestId = this.nextQueryId++;
    const worker = this.worker;
    return new Promise<PreviewPage>((resolve, reject) => {
      this.queries.set(requestId, { resolve, reject });
      worker.postMessage({ type: 'query', requestId, jobId, table, search, page, pageSize });
    });
  }
}

export const tabularEngine = new EngineClient();
