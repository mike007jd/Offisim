import { Command } from '@langchain/langgraph';
import { parseEmployeeConfig } from '@offisim/shared-types';
import { forkSubContext } from '../a2a/fork-sub-context.js';
import {
  employeeStateChanged,
  handoffInitiated,
  taskStateChanged,
} from '../events/event-factories.js';
import type { OffisimGraphState, PendingAssignment } from '../graph/state.js';
import { recordedLlmCall } from '../llm/recorded-call.js';
import type { EmployeeRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { generateId } from '../utils/generate-id.js';
import { TASK_TYPE_HANDOFF_CONTINUATION } from './employee-node-constants.js';
import type { HandoffArgs } from './employee-tool-round.js';

export interface ExecuteHandoffContext {
  readonly state: OffisimGraphState;
  readonly remaining: PendingAssignment[];
  readonly employee: EmployeeRow;
  readonly taskRunId: string | undefined;
  readonly stepIndex: number;
  readonly runtimeCtx: RuntimeContext;
  readonly companyId: string;
  readonly threadId: string;
  /** Run AbortSignal so the isolated handoff sub-run honors cancellation. */
  readonly signal?: AbortSignal;
}

/**
 * Execute the full handoff side-effect chain (called from the orchestrator
 * barrel after `runToolRound` signals `kind: 'handoff'`).
 *
 * Steps (in order, must match pre-refactor handoff branch):
 *   1. Validate target employee still exists — return null if not (caller falls back)
 *   2. `handoffs.create` — write handoff record
 *   3. `taskRuns.create` — new TaskRun for receiving employee, status: 'queued'
 *   4. (if current taskRunId) Update current task run → 'completed' + `hookRegistry.emit('task.completed', completionType: 'handoff')`
 *   5. Emit `handoff.initiated` + `employee.state.changed(executing→idle)`
 *   6. Return `Command({ goto: 'employee', update })` — bypasses normal routing
 */
export async function executeHandoff(
  args: HandoffArgs,
  ctx: ExecuteHandoffContext,
): Promise<Command | null> {
  const { state, remaining, employee, taskRunId, stepIndex, runtimeCtx, companyId, threadId, signal } =
    ctx;
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

  const subRun = await runIsolatedHandoffSubRun({
    args,
    state,
    targetEmp,
    taskRunId: newTaskRunId,
    runtimeCtx,
    companyId,
    threadId,
    signal,
  });

  return new Command({
    goto: 'employee',
    update: {
      pendingAssignments: remaining,
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
          stepIndex,
        },
        {
          employeeId: targetEmp.employee_id,
          employeeName: targetEmp.name,
          sourceKind: 'employee',
          roleSlug: targetEmp.role_slug,
          content: subRun.summary,
          taskRunId: newTaskRunId,
          stepIndex,
          isExternal: targetEmp.is_external === 1,
          brandKey: targetEmp.brand_key ?? null,
        },
      ],
    },
  });
}

