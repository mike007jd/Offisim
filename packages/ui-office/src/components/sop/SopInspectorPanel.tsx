import type { SopDefinition } from '@offisim/shared-types';
import { Check, Copy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { SopRuntimeStepState } from '../../hooks/useSopRuntimeState';
import { STATUS_DOT, STATUS_LABEL } from './SopDagNode';
import type { SopStepStatus } from './sop-dag-layout';

export interface SopInspectorPanelProps {
  definition: SopDefinition | null;
  selectedStepId: string | null;
  runtimeState: SopRuntimeStepState[] | null;
  stepIds: string[];
  onSelectStep: (stepId: string) => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">{children}</div>
  );
}

export function SopInspectorPanel({
  definition,
  selectedStepId,
  runtimeState,
  stepIds,
  onSelectStep,
}: SopInspectorPanelProps) {
  const step = useMemo(() => {
    if (!definition || !selectedStepId) return null;
    return definition.steps.find((s) => s.step_id === selectedStepId) ?? null;
  }, [definition, selectedStepId]);

  const status: SopStepStatus = useMemo(() => {
    if (!selectedStepId || !runtimeState) return 'pending';
    const idx = stepIds.indexOf(selectedStepId);
    if (idx < 0) return 'pending';
    return runtimeState.find((rs) => rs.stepIndex === idx)?.status ?? 'pending';
  }, [selectedStepId, runtimeState, stepIds]);

  const dependencyLabels = useMemo(() => {
    if (!step || !definition) return [];
    return step.dependencies.map((depId) => {
      const dep = definition.steps.find((s) => s.step_id === depId);
      return { stepId: depId, label: dep?.label ?? depId };
    });
  }, [step, definition]);

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  const handleCopy = () => {
    if (!step) return;
    void navigator.clipboard?.writeText(step.output_key).then(() => setCopied(true));
  };

  if (!step) {
    return (
      <aside className="w-[320px] shrink-0 border-l border-white/5 bg-slate-900/40 flex items-center justify-center">
        <p className="text-xs text-slate-500 px-6 text-center">Select a step to inspect</p>
      </aside>
    );
  }

  return (
    <aside className="w-[320px] shrink-0 border-l border-white/5 bg-slate-900/40 overflow-y-auto">
      <div className="p-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Label</SectionLabel>
          <div className="text-sm font-semibold text-white">{step.label}</div>
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionLabel>Role</SectionLabel>
          <div className="text-xs text-slate-300">{step.role_slug}</div>
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionLabel>Status</SectionLabel>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status]}`} />
            <span className="text-xs text-slate-300">{STATUS_LABEL[status]}</span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionLabel>Instruction</SectionLabel>
          <p className="text-xs leading-relaxed text-slate-300 whitespace-pre-wrap">
            {step.instruction || <span className="text-slate-500 italic">No instruction</span>}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionLabel>Dependencies</SectionLabel>
          {dependencyLabels.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No upstream steps</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {dependencyLabels.map((dep) => (
                <li key={dep.stepId}>
                  <button
                    type="button"
                    onClick={() => onSelectStep(dep.stepId)}
                    className="w-full text-left text-xs text-slate-300 hover:text-white px-2 py-1 rounded bg-slate-800/40 hover:bg-slate-800/80 transition truncate"
                  >
                    {dep.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionLabel>Output Key</SectionLabel>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 font-mono text-[11px] text-cyan-200 px-2 py-1 rounded bg-slate-800/60 truncate">
              {step.output_key}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy output key"
              className="shrink-0 inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800/40 hover:bg-slate-800/80 transition"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  Copy
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
