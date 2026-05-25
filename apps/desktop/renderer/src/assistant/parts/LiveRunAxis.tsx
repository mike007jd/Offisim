import { useEmployees } from '@/data/queries.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { Activity, Radio } from 'lucide-react';
import { useMemo } from 'react';
import { useRunStore } from '../run-store.js';

/**
 * The Live run-axis broadcast: when the boss opens "Live" on the stage, the run
 * is broadcast over the scene as a Plan ladder + Activity feed. It reads the
 * same run-state store as the pipeline pill, so the broadcast and the pill stay
 * in lockstep. When nothing is running it shows the idle hint rather than a
 * blank panel.
 */
export function LiveRunAxis() {
  const isRunning = useRunStore((s) => s.isRunning);
  const pipeline = useRunStore((s) => s.pipeline);
  const employees = useEmployees();
  const byId = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  );

  return (
    <div className="off-live">
      <header className="off-live-head">
        <span className={cn('off-live-beacon', isRunning && 'is-on')}>
          <Icon icon={Radio} size="sm" />
        </span>
        <span className="off-live-title">{isRunning ? 'Live run' : 'No active run'}</span>
        {pipeline ? <span className="off-live-sub">{pipeline.title}</span> : null}
      </header>

      {isRunning && pipeline ? (
        <>
          <section className="off-live-sec">
            <CapsLabel>Plan</CapsLabel>
            <div className="off-live-plan">
              {pipeline.stages.map((stage) => (
                <div key={stage.id} className={cn('off-live-step', `is-${stage.state}`)}>
                  <span className="off-live-step-dot" />
                  <span className="off-live-step-label">{stage.label}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="off-live-sec">
            <CapsLabel>Activity</CapsLabel>
            <div className="off-live-act">
              <div className="off-live-act-row">
                {pipeline.assigneeId && byId.get(pipeline.assigneeId) ? (
                  <EmployeeAvatar
                    seed={pipeline.assigneeId}
                    appearance={byId.get(pipeline.assigneeId)?.appearance}
                    colorA={byId.get(pipeline.assigneeId)?.avatarA ?? '#888'}
                    colorB={byId.get(pipeline.assigneeId)?.avatarB ?? '#555'}
                    size={18}
                  />
                ) : null}
                <Icon icon={Activity} size="sm" className="off-live-act-icon" />
                <span>
                  Working step {pipeline.stepDone} of {pipeline.stepTotal}
                </span>
              </div>
            </div>
          </section>
        </>
      ) : (
        <p className="off-live-idle">Open Live during a run to watch the plan and activity here.</p>
      )}
    </div>
  );
}
