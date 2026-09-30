// Saved schemas in localStorage, reusable across sessions.

import type { ColumnRule, ColumnSchema, ConsistencyRule, Relationship, TableSchema } from './types';
import { createLocalStore } from './localStore';

export interface SavedSchema {
  id: string;
  name: string;
  kind: 'tabular' | 'relational';
  createdAt: string;
  columns?: ColumnSchema[];
  design?: { tables: TableSchema[]; relationships: Relationship[]; rules: ConsistencyRule[] };
  columnRules?: ColumnRule[];
}

export const schemaLibrary = createLocalStore<SavedSchema[]>('synthra:schemas:v1', []);

export function saveSchema(s: Omit<SavedSchema, 'id' | 'createdAt'>): boolean {
  const entry: SavedSchema = { ...s, id: `schema_${Date.now().toString(36)}`, createdAt: new Date().toISOString() };
  // Same name and kind replaces the older copy.
  return schemaLibrary.set(list => [entry, ...list.filter(x => !(x.name === s.name && x.kind === s.kind))]);
}

export function deleteSchema(id: string) {
  schemaLibrary.set(list => list.filter(x => x.id !== id));
}
