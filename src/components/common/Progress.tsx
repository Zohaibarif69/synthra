import React from 'react';

interface ProgressProps {
  value?: number;
  indeterminate?: boolean;
  className?: string;
  label?: string;
}

export function Progress({ value, indeterminate = false, className = '', label }: ProgressProps) {
  return (
    <div className={className}>
      {label && (
        <div className="flex justify-between mb-1">
          <span className="text-xs text-[var(--color-text-secondary)]">{label}</span>
          {!indeterminate && value !== undefined && (
            <span className="text-xs font-mono text-[var(--color-text-muted)]">{Math.round(value)}%</span>
          )}
        </div>
      )}
      <div className="h-1.5 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
        {indeterminate ? (
          <div className="h-full w-1/3 bg-[var(--color-primary)] rounded-full progress-indeterminate" />
        ) : (
          <div
            className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }}
          />
        )}
      </div>
    </div>
  );
}

interface ProgressStepProps {
  steps: string[];
  current: number;
  completed: number[];
}

export function ProgressSteps({ steps, current, completed }: ProgressStepProps) {
  return (
    <div className="space-y-2">
      {steps.map((step, i) => {
        const isDone = completed.includes(i);
        const isActive = i === current;
        return (
          <div key={i} className="flex items-center gap-3">
            <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-xs ${
              isDone ? 'bg-[var(--color-success)] text-white' :
              isActive ? 'border-2 border-[var(--color-primary)]' :
              'border border-[var(--color-border)]'
            }`}>
              {isDone ? '✓' : isActive ? (
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)]" />
              ) : null}
            </div>
            <span className={`text-sm ${isDone || isActive ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'} ${isActive ? 'font-medium' : ''}`}>
              {step}
            </span>
          </div>
        );
      })}
    </div>
  );
}
