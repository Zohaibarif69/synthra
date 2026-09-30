'use client';

import React from 'react';
import { Database } from 'lucide-react';
import type { TableSchema } from '../../lib/types';

export const NODE_WIDTH = 176;
export const NODE_HEADER = 44;
export const NODE_ROW = 20;

export function RelationshipNode({ table, x, y, rows, derived, keys, foreignKeys, isJoin }: {
  table: TableSchema;
  x: number;
  y: number;
  rows?: number;
  derived?: boolean;
  keys: Set<string>;
  foreignKeys: Set<string>;
  isJoin?: boolean;
}) {
  return (
    <div
      className={`absolute bg-[var(--color-surface)] border rounded-[var(--radius-lg)] shadow-sm hover:border-[var(--color-primary)]/50 transition-colors ${isJoin ? 'border-dashed border-[var(--color-border-strong)]' : 'border-[var(--color-border)]'}`}
      style={{ left: x, top: y, width: NODE_WIDTH }}
    >
      <div className="bg-[var(--color-primary-light)] px-3 rounded-t-[var(--radius-lg)] border-b border-[var(--color-border)] flex flex-col justify-center" style={{ height: NODE_HEADER }}>
        <p className="text-xs font-semibold text-[var(--color-primary)] flex items-center gap-1 truncate">
          <Database size={11} /> {table.name}
        </p>
        <p className="text-xs text-[var(--color-primary)]/70">
          {isJoin ? 'join table · ' : ''}{rows !== undefined ? `${derived ? '~' : ''}${rows.toLocaleString()} rows` : ''}
        </p>
      </div>
      <div className="px-2 py-1">
        {table.columns.map(col => (
          <div key={col.name} className="flex items-center gap-1.5" style={{ height: NODE_ROW }}>
            <span className="text-xs font-mono text-[var(--color-text-secondary)] truncate">{col.name}</span>
            {keys.has(col.name) && (
              <span className="px-1 bg-amber-50 text-amber-600 rounded text-[10px] font-medium">PK</span>
            )}
            {foreignKeys.has(col.name) && (
              <span className="px-1 bg-blue-50 text-blue-600 rounded text-[10px] font-medium">FK</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
