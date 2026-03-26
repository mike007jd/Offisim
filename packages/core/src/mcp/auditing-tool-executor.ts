import type { EventBus } from '../events/event-bus.js';
import { mcpToolResult } from '../events/event-factories.js';
import { Logger } from '../services/logger.js';

const logger = new Logger('mcp');
import type { ToolDef } from '../llm/gateway.js';
import type { McpAuditRepository, NewMcpAudit } from '../runtime/repositories.js';
import type { ToolCallRequest, ToolCallResponse, ToolExecutor } from '../runtime/tool-executor.js';
import { generateId } from '../utils/generate-id.js';

/**
 * Decorator that wraps any ToolExecutor with audit logging and event emission.
 *
 * Writes to mcp_audit_log on every tool call (success or failure).
 * Audit failures are logged but never block the tool result.
 */
export class AuditingToolExecutor implements ToolExecutor {
  constructor(
    private readonly inner: ToolExecutor,
    private readonly auditRepo: McpAuditRepository,
    private readonly eventBus: EventBus,
    private readonly companyId: string,
    private readonly threadId: string,
  ) {}

  async listAvailable(companyId: string): Promise<ToolDef[]> {
    return this.inner.listAvailable(companyId);
  }

  async execute(call: ToolCallRequest): Promise<ToolCallResponse> {
    const auditId = generateId('ma');
    const startedAt = Date.now();

    const response = await this.inner.execute(call);
    const latencyMs = Date.now() - startedAt;
    const serverName = this.resolveServerName(call.name);

    // Audit write — failure must not block tool result
    try {
      const audit: NewMcpAudit = {
        audit_id: auditId,
        thread_id: this.threadId,
        task_run_id: null,
        employee_id: call.employeeId ?? 'unknown',
        server_name: serverName,
        tool_name: call.name,
        arguments_json: JSON.stringify(call.arguments),
        result_json: response.success ? JSON.stringify(response.result) : null,
        error: response.success ? null : (response.error ?? null),
        latency_ms: latencyMs,
        approved_by: 'auto',
        created_at: new Date().toISOString(),
      };
      await this.auditRepo.create(audit);
    } catch (dbError) {
      logger.error('Failed to record MCP audit', dbError, { auditId, toolName: call.name });
    }

    // Emit result event
    this.eventBus.emit(
      mcpToolResult(
        this.companyId,
        serverName,
        call.name,
        call.employeeId ?? 'unknown',
        call.toolCallId,
        response.success,
        latencyMs,
        response.error,
      ),
    );

    return response;
  }

  private resolveServerName(toolName: string): string {
    if (
      'getServerForTool' in this.inner &&
      typeof (this.inner as Record<string, unknown>).getServerForTool === 'function'
    ) {
      return (
        (this.inner as { getServerForTool(n: string): string | undefined }).getServerForTool(
          toolName,
        ) ?? toolName
      );
    }
    return toolName;
  }
}
