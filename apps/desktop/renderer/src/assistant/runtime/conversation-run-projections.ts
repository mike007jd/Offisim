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

  // `employee = stable identity, AgentRun = transient instance`: key strictly by
  // employeeId so concurrent runs on one employee collapse to one entry (never a
  // duplicate). 'working' wins over 'waiting' and never downgrades, so a later
  // run can't clobber an employee already lit by an active one.
  const light = (
    employeeId: string,
    threadId: string,
    attemptId: string | null,
    state: 'working' | 'waiting',
  ) => {
    if (states.get(employeeId)?.state === 'working') return;
    states.set(employeeId, { threadId, attemptId, state });
  };

  for (const run of snapshot.runs) {
    if (run.projectId !== projectId) continue;
    if (!isConversationRunActive(run.phase)) continue;
    if (run.employeeId) {
      light(
        run.employeeId,
        run.threadId,
        run.attemptId,
        run.phase === 'awaiting-approval' ? 'waiting' : 'working',
      );
    }
    // Delegated child runs still in flight light up their teammate too — this is
    // what makes the office show multiple agents working in parallel.
    for (const delegation of run.delegations) {
      if (delegation.state === 'running' && delegation.employeeId) {
        light(delegation.employeeId, run.threadId, run.attemptId, 'working');
      }
    }
  }
  return states;
}
