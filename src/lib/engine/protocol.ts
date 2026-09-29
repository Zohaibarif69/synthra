// Messages exchanged between the UI thread and the generation worker.

import type {
  Cell, ColumnSchema, ConsistencyRule, DatasetProfile, ForbiddenLog, GenerationConfig, GenerationStageId, PreviewPage,
  RelationalResult, Relationship, TableSchema, TabularResult,
} from '../types';

export interface OriginalData {
  /** Uploaded values keyed by source column name (only columns used by the schema). */
  columns: Record<string, Cell[]>;
  rowCount: number;
}

export interface GenerateRequest {
  type: 'generate';
  jobId: string;
  schema: ColumnSchema[];
  config: GenerationConfig & { seed: number };
  profile?: DatasetProfile | null;
  original?: OriginalData | null;
  forbiddenReplay?: ForbiddenLog;
}

export type ExportFormat = 'csv' | 'json' | 'zip' | 'sql';

export interface ExportRequest {
  type: 'export';
  requestId: number;
  jobId: string;
  format: ExportFormat;
}

export interface GenerateRelationalRequest {
  type: 'generateRelational';
  jobId: string;
  tables: TableSchema[];
  relationships: Relationship[];
  rules: ConsistencyRule[];
  config: GenerationConfig & { seed: number };
  /** Per table name, from uploaded CSVs. */
  profiles: Record<string, DatasetProfile | null>;
  originals: Record<string, OriginalData | null>;
  forbiddenReplay?: Record<string, ForbiddenLog>;
}

export interface QueryRequest {
  type: 'query';
  requestId: number;
  jobId: string;
  /** Table to read in a relational result; defaults to the first table. */
  table?: string;
  search: string;
  page: number;
  pageSize: number;
}

export type WorkerRequest = GenerateRequest | GenerateRelationalRequest | QueryRequest | ExportRequest;

export type WorkerResponse =
  | { type: 'progress'; jobId: string; stage: GenerationStageId; fraction: number; detail?: string }
  | { type: 'done'; jobId: string; result: TabularResult }
  | { type: 'doneRelational'; jobId: string; result: RelationalResult }
  | { type: 'error'; jobId: string; message: string }
  | { type: 'queryResult'; requestId: number; page: PreviewPage }
  | { type: 'queryError'; requestId: number; message: string }
  | { type: 'exportResult'; requestId: number; blob: Blob; ext: string }
  | { type: 'exportError'; requestId: number; message: string };
