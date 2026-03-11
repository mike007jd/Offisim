import type { RunnableConfig } from '@langchain/core/runnables';
import { GraphError } from '../errors.js';
import { graphNodeEntered } from '../events/event-factories.js';
import type { AicsGraphState } from '../graph/state.js';
import { recordedLlmCall } from '../llm/recorded-call.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { extractJsonFromLlm } from '../utils/extract-json.js';

interface LlmAssignment {
  taskType: string;
  employeeId: string;
  description: string;
}

interface ManagerDecision {
  assignments: LlmAssignment[];
}

const MANAGER_SYSTEM_PROMPT = `You are the Manager AI — responsible for task splitting and employee assignment.

Given the user's request and available employees, decide which employees should work on which tasks.

Respond with JSON only:

{
  "assignments": [
    {
      "taskType": "code" | "design" | "analysis" | "review" | "general",
      "employeeId": "<employee_id>",
      "description": "what the employee should do"
    }
  ]
}

Rules:
- Assign tasks to the most appropriate employee based on their role
- Split complex requests into sub-tasks if needed
- Each assignment must reference a valid employee ID`;

function parseManagerDecision(content: string): ManagerDecision | null {
  const parsed = extractJsonFromLlm(content) as Record<string, unknown> | null;
  if (!parsed || !Array.isArray(parsed.assignments)) return null;

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

  return assignments.length > 0 ? { assignments } : null;
}

/**
 * Manager node — analyzes the user's request, determines which employees
 * should be involved, and outputs a ManagerDirective for the PM planner.
 *
 * The manager no longer creates taskRuns or pendingAssignments directly.
 * That responsibility has moved to the PM planner and step dispatcher.
 */
export async function managerNode(
  state: AicsGraphState,
  config: RunnableConfig,
): Promise<Partial<AicsGraphState>> {
  const runtimeCtx = (config.configurable as { runtimeCtx: RuntimeContext }).runtimeCtx;
  if (!runtimeCtx) {
    throw new GraphError('RuntimeContext not found in config.configurable', 'manager');
  }

  // Announce node entry
  runtimeCtx.eventBus.emit(graphNodeEntered(runtimeCtx.companyId, state.threadId, 'manager'));

  const { modelResolver, repos, companyId } = runtimeCtx;
  const resolved = modelResolver.resolve(null, 'manager');

  // Get available employees
  const employees = await repos.employees.findByCompany(companyId);
  const nonManagerEmployees = employees.filter((e) => e.role_slug !== 'manager' && e.enabled);

  const employeeList = nonManagerEmployees
    .map((e) => `- ${e.employee_id}: ${e.name} (${e.role_slug})`)
    .join('\n');

  // Get last user message
  const lastUserMessage = [...state.messages].reverse().find((m) => m._getType() === 'human');

  const userContent =
    typeof lastUserMessage?.content === 'string'
      ? lastUserMessage.content
      : 'No user message found';

  const llmResponse = await recordedLlmCall(
    runtimeCtx,
    {
      messages: [
        {
          role: 'system',
          content: `${MANAGER_SYSTEM_PROMPT}\n\nAvailable employees:\n${employeeList}`,
        },
        { role: 'user', content: userContent },
      ],
      model: resolved.model,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
    },
    { nodeName: 'manager', provider: resolved.provider, model: resolved.model },
  );

  let decision = parseManagerDecision(llmResponse.content);

  // Fallback: assign to first available employee
  if (!decision && nonManagerEmployees.length > 0) {
    decision = {
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
    throw new GraphError('No employees available for assignment', 'manager');
  }

  return {
    managerDirective: {
      intent: userContent,
      recommendedEmployees: decision.assignments.map((a) => a.employeeId),
      constraints: undefined,
    },
  };
}
