'use client';

import React, { useState } from 'react';
import type { BankStatement } from '../../lib/types';
import { formatDate } from '../../lib/engine/dates';
import { formatMoney, isoToTs } from '../../lib/engine/regions';
import { DocPager, SyntheticFooter, SyntheticWatermark } from './InvoicePreview';

export function BankStatementPreview({ statements, totalCount }: { statements: BankStatement[]; totalCount?: number }) {
  const [index, setIndex] = useState(0);
  const st = statements[Math.min(index, statements.length - 1)];
  if (!st) return <p className="text-xs text-[var(--color-text-muted)]">No statements to preview.</p>;
  const money = (c: number) => formatMoney(c, st.currency, st.intlLocale);
  const date = (iso: string) => formatDate(isoToTs(iso), st.dateFormat);

  return (
    <div>
      <DocPager index={index} total={statements.length} label={totalCount && totalCount > statements.length ? `Preview (first ${statements.length} of ${totalCount.toLocaleString()}) · statement` : 'Statement'} onChange={setIndex} />
      <div className="relative overflow-hidden bg-white border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6 font-mono text-xs shadow-sm max-w-lg text-slate-700">
        <SyntheticWatermark />
        <div className="mb-4 flex justify-between gap-4">
          <div>
            <p className="text-base font-bold text-slate-900">BANK STATEMENT</p>
            <p className="text-slate-500">{st.bankName}</p>
            <p className="text-slate-500">{st.accountHolder}</p>
          </div>
          <div className="text-right text-slate-500">
            <p>Account: {st.accountNumber}</p>
            <p className="capitalize">{st.accountType} account</p>
            <p>{date(st.periodFrom)} – {date(st.periodTo)}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mb-3 text-slate-600">
          <span>Opening balance</span><span className="text-right">{money(st.openingBalanceCents)}</span>
          <span>Total credits</span><span className="text-right text-green-700">+{money(st.totalCreditsCents)}</span>
          <span>Total debits</span><span className="text-right text-red-700">−{money(st.totalDebitsCents)}</span>
          <span className="font-bold text-slate-900">Closing balance</span><span className="text-right font-bold text-slate-900">{money(st.closingBalanceCents)}</span>
        </div>
        <div className="border-t border-slate-200 pt-2">
          <div className="grid grid-cols-[4.5rem_1fr_5rem_5rem_6rem] gap-x-2 text-slate-500 mb-2 text-[11px]">
            <span>Date</span><span>Description</span><span className="text-right">Debit</span><span className="text-right">Credit</span><span className="text-right">Balance</span>
          </div>
          <div className="max-h-80 overflow-auto">
            {st.transactions.map((t, i) => (
              <div key={i} className="grid grid-cols-[4.5rem_1fr_5rem_5rem_6rem] gap-x-2 py-1.5 border-b border-slate-100 text-[11px]">
                <span className="text-slate-500">{date(t.date)}</span>
                <span className="text-slate-900 truncate" title={t.description}>{t.description}</span>
                <span className="text-right text-red-700">{t.debitCents ? money(t.debitCents) : ''}</span>
                <span className="text-right text-green-700">{t.creditCents ? money(t.creditCents) : ''}</span>
                <span className="text-right font-medium text-slate-900">{money(t.balanceCents)}</span>
              </div>
            ))}
          </div>
        </div>
        <SyntheticFooter />
      </div>
    </div>
  );
}
