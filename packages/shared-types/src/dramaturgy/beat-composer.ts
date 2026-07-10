/**
 * Deterministic dramaturgy beat composer (Phase 2).
 *
 * Turns an ordered, timestamped {@link AgentRunEvent} stream into a debug
 * `SceneBeat` timeline — the semantic "what should be staged" layer that sits
 * between Harness facts and the scene. It does NOT emit coordinates, room names,
 * or animation names (Phase 3 resolves affordances to real anchors); it only
 * decides *which* beats are worth staging, for *whom*, with *what* affordance
 * target and a deterministic variant.
 *
 * Guarantees:
 *  - Deterministic: a fixed event stream + config yields byte-identical beats.
 *    Randomness is a pure hash of (version, rootRunId, runId, employeeId, kind,
 *    beatIndex) and only ever picks a variant — never a fact, actor, or status.
 *  - Coalescing: read/search/tool chatter collapses into one stable activity
 *    beat (plus at most one sustained relocation) instead of per-tool movement.
 *  - Priority/interrupt: approval and failure beats are emitted immediately,
 *    bypassing cooldowns, so they can preempt lower-priority beats.
 *
 * The model never authors beats; this is pure, replayable derivation.
 */
import {
  type ActivityKind,
  type AgentRunArtifactPayload,
  type AgentRunEvent,
  type AgentRunEventType,
  type RunFailureKind,
  type WorkKind,
  classifyToolActivity,
} from '../events/agent-run.js';
import type { InteractionAnchorKind } from './staging.js';

/** Current dramaturgy version — the seed input baked into every variant hash, so
 *  bumping it intentionally changes presentation while keeping a fixed event
 *  stream + version byte-identical. */
export const DRAMATURGY_VERSION = 'v1';

/** A staged beat. Affordance is a target *kind*, not coordinates. */
export type BeatKind =
  | 'receive-task'
  | 'plan'
  | 'delegate'
  | 'research'
  | 'produce'
  | 'compute'
  | 'review'
  | 'approval'
  | 'failure'
  | 'cancelled'
  | 'join'
  | 'complete'
  | 'activity';

/** Interaction anchor kind a beat targets (resolved to real anchors via staging). */
export type BeatAffordance = InteractionAnchorKind;

export type VisualPhase =
  | 'plan'
  | 'read'
  | 'produce'
  | 'compute'
  | 'review'
  | 'wait'
  | 'blocked'
  | 'complete';

export type VisualEmotion =
  | 'neutral'
  | 'focus'
  | 'thinking'
  | 'worried'
  | 'blocked'
  | 'confident'
  | 'celebrating'
  | 'urgent';

export type VisualProp = 'document' | 'laptop' | 'terminal' | 'package' | 'pointer' | 'archive';

export interface FlowIntent {
  readonly kind: 'task' | 'delegation' | 'tool' | 'artifact' | 'approval' | 'failure' | 'join';
  readonly label: string;
  readonly target: 'workstation' | 'tool' | 'review' | 'delivery' | 'user';
  readonly pulse: boolean;
}

export interface ArtifactIntent {
  readonly title: string;
  readonly kind: string;
  readonly ref?: string;
  readonly deliverableId?: string;
  readonly path?: string;
}

/** Resource-strain vocabulary — 1:1 with the typed wire failure kind. */
export type ResourceKind = RunFailureKind;
export type ResourceSeverity = 'warning' | 'blocked' | 'exhausted' | 'recovering';

export interface ResourceIntent {
  readonly kind: ResourceKind;
  readonly severity: ResourceSeverity;
  readonly label: string;
}

/**
 * The three severities the UI surfaces for a resource strain. `recovering`
 * collapses to `warning` — it is a transient, non-blocking state. Shared so the
 * office projection, scene markers, and drilldown all rank strain identically.
 */
export type SurfacedResourceSeverity = 'warning' | 'blocked' | 'exhausted';

