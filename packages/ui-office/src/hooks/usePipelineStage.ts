import { useEffect, useRef, useState } from 'react';
import type { GraphNodeEnteredPayload, RuntimeEvent, RoleSlug } from '@aics/shared-types';
import { SYSTEM_ROLES } from '@aics/shared-types';
import { useAicsRuntime, useAicsRuntimeStatus } from '../runtime/aics-runtime-context';

// ---------------------------------------------------------------------------
// Shared pipeline stage hook — consumed by ChatPanel, StatusBar, PipelineProgress.
// Derived from graph.node.entered events and auto-clears 3s after run ends.
// ---------------------------------------------------------------------------

/**
 * Fine-grained pipeline stages that map 1:1 to the main graph flow:
 *   Boss → Manager → PM → Employee → Summary
 *
 * Legacy 4-stage names are preserved as aliases in STAGE_META for backward compat
 * with StatusBar (which reads label/colorClass/dotClass).
 */
export type PipelineStage =
  | 'boss'
  | 'manager'
  | 'planning'
  | 'executing'
  | 'summary'
  | null;

/** Ordered pipeline steps — the canonical 5-stage flow. */
export const PIPELINE_STEPS = ['boss', 'manager', 'planning', 'executing', 'summary'] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];

export interface StageMeta {
  label: string;
  colorClass: string;
  dotClass: string;
  /** Tailwind text-color class used in the chat pipeline indicator */
  chatColorClass: string;
  /** Human-readable label used in the chat pipeline indicator */
  chatLabel: string;
  /** Short label for the progress bar node */
  shortLabel: string;
}

export const STAGE_META: Record<NonNullable<PipelineStage>, StageMeta> = {
  boss:      { label: 'ANALYZING',  colorClass: 'text-amber-400/90',   dotClass: 'bg-amber-400',   chatColorClass: 'text-amber-400',   chatLabel: 'Boss analyzing…',    shortLabel: 'Boss' },
  manager:   { label: 'ROUTING',    colorClass: 'text-orange-400/90',  dotClass: 'bg-orange-400',  chatColorClass: 'text-orange-400',  chatLabel: 'Manager routing…',   shortLabel: 'Manager' },
  planning:  { label: 'PLANNING',   colorClass: 'text-blue-400/90',    dotClass: 'bg-blue-400',    chatColorClass: 'text-blue-400',    chatLabel: 'PM planning…',       shortLabel: 'PM' },
  executing: { label: 'EXECUTING',  colorClass: 'text-emerald-400/90', dotClass: 'bg-emerald-500', chatColorClass: 'text-emerald-400', chatLabel: 'Executing…',         shortLabel: 'Employee' },
  summary:   { label: 'DELIVERING', colorClass: 'text-purple-400/90',  dotClass: 'bg-purple-400',  chatColorClass: 'text-purple-400',  chatLabel: 'Delivering…',        shortLabel: 'Summary' },
};

function nodeToPipelineStage(nodeName: string): NonNullable<PipelineStage> {
  const lower = nodeName.toLowerCase();

  // Boss nodes — entry point
  if (lower === 'boss') return 'boss';

  // Manager / HR — routing phase
  if (lower === 'manager' || lower === 'hr') return 'manager';

  // PM nodes — planning phase
  if (
    lower === 'pm' ||
    lower === 'pm_planner' ||
    lower === 'pm_replan' ||
    lower === 'pm_heartbeat' ||
    lower === 'product_manager' ||
    lower === 'project_manager' ||
    lower === 'planner'
  ) return 'planning';

  // Summary / delivery nodes
  if (lower === 'boss_summary' || lower.includes('deliver')) return 'summary';

  // Step dispatcher is the transition between planning and executing
  if (lower === 'step_dispatcher' || lower === 'step_advance') return 'executing';

  // Employee nodes (including direct setup) — executing
  if (lower === 'employee' || lower === 'employee_direct_setup') return 'executing';

  // Any other system role → manager/routing
  if (SYSTEM_ROLES.has(lower as RoleSlug)) return 'manager';

  // Default: executing (probably an employee role slug)
  return 'executing';
}

/**
 * Returns the current pipeline stage derived from graph.node.entered events.
 * Clears automatically 3s after the runtime stops running.
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
