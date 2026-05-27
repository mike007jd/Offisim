import type { RunnableConfig } from '@langchain/core/runnables';
import type { TaskAssignmentRerouteReason } from '@offisim/shared-types';
import { graphNodeEntered } from '../events/event-factories.js';
import type { OffisimGraphState } from '../graph/state.js';
import { forwardStreamChunks, recordedLlmStream } from '../llm/recorded-call.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { extractJsonFromLlm } from '../utils/extract-json.js';
import { getRunScope, getRuntime } from '../utils/get-runtime.js';
import { getConfigSignal } from '../utils/get-signal.js';
import { buildAttachmentSystemPreface } from './attachment-preface.js';
import { emitAssignmentRerouted } from './emit-assignment-rerouted.js';
import { buildEnrichedEmployeeList } from './employee-roster.js';
import {
  localToolsGatewayLaneOutcomeState,
  localToolsRequireGatewayLane,
} from './local-tool-lane-guard.js';
import { detectTaskToolIntent, isLocalToolAssignableEmployee } from './task-tool-intent.js';

interface LlmAssignment {
  taskType: string;
  employeeId: string;
  description: string;
}

interface ManagerDecision {
  intent: 'work' | 'hire' | 'assess_team';
  assignments: LlmAssignment[];
}

const MANAGER_ROUTING_TIMEOUT_MS = 45_000;

/** @internal — exported for testing */
export const MANAGER_SYSTEM_PROMPT = `You are the Manager AI — responsible for task splitting and employee assignment.

Given the user's request and available employees, decide how to handle it.

Respond with JSON only:

{
  "intent": "work" | "hire" | "assess_team",
  "assignments": [
    {
      "taskType": "code" | "design" | "analysis" | "review" | "general",
      "employeeId": "<employee_id>",
      "description": "what the employee should do"
    }
  ]
}

Rules:
- "intent" classifies the request:
  - "hire": the user wants to recruit, hire, or add new team members (e.g. "hire a designer", "we need more people", "recruit an analyst")
  - "assess_team": the user wants to evaluate the current team composition, identify skill gaps, or review staffing (e.g. "what roles are we missing", "assess our team", "team strengths and weaknesses")
  - "work": for all other tasks requiring employee work (coding, design, analysis, etc.)
- For "hire" or "assess_team" intents, the "assignments" array can be empty
- For "work" intent, assign tasks to the most appropriate employee based on their role
- Consider employee expertise and installed skills when assigning tasks
- Prefer employees whose expertise or skill package aligns with the request
- Mention alignment reasoning in your response
- Split complex requests into sub-tasks if needed
- Each assignment must reference a valid employee ID`;

const VALID_INTENTS = new Set(['work', 'hire', 'assess_team']);

function isAbortLikeError(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\babort(?:ed)?\b/i.test(message);
}

function shouldDelegateWholeTeam(userContent: string, employeeCount: number): boolean {
  if (employeeCount <= 1) return false;
  return (
    /\b(all|everyone|whole team|entire team|all employees|team-wide)\b/i.test(userContent) ||
    /全员|所有员工|整个团队|全团队|共同合作|一起合作|分成\s*[一二三四五六七八九十0-9]+\s*组/u.test(
      userContent,
    ) ||
    /完整办公室团队|办公室团队/u.test(userContent) ||
    new RegExp(`\\b${employeeCount}\\s*(employees|people|members)\\b`, 'i').test(userContent) ||
    new RegExp(`${employeeCount}\\s*(个|位)?\\s*(员工|成员|人)`, 'u').test(userContent)
  );
}

function buildWholeTeamDecision(
  employees: readonly { employee_id: string; role_slug: string }[],
  userContent: string,
): ManagerDecision {
  return {
    intent: 'work',
    assignments: employees.map((employee) => ({
      taskType: employee.role_slug.includes('design')
        ? 'design'
        : employee.role_slug.includes('review') || employee.role_slug.includes('qa')
          ? 'review'
          : employee.role_slug.includes('manager')
            ? 'analysis'
            : 'general',
      employeeId: employee.employee_id,
      description: userContent,
    })),
  };
}

function parseManagerDecision(content: string): ManagerDecision | null {
  const parsed = extractJsonFromLlm(content) as Record<string, unknown> | null;
  if (!parsed) return null;

  const intent =
    typeof parsed.intent === 'string' && VALID_INTENTS.has(parsed.intent)
      ? (parsed.intent as ManagerDecision['intent'])
      : 'work';

  // For hire/assess_team, assignments can be empty
  if (!Array.isArray(parsed.assignments)) {
    return intent !== 'work' ? { intent, assignments: [] } : null;
  }

  const assignments: LlmAssignment[] = [];
  for (const a of parsed.assignments) {
    if (
      typeof a === 'object' &&
      a !== null &&
      typeof (a as Record<string, unknown>).taskType === 'string' &&
      typeof (a as Record<string, unknown>).employeeId === 'string' &&
      typeof (a as Record<string, unknown>).description === 'string'
    ) {
      assignments.push(a as LlmAssignment);
    }
  }

  if (intent !== 'work') {
    return { intent, assignments };
  }

  return assignments.length > 0 ? { intent, assignments } : null;
}

