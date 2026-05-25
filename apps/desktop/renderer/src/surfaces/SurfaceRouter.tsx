import { type SurfaceKey, useUiState } from '@/app/ui-state.js';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { ActivitySurface } from './activity/ActivitySurface.js';
import { MarketSurface } from './market/MarketSurface.js';
import { OfficeSurface } from './office/OfficeSurface.js';
import { PersonnelSurface } from './personnel/PersonnelSurface.js';
import { SettingsSurface } from './settings/SettingsSurface.js';
import { StudioSurface } from './studio/StudioSurface.js';
import { WorkspaceSurface } from './workspace/WorkspaceSurface.js';

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
      {renderSurface(surface)}
    </motion.div>
  );
}
