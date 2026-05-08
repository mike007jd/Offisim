import { type InteractionRequest, chatScopeFields } from '@offisim/shared-types';
import type { EventBus } from '../events/event-bus.js';
import { mcpToolResult, toolExecutionTelemetry } from '../events/event-factories.js';
import type {
  ToolPermissionAuthorizer,
  ToolPermissionDecision,
} from '../permissions/tool-permission-engine.js';
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
import type { InteractionService } from '../services/interaction-service.js';
import { generateId } from '../utils/generate-id.js';

interface ToolExecutionRecordContext {
  readonly auditId: string;
  readonly call: ToolCallRequest;
  readonly serverName: string;
  readonly threadId: string;
  readonly startedAt: number;
  readonly concurrentWith: string[];
}

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
    private readonly interactionService?: InteractionService,
  ) {}

  async listAvailable(companyId: string): Promise<ToolDef[]> {
    return this.inner.listAvailable(companyId);
  }

  getServerForTool(toolName: string): string | undefined {
    return this.resolveServerName(toolName);
  }

  async execute(call: ToolCallRequest): Promise<ToolCallResponse> {
    const auditId = generateId('ma');
    const startedAt = Date.now();
    const concurrentWith = [...this.activeToolCalls];
    const serverName = this.resolveServerName(call.name);
    const threadId = call.threadId ?? this.threadId;
    const recordCtx = { auditId, call, serverName, threadId, startedAt, concurrentWith };

    this.activeToolCalls.add(call.toolCallId);
    this.eventBus.emit(
      toolExecutionTelemetry(this.companyId, threadId, {
        toolCallId: call.toolCallId,
        toolName: call.name,
        toolType: 'mcp',
        threadId,
        nodeName: call.nodeName,
        employeeId: call.employeeId,
        taskRunId: call.taskRunId ?? null,
        serverName,
        startedAt,
        status: 'started',
        concurrentWith,
        ...chatScopeFields(call.runScope),
      }),
    );

    try {
      let approvedBy = 'auto';
      if (this.permissionAuthorizer) {
        const decision = await this.evaluatePermission(call, serverName, threadId);
        approvedBy = decision.approvedBy;
        if (decision.behavior === 'deny') {
          const response = this.buildPermissionResponse(decision.behavior, decision.reason);
          return this.recordAndEmit(recordCtx, response, approvedBy);
        }
        if (decision.behavior === 'ask') {
          const askOutcome = await this.resolveAskDecision(recordCtx, decision);
          if (askOutcome.kind === 'return') return askOutcome.response;
          approvedBy = askOutcome.approvedBy;
        }
      }

      const response = await this.inner.execute(call);
      return this.recordAndEmit(recordCtx, response, approvedBy);
    } catch (error) {
      const completedAt = Date.now();
      this.eventBus.emit(
        toolExecutionTelemetry(this.companyId, threadId, {
          toolCallId: call.toolCallId,
          toolName: call.name,
          toolType: 'mcp',
          threadId,
          nodeName: call.nodeName,
          employeeId: call.employeeId,
          taskRunId: call.taskRunId ?? null,
          ...chatScopeFields(call.runScope),
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

  private async evaluatePermission(
    call: ToolCallRequest,
    serverName: string,
    threadId: string,
  ): Promise<ToolPermissionDecision> {
    if (!this.permissionAuthorizer) {
      throw new Error('Permission authorizer is not configured.');
    }
    return this.permissionAuthorizer.evaluate({
      threadId,
      serverName,
      toolName: call.name,
      employeeId: call.employeeId,
      employeeConfigJson: call.employeeConfigJson,
    });
  }

  private async resolveAskDecision(
    ctx: ToolExecutionRecordContext,
    decision: ToolPermissionDecision,
  ): Promise<
    { kind: 'continue'; approvedBy: string } | { kind: 'return'; response: ToolCallResponse }
  > {
    const { call, serverName } = ctx;
    const request = this.buildPermissionInteractionRequest(
      call,
      serverName,
      decision.reason,
      ctx.threadId,
      decision.policyHash,
    );

    if (this.interactionService?.getMode() !== 'human_in_loop') {
      if (this.interactionService) {
        await this.interactionService.request(request, { runScope: call.runScope ?? null });
      }
      const response = this.buildPermissionResponse('ask', decision.reason);
      return {
        kind: 'return',
        response: await this.recordAndEmit(ctx, response, decision.approvedBy),
      };
    }

    const resolved = await this.interactionService.requestAndWait(request, {
      signal: call.signal,
      runScope: call.runScope ?? null,
    });
    if (resolved.selectedOptionId === 'reject') {
      const response = this.buildPermissionResponse('deny', 'Denied by user approval prompt.');
      return {
        kind: 'return',
        response: await this.recordAndEmit(ctx, response, 'interaction:reject'),
      };
    }

    const afterGrant = await this.evaluatePermission(call, serverName, ctx.threadId);
    if (afterGrant.behavior !== 'allow') {
      const response = this.buildPermissionResponse(afterGrant.behavior, afterGrant.reason);
      return {
        kind: 'return',
        response: await this.recordAndEmit(ctx, response, afterGrant.approvedBy),
      };
    }

    return { kind: 'continue', approvedBy: afterGrant.approvedBy };
  }

  private async recordAndEmit(
    ctx: ToolExecutionRecordContext,
    response: ToolCallResponse,
    approvedBy: string,
  ): Promise<ToolCallResponse> {
    const completedAt = Date.now();
    await this.writeAudit({
      auditId: ctx.auditId,
      call: ctx.call,
      serverName: ctx.serverName,
      response,
      latencyMs: completedAt - ctx.startedAt,
      approvedBy,
    });
    this.emitToolResult(
      ctx.call,
      ctx.serverName,
      response,
      ctx.startedAt,
      completedAt,
      ctx.concurrentWith,
    );
    return response;
  }

  private buildPermissionResponse(behavior: 'deny' | 'ask', reason: string): ToolCallResponse {
    const code = behavior === 'deny' ? TOOL_PERMISSION_DENIED : TOOL_PERMISSION_REQUIRED;
    return {
      success: false,
      result: null,
      error: `[${code}] ${reason}`,
    };
  }

  private buildPermissionInteractionRequest(
    call: ToolCallRequest,
    serverName: string,
    reason: string,
    threadId: string,
    policyHash?: string,
  ): InteractionRequest {
    const severity = this.classifyPermissionSeverity(call.name);
    return {
      interactionId: generateId('ix'),
      threadId,
      companyId: this.companyId,
      kind: 'permission_request',
      severity,
      title: severity === 'high' ? 'Approval needed for a sensitive tool' : 'Approve tool access',
      prompt: `Allow ${serverName}/${call.name} for this run?`,
      options: [
        {
          id: 'approve_once',
          label: 'Approve once',
          description: 'Allow this tool call and retry the last request.',
          scope: 'once',
          recommended: true,
        },
        {
          id: 'approve_thread',
          label: 'Approve for thread',
          description: 'Allow repeated use of this tool in the current thread.',
          scope: 'thread',
        },
        {
          id: 'reject',
          label: 'Reject',
          description: 'Keep the tool blocked and let the boss adapt.',
        },
      ],
      recommendation: {
        optionId: 'approve_once',
        reason,
      },
      allowFreeformResponse: true,
      placeholder: 'Tell Offisim what to do instead',
      requestedByNode: call.nodeName,
      employeeId: call.employeeId ?? null,
      taskRunId: call.taskRunId ?? null,
      context: {
        type: 'permission_request',
        serverName,
        toolName: call.name,
        employeeId: call.employeeId ?? null,
        ...(policyHash ? { policyHash } : {}),
      },
      createdAt: Date.now(),
    };
  }

  private classifyPermissionSeverity(toolName: string): 'normal' | 'high' {
    if (/(write|edit|delete|remove|create|push|commit|bash|exec|run|apply)/i.test(toolName)) {
      return 'high';
    }
    return /^(get|list|read|search|find|fetch|query|lookup|describe|inspect|status|show|preview|count)[_.:/-]/i.test(
      `${toolName}-`,
    )
      ? 'normal'
      : 'high';
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
        thread_id: params.call.threadId ?? this.threadId,
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
      toolExecutionTelemetry(this.companyId, call.threadId ?? this.threadId, {
        toolCallId: call.toolCallId,
        toolName: call.name,
        toolType: 'mcp',
        threadId: call.threadId ?? this.threadId,
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
        ...chatScopeFields(call.runScope),
      }),
    );
  }
}
