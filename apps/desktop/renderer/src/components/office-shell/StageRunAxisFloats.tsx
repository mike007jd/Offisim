import { useOffisimRuntimeStatus } from '@offisim/ui-office/web';
import { Activity, LayoutGrid } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LiveRunOverlay } from './LiveRunOverlay';
import {
  StageAxisBar,
  StageAxisButton,
  StageAxisDivider,
  StageAxisLiveIndicator,
} from './StageRunSurfaces';

interface StageRunAxisFloatsProps {
  kanbanOpen: boolean;
  onToggleKanban: () => void;
}

/**
 * Stage run-axis (top-centered float) with two adjacent entries sharing one
 * visual language but distinct lifecycles: Board (persistent kanban toggle, backed
 * by the unchanged kanban data/CAS) and Live (run-broadcast entry, idle/active).
 * The Live entry opens a run-broadcast overlay (Plan + Activity, latency in its
 * header). The two entries never merge into one overlay.
 */
export function StageRunAxisFloats({ kanbanOpen, onToggleKanban }: StageRunAxisFloatsProps) {
  const { isRunning } = useOffisimRuntimeStatus();
  const [liveOpen, setLiveOpen] = useState(false);

  // Auto-open the Live broadcast when a run starts; let the user close it.
  useEffect(() => {
    if (isRunning) setLiveOpen(true);
  }, [isRunning]);

  return (
    <>
      <StageAxisBar title="Run axis — Board (persistent kanban) and Live (run broadcast). Two entries, one visual language, different lifecycle.">
        <StageAxisButton
          type="button"
          aria-pressed={kanbanOpen}
          onClick={onToggleKanban}
          title="Board — persistent kanban, project/company-scoped, present even when idle"
          state={kanbanOpen ? 'active' : 'idle'}
        >
          <LayoutGrid data-icon="inline-start" aria-hidden="true" />
          Board
        </StageAxisButton>
        <StageAxisDivider />
        <StageAxisButton
          type="button"
          aria-pressed={liveOpen}
          onClick={() => setLiveOpen((prev) => !prev)}
          title="Live — the current run's plan + activity broadcasts here while it runs"
          state={isRunning ? 'active' : 'muted'}
        >
          <Activity data-icon="inline-start" aria-hidden="true" />
          Live
          {isRunning ? <StageAxisLiveIndicator /> : null}
        </StageAxisButton>
      </StageAxisBar>
      {liveOpen ? <LiveRunOverlay onClose={() => setLiveOpen(false)} /> : null}
    </>
  );
}
