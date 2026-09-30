import React from 'react';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'muted' | 'primary';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]',
  primary: 'bg-[var(--color-primary-light)] text-[var(--color-primary)]',
  success: 'bg-[var(--color-success-bg)] text-[var(--color-success)]',
  warning: 'bg-[var(--color-warning-bg)] text-[var(--color-warning)]',
  error: 'bg-[var(--color-error-bg)] text-[var(--color-error)]',
  info: 'bg-[var(--color-info-bg)] text-[var(--color-info)]',
  muted: 'bg-transparent text-[var(--color-text-muted)] border border-[var(--color-border)]',
};

export function Badge({ variant = 'default', children, className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${variantClasses[variant]} ${className}`}>
      {children}
    </span>
  );
}

export function PrivacyBadge({ level }: { level: 'low' | 'medium' | 'high' }) {
  const map = { low: 'success', medium: 'warning', high: 'error' } as const;
  return <Badge variant={map[level]}>{level.charAt(0).toUpperCase() + level.slice(1)}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, BadgeVariant> = {
    completed: 'success',
    failed: 'error',
    generating: 'info',
    analyzing: 'info',
    uploading: 'info',
    idle: 'muted',
    validating: 'warning',
  };
  return <Badge variant={map[status] ?? 'default'}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
}
