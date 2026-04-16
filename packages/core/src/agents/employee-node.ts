import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Command } from '@langchain/langgraph';
import { Logger } from '../services/logger.js';

const logger = new Logger('employee');
import {
  deliverableCreated,
  employeeStateChanged,
  handoffInitiated,
  taskAssignmentChanged,
  taskStateChanged,
  taskSubtaskProgress,
} from '../events/event-factories.js';
import type { OffisimGraphState } from '../graph/state.js';
import type { LlmMessage } from '../llm/gateway.js';
import { WORKSTATION_ACCESS_DENIED } from '../runtime/tool-executor.js';
import type { CitationEntry } from '../services/library-service.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { generateId } from '../utils/generate-id.js';
import { getRuntime } from '../utils/get-runtime.js';
import { getConfigSignal } from '../utils/get-signal.js';
import { attemptLocalRecovery } from './employee-local-recovery.js';
import { MEMORY_TOOL_NAMES, handleMemoryTool } from './employee-memory-tools.js';
import {
  buildEmployeeDeliverableTitle,
  materializeFileDeliverableIfNeeded,
} from './employee-deliverables.js';
import {
  MAX_CONTEXT_MESSAGES,
  MAX_TOOL_ROUNDS,
  SKILL_TOOL_NAME,
  TASK_TYPE_HANDOFF_CONTINUATION,
} from './employee-node-constants.js';
import { runPreflight } from './employee-preflight.js';
import { assemblePrompt } from './employee-prompt-assembly.js';
import { assembleToolKit } from './employee-tool-kit.js';
import { buildTurnRunner } from './employee-turn-runner.js';

