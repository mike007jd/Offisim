import { Button, cn } from '@offisim/ui-core';
import {
  type PipelineStage,
  STAGE_META,
  useOffisimRuntimeExecution,
  useOffisimRuntimeInteraction,
  useOffisimRuntimeStatus,
  usePipelineStage,
  usePlanStepStore,
} from '@offisim/ui-office/web';
import { ArrowRight, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface StagePipeProps {
  /** Active product thread id — the resume target after an abort. */
  activeThreadId: string | null;
}

interface AbortedRun {
  stepLabel: string;
  threadId: string | null;
}

function fallbackHeadline(stage: PipelineStage): string {
  if (!stage) return 'Running';
  return STAGE_META[stage].label;
}

/**
 * Diegetic run-state control on the stage (relocation home of the deleted
 * StatusBar run-state headline + Stop). While a run is live, a single pill floats
 * above the worker zones showing the current step + assignee + progress and a
 * Stop control that invokes the existing abortExecution() path. On abort the pill
 * collapses to a muted "Stopped at step #N" state and a Resume / Discard
 * affordance appears below the run-axis. Stop is never moved into the composer.
 */
export function StagePipe({ activeThreadId }: StagePipeProps) {
  const { isRunning } = useOffisimRuntimeStatus();
  const { abortExecution, resumeThread } = useOffisimRuntimeExecution();
  const { pendingInteraction } = useOffisimRuntimeInteraction();
  const { steps, currentStepIndex, stats } = usePlanStepStore();
  const { stage } = usePipelineStage();
  const [aborted, setAborted] = useState<AbortedRun | null>(null);
  const pendingAbortRef = useRef<AbortedRun | null>(null);

  const activeStep = currentStepIndex >= 0 ? steps[currentStepIndex] : undefined;
  const activeTask = activeStep?.tasks.find((t) => t.status === 'active') ?? activeStep?.tasks[0];
  const assigneeName = activeTask?.assigneeName ?? activeTask?.employeeName ?? null;
  const stepLabel = activeStep
    ? `#${activeStep.stepIndex + 1} ${activeStep.description}`
    : fallbackHeadline(stage);

  // Clear the aborted banner once a fresh run begins.
  useEffect(() => {
    if (isRunning) {
      pendingAbortRef.current = null;
      setAborted(null);
    } else if (pendingAbortRef.current) {
      setAborted(pendingAbortRef.current);
      pendingAbortRef.current = null;
    }
  }, [isRunning]);

  if (isRunning) {
    const total = stats.total;
    const completed = stats.completed;
    const ratio = total > 0 ? Math.min(1, completed / total) : 0;
    return (
      <output
        aria-label="Plan progress · current step"
        className="pointer-events-auto absolute left-1/2 top-12 z-elevated inline-flex h-8 -translate-x-1/2 items-center gap-2.5 whitespace-nowrap rounded-r-pill border border-accent-ring bg-surface-1/[0.92] py-0 pl-3.5 pr-1.5 text-fs-meta text-ink-2 shadow-elev-1 backdrop-blur-sm"
      >
        <span
          aria-hidden="true"
          className="relative size-2 shrink-0 rounded-full bg-accent before:absolute before:-inset-1 before:animate-pulse before:rounded-full before:border-[1.5px] before:border-accent-ring"
        />
        <span className="max-w-56 truncate font-semibold text-ink-1" title={stepLabel}>
          {stepLabel}
        </span>
        {assigneeName ? <span className="text-ink-3">· {assigneeName}</span> : null}
        {total > 0 ? (
          <>
            <span aria-hidden="true" className="h-3.5 w-px bg-line" />
            <span className="inline-flex items-center gap-1 font-mono text-fs-micro text-ink-3">
              <span className="relative h-1 w-16 overflow-hidden rounded-sm bg-line">
                <i
                  className="absolute inset-y-0 left-0 block bg-accent"
                  style={{ width: `${Math.round(ratio * 100)}%` }} // ui-hardcode-allowed: runtime progress width.
                />
              </span>
              {completed}/{total}
            </span>
          </>
        ) : null}
        {pendingInteraction ? (
          <>
            <span aria-hidden="true" className="h-3.5 w-px bg-line" />
            <span className="rounded-r-pill bg-warn-surface px-2 py-0.5 text-fs-micro font-bold uppercase text-warn">
              Needs input
            </span>
          </>
        ) : null}
        <span aria-hidden="true" className="h-3.5 w-px bg-line" />
        <Button
          type="button"
          variant="ghost"
          title="Stop execution"
          onClick={() => {
            pendingAbortRef.current = { stepLabel, threadId: activeThreadId };
            abortExecution();
          }}
          className={cn(
            'inline-flex h-6 items-center gap-1.5 rounded-r-pill bg-danger-surface px-2.5',
            'text-fs-micro font-bold uppercase tracking-wide text-danger transition-colors hover:bg-danger/15',
          )}
        >
          <Square className="size-3 fill-current" aria-hidden="true" />
          Stop
        </Button>
      </output>
    );
  }

  if (aborted) {
    return (
      <div className="pointer-events-auto absolute left-1/2 top-24 z-elevated flex -translate-x-1/2 flex-col items-center gap-2">
        <div className="inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-r-pill border border-line bg-surface-1/[0.92] px-3.5 text-fs-meta text-ink-2 shadow-elev-1 backdrop-blur-sm">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-ink-4" />
          <span className="font-semibold text-ink-2">Stopped at {aborted.stepLabel}</span>
        </div>
        <div className="inline-flex items-center gap-1.5">
          {aborted.threadId ? (
            <Button
              type="button"
              variant="outline"
              title="Resume this run"
              onClick={() => {
                const target = aborted.threadId;
                setAborted(null);
                if (target) void resumeThread(target);
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded-r-pill border border-accent-ring bg-accent-surface px-3 text-fs-meta font-semibold text-accent transition-colors hover:bg-accent/10"
            >
              <ArrowRight className="size-3.5" aria-hidden="true" />
              Resume
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            title="Discard the stopped run"
            onClick={() => setAborted(null)}
            className="inline-flex h-7 items-center gap-1.5 rounded-r-pill border border-line bg-surface-1 px-3 text-fs-meta font-semibold text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2"
          >
            <X className="size-3.5" aria-hidden="true" />
            Discard
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
