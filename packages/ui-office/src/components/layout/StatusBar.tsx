import type { ProjectStatus } from '@offisim/shared-types';
import { Button } from '@offisim/ui-core';
import { Activity, Cpu, Square } from 'lucide-react';
import type { ReactNode } from 'react';
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics';
import { STAGE_META, usePipelineStage } from '../../hooks/usePipelineStage';
import {
  type OffisimRuntimeInteractionValue,
  useOffisimRuntimeExecution,
  useOffisimRuntimeInteraction,
  useOffisimRuntimeStatus,
} from '../../runtime/offisim-runtime-context';
import { useRuntimeActivityFeed } from '../../runtime/use-runtime-activity-feed';
import { EnergyMeter } from './EnergyMeter.js';

function pendingInteractionLabel(
  pendingInteraction: NonNullable<OffisimRuntimeInteractionValue['pendingInteraction']>,
): string {
  switch (pendingInteraction.kind) {
    case 'permission_request':
      return pendingInteraction.severity === 'high' ? 'Approval required' : 'Awaiting approval';
    case 'plan_review':
      return 'Awaiting plan review';
    case 'agent_question':
      return 'Awaiting clarification';
    default:
      return pendingInteraction.severity === 'high' ? 'Decision required' : 'Awaiting input';
  }
}

const PROJECT_STATUS_STYLE: Record<ProjectStatus, { label: string; color: string }> = {
  planning: { label: 'Planning', color: 'text-info' },
  active: { label: 'Active', color: 'text-success' },
  paused: { label: 'Paused', color: 'text-warning' },
  completed: { label: 'Done', color: 'text-text-muted' },
  archived: { label: 'Archived', color: 'text-text-muted' },
};

const SEGMENT_BASE_CLS = 'flex items-center gap-3 text-caption tracking-wider';
const DIVIDER_CLS = 'h-3 w-px bg-border-subtle';

interface StatusBarProps {
  modelName?: string;
  activeProjectStatus?: ProjectStatus | null;
  dashboardSlot?: ReactNode;
  notificationSlot?: ReactNode;
  gitBranchSlot?: ReactNode;
}

