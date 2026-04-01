import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { AuditingToolExecutor } from '../../mcp/auditing-tool-executor.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import type {
  ToolCallRequest,
  ToolCallResponse,
  ToolExecutor,
} from '../../runtime/tool-executor.js';
import { ToolTelemetryService } from '../../services/tool-telemetry-service.js';

function createExecutor(response: ToolCallResponse): ToolExecutor {
  return {
    execute: vi.fn().mockResolvedValue(response),
    listAvailable: vi.fn().mockResolvedValue([]),
  };
}

const BASE_CALL: ToolCallRequest = {
  toolCallId: 'tc-1',
  name: 'read_file',
  arguments: { filePath: '/tmp/demo.ts' },
  employeeId: 'emp-1',
  taskRunId: 'tr-1',
  nodeName: 'employee',
};

describe('ToolTelemetryService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures started and completed tool telemetry', async () => {
    const eventBus = new InMemoryEventBus();
    const telemetry = new ToolTelemetryService(eventBus);
    const executor = new AuditingToolExecutor(
      createExecutor({ success: true, result: 'ok' }),
      createMemoryRepositories().mcpAudit,
      eventBus,
      'company-1',
      'thread-1',
    );

    const promise = executor.execute(BASE_CALL);
    await vi.advanceTimersByTimeAsync(250);
    await promise;

    const entries = telemetry.listByThread('thread-1');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      toolCallId: 'tc-1',
      status: 'started',
      nodeName: 'employee',
      employeeId: 'emp-1',
    });
    expect(entries[1]).toMatchObject({
      toolCallId: 'tc-1',
      status: 'completed',
      durationMs: expect.any(Number),
      toolType: 'mcp',
    });
  });

  it('captures failed tool telemetry as error', async () => {
    const eventBus = new InMemoryEventBus();
    const telemetry = new ToolTelemetryService(eventBus);
    const executor = new AuditingToolExecutor(
      createExecutor({ success: false, result: null, error: 'permission denied' }),
      createMemoryRepositories().mcpAudit,
      eventBus,
      'company-1',
      'thread-1',
    );

    const promise = executor.execute({ ...BASE_CALL, toolCallId: 'tc-2' });
    await vi.advanceTimersByTimeAsync(100);
    await promise;

    const entries = telemetry.listByThread('thread-1');
    expect(entries.at(-1)).toMatchObject({
      toolCallId: 'tc-2',
      status: 'error',
      errorType: 'permission denied',
    });
  });
});
