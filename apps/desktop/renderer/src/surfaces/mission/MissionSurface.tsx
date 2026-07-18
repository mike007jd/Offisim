import { useUiState } from '@/app/ui-state.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/design-system/primitives/tabs.js';
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
type View = { kind: 'list'; tab: Tab } | { kind: 'editor'; loopId: string | null };

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
        <LoopEditor
          loopId={view.loopId}
          onCreated={(loopId) => setView({ kind: 'editor', loopId })}
          onBack={() => setView({ kind: 'list', tab: 'library' })}
        />
      </div>
    );
  }

  return (
    <div className="off-loops">
      <Tabs
        className="off-loops-tabs-root"
        value={view.tab}
        onValueChange={(value) => setView({ kind: 'list', tab: value as Tab })}
      >
        <TabsList className="off-loops-tabs" aria-label="Loops views">
          <TabsTrigger value="library" className="off-loops-tab">
            Library
          </TabsTrigger>
          <TabsTrigger value="runs" className="off-loops-tab">
            Runs
          </TabsTrigger>
        </TabsList>
        <TabsContent value="library" className="off-loops-tab-panel">
          <LoopLibrary
            onOpenLoop={(loopId) => setView({ kind: 'editor', loopId })}
            onNewLoop={() => setView({ kind: 'editor', loopId: null })}
          />
        </TabsContent>
        <TabsContent value="runs" className="off-loops-tab-panel">
          <LoopRuns />
        </TabsContent>
      </Tabs>
    </div>
  );
}
