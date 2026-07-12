import { useUiState } from '@/app/ui-state.js';
import { useEmployees } from '@/data/queries.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Progress } from '@/design-system/primitives/progress.js';
import { cn } from '@/lib/utils.js';
import { useMemo } from 'react';
import { conversationRunController } from '../runtime/conversation-run-controller.js';
import {
  useActiveConversationRuns,
  usePendingConversationApprovals,
} from '../runtime/conversation-run-react.js';

type StageState = 'done' | 'active' | 'pending';

function stageState(active: boolean, done: boolean): StageState {
  if (active) return 'active';
  return done ? 'done' : 'pending';
}

/** Compact run chip for the Stage top bar. It owns the global run projection,
 * so Office and Workspace runs share one Stop control and progress surface. */
export function RunPipelinePill() {
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const companyId = useUiState((s) => s.companyId);
  usePendingConversationApprovals(companyId || null);
  const runs = useActiveConversationRuns();
  const employees = useEmployees();

  const run = useMemo(
    () =>
      runs.activeRuns.find((candidate) => candidate.threadId === selectedThreadId) ??
      runs.activeRuns[0] ??
      null,
    [runs.activeRuns, selectedThreadId],
  );

  const assignee = useMemo(
    () => employees.data?.find((e) => e.id === run?.employeeId),
    [employees.data, run?.employeeId],
  );

  if (!run) return null;

  const awaiting = run.phase === 'awaiting-approval';
  const preparing = run.phase === 'preparing';
  const running = run.phase === 'running';
  const stages = [
    { id: 'prepare', label: 'Prepare', state: stageState(preparing, !preparing) },
    { id: 'work', label: 'Work', state: stageState(running, awaiting) },
    { id: 'approval', label: 'Approval', state: stageState(awaiting, false) },
    { id: 'response', label: 'Response', state: 'pending' as StageState },
  ];
  const completedStages = stages.filter((stage) => stage.state === 'done').length;
  const progressValue = Math.min(100, Math.max(0, (completedStages / stages.length) * 100));
  const title = awaiting
    ? 'Waiting for approval'
    : run.source === 'workspace'
      ? 'Workspace reply'
      : 'Chat reply';

  return (
    <div className="off-pipe" aria-live="polite">
      <span className="off-pipe-flow">
        {stages.map((stage) => (
          <span
            key={stage.id}
            className={cn('off-pipe-stage', `is-${stage.state}`)}
            title={stage.state === 'active' ? undefined : stage.label}
            aria-label={`${stage.label}: ${stage.state}`}
          >
            <span className="off-pipe-dot" aria-hidden="true" />
            {stage.state === 'active' ? (
              <span className="off-pipe-stage-label">{stage.label}</span>
            ) : null}
          </span>
        ))}
      </span>
      <span className="off-pipe-div" />
      <span className="off-pipe-task">
        {assignee ? (
          <EmployeeAvatar
            seed={assignee.id}
            appearance={assignee.appearance}
            colorA={assignee.avatarA}
            colorB={assignee.avatarB}
            size={18}
            brand={assignee.kind === 'external'}
          />
        ) : null}
        <span className="off-pipe-title">{title}</span>
        <span className="off-pipe-step">
          {completedStages}/{stages.length}
        </span>
      </span>
      <Progress className="off-pipe-progress" value={progressValue} aria-label="Run progress" />
      <button
        type="button"
        className="off-pipe-stop off-focusable"
        onClick={() => conversationRunController.stop(run.threadId)}
      >
        Stop
      </button>
    </div>
  );
}
