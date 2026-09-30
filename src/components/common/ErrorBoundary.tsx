'use client';

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  /** Short name of the area, e.g. "this page", shown in the message. */
  area?: string;
}

interface State {
  error: Error | null;
}

/** Catches render errors so one broken view shows a message instead of a white screen. */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('UI error caught by ErrorBoundary:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <ErrorPanel error={this.state.error} area={this.props.area} onRetry={() => this.setState({ error: null })} />;
  }
}

export function ErrorPanel({ error, area = 'this page', onRetry }: { error: Error; area?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="p-8 max-w-xl mx-auto">
      <div className="bg-[var(--color-surface)] border border-[var(--color-error)]/40 rounded-[var(--radius-lg)] p-6 space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-[var(--color-error)]" />
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Something went wrong in {area}</h2>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {error.message || 'An unexpected error occurred.'} Your History, saved schemas and settings are safe.
        </p>
        <div className="flex gap-2 flex-wrap">
          {onRetry && (
            <button onClick={onRetry} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1">
              <RefreshCw size={13} /> Try again
            </button>
          )}
          <a href="/" className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] border border-[var(--color-border-strong)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]">
            Go to overview
          </a>
        </div>
      </div>
    </div>
  );
}
