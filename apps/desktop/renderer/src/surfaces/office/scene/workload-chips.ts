import type {
  EmployeeWorkloadProjection,
  WorkloadPriorityIssue,
} from '@/assistant/runtime/conversation-run-projections.js';
import type { ClaimableArtifact } from '@/surfaces/office/stage-viewer/artifact-claim.js';
import type { SceneBeat } from '@offisim/shared-types';

/**
 * The generic workload chip tone vocabulary, shared by 2D and 3D scenes.
 * `risk` = blocked/resource/failure, `wait` = approval/waiting, `done` =
 * artifact/complete, `work` = ordinary in-flight work.
 */
type WorkloadChipTone = 'work' | 'wait' | 'risk' | 'done';

interface WorkloadGroupChip {
  readonly label: string;
  readonly tone: WorkloadChipTone;
  /** Present on grouped (medium/large) chips; absent on small per-run chips. */
  readonly count?: number;
}

type WorkloadTier = 'small' | 'medium' | 'large';

/**
 * A render-agnostic grouping of one employee's workload for the office bubble.
 * Both scene modes derive their bubble from this single projection so 2D and 3D
 * never drift. `small` keeps the per-run chip model; `medium`/`large` collapse
 * into priority-ordered grouped chips with counts.
 */
export interface GroupedWorkload {
  readonly tier: WorkloadTier;
  /** '×N' badge when more than one active run; null for a single run. */
  readonly countLabel: string | null;
  readonly activeCount: number;
  readonly chips: readonly WorkloadGroupChip[];
  /** More groups exist than are shown → the bubble offers a drilldown affordance. */
  readonly overflow: boolean;
  /** Highest-priority unresolved issue (drives the resource marker hierarchy). */
  readonly topIssue: WorkloadPriorityIssue | null;
}

const SMALL_MAX = 3;
const LARGE_MIN = 13;
const GROUPED_MAX_CHIPS = 4;

/** Human label for a workKind bucket key (capitalized; the catch-all reads 'Working'). */
export function workKindLabel(kind: string): string {
  if (kind === 'unclassified') return 'Working';
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

/**
 * Project a beat's artifact intent into a ClaimableArtifact (or null when the
 * beat carries no artifact). Shared by the 2D/3D delivery shelves and the
 * drilldown so all three build the claim from one place.
 */
export function beatToClaimable(beat: SceneBeat | undefined | null): ClaimableArtifact | null {
  if (!beat?.artifact) return null;
  return {
    title: beat.artifact.title,
    kind: beat.artifact.kind,
    deliverableId: beat.artifact.deliverableId,
    path: beat.artifact.path,
    threadId: beat.threadId,
  };
}

/** The per-run small-count chips, mapped from the existing workloadChips model. */
function smallChips(p: EmployeeWorkloadProjection): WorkloadGroupChip[] {
  const chips: WorkloadGroupChip[] = p.workloadChips
    .slice(0, SMALL_MAX)
    .map((chip) => ({ label: chip.label, tone: chip.tone }));
  // A terminal-only blocked actor (activeCount 0) has no per-run chips; surface
  // its top issue so the blocked state is never invisible.
  if (chips.length === 0 && p.workloadSummary.priorityIssues.length > 0) {
    const issue = p.workloadSummary.priorityIssues[0];
    if (issue) chips.push({ label: issue.label, tone: 'risk' });
  }
  return chips;
}

/**
 * Grouped chips for medium/large concurrency, in the PRD priority order:
 * 1. blocked/resource/failure, 2. approval/waiting, 3. artifact/done,
 * 4. dominant work-kind distribution. High-signal states are reserved a slot so
 * they outrank ordinary work even when many work kinds compete for space.
 */
function groupedChips(p: EmployeeWorkloadProjection): { chips: WorkloadGroupChip[]; groups: number } {
  const s = p.workloadSummary;
  const priority: WorkloadGroupChip[] = [];
  if (s.byStatus.blocked > 0) priority.push({ label: 'Blocked', tone: 'risk', count: s.byStatus.blocked });
  if (s.approvalCount > 0) priority.push({ label: 'Approval', tone: 'wait', count: s.approvalCount });
  if (s.artifactCount > 0) priority.push({ label: 'Artifact', tone: 'done', count: s.artifactCount });

  const workKinds = Object.entries(s.byWorkKind)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([kind, count]) => ({ label: workKindLabel(kind), tone: 'work' as const, count }));

  const groups = priority.length + workKinds.length;
  // Reserve the high-signal slots first, then fill remaining room with the
  // biggest work-kind buckets.
  const reserved = priority.slice(0, GROUPED_MAX_CHIPS);
  const room = GROUPED_MAX_CHIPS - reserved.length;
  const chips = [...reserved, ...workKinds.slice(0, room)];
  return { chips, groups };
}

/**
 * Project one employee's workload into a render-agnostic bubble grouping. Tiered
 * by the full member-set size: small (1-3) keeps the per-run chip model, medium
 * (4-12) and large (13+) collapse into priority-ordered grouped chips with
 * counts and an overflow affordance that opens the drilldown.
 */
export function groupedWorkload(p: EmployeeWorkloadProjection): GroupedWorkload {
  const total = p.workloadSummary.total;
  const tier: WorkloadTier = total <= SMALL_MAX ? 'small' : total < LARGE_MIN ? 'medium' : 'large';
  const countLabel = p.activeCount > 1 ? `×${p.activeCount}` : null;
  const topIssue = p.workloadSummary.priorityIssues[0] ?? null;

  if (tier === 'small') {
    const chips = smallChips(p);
    return { tier, countLabel, activeCount: p.activeCount, chips, overflow: false, topIssue };
  }

  const { chips, groups } = groupedChips(p);
  return {
    tier,
    countLabel,
    activeCount: p.activeCount,
    chips,
    overflow: groups > chips.length,
    topIssue,
  };
}
