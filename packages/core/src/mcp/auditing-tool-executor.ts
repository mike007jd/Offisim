import {
  type InteractionRequest,
  type InteractionResponse,
  chatScopeFields,
} from '@offisim/shared-types';
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
import type { HookRegistry } from '../runtime/hook-registry.js';
import type { McpAuditRepository, NewMcpAudit } from '../runtime/repositories.js';
import type { ToolCallRequest, ToolCallResponse, ToolExecutor } from '../runtime/tool-executor.js';
import type { InteractionService } from '../services/interaction-service.js';
import { BASH_DESTRUCTIVE_APPROVED_ARG } from '../tools/builtin/bash-tool.js';
import { classifyShellCommand } from '../tools/builtin/shell-command-classifier.js';
import {
  type RuntimeToolSource,
  type RuntimeToolType,
  type ServerAnnotationTrustResolver,
  type ToolSourceResolver,
  resolveRuntimeToolSource,
} from '../tools/tool-registry.js';
import { capToolResultForModel } from '../tools/tool-result-size.js';
import { generateId } from '../utils/generate-id.js';

// Keys whose values should never land in audit storage as plaintext. Matched
// case-insensitively. Surrounded value content (PEM headers, OpenAI-style key
// prefixes, etc.) also triggers redaction inside scalar string values.
const SENSITIVE_KEY_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /token/i,
  /authorization/i,
  /bearer/i,
  /access[_-]?key/i,
  /private[_-]?key/i,
  /cookie/i,
];
const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /\bssh-(?:rsa|ed25519|dss)\s+[A-Za-z0-9+/=]+/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/, // OpenAI-style secret key
  /\bpk-[A-Za-z0-9_-]{20,}\b/, // public key with credential-looking prefix
  /\bBearer\s+[A-Za-z0-9._-]+/i,
];
const REDACTED = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((p) => p.test(key));
}

function maskValueString(value: string): string {
  let out = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

function redactSensitiveFields(value: unknown, depth = 0): unknown {
  if (depth > 8) return value; // bound recursion on pathological payloads
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return maskValueString(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveFields(item, depth + 1));
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = redactSensitiveFields(source[key], depth + 1);
    }
  }
  return out;
}

interface ToolExecutionRecordContext {
  readonly auditId: string;
  readonly call: ToolCallRequest;
  readonly toolSource: RuntimeToolSource;
  readonly threadId: string;
  readonly startedAt: number;
  readonly concurrentWith: string[];
}

