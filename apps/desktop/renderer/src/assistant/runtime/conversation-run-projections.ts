import {
  type ConversationRunsSnapshot,
  isConversationRunActive,
} from './conversation-run-controller.js';

export { isConversationRunActive };

export interface EmployeeRunProjection {
  threadId: string;
  attemptId: string | null;
  state: 'working' | 'waiting';
}

export function projectEmployeeRunStates(
  snapshot: ConversationRunsSnapshot,
  projectId: string | null,
): Map<string, EmployeeRunProjection> {
  const states = new Map<string, EmployeeRunProjection>();
  if (!projectId) return states;
  for (const run of snapshot.runs) {
    if (run.projectId !== projectId) continue;
    if (!run.employeeId) continue;
    if (!isConversationRunActive(run.phase)) continue;
    states.set(run.employeeId, {
      threadId: run.threadId,
      attemptId: run.attemptId,
      state: run.phase === 'awaiting-approval' ? 'waiting' : 'working',
    });
  }
  return states;
}
