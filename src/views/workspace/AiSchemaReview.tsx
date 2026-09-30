'use client';

import React from 'react';
import { Sparkles, Check } from 'lucide-react';
import { AiBadge, AiUnavailable } from '../../components/common/AiBadge';
import { PrivacyBadge } from '../../components/common/Badge';
import type { AiColumnSuggestion, ColumnSchema } from '../../lib/types';
import { allowedTransforms } from '../../lib/engine/privacy';

export interface AiSchemaState {
  status: 'idle' | 'loading' | 'done' | 'unavailable';
  message?: string;
  model?: string;
  columns?: AiColumnSuggestion[];
  /** Per column: which side the user picked where rules and AI disagree. */
  decisions: Record<string, 'ai' | 'rules'>;
}

export const AI_SCHEMA_IDLE: AiSchemaState = { status: 'idle', decisions: {} };

function disagreements(col: ColumnSchema, ai: AiColumnSuggestion): string[] {
  const out: string[] = [];
  if ((col.semanticType ?? 'Other') !== ai.semanticType) out.push('semantic type');
  if ((col.privacyLevel ?? 'low') !== ai.privacyLevel) out.push('privacy level');
  if ((col.privacyTransform ?? 'preserve') !== ai.transform && allowedTransforms(col).includes(ai.transform)) out.push('transform');
  return out;
}

export function AiSchemaReview({ schema, state, onChoose }: {
  schema: ColumnSchema[];
  state: AiSchemaState;
  /** Applies the AI suggestion to a column (or records that the rules were kept). */
  onChoose: (column: string, choice: 'ai' | 'rules', ai: AiColumnSuggestion) => void;
}) {
  if (state.status === 'idle') return null;

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="text-[var(--color-primary)]" />
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">AI Review</h3>
        {state.status === 'done' && <AiBadge title={`Suggestions from ${state.model}`} />}
      </div>

      {state.status === 'loading' && (
        <p className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <span className="w-3 h-3 border border-[var(--color-primary)] border-t-transparent rounded-full spinning" />
          Reviewing columns…
        </p>
      )}

      {state.status === 'unavailable' && <AiUnavailable message="Couldn't reach AI. Built-in detection is in use." detail={state.message} />}

      {state.status === 'done' && state.columns && (
        <>
          <p className="text-xs text-[var(--color-text-muted)]">
            Where AI disagrees with the detected schema, choose which to keep.
          </p>
          <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                  <th className="text-left px-3 py-2 font-medium">Column</th>
                  <th className="text-left px-3 py-2 font-medium">Rules</th>
                  <th className="text-left px-3 py-2 font-medium">AI</th>
                  <th className="text-left px-3 py-2 font-medium">Reason (AI)</th>
                  <th className="text-left px-3 py-2 font-medium">Choice</th>
                </tr>
              </thead>
              <tbody>
                {state.columns.map(ai => {
                  const current = schema.find(c => (c.sourceColumn ?? c.name) === ai.column);
                  if (!current) return null;
                  // Compare against the rule-based result even after the user switched to the AI suggestion.
                  const col = current.ruleBased ? { ...current, ...current.ruleBased } : current;
                  const diff = disagreements(col, ai);
                  const decision = state.decisions[ai.column];
                  return (
                    <tr key={ai.column} className="border-b border-[var(--color-border)] last:border-0 align-top">
                      <td className="px-3 py-2 font-mono text-[var(--color-text-primary)]">
                        {current.name}
                        {decision === 'ai' && <span className="block mt-0.5"><AiBadge title="This column now uses the AI suggestion" /></span>}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                        <div>{col.semanticType ?? 'Other'}</div>
                        <div className="flex items-center gap-1 mt-0.5">{col.privacyLevel && <PrivacyBadge level={col.privacyLevel} />} <span className="text-[var(--color-text-muted)]">{col.privacyTransform ?? 'preserve'}</span></div>
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                        <div>{ai.semanticType}{ai.pii ? ' · PII' : ''}</div>
                        <div className="flex items-center gap-1 mt-0.5"><PrivacyBadge level={ai.privacyLevel} /> <span className="text-[var(--color-text-muted)]">{ai.transform}</span></div>
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text-muted)] max-w-xs">{ai.reason}</td>
                      <td className="px-3 py-2">
                        {!diff.length ? (
                          <span className="inline-flex items-center gap-1 text-[var(--color-success)]"><Check size={12} /> Agrees</span>
                        ) : (
                          <div className="space-y-1">
                            <p className="text-[var(--color-warning)]">Differs: {diff.join(', ')}</p>
                            <div className="flex gap-1">
                              <button
                                onClick={() => onChoose(ai.column, 'ai', ai)}
                                className={`px-2 py-0.5 rounded border ${decision === 'ai' ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]' : 'border-[var(--color-border)] hover:bg-[var(--color-surface-2)]'}`}
                              >Use AI</button>
                              <button
                                onClick={() => onChoose(ai.column, 'rules', ai)}
                                className={`px-2 py-0.5 rounded border ${decision !== 'ai' ? 'bg-[var(--color-surface-2)] border-[var(--color-border-strong)]' : 'border-[var(--color-border)] hover:bg-[var(--color-surface-2)]'}`}
                              >Keep rules</button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
