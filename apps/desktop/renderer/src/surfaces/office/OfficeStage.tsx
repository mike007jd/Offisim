import { useUiState } from '@/app/ui-state.js';
import { useActiveConversationRuns } from '@/assistant/runtime/conversation-run-react.js';
import { scopeConversationRunsToCompany } from '@/assistant/runtime/conversation-run-scope.js';
import { useMissionBeats } from '@/assistant/runtime/office-dramaturgy.js';
import { useOfficeLayout, useRunCost } from '@/data/queries.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { missionRunManager } from '@/runtime/mission/mission-run-manager.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import type { MissionBeatPhase } from '@offisim/shared-types';
import {
  Box,
  CheckCircle2,
  ClipboardList,
  HandHelping,
  LayoutPanelTop,
  LayoutTemplate,
  PanelBottomClose,
  PictureInPicture2,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { Suspense, useSyncExternalStore } from 'react';
import { RecoveryPanel } from './RecoveryPanel.js';
import { WorkloadDrilldown } from './WorkloadDrilldown.js';
import { OfficeScene2D } from './scene/OfficeScene2D.js';
import { OfficeScene3D } from './scene/OfficeScene3D.js';
import { zoneDefsFromLayout } from './scene/scene-layout.js';
import { StageSessionReconciler } from './stage-viewer/StageSessionReconciler.js';
import {
  GameViewOptions,
  StageAutoOpen,
  StageTopBar,
  StageViewer,
} from './stage-viewer/StageViewer.js';

/**
 * Phase → icon for the mission-phase pill. The pill carries the projection's
 * `semanticLabel` text alongside this icon, so the mission's current meaning
 * (planning / verification / approval / failure / completion) is legible WITHOUT
 * animation — the §24.4 / §29 reduced-motion accessibility surface.
 */
const MISSION_PHASE_ICON: Record<MissionBeatPhase, typeof ClipboardList> = {
  planning: ClipboardList,
  verification: ShieldCheck,
  approval: HandHelping,
  failure: TriangleAlert,
  completion: CheckCircle2,
};

function GameViewControls() {
  const sceneRenderMode = useUiState((s) => s.sceneRenderMode);
  const setSceneRenderMode = useUiState((s) => s.setSceneRenderMode);

  return (
    <div className="off-scene-controls">
      <div className="off-stage-render-toggle" aria-label="Game view render mode">
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
      <GameViewOptions />
    </div>
  );
}

export function OfficeStage() {
  const sceneRenderMode = useUiState((s) => s.sceneRenderMode);
  const stagePrimaryTab = useUiState((s) => s.stagePrimaryTab);
  const scenePipCollapsed = useUiState((s) => s.scenePipCollapsed);
  const setScenePipCollapsed = useUiState((s) => s.setScenePipCollapsed);
  const setStagePrimaryTab = useUiState((s) => s.setStagePrimaryTab);
  const setSurface = useUiState((s) => s.setSurface);
  const companyId = useUiState((s) => s.companyId);

  const runCost = useRunCost();
  const conversationRuns = useActiveConversationRuns();
  const companyConversationRuns = scopeConversationRunsToCompany(conversationRuns, companyId);
  const activeMissionRuns = useSyncExternalStore(
    missionRunManager.subscribe,
    missionRunManager.getSnapshot,
    missionRunManager.getSnapshot,
  );
  const isRunning =
    companyConversationRuns.activeRuns.length > 0 ||
    activeMissionRuns.some((run) => run.companyId === companyId);
  // Read-only mission projection (§24.4): the latest live mission beat's phase
  // label. Empty when no mission is signaling, so a plain chat renders nothing
  // extra. The pill is a static, animation-free label — the reduced-motion
  // semantic surface; it never owns mission state or moves actors.
  const missionBeats = useMissionBeats(companyId);
  const missionPhase = missionBeats.length > 0 ? missionBeats[missionBeats.length - 1] : null;
  // Zero zones is only reachable with a real backend layout (the no-backend
  // preview path falls back to non-empty FALLBACK_ZONES). The stage owns the
  // empty-office overlay so both render modes share one copy — and Studio,
  // which mounts OfficeScene3D directly, never sees it.
  const layout = useOfficeLayout(companyId);
  const emptyOffice = zoneDefsFromLayout(layout.data).length === 0;
  const sceneIsPip = stagePrimaryTab !== 'game';
  const sceneIsCollapsed = sceneIsPip && scenePipCollapsed;

  return (
    <section className={cn('off-stage', isRunning && 'is-live')}>
      <StageTopBar
        isRunning={isRunning}
        tokensLabel={runCost.data ? runCost.data.tokens.toLocaleString() : '0'}
        costLabel={runCost.data?.costLabel ?? '$0.00'}
      />
      <div
        className={cn(
          'off-scene-host',
          stagePrimaryTab !== 'game' && 'is-pip',
          stagePrimaryTab !== 'game' && scenePipCollapsed && 'is-collapsed',
        )}
      >
        {sceneIsCollapsed ? null : sceneRenderMode === '3d' ? (
          <Suspense fallback={<div className="off-scene-loading">Loading scene…</div>}>
            <OfficeScene3D pip={sceneIsPip} />
          </Suspense>
        ) : (
          <OfficeScene2D pip={sceneIsPip} />
        )}
        <GameViewControls />
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
        {stagePrimaryTab !== 'game' ? (
          <div className="off-scene-pip-actions">
            <button
              type="button"
              className="off-scene-pip-return off-focusable"
              onClick={() => setStagePrimaryTab('game')}
              aria-label="Return to Game View"
              title="Return to Game View"
            >
              <Icon icon={PictureInPicture2} size="sm" />
              <span>Game View</span>
            </button>
            <button
              type="button"
              className="off-scene-pip-collapse off-focusable"
              onClick={() => setScenePipCollapsed(!scenePipCollapsed)}
              aria-label={scenePipCollapsed ? 'Expand scene preview' : 'Collapse scene preview'}
              title={scenePipCollapsed ? 'Expand scene preview' : 'Collapse scene preview'}
            >
              <Icon icon={scenePipCollapsed ? PictureInPicture2 : PanelBottomClose} size="sm" />
            </button>
          </div>
        ) : null}
      </div>
      <StageAutoOpen />
      <StageSessionReconciler />
      <StageViewer />

      {/* Read-only workload drilldown (INC-5): self-gates on `workloadDrilldown`
          state; opened from an office actor / workload bubble / delivery chip.
          Inspect-only — no worker-lifecycle control. */}
      <WorkloadDrilldown />

      <RecoveryPanel />

      {/* Read-only mission-phase pill (§24.4): the current mission meaning as a
          static label — legible under reduced motion, never moves an actor.
          Rendered only while a mission beat is live (additive). */}
      {stagePrimaryTab === 'game' && missionPhase ? (
        <output
          className={cn('off-mission-phase', `is-${missionPhase.phase}`)}
          aria-label={`Mission: ${missionPhase.semanticLabel}`}
        >
          <Icon icon={MISSION_PHASE_ICON[missionPhase.phase]} size="sm" />
          <span>{missionPhase.semanticLabel}</span>
        </output>
      ) : null}
    </section>
  );
}