export function StatusBar({
  modelName,
  activeProjectStatus,
  dashboardSlot,
  notificationSlot,
  gitBranchSlot,
}: StatusBarProps) {
  const { abortExecution, error } = useOffisimRuntimeExecution();
  const { pendingInteraction } = useOffisimRuntimeInteraction();
  const { isRunning } = useOffisimRuntimeStatus();
  const metrics = useDashboardMetrics();
  const { stage: pipelineStage } = usePipelineStage();
  const { headline, activeTools } = useRuntimeActivityFeed({ maxEntries: 0 });
  const runStatus = isRunning ? 'running' : error ? 'error' : 'idle';

  return (
    <footer
      className="relative flex items-center justify-between overflow-hidden border-t border-border-subtle bg-surface-elevated/90 text-caption tracking-wider text-text-secondary backdrop-blur-xl"
      style={{ minHeight: '40px', paddingInline: 'var(--sp-lg)' }}
    >
      <RunStateSegment
        pipelineStage={pipelineStage}
        runStatus={runStatus}
        activeProjectStatus={activeProjectStatus ?? null}
        pendingInteraction={pendingInteraction}
      />

      {(dashboardSlot || notificationSlot || gitBranchSlot) && (
        <div className="relative z-10 flex items-center gap-2 pl-3">
          {dashboardSlot}
          {notificationSlot}
          {gitBranchSlot}
        </div>
      )}

      <WorkSegment
        headline={headline}
        toolsCount={activeTools.length}
        tasksCount={metrics.activeTaskCount}
        employeesActive={metrics.employeeUtilization.active}
        employeesTotal={metrics.employeeUtilization.total}
        isRunning={isRunning}
      />

      <ResourcesSegment
        modelName={modelName}
        usedTokens={metrics.totalInputTokens + metrics.totalOutputTokens}
        costUsd={metrics.estimatedCostUsd}
        elapsedMs={metrics.elapsedMs}
        isRunning={isRunning}
        onAbort={abortExecution}
      />
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Left — run state
// ---------------------------------------------------------------------------

function RunStateSegment({
  pipelineStage,
  runStatus,
  activeProjectStatus,
  pendingInteraction,
}: {
  pipelineStage: ReturnType<typeof usePipelineStage>['stage'];
  runStatus: 'running' | 'error' | 'idle';
  activeProjectStatus: ProjectStatus | null;
  pendingInteraction: OffisimRuntimeInteractionValue['pendingInteraction'];
}) {
  return (
    <div className={`${SEGMENT_BASE_CLS} relative z-10`}>
      <div className="flex items-center gap-2">
        {pipelineStage ? (
          <>
            <div
              className={`h-2 w-2 animate-pulse rounded-full ${STAGE_META[pipelineStage].dotClass}`}
              title={`Pipeline stage: ${STAGE_META[pipelineStage].label}`}
            />
            <span
              className={`font-bold uppercase ${STAGE_META[pipelineStage].colorClass}`}
              title={`Pipeline stage: ${STAGE_META[pipelineStage].label}`}
            >
              {STAGE_META[pipelineStage].label}
            </span>
          </>
        ) : (
          <>
            <div
              className={`h-2 w-2 rounded-full ${runStatus === 'running' ? 'animate-pulse bg-success' : runStatus === 'error' ? 'bg-error' : 'bg-text-muted'}`}
              title={`Runtime status: ${runStatus}`}
            />
            <span
              className={`font-bold uppercase ${runStatus === 'running' ? 'text-success' : runStatus === 'error' ? 'text-error' : 'text-text-secondary'}`}
              title={`Runtime status: ${runStatus}`}
            >
              {runStatus === 'running' ? 'Running' : runStatus === 'error' ? 'Error' : 'Ready'}
            </span>
          </>
        )}
      </div>

      {activeProjectStatus && (
        <>
          <div className={DIVIDER_CLS} />
          <span
            className={`font-semibold uppercase ${PROJECT_STATUS_STYLE[activeProjectStatus].color}`}
            title={`Project status: ${PROJECT_STATUS_STYLE[activeProjectStatus].label}`}
          >
            {PROJECT_STATUS_STYLE[activeProjectStatus].label}
          </span>
        </>
      )}

      {pendingInteraction && (
        <>
          <div className={DIVIDER_CLS} />
          <span
            className="rounded-full border border-warning/40 bg-warning-muted px-2 py-0.5 font-semibold uppercase text-warning"
            title={pendingInteractionLabel(pendingInteraction)}
          >
            {pendingInteractionLabel(pendingInteraction)}
          </span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Center — work cluster
// ---------------------------------------------------------------------------

function WorkSegment({
  headline,
  toolsCount,
  tasksCount,
  employeesActive,
  employeesTotal,
  isRunning,
}: {
  headline: string | null | undefined;
  toolsCount: number;
  tasksCount: number;
  employeesActive: number;
  employeesTotal: number;
  isRunning: boolean;
}) {
  const hasCluster = toolsCount > 0 || tasksCount > 0 || (isRunning && employeesTotal > 0);
  if (!headline && !hasCluster) return null;
  return (
    <div className={`${SEGMENT_BASE_CLS} relative z-10 min-w-0 flex-1 justify-center`}>
      {headline && (
        <div className="flex max-w-status-headline items-center gap-1.5 min-w-0" title={headline}>
          <Activity className="h-3 w-3 shrink-0 text-accent" />
          <span className="truncate font-mono text-accent-text">{headline}</span>
        </div>
      )}
      {headline && hasCluster && <div className={DIVIDER_CLS} />}
      {hasCluster && (
        <WorkCluster
          toolsCount={toolsCount}
          tasksCount={tasksCount}
          employeesActive={employeesActive}
          employeesTotal={employeesTotal}
          isRunning={isRunning}
        />
      )}
    </div>
  );
}

function WorkCluster({
  toolsCount,
  tasksCount,
  employeesActive,
  employeesTotal,
  isRunning,
}: {
  toolsCount: number;
  tasksCount: number;
  employeesActive: number;
  employeesTotal: number;
  isRunning: boolean;
}) {
  const parts: { key: string; text: string; title: string }[] = [];
  if (toolsCount > 0) {
    parts.push({
      key: 'tools',
      text: `${toolsCount}t`,
      title: `${toolsCount} tool calls running`,
    });
  }
  if (tasksCount > 0) {
    parts.push({
      key: 'tasks',
      text: `${tasksCount}T`,
      title: `${tasksCount} active tasks`,
    });
  }
  if (isRunning && employeesTotal > 0) {
    parts.push({
      key: 'employees',
      text: `${employeesActive}/${employeesTotal}P`,
      title: `${employeesActive} active of ${employeesTotal} employees`,
    });
  }
  if (parts.length === 0) return null;
  const composedTitle = parts.map((p) => p.title).join(' · ');
  return (
    <div className="flex items-center gap-1.5 font-mono text-text-secondary" title={composedTitle}>
      {parts.map((part, idx) => (
        <span key={part.key} className="flex items-center" title={part.title}>
          {idx > 0 && <span className="px-1 text-text-disabled">·</span>}
          {part.text}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right — resources
// ---------------------------------------------------------------------------

function ResourcesSegment({
  modelName,
  usedTokens,
  costUsd,
  elapsedMs,
  isRunning,
  onAbort,
}: {
  modelName?: string;
  usedTokens: number;
  costUsd: number;
  elapsedMs: number | null | undefined;
  isRunning: boolean;
  onAbort: () => void;
}) {
  return (
    <div className={`${SEGMENT_BASE_CLS} relative z-10`}>
      {modelName && (
        <div className="flex items-center gap-1.5 font-mono" title={`Model: ${modelName}`}>
          <Cpu className="h-3 w-3 text-info" />
          <span>{modelName}</span>
        </div>
      )}

      <EnergyMeter usedTokens={usedTokens} costUsd={costUsd} />

      {elapsedMs != null && (
        <span className="font-mono" title={`Latency ${(elapsedMs / 1000).toFixed(1)} seconds`}>
          LAT: {(elapsedMs / 1000).toFixed(1)}s
        </span>
      )}

      {isRunning && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-2 text-caption text-text-secondary hover:bg-error-muted hover:text-error"
          onClick={onAbort}
          title="Stop execution"
        >
          <Square className="h-2.5 w-2.5 fill-current" />
          Stop
        </Button>
      )}

      <div className={DIVIDER_CLS} />

      <div
        className="flex items-center gap-1.5 font-mono opacity-40 transition-opacity hover:opacity-100"
        title="Offisim runtime build v1.0.0-rc.1"
      >
        <Activity className="h-3 w-3" />
        <span>v1.0.0-rc.1</span>
      </div>
    </div>
  );
}
