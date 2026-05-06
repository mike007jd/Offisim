import type { SopDefinition } from '@offisim/shared-types';
import { cn } from '@offisim/ui-core';
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
  className?: string;
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
    <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{children}</div>
  );
}

export function SopInspectorPanel({
  definition,
  selectedStepId,
  runtimeState,
  stepIds,
  onSelectStep,
  missingRoleSet,
  className,
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
      <aside
        className={cn(
          'flex w-[320px] shrink-0 items-center justify-center border-l border-border-default bg-surface-elevated',
          className,
        )}
      >
        <p className="px-6 text-center text-xs text-text-muted">Select a step to inspect</p>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        'w-[320px] shrink-0 overflow-y-auto border-l border-border-default bg-surface-elevated',
        className,
      )}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1">
          <div className="text-sm font-semibold text-text-primary">{step.label}</div>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
            <span>{STATUS_LABEL[status]}</span>
            <span aria-hidden>·</span>
            <span>{step.role_slug}</span>
          </div>
        </div>

        {roleMissing && (
          <p className="rounded border border-warning/40 bg-warning-muted px-2 py-1.5 text-[11px] leading-snug text-warning">
            No employee with role <span className="font-semibold">{step.role_slug}</span> —
            dispatcher will fall back.
          </p>
        )}

        {status === 'failed' && (
          <div className="flex flex-col gap-1.5">
            <SectionLabel>Last error</SectionLabel>
            <div className="rounded border border-error/30 bg-error-muted px-2 py-1.5 text-[11px] leading-snug">
              {lastFailedTask?.taskType?.trim() && (
                <div className="font-mono text-error">{lastFailedTask.taskType.trim()}</div>
              )}
              <div className="mt-0.5 whitespace-pre-wrap text-error">
                {lastFailedTask?.description?.trim() || '—'}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <SectionLabel>Instruction</SectionLabel>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">
            {step.instruction || <span className="italic text-text-muted">No instruction</span>}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionLabel>Dependencies</SectionLabel>
          {dependencyLabels.length === 0 ? (
            <p className="text-xs italic text-text-muted">None</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {dependencyLabels.map((dep) => (
                <li key={dep.stepId}>
                  <button
                    type="button"
                    onClick={() => onSelectStep(dep.stepId)}
                    className="w-full truncate rounded bg-surface-muted px-2 py-1 text-left text-xs text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
                  >
                    {dep.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <SectionLabel>Output key</SectionLabel>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface-muted px-2 py-1 font-mono text-[11px] text-accent-text">
              {step.output_key}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy output key"
              className="inline-flex shrink-0 items-center gap-1 rounded bg-surface-muted px-2 py-1 text-[10px] text-text-secondary transition hover:bg-surface-hover hover:text-text-primary"
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
