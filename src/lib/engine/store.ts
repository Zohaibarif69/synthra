// In-memory store for parsed uploads, keyed by the fileId returned from uploadDataset().
// Data lives only in this browser tab; nothing is sent to a server.

import type { ParsedDataset } from '../types';

/**
 * Relational uploads can bring many tables at once (customers, orders, order_items, products…), and every one
 * must stay in memory for relationship detection, comparisons and leak checks. Older uploads are dropped only
 * when there are more than MAX_DATASETS files or more than MAX_TOTAL_ROWS rows in total, and the newest
 * upload is always kept.
 */
export const MAX_DATASETS = 20;
export const MAX_TOTAL_ROWS = 2_000_000;
const datasets = new Map<string, ParsedDataset>();
let counter = 0;

function totalRows(): number {
  let n = 0;
  for (const d of datasets.values()) n += d.rows.length;
  return n;
}

export function putDataset(dataset: ParsedDataset): string {
  const id = `file_${Date.now().toString(36)}_${++counter}`;
  datasets.set(id, dataset);
  while (datasets.size > 1 && (datasets.size > MAX_DATASETS || totalRows() > MAX_TOTAL_ROWS)) {
    const oldest = datasets.keys().next().value;
    if (oldest === undefined || oldest === id) break;
    datasets.delete(oldest);
  }
  return id;
}

export function getDataset(id: string): ParsedDataset | undefined {
  return datasets.get(id);
}

export function removeDataset(id: string): void {
  datasets.delete(id);
}