/** Outcome of an approval ask flow: proceed with the call, or short-circuit. */
type AskFlowOutcome =
  | { kind: 'continue'; approvedBy: string }
  | { kind: 'return'; response: ToolCallResponse };

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
    private readonly hookRegistry?: HookRegistry,
  ) {}

  async listAvailable(companyId: string): Promise<ToolDef[]> {
    return this.inner.listAvailable(companyId);
  }

  getServerForTool(toolName: string): string | undefined {
    return this.resolveToolSource(toolName).serverName;
  }

  getToolTypeForTool(toolName: string): RuntimeToolType {
    return this.resolveToolSource(toolName).toolType;
  }

  async execute(call: ToolCallRequest): Promise<ToolCallResponse> {
    const auditId = generateId('ma');
    const startedAt = Date.now();
    const concurrentWith = [...this.activeToolCalls];
    const toolSource = this.resolveToolSource(call.name);
    const { serverName, toolType } = toolSource;
    const threadId = call.threadId ?? this.threadId;
    const recordCtx = { auditId, call, toolSource, threadId, startedAt, concurrentWith };

    this.activeToolCalls.add(call.toolCallId);
    this.eventBus.emit(
      toolExecutionTelemetry(this.companyId, threadId, {
        toolCallId: call.toolCallId,
        toolName: call.name,
        toolType,
        evidenceClass: 'offisim-gateway',
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

    // Memoize the available-tool catalog for the duration of this single call.
    // capResponse() and readOnlyHintForTool() each need a ToolDef lookup; without
    // this they would re-list the entire catalog (O(N)) on every invocation.
    const loadTools = this.memoizeToolDefs();

    try {
      let approvedBy = 'auto';
      const before = await this.hookRegistry?.runToolBefore({
        toolName: call.name,
        input: call.arguments,
        threadId,
        ...(call.employeeId ? { employeeId: call.employeeId } : {}),
      });
      if (before?.blocked) {
        const response = this.buildPermissionResponse('deny', before.reason ?? 'Blocked by hook.');
        return this.recordAndEmit(recordCtx, response, 'hook:tool.before');
      }
      // The hook signals an intentional input replacement by presence, not
      // truthiness: a hook may clear/reset arguments via `updateInput({})` (or
      // null). Apply `before.input` whenever it is present (not undefined) so an
      // intentionally emptied/cleared input still takes effect.
      const rewrittenInput =
        before && 'input' in before && before.input !== undefined ? before.input : undefined;
      const effectiveCall =
        rewrittenInput !== undefined ? { ...call, arguments: rewrittenInput } : call;
      let executionCall = effectiveCall;
      let effectiveRecordCtx =
        rewrittenInput !== undefined ? { ...recordCtx, call: effectiveCall } : recordCtx;
      const shellGate = await this.resolveShellPermissionGate(effectiveRecordCtx, executionCall);
      if (shellGate.kind === 'return') return shellGate.response;
      executionCall = shellGate.call;
      effectiveRecordCtx =
        executionCall === effectiveCall
          ? effectiveRecordCtx
          : { ...effectiveRecordCtx, call: executionCall };
      if (shellGate.approvedBy) approvedBy = shellGate.approvedBy;
      if (this.permissionAuthorizer) {
        const decision = await this.evaluatePermission(
          executionCall,
          serverName,
          threadId,
          loadTools,
        );
        approvedBy = approvedBy === 'auto' ? decision.approvedBy : approvedBy;
        if (decision.behavior === 'deny') {
          const response = this.buildPermissionResponse(decision.behavior, decision.reason);
          return this.recordAndEmit(effectiveRecordCtx, response, approvedBy);
        }
        if (decision.behavior === 'ask') {
          const askOutcome = await this.resolveAskDecision(effectiveRecordCtx, decision, loadTools);
          if (askOutcome.kind === 'return') return askOutcome.response;
          approvedBy = askOutcome.approvedBy;
        }
      }

      const response = await this.capResponse(
        executionCall,
        await this.inner.execute(executionCall),
        loadTools,
      );
      await this.hookRegistry?.emit('tool.after', {
        toolName: executionCall.name,
        input: executionCall.arguments,
        response,
        threadId,
        employeeId: executionCall.employeeId,
      });
      return this.recordAndEmit(effectiveRecordCtx, response, approvedBy);
    } catch (error) {
      this.emitToolExecutionTelemetry(call, toolSource, threadId, {
        startedAt,
        completedAt: Date.now(),
        status: 'error',
        errorType: error instanceof Error ? error.message : String(error),
        concurrentWith,
      });
      throw error;
    } finally {
      this.activeToolCalls.delete(call.toolCallId);
    }
  }

  private resolveToolSource(toolName: string): RuntimeToolSource {
    const resolver = this.inner as Partial<ToolSourceResolver>;
    if (typeof resolver.getServerForTool !== 'function') {
      return resolveRuntimeToolSource(toolName);
    }
    const serverName = resolver.getServerForTool(toolName) ?? toolName;
    const toolType =
      typeof resolver.getToolTypeForTool === 'function'
        ? resolver.getToolTypeForTool(toolName)
        : undefined;
    return resolveRuntimeToolSource(toolName, {
      serverForTool: () => serverName,
      toolTypeForTool: () => toolType,
    });
  }

  /**
   * Build a memoized accessor for the available-tool catalog, scoped to a single
   * execute() call. The first await triggers one listAvailable(); every later
   * lookup reuses the resolved promise instead of re-listing the catalog.
   */
  private memoizeToolDefs(): () => Promise<ToolDef[]> {
    let cached: Promise<ToolDef[]> | undefined;
    return () => {
      if (!cached) cached = this.inner.listAvailable(this.companyId);
      return cached;
    };
  }

  private async capResponse(
    call: ToolCallRequest,
    response: ToolCallResponse,
    loadTools: () => Promise<ToolDef[]>,
  ): Promise<ToolCallResponse> {
    if (!response.success) return response;
    const tool = (await loadTools()).find((item) => item.name === call.name);
    return tool
      ? { ...response, result: await capToolResultForModel(tool.maxResultSizeChars, response.result) }
      : response;
  }

  private async evaluatePermission(
    call: ToolCallRequest,
    serverName: string,
    threadId: string,
    loadTools: () => Promise<ToolDef[]>,
  ): Promise<ToolPermissionDecision> {
    if (!this.permissionAuthorizer) {
      throw new Error('Permission authorizer is not configured.');
    }
    return this.permissionAuthorizer.evaluate({
      threadId,
      serverName,
      toolName: call.name,
      arguments: call.arguments,
      readOnlyHint: await this.readOnlyHintForTool(call.name, loadTools),
      employeeId: call.employeeId,
      employeeConfigJson: call.employeeConfigJson,
    });
  }

  private async resolveShellPermissionGate(
    ctx: ToolExecutionRecordContext,
    call: ToolCallRequest,
  ): Promise<
    | { kind: 'continue'; call: ToolCallRequest; approvedBy?: string }
    | { kind: 'return'; response: ToolCallResponse }
  > {
    if (call.name !== 'bash') return { kind: 'continue', call };
    const command = typeof call.arguments.command === 'string' ? call.arguments.command : '';
    const classification = classifyShellCommand(command);
    if (classification.decision === 'allow') return { kind: 'continue', call };
    if (classification.decision === 'deny') {
      const response = this.buildPermissionResponse('deny', classification.reason);
      return {
        kind: 'return',
        response: await this.recordAndEmit(ctx, response, 'shell-classifier:deny'),
      };
    }
    if (call.arguments[BASH_DESTRUCTIVE_APPROVED_ARG] === true) {
      return { kind: 'continue', call };
    }
    const decision: ToolPermissionDecision = {
      behavior: 'ask',
      source: 'runtime',
      reason: classification.reason,
      approvedBy: 'shell-classifier:ask',
      policyHash: 'shell-command-classifier:destructive',
    };
    const outcome = await this.resolveShellAskDecision(ctx, decision);
    if (outcome.kind === 'return') return outcome;
    return {
      kind: 'continue',
      approvedBy: outcome.approvedBy,
      call: {
        ...call,
        arguments: {
          ...call.arguments,
          [BASH_DESTRUCTIVE_APPROVED_ARG]: true,
        },
      },
    };
  }

  /**
   * Shared approval ask skeleton: build the interaction request, short-circuit
   * to an `ask` audit when no human is in the loop, deny when the user rejects,
   * and otherwise hand the resolved interaction to `onGranted` to decide how the
   * call proceeds. The shell-classifier and permission-engine flows differ only
   * in that post-grant step.
   */
  private async resolveAskFlow(
    ctx: ToolExecutionRecordContext,
    decision: ToolPermissionDecision,
    onGranted: (resolved: InteractionResponse) => AskFlowOutcome | Promise<AskFlowOutcome>,
  ): Promise<AskFlowOutcome> {
    const request = this.buildPermissionInteractionRequest(
      ctx.call,
      ctx.toolSource.serverName,
      decision.reason,
      ctx.threadId,
      decision.policyHash,
    );

    if (this.interactionService?.getMode() !== 'human_in_loop') {
      if (this.interactionService) {
        await this.interactionService.request(request, { runScope: ctx.call.runScope ?? null });
      }
      const response = this.buildPermissionResponse('ask', decision.reason);
      return {
        kind: 'return',
        response: await this.recordAndEmit(ctx, response, decision.approvedBy),
      };
    }

    const resolved = await this.interactionService.requestAndWait(request, {
      signal: ctx.call.signal,
      runScope: ctx.call.runScope ?? null,
    });
    if (resolved.selectedOptionId === 'reject') {
      const response = this.buildPermissionResponse('deny', 'Denied by user approval prompt.');
      return {
        kind: 'return',
        response: await this.recordAndEmit(ctx, response, 'interaction:reject'),
      };
    }
    return onGranted(resolved);
  }

  private resolveShellAskDecision(
    ctx: ToolExecutionRecordContext,
    decision: ToolPermissionDecision,
  ): Promise<AskFlowOutcome> {
    return this.resolveAskFlow(ctx, decision, (resolved) => ({
      kind: 'continue',
      approvedBy:
        resolved.selectedOptionId === 'approve_thread' ? 'interaction:thread' : 'interaction:once',
    }));
  }

  private async readOnlyHintForTool(
    toolName: string,
    loadTools: () => Promise<ToolDef[]>,
  ): Promise<boolean | undefined> {
    const tool = (await loadTools()).find((item) => item.name === toolName);
    const hint = tool?.annotations?.readOnlyHint;
    if (hint !== true) return hint;

    // MCP 2025-03-26 spec: tool annotations are untrusted unless they come from
    // a server the user has explicitly marked as trusted. For unknown servers
    // we must surface the call to the permission ask flow even when the server
    // claims `readOnlyHint: true`.
    const serverName = this.resolveToolSource(toolName).serverName;
    if (this.isServerTrustedForAnnotations(serverName)) {
      return hint;
    }
    return undefined;
  }

  private isServerTrustedForAnnotations(serverName: string): boolean {
    const resolver = this.inner as Partial<ServerAnnotationTrustResolver>;
    // Default-untrusted for executors that don't implement the capability
    // (e.g. the composite/built-in-only executors, test stubs).
    return typeof resolver.isServerTrustedForAnnotations === 'function'
      ? resolver.isServerTrustedForAnnotations(serverName)
      : false;
  }

  private resolveAskDecision(
    ctx: ToolExecutionRecordContext,
    decision: ToolPermissionDecision,
    loadTools: () => Promise<ToolDef[]>,
  ): Promise<AskFlowOutcome> {
    return this.resolveAskFlow(ctx, decision, async () => {
      // Re-evaluate after the grant: a thread-scoped approval may now resolve to
      // allow, but a policy can still deny/ask on the second pass.
      const afterGrant = await this.evaluatePermission(
        ctx.call,
        ctx.toolSource.serverName,
        ctx.threadId,
        loadTools,
      );
      if (afterGrant.behavior !== 'allow') {
        const response = this.buildPermissionResponse(afterGrant.behavior, afterGrant.reason);
        return {
          kind: 'return',
          response: await this.recordAndEmit(ctx, response, afterGrant.approvedBy),
        };
      }
      return { kind: 'continue', approvedBy: afterGrant.approvedBy };
    });
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
      serverName: ctx.toolSource.serverName,
      response,
      latencyMs: completedAt - ctx.startedAt,
      approvedBy,
    });
    this.emitToolResult(
      ctx.call,
      ctx.toolSource,
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
        arguments_json: JSON.stringify(redactSensitiveFields(params.call.arguments)),
        result_json: params.response.success
          ? JSON.stringify(redactSensitiveFields(params.response.result))
          : null,
        // MCP server error strings (and our own deny-reason text) routinely
        // echo back the offending command/headers/url; mask the same value
        // patterns we already redact in arguments_json/result_json.
        error: params.response.success
          ? null
          : params.response.error
            ? maskValueString(params.response.error)
            : null,
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
    toolSource: RuntimeToolSource,
    response: ToolCallResponse,
    startedAt: number,
    completedAt: number,
    concurrentWith: string[],
  ): void {
    const latencyMs = completedAt - startedAt;
    const redactedError = response.error ? maskValueString(response.error) : response.error;
    this.eventBus.emit(
      mcpToolResult(
        this.companyId,
        toolSource.serverName,
        call.name,
        call.employeeId ?? 'unknown',
        call.toolCallId,
        response.success,
        latencyMs,
        redactedError,
      ),
    );
    this.emitToolExecutionTelemetry(call, toolSource, call.threadId ?? this.threadId, {
      startedAt,
      completedAt,
      status: response.success
        ? 'completed'
        : response.error?.includes(WORKSTATION_ACCESS_DENIED) ||
            response.error?.includes(TOOL_PERMISSION_DENIED) ||
            response.error?.includes(TOOL_PERMISSION_REQUIRED)
          ? 'denied'
          : 'error',
      errorType: response.success ? undefined : redactedError,
      concurrentWith,
    });
  }

  /**
   * Emit the single completion-shaped `tool.execution.telemetry` event. The
   * success/denied path (via emitToolResult) and the inner-executor-threw path
   * (execute()'s catch) build an identical payload here — only status/errorType
   * differ — so the field set lives in exactly one place.
   */
  private emitToolExecutionTelemetry(
    call: ToolCallRequest,
    toolSource: RuntimeToolSource,
    threadId: string,
    fields: {
      startedAt: number;
      completedAt: number;
      status: 'completed' | 'denied' | 'error';
      errorType: string | undefined;
      concurrentWith: string[];
    },
  ): void {
    this.eventBus.emit(
      toolExecutionTelemetry(this.companyId, threadId, {
        toolCallId: call.toolCallId,
        toolName: call.name,
        toolType: toolSource.toolType,
        evidenceClass: 'offisim-gateway',
        threadId,
        nodeName: call.nodeName,
        employeeId: call.employeeId,
        taskRunId: call.taskRunId ?? null,
        serverName: toolSource.serverName,
        startedAt: fields.startedAt,
        completedAt: fields.completedAt,
        durationMs: fields.completedAt - fields.startedAt,
        status: fields.status,
        errorType: fields.errorType,
        concurrentWith: fields.concurrentWith,
        ...chatScopeFields(call.runScope),
      }),
    );
  }
}
