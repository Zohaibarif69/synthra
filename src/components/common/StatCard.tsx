import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: string;
  className?: string;
}

export function StatCard({ label, value, icon, trend, className = '' }: StatCardProps) {
  return (
    <div className={`bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5 ${className}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold text-[var(--color-text-primary)] tabular-nums">{value}</p>
          {trend && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{trend}</p>}
        </div>
        {icon && (
          <div className="p-2 bg-[var(--color-primary-light)] rounded-[var(--radius-md)] text-[var(--color-primary)]">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

export function SkeletonStatCard() {
  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-5">
      <div className="skeleton h-3 w-20 mb-3" />
      <div className="skeleton h-7 w-28" />
    </div>
  );
}
