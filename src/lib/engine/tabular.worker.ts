// Web Worker that generates, profiles and validates data off the UI thread.
// Generated tables stay here; the UI asks for pages of rows through 'query' messages.

import JSZip from 'jszip';
import type { ColumnSchema, DataRow, DatasetProfile, GenerationConfig, GenerationStageId, PreviewPage, Relationship, TabularResult } from '../types';
import type { ExportRequest, GenerateRelationalRequest, GenerateRequest, OriginalData, QueryRequest, WorkerRequest, WorkerResponse } from './protocol';
import type { GeneratedTable } from './tabular';
import { buildProfile } from './profile';
import { validateRelational, validateTabular } from './validate';
import { csvSizeBytes, datasetStatistics, numericHistograms } from './stats';
import { computeRuleValues } from './relational';
import { rulesForTable } from './rules';
import { csvParts, jsonParts, relationalJsonParts, sqlParts, type ExportTable } from './export';
import { forbiddenValues, runRelationalPipeline, runTabularPipeline } from './pipeline';

const worker = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

interface StoredTable { schema: ColumnSchema[]; table: GeneratedTable }

let current: {
  jobId: string;
  tables: Map<string, StoredTable>;
  order: string[];
  relationships: Relationship[];
  joins: { table: string; columns: string[] }[];
  relational: boolean;
} | null = null;

/** Fixed file date inside ZIPs so the same data always produces the same archive bytes. */
const ZIP_DATE = new Date(Date.UTC(2000, 0, 1));
let searchCache: { key: string; matches: Int32Array } | null = null;

/** Profile, statistics, histograms and validation for one generated table. */
function analyzeTable(args: {
  jobId: string; tableName?: string; schema: ColumnSchema[]; table: GeneratedTable; config: GenerationConfig & { seed: number };
  profile?: DatasetProfile | null; original?: OriginalData | null; privacy: TabularResult['privacy']; started: number;
}): TabularResult {
  const { schema, table, config, profile } = args;
  const syntheticProfile = buildProfile(schema.map((column, c) => ({ column, values: table.data[c] })), table.rowCount, { includeSensitiveValues: true, maxTopValues: 50 });
  const original = args.original && profile ? { profile, columns: args.original.columns, rowCount: args.original.rowCount } : undefined;
  return {
    jobId: args.jobId,
    tableName: args.tableName,
    seed: config.seed,
    schema,
    rowCount: table.rowCount,
    columnCount: schema.length,
    sizeBytes: csvSizeBytes(schema, table.data, table.rowCount),
    generationTimeMs: Math.round(performance.now() - args.started),
    statistics: datasetStatistics(schema, table.data, syntheticProfile),
    syntheticProfile,
    originalProfile: profile ?? undefined,
    histograms: numericHistograms(schema, table.data, syntheticProfile, original),
    validation: validateTabular({
      generated: { schema, data: table.data, flags: table.flags, rowCount: table.rowCount },
      config, requestedRows: table.rowCount, synthetic: syntheticProfile, original,
    }),
    injected: table.injected,
    privacy: args.privacy,
  };
}

async function runGenerate(req: GenerateRequest) {
  const started = performance.now();
  // Stages are reported in order; receiving a stage means every earlier stage has finished.
  const progress = (stage: GenerationStageId, fraction: number) => worker.postMessage({ type: 'progress', jobId: req.jobId, stage, fraction });
  current = null;
  searchCache = null;

  progress('prepare', 0);
  const { table, schema, privacy } = await runTabularPipeline({
    schema: req.schema, config: req.config, profile: req.profile,
    forbidden: forbiddenValues(req.schema, req.original?.columns), forbiddenReplay: req.forbiddenReplay,
    onGenerate: (stage, fraction) => progress(stage, fraction),
    onPrivacy: f => progress('privacy', f),
  });

  progress('profile', 0);
  const result = analyzeTable({ jobId: req.jobId, schema, table, config: req.config, profile: req.profile, original: req.original, privacy, started });
  result.forbiddenLog = table.forbiddenLog;
  progress('validate', 1);
  result.generationTimeMs = Math.round(performance.now() - started);

  current = { jobId: req.jobId, tables: new Map([['dataset', { schema, table }]]), order: ['dataset'], relationships: [], joins: [], relational: false };
  worker.postMessage({ type: 'done', jobId: req.jobId, result });
}

