// Detects column types, semantic meaning and privacy sensitivity from real values.

import type {
  Cell, ColumnKind, ColumnSchema, DatasetProfile, ParsedDataset, PrivacyLevel, PrivacyTransform,
} from '../types';
import { detectDateFormat, formatDate, parseDateWithFormat } from './dates';

type ColType = ColumnSchema['type'];

/** Share of non-null values that must match a type for the column to get that type. */
const TYPE_THRESHOLD = 0.97;
/** Values inspected for type detection; uniqueness and ranges always use every value. */
const TYPE_SAMPLE_SIZE = 20_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_RE = /^(https?:\/\/|www\.)\S+$/i;
const PHONE_RE = /^\+?[\d\s().-]{7,20}$/;
const PLAIN_NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const GROUPED_NUM_RE = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;
const CURRENCY_PREFIX_RE = /^(rs\.?|pkr|usd|eur|gbp|inr|cad|aud)\s*/i;
const CURRENCY_SYMBOL_RE = /[$€£¥₹]/g;

export function normalizeName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Reads plain numbers and formatted amounts such as "1,250.50", "$99" or "Rs 1,200". */
export function toNumber(v: Cell | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (PLAIN_NUM_RE.test(s)) return Number(s);
  const stripped = s.replace(CURRENCY_PREFIX_RE, '').replace(CURRENCY_SYMBOL_RE, '').replace(/\s/g, '');
  if (stripped !== s && GROUPED_NUM_RE.test(stripped)) return Number(stripped.replace(/,/g, ''));
  if (s.includes(',') && GROUPED_NUM_RE.test(s)) return Number(s.replace(/,/g, ''));
  return null;
}

function hasCurrencyMarker(s: string): boolean {
  return /[$€£¥₹]/.test(s) || CURRENCY_PREFIX_RE.test(s);
}

export function decimalsOf(raw: Cell, n: number): number {
  const s = typeof raw === 'string' ? raw.replace(/,/g, '') : String(n);
  if (/e/i.test(s)) return 6;
  const dot = s.indexOf('.');
  if (dot < 0) return 0;
  const digits = s.slice(dot + 1).match(/^\d+/);
  return digits ? digits[0].length : 0;
}

// ─── Name patterns ───────────────────────────────────────────────────────────

const R = {
  sensitiveId: /(^|_)(ssn|social_security(_number)?|cnic|nic|nicn|passport(_no|_number)?|national_id|nid|tax_id|tin|ntn|credit_card(_number)?|card_number|card_no|cc_number|cvv|cvc|iban|account_number|account_no|acct_no|acct_number|bank_account|routing_number|swift|driver_licen[cs]e|licen[cs]e_(no|number))(_|$)/,
  dob: /(^|_)(dob|date_of_birth|birth_?date|birthday)(_|$)/,
  email: /(^|_)e_?mail(_address)?(_|$)/,
  phone: /(^|_)(phone|mobile|cell|tel|telephone|fax|contact_no|contact_number|whatsapp)(_|$)/,
  ip: /(^|_)(ip|ip_address|ipv4|ipv6)(_|$)/,
  username: /(^|_)(user_?name|login|handle|screen_name)(_|$)/,
  url: /(^|_)(url|website|web_site|link|homepage|site)(_|$)/,
  strongId: /(^id$|_id$|^id_|_uuid$|^uuid$|_guid$|^guid$|_key$|^key$|^pk$)/,
  weakId: /(_code$|^code$|^sku$|_sku$|_ref$|^ref$|^reference$|_no$|_number$|^number$|_num$)/,
  address: /(^|_)(address|addr|street|address_line_?\d?|line_?[12]|zip|zipcode|zip_code|postal|postal_code|postcode|pin_code|house|apartment|apt)(_|$)/,
  region: /(^|_)(state|province|region|county|district|territory)(_|$)/,
  city: /(^|_)(city|town|village)(_|$)/,
  country: /(^|_)(country|nation|nationality)(_code|_name)?(_|$)/,
  age: /(^|_)age(_years)?$/,
  company: /(^|_)(company|business|employer|organi[sz]ation|org|vendor|supplier|merchant|brand|firm|manufacturer|bank)(_name)?(_|$)/,
  personName: /(^|_)(first|last|middle|full|sur|given|family)?_?name$/,
  nameExclude: /(company|product|item|file|brand|city|country|street|category|business|org|store|shop|merchant|vendor|supplier|bank|project|team|dept|department|course|school|university|hospital|app|host|domain|event|place|region|state|model|device|plan|campaign|column|table|field|pet|breed|song|album|movie|book|game|role|job|title)/,
  currency: /(^|_)(price|amount|amt|cost|salary|wage|wages|revenue|total|subtotal|fee|fees|balance|income|payment|spend|spent|budget|profit|tax|discount|charge|charges|debit|credit|sales|pay|rent|fare|premium|mrp)(_|$)/,
  quantity: /(^|_)(qty|quantity|count|units|stock|items|pieces|seats|visits|clicks|orders|number_of|num_of)(_|$)/,
  status: /(^|_)(status|stage|phase)(_|$)/,
  category: /(^|_)(category|categories|type|kind|class|group|segment|department|dept|gender|sex|genre|level|tier|grade|plan|channel|method|mode|tag|label|role|position|title|designation|industry|sector|priority|size|color|colour|language|currency|currency_code|marital_status|blood_group|religion)(_|$)/,
  description: /(^|_)(desc|description|comment|comments|note|notes|review|text|message|bio|summary|feedback|remarks|content|body|details|about)(_|$)/,
  flag: /^(is|has|can|should|was|did|allow)_|(_flag|_enabled|_active|_verified)$|^(active|enabled|verified|flag|subscribed|churned|default)$/,
  codeLike: /(phone|mobile|cell|tel|fax|zip|postal|postcode|pin_code|cnic|ssn|account|card|iban|nic|passport)/,
};

