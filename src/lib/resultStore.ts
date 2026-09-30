// Latest generation result, shared between pages (Workspace → Quality).
// Lives in memory for the browser tab; a full page reload clears it.

import { useSyncExternalStore } from 'react';
import type { DocumentResult, Generation, RelationalResult, TabularResult } from './types';

export interface LatestResult {
  generation: Generation;
  /** Single-table generation. */
  result?: TabularResult;
  /** Multi-table generation. */
  relational?: RelationalResult;
  /** Invoice or bank statement generation. */
  documents?: DocumentResult;
  /** Name(s) of the uploaded file(s) the data was learned from, if any. */
  sourceName?: string;
}

let latest: LatestResult | null = null;
const listeners = new Set<() => void>();

export function setLatestResult(value: LatestResult | null) {
  latest = value;
  listeners.forEach(l => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useLatestResult(): LatestResult | null {
  return useSyncExternalStore(subscribe, () => latest, () => null);
}

/** Per-table results for either kind of generation. */
export function resultTables(latest: LatestResult): TabularResult[] {
  return latest.relational?.tables ?? (latest.result ? [latest.result] : []);
}
