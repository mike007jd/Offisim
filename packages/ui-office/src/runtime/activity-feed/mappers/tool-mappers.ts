import type {
  McpToolCalledPayload,
  RuntimeEvent,
  ToolExecutionTelemetryPayload,
} from '@offisim/shared-types';
import { getToolCategory, telemetryLabel } from '../../runtime-activity-formatters';
import type { ActivityEventBus, ActivityMapperSink, RuntimeActivityTone } from '../activity-types';

export function subscribeToolMappers(
  eventBus: ActivityEventBus,
  sink: ActivityMapperSink,
): () => void {
  const offTelemetry = eventBus.on(
    'tool.execution.telemetry',
    (event: RuntimeEvent<ToolExecutionTelemetryPayload>) => {
      const payload = event.payload;
      if (payload.status === 'started') {
        sink.trackToolStart(payload);
        return;
      }
      sink.trackToolEnd(payload.toolCallId);
      if (payload.status === 'completed') return;

      const tone: RuntimeActivityTone = payload.status === 'denied' ? 'warning' : 'error';
      const category = getToolCategory(payload);
      const label = telemetryLabel(payload);
      const prefix =
        payload.errorType === 'TOOL_PERMISSION_REQUIRED'
          ? 'Approval needed for'
          : payload.errorType === 'TOOL_PERMISSION_DENIED'
            ? 'Access blocked for'
            : payload.status === 'denied'
              ? 'Denied'
              : 'Failed';

      sink.push({
        id: `tool-${payload.toolCallId}-${payload.status}`,
        kind: 'tool',
        tone,
        label: `${prefix} ${label}`,
        timestamp: payload.completedAt ?? event.timestamp,
        burstKey: `${payload.status}:${category}`,
        burstCount: 1,
      });
    },
  );

  const offMcp = eventBus.on('mcp.tool.called', (event: RuntimeEvent<McpToolCalledPayload>) => {
    sink.push({
      id: `mcp-${event.timestamp}-${event.payload.toolName}`,
      kind: 'system',
      tone: 'info',
      label: `MCP: ${event.payload.toolName}`,
      timestamp: event.timestamp,
    });
  });

  return () => {
    offTelemetry();
    offMcp();
  };
}
