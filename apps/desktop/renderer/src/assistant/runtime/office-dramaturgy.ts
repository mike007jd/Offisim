/**
 * Live office dramaturgy store (Phase 4).
 *
 * Subscribes to the neutral `agent.run` event family on the runtime bus, keeps a
 * short rolling per-company window of timestamped AgentRunEvents, and composes
 * them into the deterministic beat timeline. The office scene consumes the beats
 * via {@link useOfficeBeats} and projects them onto its real prefab layout
 * (`projectOfficeStaging`) to direct performance + high-value relocation.
 *
 * The model never authors any of this — it is pure derivation from the same
 * facts the run tree is built from.
 */
import {
  MISSION_EVALUATION_SUBMITTED_EVENT,
  MISSION_STATUS_CHANGED_EVENT,
  type MissionEvaluationSubmittedPayload,
  type MissionStatusChangedPayload,
} from '@/runtime/mission/mission-events.js';
import { runtimeEventBus } from '@/runtime/repos.js';
import {
  type AgentRunEvent,
  DRAMATURGY_VERSION,
  type MissionBeatProjection,
  type MissionLifecycleKind,
  type RuntimeEvent,
  type SceneBeat,
  type TimedAgentRunEvent,
  composeBeats,
  isBeatLive,
  projectMissionEventToBeat,
} from '@offisim/shared-types';
import { useMemo, useSyncExternalStore } from 'react';

const MAX_EVENTS_PER_COMPANY = 400;
const MAX_AGE_MS = 120_000;
const EMPTY_BEATS: readonly SceneBeat[] = Object.freeze([]);

const buffers = new Map<string, TimedAgentRunEvent[]>();
const listeners = new Set<() => void>();
let version = 0;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/**
 * Arm a single timer at the soonest future beat expiry across all companies, so
 * an idle actor returns home WITHOUT a new runtime event (the rolling buffer
 * alone never re-fires once events stop). On fire it re-notifies — recomputing
 * the staging with the expired beat filtered out — and reschedules.
 */
function scheduleExpiry(): void {
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  const now = Date.now();
  let next = Number.POSITIVE_INFINITY;
  for (const events of buffers.values()) {
    if (events.length === 0) continue;
    for (const beat of composeBeats(events, { dramaturgyVersion: DRAMATURGY_VERSION })) {
      if (isBeatLive(beat, now) && beat.lifecycle.endsAt < next) next = beat.lifecycle.endsAt;
    }
  }
  if (next !== Number.POSITIVE_INFINITY) {
    expiryTimer = setTimeout(
      () => {
        expiryTimer = null;
        notify();
        scheduleExpiry();
      },
      Math.max(0, next - now),
    );
  }
}

// Singleton subscription for the app lifetime — the office scene mounts/unmounts
// but the rolling window should survive a surface switch.
//
// This INTENTIONALLY keeps the root's own run events (runId === rootRunId) — the
// office stages the acting employee for every run, delegating or not. That is the
// inverse of ConversationRunController.noteDelegation, which skips the root self
// stream because the root is not a delegation of itself. Both are correct: the
// office wants the root actor; the chat delegation list does not.
runtimeEventBus.on('agent.run', (event) => {
  const payload = event.payload as AgentRunEvent | undefined;
  if (!payload?.runId || !event.companyId) return;
  const now = event.timestamp;
  const timed: TimedAgentRunEvent = { ...payload, timestamp: now };
  const prior = buffers.get(event.companyId) ?? [];
  const next = [...prior, timed]
    .filter((e) => now - e.timestamp <= MAX_AGE_MS)
    .slice(-MAX_EVENTS_PER_COMPANY);
  buffers.set(event.companyId, next);
  notify();
  scheduleExpiry();
});

const officeDramaturgyStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getVersion(): number {
    return version;
  },
  beatsForCompany(companyId: string): readonly SceneBeat[] {
    const events = buffers.get(companyId);
    if (!events || events.length === 0) return EMPTY_BEATS;
    // Drop beats whose lifetime has elapsed so an idle actor returns home; the
    // expiry timer re-notifies when the soonest endsAt passes.
    const now = Date.now();
    const beats = composeBeats(events, { dramaturgyVersion: DRAMATURGY_VERSION }).filter((beat) =>
      isBeatLive(beat, now),
    );
    return beats.length > 0 ? beats : EMPTY_BEATS;
  },
};

