import {
  ActivityRail,
  useDashboardMetrics,
  useOffisimRuntimeStatus,
  usePlanStepStore,
} from '@offisim/ui-office/web';
import { X } from 'lucide-react';
import {
  StageRunCloseButton,
  StageRunCountBadge,
  StageRunEmpty,
  StageRunHeader,
  StageRunHeaderGroup,
  StageRunKicker,
  StageRunMeta,
  StageRunPanel,
  StageRunScrollArea,
  StageRunSection,
  StageRunSectionHeader,
  StageRunSectionTitle,
  StageRunStatusDot,
  StageRunStepBody,
  StageRunStepItem,
  StageRunStepList,
  StageRunStepMeta,
  StageRunStepStatusDot,
  StageRunStepTitle,
} from './StageRunSurfaces';

interface LiveRunOverlayProps {
  onClose: () => void;
}

type StageDotState = 'active' | 'completed' | 'failed' | 'pending';

function stageDotState(status: string): StageDotState {
  if (status === 'active' || status === 'completed' || status === 'failed') return status;
  return 'pending';
}

function formatCost(costUsd: number): string {
  if (costUsd <= 0) return '$0.00';
  return costUsd < 0.01 ? '$0.01<' : `$${costUsd.toFixed(2)}`;
}

/**
 * Run-broadcast overlay opened from the stage run-axis Live entry. Surfaces the
 * current run's Plan (steps + per-step assignee) and live Activity. Latency
 * relocates here from the deleted StatusBar — it lives in this header, NOT in the
 * persistent `.scene-cost` readout. This is the Live entry shell + active state;
 * the run-record sediment data contract is owned by the Phase 1 chat-rail rebuild.
 */
export function LiveRunOverlay({ onClose }: LiveRunOverlayProps) {
  const { steps, currentStepIndex, stats } = usePlanStepStore();
  const { isRunning } = useOffisimRuntimeStatus();
  const metrics = useDashboardMetrics();
  const latencyLabel =
    metrics.elapsedMs != null ? `${(metrics.elapsedMs / 1000).toFixed(1)}s latency` : null;

  return (
    <StageRunPanel>
      <StageRunHeader>
        <StageRunHeaderGroup>
          <StageRunStatusDot state={isRunning ? 'running' : 'idle'} />
          <StageRunKicker>Live run</StageRunKicker>
          <StageRunMeta>
            {latencyLabel ? `${latencyLabel} · ` : ''}
            {formatCost(metrics.estimatedCostUsd)}
          </StageRunMeta>
        </StageRunHeaderGroup>
        <StageRunCloseButton type="button" aria-label="Close live run overlay" onClick={onClose}>
          <X aria-hidden="true" />
        </StageRunCloseButton>
      </StageRunHeader>

      <StageRunScrollArea>
        <StageRunSection>
          <StageRunSectionHeader>
            <StageRunSectionTitle>Plan</StageRunSectionTitle>
            {stats.total > 0 ? (
              <StageRunCountBadge>
                {stats.completed}/{stats.total}
              </StageRunCountBadge>
            ) : null}
          </StageRunSectionHeader>
          {steps.length === 0 ? (
            <StageRunEmpty>No plan yet — the run is still warming up.</StageRunEmpty>
          ) : (
            <StageRunStepList>
              {steps.map((step) => {
                const assignee =
                  step.tasks.find((t) => t.status === 'active')?.assigneeName ??
                  step.tasks[0]?.assigneeName ??
                  step.tasks[0]?.employeeName ??
                  null;
                const isCurrent = step.stepIndex === currentStepIndex;
                return (
                  <StageRunStepItem key={step.stepIndex} state={isCurrent ? 'current' : 'idle'}>
                    <StageRunStepStatusDot state={stageDotState(step.status)} />
                    <StageRunStepBody>
                      <StageRunStepTitle>
                        #{step.stepIndex + 1} {step.description}
                      </StageRunStepTitle>
                      {assignee ? <StageRunStepMeta>{assignee}</StageRunStepMeta> : null}
                    </StageRunStepBody>
                  </StageRunStepItem>
                );
              })}
            </StageRunStepList>
          )}
        </StageRunSection>

        <StageRunSection boundary="last">
          <StageRunSectionHeader>
            <StageRunSectionTitle>Activity</StageRunSectionTitle>
          </StageRunSectionHeader>
          <ActivityRail variant="full" />
        </StageRunSection>
      </StageRunScrollArea>
    </StageRunPanel>
  );
}