const COUNTRY_VALUES = new Set([
  'afghanistan', 'argentina', 'australia', 'austria', 'bangladesh', 'belgium', 'brazil', 'canada', 'chile', 'china',
  'colombia', 'czech republic', 'denmark', 'egypt', 'finland', 'france', 'germany', 'greece', 'hong kong', 'hungary',
  'india', 'indonesia', 'iran', 'iraq', 'ireland', 'israel', 'italy', 'japan', 'jordan', 'kenya', 'kuwait', 'malaysia',
  'mexico', 'morocco', 'nepal', 'netherlands', 'new zealand', 'nigeria', 'norway', 'oman', 'pakistan', 'peru',
  'philippines', 'poland', 'portugal', 'qatar', 'romania', 'russia', 'saudi arabia', 'singapore', 'south africa',
  'south korea', 'spain', 'sri lanka', 'sweden', 'switzerland', 'taiwan', 'thailand', 'turkey', 'uae', 'ukraine',
  'united arab emirates', 'united kingdom', 'uk', 'united states', 'usa', 'us', 'vietnam',
  'pk', 'gb', 'in', 'de', 'fr', 'ca', 'au', 'cn', 'jp', 'br', 'mx', 'es', 'it', 'nl', 'se', 'no', 'dk', 'fi', 'ie',
  'nz', 'za', 'ng', 'eg', 'sa', 'ae', 'tr', 'ru', 'kr', 'sg', 'my', 'id', 'th', 'ph', 'vn', 'bd', 'lk', 'np', 'af',
  'ir', 'iq', 'qa', 'kw', 'om', 'ch', 'at', 'be', 'pl', 'pt', 'gr', 'cz', 'hu', 'ro', 'ua', 'il', 'ar', 'cl', 'co', 'pe',
]);

// ─── Privacy ─────────────────────────────────────────────────────────────────

export interface PrivacyDefault {
  level: PrivacyLevel;
  transform: PrivacyTransform;
}

/** Default privacy for a semantic type (used by the manual schema builder). */
export function defaultPrivacy(name: string, semanticType?: string): PrivacyDefault {
  const n = normalizeName(name);
  if (R.sensitiveId.test(n) || R.ip.test(n)) return { level: 'high', transform: 'mask' };
  if (R.dob.test(n)) return { level: 'high', transform: 'synthetic' };
  switch (semanticType) {
    case 'Person Name':
    case 'Email':
    case 'Phone':
      return { level: 'high', transform: 'synthetic' };
    case 'Address':
      return R.region.test(n) ? { level: 'low', transform: 'preserve' } : { level: 'high', transform: 'synthetic' };
    case 'Identifier':
      return R.username.test(n) ? { level: 'medium', transform: 'synthetic' } : { level: 'medium', transform: 'preserve' };
    case 'City':
    case 'Age':
      return { level: 'medium', transform: 'preserve' };
    default:
      return { level: 'low', transform: 'preserve' };
  }
}