/** Collapse a raw {@link ResourceSeverity} to the three surfaced levels. */
export function surfacedResourceSeverity(severity: ResourceSeverity): SurfacedResourceSeverity {
  if (severity === 'exhausted') return 'exhausted';
  if (severity === 'blocked') return 'blocked';
  return 'warning';
}

/** Rank a surfaced severity for ordering (exhausted > blocked > warning; higher wins). */
export function resourceSeverityRank(severity: SurfacedResourceSeverity): number {
  return severity === 'exhausted' ? 2 : severity === 'blocked' ? 1 : 0;
}

export interface VisualIntent {
  readonly phase: VisualPhase;
  readonly intensity: 0 | 1 | 2 | 3;
  readonly emotion: VisualEmotion;
  readonly prop?: VisualProp;
  readonly affordance: BeatAffordance | null;
  readonly badges: readonly string[];
}

export interface SceneBeat {
  readonly id: string;
  readonly kind: BeatKind;
  readonly priority: number;
  readonly threadId: string;
  readonly rootRunId: string;
  readonly runId: string;
  readonly employeeId: string | null;
  readonly workKind: WorkKind | null;
  readonly activityKind: ActivityKind | null;
  readonly affordance: BeatAffordance | null;
  /** Whether the actor relocates for this beat (subject to movement cooldown). */
  readonly movement: boolean;
  /** Part of a same-root parallel fan-out. */
  readonly parallel: boolean;
  /** High-priority beat that bypasses cooldowns (approval / failure / cancelled). */
  readonly interrupt: boolean;
  /** Deterministic, seed-derived variant index. */
  readonly variant: number;
  readonly visual: VisualIntent;
  readonly flow: FlowIntent | null;
  readonly artifact: ArtifactIntent | null;
  readonly resource: ResourceIntent | null;
  readonly at: number;
  /**
   * Beat lifetime so the office can expire a beat without waiting for a future
   * event (an idle actor returns home). Pure: derived from `at` + a per-kind TTL,
   * never wall-clock, so replay stays byte-identical. Approval/failure get a long
   * TTL — they persist until a later event resolves them, not on a short timer.
   */
  readonly lifecycle: { readonly startedAt: number; readonly endsAt: number };
}

/**
 * Per-kind beat lifetime in ms (source plan §9.3 durations). Approval/failure
 * persist until resolved by a later event — a long finite TTL, not infinity, so
 * the value JSON-serializes for deterministic replay.
 */
export function beatLifespanMs(kind: BeatKind): number {
  switch (kind) {
    case 'approval':
    case 'failure':
      return 600_000; // until a later event resolves the state
    case 'delegate':
    case 'review':
    case 'join':
      return 8_000; // 6-10s
    case 'complete':
    case 'cancelled':
      return 4_500; // 3-6s
    case 'activity':
    case 'research':
    case 'produce':
    case 'compute':
      return 3_000; // micro action (coalesced tool work) 2.5-4s
    default:
      return 6_000; // receive-task / plan (phase)
  }
}

/**
 * The single liveness cut every beat consumer shares: a beat is live while its
 * lifecycle window still extends past `now`. Consolidates the inline
 * `lifecycle.endsAt > now` copies (office store, expiry timers, scene-cue
 * projection, issue resolution) behind one name so the rule can never drift.
 */
export function isBeatLive(beat: SceneBeat, now: number): boolean {
  return beat.lifecycle.endsAt > now;
}

/** Beat priority bands (source plan §9.2). */
export const BEAT_PRIORITY = {
  approval: 100,
  failure: 90,
  delegation: 75,
  phase: 60,
  sustained: 30,
  ambient: 10,
} as const;

