import type { ResolvedModel, RuntimeMemoryPolicy, RuntimeSkillConfig } from '@offisim/shared-types';
import { parseEmployeeConfig } from '@offisim/shared-types';
import { GraphError } from '../errors.js';
import {
  employeeStateChanged,
  graphNodeEntered,
  taskStateChanged,
  taskSubtaskProgress,
} from '../events/event-factories.js';
import type { OffisimGraphState, PendingAssignment } from '../graph/state.js';
import type { CompanyRow, EmployeeRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';

// Phase B inlines these skill helpers; Phase C will move them to
// employee-prompt-assembly.ts and have preflight import them from there.
function parseRuntimeSkillConfig(configJson: string | null): RuntimeSkillConfig | null {
  const config = parseEmployeeConfig(configJson);
  if (!config.runtimeSkill || config.runtimeSkill.enabled === false) return null;
  return config.runtimeSkill;
}

function normalizeSkillText(value: string): string {
  return value.trim().toLowerCase();
}

function taskHasSkillMismatch(
  requiredSkills: string[],
  runtimeSkill: RuntimeSkillConfig | null,
): boolean {
  if (requiredSkills.length === 0) return false;
  if (!runtimeSkill) return true;
  const haystack = [
    runtimeSkill.skillName,
    runtimeSkill.summary,
    ...(runtimeSkill.capabilityIndex?.requiredCapabilities ?? []),
    ...(runtimeSkill.capabilityIndex?.capabilities ?? []).map(
      (cap) => cap.label ?? cap.key ?? cap.kind ?? '',
    ),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(normalizeSkillText)
    .join(' ');

  return !requiredSkills.some((skill) => haystack.includes(normalizeSkillText(skill)));
}

export interface PreflightResult {
  readonly assignment: PendingAssignment;
  readonly remaining: PendingAssignment[];
  readonly employee: EmployeeRow;
  readonly company: CompanyRow;
  readonly taskRunId: string | undefined;
  readonly taskLabel: string;
  readonly totalAssignments: number;
  readonly completedSoFar: number;
  readonly isDirectChatTask: boolean;
  readonly resolved: ResolvedModel;
  readonly taskDescription: string;
  readonly requiredSkills: string[];
  readonly runtimeSkill: RuntimeSkillConfig | null;
  readonly memoryPolicy: RuntimeMemoryPolicy | undefined;
  readonly toolSearchEnabled: boolean;
}

export type PreflightOutcome =
  | { kind: 'early-return'; stateUpdate: Partial<OffisimGraphState> }
  | { kind: 'continue'; preflight: PreflightResult };

/**
 * Pre-LLM setup pipeline for the employee node:
 *  1. Emit `graph.node.entered`
 *  2. Pop the first pending assignment (early return if none)
 *  3. Load employee + company (early return if employee deleted mid-run)
 *  4. Emit `employee.state.changed(idle→executing)` + `task.state.changed(queued→running)` + `task.subtask.progress(running)`
 *  5. Resolve model, derive task metadata, parse runtime skill, emit `skill_mismatch` if needed
 */
export async function runPreflight(
  state: OffisimGraphState,
  runtimeCtx: RuntimeContext,
): Promise<PreflightOutcome> {
  runtimeCtx.eventBus.emit(graphNodeEntered(runtimeCtx.companyId, state.threadId, 'employee'));

  const { modelResolver, repos, eventBus, companyId, threadId } = runtimeCtx;

  const remaining = [...state.pendingAssignments];
  const assignment = remaining.shift();

  if (!assignment) {
    return { kind: 'early-return', stateUpdate: { pendingAssignments: [], completed: true } };
  }

  const isDirectChatTask = assignment.taskType === 'direct_chat';

  const taskRunId = (assignment.inputJson as Record<string, unknown>).taskRunId as
    | string
    | undefined;

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

  const resolved = modelResolver.resolve(null, employee.role_slug);
  const taskDescription =
    ((assignment.inputJson as Record<string, unknown>).description as string) ?? '';
  const requiredSkillsRaw = (assignment.inputJson as Record<string, unknown>).requiredSkills;
  const requiredSkills = Array.isArray(requiredSkillsRaw)
    ? (requiredSkillsRaw as unknown[]).filter(
        (skill): skill is string => typeof skill === 'string' && skill.trim().length > 0,
      )
    : [];
  const runtimeSkill = parseRuntimeSkillConfig(employee.config_json);
  const memoryPolicy = runtimeCtx.runtimePolicy?.memory;
  const toolSearchEnabled = runtimeCtx.runtimePolicy?.toolSearch.enabled ?? true;

  if (taskHasSkillMismatch(requiredSkills, runtimeSkill)) {
    await appendAgentEvent(runtimeCtx, {
      projectId: state.projectId,
      threadId: state.threadId,
      agentName: employee.employee_id,
      eventType: 'skill_mismatch',
      payload: {
        taskRunId,
        employeeId: employee.employee_id,
        employeeSkill: runtimeSkill?.skillName ?? null,
        requiredSkills,
      },
    });
  }

  return {
    kind: 'continue',
    preflight: {
      assignment,
      remaining,
      employee,
      company,
      taskRunId,
      taskLabel,
      totalAssignments,
      completedSoFar,
      isDirectChatTask,
      resolved,
      taskDescription,
      requiredSkills,
      runtimeSkill,
      memoryPolicy,
      toolSearchEnabled,
    },
  };
}
