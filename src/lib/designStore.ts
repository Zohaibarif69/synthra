// The relational schema being designed: tables, relationships, rules and uploaded sources.
// Shared by the Workspace relational step and the Relationships page, and read by the generator.
// Lives in memory for the browser tab; a full page reload clears it.

import { useSyncExternalStore } from 'react';
import type { ConsistencyRule, DatasetProfile, Relationship, TableSchema } from './types';

export interface TableSource {
  fileId: string;
  fileName: string;
  profile: DatasetProfile | null;
}

export interface RelationalDesign {
  tables: TableSchema[];
  relationships: Relationship[];
  rules: ConsistencyRule[];
  sources: Record<string, TableSource>;
}

export const EMPTY_DESIGN: RelationalDesign = { tables: [], relationships: [], rules: [], sources: {} };

let design: RelationalDesign = EMPTY_DESIGN;
const listeners = new Set<() => void>();

export function getDesign(): RelationalDesign {
  return design;
}

export function setDesign(next: RelationalDesign | ((d: RelationalDesign) => RelationalDesign)) {
  design = typeof next === 'function' ? next(design) : next;
  listeners.forEach(l => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useRelationalDesign(): [RelationalDesign, typeof setDesign] {
  const value = useSyncExternalStore(subscribe, getDesign, () => EMPTY_DESIGN);
  return [value, setDesign];
}