// ─── Kinds & summaries ───────────────────────────────────────────────────────

const CATEGORICAL_SEMANTICS = new Set(['Category', 'Status', 'Country', 'City']);

/** How a column behaves statistically. distinct/nonNull refine string columns when known. */
export function columnKind(col: ColumnSchema, distinct?: number, nonNull?: number): ColumnKind {
  if (col.type === 'boolean') return 'boolean';
  if (col.type === 'date' || col.type === 'datetime') return 'datetime';
  if (col.type === 'uuid' || col.semanticType === 'Identifier') return 'identifier';
  if (col.type === 'integer' || col.type === 'float') return 'numeric';
  if (col.type === 'email') return 'text';
  if (col.privacyLevel === 'high') return 'text';
  if (col.semanticType && CATEGORICAL_SEMANTICS.has(col.semanticType)) return 'categorical';
  if (distinct !== undefined && nonNull) return distinct <= 50 && distinct / nonNull <= 0.5 ? 'categorical' : 'text';
  return 'text';
}

export interface SchemaSummary {
  piiFields: string[];
  numericCount: number;
  categoricalCount: number;
  dateCount: number;
}

/** Counts for the analysis panel. Uses learned kinds when a profile exists. */
export function summarizeSchema(columns: ColumnSchema[], profile?: DatasetProfile | null): SchemaSummary {
  const kinds = columns.map(c => {
    const p = profile?.columns.find(pc => pc.name === (c.sourceColumn ?? c.name));
    return p && p.type === c.type ? p.kind : columnKind(c);
  });
  return {
    piiFields: columns.filter(c => c.privacyLevel === 'high' || c.privacyLevel === 'medium').map(c => c.name),
    numericCount: kinds.filter(k => k === 'numeric').length,
    categoricalCount: kinds.filter(k => k === 'categorical' || k === 'boolean').length,
    dateCount: kinds.filter(k => k === 'datetime').length,
  };
}

// ─── Type detection ──────────────────────────────────────────────────────────

function share<T>(items: T[], pred: (v: T) => boolean): number {
  if (!items.length) return 0;
  let n = 0;
  for (const v of items) if (pred(v)) n++;
  return n / items.length;
}

function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.floor(i * step)]);
  return out;
}

const BOOL_WORDS = new Set(['true', 'false', 'yes', 'no']);

function detectType(values: Cell[], normName: string): { type: ColType; format?: string } {
  if (!values.length) return { type: 'string' };
  if (values.every(v => typeof v === 'boolean')) return { type: 'boolean' };

  const strs = values.map(v => (typeof v === 'string' ? v : String(v)));
  const lower = new Set(strs.map(s => s.toLowerCase()));

  if (share(strs, s => BOOL_WORDS.has(s.toLowerCase())) >= TYPE_THRESHOLD) return { type: 'boolean' };
  if (lower.size === 2 && ([...lower].every(s => s === 'y' || s === 'n') || [...lower].every(s => s === 't' || s === 'f'))) {
    return { type: 'boolean' };
  }
  if (lower.size <= 2 && [...lower].every(s => s === '0' || s === '1') && R.flag.test(normName)) return { type: 'boolean' };

  if (share(strs, s => UUID_RE.test(s)) >= TYPE_THRESHOLD) return { type: 'uuid' };
  if (share(strs, s => EMAIL_RE.test(s)) >= TYPE_THRESHOLD) return { type: 'email' };

  const nums = values.map(toNumber);
  if (share(nums, n => n !== null) >= TYPE_THRESHOLD) {
    // Zero-padded codes, phone numbers and long digit strings are identifiers, not quantities.
    const codeLike =
      R.codeLike.test(normName) ||
      strs.some(s => /^0\d+$/.test(s)) ||
      strs.some(s => /^\+?\d{13,}$/.test(s.replace(/[\s-]/g, '')));
    if (!codeLike) {
      const allInt = nums.every(n => n === null || Number.isInteger(n)) && !strs.some(s => /\.\d/.test(s));
      return { type: allInt ? 'integer' : 'float' };
    }
    return { type: 'string' };
  }

  const date = detectDateFormat(strs);
  if (date && date.ratio >= TYPE_THRESHOLD) return { type: date.hasTime ? 'datetime' : 'date', format: date.format };

  return { type: 'string' };
}

