/**
 * SceneCue projection — the single render-facing contract for the office.
 *
 * Every scene surface (2D canvas, 3D scene, workload drilldown, delivery shelf)
 * re-derives the same runtime facts today: signal-beat filtering + noise caps,
 * artifact→claimable mapping, flow target fallback, per-beat color choice,
 * `running`/`active` booleans, ×N badge + issue-marker hierarchy, and the
 * staging/dramaturgy-mode invocation. `projectSceneCues` collapses all of that
 * behind one pure, deterministic function; scenes keep only geometry (where a
 * target sits) and ink→hex mapping (one table per scene).
 *
 * Composition, never reimplementation: workload grouping is `groupedWorkload`,
 * claims are `beatToClaimable`, staging is `projectOfficeStaging` +
 * `applyDramaturgyMode`, and performance is the staged `performanceForBeat`
 * result plus the total approval/blocked fallback. Actor/workload COUNTS read
 * only the snapshot-derived workload projection; the rolling beat buffer feeds
 * flow/delivery/resource transients and the bounded artifact choreography, so
 * old beats can never undercount high-concurrency work.
 *
 * The projection is split so interaction never recomputes facts:
 * `projectSceneBaseFrame(facts)` derives everything from runtime facts alone
 * (interaction booleans false, no selected-thread attention arm), and
 * `applyInputState(frame, inputState)` overlays selection/hover/drag in
 * O(actors). `projectSceneCues` composes the two and stays the single-call
 * contract — byte-identical to the pre-split behavior.
 *
 * Pure function of its arguments: no store reads, no Date.now(), no randomness.
 * Identical input yields byte-identical output (JSON.stringify equality), and
 * the order of equal-timestamp beats in the input does not change the frame.
 */
import {
  type ActorStaging,
  type CharacterPerformanceState,
  type CharacterStatus,
  type DramaturgyMode,
  type FlowIntent,
  type ResourceKind,
  type SceneBeat,
  type StagingPrefab,
  type SurfacedResourceSeverity,
  type ToolRichDetail,
  applyDramaturgyMode,
  isBeatLive,
  performanceForStatus,
  projectOfficeStaging,
  resourceSeverityRank,
} from '@offisim/shared-types';
import {
  type EmployeeWorkloadProjection,
  type WorkloadPriorityIssue,
  dominantBeatsFrom,
} from './conversation-run-projections.js';

// ── Claimable artifacts (runtime-owned; stage-viewer resolves/opens them) ────

/**
 * A claimable artifact is any produced/tool/preview surface that can be opened
 * on the stage. It is intentionally structural (not a wire type): producers fill
 * whichever fields they have, and the stage-viewer's `resolveArtifactClaim`
 * picks the single canonical stage target it maps to.
 */
export interface ClaimableArtifact {
  readonly title: string;
  readonly kind: string;
  readonly deliverableId?: string;
  readonly path?: string;
  readonly url?: string;
  readonly sourceId?: string;
  readonly threadId?: string | null;
  /**
   * Owning employee, resolved during the delivery walk: the beat's named
   * employee, or the employee whose active run produced the claim. The scenes'
   * delivery-history route reads THIS (never a threadId join — a multi-thread
   * employee's non-first-thread claims would miss a first-thread-only join).
   */
  readonly employeeId?: string;
  readonly detail?: ToolRichDetail;
}

/**
 * Project a beat's artifact intent into a ClaimableArtifact (or null when the
 * beat carries no artifact). The single claim constructor behind the delivery
 * shelves and the per-actor artifact lists. `owner` is the resolved owning
 * employee (`beat.employeeId ?? employeeByRun.get(beat.runId)`); ownerless
 * claims omit the field.
 */
function beatToClaimable(
  beat: SceneBeat | undefined | null,
  owner: string | null,
): ClaimableArtifact | null {
  if (!beat?.artifact) return null;
  return {
    title: beat.artifact.title,
    kind: beat.artifact.kind,
    deliverableId: beat.artifact.deliverableId,
    path: beat.artifact.path,
    threadId: beat.threadId,
    ...(owner ? { employeeId: owner } : {}),
  };
}

