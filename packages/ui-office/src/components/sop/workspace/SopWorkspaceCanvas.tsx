import type { SopDefinition } from '@offisim/shared-types';
import type { SopTemplate } from '../../../hooks/useSops';
import { useSopRuntimeState } from '../../../hooks/useSopRuntimeState';
import { useOffisimRuntime } from '../../../runtime/offisim-runtime-context';
import { SopTimelineView } from '../SopTimelineView';
import { Loader2, Play, Send } from 'lucide-react';
import { Button } from '@offisim/ui-core';
import { useCallback, useMemo, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// SopWorkspaceCanvas — Task 5.3
// ---------------------------------------------------------------------------

export interface SopWorkspaceCanvasProps {
  sop: SopTemplate | null;
  centerMode: 'empty' | 'definition' | 'run-focus';
  onRunFocus?: () => void;
}

/**
 * Center pane of the SOP workspace.
 *
 * Displays the SOP definition surface with steps, dependencies, and annotations.
 * Extracted from SopDrawer — reuses SopTimelineView for the step DAG.
 * Supports run entry and NL modification affordances.
 */
export function SopWorkspaceCanvas({ sop, centerMode: _centerMode, onRunFocus }: SopWorkspaceCanvasProps) {
  const { sendMessage } = useOffisimRuntime();
  const runtimeState = useSopRuntimeState(sop?.sopTemplateId);
  const [nlInput, setNlInput] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo<SopDefinition | null>(() => {
    if (!sop) return null;
    try {
      const def = JSON.parse(sop.definitionJson) as SopDefinition;
      return Array.isArray(def.steps) && def.steps.length > 0 ? def : null;
    } catch {
      return null;
    }
  }, [sop]);

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
      {/* Canvas header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 shrink-0">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-slate-200 truncate">{sop.name}</h2>
          <p className="text-[10px] text-slate-500">
            {parsed ? `${parsed.steps.length} steps` : 'No steps'}
            {sop.description && ` · ${sop.description}`}
            {isActive && ' · Running'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px] text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 gap-1"
          onClick={handleRun}
        >
          <Play className="w-3 h-3" />
          Run
        </Button>
      </div>

      {/* Timeline / definition surface */}
      <div className="flex-1 overflow-y-auto overflow-x-auto custom-scrollbar p-4">
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
          <p className="text-[10px] text-slate-500 italic px-2">No steps defined.</p>
        )}
      </div>

      {/* NL edit area — extracted from SopDrawer */}
      <div className="border-t border-white/5 px-3 py-2.5 shrink-0">
        <p className="text-[9px] text-slate-600 mb-1.5">Describe changes in natural language</p>
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            type="text"
            value={nlInput}
            onChange={(e) => setNlInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Add a review step after design…"
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
  );
}
