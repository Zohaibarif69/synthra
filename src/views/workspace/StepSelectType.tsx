'use client';

import React from 'react';
import { Table, Database, Receipt, Landmark, ChevronRight } from 'lucide-react';
import { Button } from '../../components/common/Button';
import type { DataType } from '../../lib/types';

export function StepSelectType({ selected, onSelect, onNext }: {
  selected: DataType | null;
  onSelect: (t: DataType) => void;
  onNext: () => void;
}) {
  const types: { id: DataType; icon: React.ReactNode; title: string; desc: string }[] = [
    { id: 'tabular', icon: <Table size={24} />, title: 'Tabular Data', desc: 'Single-table structured data from CSV, JSON, or manual schema.' },
    { id: 'relational', icon: <Database size={24} />, title: 'Relational Data', desc: 'Connected multi-table datasets with referential integrity.' },
    { id: 'invoice', icon: <Receipt size={24} />, title: 'Invoices', desc: 'Generate realistic invoices with line items, tax, and regional formatting.' },
    { id: 'bank_statement', icon: <Landmark size={24} />, title: 'Bank Statements', desc: 'Generate bank statements with merchants, transactions, and running balances.' },
  ];

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">What do you want to generate?</h2>
      <p className="text-sm text-[var(--color-text-secondary)] mb-6">Select a data category to begin.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        {types.map(t => (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={`text-left p-5 rounded-[var(--radius-lg)] border-2 transition-all hover:border-[var(--color-primary)]/50 ${
              selected === t.id
                ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]'
            }`}
          >
            <div className={`mb-3 ${selected === t.id ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)]'}`}>{t.icon}</div>
            <h3 className="font-semibold text-sm text-[var(--color-text-primary)] mb-1">{t.title}</h3>
            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">{t.desc}</p>
          </button>
        ))}
      </div>
      <Button disabled={!selected} onClick={onNext} iconRight={<ChevronRight size={15} />}>
        Continue
      </Button>
    </div>
  );
}
