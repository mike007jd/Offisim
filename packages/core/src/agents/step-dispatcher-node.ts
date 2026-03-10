import type { RunnableConfig } from '@langchain/core/runnables';
import type { AicsGraphState, PendingAssignment } from '../graph/state.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { GraphError } from '../errors.js';
import { graphNodeEntered, planStepStarted, taskStateChanged, taskAssignmentChanged } from '../events/event-factories.js';

/**
 * Step dispatcher node — reads the current step from the TaskPlan,
 * converts its tasks into PendingAssignments for the employee node,
 * updates taskRun statuses from 'planned' to 'queued', and injects
 * previous step output for tasks that depend on it.
 */
export async function stepDispatcherNode(
  state: AicsGraphState,
  config: RunnableConfig,
): Promise<Partial<AicsGraphState>> {
  const runtimeCtx = (config.configurable as { runtimeCtx: RuntimeContext }).runtimeCtx;
  if (!runtimeCtx) {
    throw new GraphError('RuntimeContext not found in config.configurable', 'step_dispatcher');
  }

  // Announce node entry
  runtimeCtx.eventBus.emit(
    graphNodeEntered(runtimeCtx.companyId, state.threadId, 'step_dispatcher'),
  );

  const { repos, eventBus, companyId, threadId } = runtimeCtx;
  const plan = state.taskPlan;

  if (!plan || plan.steps.length === 0) {
    return { pendingAssignments: [], currentStepOutputs: [] };
  }

  const stepIdx = state.currentStepIndex;
  const currentStep = plan.steps[stepIdx];

  if (!currentStep) {
    return { pendingAssignments: [], currentStepOutputs: [] };
  }

  const pendingAssignments: PendingAssignment[] = [];

  // Build previous step output text if available
  let previousStepOutput = '';
  if (stepIdx > 0 && state.stepResults.length > 0) {
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
        taskStateChanged(companyId, taskRunId, 'planned', 'queued', threadId, task.employeeId),
      );
      eventBus.emit(
        taskAssignmentChanged(companyId, taskRunId, task.employeeId, 'assigned', threadId),
      );
    }

    // Build task description, optionally injecting previous step output
    let description = task.description;
    if (task.dependsOnStepOutput && previousStepOutput) {
      description = `${task.description}\n\n--- Previous step results ---\n${previousStepOutput}`;
    }

    pendingAssignments.push({
      taskType: task.taskType,
      employeeId: task.employeeId,
      inputJson: {
        description,
        taskRunId: taskRunId ?? undefined,
      },
    });
  }

  // Emit planStepStarted event
  eventBus.emit(
    planStepStarted(companyId, plan.planId, stepIdx, currentStep.tasks.length, threadId),
  );

  return {
    pendingAssignments,
    currentStepOutputs: [],
  };
}
