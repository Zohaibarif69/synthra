'use client';

import React, { useState } from 'react';
import { Wand2 } from 'lucide-react';
import { Button } from '../../components/common/Button';
import { AiBadge, AiUnavailable } from '../../components/common/AiBadge';
import type { ColumnRule, ColumnSchema } from '../../lib/types';
import { aiPost, fetchAiStatus } from '../../lib/ai/client';
import { parsePromptSchema, type PromptSchema } from '../../lib/engine/promptSchema';
import { defaultPrivacy } from '../../lib/engine/infer';

interface AiTabular {
  rowCount: number | null;
  locale: string | null;
  columns: {
    name: string; type: ColumnSchema['type']; semanticType: string; nullable: boolean; unique: boolean;
    privacyLevel: 'low' | 'medium' | 'high'; min: number | null; max: number | null; allowedValues: string[];
  }[];
}

export interface DescribedSchema extends PromptSchema {
  source: 'ai' | 'rules';
}

/** "Generate 1000 Pakistani customers with name, city, phone, age 18-60" → a schema for the builder. */
export function DescribeSchemaBox({ onResult }: { onResult: (r: DescribedSchema) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ source: 'ai' | 'rules'; columns: number; note?: string } | null>(null);

  const run = async () => {
    setBusy(true);
    setOutcome(null);
    let note: string | undefined;
    const status = await fetchAiStatus();
    if (status.configured) {
      const res = await aiPost<AiTabular>('query', { kind: 'tabular', text });
      if (res.ok) {
        const rules: ColumnRule[] = [];
        const columns: ColumnSchema[] = res.data.columns.map(c => {
          if (c.min !== null || c.max !== null) rules.push({ id: `ai_${c.name}_range`, kind: 'range', column: c.name, ...(c.min !== null ? { min: c.min } : {}), ...(c.max !== null ? { max: c.max } : {}) });
          if (c.allowedValues.length) rules.push({ id: `ai_${c.name}_allowed`, kind: 'allowed', column: c.name, values: c.allowedValues });
          const p = defaultPrivacy(c.name, c.semanticType);
          return { name: c.name, type: c.type, semanticType: c.semanticType, nullable: c.nullable, unique: c.unique, privacyLevel: c.privacyLevel, privacyTransform: c.privacyLevel === 'high' ? (p.transform === 'preserve' ? 'synthetic' : p.transform) : p.transform };
        });
        onResult({ source: 'ai', rowCount: res.data.rowCount, locale: res.data.locale, columns, rules });
        setOutcome({ source: 'ai', columns: columns.length });
        setBusy(false);
        return;
      }
      note = res.message;
    }
    const fallback = parsePromptSchema(text);
    if (fallback.columns.length) onResult({ ...fallback, source: 'rules' });
    setOutcome({ source: 'rules', columns: fallback.columns.length, note });
    setBusy(false);
  };

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4 space-y-2">
      <div className="flex items-center gap-2">
        <Wand2 size={14} className="text-[var(--color-primary)]" />
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Describe your dataset</h3>
      </div>
      <textarea
        aria-label="Describe your dataset"
        value={text}
        onChange={e => setText(e.target.value)}
        rows={2}
        placeholder="e.g. generate 1000 Pakistani customers with name, city, phone, age 18-60"
        className="w-full px-3 py-2 border border-[var(--color-border)] rounded-[var(--radius-md)] text-sm bg-transparent text-[var(--color-text-primary)] focus:border-[var(--color-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
      />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          {outcome?.source === 'ai' && (
            <p className="flex items-center gap-1.5 text-xs text-[var(--color-success)]"><AiBadge /> {outcome.columns} columns drafted. Review them below.</p>
          )}
          {outcome?.source === 'rules' && (
            <div className="space-y-0.5">
              {outcome.note && <AiUnavailable message="Couldn't reach AI. Built-in parser used." detail={outcome.note} />}
              <p className="text-xs text-[var(--color-text-secondary)]">
                {outcome.columns ? `${outcome.columns} columns created. Review them below.` : 'No column list found. Try "… with name, email, age 18-60".'}
              </p>
            </div>
          )}
        </div>
        <Button size="sm" variant="outline" loading={busy} disabled={!text.trim()} onClick={run}>Build schema</Button>
      </div>
    </div>
  );
}
