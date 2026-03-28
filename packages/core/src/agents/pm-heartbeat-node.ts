import type { RunnableConfig } from '@langchain/core/runnables';
import { graphNodeEntered } from '../events/event-factories.js';
import type { OffisimGraphState } from '../graph/state.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { getRuntime } from '../utils/get-runtime.js';

/**
 * PM Heartbeat node — proactive progress check.
 *
 * Triggered periodically when entryMode === 'heartbeat'.
 * Key principle: no change = no event, no LLM call.
 *
 * 1. Query project progress (completed steps vs total)
 * 2. Compare with last heartbeat — if no change, return early
 * 3. If stuck tasks detected, emit alert event
 * 4. If all done, emit completion summary
 */
export async function pmHeartbeatNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  const runtimeCtx = getRuntime(config, 'pm_heartbeat', { optional: true });
  if (!runtimeCtx) return {};

  runtimeCtx.eventBus.emit(graphNodeEntered(runtimeCtx.companyId, state.threadId, 'pm_heartbeat'));

  const { repos } = runtimeCtx;
  const plan = state.taskPlan;

  // No plan = nothing to monitor
  if (!plan || plan.steps.length === 0) return {};

  const completedCount = (state.completedStepIndices ?? []).length;
  const totalSteps = plan.steps.length;
  const dispatchedCount = (state.dispatchedStepIndices ?? []).length;
  const currentProgress = `${completedCount}/${totalSteps} steps`;

  // Check for stuck tasks — tasks in 'running' status for too long
  const stuckTasks: string[] = [];
  const taskRuns = await repos.taskRuns.findByThread(state.threadId);
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  for (const tr of taskRuns) {
    if (tr.status === 'running' && tr.started_at < fiveMinAgo) {
      stuckTasks.push(tr.task_run_id);
    }
  }

  // No-op detection: compare with last heartbeat
  if (repos.agentEvents) {
    const lastHeartbeats = await repos.agentEvents.findByAgent('pm', {
      eventType: 'heartbeat',
      limit: 1,
    });
    if (lastHeartbeats.length > 0) {
      const lastHeartbeat = lastHeartbeats[0];
      if (lastHeartbeat?.payload_json) {
        try {
          const lastPayload = JSON.parse(lastHeartbeat.payload_json) as Record<string, unknown>;
          if (lastPayload.progress === currentProgress && stuckTasks.length === 0) {
            // No change since last heartbeat — stay silent
            return {};
          }
        } catch {
          /* proceed with event */
        }
      }
    }
  }

  // Determine recommendation
  let recommendation: string;
  const blockers: string[] = [];
  if (completedCount >= totalSteps) {
    recommendation = 'completed';
  } else if (stuckTasks.length > 0) {
    recommendation = 'needs_attention';
    blockers.push(...stuckTasks.map((id) => `stuck_task:${id}`));
  } else if (dispatchedCount > completedCount) {
    recommendation = 'in_progress';
  } else {
    recommendation = 'on_track';
  }

  // Write heartbeat event
  await appendAgentEvent(runtimeCtx, {
    projectId: state.projectId,
    threadId: state.threadId,
    agentName: 'pm',
    eventType: 'heartbeat',
    payload: {
      projectId: state.projectId,
      progress: currentProgress,
      stuckTasks,
      blockers,
      recommendation,
      completedStepIndices: state.completedStepIndices ?? [],
      dispatchedStepIndices: state.dispatchedStepIndices ?? [],
    },
  });

  return {};
}
