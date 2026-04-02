import type {
  ConversationCompactCompletedPayload,
  ConversationSynopsisUpdatedPayload,
  ExecutionResumedPayload,
  GraphNodeEnteredPayload,
  GraphNodeExitedPayload,
  InteractionKind,
  InteractionModeChangedPayload,
  InteractionRequestedPayload,
  InteractionResolvedPayload,
  InteractionRestoredPayload,
  PlanCreatedPayload,
  RuntimeEvent,
  SessionCostUpdatedPayload,
  TaskAssignmentDispatchedPayload,
  ToolExecutionTelemetryPayload,
  WorkspaceStalenessDetectedPayload,
} from '@offisim/shared-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { humanizeNodeName } from '../lib/agent-display';
import { categorizeTool, type ToolCategory } from '../lib/tool-category';
import { useOffisimRuntime, useOffisimRuntimeStatus } from './offisim-runtime-context';

export type RuntimeActivityTone = 'info' | 'success' | 'warning' | 'error';

export interface RuntimeActivityEntry {
  id: string;
  kind: 'node' | 'plan' | 'dispatch' | 'tool' | 'cost' | 'system';
  tone: RuntimeActivityTone;
  label: string;
  timestamp: number;
  burstKey?: string;
  burstCount?: number;
}

export interface RuntimeActivityTool {
  toolCallId: string;
  label: string;
  elapsedSeconds: number;
  nodeName: string | null;
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function formatDuration(durationMs?: number): string {
  if (!durationMs || durationMs < 1000) return '<1s';
  if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.round(durationMs / 1000)}s`;
}

function activeToolHeadline(category: ToolCategory): string {
  switch (category) {
    case 'search':
      return 'Searching the codebase';
    case 'read':
      return 'Reading relevant files';
    case 'edit':
      return 'Editing the workspace';
    case 'shell':
      return 'Running shell tasks';
    default:
      return 'Running tools';
  }
}

function activeToolGroupLabel(category: ToolCategory, count: number): string {
  const suffix = count > 1 ? ` (${count})` : '';
  switch (category) {
    case 'search':
      return `Searching codebase${suffix}`;
    case 'read':
      return `Reading files${suffix}`;
    case 'edit':
      return `Editing workspace${suffix}`;
    case 'shell':
      return `Shell tasks${suffix}`;
    default:
      return `Live tools${suffix}`;
  }
}

function toolBurstLabel(
  category: ToolCategory,
  status: ToolExecutionTelemetryPayload['status'],
  count: number,
): string {
  if (status === 'started') {
    switch (category) {
      case 'search':
        return count > 1 ? `Searching codebase with ${count} tools` : 'Started code search';
      case 'read':
        return count > 1 ? `Reading files with ${count} tools` : 'Started reading files';
      case 'edit':
        return count > 1 ? `Editing workspace with ${count} tools` : 'Started editing workspace';
      case 'shell':
        return count > 1 ? `Running ${count} shell tasks` : 'Started shell task';
      default:
        return count > 1 ? `Started ${count} tools` : 'Started tool';
    }
  }

  if (status === 'completed') {
    switch (category) {
      case 'search':
        return count > 1 ? `Searched codebase with ${count} tools` : 'Completed code search';
      case 'read':
        return count > 1 ? `Read files with ${count} tools` : 'Completed file read';
      case 'edit':
        return count > 1 ? `Applied ${count} workspace edits` : 'Completed workspace edit';
      case 'shell':
        return count > 1 ? `Completed ${count} shell tasks` : 'Completed shell task';
      default:
        return count > 1 ? `Completed ${count} tool calls` : 'Completed tool call';
    }
  }

  if (status === 'denied') {
    return count > 1 ? `Blocked ${count} tool requests` : 'Blocked tool request';
  }

  return count > 1 ? `Failed ${count} tool calls` : 'Failed tool call';
}

function enteredHeadline(nodeName: string): string {
  switch (nodeName) {
    case 'boss':
      return 'Boss is analyzing the request';
    case 'manager':
      return 'Manager is routing work';
    case 'pm_planner':
      return 'PM is building an execution plan';
    case 'pm_replan':
      return 'PM is re-planning around new conditions';
    case 'step_dispatcher':
      return 'Dispatching work to specialists';
    case 'employee':
      return 'Employees are executing the current step';
    case 'boss_summary':
      return 'Boss is drafting the final response';
    case 'hr':
      return 'HR is evaluating the request';
    case 'error_handler':
      return 'Recovery flow is handling a fault';
    default:
      return `${humanizeNodeName(nodeName)} is working`;
  }
}

function exitedEntry(nodeName: string): RuntimeActivityEntry {
  return {
    id: `node-${nodeName}-${Date.now()}`,
    kind: 'node',
    tone: 'success',
    label: `${humanizeNodeName(nodeName)} finished`,
    timestamp: Date.now(),
  };
}

function interactionRequestedLabel(kind: InteractionKind): string {
  switch (kind) {
    case 'permission_request':
      return 'Waiting for approval';
    case 'plan_review':
      return 'Waiting for plan review';
    case 'agent_question':
      return 'Waiting for clarification';
    default:
      return 'Waiting for user input';
  }
}

function interactionResolvedLabel(kind: InteractionKind, selectedOptionId: string): string {
  const action = selectedOptionId.replaceAll('_', ' ');
  switch (kind) {
    case 'permission_request':
      return `Approval decision: ${action}`;
    case 'plan_review':
      return `Plan review: ${action}`;
    case 'agent_question':
      return `Clarification received: ${action}`;
    default:
      return `Decision received: ${action}`;
  }
}

function interactionRestoredLabel(kind: InteractionKind): string {
  switch (kind) {
    case 'permission_request':
      return 'Restored pending approval';
    case 'plan_review':
      return 'Restored pending plan review';
    case 'agent_question':
      return 'Restored pending clarification';
    default:
      return 'Restored pending interaction';
  }
}

function telemetryLabel(payload: ToolExecutionTelemetryPayload): string {
  const base = payload.serverName ? `${payload.serverName}/${payload.toolName}` : payload.toolName;
  return truncate(base.replaceAll('_', ' '), 42);
}

function formatStalenessReason(payload: WorkspaceStalenessDetectedPayload): string {
  switch (payload.reason) {
    case 'git_head_changed':
      return 'Workspace head changed since the last checkpoint';
    case 'git_worktree_changed':
      return `Workspace changed locally${payload.currentStatusLines ? ` (${payload.currentStatusLines} file${payload.currentStatusLines === 1 ? '' : 's'})` : ''}`;
    case 'missing_baseline':
      return 'No workspace baseline is available yet';
    case 'missing_workspace_root':
      return 'Workspace root is unavailable for resume checks';
    case 'not_git_repository':
      return 'Workspace is not a Git repository';
    case 'capture_failed':
      return 'Workspace snapshot could not be captured';
    default:
      return 'Workspace state changed';
  }
}

function pushEntry(
  prev: RuntimeActivityEntry[],
  next: RuntimeActivityEntry,
  limit: number,
): RuntimeActivityEntry[] {
  const latest = prev[0];
  if (
    latest &&
    next.kind === 'tool' &&
    latest.kind === 'tool' &&
    next.burstKey &&
    latest.burstKey === next.burstKey &&
    next.tone === latest.tone &&
    Math.abs(next.timestamp - latest.timestamp) <= 3_500
  ) {
    const mergedCount = (latest.burstCount ?? 1) + (next.burstCount ?? 1);
    return [
      {
        ...next,
        burstCount: mergedCount,
        label: toolBurstLabel(
          next.burstKey.split(':')[1] as ToolCategory,
          next.burstKey.split(':')[0] as ToolExecutionTelemetryPayload['status'],
          mergedCount,
        ),
      },
      ...prev.slice(1),
    ].slice(0, limit);
  }
  return [next, ...prev].slice(0, limit);
}

export function useRuntimeActivityFeed(opts?: {
  maxEntries?: number;
}): {
  headline: string | null;
  entries: RuntimeActivityEntry[];
  activeTools: RuntimeActivityTool[];
  totalCostUsd: number | null;
  hasActivity: boolean;
} {
  const { eventBus } = useOffisimRuntime();
  const { isRunning } = useOffisimRuntimeStatus();
  const maxEntries = opts?.maxEntries ?? 6;
  const [entries, setEntries] = useState<RuntimeActivityEntry[]>([]);
  const [activeToolsState, setActiveToolsState] = useState<
    Map<string, ToolExecutionTelemetryPayload>
  >(() => new Map());
  const [totalCostUsd, setTotalCostUsd] = useState<number | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const [baseHeadline, setBaseHeadline] = useState<string | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isRunning) {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      setBaseHeadline('Warming up the runtime');
      setEntries([]);
      setActiveToolsState(new Map());
      setTotalCostUsd(null);
      return;
    }

    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => {
      setBaseHeadline(null);
      setActiveToolsState(new Map());
    }, 2400);

    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, [isRunning]);

  useEffect(() => {
    if (activeToolsState.size === 0) return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeToolsState.size]);

  useEffect(() => {
    const offEntered = eventBus.on(
      'graph.node.entered',
      (event: RuntimeEvent<GraphNodeEnteredPayload>) => {
        setBaseHeadline(enteredHeadline(event.payload.nodeName));
      },
    );

    const offExited = eventBus.on(
      'graph.node.exited',
      (event: RuntimeEvent<GraphNodeExitedPayload>) => {
        setEntries((prev) => pushEntry(prev, exitedEntry(event.payload.nodeName), maxEntries));
      },
    );

    const offPlan = eventBus.on('plan.created', (event: RuntimeEvent<PlanCreatedPayload>) => {
      const stepCount = event.payload.steps.length;
      const label = event.payload.summary
        ? `Plan ready: ${truncate(event.payload.summary, 44)}`
        : `Plan ready with ${stepCount} steps`;
      setBaseHeadline(label);
      setEntries((prev) =>
        pushEntry(
          prev,
          {
            id: `plan-${event.payload.planId}`,
            kind: 'plan',
            tone: 'info',
            label: `PM created ${stepCount} step${stepCount === 1 ? '' : 's'}`,
            timestamp: event.timestamp,
          },
          maxEntries,
        ),
      );
    });

    const offDispatch = eventBus.on(
      'task.assignment.dispatched',
      (event: RuntimeEvent<TaskAssignmentDispatchedPayload>) => {
        setEntries((prev) =>
          pushEntry(
            prev,
            {
              id: `dispatch-${event.timestamp}-${event.payload.employeeId}-${event.payload.stepIndex}`,
              kind: 'dispatch',
              tone: 'info',
              label: `${event.payload.employeeName} took step ${event.payload.stepIndex + 1}: ${truncate(event.payload.stepLabel, 34)}`,
              timestamp: event.timestamp,
            },
            maxEntries,
          ),
        );
      },
    );

    const offInteractionRequested = eventBus.on(
      'interaction.requested',
      (event: RuntimeEvent<InteractionRequestedPayload>) => {
        const label = interactionRequestedLabel(event.payload.request.kind);
        setBaseHeadline(label);
        setEntries((prev) =>
          pushEntry(
            prev,
            {
              id: `interaction-${event.payload.request.interactionId}`,
              kind: 'system',
              tone: event.payload.request.severity === 'high' ? 'warning' : 'info',
              label,
              timestamp: event.timestamp,
            },
            maxEntries,
          ),
        );
      },
    );

    const offInteractionResolved = eventBus.on(
      'interaction.resolved',
      (event: RuntimeEvent<InteractionResolvedPayload>) => {
        setEntries((prev) =>
          pushEntry(
            prev,
            {
              id: `interaction-resolved-${event.payload.request.interactionId}`,
              kind: 'system',
              tone: 'success',
              label: interactionResolvedLabel(
                event.payload.request.kind,
                event.payload.response.selectedOptionId,
              ),
              timestamp: event.timestamp,
            },
            maxEntries,
          ),
        );
      },
    );

    const offInteractionRestored = eventBus.on(
      'interaction.restored',
      (event: RuntimeEvent<InteractionRestoredPayload>) => {
        const label = interactionRestoredLabel(event.payload.request.kind);
        setBaseHeadline(label);
        setEntries((prev) =>
          pushEntry(
            prev,
            {
              id: `interaction-restored-${event.payload.request.interactionId}`,
              kind: 'system',
              tone: 'info',
              label,
              timestamp: event.timestamp,
            },
            maxEntries,
          ),
        );
      },
    );

    const offInteractionMode = eventBus.on(
      'interaction.mode.changed',
      (event: RuntimeEvent<InteractionModeChangedPayload>) => {
        setEntries((prev) =>
          pushEntry(
            prev,
            {
              id: `interaction-mode-${event.timestamp}`,
              kind: 'system',
              tone: 'info',
              label: `Interaction mode: ${event.payload.nextMode.replaceAll('_', ' ')}`,
              timestamp: event.timestamp,
            },
            maxEntries,
          ),
        );
      },
    );

    const offTool = eventBus.on(
      'tool.execution.telemetry',
      (event: RuntimeEvent<ToolExecutionTelemetryPayload>) => {
        const payload = event.payload;
        const label = telemetryLabel(payload);
        if (payload.status === 'started') {
          const category = categorizeTool(payload);
          setActiveToolsState((prev) => {
            const next = new Map(prev);
            next.set(payload.toolCallId, payload);
            return next;
          });
          setEntries((prev) =>
            pushEntry(
              prev,
              {
                id: `tool-${payload.toolCallId}-started`,
                kind: 'tool',
                tone: 'info',
                label: `Started ${label}`,
                timestamp: payload.startedAt,
                burstKey: `started:${category}`,
                burstCount: 1,
              },
              maxEntries,
            ),
          );
          return;
        }

        setActiveToolsState((prev) => {
          const next = new Map(prev);
          next.delete(payload.toolCallId);
          return next;
        });

        const tone: RuntimeActivityTone =
          payload.status === 'completed'
            ? 'success'
            : payload.status === 'denied'
              ? 'warning'
              : 'error';
        const category = categorizeTool(payload);
        const prefix =
          payload.status === 'completed'
            ? 'Completed'
            : payload.errorType === 'TOOL_PERMISSION_REQUIRED'
              ? 'Approval needed for'
              : payload.errorType === 'TOOL_PERMISSION_DENIED'
                ? 'Access blocked for'
                : payload.status === 'denied'
                  ? 'Denied'
                  : 'Failed';
        const suffix =
          payload.status === 'completed' && payload.durationMs != null
            ? ` in ${formatDuration(payload.durationMs)}`
            : '';

        setEntries((prev) =>
          pushEntry(
            prev,
            {
              id: `tool-${payload.toolCallId}-${payload.status}`,
              kind: 'tool',
              tone,
              label:
                payload.status === 'completed'
                  ? `Completed ${label}${suffix}`
                  : `${prefix} ${label}`,
              timestamp: payload.completedAt ?? event.timestamp,
              burstKey: `${payload.status}:${category}`,
              burstCount: 1,
            },
            maxEntries,
          ),
        );
      },
    );

    const offSynopsis = eventBus.on(
      'conversation.synopsis.updated',
      (event: RuntimeEvent<ConversationSynopsisUpdatedPayload>) => {
        setBaseHeadline('Compacting context for the next turn');
        setEntries((prev) =>
          pushEntry(
            prev,
            {
              id: `synopsis-${event.payload.version}`,
              kind: 'system',
              tone: 'info',
              label: `Compacted ${event.payload.prunedMessageCount} messages into a fresh synopsis`,
              timestamp: event.timestamp,
            },
            maxEntries,
          ),
        );
      },
    );

    const offCompact = eventBus.on(
      'conversation.compact.completed',
      (event: RuntimeEvent<ConversationCompactCompletedPayload>) => {
        setBaseHeadline('Established a new compact baseline');
        setEntries((prev) =>
          pushEntry(
            prev,
            {
              id: `compact-${event.payload.compactId}`,
              kind: 'system',
              tone: 'success',
              label: `Compacted ${event.payload.compactedNonSystemMessageCount} messages and kept a ${event.payload.keptTailNonSystemMessageCount}-message live tail`,
              timestamp: event.timestamp,
            },
            maxEntries,
          ),
        );
      },
    );

    const offResume = eventBus.on(
      'execution.resumed',
      (event: RuntimeEvent<ExecutionResumedPayload>) => {
        setBaseHeadline('Restoring from the latest checkpoint');
        setEntries((prev) =>
          pushEntry(
            prev,
            {
              id: `resume-${event.timestamp}`,
              kind: 'system',
              tone: 'info',
              label:
                event.payload.rewoundFromStepIndex != null
                  ? `Rewound to step ${event.payload.rewoundFromStepIndex + 1} and resumed`
                  : `Resumed at step ${event.payload.currentStepIndex + 1}`,
              timestamp: event.timestamp,
            },
            maxEntries,
          ),
        );
      },
    );

    const offStaleness = eventBus.on(
      'workspace.staleness.detected',
      (event: RuntimeEvent<WorkspaceStalenessDetectedPayload>) => {
        setBaseHeadline(
          event.payload.status === 'block'
            ? 'Resume blocked by workspace changes'
            : 'Workspace changed since the last checkpoint',
        );
        setEntries((prev) =>
          pushEntry(
            prev,
            {
              id: `workspace-${event.timestamp}`,
              kind: 'system',
              tone: event.payload.status === 'block' ? 'error' : 'warning',
              label: formatStalenessReason(event.payload),
              timestamp: event.timestamp,
            },
            maxEntries,
          ),
        );
      },
    );

    const offCost = eventBus.on(
      'cost.session.updated',
      (event: RuntimeEvent<SessionCostUpdatedPayload>) => {
        setTotalCostUsd(event.payload.totalCostUsd);
      },
    );

    return () => {
      offEntered();
      offExited();
      offPlan();
      offDispatch();
      offInteractionRequested();
      offInteractionResolved();
      offInteractionRestored();
      offInteractionMode();
      offTool();
      offSynopsis();
      offCompact();
      offResume();
      offStaleness();
      offCost();
    };
  }, [eventBus, maxEntries]);

  const activeTools = useMemo<RuntimeActivityTool[]>(() => {
    const grouped = new Map<
      ToolCategory,
      { count: number; startedAt: number; nodeName: string | null }
    >();
    for (const tool of activeToolsState.values()) {
      const category = categorizeTool(tool);
      const current = grouped.get(category);
      if (!current) {
        grouped.set(category, {
          count: 1,
          startedAt: tool.startedAt,
          nodeName: tool.nodeName ?? null,
        });
        continue;
      }
      grouped.set(category, {
        count: current.count + 1,
        startedAt: Math.min(current.startedAt, tool.startedAt),
        nodeName: current.nodeName ?? tool.nodeName ?? null,
      });
    }
    return [...grouped.entries()]
      .sort((a, b) => a[1].startedAt - b[1].startedAt)
      .map(([category, group]) => ({
        toolCallId: `group:${category}`,
        label: activeToolGroupLabel(category, group.count),
        elapsedSeconds: Math.max(0, Math.floor((tick - group.startedAt) / 1000)),
        nodeName: group.nodeName,
      }));
  }, [activeToolsState, tick]);

  const headline = useMemo(() => {
    const firstActive = activeToolsState.values().next().value as
      | ToolExecutionTelemetryPayload
      | undefined;
    if (firstActive) {
      return activeToolHeadline(categorizeTool(firstActive));
    }
    return baseHeadline;
  }, [activeToolsState, baseHeadline]);

  return {
    headline,
    entries,
    activeTools,
    totalCostUsd,
    hasActivity: Boolean(headline || entries.length > 0 || activeTools.length > 0),
  };
}
