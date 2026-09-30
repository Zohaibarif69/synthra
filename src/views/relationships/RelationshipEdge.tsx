'use client';

import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import type { Cardinality } from '../../lib/types';

export type RelationshipEdgeData = {
  cardinality: Cardinality;
  range?: string;
  /** Orphan count from the latest generation's validation; undefined when not generated. */
  orphans?: number;
  dimmed: boolean;
  onEdit: (id: string) => void;
};

export type RelationshipEdgeType = Edge<RelationshipEdgeData, 'relationship'>;

export function RelationshipEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, selected }: EdgeProps<RelationshipEdgeType>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const dimmed = data?.dimmed ?? false;
  const orphans = data?.orphans;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={20}
        style={{
          stroke: selected ? 'var(--color-primary)' : 'var(--color-text-muted)',
          strokeWidth: selected ? 2.5 : 2,
          opacity: dimmed ? 0.2 : 1,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute flex items-center gap-1 cursor-pointer"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all', opacity: dimmed ? 0.3 : 1 }}
          onClick={() => data?.onEdit(id)}
          title="Click to edit or delete"
        >
          <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold font-mono bg-[var(--color-surface)] border border-[var(--color-border-strong)] text-[var(--color-text-primary)] shadow-sm">
            {data?.cardinality}{data?.range ? ` ${data.range}` : ''}
          </span>
          {orphans !== undefined && (
            <span
              className="px-1.5 py-0.5 rounded text-[11px] font-medium border shadow-sm"
              style={{
                color: orphans ? 'var(--color-error)' : 'var(--color-success)',
                background: orphans ? 'var(--color-error-bg)' : 'var(--color-success-bg)',
                borderColor: orphans ? 'var(--color-error)' : 'var(--color-success)',
              }}
            >
              {orphans.toLocaleString()} orphan{orphans === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