/**
 * Timing rules in ms (source plan §9.3).
 *
 * Two plan constants are intentionally folded away:
 *  - `coalesceWindowMs` (800ms): subsumed by `microMinMs` — a same-kind activity
 *    stream coalesces (no new micro beat) for any gap up to the micro minimum,
 *    which is strictly wider, so the 800ms window added nothing and (when used
 *    as the only extend threshold) silently defeated sustained relocation for
 *    realistic 0.8–2.5s tool loops.
 *  - `majorMinMs` (6000ms): major beats are real, infrequent events
 *    (delegate/join/complete) that must not be dropped; movement-cooldown +
 *    coalescing already prevent churn.
 */
export interface DramaturgyTiming {
  /** A same-kind activity stream coalesces (and accumulates toward one
   *  relocation) while consecutive gaps stay within this window. */
  readonly microMinMs: number;
  readonly movementCooldownMs: number;
  readonly sustainedRelocationMs: number;
}

export const DEFAULT_TIMING: DramaturgyTiming = {
  microMinMs: 2500,
  movementCooldownMs: 8000,
  sustainedRelocationMs: 4000,
};

export interface DramaturgyConfig {
  readonly dramaturgyVersion: string;
  readonly timing?: Partial<DramaturgyTiming>;
  /** Variant count per beat kind (default 3). */
  readonly variantCount?: number;
}

export type TimedAgentRunEvent = AgentRunEvent & { readonly timestamp: number };

// ── Pure helpers ────────────────────────────────────────────────────────────

/** FNV-1a 32-bit hash for deterministic, seed-stable variant selection. */
function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const ACTIVITY_BEAT: Record<
  ActivityKind,
  { kind: BeatKind; affordance: BeatAffordance | null; relocates: boolean }
> = {
  read: { kind: 'research', affordance: 'reading-seat', relocates: true },
  search: { kind: 'research', affordance: 'reading-seat', relocates: true },
  write: { kind: 'produce', affordance: 'workstation', relocates: false },
  edit: { kind: 'produce', affordance: 'workstation', relocates: false },
  shell: { kind: 'compute', affordance: 'server-inspect', relocates: true },
  build: { kind: 'compute', affordance: 'server-inspect', relocates: true },
  test: { kind: 'compute', affordance: 'server-inspect', relocates: true },
  inspect: { kind: 'activity', affordance: 'workstation', relocates: false },
  wait: { kind: 'activity', affordance: null, relocates: false },
};

interface WorkSignal {
  readonly threadId: string;
  readonly rootRunId: string;
  readonly runId: string;
  readonly employeeId: string | null;
  readonly kind: BeatKind;
  readonly priority: number;
  readonly affordance: BeatAffordance | null;
  readonly movement: boolean;
  readonly interrupt: boolean;
  /** Whether sustained activity of this kind relocates the actor (read/compute). */
  readonly relocates: boolean;
  /** A one-shot milestone (artifact) that always emits, never coalesced. */
  readonly milestone: boolean;
  readonly activityKind: ActivityKind | null;
  readonly workKind: WorkKind | null;
  readonly flow?: FlowIntent;
  readonly artifact?: ArtifactIntent;
  readonly resource?: ResourceIntent;
  readonly at: number;
}

function flow(
  kind: FlowIntent['kind'],
  label: string,
  target: FlowIntent['target'],
  pulse = true,
): FlowIntent {
  return { kind, label, target, pulse };
}

function artifactIntent(payload: AgentRunArtifactPayload): ArtifactIntent {
  return {
    title: payload.title,
    kind: payload.kind ?? payload.mimeType ?? 'artifact',
    ...(payload.ref ? { ref: payload.ref } : {}),
    ...(payload.deliverableId ? { deliverableId: payload.deliverableId } : {}),
    ...(payload.path ? { path: payload.path } : {}),
  };
}

/** The one ResourceIntent each typed failure kind stages — no text parsing. */
const RESOURCE_INTENT_BY_FAILURE_KIND: Readonly<Record<RunFailureKind, ResourceIntent>> = {
  token: { kind: 'token', severity: 'exhausted', label: 'token exhausted' },
  budget: { kind: 'budget', severity: 'exhausted', label: 'budget exhausted' },
  permission: { kind: 'permission', severity: 'blocked', label: 'permission blocked' },
  context: { kind: 'context', severity: 'blocked', label: 'context blocked' },
  runtime: { kind: 'runtime', severity: 'blocked', label: 'runtime blocked' },
  tool: { kind: 'tool', severity: 'blocked', label: 'tool failed' },
};

