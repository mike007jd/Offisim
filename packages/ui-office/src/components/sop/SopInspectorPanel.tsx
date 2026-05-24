import type { SopDefinition } from '@offisim/shared-types';
import { Button, cn } from '@offisim/ui-core';
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
    <div className="text-fs-micro font-bold uppercase tracking-ls-caps text-ink-3">{children}</div>
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
          'flex w-sop-inspector shrink-0 items-center justify-center border-l border-line bg-surface-1',
          className,
        )}
      >
        <p className="px-6 text-center text-fs-sm text-ink-4">Select a step to inspect</p>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        'flex w-sop-inspector shrink-0 flex-col overflow-y-auto border-l border-line bg-surface-1',
        className,
      )}
    >
      <div className="border-b border-line-soft px-sp-5 pb-sp-4 pt-sp-5">
        <div className="text-fs-md font-bold leading-snug text-ink-1">{step.label}</div>
        <div className="mt-1.5 flex items-center gap-2 text-fs-sm text-ink-3">
          <span className={`size-2 rounded-r-pill ${STATUS_DOT[status]}`} />
          <span>{STATUS_LABEL[status]}</span>
          <span aria-hidden>·</span>
          <span>{step.role_slug}</span>
        </div>
      </div>

      {roleMissing && (
        <div className="flex flex-col gap-sp-3 border-b border-line-soft p-sp-5">
          <p className="rounded-r-sm border border-warn/40 bg-warn-surface px-2.5 py-2 text-fs-meta leading-snug text-warn">
            No employee with role <span className="font-bold">{step.role_slug}</span> — dispatcher
            will fall back.
          </p>
        </div>
      )}

      {status === 'failed' && (
        <div className="flex flex-col gap-sp-3 border-b border-line-soft p-sp-5">
          <SectionLabel>Last error</SectionLabel>
          <div className="rounded-r-sm border border-danger/30 bg-danger-surface px-2.5 py-2 text-fs-meta leading-snug text-danger">
            {lastFailedTask?.taskType?.trim() && (
              <div className="font-mono font-semibold">{lastFailedTask.taskType.trim()}</div>
            )}
            <div className="mt-0.5 whitespace-pre-wrap">
              {lastFailedTask?.description?.trim() || '—'}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-sp-3 border-b border-line-soft p-sp-5">
        <SectionLabel>Instruction</SectionLabel>
        <p className="whitespace-pre-wrap text-fs-sm leading-relaxed text-ink-2">
          {step.instruction || <span className="italic text-ink-4">No instruction</span>}
        </p>
      </div>

      <div className="flex flex-col gap-sp-3 border-b border-line-soft p-sp-5">
        <SectionLabel>Dependencies</SectionLabel>
        {dependencyLabels.length === 0 ? (
          <p className="text-fs-sm italic text-ink-4">None</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {dependencyLabels.map((dep) => (
              <li key={dep.stepId}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onSelectStep(dep.stepId)}
                  className="h-auto w-full justify-start truncate rounded-r-sm border border-line-soft bg-surface-2 px-2.5 py-1.5 text-left text-fs-sm font-medium text-ink-2 hover:border-accent-ring hover:bg-accent-surface hover:text-accent"
                >
                  {dep.label}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-sp-3 p-sp-5">
        <SectionLabel>Output key</SectionLabel>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-r-xs bg-surface-sunken px-2.5 py-1.5 font-mono text-fs-meta text-accent">
            {step.output_key}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            aria-label="Copy output key"
            className="h-auto shrink-0 gap-1 rounded-r-xs border border-line-soft bg-surface-2 px-2.5 py-1.5 text-fs-micro font-bold uppercase tracking-ls-caps text-ink-3 hover:border-accent-ring hover:bg-accent-surface hover:text-accent"
          >
            {copied ? (
              <>
                <Check className="size-3" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-3" />
                Copy
              </>
            )}
          </Button>
        </div>
      </div>
    </aside>
  );
}
