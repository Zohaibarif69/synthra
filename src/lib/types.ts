export type DataType = 'tabular' | 'relational' | 'invoice' | 'bank_statement';
export type DocumentType = 'invoice' | 'bank_statement';

export type GenerationStatus =
  | 'idle'
  | 'uploading'
  | 'analyzing'
  | 'generating'
  | 'validating'
  | 'completed'
  | 'failed';

export type PrivacyLevel = 'low' | 'medium' | 'high';
export type PrivacyTransform = 'preserve' | 'mask' | 'hash' | 'synthetic' | 'noise';
export type Cardinality = '1:1' | '1:N' | 'N:N';
export type ValidationStatus = 'passed' | 'warning' | 'failed';

export interface ColumnSchema {
  name: string;
  type: 'string' | 'integer' | 'float' | 'boolean' | 'date' | 'datetime' | 'email' | 'uuid';
  semanticType?: string;
  nullable: boolean;
  unique?: boolean;
  privacyLevel?: PrivacyLevel;
  privacyTransform?: PrivacyTransform;
  detectedPattern?: string;
  /** Column in the uploaded file this schema column was detected from (survives renames). */
  sourceColumn?: string;
  /** Detected value format, e.g. 'YYYY-MM-DD', 'DD/MM/YYYY', 'YYYY-MM-DD HH:mm:ss'. */
  format?: string;
  /** The rule-based detection, kept when the user switches this column to an AI suggestion. */
  ruleBased?: Pick<ColumnSchema, 'semanticType' | 'privacyLevel' | 'privacyTransform'>;
}

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  rowCount?: number;
}

export interface Relationship {
  id: string;
  parentTable: string;
  parentColumn: string;
  childTable: string;
  childColumn: string;
  cardinality: Cardinality;
  /** 1:N — children per parent row; N:N — links per parent row. */
  minChildren?: number;
  maxChildren?: number;
  /** N:N — name of the auto-created join table. */
  joinTable?: string;
  /** Found automatically from uploaded files. */
  detected?: boolean;
}

export type RuleAggregate = 'SUM' | 'COUNT' | 'AVG' | 'MIN' | 'MAX';

/** parentTable.parentColumn = AGG(product of childTable.terms) over each parent's child rows. */
export interface ConsistencyRule {
  id: string;
  parentTable: string;
  parentColumn: string;
  childTable: string;
  aggregate: RuleAggregate;
  /** Child columns multiplied per row (one or more); ignored for COUNT. */
  terms: string[];
}

export interface GenerationConfig {
  rowCount: number;
  seed?: number;
  nullRate: number;
  outlierRate: number;
  locale: string;
  currency: string;
  /** Privacy budget ε for 'noise' columns (0.1–10, lower = more noise = more private). */
  privacyEpsilon?: number;
  /** Per-column business rules the generated data must satisfy. */
  columnRules?: ColumnRule[];
  /** AI-written value pools for free-text columns (column → values); the generator samples from them. */
  aiContent?: Record<string, string[]>;
  /** AI-suggested edge cases the user ticked; injected at AI_EDGE_RATE. */
  aiEdgeCases?: AiEdgeCase[];
  edgeCases: {
    missingValues: boolean;
    numericOutliers: boolean;
    rareCategories: boolean;
    boundaryValues: boolean;
    longText: boolean;
    duplicateLike: boolean;
  };
}

/**
 * Column business rule. Column names are plain for tabular data and "table.column" for relational.
 * range: numbers, or YYYY-MM-DD for date columns.
 */
export type ColumnRule =
  | { id: string; kind: 'range'; column: string; min?: number | string; max?: number | string }
  | { id: string; kind: 'allowed'; column: string; values: string[] }
  | { id: string; kind: 'pattern'; column: string; regex: string }
  | { id: string; kind: 'compare'; column: string; op: '<' | '<=' | '>' | '>=' | '!='; other: string };

/**
 * Where the generator re-drew a high-privacy value because it matched the upload: column → row → [re-draws, suffixes].
 * Stored instead of the uploaded values so a later "Regenerate" reproduces the data exactly.
 */
export type ForbiddenLog = Record<string, Record<number, [number, number]>>;

