import type {
  ConversationSynopsisUpdatedPayload,
  ExecutionResumedPayload,
  InteractionRequestedPayload,
  InteractionRestoredPayload,
  RuntimeEvent,
  ToolExecutionTelemetryPayload,
} from '@offisim/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { useOffisimRuntime, useOffisimRuntimeStatus } from './offisim-runtime-context';

type SystemTone = 'info' | 'warning';

export interface SystemMessageEntry {
  id: string;
  label: string;
  tone: SystemTone;
}

interface ActiveToolEntry {
  toolCallId: string;
  toolName: string;
  startedAt: number;
}

function waitingLabel(kind: string): string {
  switch (kind) {
    case 'permission_request':
      return 'Waiting for approval';
    case 'plan_review':
      return 'Waiting for plan review';
    case 'agent_question':
      return 'Waiting for clarification';
    default:
      return 'Waiting for input';
  }
}

function restoredLabel(kind: string): string {
  switch (kind) {
    case 'permission_request':
      return 'Restored pending approval';
    case 'plan_review':
      return 'Restored pending plan review';
    case 'agent_question':
      return 'Restored pending clarification';
    default:
      return 'Restored pending input';
  }
}

function formatToolName(toolName: string): string {
  return toolName.replace(/_/g, ' ');
}

export function useSystemMessageFeed(): {
  entries: SystemMessageEntry[];
  hasMessages: boolean;
} {
  const { eventBus } = useOffisimRuntime();
  const { isRunning } = useOffisimRuntimeStatus();
  const [entries, setEntries] = useState<SystemMessageEntry[]>([]);
  const [activeTools, setActiveTools] = useState<Map<string, ActiveToolEntry>>(new Map());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isRunning) {
      setActiveTools(new Map());
      return;
    }
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  useEffect(() => {
    function pushEntry(entry: SystemMessageEntry): void {
      setEntries((prev) => [entry, ...prev].slice(0, 4));
    }

    const unsubSynopsis = eventBus.on(
      'conversation.synopsis.updated',
      (_event: RuntimeEvent<ConversationSynopsisUpdatedPayload>) => {
        pushEntry({
          id: `synopsis-${Date.now()}`,
          label: 'Compacting context...',
          tone: 'info',
        });
      },
    );

    const unsubResumed = eventBus.on(
      'execution.resumed',
      (_event: RuntimeEvent<ExecutionResumedPayload>) => {
        pushEntry({
          id: `resume-${Date.now()}`,
          label: 'Restoring from the latest checkpoint',
          tone: 'info',
        });
      },
    );

    const unsubInteractionRequested = eventBus.on(
      'interaction.requested',
      (event: RuntimeEvent<InteractionRequestedPayload>) => {
        pushEntry({
          id: `interaction-requested-${event.payload.request.interactionId}`,
          label: waitingLabel(event.payload.request.kind),
          tone: 'info',
        });
      },
    );

    const unsubInteractionRestored = eventBus.on(
      'interaction.restored',
      (event: RuntimeEvent<InteractionRestoredPayload>) => {
        pushEntry({
          id: `interaction-restored-${event.payload.request.interactionId}`,
          label: restoredLabel(event.payload.request.kind),
          tone: 'info',
        });
      },
    );

    const unsubToolTelemetry = eventBus.on(
      'tool.execution.telemetry',
      (event: RuntimeEvent<ToolExecutionTelemetryPayload>) => {
        const payload = event.payload;
        setActiveTools((prev) => {
          const next = new Map(prev);
          if (payload.status === 'started') {
            next.set(payload.toolCallId, {
              toolCallId: payload.toolCallId,
              toolName: payload.toolName,
              startedAt: payload.startedAt,
            });
            return next;
          }
          next.delete(payload.toolCallId);
          return next;
        });

        if (payload.status === 'denied' && payload.errorType === 'TOOL_PERMISSION_REQUIRED') {
          pushEntry({
            id: `tool-denied-${payload.toolCallId}`,
            label: `Approval needed for ${formatToolName(payload.toolName)}`,
            tone: 'warning',
          });
        }
      },
    );

    return () => {
      unsubSynopsis();
      unsubResumed();
      unsubInteractionRequested();
      unsubInteractionRestored();
      unsubToolTelemetry();
    };
  }, [eventBus]);

  const liveToolEntries = useMemo<SystemMessageEntry[]>(() => {
    return [...activeTools.values()]
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(0, 2)
      .map((tool) => ({
        id: `tool-active-${tool.toolCallId}`,
        label: `Tool ${formatToolName(tool.toolName)} running for ${Math.max(0, Math.floor((now - tool.startedAt) / 1_000))}s...`,
        tone: 'info',
      }));
  }, [activeTools, now]);

  const combinedEntries = useMemo(
    () => [...liveToolEntries, ...entries].slice(0, 4),
    [entries, liveToolEntries],
  );

  return {
    entries: combinedEntries,
    hasMessages: combinedEntries.length > 0,
  };
}
