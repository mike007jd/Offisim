import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { GraphError } from '../errors.js';
import {
  employeeStateChanged,
  graphNodeEntered,
  taskAssignmentChanged,
  taskStateChanged,
} from '../events/event-factories.js';
import type { AicsGraphState } from '../graph/state.js';
import type { LlmMessage } from '../llm/gateway.js';
import { recordedLlmCall } from '../llm/recorded-call.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { buildEmployeePrompt } from './employee-builder.js';

export async function employeeNode(
  state: AicsGraphState,
  config: RunnableConfig,
): Promise<Partial<AicsGraphState>> {
  const runtimeCtx = (config.configurable as { runtimeCtx: RuntimeContext }).runtimeCtx;
  if (!runtimeCtx) {
    throw new GraphError('RuntimeContext not found in config.configurable', 'employee');
  }

  // Announce node entry
  runtimeCtx.eventBus.emit(graphNodeEntered(runtimeCtx.companyId, state.threadId, 'employee'));

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

  const taskRunId = (assignment.inputJson as Record<string, unknown>).taskRunId as
    | string
    | undefined;

  // Emit employee working state
  eventBus.emit(
    employeeStateChanged(companyId, employee.employee_id, 'idle', 'executing', threadId, taskRunId),
  );

  // Update task run status
  if (taskRunId) {
    await repos.taskRuns.updateStatus(taskRunId, 'running');
    eventBus.emit(
      taskStateChanged(companyId, taskRunId, 'queued', 'running', threadId, employee.employee_id),
    );
  }

  const resolved = modelResolver.resolve(null, employee.role_slug);
  const taskDescription =
    ((assignment.inputJson as Record<string, unknown>).description as string) ?? '';
  const systemPrompt = buildEmployeePrompt(employee, company, taskDescription);

  try {
    // Initial LLM call
    let llmResponse = await recordedLlmCall(
      runtimeCtx,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: taskDescription },
        ],
        model: resolved.model,
        temperature: resolved.temperature,
        maxTokens: resolved.maxTokens,
      },
      { nodeName: 'employee', provider: resolved.provider, model: resolved.model, taskRunId },
    );

    // Accumulate conversation history across tool-call rounds so later rounds
    // can see earlier tool results (fixes lost-context bug).
    const conversationHistory: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: taskDescription },
    ];

    // Multi-round tool calling loop (max 5 rounds to prevent infinite loops)
    const MAX_TOOL_ROUNDS = 5;
    let round = 0;

    while (llmResponse.toolCalls.length > 0 && round < MAX_TOOL_ROUNDS) {
      round++;
      const toolResults = [];
      for (const toolCall of llmResponse.toolCalls) {
        const result = await toolExecutor.execute({
          toolCallId: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
          employeeId: employee.employee_id,
        });
        toolResults.push({ callId: toolCall.id, name: toolCall.name, result });
      }

      // Append this round's assistant intent + tool results to the running history
      conversationHistory.push(
        {
          role: 'assistant',
          content: `I called tools: ${toolResults.map((t) => t.name).join(', ')}`,
        },
        {
          role: 'user',
          content: `Tool results:\n${JSON.stringify(toolResults.map((t) => ({ tool: t.name, result: t.result })))}`,
        },
      );

      // Follow-up LLM call with full accumulated history
      llmResponse = await recordedLlmCall(
        runtimeCtx,
        {
          messages: conversationHistory,
          model: resolved.model,
          temperature: resolved.temperature,
          maxTokens: resolved.maxTokens,
        },
        { nodeName: 'employee', provider: resolved.provider, model: resolved.model, taskRunId },
      );
    }

    // Update task run to completed
    if (taskRunId) {
      await repos.taskRuns.updateStatus(
        taskRunId,
        'completed',
        JSON.stringify({ content: llmResponse.content }),
      );
      eventBus.emit(
        taskStateChanged(companyId, taskRunId, 'running', 'completed', threadId, employee.employee_id),
      );
      eventBus.emit(
        taskAssignmentChanged(companyId, taskRunId, employee.employee_id, 'unassigned', threadId),
      );
    }

    // Emit employee idle state
    eventBus.emit(
      employeeStateChanged(companyId, employee.employee_id, 'executing', 'idle', threadId, taskRunId),
    );

    return {
      currentEmployeeId: employee.employee_id,
      currentTaskRunId: taskRunId ?? null,
      pendingAssignments: remaining,
      messages: [new AIMessage({ content: `[${employee.name}]: ${llmResponse.content}` })],
      currentStepOutputs: [
        ...state.currentStepOutputs,
        {
          employeeId: employee.employee_id,
          employeeName: employee.name,
          content: llmResponse.content,
          taskRunId: taskRunId ?? '',
        },
      ],
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Emit employee state: executing → failed
    eventBus.emit(
      employeeStateChanged(companyId, employee.employee_id, 'executing', 'failed', threadId, taskRunId),
    );

    // Update task run status to failed
    if (taskRunId) {
      await repos.taskRuns.updateStatus(taskRunId, 'failed');
      eventBus.emit(
        taskStateChanged(companyId, taskRunId, 'running', 'failed', threadId, employee.employee_id),
      );
    }

    // Build structured error JSON for error_handler node to parse
    const structuredError = {
      errorCode: 'LLM_CALL_FAILED',
      message: errorMessage,
      recoverable: true,
      nodeName: 'employee',
      employeeId: employee.employee_id,
      taskRunId,
      provider: resolved.provider,
      model: resolved.model,
    };

    return {
      currentEmployeeId: employee.employee_id,
      currentTaskRunId: taskRunId ?? null,
      pendingAssignments: remaining,
      interruptReason: JSON.stringify(structuredError),
      currentStepOutputs: state.currentStepOutputs,
    };
  }
}
