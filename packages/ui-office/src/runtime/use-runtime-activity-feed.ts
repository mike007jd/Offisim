import type { LlmCallStartedPayload, ToolExecutionTelemetryPayload } from '@offisim/shared-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ToolCategory } from '../lib/tool-category';
import type { ActivityMapperSink } from './activity-feed/activity-types';
import { subscribeConversationBudgetMappers } from './activity-feed/mappers/conversation-budget-mappers';
import { subscribeCostMappers } from './activity-feed/mappers/cost-mappers';
import { subscribeDeliverableMappers } from './activity-feed/mappers/deliverable-mappers';
import { subscribeExecutionMappers } from './activity-feed/mappers/execution-mappers';
import { subscribeGraphMappers } from './activity-feed/mappers/graph-mappers';
import { subscribeHandoffMappers } from './activity-feed/mappers/handoff-mappers';
import { subscribeInteractionMappers } from './activity-feed/mappers/interaction-mappers';
import { subscribeLlmMappers } from './activity-feed/mappers/llm-mappers';
import { subscribeMemoryMappers } from './activity-feed/mappers/memory-mappers';
import { subscribePlanMappers } from './activity-feed/mappers/plan-mappers';
import { subscribeTaskMappers } from './activity-feed/mappers/task-mappers';
import { subscribeToolMappers } from './activity-feed/mappers/tool-mappers';
import { subscribeWorkspaceMappers } from './activity-feed/mappers/workspace-mappers';
import { useActivityRingBuffer } from './activity-feed/useActivityRingBuffer';
import { useOffisimRuntime, useOffisimRuntimeStatus } from './offisim-runtime-context';
import {
  activeToolGroupLabel,
  activeToolHeadline,
  getToolCategory,
  llmStartedHeadline,
} from './runtime-activity-formatters';

export type {
  RuntimeActivityEntry,
  RuntimeActivityTone,
  RuntimeActivityTool,
} from './activity-feed/activity-types';
import type { RuntimeActivityEntry, RuntimeActivityTool } from './activity-feed/activity-types';

export function useRuntimeActivityFeed(opts?: { maxEntries?: number }): {
  headline: string | null;
  entries: RuntimeActivityEntry[];
  activeTools: RuntimeActivityTool[];
  totalCostUsd: number | null;
  hasActivity: boolean;
} {
  const { eventBus } = useOffisimRuntime();
  const { isRunning } = useOffisimRuntimeStatus();
  const maxEntries = opts?.maxEntries ?? 6;
  const { entries, push, clear } = useActivityRingBuffer({ capacity: maxEntries });
  const [activeToolsState, setActiveToolsState] = useState<
    Map<string, ToolExecutionTelemetryPayload>
  >(() => new Map());
  const [activeLlmCalls, setActiveLlmCalls] = useState<Map<string, LlmCallStartedPayload>>(
    () => new Map(),
  );
  const activeLlmCallsRef = useRef<Map<string, LlmCallStartedPayload>>(new Map());
  const [totalCostUsd, setTotalCostUsd] = useState<number | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const [baseHeadline, setBaseHeadline] = useState<string | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isRunning) {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      setBaseHeadline('Warming up the runtime');
      clear();
      setActiveToolsState(new Map());
      activeLlmCallsRef.current = new Map();
      setActiveLlmCalls(new Map());
      setTotalCostUsd(null);
      return;
    }
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => {
      setBaseHeadline(null);
      setActiveToolsState(new Map());
      activeLlmCallsRef.current = new Map();
      setActiveLlmCalls(new Map());
    }, 2400);
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, [isRunning, clear]);

  useEffect(() => {
    if (activeToolsState.size === 0) return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeToolsState.size]);

  const sink = useMemo<ActivityMapperSink>(
    () => ({
      push,
      setHeadline: setBaseHeadline,
      setTotalCostUsd,
      trackLlmStart: (payload) => {
        const next = new Map(activeLlmCallsRef.current);
        next.set(payload.llmCallId, payload);
        activeLlmCallsRef.current = next;
        setActiveLlmCalls(next);
      },
      trackLlmEnd: (callId) => {
        const next = new Map(activeLlmCallsRef.current);
        next.delete(callId);
        activeLlmCallsRef.current = next;
        setActiveLlmCalls(next);
      },
      readActiveLlmModel: (callId) => activeLlmCallsRef.current.get(callId)?.model ?? null,
      trackToolStart: (payload) =>
        setActiveToolsState((prev) => new Map(prev).set(payload.toolCallId, payload)),
      trackToolEnd: (toolCallId) =>
        setActiveToolsState((prev) => {
          const next = new Map(prev);
          next.delete(toolCallId);
          return next;
        }),
    }),
    [push],
  );

  useEffect(() => {
    const cleanups = [
      subscribeGraphMappers(eventBus, sink),
      subscribePlanMappers(eventBus, sink),
      subscribeTaskMappers(eventBus, sink),
      subscribeInteractionMappers(eventBus, sink),
      subscribeLlmMappers(eventBus, sink),
      subscribeToolMappers(eventBus, sink),
      subscribeExecutionMappers(eventBus, sink),
      subscribeDeliverableMappers(eventBus, sink),
      subscribeHandoffMappers(eventBus, sink),
      subscribeMemoryMappers(eventBus, sink),
      subscribeWorkspaceMappers(eventBus, sink),
      subscribeConversationBudgetMappers(eventBus, sink),
      subscribeCostMappers(eventBus, sink),
    ];
    return () => {
      for (const off of cleanups.reverse()) off();
    };
  }, [eventBus, sink]);

  const activeTools = useMemo<RuntimeActivityTool[]>(() => {
    const grouped = new Map<
      ToolCategory,
      { count: number; startedAt: number; nodeName: string | null }
    >();
    for (const tool of activeToolsState.values()) {
      const category = getToolCategory(tool);
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
    if (firstActive) return activeToolHeadline(getToolCategory(firstActive));
    const firstLlm = activeLlmCalls.values().next().value as LlmCallStartedPayload | undefined;
    if (firstLlm) return llmStartedHeadline(firstLlm.nodeName, firstLlm.model);
    return baseHeadline;
  }, [activeLlmCalls, activeToolsState, baseHeadline]);

  return {
    headline,
    entries,
    activeTools,
    totalCostUsd,
    hasActivity: Boolean(headline || entries.length > 0 || activeTools.length > 0),
  };
}
