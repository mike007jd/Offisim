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
import {
  StagePipeActionButton,
  StagePipeActionRow,
  StagePipeBadge,
  StagePipeDivider,
  StagePipeInlineGroup,
  StagePipePill,
  StagePipeProgress,
  StagePipeStoppedPill,
  StagePipeStoppedStack,
  StageRunStatusDot,
} from './StageRunSurfaces';

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
      <StagePipePill aria-label="Plan progress · current step">
        <StageRunStatusDot state="running" />
        <span className="max-w-56 truncate font-semibold text-ink-1" title={stepLabel}>
          {stepLabel}
        </span>
        {assigneeName ? <span className="text-ink-3">· {assigneeName}</span> : null}
        {total > 0 ? (
          <>
            <StagePipeDivider />
            <StagePipeInlineGroup className="font-mono text-fs-micro text-ink-3">
              <StagePipeProgress ratio={ratio} />
              <output aria-label="Completed plan steps">
                {completed}/{total}
              </output>
            </StagePipeInlineGroup>
          </>
        ) : null}
        {pendingInteraction ? (
          <>
            <StagePipeDivider />
            <StagePipeBadge>Needs input</StagePipeBadge>
          </>
        ) : null}
        <StagePipeDivider />
        <StagePipeActionButton
          type="button"
          tone="danger"
          title="Stop execution"
          onClick={() => {
            pendingAbortRef.current = { stepLabel, threadId: activeThreadId };
            abortExecution();
          }}
        >
          <Square className="size-3 fill-current" aria-hidden="true" />
          Stop
        </StagePipeActionButton>
      </StagePipePill>
    );
  }

  if (aborted) {
    return (
      <StagePipeStoppedStack>
        <StagePipeStoppedPill>
          <StageRunStatusDot state="idle" />
          <span className="font-semibold text-ink-2">Stopped at {aborted.stepLabel}</span>
        </StagePipeStoppedPill>
        <StagePipeActionRow>
          {aborted.threadId ? (
            <StagePipeActionButton
              type="button"
              tone="accent"
              title="Resume this run"
              onClick={() => {
                const target = aborted.threadId;
                setAborted(null);
                if (target) void resumeThread(target);
              }}
            >
              <ArrowRight className="size-3.5" aria-hidden="true" />
              Resume
            </StagePipeActionButton>
          ) : null}
          <StagePipeActionButton
            type="button"
            tone="neutral"
            title="Discard the stopped run"
            onClick={() => setAborted(null)}
          >
            <X className="size-3.5" aria-hidden="true" />
            Discard
          </StagePipeActionButton>
        </StagePipeActionRow>
      </StagePipeStoppedStack>
    );
  }

  return null;
}