/**
 * Manager node — analyzes the user's request, determines which employees
 * should be involved, and outputs a ManagerDirective for the PM planner.
 *
 * The manager no longer creates taskRuns or pendingAssignments directly.
 * That responsibility has moved to the PM planner and step dispatcher.
 */
export async function managerNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  const runtimeCtx = getRuntime(config, 'manager');
  const runScope = getRunScope(config);

  // Announce node entry
  runtimeCtx.eventBus.emit(
    graphNodeEntered(runtimeCtx.companyId, state.threadId, 'manager', runScope),
  );

  const { modelResolver, repos, companyId } = runtimeCtx;
  const resolved = modelResolver.resolve(null, 'manager');

  // Get available employees
  const employees = await repos.employees.findByCompany(companyId);
  // Get last user message (needed for both fast path and LLM path)
  const lastUserMessage = [...state.messages].reverse().find((m) => m._getType() === 'human');

  const userContent =
    state.managerDirective?.intent ||
    (typeof lastUserMessage?.content === 'string'
      ? lastUserMessage.content
      : 'No user message found');
  const taskToolIntent = state.taskToolIntent ?? detectTaskToolIntent(userContent);
  if (localToolsRequireGatewayLane(runtimeCtx, taskToolIntent)) {
    return localToolsGatewayLaneOutcomeState(state, taskToolIntent);
  }
  const localToolRequired = taskToolIntent.requiresLocalTools;
  // System graph-node roles that should not receive task assignments.
  // All other employees (including account_manager, project_manager, etc.) are assignable.
  const GRAPH_ONLY_ROLES = new Set(['boss', 'hr']);
  const nonManagerEmployees = employees.filter(
    (e) =>
      !GRAPH_ONLY_ROLES.has(e.role_slug) &&
      e.enabled &&
      (!localToolRequired || isLocalToolAssignableEmployee(e)),
  );

  const employeeList = buildEnrichedEmployeeList(nonManagerEmployees);
  const attachmentPreface = buildAttachmentSystemPreface(runtimeCtx, runScope);
  const wholeTeamDecision = shouldDelegateWholeTeam(userContent, nonManagerEmployees.length)
    ? buildWholeTeamDecision(nonManagerEmployees, userContent)
    : null;

  // --- Rule-based fast path: single employee, simple delegation ---
  // When there's exactly one assignable employee AND the request is clearly work
  // (not hiring/assessment), skip the LLM call to save tokens.
  const HIRE_KEYWORDS = /\b(hire|recruit|assess|staffing)\b|团队评估|招聘|招人/i;
  const looksLikeHiring = HIRE_KEYWORDS.test(userContent);

  if (nonManagerEmployees.length === 1 && !looksLikeHiring) {
    const soleEmployee = nonManagerEmployees[0];
    if (!soleEmployee) {
      throw new Error('Expected one assignable employee in manager fast path');
    }
    await appendAgentEvent(runtimeCtx, {
      projectId: state.projectId,
      threadId: state.threadId,
      agentName: 'manager',
      eventType: 'decision',
      payload: { intent: 'work', assignmentCount: 1, fastPath: true },
    });
    runtimeCtx.scratchpad.write(
      `manager.assignment.${state.threadId}`,
      `Fast-path delegation to ${soleEmployee.name} (${soleEmployee.role_slug}) for: ${userContent}`,
      'manager',
    );
    return {
      managerDirective: {
        intent: userContent,
        recommendedEmployees: [soleEmployee.employee_id],
      },
    };
  }

  if (wholeTeamDecision) {
    await appendAgentEvent(runtimeCtx, {
      projectId: state.projectId,
      threadId: state.threadId,
      agentName: 'manager',
      eventType: 'decision',
      payload: {
        intent: 'work',
        assignmentCount: wholeTeamDecision.assignments.length,
        fastPath: 'whole-team',
      },
    });
    runtimeCtx.scratchpad.write(
      `manager.assignment.${state.threadId}`,
      `Whole-team delegation to ${wholeTeamDecision.assignments
        .map((assignment) => assignment.employeeId)
        .join(', ')} for: ${userContent}`,
      'manager',
    );
    return {
      managerDirective: {
        intent: userContent,
        recommendedEmployees: wholeTeamDecision.assignments.map((a) => a.employeeId),
      },
    };
  }

  // Reasoning-only stream: partial JSON in the content channel would corrupt the UI;
  // decision is parsed from fullContent after close (byte-identical to non-stream).
  const signal = getConfigSignal(config);
  let decision: ManagerDecision | null = null;
  try {
    const routingStreamResult = await recordedLlmStream(
      runtimeCtx,
      {
        messages: [
          {
            role: 'system',
            content: `${MANAGER_SYSTEM_PROMPT}\n\nAvailable employees:\n${employeeList}${attachmentPreface}`,
          },
          { role: 'user', content: userContent },
        ],
        model: resolved.model,
        temperature: resolved.temperature,
        maxTokens: Math.min(resolved.maxTokens, 1024),
        signal,
        timeoutMs: MANAGER_ROUTING_TIMEOUT_MS,
      },
      {
        nodeName: 'manager',
        provider: resolved.provider,
        model: resolved.model,
        projectId: state.projectId,
      },
      forwardStreamChunks(runtimeCtx, state.threadId, 'manager', {
        content: false,
        runScope,
      }),
    );
    decision = parseManagerDecision(routingStreamResult.fullContent);
  } catch (error) {
    if (isAbortLikeError(error, signal)) throw error;
    decision = null;
  }
  const validEmployeeIds = new Set(nonManagerEmployees.map((employee) => employee.employee_id));
  const droppedAssignments: LlmAssignment[] = [];
  if (decision?.intent === 'work') {
    const kept: LlmAssignment[] = [];
    for (const assignment of decision.assignments) {
      if (validEmployeeIds.has(assignment.employeeId)) {
        kept.push(assignment);
      } else {
        droppedAssignments.push(assignment);
      }
    }
    decision = { ...decision, assignments: kept };
  }

  // Fallback: assign to first available employee
  let fallbackTriggered = false;
  if (
    (!decision || (decision.intent === 'work' && decision.assignments.length === 0)) &&
    nonManagerEmployees.length > 0
  ) {
    fallbackTriggered = true;
    decision = buildWholeTeamDecision(nonManagerEmployees, userContent);
  }

  // Emit task.assignment.rerouted for every silently-overridden LLM pick.
  // Resolution: if any kept assignment exists, that's the resolved id;
  // otherwise we fell back to nonManagerEmployees[0]. taskRunId is synthetic
  // because plan-persistence has not yet created the actual TaskRun rows.
  const firstResolvedId =
    decision?.assignments[0]?.employeeId ?? nonManagerEmployees[0]?.employee_id;
  for (let i = 0; i < droppedAssignments.length; i++) {
    const dropped = droppedAssignments[i];
    if (!dropped || !firstResolvedId) continue;
    const reason: TaskAssignmentRerouteReason = localToolRequired
      ? 'requires-local-tools'
      : 'employee-not-found';
    emitAssignmentRerouted({
      companyId: runtimeCtx.companyId,
      threadId: state.threadId,
      taskRunId: `mgr:${state.threadId}:${i}`,
      requestedEmployeeId: dropped.employeeId,
      resolvedEmployeeId: firstResolvedId,
      reason,
      source: 'manager',
      eventBus: runtimeCtx.eventBus,
    });
  }
  if (fallbackTriggered && droppedAssignments.length === 0 && firstResolvedId) {
    emitAssignmentRerouted({
      companyId: runtimeCtx.companyId,
      threadId: state.threadId,
      taskRunId: `mgr:${state.threadId}:fallback`,
      requestedEmployeeId: '',
      resolvedEmployeeId: firstResolvedId,
      reason: 'no-recommendation-fallback',
      source: 'manager',
      eventBus: runtimeCtx.eventBus,
    });
  }

  if (!decision) {
    // No employees available — route to HR so the system can suggest hiring
    return {
      managerDirective: {
        intent: userContent,
        recommendedEmployees: [],
        constraints: 'hire',
      },
    };
  }

  // Map intent to constraints for routing (hire/assess_team → HR node)
  const constraints = decision.intent !== 'work' ? decision.intent : undefined;

  await appendAgentEvent(runtimeCtx, {
    projectId: state.projectId,
    threadId: state.threadId,
    agentName: 'manager',
    eventType: 'decision',
    payload: { intent: decision.intent, assignmentCount: decision.assignments.length, constraints },
  });
  runtimeCtx.scratchpad.write(
    `manager.assignment.${state.threadId}`,
    `Intent: ${decision.intent}. Recommended employees: ${
      decision.assignments.map((assignment) => assignment.employeeId).join(', ') || 'none'
    }.`,
    'manager',
  );

  return {
    managerDirective: {
      intent: userContent,
      recommendedEmployees: decision.assignments.map((a) => a.employeeId),
      constraints,
    },
  };
}
