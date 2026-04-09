import type { SopDefinition, SopStep } from '@offisim/shared-types';
import { useMemo } from 'react';
import type { SopRuntimeStepState } from '../../hooks/useSopRuntimeState';
import { SopStepCard, type SopStepStatus } from './SopStepCard';

function getExecutionBatches(def: SopDefinition): SopStep[][] {
  const steps = [...def.steps];
  const completed = new Set<string>();
  const batches: SopStep[][] = [];

  while (completed.size < steps.length) {
    const batch: SopStep[] = [];
    for (const step of steps) {
      if (completed.has(step.step_id)) continue;
      if (step.dependencies.every((d) => completed.has(d))) {
        batch.push(step);
      }
    }
    if (batch.length === 0) break;
    for (const s of batch) completed.add(s.step_id);
    batches.push(batch);
  }
  return batches;
}

export interface SopTimelineViewProps {
  definition: SopDefinition;
  runtimeState?: SopRuntimeStepState[] | null;
  onStepClick?: (stepId: string) => void;
}

export function SopTimelineView({ definition, runtimeState, onStepClick }: SopTimelineViewProps) {
  const batches = useMemo(() => getExecutionBatches(definition), [definition]);
  const stepIndexMap = useMemo(
    () => new Map(definition.steps.map((s, i) => [s.step_id, i] as const)),
    [definition],
  );
  const stepLabelMap = useMemo(
    () => new Map(definition.steps.map((s) => [s.step_id, s.label] as const)),
    [definition],
  );
  const statusMap = useMemo(() => {
    if (!runtimeState) return null;
    return new Map(runtimeState.map((s) => [s.stepIndex, s.status] as const));
  }, [runtimeState]);

  const totalSteps = definition.steps.length;

  if (batches.length === 0) {
    return <p className="text-[12px] text-slate-500 italic px-4 py-8">No steps defined.</p>;
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      {batches.map((batch, batchIdx) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: batches are deterministic from the SOP DAG
          key={batchIdx}
        >
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Phase {batchIdx + 1}
            </span>
            {batch.length > 1 && (
              <span className="text-[10px] text-slate-600">
                ({batch.length} parallel)
              </span>
            )}
            <div className="flex-1 h-px bg-white/[0.04]" />
          </div>

          <div className="flex flex-col gap-2">
            {batch.map((step) => {
              const idx = stepIndexMap.get(step.step_id) ?? 0;
              const stepStatus: SopStepStatus = statusMap
                ? (statusMap.get(idx) ?? 'pending')
                : 'design';
              const depLabels = step.dependencies
                .map((d) => stepLabelMap.get(d))
                .filter(Boolean) as string[];
              return (
                <div key={step.step_id} data-step-id={step.step_id}>
                  <SopStepCard
                    label={step.label}
                    roleSlug={step.role_slug}
                    status={stepStatus}
                    stepIndex={idx}
                    totalSteps={totalSteps}
                    dependencyLabels={depLabels.length > 0 ? depLabels : undefined}
                    onClick={onStepClick ? () => onStepClick(step.step_id) : undefined}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