const GENERIC_RUN_BLOCKED: ResourceIntent = {
  kind: 'tool',
  severity: 'blocked',
  label: 'run blocked',
};

/** Total map from the wire's typed failure kind to a staged resource intent.
 *  An absent kind stages the generic block — and so does an out-of-vocabulary
 *  kind, since the payload rides the wire as unvalidated JSON (a skewed emitter
 *  must degrade to the generic marker, never to a missing one). */
function resourceFromFailureKind(failureKind: RunFailureKind | undefined): ResourceIntent {
  const intent: ResourceIntent | undefined = failureKind
    ? RESOURCE_INTENT_BY_FAILURE_KIND[failureKind]
    : undefined;
  return intent ?? GENERIC_RUN_BLOCKED;
}

function visualForSignal(signal: WorkSignal): VisualIntent {
  if (signal.resource?.severity === 'exhausted') {
    return {
      phase: 'blocked',
      intensity: 3,
      emotion: 'blocked',
      affordance: signal.affordance,
      badges: [signal.resource.label],
    };
  }
  if (signal.resource) {
    return {
      phase: signal.kind === 'approval' ? 'wait' : 'blocked',
      intensity: signal.kind === 'approval' ? 2 : 3,
      emotion: signal.kind === 'approval' ? 'worried' : 'blocked',
      affordance: signal.affordance,
      badges: [signal.resource.label],
    };
  }
  if (signal.artifact) {
    return {
      phase: 'produce',
      intensity: 2,
      emotion: 'confident',
      prop: 'package',
      affordance: signal.affordance,
      badges: ['artifact'],
    };
  }
  switch (signal.kind) {
    case 'receive-task':
      return {
        phase: 'plan',
        intensity: 1,
        emotion: 'focus',
        prop: 'document',
        affordance: signal.affordance,
        badges: ['task'],
      };
    case 'plan':
      return {
        phase: 'plan',
        intensity: 1,
        emotion: 'thinking',
        prop: 'pointer',
        affordance: signal.affordance,
        badges: ['plan'],
      };
    case 'delegate':
      return {
        phase: 'plan',
        intensity: 2,
        emotion: 'focus',
        prop: 'document',
        affordance: signal.affordance,
        badges: ['handoff'],
      };
    case 'research':
      return {
        phase: 'read',
        intensity: 1,
        emotion: 'focus',
        prop: 'document',
        affordance: signal.affordance,
        badges: [signal.activityKind ?? 'read'],
      };
    case 'compute':
      return {
        phase: 'compute',
        intensity: 2,
        emotion: 'focus',
        prop: 'terminal',
        affordance: signal.affordance,
        badges: [signal.activityKind ?? 'compute'],
      };
    case 'review':
    case 'join':
      return {
        phase: 'review',
        intensity: 1,
        emotion: 'focus',
        prop: 'pointer',
        affordance: signal.affordance,
        badges: [signal.kind],
      };
    case 'approval':
      return {
        phase: 'wait',
        intensity: 2,
        emotion: 'thinking',
        prop: 'document',
        affordance: signal.affordance,
        badges: ['approval'],
      };
    case 'failure':
      return {
        phase: 'blocked',
        intensity: 3,
        emotion: 'blocked',
        affordance: signal.affordance,
        badges: ['blocked'],
      };
    case 'cancelled':
      // A neutral stopped state (PRD): distinct from failure (no blocked/risk
      // marker) and from complete (no celebration).
      return {
        phase: 'complete',
        intensity: 0,
        emotion: 'neutral',
        affordance: signal.affordance,
        badges: ['cancelled'],
      };
    case 'complete':
      return {
        phase: 'complete',
        intensity: 2,
        emotion: 'celebrating',
        prop: 'package',
        affordance: signal.affordance,
        badges: ['complete'],
      };
    default:
      return {
        phase: signal.activityKind === 'wait' ? 'wait' : 'produce',
        intensity: signal.activityKind === 'wait' ? 0 : 1,
        emotion: signal.activityKind === 'wait' ? 'thinking' : 'focus',
        prop: signal.activityKind === 'wait' ? undefined : 'laptop',
        affordance: signal.affordance,
        badges: signal.activityKind ? [signal.activityKind] : [],
      };
  }
}

