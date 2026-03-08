import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { AicsGraphState } from '../graph/state.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { GraphError } from '../errors.js';
import { buildEmployeePrompt } from './employee-builder.js';
import { employeeStateChanged, taskStateChanged } from '../events/event-factories.js';
import { recordedLlmCall } from '../llm/recorded-call.js';

export async function employeeNode(
  state: AicsGraphState,
  config: RunnableConfig,
): Promise<Partial<AicsGraphState>> {
  const runtimeCtx = (config.configurable as { runtimeCtx: RuntimeContext }).runtimeCtx;
  if (!runtimeCtx) {
    throw new GraphError('RuntimeContext not found in config.configurable', 'employee');
  }

  const { modelResolver, repos, eventBus, toolExecutor, companyId, threadId } = runtimeCtx;

  // Pop the first pending assignment
  const remaining = [...state.pendingAssignments];
  const assignment = remaining.shift();

  if (!assignment) {
    return { pendingAssignments: [], completed: true };
  }

  const employee = await repos.employees.findById(assignment.employeeId);
  if (!employee) {
    throw new GraphError(`Employee ${assignment.employeeId} not found`, 'employee');
  }

  const company = await repos.companies.findById(companyId);
  if (!company) {
    throw new GraphError(`Company ${companyId} not found`, 'employee');
  }

  const taskRunId = (assignment.inputJson as Record<string, unknown>).taskRunId as string | undefined;

  // Emit employee working state
  eventBus.emit(employeeStateChanged(companyId, employee.employee_id, 'idle', 'executing', threadId, taskRunId));

  // Update task run status
  if (taskRunId) {
    await repos.taskRuns.updateStatus(taskRunId, 'active');
    eventBus.emit(taskStateChanged(companyId, taskRunId, 'queued', 'active', threadId, employee.employee_id));
  }

  const resolved = modelResolver.resolve(null, employee.role_slug);
  const taskDescription = (assignment.inputJson as Record<string, unknown>).description as string ?? '';
  const systemPrompt = buildEmployeePrompt(employee, company, taskDescription);

  // Initial LLM call
  let llmResponse = await recordedLlmCall(runtimeCtx, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: taskDescription },
    ],
    model: resolved.model,
    temperature: resolved.temperature,
    maxTokens: resolved.maxTokens,
  }, { nodeName: 'employee', provider: resolved.provider, model: resolved.model, taskRunId });

  // Handle tool calls (single round for now)
  if (llmResponse.toolCalls.length > 0) {
    for (const toolCall of llmResponse.toolCalls) {
      await toolExecutor.execute({
        toolCallId: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      });
    }

    // Follow-up LLM call after tool execution
    llmResponse = await recordedLlmCall(runtimeCtx, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: taskDescription },
        { role: 'assistant', content: 'I used tools to gather information.' },
        { role: 'user', content: 'Tools executed successfully. Please provide your final response.' },
      ],
      model: resolved.model,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
    }, { nodeName: 'employee', provider: resolved.provider, model: resolved.model, taskRunId });
  }

  // Update task run to completed
  if (taskRunId) {
    await repos.taskRuns.updateStatus(taskRunId, 'completed', JSON.stringify({ content: llmResponse.content }));
    eventBus.emit(taskStateChanged(companyId, taskRunId, 'active', 'completed', threadId, employee.employee_id));
  }

  // Emit employee idle state
  eventBus.emit(employeeStateChanged(companyId, employee.employee_id, 'executing', 'idle', threadId, taskRunId));

  return {
    currentEmployeeId: employee.employee_id,
    currentTaskRunId: taskRunId ?? null,
    pendingAssignments: remaining,
    messages: [new AIMessage({ content: `[${employee.name}]: ${llmResponse.content}` })],
  };
}
