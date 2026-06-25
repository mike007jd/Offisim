import { useUiState } from '@/app/ui-state.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import { Target } from 'lucide-react';
import { useState } from 'react';
import { MissionComposer } from './MissionComposer.js';
import { MissionControl } from './MissionControl.js';
import { MissionList } from './MissionList.js';

/**
 * Mission surface root (PRD §24). Owns the local navigation between the three
 * mission views — list, composer (UX-001), and control (UX-002) — as ephemeral
 * UI state. The list is the resting view; "New mission" opens the composer; a
 * row (or a fresh create) opens control. Mission persistence is the repos'; this
 * is pure view routing.
 */

type View = { kind: 'list' } | { kind: 'composer' } | { kind: 'control'; missionId: string };

export function MissionSurface() {
  const companyId = useUiState((s) => s.companyId);
  const openLifecycle = useUiState((s) => s.openLifecycle);
  const [view, setView] = useState<View>({ kind: 'list' });

  if (!companyId) {
    return (
      <div className="off-mission">
        <EmptyState
          icon={Target}
          title="No company selected"
          description="Missions belong to a company. Select or create one to start authoring verifiable work."
          action={{ label: 'Choose a company', onClick: () => openLifecycle('select') }}
        />
      </div>
    );
  }

  return (
    <div className="off-mission">
      {view.kind === 'list' ? (
        <MissionList
          onNewMission={() => setView({ kind: 'composer' })}
          onOpenMission={(missionId) => setView({ kind: 'control', missionId })}
        />
      ) : view.kind === 'composer' ? (
        <MissionComposer
          onCancel={() => setView({ kind: 'list' })}
          onCreated={(result) => setView({ kind: 'control', missionId: result.missionId })}
        />
      ) : (
        <MissionControl missionId={view.missionId} onBack={() => setView({ kind: 'list' })} />
      )}
    </div>
  );
}
