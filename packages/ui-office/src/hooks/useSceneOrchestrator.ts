/**
 * useSceneOrchestrator — ceremony orchestrator composition hook.
 *
 * Thin barrel on top of three single-responsibility modules:
 * - `./useCeremonyState`               → ceremony type definitions + idle state
 * - `./useCeremonyEventBindings`       → EventBus subscriptions + phase reducers
 * - `../runtime/movement-handle-registry` → per-company movement handle singleton
 * - `../runtime/zone-slot-counter`        → per-zone slot counter + rest-seat helpers
 * - `../lib/ceremony-descriptions`        → pure bubble-text constructors
 *
 * Public API (re-exported symbols) is preserved for historical importers.
 */

import type { PrefabInstanceRow, RuntimeEvent, Zone } from '@offisim/shared-types';
import { useEffect, useRef, useState } from 'react';
import { clearMovementHandlesForCompany } from '../runtime/movement-handle-registry';
import type { SceneIntentBus } from '../runtime/scene-intents';
import type { AgentState } from '../runtime/use-agent-states';
import { clearZoneSlotCountersForCompany } from '../runtime/zone-slot-counter';
import { useCeremonyEventBindings } from './useCeremonyEventBindings';
import { type CeremonyState, createIdleCeremonyState } from './useCeremonyState';

// ── Re-exports: preserve historical public surface ───────────

export type { CeremonyPhase, CeremonyState, WaitingRelationship } from './useCeremonyState';
export { IDLE_CEREMONY, createIdleCeremonyState } from './useCeremonyState';
export {
  describeEmployeeEscalation,
  describeInteractionSceneRequest,
  describeInteractionSceneResolution,
  describeWorkingToolActivity,
} from '../lib/ceremony-descriptions';
export {
  getMovementDebugInfo,
  getMovementHandle,
  registerMovementHandle,
  unregisterMovementHandle,
} from '../runtime/movement-handle-registry';

// ── Company-scoped module state cleanup ──────────────────────

/** Clean up module-level state for a company (call on unmount / company switch). */
export function clearCompanyState(companyId: string): void {
  clearMovementHandlesForCompany(companyId);
  clearZoneSlotCountersForCompany(companyId);
}

// ── Hook ─────────────────────────────────────────────────────

interface OrchestratorDeps {
  companyId: string;
  eventBus: {
    on: <TPayload = unknown>(
      prefix: string,
      handler: (e: RuntimeEvent<TPayload>) => void,
    ) => () => void;
  };
  sceneIntentBus?: SceneIntentBus;
  agents: Map<string, AgentState>;
  zones: readonly Zone[];
  prefabInstances?: readonly PrefabInstanceRow[];
}

export function useSceneOrchestrator({
  companyId,
  eventBus,
  sceneIntentBus,
  agents,
  zones,
  prefabInstances,
}: OrchestratorDeps): CeremonyState {
  const [ceremony, setCeremony] = useState<CeremonyState>(() => createIdleCeremonyState());
  const ceremonyVersionRef = useRef(0);

  // Cleanup module-level Maps on unmount / company switch.
  useEffect(() => {
    return () => {
      clearCompanyState(companyId);
    };
  }, [companyId]);

  useCeremonyEventBindings({
    companyId,
    eventBus,
    sceneIntentBus,
    agents,
    zones,
    prefabInstances,
    setCeremony,
    ceremonyVersionRef,
  });

  return ceremony;
}
