'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Receipt, Landmark, Sparkles, RefreshCw, Wand2, CheckCircle, Info } from 'lucide-react';
import { Button } from '../../components/common/Button';
import type { AiCatalogItem, BankStatementConfig, InvoiceConfig } from '../../lib/types';
import { AiBadge, AiUnavailable } from '../../components/common/AiBadge';
import { aiPost, fetchAiStatus, useAiStatus } from '../../lib/ai/client';

/** Shape returned by /api/ai/query for bank statements (null = not mentioned). */
type AiBankQuery = {
  [K in 'count' | 'accountType' | 'locale' | 'currency' | 'startingBalance' | 'dateFrom' | 'dateTo' | 'transactionCount' | 'minAmount' | 'maxAmount' | 'minBalance' | 'preventNegative']: BankStatementConfig[K] | null;
} & { understood: string[] };
import { LOCALES, CURRENCIES } from '../../lib/constants';
import { generateSeed } from '../../lib/engine/random';
import { generateInvoices } from '../../lib/engine/invoice';
import { generateStatements } from '../../lib/engine/bank';
import { parseBankQuery, type ParsedBankQuery } from '../../lib/engine/bankQuery';
import { region } from '../../lib/engine/regions';
import { InvoicePreview } from './InvoicePreview';
import { BankStatementPreview } from './BankStatementPreview';

export type DocumentRequest =
  | { docType: 'invoice'; invoiceConfig: InvoiceConfig }
  | { docType: 'bank_statement'; bankConfig: BankStatementConfig };

const PREVIEW_INVOICES = 10;
const PREVIEW_STATEMENTS = 3;

const labelCls = 'text-xs font-medium text-[var(--color-text-secondary)] block mb-1.5';
const inputCls = 'w-full px-3 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm font-mono bg-transparent focus:border-[var(--color-primary)] outline-none';
const selectCls = 'w-full px-3 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm bg-[var(--color-surface)] focus:border-[var(--color-primary)] outline-none';

const optionalNumber = (v: string) => (v.trim() === '' ? undefined : Number(v));

