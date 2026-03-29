import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Command } from '@langchain/langgraph';
import { GraphError } from '../errors.js';
import { Logger } from '../services/logger.js';

const logger = new Logger('employee');
import {
  employeeStateChanged,
  graphNodeEntered,
  handoffInitiated,
  taskAssignmentChanged,
  taskStateChanged,
  taskSubtaskProgress,
} from '../events/event-factories.js';
import type { OffisimGraphState } from '../graph/state.js';
import type { LlmMessage, ToolDef } from '../llm/gateway.js';
import { recordedLlmCall } from '../llm/recorded-call.js';
import { WORKSTATION_ACCESS_DENIED } from '../runtime/tool-executor.js';
import type { CitationEntry } from '../services/library-service.js';
import { LibraryService } from '../services/library-service.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { generateId } from '../utils/generate-id.js';
import { getRuntime } from '../utils/get-runtime.js';
import { getConfigSignal } from '../utils/get-signal.js';
import { sanitizeForPrompt } from '../utils/sanitize-prompt.js';
import { buildEmployeePrompt } from './employee-builder.js';
import { attemptLocalRecovery } from './employee-local-recovery.js';
import {
  MEMORY_TOOL_NAMES,
  buildMemoryTools,
  formatMemoriesSection,
  handleMemoryTool,
} from './employee-memory-tools.js';

import type { CitationRef } from '../graph/state.js';

/** Maximum number of employee-to-employee handoffs per thread. */
const MAX_HANDOFF_COUNT = 3;

/** Maximum number of conversation messages sent to the LLM in a single call.
 *  Prevents unbounded token growth in long direct-chat sessions. */
const MAX_CONTEXT_MESSAGES = 20;

/** Task type for handoff continuation tasks. */
const TASK_TYPE_HANDOFF_CONTINUATION = 'handoff_continuation';

const SKILL_TOOL_NAME = 'activate_skill_context';

interface RuntimeSkillCapability {
  readonly kind?: string;
  readonly key?: string;
  readonly label?: string;
}

interface RuntimeSkillConfig {
  readonly skillName: string;
  readonly summary: string;
  readonly instructionMode?: string;
  readonly instructionExcerpt?: string;
  readonly instructions?: string;
  readonly capabilityIndex?: {
    readonly summary?: string;
    readonly requiredCapabilities?: readonly string[];
    readonly capabilities?: readonly RuntimeSkillCapability[];
  };
  readonly allowedTools?: readonly string[];
}

function parseRuntimeSkillConfig(configJson: string | null): RuntimeSkillConfig | null {
  if (!configJson) return null;
  try {
    const parsed = JSON.parse(configJson) as {
      runtimeSkill?: RuntimeSkillConfig;
    };
    return parsed.runtimeSkill ?? null;
  } catch {
    return null;
  }
}

function formatSkillCatalogSection(skill: RuntimeSkillConfig): string {
  const summary = sanitizeForPrompt(skill.capabilityIndex?.summary ?? skill.summary, 600);
  const excerpt = skill.instructionExcerpt
    ? sanitizeForPrompt(skill.instructionExcerpt, 800)
    : null;
  const requiredCapabilities = skill.capabilityIndex?.requiredCapabilities ?? [];
  const capabilities = skill.capabilityIndex?.capabilities ?? [];
  const lines = [
    '',
    '## Installed skill package',
    `Name: ${sanitizeForPrompt(skill.skillName, 120)}`,
    `Summary: ${summary}`,
  ];

  if (requiredCapabilities.length > 0) {
    lines.push(`Required capabilities: ${requiredCapabilities.join(', ')}`);
  }
  if (capabilities.length > 0) {
    lines.push(
      `Capability index: ${capabilities
        .map((cap) => sanitizeForPrompt(cap.label ?? cap.key ?? cap.kind ?? 'capability', 80))
        .join(', ')}`,
    );
  }
  if (excerpt) {
    lines.push(`Instruction preview: ${excerpt}`);
  }
  lines.push(
    `If you need the full skill instructions before acting, call \`${SKILL_TOOL_NAME}\` once and use the returned guidance.`,
  );
  return `\n${lines.join('\n')}`;
}

function formatSkillInstructionsSection(skill: RuntimeSkillConfig): string {
  if (!skill.instructions) return '';
  return `\n\n## Installed skill instructions\n${sanitizeForPrompt(skill.instructions, 6000)}`;
}

