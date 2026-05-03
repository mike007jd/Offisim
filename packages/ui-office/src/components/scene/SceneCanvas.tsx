import React, { Suspense, lazy, useEffect, useReducer, useRef, useState } from 'react';
import { IDLE_CEREMONY } from '../../hooks/useSceneOrchestrator.js';
import { useSceneCeremony } from '../../runtime/scene-ceremony-context.js';
import { PerformanceHUD } from './PerformanceHUD';
import { SceneErrorPanel } from './scene-error-panel.js';
import { SceneFallbackBadge } from './scene-fallback-badge.js';
import { useScene } from './useScene';

const Office3DView = lazy(() => import('./Office3DView'));

const Office2DCanvasView = lazy(() => import('./Office2DCanvasView'));

// ── Error boundary for scene crashes ────────────────────────────

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
        <SceneErrorPanel
          error={this.state.error}
          onRetry={() => this.setState({ hasError: false, error: '' })}
        />
      );
    }
    return this.props.children;
  }
}

// ── Fallback state machine ──────────────────────────────────────

type FallbackState = {
  force2D: boolean;
  crashCount: number;
  lastError: string | null;
};

type FallbackAction =
  | { type: 'reportCrash'; error: Error }
  | { type: 'fpsTierOff' }
  | { type: 'requestRetry' }
  | { type: 'viewModeBumped' };

const INITIAL_FALLBACK_STATE: FallbackState = {
  force2D: false,
  crashCount: 0,
  lastError: null,
};

function fallbackReducer(state: FallbackState, action: FallbackAction): FallbackState {
  switch (action.type) {
    case 'reportCrash':
      return {
        force2D: true,
        crashCount: state.crashCount + 1,
        lastError: action.error.message,
      };
    case 'fpsTierOff':
      // Performance signal, not a crash — don't bump crashCount.
      return state.force2D ? state : { ...state, force2D: true };
    case 'requestRetry':
    case 'viewModeBumped':
      return INITIAL_FALLBACK_STATE;
    default:
      return state;
  }
}

// ── SceneCanvas ─────────────────────────────────────────────────

interface SceneCanvasProps {
  active?: boolean;
  reducedMotion?: boolean;
  viewMode?: '2D' | '3D';
  viewModeNonce: number;
  leftInset?: number;
  rightInset?: number;
  selectedEmployeeId?: string | null;
  onSelectEmployee?: (id: string) => void;
  onDeselectEmployee?: () => void;
  onFallbackTo2D?: (error: Error) => void;
  renderEmployeeBadge?: (employeeId: string) => React.ReactNode;
}

export function SceneCanvas({
  active = true,
  reducedMotion = false,
  viewMode = '3D',
  viewModeNonce,
  leftInset = 0,
  rightInset = 0,
  selectedEmployeeId = null,
  onSelectEmployee,
  onDeselectEmployee,
  onFallbackTo2D,
  renderEmployeeBadge,
}: SceneCanvasProps) {
  const ceremony = useSceneCeremony() ?? IDLE_CEREMONY;
  useScene(reducedMotion);
  const [state, dispatch] = useReducer(fallbackReducer, INITIAL_FALLBACK_STATE);
  const effectiveViewMode = state.force2D ? '2D' : viewMode;
  const [hasMounted2D, setHasMounted2D] = useState(viewMode === '2D');
  const [hasMounted3D, setHasMounted3D] = useState(viewMode === '3D');

  useEffect(() => {
    if (effectiveViewMode === '2D') {
      setHasMounted2D(true);
    } else {
      setHasMounted3D(true);
    }
  }, [effectiveViewMode]);

  const lastNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (lastNonceRef.current === null) {
      lastNonceRef.current = viewModeNonce;
      return;
    }
    if (lastNonceRef.current !== viewModeNonce) {
      lastNonceRef.current = viewModeNonce;
      dispatch({ type: 'viewModeBumped' });
    }
  }, [viewModeNonce]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface">
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
                <div className="flex h-full w-full items-center justify-center">
                  <div className="animate-pulse font-mono text-[10px] text-text-muted">
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
            dispatch({ type: 'reportCrash', error });
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
                  <div className="flex h-full w-full items-center justify-center">
                    <div className="animate-pulse font-mono text-[10px] text-text-muted">
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
                  onRequestForce2D={() => dispatch({ type: 'fpsTierOff' })}
                  renderEmployeeBadge={renderEmployeeBadge}
                />
              </Suspense>
            )}
          </div>
        </SceneErrorBoundary>
      </SceneErrorBoundary>

      {viewMode === '3D' && state.force2D && (
        <SceneFallbackBadge onRetry={() => dispatch({ type: 'requestRetry' })} />
      )}

      <PerformanceHUD />
    </div>
  );
}
