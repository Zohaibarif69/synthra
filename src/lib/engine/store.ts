// In-memory store for parsed uploads, keyed by the fileId returned from uploadDataset().
// Data lives only in this browser tab; nothing is sent to a server.

import type { ParsedDataset } from '../types';

const MAX_DATASETS = 3;
const datasets = new Map<string, ParsedDataset>();
let counter = 0;

export function putDataset(dataset: ParsedDataset): string {
  const id = `file_${Date.now().toString(36)}_${++counter}`;
  datasets.set(id, dataset);
  while (datasets.size > MAX_DATASETS) {
    const oldest = datasets.keys().next().value;
    if (oldest === undefined) break;
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