/** Normalize one event into a work signal, or null if it stages nothing. */
function normalize(event: TimedAgentRunEvent): WorkSignal | null {
  const base = {
    relocates: false,
    milestone: false,
    threadId: event.threadId,
    rootRunId: event.rootRunId,
    runId: event.runId,
    employeeId: event.employeeId ?? null,
    workKind: event.workKind ?? null,
    at: event.timestamp,
  };
  switch (event.type) {
    case 'run.started': {
      // A director root (no employeeId) stages nothing — no fake universal actor.
      if (!base.employeeId) return null;
      // The root run has runId === rootRunId; everything else is a delegated
      // child (a direct child's parentRunId IS the rootRunId — still a child).
      const isChild = event.runId !== event.rootRunId;
      if (event.workKind === 'plan') {
        return {
          ...base,
          kind: 'plan',
          priority: BEAT_PRIORITY.phase,
          affordance: 'board-presenter',
          movement: true,
          interrupt: false,
          flow: flow('task', 'plan', 'review'),
          activityKind: null,
        };
      }
      if (event.relation === 'review') {
        return {
          ...base,
          kind: 'review',
          priority: BEAT_PRIORITY.delegation,
          affordance: 'standing-review',
          movement: true,
          interrupt: false,
          flow: flow('join', 'review', 'review'),
          activityKind: null,
        };
      }
      if (isChild) {
        return {
          ...base,
          kind: 'delegate',
          priority: BEAT_PRIORITY.delegation,
          affordance: 'workstation',
          movement: true,
          interrupt: false,
          flow: flow('delegation', 'handoff', 'workstation'),
          activityKind: null,
        };
      }
      return {
        ...base,
        kind: 'receive-task',
        priority: BEAT_PRIORITY.ambient,
        affordance: 'workstation',
        movement: false,
        interrupt: false,
        flow: flow('task', 'task', 'workstation', false),
        activityKind: null,
      };
    }
    case 'tool.started': {
      // Activity category from tool facts (the tool name), consistent with the
      // run projection — never the model, never shell content.
      const ak: ActivityKind =
        event.payload.activityKind ?? classifyToolActivity(event.payload.toolName);
      const map = ACTIVITY_BEAT[ak];
      const priority =
        ak === 'inspect' || ak === 'wait' ? BEAT_PRIORITY.ambient : BEAT_PRIORITY.sustained;
      return {
        ...base,
        kind: map.kind,
        priority,
        affordance: map.affordance,
        movement: false,
        interrupt: false,
        relocates: map.relocates,
        flow: flow(
          'tool',
          ak,
          ak === 'shell' || ak === 'build' || ak === 'test' ? 'tool' : 'workstation',
        ),
        activityKind: ak,
      };
    }
    case 'tool.completed':
      if (event.payload.status !== 'failed') return null;
      return {
        ...base,
        kind: 'failure',
        priority: BEAT_PRIORITY.failure,
        affordance: null,
        movement: false,
        interrupt: true,
        resource: RESOURCE_INTENT_BY_FAILURE_KIND.tool,
        flow: flow('failure', 'tool failed', 'tool'),
        activityKind: null,
      };
    case 'artifact.created':
      // A delivered artifact is a milestone: always emit, never swallowed by an
      // adjacent produce/write/edit stream.
      return {
        ...base,
        kind: 'produce',
        priority: BEAT_PRIORITY.sustained,
        affordance: 'workstation',
        movement: false,
        interrupt: false,
        milestone: true,
        artifact: artifactIntent(event.payload),
        flow: flow('artifact', 'artifact', 'delivery'),
        activityKind: null,
      };
    case 'approval.requested':
      return {
        ...base,
        kind: 'approval',
        priority: BEAT_PRIORITY.approval,
        affordance: null,
        movement: false,
        interrupt: true,
        // Approval is an amber waiting state, not a permission failure. The
        // workload projection derives its typed approval issue from `waiting`;
        // true permission failures still arrive through run.failed and keep the
        // blocked resource lane.
        flow: flow('approval', 'approval', 'user'),
        activityKind: null,
      };
    case 'run.failed':
      return {
        ...base,
        kind: 'failure',
        priority: BEAT_PRIORITY.failure,
        affordance: null,
        movement: false,
        interrupt: true,
        resource: resourceFromFailureKind(event.payload.failureKind),
        flow: flow('failure', 'blocked', 'tool'),
        activityKind: null,
      };
    case 'run.cancelled':
      // A neutral stopped state (PRD): interrupts (clears the actor's activity;
      // the run's lingering approval/failure beats are resolved by
      // resolveIssueBeats in composeBeats) and carries NO resource intent and
      // NO failure flow — cancelled is not a risk.
      return {
        ...base,
        kind: 'cancelled',
        priority: BEAT_PRIORITY.phase,
        affordance: null,
        movement: false,
        interrupt: true,
        activityKind: null,
      };
    case 'run.completed': {
      const isChild = event.runId !== event.rootRunId;
      return isChild
        ? {
            ...base,
            kind: 'join',
            priority: BEAT_PRIORITY.delegation,
            affordance: 'standing-review',
            movement: true,
            interrupt: false,
            flow: flow('join', 'join', 'review'),
            activityKind: null,
          }
        : {
            ...base,
            kind: 'complete',
            priority: BEAT_PRIORITY.phase,
            affordance: 'board-presenter',
            movement: true,
            interrupt: false,
            flow: flow('artifact', 'complete', 'delivery'),
            activityKind: null,
          };
    }
    default:
      // run.delta and tool.completed stage nothing on their own.
      return null;
  }
}

