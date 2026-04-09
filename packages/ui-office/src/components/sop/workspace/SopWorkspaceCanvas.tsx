import { Button } from '@offisim/ui-core';
import { Loader2, Play, Send } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useSopRuntimeState } from '../../../hooks/useSopRuntimeState';
import type { SopTemplate } from '../../../hooks/useSops';
import { parseSopDefinition } from '../../../lib/sop-utils';
import { useOffisimRuntime } from '../../../runtime/offisim-runtime-context';
import { SopTimelineView } from '../SopTimelineView';

export interface SopWorkspaceCanvasProps {
  sop: SopTemplate | null;
  onRunFocus?: () => void;
}

/** Center pane — SOP definition surface with timeline, NL edit, and run controls. */
export function SopWorkspaceCanvas({ sop, onRunFocus }: SopWorkspaceCanvasProps) {
  const { sendMessage } = useOffisimRuntime();
  const runtimeState = useSopRuntimeState(sop?.sopTemplateId);
  const [nlInput, setNlInput] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (sop ? parseSopDefinition(sop.definitionJson) : null), [sop]);

  const isActive = runtimeState?.some((s) => s.status === 'active') ?? false;

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

  const handleSend = useCallback(async () => {
    const text = nlInput.trim();
    if (!text || !sop) return;
    setAdjusting(true);
    setNlInput('');
    try {
      await sendMessage(
        `Modify the SOP "${sop.name}" (template ID: ${sop.sopTemplateId}): ${text}`,
      );
    } catch {
      // fall through
    } finally {
      setAdjusting(false);
    }
  }, [nlInput, sendMessage, sop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleRun = useCallback(() => {
    if (!sop) return;
    void sendMessage(`Run the SOP: ${sop.name}`);
    onRunFocus?.();
  }, [sop, sendMessage, onRunFocus]);

  if (!sop) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5 shrink-0">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-slate-200 truncate">{sop.name}</h2>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {parsed ? `${parsed.steps.length} steps` : 'No steps'}
            {sop.description && ` · ${sop.description}`}
            {isActive && ' · Running'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-3 text-[13px] text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 gap-1.5"
          onClick={handleRun}
        >
          <Play className="w-3.5 h-3.5" />
          Run
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-auto custom-scrollbar p-5">
        <div className="max-w-[960px] mx-auto">
          {adjusting ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8">
              <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              <p className="text-xs text-slate-400">Adjusting…</p>
            </div>
          ) : parsed ? (
            <SopTimelineView
              definition={parsed}
              runtimeState={runtimeState}
              onStepClick={handleStepClick}
            />
          ) : (
            <p className="text-xs text-slate-500 italic px-2">No steps defined.</p>
          )}
        </div>
      </div>

      <div className="border-t border-white/5 px-5 py-3.5 shrink-0">
        <p className="text-[13px] text-slate-600 mb-2">Describe changes in natural language</p>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={nlInput}
            onChange={(e) => setNlInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Add a review step after design…"
            disabled={adjusting}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[13px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/40 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!nlInput.trim() || adjusting}
            className="shrink-0 p-2 rounded-lg text-blue-400 hover:bg-blue-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
