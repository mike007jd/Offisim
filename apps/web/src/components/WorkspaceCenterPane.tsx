import type { Zone } from '@offisim/shared-types';
import type { ComponentType } from 'react';
import { Suspense } from 'react';
import { WorkspaceSurface } from './WorkspaceSurface';
import { getWorkspaceCenterPaneMode } from './workspace-center-pane-mode';
import type { WorkspaceSurfaceView } from './workspace-surface-meta';
import type { AppView } from '../lib/app-view-layout';

interface SceneCanvasLazyProps {
  active?: boolean;
  reducedMotion?: boolean;
  viewMode?: '2D' | '3D';
  leftInset?: number;
  rightInset?: number;
  selectedEmployeeId?: string | null;
  onSelectEmployee?: (id: string | null) => void;
  onDeselectEmployee?: () => void;
  onFallbackTo2D?: () => void;
}

interface WorkspaceCenterPaneProps {
  view: AppView;
  viewMode: '2D' | '3D';
  reducedMotion: boolean;
  leftInset: number;
  rightInset: number;
  selectedEmployeeId: string | null;
  zones: Zone[];
  activeThreadId: string | null;
  sceneCanvas: ComponentType<SceneCanvasLazyProps>;
  currentSurfaceView: WorkspaceSurfaceView | null;
  onSelectEmployee: (id: string | null) => void;
  onDeselectEmployee: () => void;
  onFallbackTo2D: () => void;
  onOpenListing: (listingId: string) => void;
  onStartInstall: (listingId: string, version: string) => void;
}

export function WorkspaceCenterPane(props: WorkspaceCenterPaneProps) {
  const mode = getWorkspaceCenterPaneMode(props.view);

  if (mode === 'office-scene') {
    const SceneCanvas = props.sceneCanvas;
    return (
      <div className="h-full w-full" data-onboarding-target="scene-surface">
        <Suspense fallback={<div className="h-full w-full bg-ocean-deep animate-pulse" />}>
          <SceneCanvas
            active
            reducedMotion={props.reducedMotion}
            viewMode={props.viewMode}
            leftInset={props.leftInset}
            rightInset={props.rightInset}
            selectedEmployeeId={props.selectedEmployeeId}
            onSelectEmployee={props.onSelectEmployee}
            onDeselectEmployee={props.onDeselectEmployee}
            onFallbackTo2D={props.onFallbackTo2D}
          />
        </Suspense>
      </div>
    );
  }

  if (mode === 'workspace-surface' && props.currentSurfaceView) {
    return (
      <WorkspaceSurface
        view={props.currentSurfaceView}
        zones={props.zones}
        activeThreadId={props.activeThreadId}
        onOpenListing={props.onOpenListing}
        onStartInstall={props.onStartInstall}
      />
    );
  }

  return null;
}
