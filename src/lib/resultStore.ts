// Latest generation result, shared between pages (Workspace → Quality).
// Lives in memory for the browser tab; a full page reload clears it.

import { useSyncExternalStore } from 'react';
import type { DocumentResult, Generation, RelationalResult, TabularResult } from './types';
import type { TstrSource } from './engine/client';
import type { TstrResult } from './engine/tstr';

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
  /** Single-table runs learned from an upload: what the TSTR utility test needs. */
  tstrSource?: TstrSource;
}

let latest: LatestResult | null = null;
/** TSTR results for the latest generation, by target column; cleared when a new generation arrives. */
const tstrResults = new Map<string, TstrResult>();
const listeners = new Set<() => void>();

export function setLatestResult(value: LatestResult | null) {
  latest = value;
  tstrResults.clear();
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


export function getTstrResult(target: string): TstrResult | undefined {
  return tstrResults.get(target);
}

export function setTstrResult(result: TstrResult) {
  tstrResults.set(result.target, result);
  listeners.forEach(l => l());
}

/** The most recent TSTR result, for the exported quality report. */
export function latestTstrResult(): TstrResult | undefined {
  return [...tstrResults.values()].pop();
}
