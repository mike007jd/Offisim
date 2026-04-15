import type { RunnableConfig } from '@langchain/core/runnables';
import {
  graphNodeEntered,
  planStepStarted,
  taskAssignmentChanged,
  taskAssignmentDispatched,
  taskStateChanged,
} from '../events/event-factories.js';
import type { OffisimGraphState, PendingAssignment, PlanStep } from '../graph/state.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { generateId } from '../utils/generate-id.js';
import { getRuntime } from '../utils/get-runtime.js';

/**
 * Step dispatcher node — DAG-aware dispatch.
 *
 * Instead of dispatching only `currentStepIndex`, this node inspects ALL
 * steps and dispatches tasks from every step whose dependencies are satisfied
 * and which has not yet been dispatched. This enables independent steps to
 * run concurrently within the queue.
 *
 * Backward compatibility: plans without `dependsOnSteps` are treated as
 * sequential (each step implicitly depends on the previous). In that case,
 * steps dispatch one at a time in index order, identical to the old behavior.
 */
export async function stepDispatcherNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  const runtimeCtx = getRuntime(config, 'step_dispatcher');

  // Announce node entry
  runtimeCtx.eventBus.emit(
    graphNodeEntered(runtimeCtx.companyId, state.threadId, 'step_dispatcher'),
  );

  const { repos, eventBus, companyId, threadId } = runtimeCtx;
  const plan = state.taskPlan;

  if (!plan || plan.steps.length === 0) {
    return { pendingAssignments: [], currentStepOutputs: [] };
  }

  const completedSteps = new Set(state.completedStepIndices ?? []);
  const dispatchedSteps = new Set(state.dispatchedStepIndices ?? []);
  const totalSteps = plan.steps.length;

  // Determine whether this plan uses explicit DAG annotations.
  // A plan is "DAG-annotated" if ANY step has a dependsOnSteps property defined
  // (even an empty array), meaning the PM intentionally annotated this plan for DAG dispatch.
  // Legacy plans (field absent/undefined on all steps) fall back to sequential behaviour.
  const isDagAnnotated = plan.steps.some((s) => s.dependsOnSteps !== undefined);

  /**
   * A step is "ready" when:
   * 1. It has not already been dispatched.
   * 2. It has not already completed.
   * 3. All its declared dependencies are in completedSteps.
   *
   * For plans WITHOUT explicit DAG annotations (legacy / sequential):
   *   - A step is ready only if ALL steps with a lower index are completed.
   *   - This reproduces the old one-step-at-a-time behaviour exactly.
   */
  function isReady(step: PlanStep): boolean {
    if (completedSteps.has(step.stepIndex)) return false;
    if (dispatchedSteps.has(step.stepIndex)) return false;

    if (isDagAnnotated) {
      // Explicit DAG: respect declared dependencies only.
      const deps = step.dependsOnSteps ?? [];
      return deps.every((dep) => completedSteps.has(dep));
    }
    // Implicit sequential: every step before this one must be complete.
    return step.stepIndex === 0
      ? true
      : Array.from({ length: step.stepIndex }, (_, i) => i).every((i) => completedSteps.has(i));
  }

  const readySteps = plan.steps.filter(isReady);

  if (readySteps.length === 0) {
    // No steps ready — should not normally happen. Return empty to avoid infinite loops.
    return { pendingAssignments: [], currentStepOutputs: [] };
  }

  const pendingAssignments: PendingAssignment[] = [];
  const newlyDispatchedIndices = [...(state.dispatchedStepIndices ?? [])];

  for (const currentStep of readySteps) {
    const stepIdx = currentStep.stepIndex;

    // Build dependency output text for tasks that need it.
    // In DAG mode: concatenate outputs from all declared dependency steps.
    // In sequential mode: use the immediately preceding step.
    let previousStepOutput = '';
    if (isDagAnnotated) {
      const deps = currentStep.dependsOnSteps ?? [];
      if (deps.length > 0) {
        const depOutputs = state.stepResults
          .filter((r) => deps.includes(r.stepIndex))
          .flatMap((r) => r.outputs)
          .map((o) => `[${o.employeeName}]: ${o.content}`)
          .join('\n\n');
        previousStepOutput = depOutputs;
      }
    } else if (stepIdx > 0 && state.stepResults.length > 0) {
      const prevResult = state.stepResults.find((r) => r.stepIndex === stepIdx - 1);
      if (prevResult) {
        previousStepOutput = prevResult.outputs
          .map((o) => `[${o.employeeName}]: ${o.content}`)
          .join('\n\n');
      }
    }

    for (const task of currentStep.tasks) {
      const taskRunId = task.taskRunId;

      // Update taskRun status from 'planned' to 'queued'
      if (taskRunId) {
        await repos.taskRuns.updateStatus(taskRunId, 'queued');
        eventBus.emit(
          taskStateChanged(
            companyId,
            taskRunId,
            'planned',
            'queued',
            threadId,
            task.assigneeKind === 'employee' ? task.employeeId : undefined,
            task.assigneeKind,
            task.assigneeName,
          ),
        );
        eventBus.emit(
          taskAssignmentChanged(companyId, taskRunId, task.employeeId, 'assigned', threadId, {
            employeeId: task.assigneeKind === 'employee' ? task.employeeId : undefined,
            assigneeKind: task.assigneeKind,
            assigneeName: task.assigneeName,
          }),
        );
      }

      // Emit dispatched event for scene choreography
      const emp =
        task.assigneeKind === 'employee'
          ? await repos.employees.findById(task.employeeId).catch(() => null)
          : null;
      const assigneeName = task.assigneeName ?? emp?.name ?? task.employeeId;
      eventBus.emit(
        taskAssignmentDispatched(
          companyId,
          task.employeeId,
          assigneeName,
          task.description,
          stepIdx,
          totalSteps,
          threadId,
          {
            employeeId: task.assigneeKind === 'employee' ? task.employeeId : undefined,
            assigneeKind: task.assigneeKind,
          },
        ),
      );

      // Build task description, optionally injecting dependency output
      let description = task.description;
      if (task.dependsOnStepOutput && previousStepOutput) {
        description = `${task.description}\n\n--- Previous step results ---\n${previousStepOutput}`;
      }

      pendingAssignments.push({
        taskType: task.taskType,
        employeeId: task.employeeId,
        assigneeKind: task.assigneeKind,
        assigneeName,
        inputJson: {
          description,
          requiredSkills: task.requiredSkills,
          taskRunId: taskRunId ?? undefined,
          stepIndex: stepIdx,
        },
      });
      await runtimeCtx.hookRegistry.emit('task.assigned', {
        threadId,
        companyId,
        stepIndex: stepIdx,
        taskRunId: taskRunId ?? null,
        employeeId: task.assigneeKind === 'employee' ? task.employeeId : undefined,
        description,
      });
    }

    // Emit planStepStarted for each dispatched step
    eventBus.emit(
      planStepStarted(companyId, plan.planId, stepIdx, currentStep.tasks.length, threadId),
    );

    newlyDispatchedIndices.push(stepIdx);
  }

  // Auto-assign dispatched employees to the project (if this execution has a projectId).
  if (state.projectId && repos.projectAssignments) {
    for (const assignment of pendingAssignments) {
      if (assignment.assigneeKind === 'department') continue;
      const isAssigned = await repos.projectAssignments.isAssigned(
        state.projectId,
        assignment.employeeId,
      );
      if (!isAssigned) {
        await repos.projectAssignments.assign({
          assignment_id: generateId('pa'),
          project_id: state.projectId,
          employee_id: assignment.employeeId,
          role: 'member',
        });
      }
    }
  }

  // Update currentStepIndex to the lowest dispatched step (for backward compat
  // with any code that still reads currentStepIndex for display purposes).
  const lowestReadyIdx = Math.min(...readySteps.map((s) => s.stepIndex));

  await appendAgentEvent(runtimeCtx, {
    projectId: state.projectId,
    threadId: state.threadId,
    agentName: 'pm',
    eventType: 'action',
    payload: {
      action: 'dispatch',
      readyStepCount: readySteps.length,
      readyStepIndices: readySteps.map((s) => s.stepIndex),
      assignmentCount: pendingAssignments.length,
    },
  });

  pendingAssignments.sort((left, right) => {
    if (left.assigneeKind === right.assigneeKind) return 0;
    return left.assigneeKind === 'department' ? -1 : 1;
  });

  return {
    pendingAssignments,
    currentStepOutputs: [],
    dispatchedStepIndices: newlyDispatchedIndices,
    currentStepIndex: lowestReadyIdx,
  };
}
