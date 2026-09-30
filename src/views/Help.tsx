'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { AiBadge } from '../components/common/AiBadge';

const faqs = [
  {
    q: 'What is synthetic data?',
    a: 'Synthetic data is artificially generated data that mirrors the statistical properties of real data without containing any actual records. It is used for development, testing, machine learning, and demos without exposing sensitive production information.',
  },
  {
    q: 'How does generation work?',
    a: 'Synthra reads your file in the browser, detects each column\'s type and meaning with rules, and learns its distribution (ranges, frequencies, correlations). It then generates new rows that follow the same patterns in a background worker. Names, emails and other personal data are always freshly generated, never copied. The same seed always gives the same data.',
  },
  {
    q: 'What does schema analysis mean?',
    a: 'Schema analysis is the process of examining your input file or schema definition to detect column types, semantic meanings (e.g., email, phone, name), privacy sensitivity levels, and statistical distributions. This analysis drives realistic data generation.',
  },
  {
    q: 'What is referential integrity?',
    a: 'In relational datasets, referential integrity means that foreign keys always reference valid records in parent tables. For example, every Order will reference an existing Customer. Synthra enforces this across generated tables.',
  },
  {
    q: 'How do privacy controls work?',
    a: 'Privacy controls let you specify how sensitive fields are handled. Options include: Synthetic replacement (generates realistic but fake values), Masking (replaces characters with asterisks), and Hashing (applies a one-way hash). PII fields are automatically detected.',
  },
  {
    q: 'Where does my data go?',
    a: 'Nowhere, unless you use AI. Files are read and generated in your browser; there is no database or backend storing them. History keeps only configurations, seeds and learned statistics in this browser so datasets can be regenerated. When AI is enabled, only the small pieces listed in "What the AI does" are sent to Google Gemini through this app\'s server, and detected personal data is masked first. With a free-tier key Google may use requests to improve its products, so only upload test or public data.',
  },
  {
    q: 'What formats can I export?',
    a: 'Tabular data: CSV (opens in Excel) and JSON. Relational data: a ZIP with one CSV per table, JSON, or SQL (CREATE TABLE with keys, then INSERTs in dependency order). Invoices and bank statements: PDF, CSV and JSON. Files are built in your browser in chunks, so large datasets do not freeze the page.',
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-[var(--color-border)] rounded-[var(--radius-lg)] overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] transition-colors text-left"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        {q}
        {open ? <ChevronDown size={16} className="shrink-0 text-[var(--color-text-muted)]" /> : <ChevronRight size={16} className="shrink-0 text-[var(--color-text-muted)]" />}
      </button>
      {open && (
        <div className="px-5 pb-4 text-sm text-[var(--color-text-secondary)] leading-relaxed border-t border-[var(--color-border)] pt-4 bg-[var(--color-surface)]">
          {a}
        </div>
      )}
    </div>
  );
}

