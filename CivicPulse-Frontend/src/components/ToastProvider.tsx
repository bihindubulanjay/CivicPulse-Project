import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  action?: ToastAction;
}

interface ToastContextValue {
  pushToast: (toast: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}

const TONE_STYLES: Record<ToastTone, string> = {
  success: 'border-emerald-200 bg-white/95 text-slate-900',
  error: 'border-rose-200 bg-white/95 text-slate-900',
  warning: 'border-amber-200 bg-white/95 text-slate-900',
  info: 'border-sky-200 bg-white/95 text-slate-900',
};

function ToneIcon({ tone }: { tone: ToastTone }) {
  switch (tone) {
    case 'success':
      return <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />;
    case 'error':
      return <AlertCircle className="h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />;
    case 'warning':
      return <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />;
    default:
      return <Info className="h-5 w-5 shrink-0 text-sky-600" aria-hidden="true" />;
  }
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    // Conditionally use Popover API (manual) without crashing older browsers
    if (typeof el.showPopover === 'function') {
      try {
        el.showPopover();
      } catch {
        // Fallback if top-layer popover unavailable
      }
    }

    const timer = window.setInterval(() => {
      if (!pausedRef.current) {
        onDismiss(toast.id);
      }
    }, 5000);

    return () => {
      window.clearInterval(timer);
      if (typeof el.hidePopover === 'function') {
        try {
          el.hidePopover();
        } catch {
          // Ignore already closed popover
        }
      }
    };
  }, [onDismiss, toast.id]);

  return (
    <div
      ref={cardRef}
      {...({ popover: 'manual' } as Record<string, string>)}
      onMouseEnter={() => {
        pausedRef.current = true;
      }}
      onMouseLeave={() => {
        pausedRef.current = false;
      }}
      onFocusCapture={() => {
        pausedRef.current = true;
      }}
      onBlurCapture={() => {
        pausedRef.current = false;
      }}
      className={`cp-toast-item pointer-events-auto w-full max-w-sm rounded-2xl border p-3.5 shadow-elevated backdrop-blur-md transition-all ${TONE_STYLES[toast.tone]}`}
    >
      <div className="flex items-start gap-3">
        <ToneIcon tone={toast.tone} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
          {toast.description ? (
            <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{toast.description}</p>
          ) : null}
          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                toast.action?.onClick();
                onDismiss(toast.id);
              }}
              className="mt-2 inline-flex items-center rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-slate-800"
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label="Close notification"
          className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);

    const text = toast.description ? `${toast.title}. ${toast.description}` : toast.title;
    const spoken = toast.action ? `${text} Actions available` : text;
    const docWithAriaNotify = document as Document & { ariaNotify?: (msg: string) => void };
    if (typeof docWithAriaNotify.ariaNotify === 'function') {
      docWithAriaNotify.ariaNotify(spoken);
    } else {
      setLiveAnnouncement(spoken);
    }
  }, []);

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>
      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-4 left-4 z-[9999] flex w-[min(92vw,24rem)] flex-col gap-2.5 sm:bottom-5 sm:left-5"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
