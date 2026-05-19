import type {
  InteractionRequestedPayload,
  InteractionRestoredPayload,
  RuntimeEvent,
  ToolExecutionTelemetryPayload,
} from '@offisim/shared-types';
import { useEffect, useState } from 'react';
import { useOffisimRuntimeServices } from './offisim-runtime-context';

type SystemTone = 'info' | 'warning';

export type SystemMessageIcon = 'default' | 'approval' | 'navigate';

export interface SystemMessageEntry {
  id: string;
  title: string;
  detail: string;
  tone: SystemTone;
  icon?: SystemMessageIcon;
}

function waitingTitle(kind: string): string {
  switch (kind) {
    case 'permission_request':
      return 'Approval Needed';
    case 'plan_review':
      return 'Plan Review Needed';
    case 'agent_question':
      return 'Interrupt & Steer';
    default:
      return 'Input Needed';
  }
}

function waitingDetail(kind: string): string {
  switch (kind) {
    case 'permission_request':
      return 'A blocked tool call is waiting for your approval.';
    case 'plan_review':
      return 'Review the proposed steps before execution continues.';
    case 'agent_question':
      return 'Reply now to steer the session without restarting the runtime.';
    default:
      return 'Execution is paused until you respond.';
  }
}

function restoredTitle(kind: string): string {
  switch (kind) {
    case 'permission_request':
      return 'Approval Restored';
    case 'plan_review':
      return 'Plan Review Restored';
    case 'agent_question':
      return 'Interrupt & Steer Restored';
    default:
      return 'Pending Input Restored';
  }
}

function restoredDetail(kind: string): string {
  switch (kind) {
    case 'permission_request':
      return 'The pending approval survived recovery and can be answered now.';
    case 'plan_review':
      return 'The review gate was restored after recovery.';
    case 'agent_question':
      return 'The pending clarification came back after recovery.';
    default:
      return 'The pending decision was restored after recovery.';
  }
}

function formatToolName(toolName: string): string {
  return toolName.replace(/_/g, ' ');
}

export function useSystemMessageFeed(): {
  entries: SystemMessageEntry[];
  hasMessages: boolean;
} {
  const { eventBus } = useOffisimRuntimeServices();
  const [entries, setEntries] = useState<SystemMessageEntry[]>([]);

  useEffect(() => {
    function pushEntry(entry: SystemMessageEntry): void {
      setEntries((prev) =>
        [entry, ...prev.filter((existing) => existing.id !== entry.id)].slice(0, 4),
      );
    }

    const unsubInteractionRequested = eventBus.on(
      'interaction.requested',
      (event: RuntimeEvent<InteractionRequestedPayload>) => {
        pushEntry({
          id: `interaction-requested-${event.payload.request.interactionId}`,
          title: waitingTitle(event.payload.request.kind),
          detail: waitingDetail(event.payload.request.kind),
          tone: 'info',
          icon: event.payload.request.kind === 'agent_question' ? 'navigate' : 'approval',
        });
      },
    );

    const unsubInteractionRestored = eventBus.on(
      'interaction.restored',
      (event: RuntimeEvent<InteractionRestoredPayload>) => {
        pushEntry({
          id: `interaction-restored-${event.payload.request.interactionId}`,
          title: restoredTitle(event.payload.request.kind),
          detail: restoredDetail(event.payload.request.kind),
          tone: 'info',
          icon: event.payload.request.kind === 'agent_question' ? 'navigate' : 'approval',
        });
      },
    );

    const unsubToolTelemetry = eventBus.on(
      'tool.execution.telemetry',
      (event: RuntimeEvent<ToolExecutionTelemetryPayload>) => {
        const payload = event.payload;
        if (payload.status === 'denied' && payload.errorType === 'TOOL_PERMISSION_REQUIRED') {
          pushEntry({
            id: `tool-denied-${payload.toolCallId}`,
            title: 'Tool Approval Needed',
            detail: `Approve ${formatToolName(payload.toolName)} so execution can continue.`,
            tone: 'warning',
            icon: 'approval',
          });
        }
      },
    );

    return () => {
      unsubInteractionRequested();
      unsubInteractionRestored();
      unsubToolTelemetry();
    };
  }, [eventBus]);

  return {
    entries,
    hasMessages: entries.length > 0,
  };
}
