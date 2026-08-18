/**
 * Second Brain — Toast Notifications Component
 */

import React from 'react';
import { useUI } from '../../context/UIContext';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useUI();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 max-w-md w-full pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start justify-between gap-3 p-3.5 rounded-xl bg-[#171C1A] border border-[#2A302D] shadow-2xl shadow-black/80 backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-200"
        >
          <div className="flex items-start gap-3">
            {t.type === 'success' && <CheckCircle2 className="w-5 h-5 text-[#78C6A3] mt-0.5 flex-shrink-0" />}
            {t.type === 'error' && <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />}
            {t.type === 'info' && <Info className="w-5 h-5 text-[#D6C7A1] mt-0.5 flex-shrink-0" />}

            <div>
              <p className="text-xs font-semibold text-[#F3F1EA]">{t.title}</p>
              {t.description && <p className="text-xs text-[#929892] mt-0.5 leading-relaxed">{t.description}</p>}
            </div>
          </div>

          <button
            onClick={() => dismissToast(t.id)}
            className="text-[#929892] hover:text-[#F3F1EA] p-1 -mr-1 rounded-md transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
