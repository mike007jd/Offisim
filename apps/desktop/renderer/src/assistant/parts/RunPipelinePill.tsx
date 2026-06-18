import { useEmployees } from '@/data/queries.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Progress } from '@/design-system/primitives/progress.js';
import { cn } from '@/lib/utils.js';
import { useMemo } from 'react';
import { useRunStore } from '../run-store.js';

/**
 * The diegetic run-status pill floating on the Office stage while a run is active:
 * the work title, who holds it, a step progress bar, the 5-stage ceremony, and a
 * real Stop control that routes through the run store into the active Pi host
 * abort.
 */
export function RunPipelinePill() {
  const isRunning = useRunStore((s) => s.isRunning);
  const pipeline = useRunStore((s) => s.pipeline);
  const requestStop = useRunStore((s) => s.requestStop);
  const employees = useEmployees();

  const assignee = useMemo(
    () => employees.data?.find((e) => e.id === pipeline?.assigneeId),
    [employees.data, pipeline?.assigneeId],
  );

  if (!isRunning || !pipeline) return null;

  const progressValue = Math.min(
    100,
    Math.max(0, (pipeline.stepDone / Math.max(1, pipeline.stepTotal)) * 100),
  );

  return (
    <div className="off-pipe" aria-live="polite">
      <span className="off-pipe-flow">
        {pipeline.stages.map((stage) => (
          <span key={stage.id} className={cn('off-pipe-stage', `is-${stage.state}`)}>
            <span className="off-pipe-dot" />
            {stage.label}
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
        <span className="off-pipe-title">{pipeline.title}</span>
        <span className="off-pipe-step">
          {pipeline.stepDone}/{pipeline.stepTotal}
        </span>
      </span>
      <Progress className="off-pipe-progress" value={progressValue} aria-label="Run progress" />
      <button type="button" className="off-pipe-stop off-focusable" onClick={requestStop}>
        Stop
      </button>
    </div>
  );
}
