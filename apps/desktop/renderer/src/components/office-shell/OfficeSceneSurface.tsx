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
import React, { Suspense, useCallback, useMemo } from 'react';
import { EmployeeBadgeOverlay } from './EmployeeBadgeOverlay';
import { OfficeSceneCanvasFallback, OfficeSceneRoot } from './OfficeShellSurfaces';

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
}: OfficeSceneSurfaceProps) {
  const reducedMotion = useReducedMotion();
  const handleDeselectEmployee = useCallback(() => onSelectEmployee(null), [onSelectEmployee]);
  const renderEmployeeBadge = useCallback(
    (employeeId: string) => <EmployeeBadgeOverlay employeeId={employeeId} />,
    [],
  );

  return (
    <OfficeSceneRoot>
      <CeremonyHost>
        <Suspense fallback={<OfficeSceneCanvasFallback />}>
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
      </CeremonyHost>
    </OfficeSceneRoot>
  );
}
