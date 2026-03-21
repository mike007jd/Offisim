import { Suspense, lazy } from 'react';
import { useScene } from './useScene';
import { PerformanceHUD } from './PerformanceHUD';

const Office3DView = lazy(() => import('./Office3DView'));
const Office2DView = lazy(() => import('./Office2DView'));

interface SceneCanvasProps {
  reducedMotion?: boolean;
  viewMode?: '2D' | '3D';
}

export function SceneCanvas({ reducedMotion = false, viewMode = '3D' }: SceneCanvasProps) {
  useScene(reducedMotion);

  return (
    <div className="h-full w-full overflow-hidden bg-[#020617] relative">
      {/* SVG 2D View */}
      {viewMode === '2D' && (
        <Suspense fallback={<div className="h-full w-full flex items-center justify-center"><div className="text-[10px] font-mono text-slate-600 animate-pulse">LOADING 2D MAP...</div></div>}>
          <Office2DView />
        </Suspense>
      )}

      {/* Three.js 3D View */}
      {viewMode === '3D' && (
        <Suspense fallback={<div className="h-full w-full flex items-center justify-center"><div className="text-[10px] font-mono text-slate-600 animate-pulse">LOADING 3D ENGINE...</div></div>}>
          <Office3DView />
        </Suspense>
      )}

      <PerformanceHUD />
    </div>
  );
}
