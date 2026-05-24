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
  StagePipeAssignee,
  StagePipeBadge,
  StagePipeCodeGroup,
  StagePipeDivider,
  StagePipeIcon,
  StagePipePill,
  StagePipeProgress,
  StagePipeStepLabel,
  StagePipeStoppedLabel,
  StagePipeStoppedPill,
  StagePipeStoppedStack,
  StageStatusDot,
} from './StageShellSurfaces';

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
 * Shell run-state control. While a run is live, a single rail pill shows the
 * current step + assignee + progress and a Stop control that invokes the existing
 * abortExecution() path. Stop is intentionally outside the composer.
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
        <StageStatusDot state="running" />
        <StagePipeStepLabel title={stepLabel}>{stepLabel}</StagePipeStepLabel>
        {assigneeName ? <StagePipeAssignee>· {assigneeName}</StagePipeAssignee> : null}
        {total > 0 ? (
          <>
            <StagePipeDivider />
            <StagePipeCodeGroup>
              <StagePipeProgress ratio={ratio} />
              <output aria-label="Completed plan steps">
                {completed}/{total}
              </output>
            </StagePipeCodeGroup>
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
          <StagePipeIcon tone="solid">
            <Square aria-hidden="true" />
          </StagePipeIcon>
          Stop
        </StagePipeActionButton>
      </StagePipePill>
    );
  }

  if (pendingInteraction) {
    return (
      <StagePipePill aria-label="Plan progress · input required">
        <StageStatusDot state="pending" />
        <StagePipeStepLabel title={pendingInteraction.title}>
          {pendingInteraction.title}
        </StagePipeStepLabel>
        <StagePipeDivider />
        <StagePipeBadge>Needs input</StagePipeBadge>
      </StagePipePill>
    );
  }

  if (aborted) {
    return (
      <StagePipeStoppedStack>
        <StagePipeStoppedPill>
          <StageStatusDot state="idle" />
          <StagePipeStoppedLabel>Stopped at {aborted.stepLabel}</StagePipeStoppedLabel>
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
              <StagePipeIcon>
                <ArrowRight aria-hidden="true" />
              </StagePipeIcon>
              Resume
            </StagePipeActionButton>
          ) : null}
          <StagePipeActionButton
            type="button"
            tone="neutral"
            title="Discard the stopped run"
            onClick={() => setAborted(null)}
          >
            <StagePipeIcon>
              <X aria-hidden="true" />
            </StagePipeIcon>
            Discard
          </StagePipeActionButton>
        </StagePipeActionRow>
      </StagePipeStoppedStack>
    );
  }

  return null;
}
