import type { LlmCallStartedPayload, ToolExecutionTelemetryPayload } from '@offisim/shared-types';
import type { useOffisimRuntime } from '../offisim-runtime-context';

/** Minimal event-bus surface consumed by mappers (pulled from runtime context). */
export type ActivityEventBus = ReturnType<typeof useOffisimRuntime>['eventBus'];

export type RuntimeActivityTone = 'info' | 'success' | 'warning' | 'error';

export interface RuntimeActivityEntry {
  id: string;
  kind: 'node' | 'plan' | 'dispatch' | 'tool' | 'cost' | 'system' | 'llm' | 'engine';
  tone: RuntimeActivityTone;
  label: string;
  timestamp: number;
  employeeId?: string | null;
  /**
   * Product-layer chat_threads.thread_id this entry was scoped to (from the
   * source event's `chatThreadId` payload field). `null` when the event was
   * unscoped (background_sync, install_flow, pm_heartbeat). Right-rail UIs
   * filter by `entry.chatThreadId === activeChatThreadId`; the global
   * Activity Log workspace ignores this and shows everything.
   */
  chatThreadId?: string | null;
  burstKey?: string;
  burstCount?: number;
}

export interface RuntimeActivityTool {
  toolCallId: string;
  label: string;
  elapsedSeconds: number;
  nodeName: string | null;
}

/**
 * Stable-reference sink passed to every mapper. Mappers read only the methods
 * they need — the barrel wires every callback via `useCallback` so mapper
 * subscriptions don't re-register on render.
 */
export interface ActivityMapperSink {
  push: (entry: RuntimeActivityEntry) => void;
  setHeadline: (headline: string | null) => void;
  trackLlmStart: (payload: LlmCallStartedPayload) => void;
  trackLlmEnd: (callId: string) => void;
  trackToolStart: (payload: ToolExecutionTelemetryPayload) => void;
  trackToolEnd: (toolCallId: string) => void;
  setTotalCostUsd: (usd: number) => void;
  readActiveLlmModel: (callId: string) => string | null;
}
