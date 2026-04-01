import type { RuntimeEvent, ToolExecutionTelemetryPayload } from '@offisim/shared-types';
import type { EventBus } from '../events/event-bus.js';

export class ToolTelemetryService {
  private readonly entriesByThread = new Map<string, ToolExecutionTelemetryPayload[]>();
  private readonly unsubscribe: () => void;

  constructor(eventBus: EventBus) {
    this.unsubscribe = eventBus.on('tool.execution.telemetry', (event) => {
      this.onTelemetry(event as RuntimeEvent<ToolExecutionTelemetryPayload>);
    });
  }

  listByThread(threadId: string, opts?: { limit?: number }): ToolExecutionTelemetryPayload[] {
    const entries = this.entriesByThread.get(threadId) ?? [];
    if (!opts?.limit || entries.length <= opts.limit) {
      return [...entries];
    }
    return entries.slice(-opts.limit);
  }

  dispose(): void {
    this.unsubscribe();
  }

  private onTelemetry(event: RuntimeEvent<ToolExecutionTelemetryPayload>): void {
    const threadId = event.threadId ?? event.payload.threadId;
    const entries = this.entriesByThread.get(threadId) ?? [];
    entries.push(event.payload);
    this.entriesByThread.set(threadId, entries);
  }
}
