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
import type { OffisimGraphState, PendingAssignment } from '../graph/state.js';
import type { LlmMessage } from '../llm/gateway.js';
import type { EmployeeRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import type { CitationEntry } from '../services/library-service.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { generateId } from '../utils/generate-id.js';
import { getRuntime } from '../utils/get-runtime.js';
import { getConfigSignal } from '../utils/get-signal.js';
import { attemptLocalRecovery } from './employee-local-recovery.js';
import {
  buildEmployeeDeliverableTitle,
  materializeFileDeliverableIfNeeded,
} from './employee-deliverables.js';
import { MAX_TOOL_ROUNDS, TASK_TYPE_HANDOFF_CONTINUATION } from './employee-node-constants.js';
import { runPreflight } from './employee-preflight.js';
import { assemblePrompt } from './employee-prompt-assembly.js';
import { assembleToolKit } from './employee-tool-kit.js';
import type { HandoffArgs } from './employee-tool-round.js';
import { runToolRound } from './employee-tool-round.js';
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

interface ExecuteHandoffContext {
  readonly state: OffisimGraphState;
  readonly remaining: PendingAssignment[];
  readonly employee: EmployeeRow;
  readonly taskRunId: string | undefined;
  readonly runtimeCtx: RuntimeContext;
  readonly companyId: string;
  readonly threadId: string;
}

/**
 * Execute the full handoff side-effect chain. Returns null if the target
 * employee has been deleted mid-flight (caller should fall back to a normal
 * completion path).
 */
async function executeHandoff(args: HandoffArgs, ctx: ExecuteHandoffContext): Promise<Command | null> {
  const { state, remaining, employee, taskRunId, runtimeCtx, companyId, threadId } = ctx;
  const { repos, eventBus } = runtimeCtx;

  const targetEmp = await repos.employees.findById(args.targetEmployeeId).catch(() => null);
  if (!targetEmp) return null;

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
    employeeStateChanged(companyId, employee.employee_id, 'executing', 'idle', threadId, taskRunId),
  );

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
  } = preflightOutcome.preflight;
  const streamEmployeeReplies = true;

  const { repos, eventBus, companyId, threadId, memoryService } = runtimeCtx;

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
    let workingHistory = conversationHistory;

    while (llmResponse.toolCalls.length > 0 && round < MAX_TOOL_ROUNDS) {
      round++;

      const outcome = await runToolRound({
        llmResponse,
        conversationHistory: workingHistory,
        preflight: preflightOutcome.preflight,
        runtimeCtx,
        state,
        allowedMcpToolNames,
      });

      if (outcome.kind === 'handoff') {
        const command = await executeHandoff(outcome.args, {
          state,
          remaining,
          employee,
          taskRunId,
          runtimeCtx,
          companyId,
          threadId,
        });
        if (command) return command;
        // Target employee gone — fall back to completing the task ourselves.
        workingHistory.push({
          role: 'user',
          content: 'Handoff target employee no longer exists. Please complete the task yourself.',
        });
        break;
      }

      workingHistory = outcome.nextHistory;
      llmResponse = await runEmployeeTurn(workingHistory, { taskRunId });
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
