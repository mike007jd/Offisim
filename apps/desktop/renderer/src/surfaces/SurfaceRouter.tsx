import { type SurfaceKey, useUiState } from '@/app/ui-state.js';
import { motion } from 'motion/react';
import { lazy, Suspense, type ReactNode } from 'react';

const ActivitySurface = lazy(() =>
  import('./activity/ActivitySurface.js').then((m) => ({ default: m.ActivitySurface })),
);
const MarketSurface = lazy(() =>
  import('./market/MarketSurface.js').then((m) => ({ default: m.MarketSurface })),
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
        {renderSurface(surface)}
      </Suspense>
    </motion.div>
  );
}
