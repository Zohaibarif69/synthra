'use client';

import React, { useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { Database } from 'lucide-react';
import { handleId, MAX_VISIBLE_COLUMNS, MORE_COLUMN, NODE_HEADER_HEIGHT, NODE_ROW_HEIGHT, NODE_WIDTH, type ErTable } from '../../lib/erGraph';

export type TableNodeData = {
  table: ErTable;
  expanded: boolean;
  dimmed: boolean;
  highlighted: boolean;
  rows?: number;
  onToggleExpand: (table: string) => void;
};

export type TableNodeType = Node<TableNodeData, 'table'>;

function KeyBadge({ kind }: { kind: 'PK' | 'FK' }) {
  const pk = kind === 'PK';
  return (
    <span
      className="px-1 rounded text-[10px] font-semibold leading-4 shrink-0"
      style={{ color: pk ? 'var(--color-pk)' : 'var(--color-fk)', background: pk ? 'var(--color-pk-bg)' : 'var(--color-fk-bg)' }}
    >
      {kind}
    </span>
  );
}

export function TableNode({ id, data }: NodeProps<TableNodeType>) {
  const { table, expanded, dimmed, highlighted, rows, onToggleExpand } = data;
  const updateNodeInternals = useUpdateNodeInternals();

  // Handles appear/disappear when the column list expands; React Flow must re-measure them.
  useEffect(() => { updateNodeInternals(id); }, [id, expanded, table.visible.length, updateNodeInternals]);

  return (
    <div
      className={`rounded-[var(--radius-lg)] border bg-[var(--color-surface)] shadow-sm transition-opacity ${highlighted ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/20' : 'border-[var(--color-border-strong)]'}`}
      style={{ width: NODE_WIDTH, opacity: dimmed ? 0.35 : 1 }}
    >
      <div
        className="px-3 flex items-center justify-between gap-2 rounded-t-[var(--radius-lg)] bg-[var(--color-primary-light)] border-b border-[var(--color-border)]"
        style={{ height: NODE_HEADER_HEIGHT }}
      >
        <span className="flex items-center gap-1.5 min-w-0 text-sm font-semibold text-[var(--color-primary)]">
          <Database size={13} className="shrink-0" />
          <span className="truncate">{table.name}</span>
        </span>
        <span className="text-[11px] text-[var(--color-text-muted)] shrink-0">
          {table.columnCount} col{table.columnCount === 1 ? '' : 's'}{rows !== undefined ? ` · ${rows.toLocaleString()} rows` : ''}
        </span>
      </div>
      <div className="py-1">
        {table.visible.map(col => (
          <div key={col.name} className="relative flex items-center gap-1.5 px-3" style={{ height: NODE_ROW_HEIGHT }}>
            <Handle type="target" position={Position.Left} id={handleId(col.name, 'target')} />
            <span className="font-mono text-xs text-[var(--color-text-primary)] truncate">{col.name}</span>
            {col.isPk && <KeyBadge kind="PK" />}
            {col.isFk && <KeyBadge kind="FK" />}
            <span className="ml-auto text-[11px] text-[var(--color-text-muted)] shrink-0">{col.type}</span>
            <Handle type="source" position={Position.Right} id={handleId(col.name, 'source')} />
          </div>
        ))}
        {(table.hiddenCount > 0 || (expanded && table.columnCount > MAX_VISIBLE_COLUMNS)) && (
          <div className="relative px-3 flex items-center" style={{ height: NODE_ROW_HEIGHT }}>
            {table.hiddenCount > 0 && <Handle type="target" position={Position.Left} id={handleId(MORE_COLUMN, 'target')} isConnectable={false} />}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onToggleExpand(table.name); }}
              className="nodrag text-xs text-[var(--color-primary)] hover:underline"
            >
              {table.hiddenCount > 0 ? `+${table.hiddenCount} more` : 'Show less'}
            </button>
            {table.hiddenCount > 0 && <Handle type="source" position={Position.Right} id={handleId(MORE_COLUMN, 'source')} isConnectable={false} />}
          </div>
        )}
      </div>
    </div>
  );
}
