import {
  SceneCeremonyProvider,
  useAgentStates,
  useCompany,
  useCompanyZones,
  useOffisimRuntimeServices,
  usePrefabInstances,
  useReducedMotion,
  useSceneOrchestrator,
} from '@offisim/ui-office/web';
import React, { type ReactNode, Suspense, useCallback, useMemo } from 'react';
import { EmployeeBadgeOverlay } from './EmployeeBadgeOverlay';
import { SceneCostReadout } from './SceneCostReadout';
import { StagePipe } from './StagePipe';
import { StageRunAxisFloats } from './StageRunAxisFloats';

const SceneCanvas = React.lazy<
  React.ComponentType<{
    active?: boolean;
    reducedMotion?: boolean;
    viewMode?: '2D' | '3D';
    viewModeNonce: number;
    leftInset?: number;
    rightInset?: number;
    selectedEmployeeId?: string | null;
    onSelectEmployee?: (id: string | null) => void;
    onDeselectEmployee?: () => void;
    onFallbackTo2D?: () => void;
    renderEmployeeBadge?: (employeeId: string) => React.ReactNode;
  }>
>(() =>
  import('@offisim/ui-office/scene').then((module) => ({
    default: module.SceneCanvas,
  })),
);

interface OfficeSceneSurfaceProps {
  leftPanelWidth: number;
  onSceneFallbackTo2D: () => void;
  onSelectEmployee: (id: string | null) => void;
  rightPanelWidth: number;
  selectedEmployeeId: string | null;
  sceneInteractive: boolean;
  viewMode: '2D' | '3D';
  viewModeNonce: number;
  paused?: boolean;
  /** Active product thread id — resume target for the diegetic `.stage-pipe`. */
  activeThreadId: string | null;
  /** Board run-axis entry state + toggle (backs the kanban). */
  kanbanOpen: boolean;
  onToggleKanban: () => void;
  /** Diegetic notification surface rendered beside the cost readout. */
  notificationSlot?: ReactNode;
  /** Team dock strip pinned below the stage (employee roster relocation). */
  teamDockSlot?: ReactNode;
}

function CeremonyHost({ children }: { children: React.ReactNode }) {
  const { eventBus, sceneIntentBus } = useOffisimRuntimeServices();
  const { activeCompanyId } = useCompany();
  const agents = useAgentStates();
  const { zones } = useCompanyZones();
  const { instances: prefabInstancesWithDef } = usePrefabInstances();
  const prefabInstances = useMemo(
    () => prefabInstancesWithDef.map((prefab) => prefab.instance),
    [prefabInstancesWithDef],
  );
  const ceremony = useSceneOrchestrator({
    companyId: activeCompanyId ?? 'default-scene-company',
    eventBus,
    sceneIntentBus,
    agents,
    zones,
    prefabInstances,
  });

  return <SceneCeremonyProvider value={ceremony}>{children}</SceneCeremonyProvider>;
}

export function OfficeSceneSurface({
  leftPanelWidth,
  onSceneFallbackTo2D,
  onSelectEmployee,
  rightPanelWidth,
  selectedEmployeeId,
  sceneInteractive,
  viewMode,
  viewModeNonce,
  paused = false,
  activeThreadId,
  kanbanOpen,
  onToggleKanban,
  notificationSlot,
  teamDockSlot,
}: OfficeSceneSurfaceProps) {
  const reducedMotion = useReducedMotion();
  const handleDeselectEmployee = useCallback(() => onSelectEmployee(null), [onSelectEmployee]);
  const renderEmployeeBadge = useCallback(
    (employeeId: string) => <EmployeeBadgeOverlay employeeId={employeeId} />,
    [],
  );

  return (
    <div className="relative h-full w-full">
      <CeremonyHost>
        <Suspense fallback={<div className="h-full w-full animate-pulse bg-surface-elevated" />}>
          <SceneCanvas
            active={sceneInteractive && !paused}
            reducedMotion={reducedMotion}
            viewMode={viewMode}
            viewModeNonce={viewModeNonce}
            leftInset={leftPanelWidth}
            rightInset={rightPanelWidth}
            selectedEmployeeId={selectedEmployeeId}
            onSelectEmployee={onSelectEmployee}
            onDeselectEmployee={handleDeselectEmployee}
            onFallbackTo2D={onSceneFallbackTo2D}
            renderEmployeeBadge={renderEmployeeBadge}
          />
        </Suspense>
        {/* Diegetic stage insets — overlays only; the canvas renderer is unchanged. */}
        <div className="pointer-events-none absolute inset-0 z-elevated">
          <StageRunAxisFloats kanbanOpen={kanbanOpen} onToggleKanban={onToggleKanban} />
          <StagePipe activeThreadId={activeThreadId} />
          <SceneCostReadout notificationSlot={notificationSlot} />
        </div>
        {teamDockSlot ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-elevated flex justify-center px-4 pb-4">
            <div className="pointer-events-auto w-full max-w-5xl overflow-hidden rounded-r-lg border border-line shadow-elev-2">
              {teamDockSlot}
            </div>
          </div>
        ) : null}
      </CeremonyHost>
    </div>
  );
}
