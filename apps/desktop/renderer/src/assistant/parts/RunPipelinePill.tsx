import { useEmployees } from '@/data/queries.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { Square } from 'lucide-react';
import { useMemo } from 'react';
import { useRunStore } from '../run-store.js';

/**
 * The diegetic run-axis pill floating on the Office stage while a run is live:
 * the work title, who holds it, a step progress bar, the 5-stage ceremony, and
 * the Stop control. Losing this bar is the prototype's documented rev-risk — it
 * is the only place the run is visible and the only way to stop it — so it is
 * always present while `isRunning`.
 */
export function RunPipelinePill() {
  const isRunning = useRunStore((s) => s.isRunning);
  const pipeline = useRunStore((s) => s.pipeline);
  const stop = useRunStore((s) => s.stop);
  const employees = useEmployees();

  const assignee = useMemo(
    () => employees.data?.find((e) => e.id === pipeline?.assigneeId),
    [employees.data, pipeline?.assigneeId],
  );

  if (!isRunning || !pipeline) return null;

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
      <span className="off-pipe-bar" aria-hidden>
        <span
          className="off-pipe-bar-fill"
          style={{ width: `${(pipeline.stepDone / pipeline.stepTotal) * 100}%` }}
        />
      </span>
      <button type="button" className="off-pipe-stop off-focusable" onClick={stop}>
        <Icon icon={Square} size="sm" />
        Stop
      </button>
    </div>
  );
}
