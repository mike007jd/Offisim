import type {
  BossRouteDecidedPayload,
  GraphNodeEnteredPayload,
  RoleSlug,
  RuntimeEvent,
} from '@offisim/shared-types';
import { SYSTEM_ROLES } from '@offisim/shared-types';
import { useEffect, useRef, useState } from 'react';
import {
  useOffisimRuntimeServices,
  useOffisimRuntimeStatus,
} from '../runtime/offisim-runtime-context';

// ---------------------------------------------------------------------------
// Shared pipeline stage hook — consumed by shell run surfaces.
// Derived from graph.node.entered events and auto-clears 3s after run ends.
// ---------------------------------------------------------------------------

/**
 * Fine-grained pipeline stages that map 1:1 to the main graph flow:
 *   Boss → Manager → PM → Employee → Summary
 *
 * Legacy 4-stage names are preserved as aliases in STAGE_META for older run
 * surfaces that still read label/colorClass/dotClass.
 */
export type PipelineStage = 'boss' | 'manager' | 'planning' | 'executing' | 'summary' | null;

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
  boss: {
    label: 'ANALYZING',
    colorClass: 'text-warning',
    dotClass: 'bg-warning',
    chatColorClass: 'text-warning',
    chatLabel: 'Boss analyzing...',
    shortLabel: 'Boss',
  },
  manager: {
    label: 'ROUTING',
    colorClass: 'text-accent',
    dotClass: 'bg-accent',
    chatColorClass: 'text-accent',
    chatLabel: 'Manager routing...',
    shortLabel: 'Manager',
  },
  planning: {
    label: 'PLANNING',
    colorClass: 'text-info',
    dotClass: 'bg-info',
    chatColorClass: 'text-info',
    chatLabel: 'PM planning...',
    shortLabel: 'PM',
  },
  executing: {
    label: 'EXECUTING',
    colorClass: 'text-success',
    dotClass: 'bg-success',
    chatColorClass: 'text-success',
    chatLabel: 'Executing...',
    shortLabel: 'Employee',
  },
  summary: {
    label: 'DELIVERING',
    colorClass: 'text-accent',
    dotClass: 'bg-accent',
    chatColorClass: 'text-accent',
    chatLabel: 'Delivering...',
    shortLabel: 'Summary',
  },
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
  )
    return 'planning';

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

/** Human-readable labels for boss routing decisions. */
const ROUTE_LABELS: Record<BossRouteDecidedPayload['action'], string> = {
  delegate: 'Delegating task',
  meeting: 'Starting meeting',
  direct_delegate: 'Direct assignment',
  hire_or_assess: 'HR assessment',
  use_sop: 'Running SOP',
  direct_reply: 'Thinking…',
};

export interface PipelineStageInfo {
  stage: PipelineStage;
  routeLabel: string | null;
}

/**
 * Returns the current pipeline stage derived from graph.node.entered events,
 * plus a human-readable route label from boss.route.decided.
 * Clears automatically 3s after the runtime stops running.
 */
export function usePipelineStage(): PipelineStageInfo {
  const { eventBus } = useOffisimRuntimeServices();
  const { isRunning } = useOffisimRuntimeStatus();
  const [stage, setStage] = useState<PipelineStage>(null);
  const [routeLabel, setRouteLabel] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear stage when run ends
  useEffect(() => {
    if (!isRunning) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setStage(null);
        setRouteLabel(null);
      }, 3000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isRunning]);

  useEffect(() => {
    const offNode = eventBus.on(
      'graph.node.entered',
      (e: RuntimeEvent<GraphNodeEnteredPayload>) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        setStage(nodeToPipelineStage(e.payload.nodeName));
      },
    );
    const offRoute = eventBus.on(
      'boss.route.decided',
      (e: RuntimeEvent<BossRouteDecidedPayload>) => {
        setRouteLabel(ROUTE_LABELS[e.payload.action] ?? null);
      },
    );
    return () => {
      offNode();
      offRoute();
    };
  }, [eventBus]);

  return { stage, routeLabel };
}
