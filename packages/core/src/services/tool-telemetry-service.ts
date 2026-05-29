import type { RuntimeEvent, ToolExecutionTelemetryPayload } from '@offisim/shared-types';
import type { EventBus } from '../events/event-bus.js';

// Bound memory: telemetry is a rolling UI view, not durable storage. Without
// caps, entriesByThread grew unboundedly (one array per thread, appended per
// tool call, never evicted) across a long multi-thread session.
const MAX_ENTRIES_PER_THREAD = 500;
const MAX_TRACKED_THREADS = 200;

export class ToolTelemetryService {
  // Insertion-ordered: the first key is the least-recently-updated thread, so
  // we can evict it when MAX_TRACKED_THREADS is exceeded.
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
    // Per-thread ring buffer: keep only the most recent N.
    if (entries.length > MAX_ENTRIES_PER_THREAD) {
      entries.splice(0, entries.length - MAX_ENTRIES_PER_THREAD);
    }
    // Re-insert so this thread becomes most-recently-used in iteration order.
    this.entriesByThread.delete(threadId);
    this.entriesByThread.set(threadId, entries);
    // Evict least-recently-updated threads beyond the cap.
    while (this.entriesByThread.size > MAX_TRACKED_THREADS) {
      const oldest = this.entriesByThread.keys().next().value;
      if (oldest === undefined) break;
      this.entriesByThread.delete(oldest);
    }
  }
}
