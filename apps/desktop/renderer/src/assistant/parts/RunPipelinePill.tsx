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
import { runPipelinePresentation } from './run-pipeline-presentation.js';

/** Compact global run projection for Stage content headers and the Game View HUD. */
export function RunPipelinePill() {
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const companyId = useUiState((s) => s.companyId);
  usePendingConversationApprovals(companyId || null);
  const runs = useActiveConversationRuns();
  const employees = useEmployees();

  const activeRun = useMemo(
    () =>
      runs.activeRuns.find((candidate) => candidate.threadId === selectedThreadId) ??
      runs.activeRuns[0] ??
      null,
    [runs.activeRuns, selectedThreadId],
  );
  const run = activeRun;
  const presentation = runPipelinePresentation(run?.phase ?? 'idle', run?.source ?? null);

  const assignee = useMemo(
    () => employees.data?.find((e) => e.id === run?.employeeId),
    [employees.data, run?.employeeId],
  );
  if (!activeRun || presentation.phase === 'idle') return null;

  return (
    <div
      className={cn('off-pipe', 'is-live')}
      data-phase={presentation.phase}
      aria-live="polite"
      aria-label={`${presentation.phaseLabel}: ${presentation.completedStages} of ${presentation.totalStages} stages`}
    >
      <span className="off-pipe-phase">
        <span className="off-pipe-flow" aria-hidden="true">
          {presentation.stages.map((stage) => (
            <span key={stage.id} className={cn('off-pipe-stage', `is-${stage.state}`)}>
              <span className="off-pipe-dot" />
            </span>
          ))}
        </span>
        <b className="off-pipe-phase-label">{presentation.phaseLabel}</b>
      </span>
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
        <span className="off-pipe-title">{presentation.title}</span>
      </span>
      <span className="off-pipe-progress-slot">
        <Progress
          className="off-pipe-progress"
          value={presentation.progressValue}
          aria-label="Run progress"
        />
        <span className="off-pipe-step">
          {presentation.completedStages}/{presentation.totalStages}
        </span>
      </span>
      <button
        type="button"
        className="off-pipe-stop off-focusable"
        onClick={() => conversationRunController.stop(activeRun.threadId)}
      >
        Stop
      </button>
    </div>
  );
}
