import type { EventBus } from '../events/event-bus.js';
import { mcpToolResult, toolExecutionTelemetry } from '../events/event-factories.js';
import type { ToolPermissionAuthorizer } from '../permissions/tool-permission-engine.js';
import {
  TOOL_PERMISSION_DENIED,
  TOOL_PERMISSION_REQUIRED,
  WORKSTATION_ACCESS_DENIED,
} from '../runtime/tool-executor.js';
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
  private readonly activeToolCalls = new Set<string>();

  constructor(
    private readonly inner: ToolExecutor,
    private readonly auditRepo: McpAuditRepository,
    private readonly eventBus: EventBus,
    private readonly companyId: string,
    private readonly threadId: string,
    private readonly permissionAuthorizer?: ToolPermissionAuthorizer,
  ) {}

  async listAvailable(companyId: string): Promise<ToolDef[]> {
    return this.inner.listAvailable(companyId);
  }

  async execute(call: ToolCallRequest): Promise<ToolCallResponse> {
    const auditId = generateId('ma');
    const startedAt = Date.now();
    const concurrentWith = [...this.activeToolCalls];
    const serverName = this.resolveServerName(call.name);

    this.activeToolCalls.add(call.toolCallId);
    this.eventBus.emit(
      toolExecutionTelemetry(this.companyId, this.threadId, {
        toolCallId: call.toolCallId,
        toolName: call.name,
        toolType: 'mcp',
        threadId: this.threadId,
        nodeName: call.nodeName,
        employeeId: call.employeeId,
        taskRunId: call.taskRunId ?? null,
        serverName,
        startedAt,
        status: 'started',
        concurrentWith,
      }),
    );

    try {
      if (this.permissionAuthorizer) {
        const decision = await this.permissionAuthorizer.evaluate({
          threadId: this.threadId,
          serverName,
          toolName: call.name,
          employeeId: call.employeeId,
        });
        if (decision.behavior !== 'allow') {
          const response = this.buildPermissionResponse(decision.behavior, decision.reason);
          const completedAt = Date.now();
          const latencyMs = completedAt - startedAt;
          await this.writeAudit({
            auditId,
            call,
            serverName,
            response,
            latencyMs,
            approvedBy: decision.approvedBy,
          });
          this.emitToolResult(call, serverName, response, startedAt, completedAt, concurrentWith);
          return response;
        }
      }

      const response = await this.inner.execute(call);
      const completedAt = Date.now();
      const latencyMs = completedAt - startedAt;

      await this.writeAudit({
        auditId,
        call,
        serverName,
        response,
        latencyMs,
        approvedBy: 'auto',
      });
      this.emitToolResult(call, serverName, response, startedAt, completedAt, concurrentWith);

      return response;
    } catch (error) {
      const completedAt = Date.now();
      this.eventBus.emit(
        toolExecutionTelemetry(this.companyId, this.threadId, {
          toolCallId: call.toolCallId,
          toolName: call.name,
          toolType: 'mcp',
          threadId: this.threadId,
          nodeName: call.nodeName,
          employeeId: call.employeeId,
          taskRunId: call.taskRunId ?? null,
          serverName,
          startedAt,
          completedAt,
          durationMs: completedAt - startedAt,
          status: 'error',
          errorType: error instanceof Error ? error.message : String(error),
          concurrentWith,
        }),
      );
      throw error;
    } finally {
      this.activeToolCalls.delete(call.toolCallId);
    }
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

  private buildPermissionResponse(behavior: 'deny' | 'ask', reason: string): ToolCallResponse {
    const code = behavior === 'deny' ? TOOL_PERMISSION_DENIED : TOOL_PERMISSION_REQUIRED;
    return {
      success: false,
      result: null,
      error: `[${code}] ${reason}`,
    };
  }

  private async writeAudit(params: {
    auditId: string;
    call: ToolCallRequest;
    serverName: string;
    response: ToolCallResponse;
    latencyMs: number;
    approvedBy: string;
  }): Promise<void> {
    try {
      const audit: NewMcpAudit = {
        audit_id: params.auditId,
        thread_id: this.threadId,
        task_run_id: params.call.taskRunId ?? null,
        employee_id: params.call.employeeId ?? 'unknown',
        server_name: params.serverName,
        tool_name: params.call.name,
        arguments_json: JSON.stringify(params.call.arguments),
        result_json: params.response.success ? JSON.stringify(params.response.result) : null,
        error: params.response.success ? null : (params.response.error ?? null),
        latency_ms: params.latencyMs,
        approved_by: params.approvedBy,
        created_at: new Date().toISOString(),
      };
      await this.auditRepo.create(audit);
    } catch (dbError) {
      logger.error('Failed to record MCP audit', dbError, {
        auditId: params.auditId,
        toolName: params.call.name,
      });
    }
  }

  private emitToolResult(
    call: ToolCallRequest,
    serverName: string,
    response: ToolCallResponse,
    startedAt: number,
    completedAt: number,
    concurrentWith: string[],
  ): void {
    const latencyMs = completedAt - startedAt;
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
    this.eventBus.emit(
      toolExecutionTelemetry(this.companyId, this.threadId, {
        toolCallId: call.toolCallId,
        toolName: call.name,
        toolType: 'mcp',
        threadId: this.threadId,
        nodeName: call.nodeName,
        employeeId: call.employeeId,
        taskRunId: call.taskRunId ?? null,
        serverName,
        startedAt,
        completedAt,
        durationMs: latencyMs,
        status: response.success
          ? 'completed'
          : response.error?.includes(WORKSTATION_ACCESS_DENIED) ||
              response.error?.includes(TOOL_PERMISSION_DENIED) ||
              response.error?.includes(TOOL_PERMISSION_REQUIRED)
            ? 'denied'
            : 'error',
        errorType: response.success ? undefined : response.error,
        concurrentWith,
      }),
    );
  }
}
