import type { RunnableConfig } from '@langchain/core/runnables';
import { Command } from '@langchain/langgraph';
import { Logger } from '../services/logger.js';

const logger = new Logger('employee');
import {
  employeeStateChanged,
  handoffInitiated,
  taskStateChanged,
  taskSubtaskProgress,
} from '../events/event-factories.js';
import type { OffisimGraphState, PendingAssignment } from '../graph/state.js';
import type { LlmMessage } from '../llm/gateway.js';
import type { EmployeeRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { generateId } from '../utils/generate-id.js';
import { getRuntime } from '../utils/get-runtime.js';
import { getConfigSignal } from '../utils/get-signal.js';
import { attemptLocalRecovery } from './employee-local-recovery.js';
import { MAX_TOOL_ROUNDS, TASK_TYPE_HANDOFF_CONTINUATION } from './employee-node-constants.js';
import { finalizeEmployeeSuccess } from './employee-completion.js';
import { runPreflight } from './employee-preflight.js';
import { assemblePrompt } from './employee-prompt-assembly.js';
import { assembleToolKit } from './employee-tool-kit.js';
import type { HandoffArgs } from './employee-tool-round.js';
import { runToolRound } from './employee-tool-round.js';
import { buildTurnRunner } from './employee-turn-runner.js';

export { extractUsedCitations } from './employee-completion.js';

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
    remaining,
    employee,
    taskRunId,
    taskLabel,
    totalAssignments,
    completedSoFar,
    resolved,
    taskDescription,
  } = preflightOutcome.preflight;
  const streamEmployeeReplies = true;

  const { repos, eventBus, companyId, threadId } = runtimeCtx;

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

  // Hoisted out of try scope so the recovery catch handler can report the
  // tool round count reached before the failure.
  let round = 0;

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

    return await finalizeEmployeeSuccess({
      runtimeCtx,
      state,
      preflight: preflightOutcome.preflight,
      llmResponse,
      citationMap,
      source: 'normal',
      round,
      signal: getConfigSignal(config),
    });
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
      return await finalizeEmployeeSuccess({
        runtimeCtx,
        state,
        preflight: preflightOutcome.preflight,
        llmResponse: recovered,
        citationMap,
        source: 'recovery',
        round,
        signal: getConfigSignal(config),
      });
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