// ── Mission beat source (M3 UX-007, PRD §24.4) ──────────────────────────────
//
// The Office Theater is a READ-ONLY projection of neutral events. Mission
// lifecycle signals are projected onto the SAME beat vocabulary via the pure
// `projectMissionEventToBeat`, then exposed as one more input the office can
// surface (e.g. a verification phase label) — WITHOUT changing how the office
// owns/renders the per-employee staging. The projector never writes mission
// state; this store only buffers the projected beats.
//
// Today the one mission signal already on the renderer bus is
// `mission.evaluation.submitted` (the agent's submit_for_evaluation → a
// verification beat). The remaining mission STATUS transitions
// (running / verifying / failed / completed / awaiting_user) are written to the
// `mission_events` DB table by the core MissionService but are NOT yet broadcast
// onto the renderer runtimeEventBus — broadcasting them (and the per-actor visual
// staging of mission-level beats) is the per-release Computer-Use M-pass, not this
// deterministic slice. When those transitions reach the bus, projecting them is a
// one-line addition to this same subscription (the projector already maps every
// kind). This subscription is additive: with no mission events, every buffer
// stays empty and the office is byte-identical to before.
const missionBuffers = new Map<string, MissionBeatProjection[]>();
const missionListeners = new Set<() => void>();
let missionVersion = 0;
let missionExpiryTimer: ReturnType<typeof setTimeout> | null = null;
const EMPTY_MISSION_BEATS: readonly MissionBeatProjection[] = Object.freeze([]);

function notifyMission(): void {
  missionVersion += 1;
  for (const listener of missionListeners) listener();
}

/**
 * Mirror of the agent-run {@link scheduleExpiry}: arm a single timer at the
 * soonest future mission-beat expiry across all companies, so the phase pill
 * disappears WHEN its beat's TTL elapses — without waiting for an unrelated
 * runtime event. On fire it re-notifies (recomputing `beatsForCompany`, which
 * filters the now-expired projection out) and reschedules. Only arms when a
 * mission buffer is non-empty, so a no-mission session never sets a timer.
 */
function scheduleMissionExpiry(): void {
  if (missionExpiryTimer !== null) {
    clearTimeout(missionExpiryTimer);
    missionExpiryTimer = null;
  }
  const now = Date.now();
  let next = Number.POSITIVE_INFINITY;
  for (const projections of missionBuffers.values()) {
    for (const projection of projections) {
      const endsAt = projection.beat.lifecycle.endsAt;
      if (isBeatLive(projection.beat, now) && endsAt < next) next = endsAt;
    }
  }
  if (next !== Number.POSITIVE_INFINITY) {
    missionExpiryTimer = setTimeout(
      () => {
        missionExpiryTimer = null;
        notifyMission();
        scheduleMissionExpiry();
      },
      Math.max(0, next - now),
    );
  }
}

runtimeEventBus.on(
  MISSION_EVALUATION_SUBMITTED_EVENT,
  (event: RuntimeEvent<MissionEvaluationSubmittedPayload>) => {
    if (!event.companyId || !event.threadId) return;
    const now = event.timestamp;
    // submit_for_evaluation → a verification beat (the agent signaled a criterion
    // ready; the deterministic evaluator over the real workspace is still the
    // truth, §5 — this beat is presentation only). The submit payload carries the
    // attempt's rootRunId, not the canonical missionId, so we scope the beat by
    // rootRunId (a stable per-attempt key for the verification phase label).
    const attemptRootRunId = event.payload.rootRunId;
    const projected = projectMissionEventToBeat({
      kind: 'mission.evaluation.submitted',
      missionId: attemptRootRunId,
      threadId: event.threadId,
      rootRunId: attemptRootRunId,
      at: now,
    });
    if (!projected) return;
    const prior = missionBuffers.get(event.companyId) ?? [];
    const next = [...prior, projected]
      .filter((p) => now - p.beat.at <= MAX_AGE_MS)
      .slice(-MAX_EVENTS_PER_COMPANY);
    missionBuffers.set(event.companyId, next);
    notifyMission();
    scheduleMissionExpiry();
  },
);

