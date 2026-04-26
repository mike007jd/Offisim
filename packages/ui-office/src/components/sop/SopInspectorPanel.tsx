import type { SopDefinition } from '@offisim/shared-types';
import { Check, Copy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { type TaskInfo, usePlanStepStore } from '../../hooks/plan-step-store';
import type { SopRuntimeStepState } from '../../hooks/useSopRuntimeState';
import { STATUS_DOT, STATUS_LABEL } from './SopDagNode';
import type { SopStepStatus } from './sop-dag-layout';

export interface SopInspectorPanelProps {
  definition: SopDefinition | null;
  selectedStepId: string | null;
  runtimeState: SopRuntimeStepState[] | null;
  stepIds: string[];
  onSelectStep: (stepId: string) => void;
  /** Set of `role_slug` values with no employee in the active company. */
  missingRoleSet?: ReadonlySet<string>;
}

const TERMINAL_FAILURE_STATES = new Set(['failed', 'cancelled']);

function pickLatestFailedTask(tasks: readonly TaskInfo[]): TaskInfo | null {
  // Tasks live in event-arrival order, so the last entry whose status is
  // 'failed' / 'cancelled' is the most recent failure.
  for (let i = tasks.length - 1; i >= 0; i--) {
    const task = tasks[i];
    if (task && TERMINAL_FAILURE_STATES.has(task.status)) return task;
  }
  return null;
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
  missingRoleSet,
}: SopInspectorPanelProps) {
  const store = usePlanStepStore();

  const step = useMemo(() => {
    if (!definition || !selectedStepId) return null;
    return definition.steps.find((s) => s.step_id === selectedStepId) ?? null;
  }, [definition, selectedStepId]);

  const stepIndex = useMemo(() => {
    if (!selectedStepId) return -1;
    return stepIds.indexOf(selectedStepId);
  }, [selectedStepId, stepIds]);

  const status: SopStepStatus = useMemo(() => {
    if (stepIndex < 0 || !runtimeState) return 'pending';
    return runtimeState.find((rs) => rs.stepIndex === stepIndex)?.status ?? 'pending';
  }, [stepIndex, runtimeState]);

  const lastFailedTask = useMemo(() => {
    if (status !== 'failed' || stepIndex < 0) return null;
    const storeStep = store.steps.find((s) => s.stepIndex === stepIndex);
    if (!storeStep) return null;
    return pickLatestFailedTask(storeStep.tasks);
  }, [status, stepIndex, store.steps]);

  const roleMissing = step ? (missingRoleSet?.has(step.role_slug) ?? false) : false;

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
          {roleMissing && (
            <div className="rounded border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-200">
              <span className="font-semibold">Role gap.</span> No employee with this role; the
              dispatcher will fall back to any available employee.
            </div>
          )}
        </div>

        {status === 'failed' && (
          <div className="flex flex-col gap-1.5">
            <SectionLabel>Last error</SectionLabel>
            <div className="rounded border border-red-400/30 bg-red-500/10 px-2 py-1.5 text-[11px] leading-snug">
              {lastFailedTask?.taskType?.trim() && (
                <div className="font-mono text-red-200">{lastFailedTask.taskType.trim()}</div>
              )}
              <div className="mt-0.5 text-red-100/80 whitespace-pre-wrap">
                {lastFailedTask?.description?.trim() || '(no detail provided)'}
              </div>
            </div>
          </div>
        )}

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