// ─── Semantic detection ──────────────────────────────────────────────────────

interface Facts {
  normName: string;
  type: ColType;
  nonNull: number;
  distinct: number;
  avgLength: number;
  sample: string[];
  currencyMarked: boolean;
  sequential: boolean;
  unique: boolean;
}

interface Semantic {
  semanticType: string;
  level: PrivacyLevel;
  transform: PrivacyTransform;
}

const sem = (semanticType: string, level: PrivacyLevel, transform: PrivacyTransform): Semantic => ({ semanticType, level, transform });

function detectSemantic(f: Facts): Semantic {
  const n = f.normName;
  const t = f.type;
  const numeric = t === 'integer' || t === 'float';
  const isDate = t === 'date' || t === 'datetime';

  if (R.sensitiveId.test(n)) return sem('Identifier', 'high', 'mask');
  if (R.dob.test(n)) return sem('Date', 'high', 'synthetic');
  if (t === 'email' || R.email.test(n)) return sem('Email', 'high', 'synthetic');
  if (R.phone.test(n) && !isDate) return sem('Phone', 'high', 'synthetic');
  if (R.ip.test(n)) return sem('Other', 'high', 'mask');
  if (R.username.test(n)) return sem('Identifier', 'medium', 'synthetic');
  if (t === 'uuid' || R.strongId.test(n)) return sem('Identifier', 'medium', 'preserve');
  if (R.url.test(n) || (t === 'string' && share(f.sample, s => URL_RE.test(s)) >= 0.9)) return sem('URL', 'low', 'preserve');
  if (isDate) return sem('Date', 'low', 'preserve');
  if (R.age.test(n) && numeric) return sem('Age', 'medium', 'preserve');
  if (R.address.test(n)) return sem('Address', 'high', 'synthetic');
  if (R.region.test(n) && t === 'string') return sem('Address', 'low', 'preserve');
  if (R.city.test(n)) return sem('City', 'medium', 'preserve');
  if (R.country.test(n) || (t === 'string' && share(f.sample, s => COUNTRY_VALUES.has(s.toLowerCase())) >= 0.9)) {
    return sem('Country', 'low', 'preserve');
  }
  if (/(^|_)currency(_code)?$/.test(n)) return sem('Category', 'low', 'preserve');
  if (R.weakId.test(n) && !numeric) return sem('Identifier', 'medium', 'preserve');
  if (R.weakId.test(n) && numeric && f.unique) return sem('Identifier', 'medium', 'preserve');
  if (R.company.test(n) && t === 'string') return sem('Company', 'low', 'preserve');
  if (R.personName.test(n) && !R.nameExclude.test(n) && t === 'string') return sem('Person Name', 'high', 'synthetic');
  if (numeric && (R.currency.test(n) || f.currencyMarked)) return sem('Currency', 'low', 'preserve');
  if (t === 'integer' && R.quantity.test(n)) return sem('Quantity', 'low', 'preserve');
  if (t === 'integer' && f.unique && f.sequential) return sem('Identifier', 'medium', 'preserve');
  if (R.status.test(n) && !numeric) return sem('Status', 'low', 'preserve');
  if (t === 'boolean') return sem('Category', 'low', 'preserve');
  if (R.category.test(n) && t === 'string') return sem('Category', 'low', 'preserve');
  if (t === 'string') {
    if (share(f.sample, s => PHONE_RE.test(s) && s.replace(/\D/g, '').length >= 7) >= 0.9 && /[\s()+-]/.test(f.sample.join(''))) {
      return sem('Phone', 'high', 'synthetic');
    }
    if (R.description.test(n) || f.avgLength > 60) return sem('Description', 'low', 'preserve');
    if (f.nonNull >= 10 && f.distinct <= 50 && f.distinct / f.nonNull <= 0.5) return sem('Category', 'low', 'preserve');
  }
  return sem('Other', 'low', 'preserve');
}