export interface InvoiceConfig {
  count: number;
  locale: string;
  currency: string;
  taxRate: number;
  dateFrom: string;
  dateTo: string;
  /** AI-written line items for the seller's business; replaces the built-in catalogue when present. */
  aiCatalog?: AiCatalogItem[];
}

// ─── AI layer ────────────────────────────────────────────────────────────────

/** What every /api/ai/* route returns. `source: 'ai'` only when the model actually produced the data. */
export type AiResponse<T> =
  /** `cached`: the model's earlier answer to the exact same request, reused instead of asking again. */
  | { ok: true; source: 'ai'; model: string; data: T; cached?: boolean }
  | { ok: false; code: 'no_key' | 'rate_limited' | 'timeout' | 'auth' | 'refused' | 'invalid_output' | 'bad_request' | 'error'; message: string };

export interface AiColumnSuggestion {
  table: string;
  column: string;
  semanticType: string;
  pii: boolean;
  privacyLevel: PrivacyLevel;
  transform: PrivacyTransform;
  reason: string;
}

export interface AiRelationshipSuggestion {
  parentTable: string;
  parentColumn: string;
  childTable: string;
  childColumn: string;
  cardinality: Cardinality;
  reason: string;
}

export interface AiSchemaResult {
  columns: AiColumnSuggestion[];
  relationships: AiRelationshipSuggestion[];
}

/** A data-specific edge case. Either literal values to inject, or a value placed relative to another column. */
export interface AiEdgeCase {
  id: string;
  title: string;
  column: string;
  values: string[];
  compareWith?: { column: string; op: '<' | '>' };
  reason: string;
}

export interface AiCatalogItem {
  name: string;
  unit: string;
  minUsd: number;
  maxUsd: number;
}

export interface AiQualityExplanation {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  actions: string[];
}

export interface BankStatementConfig {
  count: number;
  accountType: 'checking' | 'savings' | 'business';
  locale: string;
  currency: string;
  startingBalance: number;
  dateFrom: string;
  dateTo: string;
  transactionCount: number;
  minAmount?: number;
  maxAmount?: number;
  /** The balance must never drop below this ("never below X"). */
  minBalance?: number;
  /** Shorthand for minBalance = 0. */
  preventNegative?: boolean;
}

// ─── Documents ───────────────────────────────────────────────────────────────

export interface Party {
  name: string;
  address: string;
  taxIdLabel: string;
  taxId: string;
}

export interface InvoiceLine {
  description: string;
  unit: string;
  qty: number;
  unitPriceCents: number;
  amountCents: number;
}

