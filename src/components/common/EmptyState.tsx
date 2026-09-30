import React from 'react';
import { Button } from './Button';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {icon && (
        <div className="mb-4 text-[var(--color-text-muted)]">{icon}</div>
      )}
      <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-[var(--color-text-secondary)] max-w-sm mb-4">{description}</p>
      )}
      {action && (
        <Button onClick={action.onClick}>{action.label}</Button>
      )}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message?: string;
  errorId?: string;
  onRetry?: () => void;
}

export function ErrorState({ title = 'Something went wrong', message, errorId, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="w-10 h-10 rounded-full bg-[var(--color-error-bg)] flex items-center justify-center mb-4">
        <span className="text-[var(--color-error)] text-lg">✕</span>
      </div>
      <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-1">{title}</h3>
      {message && <p className="text-sm text-[var(--color-text-secondary)] mb-2">{message}</p>}
      {errorId && <p className="text-xs font-mono text-[var(--color-text-muted)] mb-4">Error ID: {errorId}</p>}
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>Retry</Button>
      )}
    </div>
  );
}
