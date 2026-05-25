import { useUiState } from '@/app/ui-state.js';
import { useEmployees, useRunCost, useThreads } from '@/data/queries.js';
import { BlockAvatar } from '@/design-system/grammar/BlockAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn, initialsOf } from '@/lib/utils.js';
import { Coins, LayoutPanelTop, Radio, Sparkles } from 'lucide-react';

export function OfficeStage() {
  const projectId = useUiState((s) => s.projectId);
  const stageMode = useUiState((s) => s.stageMode);
  const setStageMode = useUiState((s) => s.setStageMode);
  const runPanel = useUiState((s) => s.runPanel);
  const toggleRunPanel = useUiState((s) => s.toggleRunPanel);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const openThread = useUiState((s) => s.openThread);

  const employees = useEmployees();
  const threads = useThreads(projectId);
  const runCost = useRunCost();

  const liveThread = threads.data?.find((t) => t.runState === 'running');
  const isLive = Boolean(liveThread);

  return (
    <section className={cn('off-stage', isLive && 'is-live')}>
      <div className="off-scene-wrap">
        <div className="off-scene">
          <div className="off-scene-grid">
            {employees.data?.map((employee) => {
              const thread = threads.data?.find((t) => t.employeeId === employee.id);
              const running =
                thread?.runState === 'running' || (liveThread?.scope === 'team' && employee.online);
              const active = thread?.id === selectedThreadId;
              return (
                <button
                  type="button"
                  key={employee.id}
                  className={cn(
                    'off-desk off-focusable',
                    active && 'is-active',
                    running && 'is-running',
                  )}
                  onClick={() => (thread ? openThread(thread.id) : undefined)}
                >
                  <BlockAvatar
                    initials={initialsOf(employee.name)}
                    colorA={employee.avatarA}
                    colorB={employee.avatarB}
                    size={48}
                    brand={employee.kind === 'external'}
                  />
                  <span className="off-desk-name">{employee.name}</span>
                  <span className="off-desk-role">{employee.role}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="off-stage-float off-stage-mode">
        <button
          type="button"
          className={cn('off-stage-entry off-focusable', stageMode === 'scene' && 'is-on')}
          onClick={() => setStageMode('scene')}
        >
          <Icon icon={Sparkles} size="sm" />
          Scene
        </button>
        <button
          type="button"
          className={cn('off-stage-entry off-focusable', stageMode === 'board' && 'is-on')}
          onClick={() => setStageMode('board')}
        >
          <Icon icon={LayoutPanelTop} size="sm" />
          Board
        </button>
      </div>

      <div className="off-stage-float off-stage-runaxis">
        <button
          type="button"
          className={cn('off-stage-entry off-focusable', runPanel === 'board' && 'is-on')}
          onClick={() => toggleRunPanel('board')}
        >
          <Icon icon={LayoutPanelTop} size="sm" />
          Run board
        </button>
        <button
          type="button"
          className={cn(
            'off-stage-entry off-focusable',
            (runPanel === 'live' || isLive) && 'is-on',
          )}
          onClick={() => toggleRunPanel('live')}
        >
          {isLive ? <span className="off-stage-livedot" /> : <Icon icon={Radio} size="sm" />}
          {isLive ? 'Live' : 'Idle'}
        </button>
      </div>

      <div className={cn('off-scene-cost', runCost.data?.live && 'is-live')}>
        <span className="off-sc-readout">
          <span className="off-sc-beat">
            <Icon icon={Coins} size="sm" />
            <b>{runCost.data ? runCost.data.tokens.toLocaleString() : '0'}</b> tok
          </span>
          <span className="off-sc-div" />
          <b>{runCost.data?.costLabel ?? '$0.00'}</b>
        </span>
        <button
          type="button"
          className="off-sc-notif has-unread off-focusable"
          aria-label="Notifications"
        >
          <Icon icon={Radio} size="sm" />
        </button>
      </div>
    </section>
  );
}
