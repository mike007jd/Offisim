import { useUiState } from '@/app/ui-state.js';
import { cn } from '@/lib/utils.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import { Repeat } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LoopEditor } from './loops/LoopEditor.js';
import { LoopLibrary } from './loops/LoopLibrary.js';
import { LoopRuns } from './loops/LoopRuns.js';

/**
 * The Loops surface root. The internal surface key stays `mission` until the
 * app-state schema is renamed, but the product surface is prompt-first Loops:
 * a Library of reusable Loop definitions, a natural-language Editor, and a
 * read-only Runs list over persisted execution records.
 *
 * The old big-form MissionComposer / MissionControl are NO LONGER reachable from
 * this entry (PR-11 deletes them); this surface never routes to them. Pure view
 * routing — persistence is the loop/mission repos'.
 */

type Tab = 'library' | 'runs';
type View = { kind: 'list'; tab: Tab } | { kind: 'editor'; loopId: string };

export function MissionSurface() {
  const companyId = useUiState((s) => s.companyId);
  const openLifecycle = useUiState((s) => s.openLifecycle);
  // PR-10 sets `selectedLoopId` (via openLoopDetail) to deep-link a Loop's editor
  // from a composer chip; consume it once to open the editor.
  const selectedLoopId = useUiState((s) => s.selectedLoopId);
  const [view, setView] = useState<View>({ kind: 'list', tab: 'library' });

  useEffect(() => {
    if (selectedLoopId) {
      setView({ kind: 'editor', loopId: selectedLoopId });
      // Clear so a later manual visit doesn't force the editor back open.
      useUiState.setState({ selectedLoopId: null });
    }
  }, [selectedLoopId]);

  if (!companyId) {
    return (
      <div className="off-loops">
        <EmptyState
          icon={Repeat}
          title="No company selected"
          description="Loops belong to a company. Select or create one to start designing repeatable work."
          action={{ label: 'Choose a company', onClick: () => openLifecycle('select') }}
        />
      </div>
    );
  }

  if (view.kind === 'editor') {
    return (
      <div className="off-loops">
        <LoopEditor loopId={view.loopId} onBack={() => setView({ kind: 'list', tab: 'library' })} />
      </div>
    );
  }

  return (
    <div className="off-loops">
      <nav className="off-loops-tabs" aria-label="Loops views">
        <button
          type="button"
          className={cn('off-loops-tab off-focusable', view.tab === 'library' && 'is-active')}
          onClick={() => setView({ kind: 'list', tab: 'library' })}
          aria-current={view.tab === 'library' ? 'page' : undefined}
        >
          Library
        </button>
        <button
          type="button"
          className={cn('off-loops-tab off-focusable', view.tab === 'runs' && 'is-active')}
          onClick={() => setView({ kind: 'list', tab: 'runs' })}
          aria-current={view.tab === 'runs' ? 'page' : undefined}
        >
          Runs
        </button>
      </nav>
      {view.tab === 'library' ? (
        <LoopLibrary onOpenLoop={(loopId) => setView({ kind: 'editor', loopId })} />
      ) : (
        <LoopRuns />
      )}
    </div>
  );
}
