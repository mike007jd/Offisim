import { Activity } from 'lucide-react';
import { Suspense, lazy, useState } from 'react';
import { useScene } from './useScene';

const Office3DView = lazy(() => import('./Office3DView'));

interface SceneCanvasProps {
  reducedMotion?: boolean;
}

export function SceneCanvas({ reducedMotion = false }: SceneCanvasProps) {
  const { containerRef } = useScene(reducedMotion);
  const [viewMode, setViewMode] = useState<'2D' | '3D'>('2D');

  return (
    <div className="h-full w-full overflow-hidden bg-[#020617] relative">
      {/* HUD header overlay */}
      <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
        <div className="flex flex-col pointer-events-auto">
          <h2 className="text-xl font-black text-white tracking-tighter uppercase flex items-center space-x-2">
            <Activity className="w-4 h-4 text-blue-500 animate-pulse" />
            <span>Sector_Visualizer</span>
          </h2>
          <p className="text-[10px] font-mono text-slate-500 tracking-[0.2em] mt-0.5">
            REAL-TIME_SPATIAL_TELEMETRY
          </p>
        </div>

        <div className="flex items-center pointer-events-auto">
          <div className="flex items-center bg-black/40 border border-white/10 backdrop-blur-md rounded-lg p-1">
            <button
              onClick={() => setViewMode('2D')}
              className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-md transition-all ${
                viewMode === '2D'
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/20'
                  : 'text-slate-600 hover:text-slate-400'
              }`}
            >
              2D_VIEW
            </button>
            <button
              onClick={() => setViewMode('3D')}
              className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-md transition-all ${
                viewMode === '3D'
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/20'
                  : 'text-slate-600 hover:text-slate-400'
              }`}
            >
              3D_VIEW
            </button>
          </div>
        </div>
      </div>

      {/* Bottom HUD metrics */}
      <div className="absolute bottom-4 left-4 right-4 z-20 pointer-events-none">
        <div className="flex items-center justify-between px-6 py-4 bg-black/20 backdrop-blur-md border border-white/10 rounded-2xl pointer-events-auto">
          <div className="flex items-center space-x-8">
            <div className="flex flex-col space-y-1">
              <span className="text-[8px] font-mono text-slate-600 uppercase">Active_Agents</span>
              <div className="flex items-center space-x-2">
                <div className="w-20 h-1 bg-white/5 rounded-full overflow-hidden">
                  <div className="w-2/3 h-full bg-blue-500/40" />
                </div>
                <span className="text-[9px] font-mono text-blue-400">ONLINE</span>
              </div>
            </div>
            <div className="flex flex-col space-y-1">
              <span className="text-[8px] font-mono text-slate-600 uppercase">Runtime_Health</span>
              <div className="flex items-center space-x-2">
                <div className="w-20 h-1 bg-white/5 rounded-full overflow-hidden">
                  <div className="w-4/5 h-full bg-emerald-500/40" />
                </div>
                <span className="text-[9px] font-mono text-emerald-400">STABLE</span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-6 text-[9px] font-mono text-slate-600">
            <div className="flex items-center space-x-2">
              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
              <span>SYNC: ACTIVE</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
              <span>ENV: LOCAL</span>
            </div>
          </div>
        </div>
      </div>

      {/* Scene content */}
      {viewMode === '2D' ? (
        <div ref={containerRef} className="h-full w-full" />
      ) : (
        <Suspense
          fallback={
            <div className="h-full w-full flex items-center justify-center">
              <div className="text-[10px] font-mono text-slate-600 animate-pulse">LOADING 3D ENGINE...</div>
            </div>
          }
        >
          <Office3DView />
        </Suspense>
      )}
    </div>
  );
}
