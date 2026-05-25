import { useUiState } from '@/app/ui-state.js';
import { LiveRunAxis } from '@/assistant/parts/LiveRunAxis.js';
import { RunPipelinePill } from '@/assistant/parts/RunPipelinePill.js';
import { useRunStore } from '@/assistant/run-store.js';
import { useRunCost } from '@/data/queries.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { Bell, Box, Coins, LayoutPanelTop, Radio, SquareStack } from 'lucide-react';
import { Suspense } from 'react';
import { BoardView } from './scene/BoardView.js';
import { OfficeScene2D } from './scene/OfficeScene2D.js';
import { OfficeScene3D } from './scene/OfficeScene3D.js';

const UNREAD = 2;

export function OfficeStage() {
  const stageRunAxis = useUiState((s) => s.stageRunAxis);
  const toggleStageRunAxis = useUiState((s) => s.toggleStageRunAxis);
  const sceneRenderMode = useUiState((s) => s.sceneRenderMode);
  const setSceneRenderMode = useUiState((s) => s.setSceneRenderMode);

  const runCost = useRunCost();
  const isRunning = useRunStore((s) => s.isRunning);

  return (
    <section className={cn('off-stage', isRunning && 'is-live')}>
      {/* The scene is always the base layer; run-axis entries overlay it. */}
      <div className="off-scene-host">
        {sceneRenderMode === '3d' ? (
          <Suspense fallback={<div className="off-scene-loading">Loading scene…</div>}>
            <OfficeScene3D />
          </Suspense>
        ) : (
          <OfficeScene2D />
        )}
      </div>

      {stageRunAxis === 'board' ? (
        <div className="off-stage-overlay off-stage-board">
          <BoardView />
        </div>
      ) : null}

      {stageRunAxis === 'live' ? (
        <div className="off-stage-overlay off-stage-live">
          <LiveRunAxis />
        </div>
      ) : null}

      {/* Pipeline pill: always present while a run is live (Stop lives here). */}
      <RunPipelinePill />

      {/* stage-mode (left): 3D / 2D render toggle. */}
      <div className="off-stage-float off-stage-mode">
        <button
          type="button"
          className={cn('off-stage-entry off-focusable', sceneRenderMode === '3d' && 'is-on')}
          onClick={() => setSceneRenderMode('3d')}
        >
          <Icon icon={Box} size="sm" />
          3D
        </button>
        <button
          type="button"
          className={cn('off-stage-entry off-focusable', sceneRenderMode === '2d' && 'is-on')}
          onClick={() => setSceneRenderMode('2d')}
        >
          <Icon icon={LayoutPanelTop} size="sm" />
          2D
        </button>
      </div>

      {/* stage-runaxis (center): Board + Live overlays on top of the scene. */}
      <div className="off-stage-float off-stage-runaxis">
        <button
          type="button"
          className={cn('off-stage-entry off-focusable', stageRunAxis === 'board' && 'is-on')}
          onClick={() => toggleStageRunAxis('board')}
        >
          <Icon icon={SquareStack} size="sm" />
          Board
        </button>
        <button
          type="button"
          className={cn('off-stage-entry off-focusable', stageRunAxis === 'live' && 'is-on')}
          onClick={() => toggleStageRunAxis('live')}
        >
          <span className={cn('off-stage-livedot', isRunning && 'is-on')} />
          <Icon icon={Radio} size="sm" />
          Live
        </button>
      </div>

      {/* Diegetic cost readout + notifications, on the scene border. */}
      <div className={cn('off-scene-cost', isRunning && 'is-live')}>
        <span className="off-sc-readout">
          <span className="off-sc-beat">
            <Icon icon={Coins} size="sm" />
            <b>{runCost.data ? runCost.data.tokens.toLocaleString() : '0'}</b> tok
          </span>
          <span className="off-sc-div" />
          <b>{runCost.data?.costLabel ?? '$0.00'}</b>
          {isRunning ? (
            <>
              <span className="off-sc-div" />
              <span className="off-sc-live">live</span>
            </>
          ) : null}
        </span>
        <button
          type="button"
          className="off-sc-notif has-unread off-focusable"
          aria-label={`Notifications (${UNREAD} unread)`}
        >
          <Icon icon={Bell} size="sm" />
          <span className="off-sc-notif-count">{UNREAD}</span>
        </button>
      </div>
    </section>
  );
}
