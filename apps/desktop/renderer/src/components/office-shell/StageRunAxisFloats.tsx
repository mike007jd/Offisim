import { Button, cn } from '@offisim/ui-core';
import { useOffisimRuntimeStatus } from '@offisim/ui-office/web';
import { Activity, LayoutGrid } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LiveRunOverlay } from './LiveRunOverlay';

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
      <div
        title="Run axis — Board (persistent kanban) and Live (run broadcast). Two entries, one visual language, different lifecycle."
        className="pointer-events-auto absolute left-1/2 top-0 z-elevated flex h-8 -translate-x-1/2 overflow-hidden rounded-b-md border border-t-0 border-line bg-surface-1/[0.96] shadow-elev-2 backdrop-blur-sm"
      >
        <Button
          type="button"
          variant="ghost"
          aria-pressed={kanbanOpen}
          onClick={onToggleKanban}
          title="Board — persistent kanban, project/company-scoped, present even when idle"
          className={cn(
            'inline-flex h-8 items-center gap-1.5 px-3.5 text-fs-sm font-semibold transition-colors hover:bg-white hover:text-ink-1',
            kanbanOpen ? 'bg-accent-surface text-accent' : 'text-ink-2',
          )}
        >
          <LayoutGrid
            className={cn('size-3.5', kanbanOpen ? 'text-accent' : 'text-ink-3')}
            aria-hidden="true"
          />
          Board
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-pressed={liveOpen}
          onClick={() => setLiveOpen((prev) => !prev)}
          title="Live — the current run's plan + activity broadcasts here while it runs"
          className={cn(
            'inline-flex h-8 items-center gap-1.5 border-l border-line px-3.5 text-fs-sm font-semibold transition-colors hover:bg-white',
            isRunning ? 'text-accent' : 'text-ink-4',
          )}
        >
          <Activity
            className={cn('size-3.5', isRunning ? 'text-accent' : 'text-ink-4')}
            aria-hidden="true"
          />
          Live
          {isRunning ? (
            <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-accent" />
          ) : null}
        </Button>
      </div>
      {liveOpen ? <LiveRunOverlay onClose={() => setLiveOpen(false)} /> : null}
    </>
  );
}