/**
 * Map a mission STATUS string (the §18 vocabulary) to the staged office
 * lifecycle kind. Statuses with no theatrical meaning (ready / draft / paused /
 * cancelled / repairing) map to null and stage no beat — the projector never
 * fabricates a beat for a status it does not own.
 */
const STATUS_TO_LIFECYCLE_KIND: Readonly<Record<string, MissionLifecycleKind | null>> = {
  running: 'mission.running',
  verifying: 'mission.verifying',
  awaiting_user: 'mission.awaiting_user',
  completed: 'mission.completed',
  failed: 'mission.failed',
  blocked: 'mission.failed', // a product-terminal block stages the failure beat
};

// M2/M3 live wiring: the MissionRunManager emits `mission.status.changed` at the
// start of a run (`running`) and at its terminal status. Project those onto the
// SAME beat vocabulary as the submit-for-evaluation signal — additive, byte-
// identical when no mission runs. Status beats are keyed by the canonical
// missionId (a stable per-mission key for the phase label).
runtimeEventBus.on(
  MISSION_STATUS_CHANGED_EVENT,
  (event: RuntimeEvent<MissionStatusChangedPayload>) => {
    if (!event.companyId || !event.threadId) return;
    const kind = STATUS_TO_LIFECYCLE_KIND[event.payload.status];
    if (!kind) return;
    const now = event.timestamp;
    const projected = projectMissionEventToBeat({
      kind,
      missionId: event.payload.missionId,
      threadId: event.threadId,
      ...(event.payload.rootRunId ? { rootRunId: event.payload.rootRunId } : {}),
      at: now,
    });
    if (!projected) return;
    const prior = missionBuffers.get(event.companyId) ?? [];
    const next = [...prior, projected]
      .filter((p) => now - p.beat.at <= MAX_AGE_MS)
      .slice(-MAX_EVENTS_PER_COMPANY);
    missionBuffers.set(event.companyId, next);
    notifyMission();
    scheduleMissionExpiry();
  },
);

const missionDramaturgyStore = {
  subscribe(listener: () => void): () => void {
    missionListeners.add(listener);
    return () => {
      missionListeners.delete(listener);
    };
  },
  getVersion(): number {
    return missionVersion;
  },
  beatsForCompany(companyId: string): readonly MissionBeatProjection[] {
    const projected = missionBuffers.get(companyId);
    if (!projected || projected.length === 0) return EMPTY_MISSION_BEATS;
    // Drop projections whose beat lifetime has elapsed so a stale phase label
    // does not linger (the shared per-kind TTL, same as the agent-run beats).
    const now = Date.now();
    const live = projected.filter((p) => isBeatLive(p.beat, now));
    return live.length > 0 ? live : EMPTY_MISSION_BEATS;
  },
};

/**
 * Live mission-beat projections for the active company's office (empty when no
 * mission is signaling). READ-ONLY: each projection carries its `semanticLabel`
 * + `phase` so reduced-motion / screen readers convey the meaning (planning /
 * verification / failure / completion) without any animation (§24.4 / §29).
 */
export function useMissionBeats(companyId: string | null): readonly MissionBeatProjection[] {
  const version = useSyncExternalStore(
    missionDramaturgyStore.subscribe,
    missionDramaturgyStore.getVersion,
    missionDramaturgyStore.getVersion,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is an external-store version/invalidation counter from useSyncExternalStore; the callback doesn't reference it directly but it must trigger recompute (removing would cause stale UI).
  return useMemo(
    () => (companyId ? missionDramaturgyStore.beatsForCompany(companyId) : EMPTY_MISSION_BEATS),
    [companyId, version],
  );
}

/** Tracks the OS "reduce motion" accessibility setting (suppresses relocation). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}

/** Live beat timeline for the active company's office (empty when idle). */
export function useOfficeBeats(companyId: string | null): readonly SceneBeat[] {
  const version = useSyncExternalStore(
    officeDramaturgyStore.subscribe,
    officeDramaturgyStore.getVersion,
    officeDramaturgyStore.getVersion,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is an external-store version/invalidation counter from useSyncExternalStore; the callback doesn't reference it directly but it must trigger recompute (removing would cause stale UI).
  return useMemo(
    () => (companyId ? officeDramaturgyStore.beatsForCompany(companyId) : EMPTY_BEATS),
    [companyId, version],
  );
}
