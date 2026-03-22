import React, { useEffect, useState, useCallback, createContext, useContext } from 'react';
import { X, CheckCircle, AlertTriangle, XCircle, Info } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextValue {
  addToast: (message: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
};

const ToastItem: React.FC<{ toast: Toast; onDismiss: (id: string) => void }> = ({
  toast,
  onDismiss,
}) => {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const dur = toast.duration ?? 4000;
    const t = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDismiss(toast.id), 200);
    }, dur);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  const iconMap = {
    success: <CheckCircle size={14} />,
    error: <XCircle size={14} />,
    warning: <AlertTriangle size={14} />,
    info: <Info size={14} />,
  };

  const colorMap = {
    success: 'var(--color-success)',
    error: 'var(--color-danger)',
    warning: 'var(--color-warning)',
    info: 'var(--color-info)',
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 border font-mono text-xs"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderColor: colorMap[toast.type],
        borderLeftWidth: '3px',
        color: 'var(--color-text-primary)',
        minWidth: '280px',
        maxWidth: '420px',
        opacity: exiting ? 0 : 1,
        transform: exiting ? 'translateX(20px)' : 'translateX(0)',
        transition: 'opacity 200ms, transform 200ms',
      }}
    >
      <span style={{ color: colorMap[toast.type], flexShrink: 0 }}>{iconMap[toast.type]}</span>
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        style={{ color: 'var(--color-text-disabled)', flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer' }}
      >
        <X size={12} />
      </button>
    </div>
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'info', duration = 4000) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts(prev => [...prev, { id, message, type, duration }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {/* Toast container - bottom right */}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: '8px',
        }}
      >
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={dismissToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};
