import { useEffect, useRef, useState } from 'react';
import type { GraphNodeEnteredPayload, RuntimeEvent, RoleSlug } from '@aics/shared-types';
import { SYSTEM_ROLES } from '@aics/shared-types';
import { useAicsRuntime, useAicsRuntimeStatus } from '../runtime/aics-runtime-context';

// ---------------------------------------------------------------------------
// Shared pipeline stage hook — consumed by ChatPanel and StatusBar.
// Derived from graph.node.entered events and auto-clears 3s after run ends.
// ---------------------------------------------------------------------------

export type PipelineStage = 'routing' | 'planning' | 'executing' | 'delivering' | null;

export interface StageMeta {
  label: string;
  colorClass: string;
  dotClass: string;
  /** Tailwind text-color class used in the chat pipeline indicator */
  chatColorClass: string;
  /** Human-readable label used in the chat pipeline indicator */
  chatLabel: string;
}

export const STAGE_META: Record<NonNullable<PipelineStage>, StageMeta> = {
  routing:    { label: 'ROUTING',    colorClass: 'text-amber-400/90',   dotClass: 'bg-amber-400',   chatColorClass: 'text-amber-400',   chatLabel: 'Manager routing…' },
  planning:   { label: 'PLANNING',   colorClass: 'text-blue-400/90',    dotClass: 'bg-blue-400',    chatColorClass: 'text-blue-400',    chatLabel: 'PM planning…' },
  executing:  { label: 'EXECUTING',  colorClass: 'text-emerald-400/90', dotClass: 'bg-emerald-500', chatColorClass: 'text-emerald-400', chatLabel: 'Executing…' },
  delivering: { label: 'DELIVERING', colorClass: 'text-purple-400/90',  dotClass: 'bg-purple-400',  chatColorClass: 'text-purple-400',  chatLabel: 'Delivering…' },
};

function nodeToPipelineStage(nodeName: string): PipelineStage {
  const lower = nodeName.toLowerCase();
  if (lower === 'manager') return 'routing';
  if (lower === 'pm' || lower === 'product_manager' || lower === 'project_manager' || lower === 'planner') return 'planning';
  if (lower.includes('deliver') || lower === 'boss_summary' || lower === 'boss') return 'delivering';
  // Any system role we haven't already matched goes to 'routing'
  if (SYSTEM_ROLES.has(lower as RoleSlug)) return 'routing';
  return 'executing';
}

/**
 * Returns the current pipeline stage derived from graph.node.entered events.
 * Clears automatically 3 seconds after the runtime stops running.
 */
export function usePipelineStage(): PipelineStage {
  const { eventBus } = useAicsRuntime();
  const { isRunning } = useAicsRuntimeStatus();
  const [stage, setStage] = useState<PipelineStage>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear stage when run ends
  useEffect(() => {
    if (!isRunning) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setStage(null), 3000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isRunning]);

  useEffect(() => {
    const off = eventBus.on('graph.node.entered', (e: RuntimeEvent<GraphNodeEnteredPayload>) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setStage(nodeToPipelineStage(e.payload.nodeName));
    });
    return off;
  }, [eventBus]);

  return stage;
}
