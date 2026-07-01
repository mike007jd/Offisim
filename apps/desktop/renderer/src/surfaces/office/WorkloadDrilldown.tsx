import { useUiState } from '@/app/ui-state.js';
import type { WorkloadPriorityIssue } from '@/assistant/runtime/conversation-run-projections.js';
import {
  useActiveConversationRuns,
  useEmployeeWorkloads,
} from '@/assistant/runtime/conversation-run-react.js';
import { useOfficeBeats } from '@/assistant/runtime/office-dramaturgy.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { useEmployees } from '@/data/queries.js';
import { cn } from '@/lib/utils.js';
import {
  type ClaimableArtifact,
  openArtifactClaim,
} from '@/surfaces/office/stage-viewer/artifact-claim.js';
import { beatToClaimable, workKindLabel } from '@/surfaces/office/scene/workload-chips.js';
import type { SceneBeat } from '@offisim/shared-types';
import {
  AlertOctagon,
  ExternalLink,
  FileText,
  GitCompare,
  HandHelping,
  Layers,
  MessageSquare,
  Package,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useMemo } from 'react';

/**
 * The read-only workload drilldown drawer (INC-5). Opened from an office actor /
 * workload bubble / delivery chip via `openWorkloadDrilldown(employeeId)`; it
 * self-gates on `workloadDrilldown` state and renders nothing when closed or when
 * the target employee has no live workload projection.
 *
 * INSPECT-ONLY by contract: it surfaces the deterministic workload projection
 * (status/work-kind distribution, priority issues, artifacts, approvals, run
 * rows) and offers navigation affordances only — open an artifact/file on the
 * stage, jump to the owning thread. It NEVER edits a child run's prompt/persona,
 * spawns/terminates a worker, renames a run, or exposes any lifecycle control.
 */
