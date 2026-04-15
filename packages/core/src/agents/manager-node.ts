import type { RunnableConfig } from '@langchain/core/runnables';
import { formatExternalDepartmentCatalog, matchExternalDepartments } from '../a2a/external-departments.js';
import { graphNodeEntered } from '../events/event-factories.js';
import type { OffisimGraphState } from '../graph/state.js';
import { recordedLlmCall } from '../llm/recorded-call.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { extractJsonFromLlm } from '../utils/extract-json.js';
import { getRuntime } from '../utils/get-runtime.js';
import { getConfigSignal } from '../utils/get-signal.js';
import { buildEnrichedEmployeeList } from './employee-roster.js';

interface LlmAssignment {
  taskType: string;
  employeeId: string;
  description: string;
}

interface ManagerDecision {
  intent: 'work' | 'hire' | 'assess_team';
  assignments: LlmAssignment[];
}

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
const EXTERNAL_ROUTING_RE = /\b(external|partner|vendor|outsourc(?:e|ed|ing)|a2a)\b|外包|外部/i;

function hasInternalCapabilityMatch(
  userContent: string,
  employees: ReadonlyArray<{ role_slug: string; name: string; config_json: string | null }>,
): boolean {
  const intent = userContent.toLowerCase();
  return employees.some((employee) => {
    if (intent.includes(employee.role_slug.toLowerCase())) return true;
    if (intent.includes(employee.name.toLowerCase())) return true;
    if (!employee.config_json) return false;
    return employee.config_json.toLowerCase().includes(intent.slice(0, 120));
  });
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

  // Announce node entry
  runtimeCtx.eventBus.emit(graphNodeEntered(runtimeCtx.companyId, state.threadId, 'manager'));

  const { modelResolver, repos, companyId } = runtimeCtx;
  const resolved = modelResolver.resolve(null, 'manager');

  // Get available employees
  const employees = await repos.employees.findByCompany(companyId);
  // System graph-node roles that should not receive task assignments.
  // All other employees (including account_manager, project_manager, etc.) are assignable.
  const GRAPH_ONLY_ROLES = new Set(['boss', 'hr']);
  const nonManagerEmployees = employees.filter(
    (e) => !GRAPH_ONLY_ROLES.has(e.role_slug) && e.enabled,
  );

  const employeeList = buildEnrichedEmployeeList(nonManagerEmployees);
  const externalDepartments = runtimeCtx.externalDepartments ?? [];

  // Get last user message (needed for both fast path and LLM path)
  const lastUserMessage = [...state.messages].reverse().find((m) => m._getType() === 'human');

  const userContent =
    typeof lastUserMessage?.content === 'string'
      ? lastUserMessage.content
      : 'No user message found';

  // --- Rule-based fast path: single employee, simple delegation ---
  // When there's exactly one assignable employee AND the request is clearly work
  // (not hiring/assessment), skip the LLM call to save tokens.
  const HIRE_KEYWORDS = /\b(hire|recruit|assess|staffing)\b|团队评估|招聘|招人/i;
  const looksLikeHiring = HIRE_KEYWORDS.test(userContent);
  const matchedDepartments = matchExternalDepartments(userContent, externalDepartments);
  const shouldPreferExternal =
    matchedDepartments.length > 0 &&
    (EXTERNAL_ROUTING_RE.test(userContent) ||
      !hasInternalCapabilityMatch(userContent, nonManagerEmployees));

  if (shouldPreferExternal) {
    const departmentIds = matchedDepartments.map((department) => department.id);
    await appendAgentEvent(runtimeCtx, {
      projectId: state.projectId,
      threadId: state.threadId,
      agentName: 'manager',
      eventType: 'decision',
      payload: {
        intent: 'work',
        assignmentCount: departmentIds.length,
        targetKind: 'department',
      },
    });
    runtimeCtx.scratchpad.write(
      `manager.assignment.${state.threadId}`,
      `Delegated externally to ${matchedDepartments.map((department) => department.name).join(', ')} for: ${userContent}`,
      'manager',
    );
    return {
      managerDirective: {
        intent: userContent,
        recommendedEmployees: [],
        recommendedDepartments: departmentIds,
        sopTemplateId: state.selectedSopTemplateId ?? undefined,
      },
    };
  }

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
        sopTemplateId: state.selectedSopTemplateId ?? undefined,
      },
    };
  }

  // --- LLM-based assignment (multiple employees) ---
  const llmResponse = await recordedLlmCall(
    runtimeCtx,
    {
      messages: [
        {
          role: 'system',
          content: `${MANAGER_SYSTEM_PROMPT}\n\nAvailable employees:\n${employeeList}\n\nAvailable external departments:\n${formatExternalDepartmentCatalog(externalDepartments)}`,
        },
        { role: 'user', content: userContent },
      ],
      model: resolved.model,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
      signal: getConfigSignal(config),
    },
    { nodeName: 'manager', provider: resolved.provider, model: resolved.model },
  );

  let decision = parseManagerDecision(llmResponse.content);

  // Fallback: assign to first available employee
  if (!decision && nonManagerEmployees.length > 0) {
    decision = {
      intent: 'work',
      assignments: [
        {
          taskType: 'general',
          // biome-ignore lint/style/noNonNullAssertion: length > 0 checked above
          employeeId: nonManagerEmployees[0]!.employee_id,
          description: userContent,
        },
      ],
    };
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
      sopTemplateId: state.selectedSopTemplateId ?? undefined,
    },
  };
}
