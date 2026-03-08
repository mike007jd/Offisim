import type { RunnableConfig } from '@langchain/core/runnables';
import type { AicsGraphState, PendingAssignment } from '../graph/state.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { GraphError } from '../errors.js';
import { taskStateChanged, taskAssignmentChanged } from '../events/event-factories.js';

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
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    if (!Array.isArray(parsed.assignments)) return null;

    const assignments: LlmAssignment[] = [];
    for (const a of parsed.assignments) {
      if (
        typeof a === 'object' && a !== null &&
        typeof (a as Record<string, unknown>).taskType === 'string' &&
        typeof (a as Record<string, unknown>).employeeId === 'string' &&
        typeof (a as Record<string, unknown>).description === 'string'
      ) {
        assignments.push(a as LlmAssignment);
      }
    }

    return assignments.length > 0 ? { assignments } : null;
  } catch {
    return null;
  }
}

function generateId(): string {
  return `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function managerNode(
  state: AicsGraphState,
  config: RunnableConfig,
): Promise<Partial<AicsGraphState>> {
  const runtimeCtx = (config.configurable as { runtimeCtx: RuntimeContext }).runtimeCtx;
  if (!runtimeCtx) {
    throw new GraphError('RuntimeContext not found in config.configurable', 'manager');
  }

  const { llmGateway, modelResolver, repos, eventBus, companyId, threadId } = runtimeCtx;
  const resolved = modelResolver.resolve(null, 'manager');

  // Get available employees
  const employees = await repos.employees.findByCompany(companyId);
  const nonManagerEmployees = employees.filter((e) => e.role_slug !== 'manager' && e.enabled);

  const employeeList = nonManagerEmployees
    .map((e) => `- ${e.employee_id}: ${e.name} (${e.role_slug})`)
    .join('\n');

  // Get last user message
  const lastUserMessage = [...state.messages]
    .reverse()
    .find((m) => m._getType() === 'human');

  const userContent = typeof lastUserMessage?.content === 'string'
    ? lastUserMessage.content
    : 'No user message found';

  const llmResponse = await llmGateway.chat({
    messages: [
      { role: 'system', content: `${MANAGER_SYSTEM_PROMPT}\n\nAvailable employees:\n${employeeList}` },
      { role: 'user', content: userContent },
    ],
    model: resolved.model,
    temperature: resolved.temperature,
    maxTokens: resolved.maxTokens,
  });

  let decision = parseManagerDecision(llmResponse.content);

  // Fallback: assign to first available employee
  if (!decision && nonManagerEmployees.length > 0) {
    decision = {
      assignments: [{
        taskType: 'general',
        employeeId: nonManagerEmployees[0]!.employee_id,
        description: userContent,
      }],
    };
  }

  if (!decision) {
    throw new GraphError('No employees available for assignment', 'manager');
  }

  const pendingAssignments: PendingAssignment[] = [];

  for (const assignment of decision.assignments) {
    const taskRunId = generateId();

    // Create task_run in repository
    await repos.taskRuns.create({
      task_run_id: taskRunId,
      thread_id: threadId,
      employee_id: assignment.employeeId,
      parent_task_run_id: null,
      task_type: assignment.taskType,
      status: 'pending',
      input_json: JSON.stringify({ description: assignment.description }),
      output_json: null,
      started_at: new Date().toISOString(),
    });

    // Create handoff event
    await repos.handoffs.create({
      handoff_id: `ho-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      thread_id: threadId,
      from_employee_id: null, // from boss/manager
      to_employee_id: assignment.employeeId,
      reason: assignment.description,
      payload_json: JSON.stringify({ taskType: assignment.taskType }),
      created_at: new Date().toISOString(),
    });

    // Emit events
    eventBus.emit(taskStateChanged(companyId, taskRunId, 'created', 'queued', threadId, assignment.employeeId));
    eventBus.emit(taskAssignmentChanged(companyId, taskRunId, assignment.employeeId, 'assigned', threadId));

    pendingAssignments.push({
      taskType: assignment.taskType,
      employeeId: assignment.employeeId,
      inputJson: { description: assignment.description, taskRunId },
    });
  }

  return { pendingAssignments };
}