// ── Workload grouping (the bubble projection every scene reads) ──────────────

/**
 * The generic workload chip tone vocabulary, shared by 2D and 3D scenes.
 * `risk` = blocked/resource/failure, `wait` = approval/waiting, `done` =
 * artifact/complete, `work` = ordinary in-flight work.
 */
export type WorkloadChipTone = 'work' | 'wait' | 'risk' | 'done';

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
function groupedChips(p: EmployeeWorkloadProjection): {
  chips: WorkloadGroupChip[];
  groups: number;
} {
  const s = p.workloadSummary;
  const priority: WorkloadGroupChip[] = [];
  if (s.byStatus.blocked > 0)
    priority.push({ label: 'Blocked', tone: 'risk', count: s.byStatus.blocked });
  if (s.approvalCount > 0)
    priority.push({ label: 'Approval', tone: 'wait', count: s.approvalCount });
  if (s.artifactCount > 0)
    priority.push({ label: 'Artifact', tone: 'done', count: s.artifactCount });

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

/** Live flow signals a scene draws at once (was the per-scene `slice(-8)`). */
const FLOW_NOISE_CAP = 8;
/** Delivery-shelf chip budget (was the per-scene `artifactBeats.slice(-3)`). */
const DELIVERY_CHIP_BUDGET = 3;
/** Per-actor artifact list budget (the drilldown inspector's `slice(-8)`). */
const ACTOR_ARTIFACT_BUDGET = 8;

/**
 * Semantic color role for a scene signal. Scenes map ink→hex in ONE place each
 * (OFFICE_SCENE_2D_COLORS / LIGHT_SCENE_3D); the projection never emits hex.
 */
export type SceneInk = 'work' | 'artifact' | 'risk' | 'approval' | 'neutral';

/** Semantic flow-signal vocabulary (what the packet MEANS, not where it goes). */
type FlowCueKind = 'fan-out' | 'fan-in' | 'tool' | 'approval' | 'artifact' | 'recovery' | 'failure';

/**
 * Flow target vocabulary — aliased to the wire's FlowIntent so a new target
 * can never drift past this layer silently. Geometry stays per-scene: 2D maps
 * a target to pixels, 3D to world coordinates.
 */
export type FlowCueTarget = FlowIntent['target'];

/**
 * Interaction state a scene feeds in. Every field optional: a scene lacking an
 * input source (2D has no drag) omits it and the cue degrades to `false`.
 * Selection is by EMPLOYEE: the hook resolves the ui-state thread selection to
 * its owning employee across ALL of that employee's threads (any-thread match),
 * so selecting a non-first thread still selects the actor. `ActorCue.threadId`
 * (the open-thread click target) keeps the first-thread join independently.
 */
interface SceneCueInputState {
  readonly selectedEmployeeId?: string | null;
  readonly hoveredEmployeeId?: string | null;
  readonly draggingEmployeeId?: string | null;
}

/** Runtime facts alone — everything `projectSceneBaseFrame` derives from. */
interface SceneCueFacts {
  /**
   * Roster employee ids — the actor universe. Every roster member gets an
   * ActorCue (resting when idle), so a never-messaged hire still stands on the
   * office floor exactly as the scenes render today.
   */
  readonly roster: readonly string[];
  /** Snapshot-derived workloads (projectEmployeeWorkloads) — the actor truth. */
  readonly workloads: ReadonlyMap<string, EmployeeWorkloadProjection>;
  /** Live company beats; the projection applies its own liveness cut at `now`. */
  readonly beats: readonly SceneBeat[];
  readonly now: number;
  /** Same staging inputs projectOfficeStaging takes today. */
  readonly prefabs: readonly StagingPrefab[];
  readonly actorPositions?: ReadonlyMap<string, { readonly x: number; readonly z: number }>;
  readonly mode: DramaturgyMode;
  readonly reducedMotion: boolean;
  /** employeeId → owning threadId (the scenes' threadByEmployee join). */
  readonly threadByEmployee: ReadonlyMap<string, string>;
}

export interface SceneCueInput extends SceneCueFacts {
  readonly inputState?: SceneCueInputState;
}

/**
 * One employee's workload bubble state. `primary` names which slot leads the
 * bubble: a blocked-severity issue takes the primary slot and the ×N count
 * demotes; otherwise the count leads.
 */
export interface WorkloadCue extends GroupedWorkload {
  readonly primary: 'issue' | 'count';
}

export interface ActorCue {
  readonly employeeId: string;
  readonly threadId: string | null;
  readonly selected: boolean;
  readonly hovered: boolean;
  readonly dragging: boolean;
  /** First-class P4 operational state. Selection stays orthogonal. */
  readonly status: CharacterStatus;
  /** A live artifact choreography currently owns this actor's direction. */
  readonly delivering: boolean;
  readonly running: boolean;
  /** Staged/status performance; null means the neutral posture fallback applies. */
  readonly performance: CharacterPerformanceState | null;
  /** Relocation anchor AFTER applyDramaturgyMode; null = stay home. */
  readonly staging: ActorStaging | null;
  readonly workload: WorkloadCue;
  /**
   * This actor's live claimable artifacts, newest last, capped at the
   * drilldown inspector budget (8). Attribution matches the drilldown rule:
   * the beat names this employee, or the beat's run belongs to this
   * employee's active runs (delegated children may carry no employeeId).
   */
  readonly artifacts: readonly ClaimableArtifact[];
}

/**
 * A bundled flow signal: all live signal beats sharing (employeeId, target,
 * kind) collapse into one cue so a 50-child fan-out draws one weighted line,
 * never fifty. `at` is the newest member's beat time — the scene's animation
 * phase anchor (packet position), so consumers need no raw-beat access.
 */
interface FlowCue {
  readonly employeeId: string;
  readonly kind: FlowCueKind;
  readonly target: FlowCueTarget;
  readonly ink: SceneInk;
  readonly pulse: boolean;
  readonly bundleCount: number;
  readonly at: number;
  /**
   * Human-readable line label (the 3D scene's flow-line text): the newest
   * member's `flow.label`, falling back to its visual phase.
   */
  readonly label: string;
}

/**
 * THE bundle stroke-weight rule both scenes share: a bundled cue (≥2 merged
 * signals) draws one step heavier. Scenes add this to their own ink-based base
 * width, so 2D and 3D can never drift on when a line reads "bundled".
 */
export function bundleEmphasis(cue: FlowCue): 0 | 1 {
  return cue.bundleCount >= 2 ? 1 : 0;
}

/** Max label characters on a lane before ellipsis (PRD: no text overflow). */
const FLOW_LABEL_MAX = 16;

/**
 * THE lane text rule both scenes share (I4): a single cue reads its `label`,
 * a bundled cue reads `×N · label` so the count is the primary density signal.
 * Labels ellipsize at {@link FLOW_LABEL_MAX} characters — 2D paints this text
 * over a backing pill at the curve midpoint, 3D at the flow-line label slot.
 */
export function flowCueText(cue: FlowCue): string {
  const label =
    cue.label.length > FLOW_LABEL_MAX ? `${cue.label.slice(0, FLOW_LABEL_MAX - 1)}…` : cue.label;
  return cue.bundleCount >= 2 ? `×${cue.bundleCount} · ${label}` : label;
}

/**
 * Compact anchor label per flow target — the scenes' shared vocabulary for the
 * purpose-distinct target anchors (a lane visibly goes SOMEWHERE). Geometry
 * stays per-scene; the wording never drifts between 2D and 3D.
 */
export const FLOW_TARGET_LABELS: Readonly<Record<FlowCueTarget, string>> = {
  workstation: 'Work',
  tool: 'Tool',
  review: 'Review',
  delivery: 'Delivery',
  user: 'User',
};

/**
 * THE six-kind resource marker glyph scheme (PRD: token/budget/permission/
 * context/runtime/tool must be distinguishable, not just severity):
 * T token · B budget · P permission · C context · R runtime · X tool-failed.
 * The marker keeps its severity shape/color hierarchy; the glyph types it.
 * 2D draws the glyph inside the marker disc, 3D inside the marker chip; `!`
 * stays the fallback for kindless issues (flow failures, approvals).
 */
export const RESOURCE_KIND_GLYPHS: Readonly<Record<ResourceKind, string>> = {
  token: 'T',
  budget: 'B',
  permission: 'P',
  context: 'C',
  runtime: 'R',
  tool: 'X',
};

interface DeliveryCue {
  /** Newest-last claimable chips, capped at the fixed chip budget (3). */
  readonly chips: readonly ClaimableArtifact[];
  /** All live artifact claims (the shelf's ×N figure). */
  readonly recentCount: number;
  /** Claims beyond the chip budget — routed to drilldown/history. */
  readonly overflowCount: number;
  readonly latest: ClaimableArtifact | null;
}

/**
 * One actor's top unresolved issue — the marker-hierarchy input shared by the
 * actor marker, the bubble, and the drilldown. `kind` is the workload issue
 * class; `resourceKind` is the typed strain (token/budget/permission/context/
 * runtime/tool) resolved from the live beat when the issue is a resource strain.
 */
interface ResourceCue {
  readonly employeeId: string;
  /** The top issue's owning run — consumers join cue↔issue by THIS identity,
   *  never by list position. */
  readonly runId: string;
  readonly kind: WorkloadPriorityIssue['kind'];
  readonly resourceKind: ResourceKind | null;
  readonly severity: SurfacedResourceSeverity;
  readonly label: string;
  readonly terminal: boolean;
}

/** Focus precedence: severe (blocked-severity) issue > selected thread > fresh delivery. */
interface AttentionCue {
  readonly target: 'employee' | 'delivery';
  readonly employeeId?: string;
  readonly reason: 'severe-issue' | 'selected-thread' | 'delivery';
}

export interface SceneCueFrame {
  readonly actors: readonly ActorCue[];
  readonly flows: readonly FlowCue[];
  readonly delivery: DeliveryCue;
  readonly resources: readonly ResourceCue[];
  readonly attention: AttentionCue | null;
}

const BLOCKED_RANK = resourceSeverityRank('blocked');

/** Blocked-severity gate shared by the bubble's primary slot and attention. */
function isBlockingIssue(issue: WorkloadPriorityIssue): boolean {
  return resourceSeverityRank(issue.severity) >= BLOCKED_RANK;
}

/**
 * The one operational-state classifier consumed by both scene modes. Priority
 * is fixed: blocked > approval > working/delivering > idle. Selection is not an
 * input and therefore cannot change business state or performance.
 */
function characterStatusFor(
  workload: EmployeeWorkloadProjection | undefined,
  delivering = false,
): CharacterStatus {
  if ((workload?.workloadSummary.byStatus.blocked ?? 0) > 0) return 'blocked';
  if ((workload?.workloadSummary.approvalCount ?? workload?.waitingCount ?? 0) > 0)
    return 'approval';
  if ((workload?.activeCount ?? 0) > 0 || delivering) return 'working';
  return 'idle';
}

/** Deterministic string comparator (sorts never depend on locale). */
function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The empty bubble for an idle actor (in the roster join but off the snapshot). */
const IDLE_WORKLOAD_CUE: WorkloadCue = Object.freeze({
  activeCount: 0,
  tier: 'small',
  countLabel: null,
  chips: Object.freeze([]) as GroupedWorkload['chips'],
  overflow: false,
  topIssue: null,
  primary: 'count',
});

/** Ink precedence when a bundle mixes classifications (risk always wins). */
const INK_RANK: Readonly<Record<SceneInk, number>> = {
  risk: 4,
  approval: 3,
  artifact: 2,
  work: 1,
  neutral: 0,
};

/**
 * Semantic kind for a signal beat. Flow intents map 1:1 (`delegation`→fan-out,
 * `join`→fan-in); a `task` dispatch reads as fan-out (work entering the office).
 * A recovering resource is `recovery` regardless of the flow it rides on. The
 * flowless fallback mirrors the target fallback: resource-only reads as
 * failure/risk, artifact-only as a delivery signal.
 */
function flowCueKind(beat: SceneBeat): FlowCueKind {
  if (beat.resource?.severity === 'recovering') return 'recovery';
  switch (beat.flow?.kind) {
    case 'delegation':
      return 'fan-out';
    case 'join':
      return 'fan-in';
    case 'tool':
      return 'tool';
    case 'approval':
      return 'approval';
    case 'artifact':
      return 'artifact';
    case 'failure':
      return 'failure';
    case 'task':
      return 'fan-out';
    default:
      return beat.resource ? 'failure' : 'artifact';
  }
}

/**
 * THE single source of the target fallback both scenes previously duplicated:
 * `beat.flow?.target ?? (beat.resource ? 'tool' : 'delivery')`.
 */
function flowCueTarget(beat: SceneBeat): FlowCueTarget {
  return beat.flow?.target ?? (beat.resource ? 'tool' : 'delivery');
}

/**
 * Semantic ink for a signal beat. An approval keeps its own amber role because
 * "waiting on the user" is not the same signal as "broken". A RECOVERING resource
 * also reads neutral (PRD: a quiet return to normal flow, never painted in the
 * failure red it just left). Otherwise resource strain wins, then artifact, then
 * the ordinary work stroke.
 */
function inkForBeat(beat: SceneBeat): SceneInk {
  if (beat.flow?.kind === 'approval') return 'approval';
  if (beat.resource?.severity === 'recovering') return 'neutral';
  if (beat.resource) return 'risk';
  if (beat.artifact) return 'artifact';
  switch (beat.flow?.kind) {
    case 'failure':
      return 'risk';
    case 'artifact':
      return 'artifact';
    case 'task':
    case 'delegation':
    case 'join':
    case 'tool':
      return 'work';
    default:
      return 'neutral';
  }
}

/** Pulse default matches the 2D dash rule: only an explicit `pulse: false` is static. */
function beatPulse(beat: SceneBeat): boolean {
  return beat.flow ? beat.flow.pulse : true;
}

/** Flow-line text (the 3D scene's label rule): flow label, else visual phase. */
function beatLabel(beat: SceneBeat): string {
  return beat.flow?.label ?? beat.visual.phase;
}

/** Shared frozen empty list keeps idle actors allocation-free and JSON-stable. */
const NO_ARTIFACTS: readonly ClaimableArtifact[] = Object.freeze([]);

/**
 * Fact half of the projection: derives every cue from runtime facts alone.
 * Interaction is absent by construction — actors carry `selected`/`hovered`/
 * `dragging: false` and attention knows only severe-issue > delivery — so
 * hover/drag/selection transitions never invalidate this computation.
 */
export function projectSceneBaseFrame(input: SceneCueFacts): SceneCueFrame {
  // Liveness + canonical order: expired beats drop, and equal-timestamp beats
  // resolve by their deterministic id so input arrival order never matters.
  const orderedBeats = input.beats
    .filter((beat) => isBeatLive(beat, input.now))
    .sort((a, b) => a.at - b.at || cmpStr(a.id, b.id));

  // ── Delivery + per-actor artifacts + typed strain, one walk over the live
  // beats: global claims in beat order, each claim attributed to its owner
  // (named employee, or the employee whose active run produced it — delegated
  // children may carry no employeeId), and the newest resource kind per run
  // (ascending order ⇒ last write wins).
  const employeeByRun = new Map<string, string>();
  for (const [employeeId, workload] of input.workloads) {
    for (const runId of workload.activeRunIds) employeeByRun.set(runId, employeeId);
  }
  const claims: ClaimableArtifact[] = [];
  const artifactsByEmployee = new Map<string, ClaimableArtifact[]>();
  const resourceKindByRun = new Map<string, ResourceKind>();
  // Newest live artifact per owner. It remains a choreography input even when
  // run.completed is the workload's newer dominant beat, so a fast terminal
  // event cannot cancel carry-to-shelf before the actor takes one step.
  const deliveryBeatByEmployee = new Map<string, SceneBeat>();
  for (const beat of orderedBeats) {
    if (beat.resource) resourceKindByRun.set(beat.runId, beat.resource.kind);
    const runOwner = employeeByRun.get(beat.runId) ?? null;
    const resolvedOwner = beat.employeeId ?? runOwner;
    const claim = beatToClaimable(beat, resolvedOwner);
    if (!claim) continue;
    if (resolvedOwner) {
      deliveryBeatByEmployee.set(
        resolvedOwner,
        beat.employeeId === resolvedOwner ? beat : { ...beat, employeeId: resolvedOwner },
      );
    }
    // The global shelf carries every owner-resolvable claim: a delegated
    // child's artifact (runOwner attribution, no beat.employeeId) is a real
    // delivery and must not vanish from the shelf/history while appearing in
    // its owner's actor list.
    if (claim.employeeId) claims.push(claim);
    const owners = beat.employeeId
      ? runOwner && runOwner !== beat.employeeId
        ? [beat.employeeId, runOwner]
        : [beat.employeeId]
      : runOwner
        ? [runOwner]
        : [];
    for (const owner of owners) {
      const list = artifactsByEmployee.get(owner);
      if (list) {
        list.push(claim);
        if (list.length > ACTOR_ARTIFACT_BUDGET) list.shift();
      } else {
        artifactsByEmployee.set(owner, [claim]);
      }
    }
  }
  const chips = claims.slice(-DELIVERY_CHIP_BUDGET);
  const delivery: DeliveryCue = {
    chips,
    recentCount: claims.length,
    overflowCount: Math.max(0, claims.length - chips.length),
    latest: chips[chips.length - 1] ?? null,
  };

  // ── Staging: the normal dominant active beat directs each actor, except a
  // still-live artifact milestone owns direction until its delivery lifecycle
  // ends. Blocked/approval truth wins over delivery for the same actor.
  const normalDirectionByEmployee = new Map(
    dominantBeatsFrom(input.workloads).flatMap((beat) =>
      beat.employeeId ? ([[beat.employeeId, beat]] as const) : [],
    ),
  );
  const directionByEmployee = new Map(normalDirectionByEmployee);
  for (const [employeeId, beat] of deliveryBeatByEmployee) {
    const state = characterStatusFor(input.workloads.get(employeeId));
    if (state !== 'blocked' && state !== 'approval') directionByEmployee.set(employeeId, beat);
  }
  const projectDirections = () =>
    applyDramaturgyMode(
      projectOfficeStaging([...directionByEmployee.values()], input.prefabs, input.actorPositions),
      { mode: input.mode, reducedMotion: input.reducedMotion },
    );
  let staged = projectDirections();

  // A scarce delivery anchor may be unavailable under bursty parallel output.
  // Never claim that actor is carrying while leaving it at its desk: restore
  // its ordinary dominant direction and project once more. The shelf still
  // records every artifact; only actors with real coordinates own `delivering`.
  let restoredOrdinaryDirection = false;
  for (const actor of staged) {
    const deliveryBeat = deliveryBeatByEmployee.get(actor.employeeId);
    if (
      actor.beat.id === deliveryBeat?.id &&
      (actor.staging?.anchorId == null || actor.staging.x == null || actor.staging.z == null)
    ) {
      const ordinary = normalDirectionByEmployee.get(actor.employeeId);
      if (ordinary) directionByEmployee.set(actor.employeeId, ordinary);
      else directionByEmployee.delete(actor.employeeId);
      restoredOrdinaryDirection = true;
    }
  }
  if (restoredOrdinaryDirection) staged = projectDirections();
  const stagedByEmployee = new Map(staged.map((s) => [s.employeeId, s]));

  // ── Actors: snapshot-derived truth only. The actor set is the roster (every
  // hire stands on the floor, resting when idle) joined with the workload and
  // thread maps, so a terminal-only blocked actor stays visible even if it has
  // dropped off the roster input.
  const employeeIds = [
    ...new Set([
      ...input.roster,
      ...input.workloads.keys(),
      ...input.threadByEmployee.keys(),
      ...deliveryBeatByEmployee.keys(),
    ]),
  ].sort();

  const actors: ActorCue[] = employeeIds.map((employeeId) => {
    const workload = input.workloads.get(employeeId);
    const grouped = workload ? groupedWorkload(workload) : null;
    const workloadCue: WorkloadCue = grouped
      ? {
          ...grouped,
          primary: grouped.topIssue && isBlockingIssue(grouped.topIssue) ? 'issue' : 'count',
        }
      : IDLE_WORKLOAD_CUE;
    const stagedActor = stagedByEmployee.get(employeeId);
    const threadId = input.threadByEmployee.get(employeeId) ?? null;
    const baseStatus = characterStatusFor(workload);
    const deliveryBeat = deliveryBeatByEmployee.get(employeeId);
    const delivering =
      deliveryBeat != null &&
      baseStatus !== 'blocked' &&
      baseStatus !== 'approval' &&
      stagedActor?.beat.id === deliveryBeat.id &&
      stagedActor.staging?.anchorId != null &&
      stagedActor.staging.x != null &&
      stagedActor.staging.z != null;
    const status = characterStatusFor(workload, delivering);
    const statusPerformance =
      status === 'approval' || status === 'blocked' ? performanceForStatus(status, 'stand') : null;
    return {
      employeeId,
      threadId,
      selected: false,
      hovered: false,
      dragging: false,
      status,
      delivering,
      running: (workload?.activeCount ?? 0) > 0 || delivering,
      performance: statusPerformance ?? stagedActor?.performance ?? null,
      staging: statusPerformance ? null : (stagedActor?.staging ?? null),
      workload: workloadCue,
      artifacts: artifactsByEmployee.get(employeeId) ?? NO_ARTIFACTS,
    };
  });

  // ── Flows: the shared signal filter + noise cap, then bundling. The cap
  // applies BEFORE grouping so the frame carries at most FLOW_NOISE_CAP signal
  // beats total, exactly like the per-scene slice(-8) it replaces.
  const ownedSignalBeats: SceneBeat[] = [];
  for (const beat of orderedBeats) {
    const employeeId = beat.employeeId ?? employeeByRun.get(beat.runId);
    if (!employeeId || !(beat.flow || beat.resource || beat.artifact)) continue;
    ownedSignalBeats.push(beat.employeeId === employeeId ? beat : { ...beat, employeeId });
  }
  const signalBeats = ownedSignalBeats.slice(-FLOW_NOISE_CAP);
  interface MutableFlowGroup {
    readonly employeeId: string;
    readonly kind: FlowCueKind;
    readonly target: FlowCueTarget;
    ink: SceneInk;
    pulse: boolean;
    bundleCount: number;
    at: number;
    label: string;
  }
  const flowGroups = new Map<string, MutableFlowGroup>();
  for (const beat of signalBeats) {
    const employeeId = beat.employeeId as string;
    const kind = flowCueKind(beat);
    const target = flowCueTarget(beat);
    const ink = inkForBeat(beat);
    const key = `${employeeId} ${target} ${kind}`;
    const group = flowGroups.get(key);
    if (!group) {
      flowGroups.set(key, {
        employeeId,
        kind,
        target,
        ink,
        pulse: beatPulse(beat),
        bundleCount: 1,
        at: beat.at,
        label: beatLabel(beat),
      });
    } else {
      group.bundleCount += 1;
      group.pulse = group.pulse || beatPulse(beat);
      // signalBeats is ascending, so each merged member is the newest so far:
      // it owns both the animation anchor and the line label.
      group.at = beat.at;
      group.label = beatLabel(beat);
      if (INK_RANK[ink] > INK_RANK[group.ink]) group.ink = ink;
    }
  }
  const flows: FlowCue[] = [...flowGroups.values()].sort(
    (a, b) =>
      cmpStr(a.employeeId, b.employeeId) || cmpStr(a.target, b.target) || cmpStr(a.kind, b.kind),
  );

  // ── Resources: each actor's top workload issue (already on the actor cue),
  // joined to the typed strain kind from its newest live resource beat.
  // Cancelled runs never appear here — a cancelled beat carries no
  // resource/failure signal, so the workload rollup stays clean.
  const resources: ResourceCue[] = [];
  for (const actor of actors) {
    const topIssue = actor.workload.topIssue;
    if (!topIssue) continue;
    resources.push({
      employeeId: actor.employeeId,
      runId: topIssue.runId,
      kind: topIssue.kind,
      resourceKind:
        topIssue.kind === 'resource' ? (resourceKindByRun.get(topIssue.runId) ?? null) : null,
      severity: topIssue.severity,
      label: topIssue.label,
      terminal: topIssue.terminal,
    });
  }

  // ── Attention (fact arms only): severe issue > fresh delivery. The severe
  // pick prefers the highest severity, then the lexically-first employee so two
  // equally blocked actors resolve identically every frame. The selected-thread
  // arm is interaction state and is settled by `applyInputState`.
  let severe: { employeeId: string; rank: number } | null = null;
  for (const actor of actors) {
    const issue = actor.workload.topIssue;
    if (!issue || !isBlockingIssue(issue)) continue;
    const rank = resourceSeverityRank(issue.severity);
    if (!severe || rank > severe.rank) severe = { employeeId: actor.employeeId, rank };
  }
  const attention: AttentionCue | null = severe
    ? { target: 'employee', employeeId: severe.employeeId, reason: 'severe-issue' }
    : delivery.latest
      ? { target: 'delivery', reason: 'delivery' }
      : null;

  return { actors, flows, delivery, resources, attention };
}

/**
 * Interaction half of the projection: an O(actors) overlay that decorates the
 * three interaction booleans onto a base frame and settles the full attention
 * precedence (severe-issue > selected > delivery). The severe and delivery
 * facts are already ON the frame, so this never re-derives staging, flows,
 * claims, or workloads — a hover transition costs one actor pass.
 */
export function applyInputState(
  frame: SceneCueFrame,
  inputState: SceneCueInputState | undefined,
): SceneCueFrame {
  const selectedEmployeeId = inputState?.selectedEmployeeId ?? null;
  const hoveredEmployeeId = inputState?.hoveredEmployeeId ?? null;
  const draggingEmployeeId = inputState?.draggingEmployeeId ?? null;
  // Base actors already carry all-false booleans; reuse them untouched so a
  // no-interaction frame stays byte-identical (and allocation-free).
  const actors: readonly ActorCue[] =
    selectedEmployeeId === null && hoveredEmployeeId === null && draggingEmployeeId === null
      ? frame.actors
      : frame.actors.map((actor) => {
          const selected = actor.employeeId === selectedEmployeeId;
          const hovered = actor.employeeId === hoveredEmployeeId;
          const dragging = actor.employeeId === draggingEmployeeId;
          if (!selected && !hovered && !dragging) return actor;
          return { ...actor, selected, hovered, dragging };
        });
  // Full attention precedence: the base frame's severe arm wins outright, then
  // the selected actor, then the base delivery arm.
  const severe = frame.attention?.reason === 'severe-issue' ? frame.attention : null;
  const selectedActor =
    selectedEmployeeId === null ? undefined : actors.find((actor) => actor.selected);
  const attention: AttentionCue | null = severe
    ? severe
    : selectedActor
      ? { target: 'employee', employeeId: selectedActor.employeeId, reason: 'selected-thread' }
      : frame.delivery.latest
        ? { target: 'delivery', reason: 'delivery' }
        : null;
  return { ...frame, actors, attention };
}

/**
 * The single-call contract: identical, by construction, to
 * `applyInputState(projectSceneBaseFrame(facts), inputState)` — the harness
 * locks the equivalence byte-for-byte.
 */
export function projectSceneCues(input: SceneCueInput): SceneCueFrame {
  const { inputState, ...facts } = input;
  return applyInputState(projectSceneBaseFrame(facts), inputState);
}
