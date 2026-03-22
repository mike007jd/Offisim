import React, { Suspense, lazy } from 'react';
import { useScene } from './useScene';
import { PerformanceHUD } from './PerformanceHUD';

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
  reducedMotion?: boolean;
  viewMode?: '2D' | '3D';
  selectedEmployeeId?: string | null;
  onSelectEmployee?: (id: string) => void;
  onDeselectEmployee?: () => void;
}

export function SceneCanvas({
  reducedMotion = false,
  viewMode = '3D',
  selectedEmployeeId = null,
  onSelectEmployee,
  onDeselectEmployee,
}: SceneCanvasProps) {
  useScene(reducedMotion);

  return (
    <div className="h-full w-full overflow-hidden bg-surface relative">
      <SceneErrorBoundary>
        {/* SVG 2D View */}
        {viewMode === '2D' && (
          <Suspense fallback={<div className="h-full w-full flex items-center justify-center"><div className="text-[10px] font-mono text-slate-600 animate-pulse">LOADING 2D MAP...</div></div>}>
            <Office2DView
              selectedEmployeeId={selectedEmployeeId}
              onSelectEmployee={onSelectEmployee}
              onDeselectEmployee={onDeselectEmployee}
            />
          </Suspense>
        )}

        {/* Three.js 3D View */}
        {viewMode === '3D' && (
          <Suspense fallback={<div className="h-full w-full flex items-center justify-center"><div className="text-[10px] font-mono text-slate-600 animate-pulse">LOADING 3D ENGINE...</div></div>}>
            <Office3DView
              selectedEmployeeId={selectedEmployeeId}
              onSelectEmployee={onSelectEmployee}
              onDeselectEmployee={onDeselectEmployee}
            />
          </Suspense>
        )}
      </SceneErrorBoundary>

      <PerformanceHUD />
    </div>
  );
}
