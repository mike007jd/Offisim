import type { SopDefinition } from '@offisim/shared-types';
import { Loader2, Send, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSopRuntimeState } from '../../hooks/useSopRuntimeState';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { SopTimelineView } from './SopTimelineView';

interface SopDrawerProps {
  open: boolean;
  onClose: () => void;
  sopTemplateId: string;
  sopName: string;
  definitionJson: string;
}

export function SopDrawer({
  open,
  onClose,
  sopTemplateId,
  sopName,
  definitionJson,
}: SopDrawerProps) {
  const { sendMessage } = useOffisimRuntime();
  const runtimeState = useSopRuntimeState(sopTemplateId);
  const [nlInput, setNlInput] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo<SopDefinition | null>(() => {
    try {
      const def = JSON.parse(definitionJson) as SopDefinition;
      return Array.isArray(def.steps) && def.steps.length > 0 ? def : null;
    } catch {
      return null;
    }
  }, [definitionJson]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // When SOP updates (sop.* event triggers useSops refresh → new definitionJson),
  // clear the adjusting state
  useEffect(() => {
    if (adjusting) setAdjusting(false);
  }, [definitionJson]); // eslint-disable-line react-hooks/exhaustive-deps

  // Click a step card → prefill NL context
  const handleStepClick = useCallback(
    (stepId: string) => {
      if (!parsed) return;
      const step = parsed.steps.find((s) => s.step_id === stepId);
      if (!step) return;
      setNlInput(`For step "${step.label}" (${step.role_slug}): `);
      inputRef.current?.focus();
    },
    [parsed],
  );

  // Send NL modification to chat pipeline
  const handleSend = useCallback(async () => {
    const text = nlInput.trim();
    if (!text) return;
    setAdjusting(true);
    setNlInput('');
    try {
      await sendMessage(`Modify the SOP "${sopName}" (template ID: ${sopTemplateId}): ${text}`);
    } catch {
      setAdjusting(false);
    }
  }, [nlInput, sendMessage, sopName, sopTemplateId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[80] bg-black/40 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <div className="fixed inset-y-0 right-0 z-[81] flex">
        <div className="w-[480px] max-w-[calc(100vw-48px)] bg-[#0a0a0f] border-l border-white/10 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-slate-200 truncate">{sopName}</h2>
              <p className="text-[10px] text-slate-500">
                {parsed ? `${parsed.steps.length} steps` : 'No steps'}
                {runtimeState ? ' · Running' : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Timeline */}
          <div className="flex-1 overflow-y-auto overflow-x-auto custom-scrollbar p-4">
            {adjusting ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8">
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                <p className="text-xs text-slate-400">Adjusting...</p>
              </div>
            ) : parsed ? (
              <SopTimelineView
                definition={parsed}
                runtimeState={runtimeState}
                onStepClick={handleStepClick}
              />
            ) : (
              <p className="text-[10px] text-slate-500 italic">No steps defined.</p>
            )}
          </div>

          {/* NL Edit area */}
          <div className="border-t border-white/5 px-3 py-2.5">
            <p className="text-[9px] text-slate-600 mb-1.5">Describe changes in natural language</p>
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                type="text"
                value={nlInput}
                onChange={(e) => setNlInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. Add a review step after design..."
                disabled={adjusting}
                className="flex-1 bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/40 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!nlInput.trim() || adjusting}
                className="shrink-0 p-1.5 rounded-md text-blue-400 hover:bg-blue-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                aria-label="Send"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
