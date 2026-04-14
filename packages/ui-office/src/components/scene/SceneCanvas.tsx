import React, { Suspense, lazy, useEffect, useState } from 'react';
import { IDLE_CEREMONY } from '../../hooks/useSceneOrchestrator.js';
import { useSceneCeremony } from '../../runtime/scene-ceremony-context.js';
import { PerformanceHUD } from './PerformanceHUD';
import { useScene } from './useScene';

const Office3DView = lazy(() => import('./Office3DView'));

// Default: canvas-based 2D renderer. SVG fallback gated behind VITE_OFFISIM_SVG_FALLBACK.
const Office2DCanvasView =
  import.meta.env.VITE_OFFISIM_SVG_FALLBACK === 'true'
    ? lazy(() => import('./Office2DView'))
    : lazy(() => import('./Office2DCanvasView'));

// ── Error boundary for Three.js / SVG scene crashes ─────────────

class SceneErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode; onError?: (error: Error) => void },
  { hasError: boolean; error: string }
> {
  state = { hasError: false, error: '' };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
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
  leftInset?: number;
  rightInset?: number;
  selectedEmployeeId?: string | null;
  onSelectEmployee?: (id: string) => void;
  onDeselectEmployee?: () => void;
  onFallbackTo2D?: (error: Error) => void;
}

export function SceneCanvas({
  active = true,
  reducedMotion = false,
  viewMode = '3D',
  leftInset = 0,
  rightInset = 0,
  selectedEmployeeId = null,
  onSelectEmployee,
  onDeselectEmployee,
  onFallbackTo2D,
}: SceneCanvasProps) {
  const ceremony = useSceneCeremony() ?? IDLE_CEREMONY;
  useScene(reducedMotion);
  const [hasMounted2D, setHasMounted2D] = useState(viewMode === '2D');
  const [hasMounted3D, setHasMounted3D] = useState(viewMode === '3D');
  const [force2D, setForce2D] = useState(false);
  const crashCountRef = React.useRef(0);
  const effectiveViewMode = force2D ? '2D' : viewMode;

  useEffect(() => {
    if (effectiveViewMode === '2D') {
      setHasMounted2D(true);
      return;
    }
    setHasMounted3D(true);
  }, [effectiveViewMode]);

  useEffect(() => {
    // Allow manual switch back to 3D unless it crashed repeatedly
    if (viewMode === '3D' && crashCountRef.current < 2) {
      setForce2D(false);
    }
  }, [viewMode]);

  return (
    <div className="h-full w-full overflow-hidden bg-surface relative">
      <SceneErrorBoundary>
        <div
          aria-hidden={effectiveViewMode !== '2D'}
          className={`absolute inset-0 transition-opacity duration-200 ${
            effectiveViewMode === '2D' ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {hasMounted2D && (
            <Suspense
              fallback={
                <div className="h-full w-full flex items-center justify-center">
                  <div className="text-[10px] font-mono text-slate-500 animate-pulse">
                    LOADING 2D MAP...
                  </div>
                </div>
              }
            >
              <Office2DCanvasView
                ceremony={ceremony}
                selectedEmployeeId={selectedEmployeeId}
                onSelectEmployee={onSelectEmployee}
                onDeselectEmployee={onDeselectEmployee}
              />
            </Suspense>
          )}
        </div>

        <SceneErrorBoundary
          fallback={null}
          onError={(error) => {
            crashCountRef.current += 1;
            setForce2D(true);
            onFallbackTo2D?.(error);
          }}
        >
          <div
            aria-hidden={effectiveViewMode !== '3D'}
            className={`absolute inset-0 transition-opacity duration-200 ${
              effectiveViewMode === '3D' ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            {hasMounted3D && (
              <Suspense
                fallback={
                  <div className="h-full w-full flex items-center justify-center">
                    <div className="text-[10px] font-mono text-slate-500 animate-pulse">
                      LOADING 3D ENGINE...
                    </div>
                  </div>
                }
              >
                <Office3DView
                  active={active && effectiveViewMode === '3D'}
                  ceremony={ceremony}
                  leftInset={leftInset}
                  rightInset={rightInset}
                  selectedEmployeeId={selectedEmployeeId}
                  onSelectEmployee={onSelectEmployee}
                  onDeselectEmployee={onDeselectEmployee}
                />
              </Suspense>
            )}
          </div>
        </SceneErrorBoundary>
      </SceneErrorBoundary>

      <PerformanceHUD />
    </div>
  );
}
