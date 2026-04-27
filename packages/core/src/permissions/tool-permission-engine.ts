import type { RuntimePolicyConfig, RuntimeToolPermissionBehavior } from '@offisim/shared-types';
import { parseEmployeeConfig } from '@offisim/shared-types';
import type { ToolApprovalMode, ToolPermissionPolicy } from '../mcp/types.js';
import type {
  EmployeeRepository,
  McpAuditRepository,
  ToolPermissionApprovalRepository,
} from '../runtime/repositories.js';
import type { ToolPermissionGrantResolver } from '../services/interaction-service.js';
import { canonicalJson } from '../testing/canonical-json.js';
import { sha256Text } from '../testing/hash.js';
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
  readonly employeeConfigJson?: string | null;
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
    const runtimeDecision = await this.evaluateRuntimePolicy(request);
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
    const employeeConfigJson =
      request.employeeConfigJson !== undefined
        ? request.employeeConfigJson
        : (await this.deps.employees.findById(request.employeeId))?.config_json;
    const employeePolicy = parseEmployeeToolPermissionPolicy(employeeConfigJson ?? null);
    if (!employeePolicy) {
      return null;
    }

    const employeeMatch = resolveEmployeePolicyMatch(employeePolicy, request.toolName);
    const policyHash = await buildEmployeePolicyHash(employeePolicy, employeeMatch);
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

    const approval = await this.deps.approvals.findReusableApproval({
      threadId: request.threadId,
      employeeId: request.employeeId,
      serverName: request.serverName,
      toolName: request.toolName,
      policyHash,
    });
    if (approval) {
      if (approval.scope === 'once') {
        await this.deps.approvals.consumeApproval(approval.approval_id, new Date().toISOString());
      }
      return {
        behavior: 'allow',
        source: 'employee',
        reason:
          approval.scope === 'once'
            ? 'Employee first-use approval was explicitly granted for this tool call.'
            : 'Employee first-use approval was explicitly granted earlier in this thread.',
        approvedBy: `employee:ask_first_time:${approval.scope}`,
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

  private async evaluateRuntimePolicy(
    request: ToolPermissionRequest,
  ): Promise<ToolPermissionDecision | null> {
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

async function runtimeBehaviorToDecision(
  behavior: RuntimeToolPermissionBehavior,
  meta: { source: 'runtime'; matchedBy: string; matchedPattern?: string },
): Promise<ToolPermissionDecision> {
  const policyHash = await buildRuntimePolicyHash(meta.matchedPattern ?? 'default', behavior);
  if (behavior === 'allow') {
    return {
      behavior,
      source: meta.source,
      reason: `${meta.matchedBy} allows this tool.`,
      approvedBy: 'runtime:allow',
      ...(meta.matchedPattern ? { matchedPattern: meta.matchedPattern } : {}),
      policyHash,
    };
  }

  return {
    behavior,
    source: meta.source,
    reason: `${meta.matchedBy} ${behavior === 'deny' ? 'blocks' : 'requires approval for'} this tool.`,
    approvedBy: behavior === 'deny' ? 'runtime:deny' : 'runtime:ask',
    ...(meta.matchedPattern ? { matchedPattern: meta.matchedPattern } : {}),
    policyHash,
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

async function buildRuntimePolicyHash(
  pattern: string,
  behavior: RuntimeToolPermissionBehavior,
): Promise<string> {
  return sha256Text(canonicalJson({ behavior, pattern, scope: 'runtime' }));
}

async function buildEmployeePolicyHash(
  policy: ToolPermissionPolicy,
  match: { mode: ToolApprovalMode; matchedPattern?: string },
): Promise<string> {
  const overrides = [...policy.overrides]
    .map((override) => ({ mode: override.mode, pattern: override.pattern }))
    .sort((a, b) => `${a.pattern}:${a.mode}`.localeCompare(`${b.pattern}:${b.mode}`));
  return sha256Text(
    canonicalJson({
      defaultMode: policy.defaultMode,
      match: match.matchedPattern ?? 'default',
      mode: match.mode,
      overrides,
      scope: 'employee',
    }),
  );
}
