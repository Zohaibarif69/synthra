'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => removeToast(id), 4000);
  }, [removeToast]);

  const value: ToastContextValue = {
    toast: addToast,
    success: (m) => addToast('success', m),
    error: (m) => addToast('error', m),
    warning: (m) => addToast('warning', m),
    info: (m) => addToast('info', m),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const iconMap: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={16} className="text-[var(--color-success)] shrink-0" />,
  error: <XCircle size={16} className="text-[var(--color-error)] shrink-0" />,
  warning: <AlertTriangle size={16} className="text-[var(--color-warning)] shrink-0" />,
  info: <Info size={16} className="text-[var(--color-info)] shrink-0" />,
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="pointer-events-auto flex items-center gap-3 bg-[var(--color-surface)] border border-[var(--color-border)] shadow-lg rounded-[var(--radius-md)] px-4 py-3 min-w-[280px] max-w-sm"
      style={{ animation: 'slideInRight 0.2s ease-out' }}
    >
      {iconMap[toast.type]}
      <span className="text-sm text-[var(--color-text-primary)] flex-1">{toast.message}</span>
      <button onClick={onDismiss} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors" aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
