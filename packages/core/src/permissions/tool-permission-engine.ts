import type { RuntimePolicyConfig, RuntimeToolPermissionBehavior } from '@offisim/shared-types';
import { parseEmployeeConfig } from '@offisim/shared-types';
import type { ToolApprovalMode, ToolPermissionPolicy } from '../mcp/types.js';
import type {
  EmployeeRepository,
  McpAuditRepository,
  ToolPermissionApprovalRepository,
} from '../runtime/repositories.js';
import type { ToolPermissionGrantResolver } from '../services/interaction-service.js';
import { globToRegex } from '../utils/glob-match.js';

export interface ToolPermissionDecision {
  readonly behavior: RuntimeToolPermissionBehavior;
  readonly source: 'runtime' | 'employee' | 'default' | 'interaction';
  readonly reason: string;
  readonly approvedBy: string;
  readonly matchedPattern?: string;
  readonly policyHash?: string;
}

export interface ToolPermissionRequest {
  readonly threadId: string;
  readonly serverName: string;
  readonly toolName: string;
  readonly employeeId?: string;
}

export interface ToolPermissionAuthorizer {
  evaluate(request: ToolPermissionRequest): Promise<ToolPermissionDecision>;
}

interface ToolPermissionEngineDeps {
  readonly employees: EmployeeRepository;
  readonly mcpAudit: McpAuditRepository;
  readonly approvals: ToolPermissionApprovalRepository;
  readonly runtimePolicy?: RuntimePolicyConfig;
  readonly grants?: ToolPermissionGrantResolver;
}

export class ToolPermissionEngine implements ToolPermissionAuthorizer {
  constructor(private readonly deps: ToolPermissionEngineDeps) {}

  async evaluate(request: ToolPermissionRequest): Promise<ToolPermissionDecision> {
    const runtimeDecision = this.evaluateRuntimePolicy(request);
    if (runtimeDecision?.behavior === 'deny') {
      return runtimeDecision;
    }

    let employeeDecision: ToolPermissionDecision | null = null;
    if (request.employeeId) {
      employeeDecision = await this.evaluateEmployeePolicy({
        ...request,
        employeeId: request.employeeId,
      });
    }

    const granted = this.deps.grants?.consumeMatchingGrant({
      threadId: request.threadId,
      serverName: request.serverName,
      toolName: request.toolName,
      employeeId: request.employeeId,
    });
    if (granted) {
      return {
        behavior: 'allow',
        source: 'interaction',
        reason: `User granted ${granted.scope}-scoped approval for this tool.`,
        approvedBy: `interaction:${granted.scope}`,
        policyHash: employeeDecision?.policyHash ?? runtimeDecision?.policyHash,
      };
    }

    if (runtimeDecision?.behavior === 'ask') {
      return runtimeDecision;
    }

    if (employeeDecision) {
      return employeeDecision;
    }

    if (!request.employeeId) {
      return {
        behavior: 'allow',
        source: runtimeDecision?.source ?? 'default',
        reason: runtimeDecision?.reason ?? 'No employee-scoped permission policy applies.',
        approvedBy: runtimeDecision?.approvedBy ?? 'auto',
        ...(runtimeDecision?.matchedPattern
          ? { matchedPattern: runtimeDecision.matchedPattern }
          : {}),
        ...(runtimeDecision?.policyHash ? { policyHash: runtimeDecision.policyHash } : {}),
      };
    }

    return (
      runtimeDecision ?? {
        behavior: 'allow',
        source: 'default',
        reason: 'No employee tool permission policy configured.',
        approvedBy: 'auto',
      }
    );
  }

