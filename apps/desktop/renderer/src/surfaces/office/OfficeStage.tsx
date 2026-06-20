import { useUiState } from '@/app/ui-state.js';
import { RunPipelinePill } from '@/assistant/parts/RunPipelinePill.js';
import { useRunStore } from '@/assistant/run-store.js';
import { useOfficeLayout, useRunCost } from '@/data/queries.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import { Box, Coins, LayoutPanelTop, LayoutTemplate } from 'lucide-react';
import { Suspense } from 'react';
import { OfficeScene2D } from './scene/OfficeScene2D.js';
import { OfficeScene3D } from './scene/OfficeScene3D.js';
import { zoneDefsFromLayout } from './scene/scene-layout.js';

export function OfficeStage() {
  const sceneRenderMode = useUiState((s) => s.sceneRenderMode);
  const setSceneRenderMode = useUiState((s) => s.setSceneRenderMode);
  const setSurface = useUiState((s) => s.setSurface);
  const companyId = useUiState((s) => s.companyId);

  const runCost = useRunCost();
  const isRunning = useRunStore((s) => s.isRunning);
  // Zero zones is only reachable with a real backend layout (the no-backend
  // preview path falls back to non-empty FALLBACK_ZONES). The stage owns the
  // empty-office overlay so both render modes share one copy — and Studio,
  // which mounts OfficeScene3D directly, never sees it.
  const layout = useOfficeLayout(companyId);
  const emptyOffice = zoneDefsFromLayout(layout.data).length === 0;

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
        {emptyOffice ? (
          // Honest empty office: the scene keeps its bare floor and seats
          // nobody; this HTML overlay carries the guidance for both modes.
          <EmptyState
            icon={LayoutTemplate}
            title="No office layout yet"
            description="Open Studio to lay out your floor."
            action={{ label: 'Open Studio', onClick: () => setSurface('studio') }}
            className="off-scene-empty"
          />
        ) : null}
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

      {/* Single diegetic cost/token readout on the scene border. */}
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
      </div>
    </section>
  );
}