import type { CitationRef } from '../graph/state.js';

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

  const preflightOutcome = await runPreflight(state, runtimeCtx);
  if (preflightOutcome.kind === 'early-return') {
    return preflightOutcome.stateUpdate;
  }
  const {
    assignment,
    remaining,
    employee,
    taskRunId,
    taskLabel,
    totalAssignments,
    completedSoFar,
    isDirectChatTask,
    resolved,
    taskDescription,
    runtimeSkill,
  } = preflightOutcome.preflight;
  const streamEmployeeReplies = true;

  const {
    repos,
    eventBus,
    toolExecutor,
    workstationToolResolver,
    companyId,
    threadId,
    memoryService,
  } = runtimeCtx;

  const { systemPrompt, citationMap } = await assemblePrompt(
    preflightOutcome.preflight,
    runtimeCtx,
  );

  const { allTools, allowedMcpToolNames } = await assembleToolKit(
    preflightOutcome.preflight,
    runtimeCtx,
    state,
  );

  const runEmployeeTurn = buildTurnRunner({
    runtimeCtx,
    threadId,
    resolved,
    allTools,
    streamEnabled: streamEmployeeReplies,
    signal: getConfigSignal(config),
  });

  try {
    // Initial LLM call
    let llmResponse = await runEmployeeTurn(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: taskDescription },
      ],
      { taskRunId },
    );

    // Accumulate conversation history across tool-call rounds so later rounds
    // can see earlier tool results (fixes lost-context bug).
    const conversationHistory: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: taskDescription },
    ];

    // Multi-round tool calling loop (max 5 rounds to prevent infinite loops)
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
          await runtimeCtx.hookRegistry.emit('task.completed', {
            threadId,
            companyId,
            employeeId: employee.employee_id,
            taskRunId,
            completionType: 'handoff',
          });
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
                sourceKind: 'employee',
                roleSlug: employee.role_slug,
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
            nodeName: 'employee',
            employeeId: employee.employee_id,
            taskRunId: taskRunId ?? undefined,
            stepIndex: state.currentStepIndex,
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
        ...(llmResponse.reasoningContent ? { reasoningContent: llmResponse.reasoningContent } : {}),
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
      llmResponse = await runEmployeeTurn(trimmedHistory, { taskRunId });
    }

    if (round >= MAX_TOOL_ROUNDS && llmResponse.toolCalls.length > 0) {
      logger.warn(`Tool loop hit max ${MAX_TOOL_ROUNDS} rounds`, { employeeName: employee.name });
    }

    const materializedDeliverable = await materializeFileDeliverableIfNeeded(
      runtimeCtx,
      taskDescription,
      employee,
      llmResponse,
      {
        model: resolved.model,
        provider: resolved.provider,
        temperature: resolved.temperature,
        maxTokens: resolved.maxTokens,
        signal: getConfigSignal(config),
      },
      taskRunId,
    );

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
          'employee',
          employee.name,
        ),
      );
      eventBus.emit(
        taskAssignmentChanged(companyId, taskRunId, employee.employee_id, 'unassigned', threadId, {
          employeeId: employee.employee_id,
          assigneeKind: 'employee',
          assigneeName: employee.name,
        }),
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
        { employeeId: employee.employee_id, assigneeKind: 'employee', assigneeName: employee.name },
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
    // Skip for direct-chat style tasks and handoff_continuation.
    if (memoryService) {
      const skipReflection =
        isDirectChatTask || assignment.taskType === TASK_TYPE_HANDOFF_CONTINUATION;
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
    if (taskRunId) {
      await runtimeCtx.hookRegistry.emit('task.completed', {
        threadId,
        companyId,
        employeeId: employee.employee_id,
        taskRunId,
        completionType: 'response',
      });
    }
    runtimeCtx.scratchpad.write(
      `employee.last-output.${employee.employee_id}`,
      `${employee.name}: ${llmResponse.content.slice(0, 240)}`,
      'employee',
    );

    if (materializedDeliverable) {
      runtimeCtx.eventBus.emit(
        deliverableCreated(
          runtimeCtx.companyId,
          generateId('del'),
          state.threadId,
          buildEmployeeDeliverableTitle(
            taskDescription,
            materializedDeliverable.fileName,
          ),
          materializedDeliverable.artifactContent,
          [
            {
              employeeId: employee.employee_id,
              employeeName: employee.name,
              sourceKind: 'employee',
              roleSlug: employee.role_slug,
            },
          ],
          {
            kind: 'file',
            fileName: materializedDeliverable.fileName,
            mimeType: materializedDeliverable.mimeType,
          },
        ),
      );
    }

    return {
      currentEmployeeId: employee.employee_id,
      currentTaskRunId: taskRunId ?? null,
      pendingAssignments: remaining,
      messages: [new AIMessage({ content: llmResponse.content })],
      currentStepOutputs: [
        ...state.currentStepOutputs,
        {
          employeeId: employee.employee_id,
          employeeName: employee.name,
          sourceKind: 'employee',
          roleSlug: employee.role_slug,
          content: llmResponse.content,
          taskRunId: taskRunId ?? '',
          artifact: materializedDeliverable
            ? {
                kind: 'file',
                fileName: materializedDeliverable.fileName,
                mimeType: materializedDeliverable.mimeType,
                content: materializedDeliverable.artifactContent,
              }
            : undefined,
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
      const materializedRecoveredDeliverable = await materializeFileDeliverableIfNeeded(
        runtimeCtx,
        taskDescription,
        employee,
        recovered,
        {
          model: resolved.model,
          provider: resolved.provider,
          temperature: resolved.temperature,
          maxTokens: resolved.maxTokens,
          signal: getConfigSignal(config),
        },
        taskRunId,
      );
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
            'employee',
            employee.name,
          ),
        );
        eventBus.emit(
          taskAssignmentChanged(companyId, taskRunId, employee.employee_id, 'unassigned', threadId, {
            employeeId: employee.employee_id,
            assigneeKind: 'employee',
            assigneeName: employee.name,
          }),
        );
        await runtimeCtx.hookRegistry.emit('task.completed', {
          threadId,
          companyId,
          employeeId: employee.employee_id,
          taskRunId,
          completionType: 'recovery',
        });
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
          { employeeId: employee.employee_id, assigneeKind: 'employee', assigneeName: employee.name },
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

      if (materializedRecoveredDeliverable) {
        runtimeCtx.eventBus.emit(
          deliverableCreated(
            runtimeCtx.companyId,
            generateId('del'),
            state.threadId,
            buildEmployeeDeliverableTitle(
              taskDescription,
              materializedRecoveredDeliverable.fileName,
            ),
            materializedRecoveredDeliverable.artifactContent,
            [
              {
                employeeId: employee.employee_id,
                employeeName: employee.name,
                sourceKind: 'employee',
                roleSlug: employee.role_slug,
              },
            ],
            {
              kind: 'file',
              fileName: materializedRecoveredDeliverable.fileName,
              mimeType: materializedRecoveredDeliverable.mimeType,
            },
          ),
        );
      }

      return {
        currentEmployeeId: employee.employee_id,
        currentTaskRunId: taskRunId ?? null,
        pendingAssignments: remaining,
        messages: [new AIMessage({ content: recovered.content })],
        currentStepOutputs: [
          ...state.currentStepOutputs,
          {
            employeeId: employee.employee_id,
            employeeName: employee.name,
            sourceKind: 'employee',
            roleSlug: employee.role_slug,
            content: recovered.content,
            taskRunId: taskRunId ?? '',
            artifact: materializedRecoveredDeliverable
              ? {
                  kind: 'file',
                  fileName: materializedRecoveredDeliverable.fileName,
                  mimeType: materializedRecoveredDeliverable.mimeType,
                  content: materializedRecoveredDeliverable.artifactContent,
                }
              : undefined,
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
        taskStateChanged(
          companyId,
          taskRunId,
          'running',
          'failed',
          threadId,
          employee.employee_id,
          'employee',
          employee.name,
        ),
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
        { employeeId: employee.employee_id, assigneeKind: 'employee', assigneeName: employee.name },
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
