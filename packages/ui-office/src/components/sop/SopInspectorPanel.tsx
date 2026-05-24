import type { SopDefinition } from '@offisim/shared-types';
import { Button, cn } from '@offisim/ui-core';
import { Check, Copy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { type TaskInfo, usePlanStepStore } from '../../hooks/plan-step-store';
import type { SopRuntimeStepState } from '../../hooks/useSopRuntimeState';
import { STATUS_LABEL } from './SopDagNode';
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
  return <div className="sop-inspector-section-label">{children}</div>;
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
      <aside className={cn('sop-inspector', className)} data-empty="true">
        <p>Select a step to inspect</p>
      </aside>
    );
  }

  return (
    <aside className={cn('sop-inspector', className)}>
      <div className="sop-inspector-head">
        <div className="sop-inspector-title">{step.label}</div>
        <div className="sop-inspector-meta">
          <span className="sop-status-dot" data-status={status} />
          <span>{STATUS_LABEL[status]}</span>
          <span aria-hidden>·</span>
          <span>{step.role_slug}</span>
        </div>
      </div>

      {roleMissing && (
        <div className="sop-inspector-section">
          <p className="sop-inline-warning">
            No employee with role{' '}
            <span className="sop-inspector-role-missing">{step.role_slug}</span> — dispatcher will
            fall back.
          </p>
        </div>
      )}

      {status === 'failed' && (
        <div className="sop-inspector-section">
          <SectionLabel>Last error</SectionLabel>
          <div className="sop-inline-error" data-block="true">
            {lastFailedTask?.taskType?.trim() && (
              <div className="sop-inspector-code-title">{lastFailedTask.taskType.trim()}</div>
            )}
            <div className="sop-inspector-prewrap">
              {lastFailedTask?.description?.trim() || '—'}
            </div>
          </div>
        </div>
      )}

      <div className="sop-inspector-section">
        <SectionLabel>Instruction</SectionLabel>
        <p className="sop-inspector-body-copy">
          {step.instruction || <span className="sop-inspector-muted">No instruction</span>}
        </p>
      </div>

      <div className="sop-inspector-section">
        <SectionLabel>Dependencies</SectionLabel>
        {dependencyLabels.length === 0 ? (
          <p className="sop-inspector-muted">None</p>
        ) : (
          <ul className="sop-inspector-dependencies">
            {dependencyLabels.map((dep) => (
              <li key={dep.stepId}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onSelectStep(dep.stepId)}
                  className="sop-inspector-dependency"
                >
                  {dep.label}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sop-inspector-section" data-last="true">
        <SectionLabel>Output key</SectionLabel>
        <div className="sop-inspector-output-row">
          <code className="sop-inspector-output-code">{step.output_key}</code>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            aria-label="Copy output key"
            className="sop-inspector-copy"
          >
            {copied ? (
              <>
                <Check data-icon="inspector-copy" />
                Copied
              </>
            ) : (
              <>
                <Copy data-icon="inspector-copy" />
                Copy
              </>
            )}
          </Button>
        </div>
      </div>
    </aside>
  );
}