interface ActorState {
  lastMovementAt: number;
  activity: { kind: BeatKind; startedAt: number; lastAt: number; relocated: boolean } | null;
}

function isActivityKind(kind: BeatKind): boolean {
  return kind === 'research' || kind === 'produce' || kind === 'compute' || kind === 'activity';
}

/**
 * Deterministic event ordering rank — same-timestamp events resolve to a
 * canonical order independent of how they arrived on the async bus
 * (run.started before tool/artifact before terminal).
 */
const EVENT_RANK: Record<AgentRunEventType, number> = {
  'run.started': 0,
  'run.delta': 1,
  'tool.started': 2,
  'tool.completed': 3,
  'artifact.created': 4,
  'approval.requested': 5,
  'computer.target.selected': 5,
  'computer.sensitive.paused': 5,
  'run.completed': 6,
  'run.failed': 6,
  'run.cancelled': 6,
};

/** Content-derived per-event identity for a stable final tie-break. */
function eventDiscriminator(event: AgentRunEvent): string {
  const payload = event.payload as unknown as Record<string, unknown>;
  const id = payload.toolCallId ?? payload.uiRequestId ?? payload.objective ?? payload.status ?? '';
  return `${event.runId}|${event.type}|${String(id)}`;
}

/**
 * Compose the deterministic beat timeline from a timestamped event stream.
 */
