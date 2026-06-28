import { useUiState } from '@/app/ui-state.js';
import { RunPipelinePill } from '@/assistant/parts/RunPipelinePill.js';
import { useActiveConversationRuns } from '@/assistant/runtime/conversation-run-react.js';
import { useMissionBeats } from '@/assistant/runtime/office-dramaturgy.js';
import { useOfficeLayout, useRunCost } from '@/data/queries.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { missionRunManager } from '@/runtime/mission/mission-run-manager.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import type { DramaturgyMode, MissionBeatPhase } from '@offisim/shared-types';
import {
  Box,
  CheckCircle2,
  Clapperboard,
  ClipboardList,
  Coins,
  Focus,
  HandHelping,
  LayoutPanelTop,
  LayoutTemplate,
  ShieldCheck,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { Suspense, useSyncExternalStore } from 'react';
import { RecoveryPanel } from './RecoveryPanel.js';
import { OfficeScene2D } from './scene/OfficeScene2D.js';
import { OfficeScene3D } from './scene/OfficeScene3D.js';
import { zoneDefsFromLayout } from './scene/scene-layout.js';

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

export function OfficeStage() {
  const sceneRenderMode = useUiState((s) => s.sceneRenderMode);
  const setSceneRenderMode = useUiState((s) => s.setSceneRenderMode);
  const officeMode = useUiState((s) => s.officeMode);
  const setOfficeMode = useUiState((s) => s.setOfficeMode);
  const setSurface = useUiState((s) => s.setSurface);
  const companyId = useUiState((s) => s.companyId);

  const runCost = useRunCost();
  const conversationRuns = useActiveConversationRuns();
  const activeMissionRuns = useSyncExternalStore(
    missionRunManager.subscribe,
    missionRunManager.getSnapshot,
    missionRunManager.getSnapshot,
  );
  const isRunning =
    conversationRuns.activeRuns.length > 0 ||
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
      <RecoveryPanel />

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

      {/* dramaturgy mode (left, below render toggle): Focus / Office / Cinematic
          presentation density. Same semantic truth in every mode. */}
      <div className="off-stage-float off-stage-dram">
        {(
          [
            { mode: 'focus', icon: Focus, label: 'Focus' },
            { mode: 'office', icon: Users, label: 'Office' },
            { mode: 'cinematic', icon: Clapperboard, label: 'Cinematic' },
          ] as ReadonlyArray<{ mode: DramaturgyMode; icon: typeof Focus; label: string }>
        ).map(({ mode, icon, label }) => (
          <button
            key={mode}
            type="button"
            className={cn('off-stage-mode-btn off-focusable', officeMode === mode && 'is-on')}
            onClick={() => setOfficeMode(mode)}
            title={`${label} presentation`}
          >
            <Icon icon={icon} size="sm" />
            {label}
          </button>
        ))}
      </div>

      {/* Read-only mission-phase pill (§24.4): the current mission meaning as a
          static label — legible under reduced motion, never moves an actor.
          Rendered only while a mission beat is live (additive). */}
      {missionPhase ? (
        <output
          className={cn('off-mission-phase', `is-${missionPhase.phase}`)}
          aria-label={`Mission: ${missionPhase.semanticLabel}`}
        >
          <Icon icon={MISSION_PHASE_ICON[missionPhase.phase]} size="sm" />
          <span>{missionPhase.semanticLabel}</span>
        </output>
      ) : null}

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
