import React, { Suspense, lazy, useEffect, useState } from 'react';
import type { CeremonyState } from '../../hooks/useSceneOrchestrator.js';
import { PerformanceHUD } from './PerformanceHUD';
import { useScene } from './useScene';

const Office3DView = lazy(() => import('./Office3DView'));
const Office2DView = lazy(() => import('./Office2DView'));

// ── Error boundary for Three.js / SVG scene crashes ─────────────

class SceneErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  state = { hasError: false, error: '' };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full bg-black/50 text-white">
          <div className="text-center p-4">
            <p className="text-sm text-red-400">Scene Error</p>
            <p className="text-xs text-gray-400 mt-1">{this.state.error}</p>
            <button
              type="button"
              className="mt-3 px-3 py-1 text-xs bg-white/10 rounded hover:bg-white/20"
              onClick={() => this.setState({ hasError: false, error: '' })}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── SceneCanvas ─────────────────────────────────────────────────

interface SceneCanvasProps {
  active?: boolean;
  reducedMotion?: boolean;
  viewMode?: '2D' | '3D';
  ceremony?: CeremonyState;
  selectedEmployeeId?: string | null;
  onSelectEmployee?: (id: string) => void;
  onDeselectEmployee?: () => void;
}

export function SceneCanvas({
  active = true,
  reducedMotion = false,
  viewMode = '3D',
  ceremony = {
    phase: 'idle',
    bubbleText: '',
    participantIds: new Set(),
    dispatchedIds: new Set(),
    managerVisible: false,
    managerPosition: null,
    waitingRelationships: [],
  },
  selectedEmployeeId = null,
  onSelectEmployee,
  onDeselectEmployee,
}: SceneCanvasProps) {
  useScene(reducedMotion);
  const [hasMounted2D, setHasMounted2D] = useState(viewMode === '2D');
  const [hasMounted3D, setHasMounted3D] = useState(viewMode === '3D');

  useEffect(() => {
    if (viewMode === '2D') {
      setHasMounted2D(true);
      return;
    }
    setHasMounted3D(true);
  }, [viewMode]);

  return (
    <div className="h-full w-full overflow-hidden bg-surface relative">
      <SceneErrorBoundary>
        <div
          aria-hidden={viewMode !== '2D'}
          className={`absolute inset-0 transition-opacity duration-200 ${
            viewMode === '2D' ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {hasMounted2D && (
            <Suspense
              fallback={
                <div className="h-full w-full flex items-center justify-center">
                  <div className="text-[10px] font-mono text-slate-600 animate-pulse">
                    LOADING 2D MAP...
                  </div>
                </div>
              }
            >
              <Office2DView
                ceremony={ceremony}
                selectedEmployeeId={selectedEmployeeId}
                onSelectEmployee={onSelectEmployee}
                onDeselectEmployee={onDeselectEmployee}
              />
            </Suspense>
          )}
        </div>

        <div
          aria-hidden={viewMode !== '3D'}
          className={`absolute inset-0 transition-opacity duration-200 ${
            viewMode === '3D' ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {hasMounted3D && (
            <Suspense
              fallback={
                <div className="h-full w-full flex items-center justify-center">
                  <div className="text-[10px] font-mono text-slate-600 animate-pulse">
                    LOADING 3D ENGINE...
                  </div>
                </div>
              }
            >
              <Office3DView
                active={active && viewMode === '3D'}
                ceremony={ceremony}
                selectedEmployeeId={selectedEmployeeId}
                onSelectEmployee={onSelectEmployee}
                onDeselectEmployee={onDeselectEmployee}
              />
            </Suspense>
          )}
        </div>
      </SceneErrorBoundary>

      <PerformanceHUD />
    </div>
  );
}
