import React, { Suspense, lazy, useEffect, useReducer, useRef } from 'react';
import { IDLE_CEREMONY } from '../../hooks/useSceneOrchestrator.js';
import { useCompany } from '../company/CompanyContext.js';
import { useEmployeePerformanceCues } from '../../runtime/employee-performance-cues.js';
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
  onFallbackTo2D?: (error?: Error) => void;
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
  const { activeCompanyId } = useCompany();
  const employeePerformanceCues = useEmployeePerformanceCues(activeCompanyId);
  useScene(reducedMotion);
  const [state, dispatch] = useReducer(fallbackReducer, INITIAL_FALLBACK_STATE);
  const effectiveViewMode = state.force2D ? '2D' : viewMode;

  const lastNonceRef = useRef<number | null>(null);
  const lastViewModeRef = useRef(viewMode);
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

  useEffect(() => {
    const previous = lastViewModeRef.current;
    lastViewModeRef.current = viewMode;
    if (previous !== viewMode && viewMode === '3D') {
      dispatch({ type: 'viewModeBumped' });
    }
  }, [viewMode]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface">
      <SceneErrorBoundary>
        {effectiveViewMode === '2D' && (
          <div className="absolute inset-0">
            <Suspense
              fallback={
                <div className="flex h-full w-full items-center justify-center">
                  <div className="animate-pulse font-mono text-caption text-text-muted">
                    LOADING 2D MAP...
                  </div>
                </div>
              }
            >
              <Office2DCanvasView
                ceremony={ceremony}
                employeePerformanceCues={employeePerformanceCues}
                selectedEmployeeId={selectedEmployeeId}
                onSelectEmployee={onSelectEmployee}
                onDeselectEmployee={onDeselectEmployee}
              />
            </Suspense>
          </div>
        )}

        <SceneErrorBoundary
          fallback={null}
          onError={(error) => {
            dispatch({ type: 'reportCrash', error });
            onFallbackTo2D?.(error);
          }}
        >
          {effectiveViewMode === '3D' && (
            <div className="absolute inset-0">
              <Suspense
                fallback={
                  <div className="flex h-full w-full items-center justify-center">
                    <div className="animate-pulse font-mono text-caption text-text-muted">
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
                  onRequestForce2D={() => {
                    dispatch({ type: 'fpsTierOff' });
                    onFallbackTo2D?.();
                  }}
                  employeePerformanceCues={employeePerformanceCues}
                  renderEmployeeBadge={renderEmployeeBadge}
                />
              </Suspense>
            </div>
          )}
        </SceneErrorBoundary>
      </SceneErrorBoundary>

      {viewMode === '3D' && state.force2D && (
        <SceneFallbackBadge onRetry={() => dispatch({ type: 'requestRetry' })} />
      )}

      <PerformanceHUD />
    </div>
  );
}