function buildSkillActivationTool(): ToolDef {
  return {
    name: SKILL_TOOL_NAME,
    description:
      'Load the full instructions for the installed skill package when the catalog preview is not enough.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Why the full skill instructions are needed for the current task.',
        },
      },
      required: ['reason'],
    },
  };
}


/**
 * Extract [N] citation references from an LLM response and map them
 * back to the citation entries that were injected into the prompt.
 * Returns only citations that were actually referenced in the text.
 */
export function extractUsedCitations(
  responseText: string,
  citationMap: CitationEntry[],
): CitationRef[] {
  if (citationMap.length === 0 || !responseText) return [];
  const usedIndices = new Set<number>();
  const re = /\[(\d+)]/g;
  let m = re.exec(responseText);
  while (m !== null) {
    usedIndices.add(Number(m[1]));
    m = re.exec(responseText);
  }
  return citationMap
    .filter((c) => usedIndices.has(c.index))
    .map((c) => ({
      index: c.index,
      docTitle: c.docTitle,
      docId: c.docId,
      snippet: c.snippet,
    }));
}


export async function employeeNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState> | Command> {
  const runtimeCtx = getRuntime(config, 'employee');

  // Announce node entry
  runtimeCtx.eventBus.emit(graphNodeEntered(runtimeCtx.companyId, state.threadId, 'employee'));

  const { modelResolver, repos, eventBus, toolExecutor, companyId, threadId } = runtimeCtx;

  // Pop the first pending assignment
  const remaining = [...state.pendingAssignments];
  const assignment = remaining.shift();

  if (!assignment) {
    return { pendingAssignments: [], completed: true };
  }

  const taskRunId = (assignment.inputJson as Record<string, unknown>).taskRunId as
    | string
    | undefined;

  const employee = await repos.employees.findById(assignment.employeeId).catch(() => null);
  if (!employee) {
    // Employee was deleted mid-execution — skip this assignment gracefully
    if (taskRunId) {
      await repos.taskRuns.updateStatus(taskRunId, 'failed');
      eventBus.emit(taskStateChanged(companyId, taskRunId, 'queued', 'failed', threadId));
    }
    return {
      pendingAssignments: remaining,
      currentStepOutputs: state.currentStepOutputs,
    };
  }

  const company = await repos.companies.findById(companyId);
  if (!company) {
    throw new GraphError(`Company ${companyId} not found`, 'employee');
  }

  // Emit employee working state
  eventBus.emit(
    employeeStateChanged(companyId, employee.employee_id, 'idle', 'executing', threadId, taskRunId),
  );

  // Track subtask progress scoped to THIS employee (not all employees in the queue)
  const myAssignments = state.pendingAssignments.filter(
    (a) => a.employeeId === employee.employee_id,
  );
  const myRemaining = remaining.filter((a) => a.employeeId === employee.employee_id);
  const totalAssignments = myAssignments.length;
  const completedSoFar = totalAssignments - myRemaining.length - 1;
  const taskLabel =
    ((assignment.inputJson as Record<string, unknown>).description as string)?.slice(0, 60) ??
    'Task';

  // Update task run status
  if (taskRunId) {
    await repos.taskRuns.updateStatus(taskRunId, 'running');
    eventBus.emit(
      taskStateChanged(companyId, taskRunId, 'queued', 'running', threadId, employee.employee_id),
    );
  }

  // Emit subtask running progress
  eventBus.emit(
    taskSubtaskProgress(
      companyId,
      employee.employee_id,
      completedSoFar,
      taskLabel,
      'running',
      totalAssignments,
      completedSoFar,
      threadId,
    ),
  );

  const resolved = modelResolver.resolve(null, employee.role_slug);
  const taskDescription =
    ((assignment.inputJson as Record<string, unknown>).description as string) ?? '';
  const runtimeSkill = parseRuntimeSkillConfig(employee.config_json);
  const memoryPolicy = runtimeCtx.runtimePolicy?.memory;
  const toolSearchEnabled = runtimeCtx.runtimePolicy?.toolSearch.enabled ?? true;
  let systemPrompt = buildEmployeePrompt(employee, company, taskDescription);
  if (runtimeSkill) {
    systemPrompt += formatSkillCatalogSection(runtimeSkill);
    if (!toolSearchEnabled) {
      systemPrompt += formatSkillInstructionsSection(runtimeSkill);
    }
  }

  // --- Inject relevant memories into system prompt ---
  const { memoryService } = runtimeCtx;
  if (memoryService && taskDescription && (memoryPolicy?.injectionEnabled ?? true)) {
    try {
      const relevantMemories = await memoryService.getRelevantMemories(
        employee.employee_id,
        companyId,
        taskDescription,
        memoryPolicy?.maxFacts ?? 10,
      );
      const memoriesSection = formatMemoriesSection(relevantMemories);
      if (memoriesSection) {
        systemPrompt += memoriesSection;
      }
    } catch {
      // Memory retrieval failure is non-critical
    }
  }

  // --- Inject relevant library documents into system prompt (with numbered citations) ---
  let citationMap: CitationEntry[] = [];
  if (taskDescription && repos.libraryDocuments) {
    try {
      const libraryService = new LibraryService(repos.libraryDocuments, eventBus);
      const { text, citations } = await libraryService.getRelevantSnippetsWithCitations(
        companyId,
        taskDescription,
      );
      if (text) {
        citationMap = citations;
        systemPrompt += `\n\n## Relevant company documents\n${text}\n\nWhen referencing these documents, cite them using [N] notation.`;
      }
    } catch {
      // Library retrieval failure is non-critical
    }
  }

  // --- Build virtual + MCP tools ---
  const virtualTools: ToolDef[] = [];

  // Memory tools: always available when memoryService is present
  if (memoryService) {
    virtualTools.push(...buildMemoryTools());
  }
  if (runtimeSkill && toolSearchEnabled && runtimeSkill.instructions) {
    virtualTools.push(buildSkillActivationTool());
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

  // PRD 2.3: Use workstation-scoped tools when resolver is available.
  // If an employee is not at a workstation, they get no MCP tools.
  // System agents (manager/hr/pm/boss) bypass this and get all tools.
  const { workstationToolResolver } = runtimeCtx;
  const mcpTools = workstationToolResolver
    ? await workstationToolResolver.resolveForEmployee(companyId, employee.employee_id)
    : await toolExecutor.listAvailable(companyId);
  const allowedMcpToolNames = new Set(mcpTools.map((t) => t.name));
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
        signal: getConfigSignal(config),
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

        // 0. Validate target employee still exists
        const targetEmp = await repos.employees.findById(args.targetEmployeeId).catch(() => null);
        if (!targetEmp) {
          // Target employee no longer exists — skip handoff, continue with current task
          conversationHistory.push({
            role: 'user',
            content: 'Handoff target employee no longer exists. Please complete the task yourself.',
          });
          break;
        }

        // 1. Write handoff record
        const handoffId = generateId('ho');
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
        const newTaskRunId = generateId('tr-ho');
        await repos.taskRuns.create({
          task_run_id: newTaskRunId,
          thread_id: state.threadId,
          employee_id: args.targetEmployeeId,
          parent_task_run_id: taskRunId ?? null,
          task_type: TASK_TYPE_HANDOFF_CONTINUATION,
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
        //    Prepend handoff task but KEEP remaining assignments from this step
        return new Command({
          goto: 'employee',
          update: {
            pendingAssignments: [
              {
                taskType: TASK_TYPE_HANDOFF_CONTINUATION,
                employeeId: args.targetEmployeeId,
                inputJson: {
                  description: args.remainingWork,
                  priorWork: args.completedWork,
                  handoffReason: args.reason,
                  taskRunId: newTaskRunId,
                },
              },
              ...remaining,
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

      // Handle virtual + MCP tool calls — execute in parallel for throughput.
      // Each tool call is independent; a failing tool should not block others.
      const settled = await Promise.allSettled(
        llmResponse.toolCalls.map(async (toolCall) => {
          // Check for memory virtual tools
          if (
            memoryService &&
            MEMORY_TOOL_NAMES.includes(toolCall.name as (typeof MEMORY_TOOL_NAMES)[number])
          ) {
            const result = await handleMemoryTool(
              toolCall.name as (typeof MEMORY_TOOL_NAMES)[number],
              toolCall.arguments,
              employee.employee_id,
              companyId,
              threadId,
              runtimeCtx,
            );
            return { callId: toolCall.id, name: toolCall.name, result };
          }
          if (runtimeSkill && toolCall.name === SKILL_TOOL_NAME) {
            return {
              callId: toolCall.id,
              name: toolCall.name,
              result: {
                skillName: runtimeSkill.skillName,
                summary: runtimeSkill.summary,
                instructions: runtimeSkill.instructions ?? '',
                allowedTools: runtimeSkill.allowedTools ?? [],
                capabilities: runtimeSkill.capabilityIndex?.requiredCapabilities ?? [],
              },
            };
          }

          // Non-memory, non-handoff tool calls — delegate to toolExecutor
          // PRD 2.3: Verify workstation access using pre-resolved tool set (avoids N+1 queries)
          if (workstationToolResolver && !allowedMcpToolNames.has(toolCall.name)) {
            return {
              callId: toolCall.id,
              name: toolCall.name,
              result: {
                success: false,
                result: null,
                error: `[${WORKSTATION_ACCESS_DENIED}] Employee '${employee.name}' is not assigned to a workstation with access to tool '${toolCall.name}'.`,
              },
            };
          }

          const result = await toolExecutor.execute({
            toolCallId: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
            employeeId: employee.employee_id,
          });
          return { callId: toolCall.id, name: toolCall.name, result };
        }),
      );

      // Unwrap settled results — failed tools get an error string instead of crashing the loop
      const toolResults = settled.map((s, i) => {
        if (s.status === 'fulfilled') return s.value;
        const tc = llmResponse.toolCalls[i];
        if (!tc) {
          const errMsg = s.reason instanceof Error ? s.reason.message : String(s.reason);
          logger.warn('Tool call failed without matching tool call metadata', { error: errMsg });
          return {
            callId: generateId('tool'),
            name: 'unknown_tool',
            result: `Tool execution failed: ${errMsg}`,
          };
        }
        const errMsg = s.reason instanceof Error ? s.reason.message : String(s.reason);
        logger.warn('Tool call failed', { toolName: tc.name, error: errMsg });
        return { callId: tc.id, name: tc.name, result: `Tool execution failed: ${errMsg}` };
      });

      // Append this round's assistant message (with tool calls) + tool results
      // to the running history using proper LLM message format.
      conversationHistory.push({
        role: 'assistant',
        content: llmResponse.content || '',
        toolCalls: llmResponse.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        })),
      });
      for (const tr of toolResults) {
        conversationHistory.push({
          role: 'tool',
          content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
          toolCallId: tr.callId,
        });
      }

      // Trim conversation history to avoid unbounded token growth in long sessions.
      // Keep the system message (first) + the last MAX_CONTEXT_MESSAGES messages.
      const [firstMessage] = conversationHistory;
      const trimmedHistory =
        conversationHistory.length > MAX_CONTEXT_MESSAGES + 1 && firstMessage
          ? [firstMessage, ...conversationHistory.slice(-MAX_CONTEXT_MESSAGES)]
          : conversationHistory;

      // Follow-up LLM call with (potentially trimmed) accumulated history
      llmResponse = await recordedLlmCall(
        runtimeCtx,
        {
          messages: trimmedHistory,
          model: resolved.model,
          temperature: resolved.temperature,
          maxTokens: resolved.maxTokens,
          tools: allTools.length > 0 ? allTools : undefined,
          signal: getConfigSignal(config),
        },
        { nodeName: 'employee', provider: resolved.provider, model: resolved.model, taskRunId },
      );
    }

    if (round >= MAX_TOOL_ROUNDS && llmResponse.toolCalls.length > 0) {
      logger.warn(`Tool loop hit max ${MAX_TOOL_ROUNDS} rounds`, { employeeName: employee.name });
    }

    // Update task run to completed
    if (taskRunId) {
      await repos.taskRuns.updateStatus(
        taskRunId,
        'completed',
        JSON.stringify({ content: llmResponse.content }),
      );
      eventBus.emit(
        taskStateChanged(
          companyId,
          taskRunId,
          'running',
          'completed',
          threadId,
          employee.employee_id,
        ),
      );
      eventBus.emit(
        taskAssignmentChanged(companyId, taskRunId, employee.employee_id, 'unassigned', threadId),
      );
    }

    // Emit subtask done progress
    eventBus.emit(
      taskSubtaskProgress(
        companyId,
        employee.employee_id,
        completedSoFar,
        taskLabel,
        'done',
        totalAssignments,
        completedSoFar + 1,
        threadId,
      ),
    );

    // Emit employee idle state
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

    // Reflect and remember before returning so the next task can rely on
    // newly extracted memory in the same local runtime session.
    // Skip for direct_chat and handoff_continuation.
    if (memoryService) {
      const skipReflection =
        state.entryMode === 'direct_chat' || assignment.taskType === TASK_TYPE_HANDOFF_CONTINUATION;
      try {
        await memoryService.reflectAndRemember(
          employee.employee_id,
          companyId,
          `Task: ${taskDescription}\n\nResponse: ${llmResponse.content}`,
          threadId,
          { skip: skipReflection, signal: getConfigSignal(config) },
        );
      } catch (err) {
        logger.warn('reflectAndRemember failed', {
          error: err instanceof Error ? err.message : String(err),
          employeeId: employee.employee_id,
        });
      }
    }

    // Extract citations actually used in the response
    const usedCitations = extractUsedCitations(llmResponse.content, citationMap);

    await appendAgentEvent(runtimeCtx, {
      projectId: state.projectId,
      threadId: state.threadId,
      agentName: `employee:${employee.employee_id}`,
      eventType: 'action',
      payload: {
        taskRunId,
        employeeName: employee.name,
        toolRounds: round,
        outputLength: llmResponse.content.length,
        citationCount: usedCitations.length,
      },
    });

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
          citations: usedCitations.length > 0 ? usedCitations : undefined,
        },
      ],
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // --- Recovery-aware retry: try to fix locally before escalating ---
    const recovered = await attemptLocalRecovery(runtimeCtx, config, errorMessage, {
      systemPrompt,
      taskDescription,
      model: resolved.model,
      provider: resolved.provider,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
      tools: allTools.length > 0 ? allTools : undefined,
      taskRunId,
    }).catch(() => null); // recovery itself must not throw

    if (recovered) {
      // Recovery succeeded — continue as if the original call worked
      if (taskRunId) {
        await repos.taskRuns.updateStatus(
          taskRunId,
          'completed',
          JSON.stringify({ content: recovered.content }),
        );
        eventBus.emit(
          taskStateChanged(
            companyId,
            taskRunId,
            'running',
            'completed',
            threadId,
            employee.employee_id,
          ),
        );
        eventBus.emit(
          taskAssignmentChanged(companyId, taskRunId, employee.employee_id, 'unassigned', threadId),
        );
      }
      eventBus.emit(
        taskSubtaskProgress(
          companyId,
          employee.employee_id,
          completedSoFar,
          taskLabel,
          'done',
          totalAssignments,
          completedSoFar + 1,
          threadId,
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

      await appendAgentEvent(runtimeCtx, {
        projectId: state.projectId,
        threadId: state.threadId,
        agentName: `employee:${employee.employee_id}`,
        eventType: 'action',
        payload: {
          taskRunId,
          employeeName: employee.name,
          recoveredFromError: true,
          outputLength: recovered.content.length,
        },
      }).catch(() => {});

      return {
        currentEmployeeId: employee.employee_id,
        currentTaskRunId: taskRunId ?? null,
        pendingAssignments: remaining,
        messages: [new AIMessage({ content: `[${employee.name}]: ${recovered.content}` })],
        currentStepOutputs: [
          ...state.currentStepOutputs,
          {
            employeeId: employee.employee_id,
            employeeName: employee.name,
            content: recovered.content,
            taskRunId: taskRunId ?? '',
          },
        ],
      };
    }

    // --- Recovery failed or not available — escalate to error_handler ---

    // Emit employee state: executing → failed
    eventBus.emit(
      employeeStateChanged(
        companyId,
        employee.employee_id,
        'executing',
        'failed',
        threadId,
        taskRunId,
      ),
    );

    // Update task run status to failed
    if (taskRunId) {
      await repos.taskRuns.updateStatus(taskRunId, 'failed');
      eventBus.emit(
        taskStateChanged(companyId, taskRunId, 'running', 'failed', threadId, employee.employee_id),
      );
    }

    // Emit subtask failed progress
    eventBus.emit(
      taskSubtaskProgress(
        companyId,
        employee.employee_id,
        completedSoFar,
        taskLabel,
        'failed',
        totalAssignments,
        completedSoFar,
        threadId,
      ),
    );

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

    await appendAgentEvent(runtimeCtx, {
      projectId: state.projectId,
      threadId: state.threadId,
      agentName: `employee:${employee.employee_id}`,
      eventType: 'error',
      payload: {
        errorCode: 'LLM_CALL_FAILED',
        message: errorMessage,
        employeeName: employee.name,
        taskRunId,
        provider: resolved.provider,
        model: resolved.model,
      },
    }).catch(() => {}); // error logging must not throw

    return {
      currentEmployeeId: employee.employee_id,
      currentTaskRunId: taskRunId ?? null,
      pendingAssignments: remaining,
      interruptReason: JSON.stringify(structuredError),
      currentStepOutputs: state.currentStepOutputs,
    };
  }
}

