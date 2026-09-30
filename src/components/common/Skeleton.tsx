import React from 'react';

interface SkeletonProps {
  width?: string;
  height?: string;
  className?: string;
}

export function Skeleton({ width = 'w-full', height = 'h-4', className = '' }: SkeletonProps) {
  return <div className={`skeleton ${width} ${height} ${className}`} />;
}

export function SkeletonTable({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="border border-[var(--color-border)] rounded-[var(--radius-lg)] overflow-hidden">
      <div className="grid gap-0" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-10 bg-[var(--color-surface-2)] border-b border-[var(--color-border)] px-4 flex items-center">
            <div className="skeleton h-3 w-20" />
          </div>
        ))}
        {Array.from({ length: rows * cols }).map((_, i) => (
          <div key={i} className="h-10 border-b border-[var(--color-border)] px-4 flex items-center">
            <div className="skeleton h-3 w-16" style={{ animationDelay: `${(i % 5) * 100}ms` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5 space-y-3">
      <div className="skeleton h-4 w-32" />
      <div className="skeleton h-3 w-full" />
      <div className="skeleton h-3 w-3/4" />
    </div>
  );
}
