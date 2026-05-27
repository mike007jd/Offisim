import { useUiState } from '@/app/ui-state.js';
import { RunPipelinePill } from '@/assistant/parts/RunPipelinePill.js';
import { useRunStore } from '@/assistant/run-store.js';
import { useRunCost } from '@/data/queries.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { Bell, Box, Coins, LayoutPanelTop, Radio } from 'lucide-react';
import { Suspense } from 'react';
import { OfficeScene2D } from './scene/OfficeScene2D.js';
import { OfficeScene3D } from './scene/OfficeScene3D.js';

export function OfficeStage() {
  const sceneRenderMode = useUiState((s) => s.sceneRenderMode);
  const setSceneRenderMode = useUiState((s) => s.setSceneRenderMode);
  const setSurface = useUiState((s) => s.setSurface);

  const runCost = useRunCost();
  const isRunning = useRunStore((s) => s.isRunning);

  return (
    <section className={cn('off-stage', isRunning && 'is-live')}>
      <div className="off-scene-host">
        {sceneRenderMode === '3d' ? (
          <Suspense fallback={<div className="off-scene-loading">Loading scene…</div>}>
            <OfficeScene3D />
          </Suspense>
        ) : (
          <OfficeScene2D />
        )}
      </div>

      {/* Pipeline pill: always present while a run is live (Stop lives here). */}
      <RunPipelinePill />

      {/* stage-mode (left): 3D / 2D render toggle. */}
      <div className="off-stage-float off-stage-mode">
        <button
          type="button"
          className={cn('off-stage-mode-btn off-focusable', sceneRenderMode === '3d' && 'is-on')}
          onClick={() => setSceneRenderMode('3d')}
        >
          <Icon icon={Box} size="sm" />
          3D
        </button>
        <button
          type="button"
          className={cn('off-stage-mode-btn off-focusable', sceneRenderMode === '2d' && 'is-on')}
          onClick={() => setSceneRenderMode('2d')}
        >
          <Icon icon={LayoutPanelTop} size="sm" />
          2D
        </button>
      </div>

      {/* stage status (center): run state + token/cost readout. */}
      <div className="off-stage-float off-stage-statusbar">
        <div className="off-stage-status" aria-label="Run status and token cost">
          <span className={cn('off-stage-livedot', isRunning && 'is-on')} />
          <Icon icon={Radio} size="sm" />
          <span>{isRunning ? 'Running' : 'Idle'}</span>
          <span className="off-stage-status-div" />
          <span>{runCost.data ? runCost.data.tokens.toLocaleString() : '0'} tok</span>
          <span>{runCost.data?.costLabel ?? '$0.00'}</span>
        </div>
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
          aria-label="Open Activity Log"
          title="Open Activity Log"
          onClick={() => setSurface('activity')}
        >
          <Icon icon={Bell} size="sm" />
        </button>
      </div>
    </section>
  );
}