export function WorkloadDrilldown() {
  const drilldown = useUiState((s) => s.workloadDrilldown);
  const closeWorkloadDrilldown = useUiState((s) => s.closeWorkloadDrilldown);
  const projectId = useUiState((s) => s.projectId);
  const companyId = useUiState((s) => s.companyId);
  const openStageView = useUiState((s) => s.openStageView);
  const openThread = useUiState((s) => s.openThread);

  const employees = useEmployees();
  const workloads = useEmployeeWorkloads(projectId, companyId);
  const runs = useActiveConversationRuns();
  const beats = useOfficeBeats(companyId);

  const employeeId = drilldown?.employeeId ?? null;
  const projection = employeeId ? workloads.get(employeeId) : undefined;
  const employee = useMemo(
    () => (employeeId ? employees.data?.find((e) => e.id === employeeId) : undefined),
    [employees.data, employeeId],
  );

  // Run rows: the employee's root run (if any) plus every delegation across the
  // active-run snapshot attributed to this employee. Delegations carry no thread
  // of their own, so jump-to-thread routes through the owning root run's thread.
  const runRows = useMemo<RunRow[]>(() => {
    if (!employeeId) return [];
    const rows: RunRow[] = [];
    for (const run of runs.runs) {
      if (run.projectId !== projectId) continue;
      if (run.attemptId && run.employeeId === employeeId) {
        rows.push({ runId: run.attemptId, state: 'running', threadId: run.threadId });
      }
      for (const delegation of run.delegations) {
        if (delegation.employeeId !== employeeId) continue;
        rows.push({
          runId: delegation.runId,
          objective: delegation.objective,
          summary: delegation.summary,
          state: delegation.state,
          threadId: run.threadId,
        });
      }
    }
    return rows;
  }, [employeeId, runs.runs, projectId]);

  // Artifacts: the live artifact beats for this employee's runs, newest last —
  // each is a claimable stage target (same projection the scene delivery shelf
  // uses). Kept small; the drawer is an inspector, not a file browser.
  const artifacts = useMemo<ClaimableArtifact[]>(() => {
    if (!projection) return [];
    const activeSet = new Set(projection.activeRunIds);
    return beats
      .filter((beat) => beat.artifact && (beat.employeeId === employeeId || activeSet.has(beat.runId)))
      .slice(-8)
      .map((beat) => beatToClaimable(beat))
      .filter((claim): claim is ClaimableArtifact => claim !== null);
  }, [beats, projection, employeeId]);

  if (!employeeId || !projection) return null;

  const summary = projection.workloadSummary;
  const name = employee?.name ?? 'Employee';
  const role = employee?.role ?? employee?.discipline ?? 'Team member';
  const dominantBeat = projection.dominant?.beat ?? null;
  const dominantLabel = dominantBeat ? beatLabel(dominantBeat) : null;

  const statusCells = STATUS_ORDER.filter((key) => summary.byStatus[key] > 0).map((key) => ({
    key,
    label: STATUS_LABEL[key],
    tone: STATUS_TONE[key],
    count: summary.byStatus[key],
  }));
  const workKindCells = Object.entries(summary.byWorkKind)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([kind, count]) => ({ label: workKindLabel(kind), count }));

  return (
    <aside className="off-drill" aria-label={`Workload for ${name}`}>
      <header className="off-drill-head">
        <div className="off-drill-identity">
          <span className="off-drill-name">{name}</span>
          <span className="off-drill-role">{role}</span>
        </div>
        <button
          type="button"
          className="off-drill-close off-focusable"
          onClick={closeWorkloadDrilldown}
          aria-label="Close workload drawer"
        >
          <Icon icon={X} size="sm" />
        </button>
      </header>

      <div className="off-drill-body">
        <div className="off-drill-summary">
          <span className="off-drill-summary-num">{projection.activeCount}</span>
          <span className="off-drill-summary-label">
            active {projection.activeCount === 1 ? 'run' : 'runs'}
            {summary.total > projection.activeCount ? ` · ${summary.total} in set` : ''}
          </span>
        </div>

        {statusCells.length > 0 ? (
          <section className="off-drill-section">
            <h3 className="off-drill-h">
              <Icon icon={Layers} size="sm" />
              Status
            </h3>
            <div className="off-drill-chips">
              {statusCells.map((cell) => (
                <span key={cell.key} className={cn('off-drill-chip', `is-${cell.tone}`)}>
                  {cell.label}
                  <b>{cell.count}</b>
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {workKindCells.length > 0 ? (
          <section className="off-drill-section">
            <h3 className="off-drill-h">Work</h3>
            <div className="off-drill-chips">
              {workKindCells.map((cell) => (
                <span key={cell.label} className="off-drill-chip is-work">
                  {cell.label}
                  <b>{cell.count}</b>
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {dominantLabel ? (
          <section className="off-drill-section">
            <h3 className="off-drill-h">Latest beat</h3>
            <p className="off-drill-beat">{dominantLabel}</p>
          </section>
        ) : null}

        {summary.priorityIssues.length > 0 ? (
          <section className="off-drill-section">
            <h3 className="off-drill-h">
              <Icon icon={TriangleAlert} size="sm" />
              Issues
            </h3>
            <ul className="off-drill-issues">
              {summary.priorityIssues.map((issue) => (
                <li
                  key={`${issue.runId}-${issue.kind}`}
                  className={cn('off-drill-issue', `is-${issue.severity}`)}
                >
                  <Icon icon={issueIcon(issue)} size="sm" />
                  <span className="off-drill-issue-label">{issue.label}</span>
                  <span className="off-drill-issue-tags">
                    {issue.terminal ? <em className="off-drill-tag">terminal</em> : null}
                    <em className="off-drill-tag">{issue.severity}</em>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {artifacts.length > 0 ? (
          <section className="off-drill-section">
            <h3 className="off-drill-h">
              <Icon icon={Package} size="sm" />
              Artifacts
              <span className="off-drill-count">{summary.artifactCount}</span>
            </h3>
            <ul className="off-drill-list">
              {artifacts.map((artifact, index) => (
                <li
                  key={`${artifact.deliverableId ?? artifact.path ?? artifact.title}-${index}`}
                  className="off-drill-artifact"
                >
                  <button
                    type="button"
                    className="off-drill-row off-focusable"
                    onClick={() => void openArtifactClaim(artifact, { openStageView, projectId })}
                  >
                    <Icon icon={artifact.path ? FileText : Package} size="sm" />
                    <span className="off-drill-row-title">{artifact.title}</span>
                    <Icon icon={ExternalLink} size="sm" className="off-drill-row-go" />
                  </button>
                  {artifact.path ? (
                    // A path-bearing artifact can also be reviewed as a diff through
                    // the existing `changes` target (PRD drilldown minimum action),
                    // not only previewed inline.
                    <button
                      type="button"
                      className="off-drill-row-action off-focusable"
                      title="Review changes"
                      aria-label={`Review changes in ${artifact.title}`}
                      onClick={() => openStageView({ kind: 'changes', path: artifact.path })}
                    >
                      <Icon icon={GitCompare} size="sm" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {summary.approvalCount > 0 ? (
          <section className="off-drill-section">
            <h3 className="off-drill-h">
              <Icon icon={HandHelping} size="sm" />
              Approvals
              <span className="off-drill-count">{summary.approvalCount}</span>
            </h3>
            <p className="off-drill-note">
              {summary.approvalCount} run{summary.approvalCount === 1 ? '' : 's'} awaiting approval.
            </p>
          </section>
        ) : null}

        {runRows.length > 0 ? (
          <section className="off-drill-section">
            <h3 className="off-drill-h">
              <Icon icon={MessageSquare} size="sm" />
              Runs
            </h3>
            <ul className="off-drill-list">
              {runRows.map((row) => (
                <li key={row.runId}>
                  <button
                    type="button"
                    className="off-drill-run off-focusable"
                    onClick={() => openThread(row.threadId)}
                    title="Open the owning thread"
                  >
                    <span className={cn('off-drill-run-state', `is-${row.state}`)} aria-hidden />
                    <span className="off-drill-run-main">
                      <span className="off-drill-run-title">
                        {row.objective?.trim() || 'Working'}
                      </span>
                      {row.summary ? (
                        <span className="off-drill-run-summary">{row.summary}</span>
                      ) : null}
                    </span>
                    <Icon icon={MessageSquare} size="sm" className="off-drill-row-go" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </aside>
  );
}

interface RunRow {
  readonly runId: string;
  readonly objective?: string;
  readonly summary?: string;
  readonly state: 'running' | 'done' | 'failed' | 'cancelled';
  readonly threadId: string;
}

const STATUS_ORDER = ['working', 'waiting', 'blocked', 'artifact'] as const;
const STATUS_LABEL: Record<(typeof STATUS_ORDER)[number], string> = {
  working: 'Working',
  waiting: 'Waiting',
  blocked: 'Blocked',
  artifact: 'Artifact',
};
const STATUS_TONE: Record<(typeof STATUS_ORDER)[number], string> = {
  working: 'work',
  waiting: 'wait',
  blocked: 'risk',
  artifact: 'done',
};

/** Icon for a priority issue by kind. */
function issueIcon(issue: WorkloadPriorityIssue) {
  if (issue.kind === 'approval') return HandHelping;
  if (issue.kind === 'failure') return AlertOctagon;
  return TriangleAlert;
}

/** A short, deterministic label for the dominant beat (no motion, no time read). */
function beatLabel(beat: SceneBeat): string {
  if (beat.resource) return beat.resource.label;
  if (beat.flow) return beat.flow.label;
  if (beat.artifact) return beat.artifact.title;
  const badge = beat.visual.badges[0];
  if (badge) return `${badge.charAt(0).toUpperCase()}${badge.slice(1)}`;
  return `${beat.visual.phase.charAt(0).toUpperCase()}${beat.visual.phase.slice(1)}`;
}