// ─── Column inference ────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function inferColumn(name: string, values: Cell[]): ColumnSchema {
  const normName = normalizeName(name);
  const nonNullValues: Cell[] = [];
  for (const v of values) if (v !== null) nonNullValues.push(v);
  const nullCount = values.length - nonNullValues.length;

  const { type, format } = detectType(sampleEvenly(nonNullValues, TYPE_SAMPLE_SIZE), normName);

  const distinctSet = new Set<string>();
  let totalLength = 0;
  let currencyMarked = false;
  for (const v of nonNullValues) {
    const s = typeof v === 'string' ? v : String(v);
    distinctSet.add(s);
    totalLength += s.length;
    if (!currencyMarked && typeof v === 'string' && hasCurrencyMarker(v)) currencyMarked = true;
  }
  const nonNull = nonNullValues.length;
  const distinct = distinctSet.size;
  const allDistinct = nonNull > 1 && distinct === nonNull;

  let min = Infinity;
  let max = -Infinity;
  let decimals = 0;
  let sequential = false;
  if (type === 'integer' || type === 'float') {
    for (const v of nonNullValues) {
      const x = toNumber(v);
      if (x === null) continue;
      if (x < min) min = x;
      if (x > max) max = x;
      if (type === 'float') decimals = Math.max(decimals, decimalsOf(v, x));
    }
    sequential = type === 'integer' && allDistinct && max - min + 1 <= nonNull * 1.5;
  } else if (type === 'date' || type === 'datetime') {
    for (const v of nonNullValues) {
      const ts = parseDateWithFormat(String(v), format);
      if (ts === null) continue;
      if (ts < min) min = ts;
      if (ts > max) max = ts;
    }
  }

  const s = detectSemantic({
    normName, type, nonNull, distinct, unique: allDistinct, sequential, currencyMarked,
    avgLength: nonNull ? totalLength / nonNull : 0,
    sample: sampleEvenly(nonNullValues, 2000).map(v => String(v)),
  });

  // Only identifier-like columns are constrained to be unique. Measurements and timestamps that
  // happen to have no repeats in the sample (prices, salaries, datetimes) are not.
  const uniqueByNature = s.semanticType === 'Identifier' || s.semanticType === 'Email' || s.semanticType === 'Phone'
    || type === 'email' || type === 'uuid';
  const unique = allDistinct && uniqueByNature;
  const isKey = s.semanticType === 'Identifier' && s.level !== 'high' && unique;

  // Pattern text shown in the schema table.
  let pattern: string;
  if (!nonNull) pattern = 'No values';
  else if (isKey && type === 'integer' && sequential) pattern = `Sequential ID ${fmtNum(min)}–${fmtNum(max)}`;
  else if (type === 'uuid') pattern = 'UUID';
  else if (s.semanticType === 'Identifier' && type === 'string' && s.level !== 'high') {
    pattern = `ID like "${String(nonNullValues[0])}"${unique ? ', unique' : ''}`;
  }
  else if (type === 'email') pattern = 'Email format';
  else if (type === 'boolean') pattern = `Boolean (${[...distinctSet].slice(0, 2).join('/')})`;
  else if (type === 'integer' || type === 'float') {
    pattern = `Range ${fmtNum(min)}–${fmtNum(max)}${type === 'float' ? `, ${Math.min(decimals, 6)}dp` : ''}${currencyMarked ? ', currency formatted' : ''}`;
  } else if (type === 'date' || type === 'datetime') {
    pattern = min <= max ? `${format}, ${formatDate(min, format)} → ${formatDate(max, format)}` : String(format);
  } else if (s.semanticType === 'Phone') pattern = 'Phone number';
  else if (s.semanticType === 'URL') pattern = 'URL';
  else if (distinct <= 6) pattern = `Enum: ${[...distinctSet].slice(0, 6).join(', ')}`;
  else if (s.semanticType === 'Description') pattern = `Free text, avg ${Math.round(totalLength / nonNull)} chars`;
  else if (nonNullValues.some(v => typeof v === 'string' && /^0\d+$/.test(v))) pattern = 'Zero-padded code';
  else pattern = `${distinct.toLocaleString('en-US')} distinct values`;
  if (nullCount > 0 && values.length) pattern += ` · ${((nullCount / values.length) * 100).toFixed(1)}% missing`;

  return {
    name,
    sourceColumn: name,
    type,
    ...(format ? { format } : {}),
    semanticType: s.semanticType,
    // Keys stay non-null; other columns may receive missing values when generating.
    nullable: nullCount > 0 || !isKey,
    unique,
    privacyLevel: s.level,
    privacyTransform: s.transform,
    detectedPattern: pattern,
  };
}

export function inferSchema(dataset: ParsedDataset): ColumnSchema[] {
  return dataset.columns.map(name => inferColumn(name, dataset.rows.map(r => r[name] ?? null)));
}
