import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Command } from '@langchain/langgraph';
import { GraphError } from '../errors.js';
import {
  employeeStateChanged,
  graphNodeEntered,
  handoffInitiated,
  memoryAccessed,
  memoryCreated,
  taskAssignmentChanged,
  taskStateChanged,
} from '../events/event-factories.js';
import type { AicsGraphState } from '../graph/state.js';
import type { LlmMessage, ToolDef } from '../llm/gateway.js';
import { recordedLlmCall } from '../llm/recorded-call.js';
import type { MemoryEntryRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { buildEmployeePrompt } from './employee-builder.js';

/** Maximum number of employee-to-employee handoffs per thread. */
const MAX_HANDOFF_COUNT = 3;

/** Virtual tool names for memory operations */
const MEMORY_TOOL_NAMES = ['remember', 'recall', 'forget'] as const;

/** Build memory tool definitions */
function buildMemoryTools(): ToolDef[] {
  return [
    {
      name: 'remember',
      description:
        'Store a memory for future reference. Use this to save important insights, decisions, or learnings.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'What to remember' },
          category: {
            type: 'string',
            enum: ['experience', 'decision', 'knowledge', 'preference'],
            description: 'Category of memory',
          },
          scope: {
            type: 'string',
            enum: ['employee', 'team', 'company'],
            description: 'Visibility scope (employee=personal, team=team-wide, company=company-wide)',
          },
          importance: {
            type: 'number',
            description: 'Importance 0.0-1.0 (0.3=minor, 0.5=moderate, 0.7=important, 0.9=critical)',
          },
        },
        required: ['content', 'category', 'scope', 'importance'],
      },
    },
    {
      name: 'recall',
      description: 'Search your memories for relevant past experiences, decisions, or knowledge.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for in memories' },
        },
        required: ['query'],
      },
    },
    {
      name: 'forget',
      description: 'Delete a specific memory by its ID.',
      parameters: {
        type: 'object',
        properties: {
          memoryId: { type: 'string', description: 'The ID of the memory to delete' },
        },
        required: ['memoryId'],
      },
    },
  ];
}

/** Format memories into a prompt section */
function formatMemoriesSection(memories: MemoryEntryRow[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map(
    (m) => `- [${m.scope}/${m.category}] (importance: ${m.importance}) ${m.content}`,
  );
  return `\n\n## Your memories\n${lines.join('\n')}`;
}

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
  let systemPrompt = buildEmployeePrompt(employee, company, taskDescription);

  // --- Inject relevant memories into system prompt ---
  const { memoryService } = runtimeCtx;
  if (memoryService && taskDescription) {
    try {
      const relevantMemories = await memoryService.getRelevantMemories(
        employee.employee_id,
        companyId,
        taskDescription,
        10,
      );
      const memoriesSection = formatMemoriesSection(relevantMemories);
      if (memoriesSection) {
        systemPrompt += memoriesSection;
      }
    } catch {
      // Memory retrieval failure is non-critical
    }
  }

  // --- Build virtual + MCP tools ---
  const virtualTools: ToolDef[] = [];

  // Memory tools: always available when memoryService is present
  if (memoryService) {
    virtualTools.push(...buildMemoryTools());
  }

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

      // Handle virtual + MCP tool calls
      const toolResults = [];
      for (const toolCall of llmResponse.toolCalls) {
        // Check for memory virtual tools
        if (memoryService && MEMORY_TOOL_NAMES.includes(toolCall.name as typeof MEMORY_TOOL_NAMES[number])) {
          const result = await handleMemoryTool(
            toolCall.name as typeof MEMORY_TOOL_NAMES[number],
            toolCall.arguments,
            employee.employee_id,
            companyId,
            threadId,
            runtimeCtx,
          );
          toolResults.push({ callId: toolCall.id, name: toolCall.name, result });
          continue;
        }

        // Non-memory, non-handoff tool calls — delegate to toolExecutor
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

    // Reflect and remember — skip for direct_chat and handoff_continuation
    if (memoryService) {
      const skipReflection =
        state.entryMode === 'direct_chat' || assignment.taskType === 'handoff_continuation';
      try {
        await memoryService.reflectAndRemember(
          employee.employee_id,
          companyId,
          `Task: ${taskDescription}\n\nResponse: ${llmResponse.content}`,
          threadId,
          { skip: skipReflection },
        );
      } catch {
        // Reflection failure is non-critical
      }
    }

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

// ---------------------------------------------------------------------------
// Memory tool handler
// ---------------------------------------------------------------------------

async function handleMemoryTool(
  toolName: typeof MEMORY_TOOL_NAMES[number],
  args: Record<string, unknown>,
  employeeId: string,
  companyId: string,
  threadId: string,
  runtimeCtx: RuntimeContext,
): Promise<string> {
  const { memoryService, repos, eventBus } = runtimeCtx;
  if (!memoryService) return 'Memory service unavailable';

  switch (toolName) {
    case 'remember': {
      const content = String(args.content ?? '');
      const category = String(args.category ?? 'experience') as 'experience' | 'decision' | 'knowledge' | 'preference';
      const scope = String(args.scope ?? 'employee') as 'employee' | 'team' | 'company';
      const importance = Math.max(0, Math.min(1, Number(args.importance ?? 0.5)));

      const memoryId = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await repos.memories.create({
        memory_id: memoryId,
        company_id: companyId,
        scope,
        owner_id: scope === 'employee' ? employeeId : companyId,
        category,
        content,
        importance,
        source_thread_id: threadId,
      });

      eventBus.emit(
        memoryCreated(companyId, memoryId, employeeId, scope, category, content.slice(0, 100), threadId),
      );

      return `Memory stored (id: ${memoryId})`;
    }

    case 'recall': {
      const query = String(args.query ?? '');
      const memories = await memoryService.getRelevantMemories(employeeId, companyId, query, 5);

      if (memories.length === 0) return 'No relevant memories found.';

      // Touch access for each recalled memory
      for (const mem of memories) {
        await repos.memories.touchAccess(mem.memory_id);
        eventBus.emit(
          memoryAccessed(companyId, mem.memory_id, employeeId, query, threadId),
        );
      }

      return memories
        .map(
          (m) =>
            `[${m.memory_id}] (${m.scope}/${m.category}, importance: ${m.importance}) ${m.content}`,
        )
        .join('\n');
    }

    case 'forget': {
      const memoryId = String(args.memoryId ?? '');
      await repos.memories.delete(memoryId);
      return `Memory ${memoryId} deleted.`;
    }

    default:
      return `Unknown memory tool: ${toolName}`;
  }
}
