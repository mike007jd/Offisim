import { ErrorBoundary } from '@/app/ErrorBoundary.js';
import { type SurfaceKey, useUiState } from '@/app/ui-state.js';
import { motion } from 'motion/react';
import { type ReactNode, Suspense, lazy } from 'react';

const ActivitySurface = lazy(() =>
  import('./activity/ActivitySurface.js').then((m) => ({ default: m.ActivitySurface })),
);
const MarketSurface = lazy(() =>
  import('./market/MarketSurface.js').then((m) => ({ default: m.MarketSurface })),
);
const MissionSurface = lazy(() =>
  import('./mission/MissionSurface.js').then((m) => ({ default: m.MissionSurface })),
);
const OfficeSurface = lazy(() =>
  import('./office/OfficeSurface.js').then((m) => ({ default: m.OfficeSurface })),
);
const PersonnelSurface = lazy(() =>
  import('./personnel/PersonnelSurface.js').then((m) => ({ default: m.PersonnelSurface })),
);
const SettingsSurface = lazy(() =>
  import('./settings/SettingsSurface.js').then((m) => ({ default: m.SettingsSurface })),
);
const StudioSurface = lazy(() =>
  import('./studio/StudioSurface.js').then((m) => ({ default: m.StudioSurface })),
);
const WorkspaceSurface = lazy(() =>
  import('./workspace/WorkspaceSurface.js').then((m) => ({ default: m.WorkspaceSurface })),
);

function renderSurface(surface: SurfaceKey): ReactNode {
  switch (surface) {
    case 'workspace':
      return <WorkspaceSurface />;
    case 'market':
      return <MarketSurface />;
    case 'mission':
      return <MissionSurface />;
    case 'personnel':
      return <PersonnelSurface />;
    case 'activity':
      return <ActivitySurface />;
    case 'settings':
      return <SettingsSurface />;
    case 'studio':
      return <StudioSurface />;
    default:
      return <OfficeSurface />;
  }
}

/** Pane-scoped failure plate: a surface render throw degrades to its own area
 *  while the titlebar, nav, and other surfaces stay usable. */
function SurfaceErrorPane({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="off-surface-error" role="alert">
      <div className="off-surface-error__title">This view hit a problem</div>
      <p className="off-surface-error__msg">
        The rest of the workbench is still available. Try reloading this view.
      </p>
      <button type="button" className="off-surface-error__retry" onClick={onRetry}>
        Reload view
      </button>
    </div>
  );
}

export function SurfaceRouter() {
  const surface = useUiState((s) => s.surface);
  return (
    <motion.div
      key={surface}
      className="off-surface-anim"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
    >
      <Suspense fallback={<div className="off-surface-loading">Loading…</div>}>
        {/* Scene-local boundary: keyed on surface so navigating away clears the
            error; falls back to a pane plate instead of nuking the whole shell. */}
        <ErrorBoundary
          key={surface}
          label={surface}
          fallback={(reset) => <SurfaceErrorPane onRetry={reset} />}
        >
          {renderSurface(surface)}
        </ErrorBoundary>
      </Suspense>
    </motion.div>
  );
}
