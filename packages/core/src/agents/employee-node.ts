import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Command } from '@langchain/langgraph';
import { GraphError } from '../errors.js';
import {
  employeeStateChanged,
  graphNodeEntered,
  handoffInitiated,
  taskAssignmentChanged,
  taskStateChanged,
} from '../events/event-factories.js';
import type { AicsGraphState } from '../graph/state.js';
import type { LlmMessage, ToolDef } from '../llm/gateway.js';
import { recordedLlmCall } from '../llm/recorded-call.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { buildEmployeePrompt } from './employee-builder.js';

/** Maximum number of employee-to-employee handoffs per thread. */
const MAX_HANDOFF_COUNT = 3;

export async function employeeNode(
  state: AicsGraphState,
  config: RunnableConfig,
): Promise<Partial<AicsGraphState> | Command> {
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

  // --- Build virtual + MCP tools ---
  const virtualTools: ToolDef[] = [];

  // Handoff tool: only if NOT direct_chat, NOT at max handoffs, AND has colleagues
  if (state.entryMode !== 'direct_chat' && state.handoffCount < MAX_HANDOFF_COUNT) {
    const employees = await repos.employees.findByCompany(companyId);
    const colleagues = employees.filter((e) => e.employee_id !== employee.employee_id);

    if (colleagues.length > 0) {
      virtualTools.push({
        name: 'handoff_to',
        description: 'Hand off this task to another employee who is better suited.',
        parameters: {
          type: 'object',
          properties: {
            targetEmployeeId: {
              type: 'string',
              enum: colleagues.map((e) => e.employee_id),
              description: `Colleagues: ${colleagues.map((e) => `${e.employee_id} (${e.name})`).join(', ')}`,
            },
            reason: { type: 'string', description: 'Why handoff is needed' },
            completedWork: { type: 'string', description: 'Summary of what you completed' },
            remainingWork: { type: 'string', description: 'What the next employee should do' },
          },
          required: ['targetEmployeeId', 'reason', 'completedWork', 'remainingWork'],
        },
      });
    }
  }

  const mcpTools = await toolExecutor.listAvailable(companyId);
  const allTools = [...virtualTools, ...mcpTools];

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
        tools: allTools.length > 0 ? allTools : undefined,
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

      // Check for handoff_to virtual tool BEFORE delegating to toolExecutor
      const handoffCall = llmResponse.toolCalls.find((tc) => tc.name === 'handoff_to');
      if (handoffCall) {
        const args = handoffCall.arguments as {
          targetEmployeeId: string;
          reason: string;
          completedWork: string;
          remainingWork: string;
        };

        // 1. Write handoff record
        const handoffId = `ho-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await repos.handoffs.create({
          handoff_id: handoffId,
          thread_id: state.threadId,
          from_employee_id: employee.employee_id,
          to_employee_id: args.targetEmployeeId,
          reason: args.reason,
          payload_json: JSON.stringify({
            completedWork: args.completedWork,
            remainingWork: args.remainingWork,
          }),
          created_at: new Date().toISOString(),
        });

        // 2. Create new TaskRun for receiving employee
        const newTaskRunId = `tr-ho-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await repos.taskRuns.create({
          task_run_id: newTaskRunId,
          thread_id: state.threadId,
          employee_id: args.targetEmployeeId,
          parent_task_run_id: taskRunId ?? null,
          task_type: 'handoff_continuation',
          status: 'queued',
          input_json: JSON.stringify({
            description: args.remainingWork,
            priorWork: args.completedWork,
          }),
          output_json: null,
          started_at: new Date().toISOString(),
        });

        // 3. Mark current task as completed
        if (taskRunId) {
          await repos.taskRuns.updateStatus(taskRunId, 'completed');
        }

        // 4. Emit events
        eventBus.emit(
          handoffInitiated(
            companyId,
            handoffId,
            state.threadId,
            employee.employee_id,
            args.targetEmployeeId,
            args.reason,
            newTaskRunId,
          ),
        );
        eventBus.emit(
          employeeStateChanged(
            companyId,
            employee.employee_id,
            'executing',
            'idle',
            threadId,
            taskRunId,
          ),
        );

        // 5. Return Command — bypasses routeFromEmployee
        return new Command({
          goto: 'employee',
          update: {
            pendingAssignments: [
              {
                taskType: 'handoff_continuation',
                employeeId: args.targetEmployeeId,
                inputJson: {
                  description: args.remainingWork,
                  priorWork: args.completedWork,
                  handoffReason: args.reason,
                  taskRunId: newTaskRunId,
                },
              },
            ],
            handoffCount: state.handoffCount + 1,
            currentStepOutputs: [
              ...state.currentStepOutputs,
              {
                employeeId: employee.employee_id,
                employeeName: employee.name,
                content: args.completedWork,
                taskRunId: taskRunId ?? '',
              },
            ],
          },
        });
      }

      // Non-handoff tool calls — delegate to toolExecutor
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
          tools: allTools.length > 0 ? allTools : undefined,
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
