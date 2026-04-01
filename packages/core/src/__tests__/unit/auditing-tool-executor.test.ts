import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventBus } from '../../events/event-bus.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { AuditingToolExecutor } from '../../mcp/auditing-tool-executor.js';
import type { ToolPermissionAuthorizer } from '../../permissions/tool-permission-engine.js';
import type { McpAuditRepository, McpAuditRow, NewMcpAudit } from '../../runtime/repositories.js';
import type {
  ToolCallRequest,
  ToolCallResponse,
  ToolExecutor,
} from '../../runtime/tool-executor.js';
import { InteractionService } from '../../services/interaction-service.js';
import { assertDefined } from '../helpers/fixtures.js';

// Mock inner executor
function createMockExecutor(response: ToolCallResponse): ToolExecutor {
  return {
    execute: vi.fn().mockResolvedValue(response),
    listAvailable: vi.fn().mockResolvedValue([]),
  };
}

// Mock audit repo
function createMockAuditRepo(): McpAuditRepository & { rows: NewMcpAudit[] } {
  const rows: NewMcpAudit[] = [];
  return {
    rows,
    create: vi.fn(async (audit: NewMcpAudit) => {
      rows.push(audit);
      return audit as McpAuditRow;
    }),
    listByThread: vi.fn(async () => []),
    countByThread: vi.fn(async () => 0),
    deleteByThread: vi.fn(async () => {}),
  };
}

const CALL: ToolCallRequest = {
  toolCallId: 'tc-1',
  name: 'read_file',
  arguments: { path: '/tmp/test.txt' },
  employeeId: 'emp-1',
  taskRunId: 'tr-1',
};

describe('AuditingToolExecutor', () => {
  let inner: ToolExecutor;
  let auditRepo: ReturnType<typeof createMockAuditRepo>;
  let eventBus: EventBus;
  let executor: AuditingToolExecutor;
  let permissionAuthorizer: ToolPermissionAuthorizer;

  beforeEach(() => {
    inner = createMockExecutor({ success: true, result: 'file content' });
    auditRepo = createMockAuditRepo();
    eventBus = new InMemoryEventBus();
    permissionAuthorizer = {
      evaluate: vi.fn().mockResolvedValue({
        behavior: 'allow',
        source: 'default',
        reason: 'default allow',
        approvedBy: 'auto',
      }),
    };
    executor = new AuditingToolExecutor(
      inner,
      auditRepo,
      eventBus,
      'company-1',
      'thread-1',
      permissionAuthorizer,
    );
  });

  it('delegates execute to inner executor and returns its result', async () => {
    const result = await executor.execute(CALL);
    expect(result).toEqual({ success: true, result: 'file content' });
    expect(inner.execute).toHaveBeenCalledWith(CALL);
  });

  it('writes audit record on success', async () => {
    await executor.execute(CALL);
    expect(auditRepo.create).toHaveBeenCalledTimes(1);
    const audit = assertDefined(auditRepo.rows[0]);
    expect(audit.tool_name).toBe('read_file');
    expect(audit.employee_id).toBe('emp-1');
    expect(audit.task_run_id).toBe('tr-1');
    expect(audit.error).toBeNull();
    expect(audit.approved_by).toBe('auto');
  });

  it('short-circuits inner execution when the permission authorizer denies the tool call', async () => {
    permissionAuthorizer = {
      evaluate: vi.fn().mockResolvedValue({
        behavior: 'deny',
        source: 'runtime',
        reason: 'policy deny',
        approvedBy: 'runtime:deny',
      }),
    };
    executor = new AuditingToolExecutor(
      inner,
      auditRepo,
      eventBus,
      'company-1',
      'thread-1',
      permissionAuthorizer,
    );

    const result = await executor.execute(CALL);

    expect(result.success).toBe(false);
    expect(result.error).toContain('TOOL_PERMISSION_DENIED');
    expect(inner.execute).not.toHaveBeenCalled();
    expect(auditRepo.rows[0]?.approved_by).toBe('runtime:deny');
  });

  it('short-circuits inner execution when the permission authorizer asks for approval', async () => {
    permissionAuthorizer = {
      evaluate: vi.fn().mockResolvedValue({
        behavior: 'ask',
        source: 'employee',
        reason: 'first use requires approval',
        approvedBy: 'employee:ask_first_time',
      }),
    };
    executor = new AuditingToolExecutor(
      inner,
      auditRepo,
      eventBus,
      'company-1',
      'thread-1',
      permissionAuthorizer,
    );

    const result = await executor.execute(CALL);

    expect(result.success).toBe(false);
    expect(result.error).toContain('TOOL_PERMISSION_REQUIRED');
    expect(inner.execute).not.toHaveBeenCalled();
    expect(auditRepo.rows[0]?.approved_by).toBe('employee:ask_first_time');
  });

  it('emits a pending interaction request when approval is required', async () => {
    permissionAuthorizer = {
      evaluate: vi.fn().mockResolvedValue({
        behavior: 'ask',
        source: 'employee',
        reason: 'first use requires approval',
        approvedBy: 'employee:ask_first_time',
      }),
    };
    const interactionService = new InteractionService({
      eventBus: eventBus as InMemoryEventBus,
      companyId: 'company-1',
      threadId: 'thread-1',
    });
    executor = new AuditingToolExecutor(
      inner,
      auditRepo,
      eventBus,
      'company-1',
      'thread-1',
      permissionAuthorizer,
      interactionService,
    );

    await executor.execute(CALL);

    expect(interactionService.getPending()).toMatchObject({
      kind: 'permission_request',
      context: { type: 'permission_request', toolName: 'read_file' },
    });
  });

  it('writes audit record on failure', async () => {
    inner = createMockExecutor({ success: false, result: null, error: 'permission denied' });
    executor = new AuditingToolExecutor(inner, auditRepo, eventBus, 'company-1', 'thread-1');
    await executor.execute(CALL);
    expect(auditRepo.rows[0]?.error).toBe('permission denied');
  });

  it('emits mcp.tool.result event', async () => {
    const events: unknown[] = [];
    eventBus.on('mcp.tool.result', (e) => events.push(e));
    await executor.execute(CALL);
    expect(events).toHaveLength(1);
  });

  it('does not block on audit repo failure', async () => {
    auditRepo.create = vi.fn().mockRejectedValue(new Error('DB down'));
    const result = await executor.execute(CALL);
    expect(result.success).toBe(true); // inner result still returned
  });

  it('delegates listAvailable to inner', async () => {
    await executor.listAvailable('c1');
    expect(inner.listAvailable).toHaveBeenCalledWith('c1');
  });
});