export function Help() {
  return (
    <div className="p-6 lg:p-8 max-w-[800px] mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-1">Help & Documentation</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">Learn how to use Synthra effectively.</p>
      </div>

      <div className="mb-8">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">Quick Workflow</h2>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">Follow these steps to generate synthetic data:</p>
        <div className="space-y-2">
          {[
            { n: '1', label: 'Select data type', desc: 'Choose between Tabular, Relational, or Document generation.' },
            { n: '2', label: 'Upload or define schema', desc: 'Upload a CSV/JSON file or define your schema manually.' },
            { n: '3', label: 'Configure generation', desc: 'Set row count, locale, privacy rules, and edge cases.' },
            { n: '4', label: 'Generate', desc: 'Click Generate Data and watch the progress in real time.' },
            { n: '5', label: 'Validate & preview', desc: 'Inspect generated data, check validation results and statistics.' },
            { n: '6', label: 'Export', desc: 'Download your dataset in CSV, JSON, SQL, or PDF format.' },
          ].map(step => (
            <div key={step.n} className="flex gap-3 p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)]">
              <div className="w-6 h-6 rounded-full bg-[var(--color-primary)] text-white text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">{step.n}</div>
              <div>
                <p className="text-sm font-medium text-[var(--color-text-primary)]">{step.label}</p>
                <p className="text-xs text-[var(--color-text-secondary)]">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-8">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">What the AI does (and what happens without it)</h2>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          AI is an optional helper. Everything works without it — the app simply uses its built-in rules instead.
          Anything the AI produced carries a small <AiBadge /> badge; if you don’t see the badge, the AI was not used.
        </p>
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--color-surface-2)] text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                <th className="text-left px-4 py-2.5 font-medium">Feature</th>
                <th className="text-left px-3 py-2.5 font-medium">With AI</th>
                <th className="text-left px-3 py-2.5 font-medium">Without AI (fallback)</th>
                <th className="text-left px-3 py-2.5 font-medium">What is sent</th>
              </tr>
            </thead>
            <tbody className="text-xs text-[var(--color-text-secondary)]">
              {[
                ['Schema check after upload', 'Second opinion on each column’s meaning and privacy, with a reason. You choose where it disagrees.', 'Rule-based detection from column names and values.', 'Column names + 10 sample rows (detected personal data masked, long text cut).'],
                ['Relationships between uploaded CSVs', 'Extra foreign-key suggestions with reasons.', 'Value and naming checks (e.g. customer_id).', 'Same as above, per table.'],
                ['Describe your dataset', 'Turns a sentence into columns, ranges and rules.', 'Reads the column list after “with …” and ranges like 18-60.', 'Your sentence.'],
                ['Free-text columns', '50 realistic values per column, fetched once and reused.', 'Built-in generator (faker, lorem text).', 'Column name, other column names, a few non-personal examples.'],
                ['Edge cases', 'Edge cases specific to your data; tick the ones you want.', 'The built-in edge cases (nulls, outliers, boundaries…).', 'Column names, types and short summaries (ranges, % missing).'],
                ['Bank statement request', 'Understands free-form requests.', 'Rule-based parser (periods, counts, balances, currency…).', 'Your request text.'],
                ['Invoice line items', 'Items that fit the seller’s business.', 'Built-in catalogue of 20 products and services.', 'Your business description.'],
                ['Quality page', 'Plain-English summary and what to change.', 'The scores, warnings and tooltips already on the page.', 'Scores, warnings and settings — no data rows.'],
              ].map(row => (
                <tr key={row[0]} className="border-b border-[var(--color-border)] last:border-0 align-top">
                  <td className="px-4 py-2.5 font-medium text-[var(--color-text-primary)]">{row[0]}</td>
                  <td className="px-3 py-2.5">{row[1]}</td>
                  <td className="px-3 py-2.5">{row[2]}</td>
                  <td className="px-3 py-2.5">{row[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[var(--color-text-muted)] mt-3">
          Turning AI on: copy <code className="font-mono">.env.example</code> to <code className="font-mono">.env.local</code>, set <code className="font-mono">GEMINI_API_KEY</code> (a free key from Google AI Studio works), restart the server.
          The key stays on the server. If the key is missing, wrong, or the AI takes longer than 15 seconds, you’ll see
          “AI unavailable, using rule-based detection” and the app carries on with the rules.
        </p>
      </div>

      <div>
        <h2 className="text-base font-semibold text-[var(--color-text-primary)] mb-4">Frequently Asked Questions</h2>
        <div className="space-y-2">
          {faqs.map(faq => <FAQItem key={faq.q} {...faq} />)}
        </div>
      </div>

      <div className="mt-8 p-4 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-[var(--radius-lg)] text-sm text-[var(--color-text-secondary)]">
        <p className="font-semibold text-[var(--color-text-primary)] mb-1">Synthra</p>
        <p>Synthetic Data Platform · Built for HackFest 2026</p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">All generated data is entirely synthetic. No real production records are ever required or stored.</p>
      </div>
    </div>
  );
}
