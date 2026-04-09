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
      <div className="flex items-center gap-3 px-6 py-3 border-b border-white/[0.06] border-l-[3px] border-l-cyan-400/40 shrink-0">
        <h2 className="text-base font-semibold text-white truncate">{sop.name}</h2>
        <span className="shrink-0 rounded-full bg-white/[0.06] border border-white/10 px-2 py-0.5 text-[11px] font-medium text-slate-400">
          {parsed ? `${parsed.steps.length} steps` : '\u2014'}
        </span>
        {isActive && (
          <span className="shrink-0 flex items-center gap-1.5 rounded-full bg-cyan-500/15 border border-cyan-400/30 px-2.5 py-0.5 text-[11px] font-medium text-cyan-300">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            Running
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleRun}
          className="flex items-center gap-1.5 rounded-lg bg-cyan-500/15 border border-cyan-400/30 px-3 py-1.5 text-[12px] font-medium text-cyan-200 hover:bg-cyan-500/25 transition-colors"
        >
          <Play className="w-3 h-3" /> Run
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-auto custom-scrollbar p-6">
        {adjusting ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
            <p className="text-xs text-slate-500">Adjusting…</p>
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

      <div className="border-t border-white/[0.06] px-5 py-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={nlInput}
            onChange={(e) => setNlInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe changes…"
            disabled={adjusting}
            className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[13px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400/40 focus:shadow-[0_0_12px_rgba(34,211,238,0.08)] disabled:opacity-40 transition-all"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!nlInput.trim() || adjusting}
            className="shrink-0 p-2 rounded-lg text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            aria-label="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
