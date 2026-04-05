import type { SopDefinition, SopStep } from '@offisim/shared-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SopRuntimeStepState } from '../../hooks/useSopRuntimeState';
import { type CardRect, type DepLine, SopDepConnector } from './SopDepConnector';
import { SopStepCard, type SopStepStatus } from './SopStepCard';

// ---------------------------------------------------------------------------
// Batch computation — mirrors SopService.getExecutionOrder as a pure function.
// SopService requires (repo, eventBus) constructor args; instantiating with
// dummy deps just for a pure computation is worse than a local copy.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const COLUMN_GAP = 56;
const ROW_GAP = 8;
const PADDING_Y = 8;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SopTimelineViewProps {
  definition: SopDefinition;
  runtimeState?: SopRuntimeStepState[] | null;
  onStepClick?: (stepId: string) => void;
}

export function SopTimelineView({ definition, runtimeState, onStepClick }: SopTimelineViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cardRects, setCardRects] = useState<CardRect[]>([]);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  // Memoize expensive derivations on definition (stable across runtimeState changes)
  const batches = useMemo(() => getExecutionBatches(definition), [definition]);
  const stepIndexMap = useMemo(
    () => new Map(definition.steps.map((s, i) => [s.step_id, i] as const)),
    [definition],
  );

  // Pre-build status map for O(1) lookups instead of repeated .find()
  const statusMap = useMemo(() => {
    if (!runtimeState) return null;
    return new Map(runtimeState.map((s) => [s.stepIndex, s.status] as const));
  }, [runtimeState]);

  // Dependency lines — depends on definition structure + runtime status
  const lines = useMemo<DepLine[]>(() => {
    const result: DepLine[] = [];
    for (const step of definition.steps) {
      for (const depId of step.dependencies) {
        const fromIdx = stepIndexMap.get(depId) ?? 0;
        let lineStatus: SopStepStatus = 'design';
        if (statusMap) {
          const fromStatus = statusMap.get(fromIdx);
          lineStatus =
            fromStatus === 'completed'
              ? 'completed'
              : fromStatus === 'active'
                ? 'active'
                : 'pending';
        }
        result.push({ fromStepId: depId, toStepId: step.step_id, status: lineStatus });
      }
    }
    return result;
  }, [definition, stepIndexMap, statusMap]);

  // Measure card positions — only when layout changes (definition), not on status updates
  const measureCards = useCallback(() => {
    if (!containerRef.current) return;
    const cards = containerRef.current.querySelectorAll<HTMLElement>('[data-step-id]');
    const parentRect = containerRef.current.getBoundingClientRect();
    const rects: CardRect[] = [];
    cards.forEach((el) => {
      const stepId = el.getAttribute('data-step-id')!;
      const r = el.getBoundingClientRect();
      rects.push({
        stepId,
        x: r.left - parentRect.left,
        y: r.top - parentRect.top,
        width: r.width,
        height: r.height,
      });
    });
    setCardRects(rects);
    setContainerSize({ w: parentRect.width, h: parentRect.height });
  }, []);

  useEffect(() => {
    measureCards();
  }, [measureCards, definition]);

  if (batches.length === 0) {
    return <p className="text-[10px] text-slate-500 italic px-2 pb-1">No steps defined.</p>;
  }

  return (
    <div ref={containerRef} className="relative overflow-x-auto px-2 pb-2">
      <div className="flex items-start" style={{ gap: COLUMN_GAP }}>
        {batches.map((batch, batchIdx) => (
          <div
            key={batchIdx}
            className="flex flex-col shrink-0"
            style={{ gap: ROW_GAP, paddingTop: PADDING_Y }}
          >
            <span className="text-[8px] text-slate-600 uppercase tracking-wider mb-0.5 px-0.5">
              Batch {batchIdx + 1}
            </span>
            {batch.map((step) => {
              const idx = stepIndexMap.get(step.step_id) ?? 0;
              const stepStatus: SopStepStatus = statusMap
                ? (statusMap.get(idx) ?? 'pending')
                : 'design';
              return (
                <div key={step.step_id} data-step-id={step.step_id}>
                  <SopStepCard
                    label={step.label}
                    roleSlug={step.role_slug}
                    status={stepStatus}
                    onClick={onStepClick ? () => onStepClick(step.step_id) : undefined}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <SopDepConnector
        lines={lines}
        cards={cardRects}
        containerWidth={containerSize.w}
        containerHeight={containerSize.h}
      />
    </div>
  );
}