export interface Invoice {
  number: string;
  seller: Party;
  buyer: Party;
  /** ISO dates (YYYY-MM-DD). */
  issueDate: string;
  dueDate: string;
  currency: string;
  /** Intl locale used for money/dates, e.g. 'en-PK'. */
  intlLocale: string;
  dateFormat: string;
  taxLabel: string;
  /** Percent, e.g. 17. */
  taxRate: number;
  lines: InvoiceLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export interface BankTransaction {
  date: string;
  description: string;
  category: string;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
}

export interface BankStatement {
  id: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  accountType: BankStatementConfig['accountType'];
  currency: string;
  intlLocale: string;
  dateFormat: string;
  periodFrom: string;
  periodTo: string;
  openingBalanceCents: number;
  closingBalanceCents: number;
  totalDebitsCents: number;
  totalCreditsCents: number;
  transactions: BankTransaction[];
}

export interface DocumentResult {
  jobId: string;
  kind: 'invoice' | 'bank_statement';
  seed: number;
  invoices?: Invoice[];
  statements?: BankStatement[];
  invoiceConfig?: InvoiceConfig;
  bankConfig?: BankStatementConfig;
  validation: ValidationResult;
  rowCount: number;
  sizeBytes: number;
  generationTimeMs: number;
}

export interface SchemaAnalysis {
  columns: ColumnSchema[];
  piiFields: string[];
  numericCount: number;
  categoricalCount: number;
  dateCount: number;
  detectedRelationships?: Relationship[];
  /** Statistics learned from the uploaded rows; absent for manually defined schemas. */
  profile?: DatasetProfile;
}

export interface ValidationCheck {
  name: string;
  status: ValidationStatus;
  message: string;
  detail?: string;
}

export interface ValidationResult {
  overall: ValidationStatus;
  checks: ValidationCheck[];
  /** Why some checks were not run (e.g. no uploaded file to compare against). */
  notes?: string[];
  /** Raw per-column numbers behind the checks (used by the Quality page). */
  metrics?: ValidationMetrics;
}

export interface CategoryShare {
  value: string;
  /** Share of non-null values, in %. */
  original: number;
  synthetic: number;
  originalCount: number;
}

export interface ColumnValidationMetrics {
  column: string;
  type: ColumnSchema['type'];
  /** Values with the wrong type. */
  invalid: number;
  unique: boolean;
  duplicates?: number;
  nullRateSynthetic: number;
  nullRateOriginal?: number;
  /** Configured null rate for this column (0 for non-nullable columns). */
  nullRateTarget: number;
  /** Allowed |synthetic − target| before the null rate counts as off (same value in Validation and Quality). */
  nullRateTolerance?: number;
  mean?: { original: number; synthetic: number };
  std?: { original: number; synthetic: number };
  ks?: { d: number; p: number; n: number; m: number };
  tvd?: { value: number; tolerance: number };
  categoryShares?: CategoryShare[];
  privacyLevel?: PrivacyLevel;
  transform?: PrivacyTransform;
  /** High-privacy columns only: synthetic values that also appear in the uploaded file. */
  leakedValues?: number;
}

export interface CorrelationPairMetric {
  a: string;
  b: string;
  original: number;
  synthetic: number;
}

export interface RelationshipMetric {
  id: string;
  label: string;
  cardinality: Cardinality;
  /** Non-null foreign key values checked. */
  fkValues: number;
  orphans: number;
  nullFks: number;
  cardinalityViolations: number;
  cardinalityDetail: string;
}

export interface RuleMetric {
  id: string;
  label: string;
  parentsChecked: number;
  mismatches: number;
  maxDiff: number;
}

export interface ValidationMetrics {
  hasOriginal: boolean;
  columns: ColumnValidationMetrics[];
  correlations: CorrelationPairMetric[];
  copiedRows?: number;
  relationships?: RelationshipMetric[];
  rules?: RuleMetric[];
  /** Documents whose totals/balances reconcile and whose dates are in range. */
  documents?: { kind: 'invoice' | 'bank_statement'; total: number; consistent: number };
  /** Column business rules: rows passing every rule. */
  columnRules?: { rows: number; passing: number; rules: { label: string; violations: number }[] };
}

export interface ColumnStats {
  name: string;
  type: string;
  nullCount: number;
  nullRate: number;
  uniqueCount: number;
  min?: string | number;
  max?: string | number;
  mean?: number;
  median?: number;
  stdDev?: number;
  topValues?: { value: string; count: number; pct: number }[];
}

export interface DatasetStatistics {
  rowCount: number;
  columnCount: number;
  missingValues: number;
  missingRate: number;
  outlierCount: number;
  columns: ColumnStats[];
}

export interface Generation {
  id: string;
  name: string;
  type: DataType;
  status: GenerationStatus;
  rowCount: number;
  columnCount?: number;
  tableCount?: number;
  fileSizeMb?: number;
  generationTimeMs?: number;
  createdAt: string;
  config?: GenerationConfig;
  schema?: TableSchema[];
}

export interface PreviewData {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  page: number;
  pageSize: number;
}

export interface ExportFormat {
  format: 'csv' | 'json' | 'sql' | 'pdf' | 'zip';
  label: string;
}

export interface UploadResult {
  fileId: string;
  fileName: string;
  fileSizeMb: number;
  rowCount: number;
  columnCount: number;
  /** Non-fatal problems found while parsing (e.g. rows with a wrong number of fields). */
  warnings?: string[];
}

// ─── Parsed uploads & learned profiles ───────────────────────────────────────

export type Cell = string | number | boolean | null;
export type DataRow = Record<string, Cell>;

export interface ParsedDataset {
  fileName: string;
  fileSizeBytes: number;
  format: 'csv' | 'json';
  columns: string[];
  rows: DataRow[];
  warnings: string[];
}

export type ColumnKind = 'numeric' | 'categorical' | 'datetime' | 'boolean' | 'identifier' | 'text';

export interface ColumnProfile extends ColumnStats {
  kind: ColumnKind;
  /** Non-null values that could not be read as the column's type. */
  invalidCount: number;
  /** Numeric and datetime: 101 percentiles (p0, p1 … p100). */
  quantiles?: number[];
  /** Numeric: most decimal places seen. */
  decimals?: number;
  /** Datetime: range as epoch milliseconds (min/max hold ISO strings). */
  minTs?: number;
  maxTs?: number;
  /** Text: length statistics. */
  avgLength?: number;
  minLength?: number;
  maxLength?: number;
  /** Categorical: share (in %) of values not listed in topValues. */
  otherPct?: number;
}

export interface NumericCorrelation {
  a: string;
  b: string;
  /** Pearson correlation coefficient, -1 … 1. */
  r: number;
  /** Rows where both columns were present. */
  n: number;
}

export interface DatasetProfile {
  rowCount: number;
  columnCount: number;
  columns: ColumnProfile[];
  correlations: NumericCorrelation[];
  /**
   * Gaussian-copula correlations across numeric, categorical and boolean columns, used by the generator.
   * Absent in profiles saved before it existed; those keep generating exactly as they did.
   */
  latentCorrelations?: NumericCorrelation[];
}

// ─── Tabular generation results ──────────────────────────────────────────────

export type GenerationStageId = 'prepare' | 'generate' | 'edge' | 'links' | 'privacy' | 'profile' | 'validate';

export interface PrivacyColumnReport {
  column: string;
  level?: PrivacyLevel;
  transform: PrivacyTransform;
  /** Non-null values changed by the transform. */
  changed: number;
  /** Real values from this run, before and after the transform. */
  examples: { before: Cell; after: Cell }[];
  note: string;
}

export interface HistogramBin {
  label: string;
  /** Share of non-null values in this bin, in %. */
  original?: number;
  synthetic: number;
}

export interface NumericHistogram {
  column: string;
  bins: HistogramBin[];
}

export interface InjectedCounts {
  nulls: number;
  outliers: number;
  boundaryValues: number;
  rareCategories: number;
  longText: number;
  duplicateLikeRows: number;
  /** Values injected from ticked AI edge cases. */
  aiEdgeCases?: number;
}

export interface TabularResult {
  jobId: string;
  /** Table name inside a relational result; absent for single-table generation. */
  tableName?: string;
  seed: number;
  /** Schema the data was generated from (same order as syntheticProfile.columns). */
  schema: ColumnSchema[];
  rowCount: number;
  columnCount: number;
  /** Size of the data as CSV, in bytes. */
  sizeBytes: number;
  generationTimeMs: number;
  statistics: DatasetStatistics;
  syntheticProfile: DatasetProfile;
  originalProfile?: DatasetProfile;
  histograms: NumericHistogram[];
  validation: ValidationResult;
  injected: InjectedCounts;
  privacy: PrivacyColumnReport[];
  /** Re-draws caused by upload values (no values stored) — replayed by Regenerate. */
  forbiddenLog?: ForbiddenLog;
}

export interface RelationalResult {
  jobId: string;
  seed: number;
  /** One result per generated table (including auto-created join tables), in generation order. */
  tables: TabularResult[];
  /** Relationships after N:N expansion (what was actually generated). */
  relationships: Relationship[];
  rules: ConsistencyRule[];
  /** Referential integrity, cardinality and rule reconciliation across tables. */
  relationalValidation: ValidationResult;
  rowCount: number;
  sizeBytes: number;
  generationTimeMs: number;
}

export interface PreviewPage {
  columns: string[];
  rows: DataRow[];
  /** Rows matching the search (all rows when there is no search). */
  matched: number;
  totalRows: number;
}

export interface ApiStatus {
  connected: boolean;
  version?: string;
  latencyMs?: number;
}

export interface RelationalTableConfig {
  tableName: string;
  rowCount: number;
}

export interface WorkspaceState {
  step: number;
  dataType: DataType | null;
  uploadedFile: UploadResult | null;
  schema: TableSchema[];
  relationships: Relationship[];
  config: GenerationConfig;
  invoiceConfig: InvoiceConfig;
  bankConfig: BankStatementConfig;
  generation: Generation | null;
  previewData: PreviewData | null;
  statistics: DatasetStatistics | null;
  validation: ValidationResult | null;
  relationalTableConfigs: RelationalTableConfig[];
}