export function StepDocuments({ seed, onSeedChange, onNext }: {
  seed?: number;
  onSeedChange: (seed: number | undefined) => void;
  onNext: (req: DocumentRequest) => void;
}) {
  const [docType, setDocType] = useState<'invoice' | 'bank_statement' | null>(null);
  const [invoiceConfig, setInvoiceConfig] = useState<InvoiceConfig>({
    count: 100, locale: 'PK', currency: 'PKR', taxRate: region('PK').defaultTaxRate, dateFrom: '2026-01-01', dateTo: '2026-12-31',
  });
  const [bankConfig, setBankConfig] = useState<BankStatementConfig>({
    count: 50, accountType: 'checking', locale: 'PK', currency: 'PKR', startingBalance: 10000,
    dateFrom: '2026-08-01', dateTo: '2026-08-31', transactionCount: 30,
  });
  const [query, setQuery] = useState('');
  const [parsed, setParsed] = useState<(ParsedBankQuery & { source: 'ai' | 'rules'; note?: string }) | null>(null);
  const [queryBusy, setQueryBusy] = useState(false);
  const [business, setBusiness] = useState('');
  const [itemsBusy, setItemsBusy] = useState(false);
  const [itemsNote, setItemsNote] = useState<string | null>(null);
  const aiStatus = useAiStatus();

  // Documents need a seed for the live preview; pick one if none is set.
  useEffect(() => { if (seed === undefined) onSeedChange(generateSeed()); }, [seed, onSeedChange]);

  // The preview is the real output: the first documents the full run will produce with this seed.
  const invoicePreview = useMemo(() => {
    if (docType !== 'invoice' || seed === undefined) return null;
    try { return { docs: generateInvoices({ ...invoiceConfig, count: Math.min(invoiceConfig.count, PREVIEW_INVOICES) }, seed), error: null }; }
    catch (e) { return { docs: [], error: (e as Error).message }; }
  }, [docType, invoiceConfig, seed]);
  const bankPreview = useMemo(() => {
    if (docType !== 'bank_statement' || seed === undefined) return null;
    try { return { docs: generateStatements({ ...bankConfig, count: Math.min(bankConfig.count, PREVIEW_STATEMENTS) }, seed), error: null }; }
    catch (e) { return { docs: [], error: (e as Error).message }; }
  }, [docType, bankConfig, seed]);

  const setInvoiceLocale = (locale: string) => {
    const r = region(locale);
    setInvoiceConfig(c => ({ ...c, locale, currency: r.currency, taxRate: r.defaultTaxRate }));
  };
  const setBankLocale = (locale: string) => setBankConfig(c => ({ ...c, locale, currency: region(locale).currency }));

  const applyQuery = async () => {
    setQueryBusy(true);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let note: string;
    const status = await fetchAiStatus();
    if (status.configured) {
      const res = await aiPost<AiBankQuery>('query', { kind: 'bank', text: query, today });
      if (res.ok) {
        const d = res.data;
        const next: BankStatementConfig = { ...bankConfig };
        (Object.keys(d) as (keyof AiBankQuery)[]).forEach(k => {
          if (k === 'understood' || d[k] === null) return;
          (next as unknown as Record<string, unknown>)[k] = d[k];
        });
        const understood = [...d.understood];
        const floor = next.minBalance ?? (next.preventNegative ? 0 : undefined);
        if (floor !== undefined && next.startingBalance < floor) {
          next.startingBalance = Math.ceil(floor * 2);
          understood.push(`Opening balance raised to ${next.startingBalance.toLocaleString()} so it starts above the minimum`);
        }
        setParsed({ config: next, understood, ignored: [], source: 'ai' });
        setBankConfig(next);
        setQueryBusy(false);
        return;
      }
      note = res.message;
    } else {
      note = 'no GEMINI_API_KEY configured';
    }
    const result = parseBankQuery(query, bankConfig);
    setParsed({ ...result, source: 'rules', note });
    setBankConfig(result.config);
    setQueryBusy(false);
  };

  const suggestItems = async () => {
    setItemsBusy(true);
    setItemsNote(null);
    const res = await aiPost<{ items: AiCatalogItem[] }>('content', { kind: 'invoice_items', business, locale: invoiceConfig.locale, count: 30 });
    if (res.ok) setInvoiceConfig(c => ({ ...c, aiCatalog: res.data.items }));
    else setItemsNote(res.message);
    setItemsBusy(false);
  };

  const seedField = (
    <div>
      <label className={labelCls}>Random Seed</label>
      <div className="flex gap-2">
        <input aria-label="Random Seed" type="number" value={seed ?? ''} onChange={e => onSeedChange(e.target.value === '' ? undefined : parseInt(e.target.value))} className={`${inputCls} w-28`} />
        <button onClick={() => onSeedChange(generateSeed())}
          className="px-3 py-2 text-xs border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] flex items-center gap-1.5">
          <RefreshCw size={12} /> Randomize
        </button>
      </div>
      <p className="text-xs text-[var(--color-text-muted)] mt-1">Same seed and settings produce the same documents.</p>
    </div>
  );

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">Document Generation</h2>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">Choose the type of document to generate.</p>
      </div>

      {!docType && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
          {[
            { id: 'invoice' as const, icon: <Receipt size={24} />, title: 'Invoice', desc: 'Generate realistic invoices with line items, tax, and regional formatting.' },
            { id: 'bank_statement' as const, icon: <Landmark size={24} />, title: 'Bank Statement', desc: 'Generate bank statements with merchants, transactions, and running balances.' },
          ].map(d => (
            <button
              key={d.id}
              onClick={() => setDocType(d.id)}
              className="text-left p-5 rounded-[var(--radius-lg)] border-2 border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-surface-2)] transition-all"
            >
              <div className="mb-3 text-[var(--color-text-secondary)]">{d.icon}</div>
              <h3 className="font-semibold text-sm text-[var(--color-text-primary)] mb-1">{d.title}</h3>
              <p className="text-xs text-[var(--color-text-secondary)]">{d.desc}</p>
            </button>
          ))}
        </div>
      )}

      {docType === 'invoice' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5 space-y-4 self-start">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Invoice Configuration</h3>
              <button onClick={() => setDocType(null)} className="text-xs text-[var(--color-text-muted)] hover:underline">← Back</button>
            </div>
            <div>
              <label className={labelCls}>Number of Invoices</label>
              <input aria-label="Number of Invoices" type="number" min={1} value={invoiceConfig.count} onChange={e => setInvoiceConfig(c => ({ ...c, count: Math.max(1, Math.min(100_000, parseInt(e.target.value) || 1)) }))} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Locale</label>
                <select aria-label="Locale" value={invoiceConfig.locale} onChange={e => setInvoiceLocale(e.target.value)} className={selectCls}>
                  {LOCALES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Currency</label>
                <select aria-label="Currency" value={invoiceConfig.currency} onChange={e => setInvoiceConfig(c => ({ ...c, currency: e.target.value }))} className={selectCls}>
                  {CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.value}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>{region(invoiceConfig.locale).taxLabel} Rate (%)</label>
              <input aria-label="Rate (%)" type="number" min={0} max={100} step={0.5} value={invoiceConfig.taxRate} onChange={e => setInvoiceConfig(c => ({ ...c, taxRate: Math.max(0, parseFloat(e.target.value) || 0) }))} className={`${inputCls} w-28`} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Date From</label>
                <input aria-label="Date From" type="date" value={invoiceConfig.dateFrom} onChange={e => setInvoiceConfig(c => ({ ...c, dateFrom: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Date To</label>
                <input aria-label="Date To" type="date" value={invoiceConfig.dateTo} onChange={e => setInvoiceConfig(c => ({ ...c, dateTo: e.target.value }))} className={inputCls} />
              </div>
            </div>
            {aiStatus?.configured && <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
              <label className={labelCls}>Seller’s business</label>
              <div className="flex gap-2">
                <input aria-label="Seller’s business" value={business} onChange={e => setBusiness(e.target.value)} placeholder="e.g. textile exporter in Faisalabad"
                  className="flex-1 px-3 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm bg-transparent focus:border-[var(--color-primary)] outline-none" />
                <Button size="sm" variant="outline" loading={itemsBusy} disabled={!aiStatus?.configured} onClick={suggestItems}>Suggest items</Button>
              </div>
              {itemsNote && <AiUnavailable message="Built-in catalogue used" detail={itemsNote} />}
              {invoiceConfig.aiCatalog?.length ? (
                <div className="flex items-start justify-between gap-2 bg-[var(--color-surface-2)] rounded-[var(--radius-md)] px-3 py-2">
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    <AiBadge /> {invoiceConfig.aiCatalog.length} items in use, e.g. {invoiceConfig.aiCatalog.slice(0, 3).map(i => `“${i.name}”`).join(', ')}
                  </p>
                  <button onClick={() => setInvoiceConfig(c => ({ ...c, aiCatalog: undefined }))} className="text-xs text-[var(--color-text-muted)] hover:underline shrink-0">Use built-in</button>
                </div>
              ) : null}
            </div>}
            {seedField}
            <p className="text-xs text-[var(--color-text-muted)]">
              Template: {region(invoiceConfig.locale).dateFormat} dates, “{region(invoiceConfig.locale).taxLabel}” tax label, {region(invoiceConfig.locale).taxIdLabel} tax ID.
            </p>
            <Button className="w-full" icon={<Sparkles size={15} />} disabled={!!invoicePreview?.error || seed === undefined}
              onClick={() => onNext({ docType: 'invoice', invoiceConfig })}>
              Generate {invoiceConfig.count.toLocaleString()} Invoices
            </Button>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">Preview</h3>
            {invoicePreview?.error
              ? <p className="text-xs text-[var(--color-error)]">{invoicePreview.error}</p>
              : invoicePreview && <InvoicePreview key={seed} invoices={invoicePreview.docs} totalCount={invoiceConfig.count} />}
          </div>
        </div>
      )}

      {docType === 'bank_statement' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Wand2 size={14} className="text-[var(--color-primary)]" />
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Describe the statements</h3>
              </div>
              <textarea
                aria-label="Describe the statements"
                value={query}
                onChange={e => setQuery(e.target.value)}
                rows={2}
                placeholder="e.g. last 90 days, never below 500, 40 transactions, savings account"
                className="w-full px-3 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm bg-transparent text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--color-text-muted)]">
                  Periods, counts, balances, amounts, account type and currency.
                </p>
                <Button size="sm" variant="outline" loading={queryBusy} onClick={applyQuery} disabled={!query.trim()}>Apply</Button>
              </div>
              {parsed && (
                <div className="space-y-1 bg-[var(--color-surface-2)] rounded-[var(--radius-md)] p-3">
                  {parsed.source === 'ai'
                    ? <p className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]"><AiBadge /> Understood:</p>
                    : aiStatus?.configured ? <AiUnavailable message="Built-in parser used" detail={parsed.note} /> : null}
                  {parsed.understood.length
                    ? parsed.understood.map(u => <p key={u} className="flex items-start gap-1.5 text-xs text-[var(--color-success)]"><CheckCircle size={12} className="shrink-0 mt-0.5" /> {u}</p>)
                    : <p className="text-xs text-[var(--color-warning)]">Nothing recognised. Settings unchanged.</p>}
                  {parsed.ignored.length > 0 && (
                    <p className="flex items-start gap-1.5 text-xs text-[var(--color-text-muted)]"><Info size={12} className="shrink-0 mt-0.5" /> Not understood: {parsed.ignored.map(s => `“${s}”`).join(', ')}</p>
                  )}
                  <p className="text-xs text-[var(--color-text-muted)]">Check the settings below, then generate.</p>
                </div>
              )}
            </div>

            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Bank Statement Configuration</h3>
                <button onClick={() => setDocType(null)} className="text-xs text-[var(--color-text-muted)] hover:underline">← Back</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Number of Statements</label>
                  <input aria-label="Number of Statements" type="number" min={1} value={bankConfig.count} onChange={e => setBankConfig(c => ({ ...c, count: Math.max(1, Math.min(10_000, parseInt(e.target.value) || 1)) }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Transactions per Statement</label>
                  <input aria-label="Transactions per Statement" type="number" min={1} value={bankConfig.transactionCount} onChange={e => setBankConfig(c => ({ ...c, transactionCount: Math.max(1, Math.min(5_000, parseInt(e.target.value) || 1)) }))} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Account Type</label>
                <select aria-label="Account Type" value={bankConfig.accountType} onChange={e => setBankConfig(c => ({ ...c, accountType: e.target.value as BankStatementConfig['accountType'] }))} className={selectCls}>
                  <option value="checking">Checking</option>
                  <option value="savings">Savings</option>
                  <option value="business">Business</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Locale</label>
                  <select aria-label="Locale" value={bankConfig.locale} onChange={e => setBankLocale(e.target.value)} className={selectCls}>
                    {LOCALES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Currency</label>
                  <select aria-label="Currency" value={bankConfig.currency} onChange={e => setBankConfig(c => ({ ...c, currency: e.target.value }))} className={selectCls}>
                    {CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.value}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Starting Balance</label>
                  <input aria-label="Starting Balance" type="number" value={bankConfig.startingBalance} onChange={e => setBankConfig(c => ({ ...c, startingBalance: parseFloat(e.target.value) || 0 }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Minimum Balance (optional)</label>
                  <input aria-label="Minimum Balance (optional)" type="number" value={bankConfig.minBalance ?? ''} placeholder="None" onChange={e => setBankConfig(c => ({ ...c, minBalance: optionalNumber(e.target.value) }))} className={inputCls} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
                <input type="checkbox" checked={!!bankConfig.preventNegative} onChange={e => setBankConfig(c => ({ ...c, preventNegative: e.target.checked }))} className="accent-[var(--color-primary)]" />
                Never let the balance go negative
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Min Amount (optional)</label>
                  <input aria-label="Min Amount (optional)" type="number" value={bankConfig.minAmount ?? ''} placeholder="None" onChange={e => setBankConfig(c => ({ ...c, minAmount: optionalNumber(e.target.value) }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Max Amount (optional)</label>
                  <input aria-label="Max Amount (optional)" type="number" value={bankConfig.maxAmount ?? ''} placeholder="None" onChange={e => setBankConfig(c => ({ ...c, maxAmount: optionalNumber(e.target.value) }))} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Date From</label>
                  <input aria-label="Date From" type="date" value={bankConfig.dateFrom} onChange={e => setBankConfig(c => ({ ...c, dateFrom: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Date To</label>
                  <input aria-label="Date To" type="date" value={bankConfig.dateTo} onChange={e => setBankConfig(c => ({ ...c, dateTo: e.target.value }))} className={inputCls} />
                </div>
              </div>
              {seedField}
              <Button className="w-full" icon={<Sparkles size={15} />} disabled={!!bankPreview?.error || seed === undefined}
                onClick={() => onNext({ docType: 'bank_statement', bankConfig })}>
                Generate {bankConfig.count.toLocaleString()} Statements
              </Button>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">Preview</h3>
            {bankPreview?.error
              ? <p className="text-xs text-[var(--color-error)]">{bankPreview.error}</p>
              : bankPreview && <BankStatementPreview key={seed} statements={bankPreview.docs} totalCount={bankConfig.count} />}
          </div>
        </div>
      )}
    </div>
  );
}