export function composeBeats(
  events: readonly TimedAgentRunEvent[],
  config: DramaturgyConfig,
): SceneBeat[] {
  const timing = { ...DEFAULT_TIMING, ...config.timing };
  const variantCount = Math.max(1, config.variantCount ?? 3);

  // Canonical ordering: timestamp, then a content-derived order so equal-ms
  // events from an async bus resolve identically regardless of arrival order
  // (the original index is only the last-resort tie-break for truly identical
  // events, where the chosen order cannot affect output).
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      if (a.event.timestamp !== b.event.timestamp) return a.event.timestamp - b.event.timestamp;
      const rank = EVENT_RANK[a.event.type] - EVENT_RANK[b.event.type];
      if (rank !== 0) return rank;
      const da = eventDiscriminator(a.event);
      const db = eventDiscriminator(b.event);
      if (da !== db) return da < db ? -1 : 1;
      return a.index - b.index;
    })
    .map((e) => e.event);

  // Track concurrent running children per root for the parallel flag.
  const runningChildren = new Map<string, Set<string>>();
  const actors = new Map<string, ActorState>();
  const beatIndexByKey = new Map<string, number>();
  // Until-resolved beats (approval/failure) per run, as indices into `beats` —
  // a later event from the same run resolves them (see resolveIssueBeats).
  const issueBeatIndicesByRun = new Map<string, number[]>();
  // Deterministic anti-repeat: the last variant emitted per (actor, beatKind),
  // so consecutive same beats never reuse the same variant (no visible loop).
  const lastVariantByKey = new Map<string, number>();
  const beats: SceneBeat[] = [];

  const actorOf = (id: string): ActorState => {
    let s = actors.get(id);
    if (!s) {
      s = { lastMovementAt: Number.NEGATIVE_INFINITY, activity: null };
      actors.set(id, s);
    }
    return s;
  };

  const emit = (signal: WorkSignal, movement: boolean, parallel: boolean): void => {
    const actorKey = signal.employeeId ?? signal.runId;
    const idxKey = `${actorKey}:${signal.kind}`;
    const beatIndex = beatIndexByKey.get(idxKey) ?? 0;
    beatIndexByKey.set(idxKey, beatIndex + 1);
    const seed = hashString(
      [
        config.dramaturgyVersion,
        signal.rootRunId,
        signal.runId,
        signal.employeeId ?? '',
        signal.kind,
        String(beatIndex),
      ].join('|'),
    );
    let variant = seed % variantCount;
    const last = lastVariantByKey.get(idxKey);
    if (variantCount > 1 && last === variant) variant = (variant + 1) % variantCount;
    lastVariantByKey.set(idxKey, variant);
    if (signal.kind === 'approval' || signal.kind === 'failure') {
      const indices = issueBeatIndicesByRun.get(signal.runId) ?? [];
      indices.push(beats.length);
      issueBeatIndicesByRun.set(signal.runId, indices);
    }
    beats.push({
      id: `${signal.runId}:${signal.kind}:${beatIndex}`,
      kind: signal.kind,
      priority: signal.priority,
      threadId: signal.threadId,
      rootRunId: signal.rootRunId,
      runId: signal.runId,
      employeeId: signal.employeeId,
      workKind: signal.workKind,
      activityKind: signal.activityKind,
      affordance: signal.affordance,
      movement,
      parallel,
      interrupt: signal.interrupt,
      variant,
      visual: visualForSignal(signal),
      flow: signal.flow ?? null,
      artifact: signal.artifact ?? null,
      resource: signal.resource ?? null,
      at: signal.at,
      lifecycle: { startedAt: signal.at, endsAt: signal.at + beatLifespanMs(signal.kind) },
    });
    if (movement) actorOf(actorKey).lastMovementAt = signal.at;
  };

  // Track parallel fan-out membership: a delegate is parallel if its root has
  // another child already running when it starts.
  const trackRunStart = (event: TimedAgentRunEvent): boolean => {
    // A child is any run that is not the root run itself.
    if (event.type !== 'run.started' || event.runId === event.rootRunId) {
      return false;
    }
    let set = runningChildren.get(event.rootRunId);
    if (!set) {
      set = new Set();
      runningChildren.set(event.rootRunId, set);
    }
    const parallel = set.size >= 1;
    set.add(event.runId);
    return parallel;
  };
  const trackRunEnd = (event: TimedAgentRunEvent): void => {
    if (
      event.type === 'run.completed' ||
      event.type === 'run.failed' ||
      event.type === 'run.cancelled'
    ) {
      runningChildren.get(event.rootRunId)?.delete(event.runId);
    }
  };

  // Approval/failure beats "persist until a later event resolves them"
  // (beatLifespanMs): resolution means a later event from the SAME run proving
  // execution moved on — tool activity, an artifact, a new approval replacing
  // the old, or the run's terminal. Clamp the earlier issue beat's lifetime to
  // that event so an answered approval, a recovered failure, or a cancelled run
  // stops staging a blocked/waiting marker. The terminal `run.failed` beat is
  // never clamped: no later event exists for that run, so it keeps its full
  // until-resolved TTL (terminal failed children stay visible).
  const RESOLVING_EVENT_TYPES: ReadonlySet<TimedAgentRunEvent['type']> = new Set([
    'tool.started',
    'tool.completed',
    'artifact.created',
    'approval.requested',
    'run.completed',
    'run.failed',
    'run.cancelled',
  ]);
  const resolveIssueBeats = (event: TimedAgentRunEvent): void => {
    if (!RESOLVING_EVENT_TYPES.has(event.type)) return;
    const indices = issueBeatIndicesByRun.get(event.runId);
    if (!indices?.length) return;
    for (const index of indices) {
      const beat = beats[index];
      if (beat && isBeatLive(beat, event.timestamp)) {
        beats[index] = {
          ...beat,
          lifecycle: { startedAt: beat.lifecycle.startedAt, endsAt: event.timestamp },
        };
      }
    }
    indices.length = 0;
  };

  for (const event of ordered) {
    const parallel = trackRunStart(event);
    resolveIssueBeats(event);
    const signal = normalize(event);
    trackRunEnd(event);
    if (!signal) continue;

    const actorKey = signal.employeeId ?? signal.runId;
    const actor = actorOf(actorKey);

    // Interrupts always fire, bypassing cooldowns and clearing activity.
    if (signal.interrupt) {
      actor.activity = null;
      emit(signal, false, false);
      continue;
    }

    // Milestones (artifacts) always emit and never coalesce, but leave the
    // ongoing activity stream intact (the actor keeps producing).
    if (signal.milestone) {
      emit(signal, false, false);
      continue;
    }

    if (isActivityKind(signal.kind)) {
      const current = actor.activity;
      // A same-kind event within the micro minimum continues the SAME stream:
      // no new micro beat (kills chatter), but it still accumulates toward a
      // single sustained relocation. A larger gap (or a different kind) starts
      // a fresh stream and emits one micro beat.
      const continues =
        current && current.kind === signal.kind && signal.at - current.lastAt <= timing.microMinMs;

      if (continues && current) {
        current.lastAt = signal.at;
        if (
          signal.relocates &&
          !current.relocated &&
          signal.at - current.startedAt >= timing.sustainedRelocationMs &&
          signal.at - actor.lastMovementAt >= timing.movementCooldownMs
        ) {
          current.relocated = true;
          emit(signal, true, false);
        }
        continue;
      }

      actor.activity = {
        kind: signal.kind,
        startedAt: signal.at,
        lastAt: signal.at,
        relocated: false,
      };
      emit(signal, false, false);
      continue;
    }

    // Major / movement beats: a new stream resets any micro activity.
    actor.activity = null;
    // Movement cooldown downgrades a relocation to in-place rather than dropping
    // the beat (the beat is a real event; only the walk is suppressed).
    const wantsMovement = signal.movement;
    const allowMovement = signal.at - actor.lastMovementAt >= timing.movementCooldownMs;
    emit(signal, wantsMovement && allowMovement, parallel);
  }

  return beats;
}