  private async evaluateEmployeePolicy(
    request: ToolPermissionRequest & { employeeId: string },
  ): Promise<ToolPermissionDecision | null> {
    const employee = await this.deps.employees.findById(request.employeeId);
    const employeePolicy = parseEmployeeToolPermissionPolicy(employee?.config_json ?? null);
    if (!employeePolicy) {
      return null;
    }

    const employeeMatch = resolveEmployeePolicyMatch(employeePolicy, request.toolName);
    const policyHash = buildEmployeePolicyHash(employeePolicy, employeeMatch);
    if (employeeMatch.mode === 'auto') {
      return {
        behavior: 'allow',
        source: 'employee',
        reason: employeeMatch.matchedPattern
          ? `Employee override '${employeeMatch.matchedPattern}' auto-approves this tool.`
          : 'Employee default policy auto-approves this tool.',
        approvedBy: 'employee:auto',
        ...(employeeMatch.matchedPattern ? { matchedPattern: employeeMatch.matchedPattern } : {}),
        policyHash,
      };
    }

    if (employeeMatch.mode === 'always_ask') {
      return {
        behavior: 'ask',
        source: 'employee',
        reason: employeeMatch.matchedPattern
          ? `Employee override '${employeeMatch.matchedPattern}' requires approval every time.`
          : 'Employee default policy requires approval every time.',
        approvedBy: 'employee:always_ask',
        ...(employeeMatch.matchedPattern ? { matchedPattern: employeeMatch.matchedPattern } : {}),
        policyHash,
      };
    }

    const alreadyApproved = await this.deps.approvals.hasApproval({
      threadId: request.threadId,
      employeeId: request.employeeId,
      serverName: request.serverName,
      toolName: request.toolName,
      policyHash,
    });
    if (alreadyApproved) {
      return {
        behavior: 'allow',
        source: 'employee',
        reason: 'Employee first-use approval was explicitly granted earlier in this thread.',
        approvedBy: 'employee:ask_first_time:cached',
        ...(employeeMatch.matchedPattern ? { matchedPattern: employeeMatch.matchedPattern } : {}),
        policyHash,
      };
    }

    return {
      behavior: 'ask',
      source: 'employee',
      reason: employeeMatch.matchedPattern
        ? `Employee override '${employeeMatch.matchedPattern}' requires approval before first use.`
        : 'Employee default policy requires approval before first use.',
      approvedBy: 'employee:ask_first_time',
      ...(employeeMatch.matchedPattern ? { matchedPattern: employeeMatch.matchedPattern } : {}),
      policyHash,
    };
  }

  private evaluateRuntimePolicy(request: ToolPermissionRequest): ToolPermissionDecision | null {
    const policy = this.deps.runtimePolicy?.toolPermissions;
    if (!policy?.enabled) return null;

    const identity = buildRuntimeIdentity(request.serverName, request.toolName);
    const matchedRule = [...policy.rules]
      .filter((rule) => globToRegex(rule.pattern).test(identity))
      .sort((a, b) => b.pattern.length - a.pattern.length)[0];

    if (matchedRule) {
      return runtimeBehaviorToDecision(matchedRule.behavior, {
        source: 'runtime',
        matchedPattern: matchedRule.pattern,
        matchedBy: `Runtime rule '${matchedRule.pattern}'`,
      });
    }

    return runtimeBehaviorToDecision(policy.defaultBehavior, {
      source: 'runtime',
      matchedBy: 'Runtime default policy',
    });
  }
}

function runtimeBehaviorToDecision(
  behavior: RuntimeToolPermissionBehavior,
  meta: { source: 'runtime'; matchedBy: string; matchedPattern?: string },
): ToolPermissionDecision {
  if (behavior === 'allow') {
    return {
      behavior,
      source: meta.source,
      reason: `${meta.matchedBy} allows this tool.`,
      approvedBy: 'runtime:allow',
      ...(meta.matchedPattern ? { matchedPattern: meta.matchedPattern } : {}),
      policyHash: buildRuntimePolicyHash(meta.matchedPattern ?? 'default', behavior),
    };
  }

  return {
    behavior,
    source: meta.source,
    reason: `${meta.matchedBy} ${behavior === 'deny' ? 'blocks' : 'requires approval for'} this tool.`,
    approvedBy: behavior === 'deny' ? 'runtime:deny' : 'runtime:ask',
    ...(meta.matchedPattern ? { matchedPattern: meta.matchedPattern } : {}),
    policyHash: buildRuntimePolicyHash(meta.matchedPattern ?? 'default', behavior),
  };
}

function buildRuntimeIdentity(serverName: string, toolName: string): string {
  return `mcp:${serverName}:${toolName}`;
}

function parseEmployeeToolPermissionPolicy(raw: string | null): ToolPermissionPolicy | null {
  const config = parseEmployeeConfig(raw);
  return config.toolPermissionPolicy ?? null;
}

function resolveEmployeePolicyMatch(
  policy: ToolPermissionPolicy,
  toolName: string,
): { mode: ToolApprovalMode; matchedPattern?: string } {
  const match = [...policy.overrides]
    .filter((override) => globToRegex(override.pattern).test(toolName))
    .sort((a, b) => b.pattern.length - a.pattern.length)[0];

  if (match) {
    return { mode: match.mode, matchedPattern: match.pattern };
  }

  return { mode: policy.defaultMode };
}

function buildRuntimePolicyHash(pattern: string, behavior: RuntimeToolPermissionBehavior): string {
  return `runtime:${pattern}:${behavior}`;
}

function buildEmployeePolicyHash(
  policy: ToolPermissionPolicy,
  match: { mode: ToolApprovalMode; matchedPattern?: string },
): string {
  const overrides = [...policy.overrides]
    .map((override) => `${override.pattern}:${override.mode}`)
    .sort()
    .join(',');
  return [
    'employee',
    `default=${policy.defaultMode}`,
    `match=${match.matchedPattern ?? 'default'}`,
    `mode=${match.mode}`,
    `overrides=${overrides}`,
  ].join('|');
}