async function runRelational(req: GenerateRelationalRequest) {
  const started = performance.now();
  const progress = (stage: GenerationStageId, fraction: number, detail?: string) =>
    worker.postMessage({ type: 'progress', jobId: req.jobId, stage, fraction, detail });
  current = null;
  searchCache = null;

  progress('prepare', 0);
  const forbidden: Record<string, Record<string, Set<string>>> = {};
  for (const t of req.tables) forbidden[t.name] = forbiddenValues(t.columns, req.originals[t.name]?.columns);
  const { gen, privacyByTable } = await runRelationalPipeline({
    tables: req.tables, relationships: req.relationships, rules: req.rules, config: req.config, profiles: req.profiles,
    forbidden, forbiddenReplay: req.forbiddenReplay,
    onGenerate: (stage, fraction, detail) => progress(stage, fraction, detail),
    onPrivacy: (fraction, table) => progress('privacy', fraction, table),
  });
  progress('links', 1);

  progress('profile', 0);
  const tables: TabularResult[] = gen.order.map((name, i) => {
    const stored = gen.tables.get(name)!;
    const r = analyzeTable({
      jobId: req.jobId, tableName: name, schema: stored.schema, table: stored.table,
      config: { ...req.config, columnRules: rulesForTable(req.config.columnRules, name) },
      profile: req.profiles[name], original: req.originals[name], privacy: privacyByTable.get(name) ?? [], started,
    });
    r.forbiddenLog = stored.table.forbiddenLog;
    progress('profile', (i + 1) / gen.order.length, name);
    return r;
  });

  progress('validate', 0);
  const view = (name: string) => {
    const s = gen.tables.get(name)!;
    return { schema: s.schema, data: s.table.data, rowCount: s.table.rowCount };
  };
  const relationalValidation = validateRelational({
    tables: gen.order.map(name => ({ name, ...view(name) })),
    relationships: gen.design.relationships,
    joins: gen.design.joins.map(j => ({ table: j.table, colA: j.relA.childColumn, colB: j.relB.childColumn })),
    rules: req.rules,
    computeRule: rule => {
      const rel = gen.design.relationships.find(r => r.parentTable === rule.parentTable && r.childTable === rule.childTable);
      if (!rel || !gen.tables.has(rule.parentTable) || !gen.tables.has(rule.childTable)) return null;
      return computeRuleValues(rule, view(rule.parentTable), view(rule.childTable), rel);
    },
  });
  progress('validate', 1);

  current = {
    jobId: req.jobId, tables: gen.tables, order: gen.order, relationships: gen.design.relationships,
    joins: gen.design.joins.map(j => ({ table: j.table, columns: [j.relA.childColumn, j.relB.childColumn] })), relational: true,
  };
  worker.postMessage({
    type: 'doneRelational',
    jobId: req.jobId,
    result: {
      jobId: req.jobId,
      seed: req.config.seed,
      tables,
      relationships: gen.design.relationships,
      rules: req.rules,
      relationalValidation,
      rowCount: tables.reduce((a, t) => a + t.rowCount, 0),
      sizeBytes: tables.reduce((a, t) => a + t.sizeBytes, 0),
      generationTimeMs: Math.round(performance.now() - started),
    },
  });
}

