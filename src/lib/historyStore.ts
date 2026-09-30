// Generation history in localStorage: metadata, config, schema and seed of every completed run —
// enough to regenerate the exact same data, but never the generated rows or the uploaded values.

import type {
  BankStatementConfig, ColumnSchema, ConsistencyRule, DataType, DatasetProfile, ForbiddenLog, GenerationConfig,
  InvoiceConfig, Relationship, TableSchema, ValidationStatus,
} from './types';
import { createLocalStore } from './localStore';

export type StoredJob =
  | { kind: 'tabular'; schema: ColumnSchema[]; config: GenerationConfig & { seed: number }; profile?: DatasetProfile | null; forbiddenReplay?: ForbiddenLog }
  | {
      kind: 'relational'; tables: TableSchema[]; relationships: Relationship[]; rules: ConsistencyRule[];
      config: GenerationConfig & { seed: number }; profiles?: Record<string, DatasetProfile | null>; forbiddenReplay?: Record<string, ForbiddenLog>;
    }
  | { kind: 'documents'; docType: 'invoice' | 'bank_statement'; invoiceConfig?: InvoiceConfig; bankConfig?: BankStatementConfig; seed: number };

export interface HistoryEntry {
  id: string;
  name: string;
  type: DataType;
  createdAt: string;
  rowCount: number;
  columnCount?: number;
  tableCount?: number;
  sizeBytes: number;
  generationTimeMs: number;
  seed: number;
  validation: ValidationStatus;
  qualityScore: number | null;
  sourceName?: string;
  /** Same job + seed = same data; used to count distinct datasets. */
  fingerprint: string;
  job: StoredJob;
  /** False when learned statistics had to be dropped to fit in storage. */
  reproducible: boolean;
  regeneratedFrom?: string;
}

const MAX_ENTRIES = 50;
/** Entries above this size lose their learned profiles (they then regenerate without the upload's statistics). */
const MAX_ENTRY_CHARS = 1_500_000;

export const historyStore = createLocalStore<HistoryEntry[]>('synthra:history:v1', []);

export function fingerprint(job: StoredJob): string {
  const s = JSON.stringify(job);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function withoutProfiles(job: StoredJob): StoredJob {
  if (job.kind === 'tabular') return { ...job, profile: null };
  if (job.kind === 'relational') return { ...job, profiles: {} };
  return job;
}

/** Saves an entry, trimming it (or the oldest entries) if browser storage is full. Returns what was saved. */
export function addHistory(entry: Omit<HistoryEntry, 'reproducible' | 'fingerprint'>): { saved: boolean; reproducible: boolean } {
  let full: HistoryEntry = { ...entry, fingerprint: fingerprint(entry.job), reproducible: true };
  if (JSON.stringify(full).length > MAX_ENTRY_CHARS) full = { ...full, job: withoutProfiles(full.job), reproducible: false };
  let list = [full, ...historyStore.get()].slice(0, MAX_ENTRIES);
  while (list.length) {
    if (historyStore.set(list)) return { saved: true, reproducible: full.reproducible };
    // Quota exceeded: drop the oldest entry and try again.
    list = list.slice(0, -1);
  }
  return { saved: false, reproducible: false };
}

export function removeHistory(id: string) {
  historyStore.set(list => list.filter(e => e.id !== id));
}

export function renameHistory(id: string, name: string) {
  historyStore.set(list => list.map(e => (e.id === id ? { ...e, name } : e)));
}

export function getHistoryEntry(id: string): HistoryEntry | undefined {
  return historyStore.get().find(e => e.id === id);
}
