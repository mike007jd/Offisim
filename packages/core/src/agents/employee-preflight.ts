import {
  type ResolvedModel,
  type RuntimeMemoryPolicy,
  parseEmployeeConfig,
} from '@offisim/shared-types';
import { GraphError } from '../errors.js';
import {
  employeeStateChanged,
  graphNodeEntered,
  taskStateChanged,
  taskSubtaskProgress,
} from '../events/event-factories.js';
import type { OffisimGraphState, PendingAssignment, RunScope } from '../graph/state.js';
import type { ActiveContextSnapshot } from '../runtime/active-context-snapshot.js';
import { resolveActiveContextSnapshot } from '../runtime/active-context-snapshot.js';
import type { CompanyRow, EmployeeRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import {
  attachmentGatewayLaneOutcomeState,
  attachmentsRequireGatewayLane,
} from './attachment-lane-guard.js';
import { resolveAttachmentAwareTaskDescription } from './attachment-preface.js';
import {
  localToolsGatewayLaneOutcomeState,
  localToolsRequireGatewayLane,
} from './local-tool-lane-guard.js';
import { detectTaskToolIntent } from './task-tool-intent.js';

export interface PreflightResult {
  readonly assignment: PendingAssignment;
  readonly remaining: PendingAssignment[];
  readonly employee: EmployeeRow;
  readonly company: CompanyRow;
  readonly activeContextSnapshot: ActiveContextSnapshot;
  readonly taskRunId: string | undefined;
  readonly stepIndex: number;
  readonly taskLabel: string;
  readonly totalAssignments: number;
  readonly completedSoFar: number;
  readonly isDirectChatTask: boolean;
  readonly resolved: ResolvedModel;
  readonly taskDescription: string;
  readonly requiredSkills: string[];
  readonly memoryPolicy: RuntimeMemoryPolicy | undefined;
  readonly toolSearchEnabled: boolean;
}

export type PreflightOutcome =
  | { kind: 'early-return'; stateUpdate: Partial<OffisimGraphState> }
  | { kind: 'continue'; preflight: PreflightResult };

function resolveEmployeeModel(
  runtimeCtx: RuntimeContext,
  employee: Pick<EmployeeRow, 'config_json' | 'role_slug'>,
): ResolvedModel {
  const roleResolved = runtimeCtx.modelResolver.resolve(null, employee.role_slug);
  const config = parseEmployeeConfig(employee.config_json);
  const modelPreference = config.modelPreference?.trim();
  if (!modelPreference) return roleResolved;
  const registryEntry = runtimeCtx.modelRegistry?.findById(modelPreference);
  if (!registryEntry && runtimeCtx.modelRegistry && modelPreference !== roleResolved.model) {
    throw new GraphError(
      `Employee model override "${modelPreference}" is not configured. Set this employee to follow the unified setting or choose a configured model before running.`,
      'employee',
    );
  }
  return {
    provider: registryEntry?.provider ?? roleResolved.provider,
    model: registryEntry?.model ?? modelPreference,
    temperature: config.temperature ?? registryEntry?.temperature ?? roleResolved.temperature,
    maxTokens: config.maxTokens ?? registryEntry?.maxTokens ?? roleResolved.maxTokens,
  };
}

/**
 * Pre-LLM setup pipeline for the employee node:
 *  1. Emit `graph.node.entered`
 *  2. Pop the first pending assignment (early return if none)
 *  3. Load employee + company (early return if employee deleted mid-run)
 *  4. Emit `employee.state.changed(idle→executing)` + `task.state.changed(queued→running)` + `task.subtask.progress(running)`
 *  5. Resolve model, derive task metadata
 */
export async function runPreflight(
  state: OffisimGraphState,
  runtimeCtx: RuntimeContext,
  runScope: RunScope | null = null,
): Promise<PreflightOutcome> {
  runtimeCtx.eventBus.emit(
    graphNodeEntered(runtimeCtx.companyId, state.threadId, 'employee', runScope),
  );

  const { repos, eventBus, companyId, threadId } = runtimeCtx;

  const remaining = [...state.pendingAssignments];
  const assignment = remaining.shift();

  if (!assignment) {
    return { kind: 'early-return', stateUpdate: { pendingAssignments: [], completed: true } };
  }

  const isDirectChatTask = assignment.taskType === 'direct_chat';

  const taskRunId =
    assignment.taskRunId ??
    ((assignment.inputJson as Record<string, unknown>).taskRunId as string | undefined);
  const stepIndexRaw =
    assignment.stepIndex ?? (assignment.inputJson as Record<string, unknown>).stepIndex;
  const stepIndex = typeof stepIndexRaw === 'number' ? stepIndexRaw : state.currentStepIndex;

  const employee = await repos.employees.findById(assignment.employeeId).catch(() => null);
  if (!employee) {
    if (taskRunId) {
      await repos.taskRuns.updateStatus(taskRunId, 'failed');
      eventBus.emit(taskStateChanged(companyId, taskRunId, 'queued', 'failed', threadId));
    }
    return {
      kind: 'early-return',
      stateUpdate: {
        pendingAssignments: remaining,
        currentStepOutputs: state.currentStepOutputs,
      },
    };
  }

  const company = await repos.companies.findById(companyId);
  if (!company) {
    throw new GraphError(`Company ${companyId} not found`, 'employee');
  }
  const activeContextSnapshot = await resolveActiveContextSnapshot({
    runtimeCtx,
    state,
    employeeId: employee.employee_id,
  });

  if (attachmentsRequireGatewayLane(runtimeCtx, runScope)) {
    if (taskRunId) {
      await repos.taskRuns.updateStatus(
        taskRunId,
        'failed',
        JSON.stringify({ content: 'attachments-require-gateway-lane' }),
      );
      eventBus.emit(
        taskStateChanged(
          companyId,
          taskRunId,
          'queued',
          'failed',
          threadId,
          employee.employee_id,
          'employee',
          employee.name,
        ),
      );
    }
    return {
      kind: 'early-return',
      stateUpdate: {
        ...attachmentGatewayLaneOutcomeState(state),
        currentEmployeeId: employee.employee_id,
        currentTaskRunId: taskRunId ?? null,
      },
    };
  }

  const rawTaskDescription =
    ((assignment.inputJson as Record<string, unknown>).description as string) ?? '';
  const taskDescription = resolveAttachmentAwareTaskDescription(rawTaskDescription, runScope);
  const taskToolIntent = state.taskToolIntent ?? detectTaskToolIntent(taskDescription);

  if (localToolsRequireGatewayLane(runtimeCtx, taskToolIntent)) {
    if (taskRunId) {
      await repos.taskRuns.updateStatus(
        taskRunId,
        'failed',
        JSON.stringify({ content: 'local-tools-require-gateway-lane' }),
      );
      eventBus.emit(
        taskStateChanged(
          companyId,
          taskRunId,
          'queued',
          'failed',
          threadId,
          employee.employee_id,
          'employee',
          employee.name,
        ),
      );
    }
    return {
      kind: 'early-return',
      stateUpdate: {
        ...localToolsGatewayLaneOutcomeState(state, taskToolIntent),
        currentEmployeeId: employee.employee_id,
        currentTaskRunId: taskRunId ?? null,
      },
    };
  }

  let resolved: ResolvedModel;
  try {
    resolved = resolveEmployeeModel(runtimeCtx, employee);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (taskRunId) {
      await repos.taskRuns.updateStatus(
        taskRunId,
        'failed',
        JSON.stringify({ content: message, errorCode: 'invalid_employee_model_override' }),
      );
      eventBus.emit(
        taskStateChanged(
          companyId,
          taskRunId,
          'queued',
          'failed',
          threadId,
          employee.employee_id,
          'employee',
          employee.name,
        ),
      );
    }
    return {
      kind: 'early-return',
      stateUpdate: {
        pendingAssignments: remaining,
        currentEmployeeId: employee.employee_id,
        currentTaskRunId: taskRunId ?? null,
        currentStepOutputs: taskRunId
          ? [
              ...state.currentStepOutputs,
              {
                employeeId: employee.employee_id,
                employeeName: employee.name,
                sourceKind: 'employee',
                roleSlug: employee.role_slug,
                content: `Incomplete: ${message}`,
                taskRunId,
                stepIndex,
                isExternal: employee.is_external === 1,
                brandKey: employee.brand_key ?? null,
                citations: [],
              },
            ]
          : state.currentStepOutputs,
      },
    };
  }

  eventBus.emit(
    employeeStateChanged(companyId, employee.employee_id, 'idle', 'executing', threadId, taskRunId),
  );

  const myAssignments = state.pendingAssignments.filter(
    (a) => a.employeeId === employee.employee_id,
  );
  const myRemaining = remaining.filter((a) => a.employeeId === employee.employee_id);
  const totalAssignments = myAssignments.length;
  const completedSoFar = totalAssignments - myRemaining.length - 1;
  const taskLabel =
    ((assignment.inputJson as Record<string, unknown>).description as string)?.slice(0, 60) ??
    'Task';

  if (taskRunId) {
    await repos.taskRuns.updateStatus(taskRunId, 'running');
    eventBus.emit(
      taskStateChanged(
        companyId,
        taskRunId,
        'queued',
        'running',
        threadId,
        employee.employee_id,
        'employee',
        employee.name,
      ),
    );
  }

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
      { employeeId: employee.employee_id, assigneeKind: 'employee', assigneeName: employee.name },
    ),
  );

  const requiredSkillsRaw = (assignment.inputJson as Record<string, unknown>).requiredSkills;
  const requiredSkills = Array.isArray(requiredSkillsRaw)
    ? (requiredSkillsRaw as unknown[]).filter(
        (skill): skill is string => typeof skill === 'string' && skill.trim().length > 0,
      )
    : [];
  const memoryPolicy = runtimeCtx.runtimePolicy?.memory;
  const toolSearchEnabled = runtimeCtx.runtimePolicy?.toolSearch.enabled ?? true;

  return {
    kind: 'continue',
    preflight: {
      assignment,
      remaining,
      employee,
      company,
      activeContextSnapshot,
      taskRunId,
      stepIndex,
      taskLabel,
      totalAssignments,
      completedSoFar,
      isDirectChatTask,
      resolved,
      taskDescription,
      requiredSkills,
      memoryPolicy,
      toolSearchEnabled,
    },
  };
}