async function runIsolatedHandoffSubRun(input: {
  readonly args: HandoffArgs;
  readonly state: OffisimGraphState;
  readonly targetEmp: EmployeeRow;
  readonly taskRunId: string;
  readonly runtimeCtx: RuntimeContext;
  readonly companyId: string;
  readonly threadId: string;
  readonly signal?: AbortSignal;
}): Promise<{ summary: string }> {
  const { args, state, targetEmp, taskRunId, runtimeCtx, companyId, threadId, signal } = input;
  const resolved = resolveTargetModel(runtimeCtx, targetEmp);
  const scopedTools =
    runtimeCtx.llmToolCallsEnabled === false || !runtimeCtx.builtinTools
      ? []
      : [...runtimeCtx.builtinTools.values()]
          .filter((tool) => tool.def.annotations?.readOnlyHint === true)
          .map((tool) => tool.def);
  const subTask = [
    `You are ${targetEmp.name}. Continue this delegated task in an isolated sub-run.`,
    `Reason: ${args.reason}`,
    `Completed work from previous employee: ${args.completedWork}`,
    `Remaining work: ${args.remainingWork}`,
    'Return a concise typed summary for the parent run. Do not include private transcript details.',
  ].join('\n\n');

  runtimeCtx.eventBus.emit(
    employeeStateChanged(
      companyId,
      targetEmp.employee_id,
      'idle',
      'executing',
      threadId,
      taskRunId,
    ),
  );
  runtimeCtx.eventBus.emit(taskStateChanged(companyId, taskRunId, 'queued', 'running', threadId));

  try {
    const result = await forkSubContext({
      subTask,
      scopedTools,
      runChild: async (childMessages, tools) => {
        const response = await recordedLlmCall(
          runtimeCtx,
          {
            messages: childMessages,
            model: resolved.model,
            temperature: resolved.temperature,
            maxTokens: resolved.maxTokens,
            tools: tools.length > 0 ? tools : undefined,
            ...(signal ? { signal } : {}),
          },
          {
            nodeName: 'employee_sub_run',
            provider: resolved.provider,
            model: resolved.model,
            taskRunId,
            projectId: state.projectId,
            employeeId: targetEmp.employee_id,
          },
        );
        const summary =
          response.content.trim() ||
          `[SUB_RUN_NO_TEXT] Isolated handoff returned no text; requested ${response.toolCalls.length} tool call(s).`;
        return {
          summary,
          transcript: [
            ...childMessages,
            {
              role: 'assistant' as const,
              content: response.content,
              ...(response.toolCalls.length > 0 ? { toolCalls: response.toolCalls } : {}),
            },
          ],
          childTokensUsed: response.usage.inputTokens + response.usage.outputTokens,
        };
      },
    });
    await runtimeCtx.repos.taskRuns.updateStatus(
      taskRunId,
      'completed',
      JSON.stringify({ summary: result.summary, isolatedSubRun: true }),
    );
    runtimeCtx.eventBus.emit(
      taskStateChanged(companyId, taskRunId, 'running', 'completed', threadId),
    );
    runtimeCtx.eventBus.emit(
      employeeStateChanged(
        companyId,
        targetEmp.employee_id,
        'executing',
        'idle',
        threadId,
        taskRunId,
      ),
    );
    await runtimeCtx.hookRegistry.emit('task.completed', {
      threadId,
      companyId,
      employeeId: targetEmp.employee_id,
      taskRunId,
      completionType: 'handoff',
    });
    return { summary: result.summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await runtimeCtx.repos.taskRuns.updateStatus(
      taskRunId,
      'failed',
      JSON.stringify({ error: message, isolatedSubRun: true }),
    );
    runtimeCtx.eventBus.emit(taskStateChanged(companyId, taskRunId, 'running', 'failed', threadId));
    runtimeCtx.eventBus.emit(
      employeeStateChanged(
        companyId,
        targetEmp.employee_id,
        'executing',
        'idle',
        threadId,
        taskRunId,
      ),
    );
    return { summary: `[SUB_RUN_FAILED] ${message}` };
  }
}

function resolveTargetModel(runtimeCtx: RuntimeContext, employee: EmployeeRow) {
  const roleResolved = runtimeCtx.modelResolver.resolve(null, employee.role_slug);
  const config = parseEmployeeConfig(employee.config_json);
  const modelPreference = config.modelPreference?.trim();
  if (!modelPreference) return roleResolved;
  const registryEntry = runtimeCtx.modelRegistry?.findById(modelPreference);
  return {
    provider: registryEntry?.provider ?? roleResolved.provider,
    model: registryEntry?.model ?? modelPreference,
    temperature: config.temperature ?? registryEntry?.temperature ?? roleResolved.temperature,
    maxTokens: config.maxTokens ?? registryEntry?.maxTokens ?? roleResolved.maxTokens,
    contextWindow: registryEntry?.contextWindow ?? roleResolved.contextWindow,
  };
}