function runQuery(req: QueryRequest): PreviewPage {
  if (!current || current.jobId !== req.jobId) throw new Error('This generated dataset is no longer in memory. Generate it again.');
  const name = req.table && current.tables.has(req.table) ? req.table : current.order[0];
  const { schema, table } = current.tables.get(name)!;
  const search = req.search.trim().toLowerCase();

  let matches: Int32Array | null = null;
  if (search) {
    const key = `${req.jobId}\u0001${name}\u0001${search}`;
    if (searchCache?.key === key) {
      matches = searchCache.matches;
    } else {
      const found: number[] = [];
      for (let i = 0; i < table.rowCount; i++) {
        for (let c = 0; c < table.data.length; c++) {
          const v = table.data[c][i];
          if (v !== null && String(v).toLowerCase().includes(search)) { found.push(i); break; }
        }
      }
      matches = Int32Array.from(found);
      searchCache = { key, matches };
    }
  }

  const matched = matches ? matches.length : table.rowCount;
  const start = Math.max(0, (req.page - 1) * req.pageSize);
  const end = Math.min(matched, start + req.pageSize);
  const rows: DataRow[] = [];
  for (let k = start; k < end; k++) {
    const i = matches ? matches[k] : k;
    const row: DataRow = {};
    schema.forEach((col, c) => { row[col.name] = table.data[c][i]; });
    rows.push(row);
  }
  return { columns: schema.map(c => c.name), rows, matched, totalRows: table.rowCount };
}

/** Builds the export file from the rows held here and returns it as a Blob. */
async function runExport(req: ExportRequest): Promise<{ blob: Blob; ext: string }> {
  if (!current || current.jobId !== req.jobId) throw new Error('This generated dataset is no longer in memory. Generate it again (History → Regenerate).');
  const tables: ExportTable[] = current.order.map(name => {
    const s = current!.tables.get(name)!;
    return { name, schema: s.schema, data: s.table.data, rowCount: s.table.rowCount };
  });
  if (!current.relational) {
    if (req.format === 'csv') return { blob: new Blob(csvParts(tables[0]), { type: 'text/csv;charset=utf-8' }), ext: 'csv' };
    if (req.format === 'json') return { blob: new Blob(jsonParts(tables[0]), { type: 'application/json' }), ext: 'json' };
    throw new Error(`${req.format.toUpperCase()} export is only available for relational data.`);
  }
  if (req.format === 'json') return { blob: new Blob(relationalJsonParts(tables), { type: 'application/json' }), ext: 'json' };
  if (req.format === 'sql') return { blob: new Blob(sqlParts(tables, current.relationships, current.joins), { type: 'application/sql' }), ext: 'sql' };
  if (req.format === 'zip') {
    const zip = new JSZip();
    for (const t of tables) zip.file(`${t.name}.csv`, new Blob(csvParts(t)), { date: ZIP_DATE });
    return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/zip' }), ext: 'zip' };
  }
  throw new Error('Relational data exports as ZIP (one CSV per table), JSON or SQL.');
}

function fail(jobId: string, err: unknown) {
  current = null;
  const message = err instanceof RangeError
    ? 'The browser ran out of memory for this many rows. Try fewer rows or columns.'
    : (err as Error).message || 'Generation failed.';
  worker.postMessage({ type: 'error', jobId, message });
}

worker.onmessage = (event) => {
  const req = event.data;
  if (req.type === 'generate') {
    runGenerate(req).catch(err => fail(req.jobId, err));
  } else if (req.type === 'generateRelational') {
    runRelational(req).catch(err => fail(req.jobId, err));
  } else if (req.type === 'export') {
    runExport(req)
      .then(({ blob, ext }) => worker.postMessage({ type: 'exportResult', requestId: req.requestId, blob, ext }))
      .catch(err => worker.postMessage({ type: 'exportError', requestId: req.requestId, message: (err as Error).message || 'Export failed.' }));
  } else if (req.type === 'query') {
    try {
      worker.postMessage({ type: 'queryResult', requestId: req.requestId, page: runQuery(req) });
    } catch (err) {
      worker.postMessage({ type: 'queryError', requestId: req.requestId, message: (err as Error).message });
    }
  }
};
