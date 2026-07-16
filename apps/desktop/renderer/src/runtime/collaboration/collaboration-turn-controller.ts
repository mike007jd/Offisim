// Collaboration turn controller (PR-03) — the orchestration brain for Connect's
// AI replies. It drives the collaboration transport (host-enforced
// `collaboration` capability profile: no tools, no workspace, no persistence) and
// records each reply to the PR-02 data domain ONLY:
//   - `collaboration_turns` (the lifecycle ledger: streaming / error / usage)
//   - `collaboration_messages` (the visible reply, upserted under a STABLE id)
// It NEVER writes agent_runs / mission / chat_threads, never binds a project, and
// never uses the Office conversation-run-controller (the work path).
//
// Three reply shapes, all bounded and (for groups) explicit:
//   - Direct reply: the single direct employee produces ONE turn.
//   - Group mentions_only (default): only @mentioned members reply; no mention →
//     nothing auto-fires; `askTeam()` is the deterministic 1-or-chosen fallback.
//   - Group roundtable: an explicit `startRound()` schedules up to N speakers
//     (default 3, hard cap 8), each at most one message, in DETERMINISTIC order
//     (mention order first, then member order). A later speaker sees prior
//     speakers' completed replies this round. At the cap it returns `completed`
//     and the next round needs an explicit `continueRound()` (a NEW round id).
//
// Determinism: no implicit Date.now()/Math.random() — `now()` / `newId()` are
// injected so the harness is reproducible.

import type { EmployeeRuntimeSelection } from '@/data/employee-persona.js';
import type {
  CollaborationMessageRepository,
  CollaborationTurnRepository,
  CollaborationTurnRow,
} from '@offisim/core/browser';
import type {
  AiExecutionTarget,
  CollaborationMessage,
  CollaborationProfile,
  CollaborationReplyPolicy,
  TurnExecutionProvenance,
} from '@offisim/shared-types';
import {
  validateExecutionTarget,
  validateTurnExecutionProvenance,
} from '../execution-provenance.js';
import {
  type CollaborationParticipant,
  type PriorRoundReply,
  buildContextPacket,
  clampRoundtableSpeakers,
  parseMentions,
  recentWindow,
  scheduleSpeakers,
} from './collaboration-context.js';
import type { CollaborationTransport, CollaborationTurnResult } from './collaboration-transport.js';

function sameExecutionTarget(a: AiExecutionTarget, b: AiExecutionTarget): boolean {
  return (
    a.engineId === b.engineId &&
    a.accountId === b.accountId &&
    a.billingMode === b.billingMode &&
    a.modelId === b.modelId &&
    a.modelSource.kind === b.modelSource.kind &&
    a.modelSource.sourceUrl === b.modelSource.sourceUrl &&
    a.modelSource.checkedAt === b.modelSource.checkedAt
  );
}

function parseExecutionTarget(row: CollaborationTurnRow): AiExecutionTarget {
  let value: unknown;
  try {
    value = JSON.parse(row.execution_target_json);
  } catch {
    throw new Error(`Collaboration turn ${row.turn_id} has invalid execution target JSON.`);
  }
  const target = validateExecutionTarget(value);
  if (!target) throw new Error(`Collaboration turn ${row.turn_id} has no exact execution target.`);
  return target;
}

function parseExecutionProvenance(row: CollaborationTurnRow): TurnExecutionProvenance | null {
  if (!row.result_provenance_json) return null;
  let value: unknown;
  try {
    value = JSON.parse(row.result_provenance_json);
  } catch {
    throw new Error(`Collaboration turn ${row.turn_id} has invalid execution provenance JSON.`);
  }
  const provenance = validateTurnExecutionProvenance(value, row.runtime_request_id);
  if (!provenance?.adapter) {
    throw new Error(`Collaboration turn ${row.turn_id} has incomplete execution provenance.`);
  }
  return provenance;
}

/** Minimal slice of CollaborationService the controller needs. */
interface CollaborationServiceSlice {
  appendMessage(input: {
    threadId: string;
    senderType: 'boss' | 'employee' | 'system';
    senderEmployeeId?: string | null;
    body: string;
    status?: 'pending' | 'streaming' | 'complete' | 'interrupted' | 'failed';
    senderLabel?: string | null;
    idempotencyKey?: string;
  }): Promise<CollaborationMessage>;
  listMembers(
    threadId: string,
  ): Promise<Array<{ employeeId?: string | null; actorType: 'boss' | 'employee' }>>;
}

/** What the controller knows about a thread to drive a turn (resolved by the caller). */
export interface CollaborationThreadContext {
  threadId: string;
  companyId: string;
  companyName: string;
  title: string;
  kind: 'direct' | 'group';
  replyPolicy: CollaborationReplyPolicy;
  capabilityProfile?: CollaborationProfile;
  /** For a direct thread: the single employee on the other side (null if deleted). */
  directEmployeeId?: string | null;
  roundSpeakerLimit: number;
  mcpTools?: unknown[];
  mcpToolsByEmployeeId?: ReadonlyMap<string, unknown[]>;
  /** Per-speaker employee binding layered over this conversation's selection. */
  runtimeByEmployeeId?: ReadonlyMap<string, EmployeeRuntimeSelection>;
  /** Active participants (identity context only), in stable roster order. */
  participants: readonly CollaborationParticipant[];
}

export interface CollaborationTurnControllerDeps {
  transport: CollaborationTransport;
  service: CollaborationServiceSlice;
  turns: CollaborationTurnRepository;
  /** Reads the visible message rows so the controller can stream-upsert under a stable id. */
  messages: Pick<CollaborationMessageRepository, 'update'>;
  /** Resolves the thread's runtime context (company, roster, policy). */
  resolveThread(threadId: string): Promise<CollaborationThreadContext>;
  /** Recent messages (any order) for the context window. */
  recentMessages(threadId: string): Promise<CollaborationMessage[]>;
  now(): string;
  newId(): string;
  /** Optional model / thinking overrides forwarded to the host per turn. */
  model?: (threadId: string) => string | undefined;
  thinkingLevel?: (threadId: string) => string | undefined;
}

type CollaborationTurnPhase = 'pending' | 'streaming' | 'complete' | 'interrupted' | 'failed';

/** A live (in-memory) view of one scheduled speaker turn. */
export interface CollaborationLiveTurn {
  turnId: string;
  threadId: string;
  roundId: string | null;
  employeeId: string;
  speakerName: string;
  /** The visible message row id this turn streams into (stable). */
  messageId: string;
  sequenceIndex: number;
  phase: CollaborationTurnPhase;
  /** Live-streamed body so far. */
  body: string;
  error?: string;
}

export interface CollaborationThreadSnapshot {
  threadId: string;
  /** Active speaker turns for this thread (most recent round). */
  turns: readonly CollaborationLiveTurn[];
  /** True while any turn in this thread is pending/streaming. */
  running: boolean;
  /** The terminal state of the most recent round, when bounded. */
  lastRound: { roundId: string; completed: boolean } | null;
}

/** Result of scheduling a turn batch (direct / mentions / round). */
export interface CollaborationScheduleResult {
  roundId: string | null;
  turns: readonly CollaborationLiveTurn[];
  /** `round.completed` once a roundtable round hit its speaker cap. */
  roundCompleted: boolean;
}

// Stable per-thread empty snapshots. The Connect hook renders this before the
// controller resolves (controller === null); useSyncExternalStore needs the SAME
// reference each call or it loops forever, so cache by threadId rather than
// minting a fresh object per render.
const EMPTY_SNAPSHOTS = new Map<string, CollaborationThreadSnapshot>();
const EMPTY_SNAPSHOT = (threadId: string): CollaborationThreadSnapshot => {
  const cached = EMPTY_SNAPSHOTS.get(threadId);
  if (cached) return cached;
  const snapshot: CollaborationThreadSnapshot = {
    threadId,
    turns: [],
    running: false,
    lastRound: null,
  };
  EMPTY_SNAPSHOTS.set(threadId, snapshot);
  return snapshot;
};

export class CollaborationTurnController {
  // Per-thread live state (in-memory; the durable ledger is collaboration_turns).
  private readonly threadState = new Map<string, CollaborationLiveTurn[]>();
  private readonly lastRoundByThread = new Map<string, { roundId: string; completed: boolean }>();
  // Per-thread monotonic sequence counter for collaboration_turns.sequence_index.
  private readonly sequenceByThread = new Map<string, number>();
  // Active abort controllers keyed by turnId (stop affects only that turn).
  private readonly abortByTurn = new Map<string, AbortController>();
  private readonly listeners = new Map<string, Set<() => void>>();
  // Cached per-thread snapshot. useSyncExternalStore requires getSnapshot to
  // return a STABLE reference between changes (a fresh object every call is an
  // infinite render loop / crash). emit() invalidates the thread's entry.
  private readonly snapshotCache = new Map<string, CollaborationThreadSnapshot>();

  constructor(private readonly deps: CollaborationTurnControllerDeps) {}

  // ── Public store API (PR-05 consumes these) ────────────────────────────────

  getSnapshot(threadId: string): CollaborationThreadSnapshot {
    const cached = this.snapshotCache.get(threadId);
    if (cached) return cached;
    const turns = this.threadState.get(threadId) ?? [];
    const snapshot: CollaborationThreadSnapshot = {
      threadId,
      turns: turns.map((t) => ({ ...t })),
      running: turns.some((t) => t.phase === 'pending' || t.phase === 'streaming'),
      lastRound: this.lastRoundByThread.get(threadId) ?? null,
    };
    this.snapshotCache.set(threadId, snapshot);
    return snapshot;
  }

  subscribe(threadId: string, listener: () => void): () => void {
    let set = this.listeners.get(threadId);
    if (!set) {
      set = new Set();
      this.listeners.set(threadId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  // ── Boss message + reply scheduling ─────────────────────────────────────────

  /**
   * Persist a boss/user message, then schedule AI replies per the thread's reply
   * policy. Direct → one turn. mentions_only → only @mentioned members (none →
   * NO auto-fire; the caller may invoke `askTeam`). silent / roundtable → the boss
   * message is persisted but NO turn auto-fires (roundtable needs explicit
   * `startRound`). Returns the scheduled batch (empty when nothing fires).
   */
  async sendBossMessage(
    threadId: string,
    body: string,
  ): Promise<{ message: CollaborationMessage; scheduled: CollaborationScheduleResult }> {
    const message = await this.deps.service.appendMessage({
      threadId,
      senderType: 'boss',
      body,
      status: 'complete',
      idempotencyKey: this.deps.newId(),
    });

    const ctx = await this.deps.resolveThread(threadId);

    if (ctx.kind === 'direct') {
      const employeeId = ctx.directEmployeeId ?? null;
      if (!employeeId) {
        return { message, scheduled: { roundId: null, turns: [], roundCompleted: false } };
      }
      const speaker = this.participantOrFallback(ctx, employeeId);
      const scheduled = await this.runBatch(ctx, null, [speaker], message);
      return { message, scheduled };
    }

    // Group thread.
    if (ctx.replyPolicy === 'mentions_only') {
      const mentioned = parseMentions(body, ctx.participants);
      if (mentioned.length === 0) {
        // No mention → do NOT auto-fire the whole group. The caller surfaces an
        // `Ask team` action instead.
        return { message, scheduled: { roundId: null, turns: [], roundCompleted: false } };
      }
      const scheduled = await this.runBatch(ctx, null, mentioned, message);
      return { message, scheduled };
    }

    // roundtable / silent: the boss message is persisted, but no turn auto-fires.
    // A roundtable needs an explicit `startRound`; silent never auto-replies.
    return { message, scheduled: { roundId: null, turns: [], roundCompleted: false } };
  }

  /**
   * Deterministic `Ask team` for a no-mention group message: pick the first
   * eligible employee (roster order), or the explicitly chosen responders. Never
   * fires the whole group implicitly.
   */
  async askTeam(
    threadId: string,
    triggerMessage: CollaborationMessage,
    responderEmployeeIds?: readonly string[],
  ): Promise<CollaborationScheduleResult> {
    const ctx = await this.deps.resolveThread(threadId);
    let speakers: CollaborationParticipant[];
    if (responderEmployeeIds && responderEmployeeIds.length > 0) {
      const byId = new Map(ctx.participants.map((p) => [p.employeeId, p]));
      speakers = responderEmployeeIds
        .map((id) => byId.get(id))
        .filter((p): p is CollaborationParticipant => p != null);
    } else {
      // Deterministic default: the first roster member.
      speakers = ctx.participants.slice(0, 1);
    }
    if (speakers.length === 0) {
      return { roundId: null, turns: [], roundCompleted: false };
    }
    return this.runBatch(ctx, null, speakers, triggerMessage);
  }

  /**
   * Start a bounded roundtable round (explicit user action). Schedules up to N
   * speakers (default 3, hard cap 8), in deterministic order (mention order first,
   * then member order), each at most one message. A later speaker receives prior
   * speakers' completed replies this round. At the cap, stops and returns
   * `roundCompleted: true`; the next round needs `continueRound` (a NEW round id).
   */
  async startRound(
    threadId: string,
    triggerMessage: CollaborationMessage,
    opts?: { maxSpeakers?: number; mentionedFromBody?: string },
  ): Promise<CollaborationScheduleResult> {
    const ctx = await this.deps.resolveThread(threadId);
    const mentioned = opts?.mentionedFromBody
      ? parseMentions(opts.mentionedFromBody, ctx.participants)
      : [];
    const ordered = scheduleSpeakers(mentioned, ctx.participants);
    const cap = clampRoundtableSpeakers(opts?.maxSpeakers ?? ctx.roundSpeakerLimit);
    const speakers = ordered.slice(0, cap);
    const roundId = `round-${this.deps.newId()}`;
    const scheduled = await this.runBatch(ctx, roundId, speakers, triggerMessage);
    // `roundCompleted` signals "the round stopped at the speaker cap with more
    // eligible speakers remaining" — i.e. offer Continue round. True ONLY when
    // more members exist than spoke this round; when every eligible speaker
    // already spoke, the round is fully drained and Continue is not implied.
    const hitCap = ordered.length > speakers.length;
    this.lastRoundByThread.set(threadId, { roundId, completed: hitCap });
    this.emit(threadId);
    return { ...scheduled, roundId, roundCompleted: hitCap };
  }

  /**
   * Continue a roundtable as a NEW round. Always mints a fresh round id — never
   * reuses a terminated turn id — so `round.completed` for the prior round stays
   * final. Same bounded scheduling as `startRound`.
   */
  async continueRound(
    threadId: string,
    triggerMessage: CollaborationMessage,
    opts?: { maxSpeakers?: number; mentionedFromBody?: string },
  ): Promise<CollaborationScheduleResult> {
    // continueRound is startRound with a guaranteed-new round id; startRound
    // already mints `round-${newId()}`, so this is the explicit-continue entry
    // point PR-05 calls (a different name keeps the "new round id" intent clear).
    return this.startRound(threadId, triggerMessage, opts);
  }

  // ── Stop / retry (per-turn) ─────────────────────────────────────────────────

  /** Stop a single in-flight turn (affects only that turn, not other speakers). */
  stop(turnId: string): void {
    this.abortByTurn.get(turnId)?.abort();
  }

  /** Stop every in-flight turn on a thread. */
  stopThread(threadId: string): void {
    for (const turn of this.threadState.get(threadId) ?? []) {
      if (turn.phase === 'pending' || turn.phase === 'streaming') this.stop(turn.turnId);
    }
  }

  /**
   * Retry a terminated turn: re-runs the SAME speaker against the same trigger,
   * re-using the same visible message id (stable upsert) and the same turn ledger
   * row. Only a failed / interrupted turn may be retried.
   */
  async retry(
    threadId: string,
    turnId: string,
    triggerMessage: CollaborationMessage,
  ): Promise<CollaborationLiveTurn | null> {
    const turns = this.threadState.get(threadId);
    const turn = turns?.find((t) => t.turnId === turnId) ?? null;
    if (!turn || (turn.phase !== 'failed' && turn.phase !== 'interrupted')) return null;
    const ctx = await this.deps.resolveThread(threadId);
    const speaker = this.participantOrFallback(ctx, turn.employeeId);
    await this.driveTurn(ctx, turn, speaker, triggerMessage, []);
    return { ...turn };
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private nextSequence(threadId: string): number {
    const next = (this.sequenceByThread.get(threadId) ?? 0) + 1;
    this.sequenceByThread.set(threadId, next);
    return next;
  }

  private participantOrFallback(
    ctx: CollaborationThreadContext,
    employeeId: string,
  ): CollaborationParticipant {
    return (
      ctx.participants.find((p) => p.employeeId === employeeId) ?? {
        employeeId,
        name: 'Teammate',
      }
    );
  }

  private async assertThreadExecutionLane(
    threadId: string,
    target: AiExecutionTarget,
  ): Promise<void> {
    const accepted = await this.deps.turns.bindThreadExecutionLane(threadId, {
      engineId: target.engineId,
      accountId: target.accountId,
      billingMode: target.billingMode,
    });
    if (!accepted) {
      throw new Error('A collaboration thread cannot switch AI engine, account, or billing lane.');
    }
  }

  private async persistPreparedExecutionIdentity(
    turnId: string,
    identity: TurnExecutionProvenance,
  ): Promise<void> {
    await this.deps.turns.update(turnId, {
      result_provenance_json: JSON.stringify(identity),
    });
    const row = await this.deps.turns.findById(turnId);
    const persisted = row ? parseExecutionProvenance(row) : null;
    if (
      !persisted ||
      !sameExecutionTarget(persisted, identity) ||
      persisted.runId !== identity.runId ||
      persisted.adapter?.id !== identity.adapter?.id ||
      persisted.adapter?.version !== identity.adapter?.version
    ) {
      throw new Error('The prepared collaboration identity failed durable readback.');
    }
  }

  private async assertDurableExecutionSelection(
    turnId: string,
    requestId: string,
    target: AiExecutionTarget,
  ): Promise<void> {
    const row = await this.deps.turns.findById(turnId);
    if (
      !row ||
      row.runtime_request_id !== requestId ||
      !sameExecutionTarget(parseExecutionTarget(row), target)
    ) {
      throw new Error('The collaboration execution target was not durably persisted.');
    }
  }

  /** Schedule + run a batch of speakers in order. Later speakers see prior
   *  speakers' completed replies this round. A speaker failure does not block
   *  already-completed messages; we continue to the next speaker and surface the
   *  failure on its turn. Returns the live turns. */
  private async runBatch(
    ctx: CollaborationThreadContext,
    roundId: string | null,
    speakers: readonly CollaborationParticipant[],
    triggerMessage: CollaborationMessage,
  ): Promise<CollaborationScheduleResult> {
    const created: CollaborationLiveTurn[] = [];
    const priorReplies: PriorRoundReply[] = [];
    // Reset the thread's live turns to this batch (the snapshot shows the active round).
    this.threadState.set(ctx.threadId, created);

    for (const speaker of speakers) {
      const turn = await this.openTurn(ctx, roundId, speaker, triggerMessage);
      created.push(turn);
      this.emit(ctx.threadId);
      await this.driveTurn(ctx, turn, speaker, triggerMessage, priorReplies);
      if (turn.phase === 'complete' && turn.body.trim()) {
        priorReplies.push({ speakerName: speaker.name, body: turn.body });
      }
    }
    return { roundId, turns: created.map((t) => ({ ...t })), roundCompleted: false };
  }

  /** Insert the ledger row (pending) + the visible streaming message (stable id). */
  private async openTurn(
    ctx: CollaborationThreadContext,
    roundId: string | null,
    speaker: CollaborationParticipant,
    triggerMessage: CollaborationMessage,
  ): Promise<CollaborationLiveTurn> {
    const turnId = this.deps.newId();
    const requestId = `collab-${turnId}`;
    const sequenceIndex = this.nextSequence(ctx.threadId);
    const employeeRuntime = ctx.runtimeByEmployeeId?.get(speaker.employeeId);
    const selection = await this.deps.transport.resolveExecutionSelection({
      model: employeeRuntime?.model ?? this.deps.model?.(ctx.threadId),
    });
    await this.assertThreadExecutionLane(ctx.threadId, selection.target);
    // The visible reply row, created empty + streaming under a STABLE id so the
    // controller can upsert body/status as the reply settles.
    const message = await this.deps.service.appendMessage({
      threadId: ctx.threadId,
      senderType: 'employee',
      senderEmployeeId: speaker.employeeId,
      senderLabel: speaker.name,
      body: '',
      status: 'streaming',
      idempotencyKey: turnId,
    });
    await this.deps.turns.insert({
      turn_id: turnId,
      thread_id: ctx.threadId,
      trigger_message_id: triggerMessage.messageId,
      employee_id: speaker.employeeId,
      sequence_index: sequenceIndex,
      status: 'pending',
      runtime_request_id: requestId,
      execution_target_json: JSON.stringify(selection.target),
      result_provenance_json: null,
      usage_json: null,
      error_summary: null,
      started_at: null,
      finished_at: null,
    });
    await this.assertDurableExecutionSelection(turnId, requestId, selection.target);
    return {
      turnId,
      threadId: ctx.threadId,
      roundId,
      employeeId: speaker.employeeId,
      speakerName: speaker.name,
      messageId: message.messageId,
      sequenceIndex,
      phase: 'pending',
      body: '',
    };
  }

  /** Run one speaker turn through the transport, streaming into its stable message
   *  id and advancing the ledger row. Never throws — a failure marks the turn and
   *  is surfaced on the snapshot. */
  private async driveTurn(
    ctx: CollaborationThreadContext,
    turn: CollaborationLiveTurn,
    speaker: CollaborationParticipant,
    triggerMessage: CollaborationMessage,
    priorReplies: readonly PriorRoundReply[],
  ): Promise<void> {
    const requestId = `collab-${turn.turnId}`;
    const controller = new AbortController();
    this.abortByTurn.set(turn.turnId, controller);
    turn.phase = 'streaming';
    turn.error = undefined;
    const startedAt = this.deps.now();
    await this.deps.turns.update(turn.turnId, {
      status: 'streaming',
      error_summary: null,
      started_at: startedAt,
      finished_at: null,
    });
    this.emit(ctx.threadId);

    const recent = recentWindow(await this.deps.recentMessages(ctx.threadId));
    const scopedMcpTools = ctx.mcpToolsByEmployeeId?.get(speaker.employeeId) ?? ctx.mcpTools ?? [];
    const employeeRuntime = ctx.runtimeByEmployeeId?.get(speaker.employeeId);
    const systemPromptAppend = buildContextPacket({
      companyName: ctx.companyName,
      threadTitle: ctx.title,
      replyPolicy: ctx.replyPolicy,
      participants: ctx.participants,
      recentMessages: recent,
      speaker,
      capabilityProfile: ctx.capabilityProfile,
      mcpToolNames: scopedMcpTools
        .map((tool) =>
          tool && typeof tool === 'object' && 'name' in tool
            ? (tool as { name?: unknown }).name
            : null,
        )
        .filter((name): name is string => typeof name === 'string' && name.length > 0),
      triggerMessageBody: triggerMessage.body,
      priorRoundReplies: priorReplies,
    });

    let result: CollaborationTurnResult | null = null;
    let failure: string | null = null;
    try {
      const row = await this.deps.turns.findById(turn.turnId);
      if (!row || row.runtime_request_id !== requestId) {
        throw new Error('The collaboration request id failed durable readback.');
      }
      const target = parseExecutionTarget(row);
      await this.assertThreadExecutionLane(ctx.threadId, target);
      const selection = await this.deps.transport.resolveExecutionSelection({
        frozenTarget: target,
      });
      if (!sameExecutionTarget(selection.target, target)) {
        throw new Error('The collaboration execution target changed before invocation.');
      }
      await this.assertDurableExecutionSelection(turn.turnId, requestId, target);
      result = await this.deps.transport.run(
        {
          requestId,
          companyId: ctx.companyId,
          collaborationThreadId: ctx.threadId,
          employeeId: speaker.employeeId,
          text: triggerMessage.body,
          systemPromptAppend,
          model: selection.runtimeModelRef,
          expectedTarget: target,
          runtimeModelRef: selection.runtimeModelRef,
          thinkingLevel: employeeRuntime?.thinkingLevel ?? this.deps.thinkingLevel?.(ctx.threadId),
          collaborationProfile: ctx.capabilityProfile,
          mcpTools: scopedMcpTools,
        },
        {
          onDelta: (delta) => {
            turn.body += delta;
            this.emit(ctx.threadId);
          },
          signal: controller.signal,
          verifyDurableTarget: async (identity: TurnExecutionProvenance) => {
            if (!sameExecutionTarget(identity, target)) {
              throw new Error('The prepared collaboration identity changed its durable target.');
            }
            await this.persistPreparedExecutionIdentity(turn.turnId, identity);
            await this.assertDurableExecutionSelection(turn.turnId, requestId, target);
          },
        },
      );
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    } finally {
      this.abortByTurn.delete(turn.turnId);
    }

    const finishedAt = this.deps.now();
    if (controller.signal.aborted) {
      // Stopped by the user: keep whatever streamed so far, mark interrupted.
      turn.phase = 'interrupted';
      await this.deps.messages.update(turn.messageId, {
        status: 'interrupted',
        edited_at: finishedAt,
      });
      await this.deps.turns.update(turn.turnId, {
        status: 'interrupted',
        ...(result
          ? {
              result_provenance_json: JSON.stringify(result.provenance),
              usage_json: result.usage ? JSON.stringify(result.usage) : null,
            }
          : {}),
        finished_at: finishedAt,
      });
      this.emit(ctx.threadId);
      return;
    }
    if (failure || !result) {
      turn.phase = 'failed';
      turn.error = failure ?? 'collaboration turn produced no reply';
      await this.deps.messages.update(turn.messageId, { status: 'failed', edited_at: finishedAt });
      await this.deps.turns.update(turn.turnId, {
        status: 'failed',
        error_summary: turn.error,
        finished_at: finishedAt,
      });
      this.emit(ctx.threadId);
      return;
    }

    turn.body = result.text;
    turn.phase = 'complete';
    await this.deps.messages.update(turn.messageId, {
      body: result.text,
      status: 'complete',
      edited_at: finishedAt,
    });
    await this.deps.turns.update(turn.turnId, {
      status: 'complete',
      result_provenance_json: JSON.stringify(result.provenance),
      usage_json: result.usage ? JSON.stringify(result.usage) : null,
      finished_at: finishedAt,
    });
    this.emit(ctx.threadId);
  }

  private emit(threadId: string): void {
    // Invalidate the cached snapshot so the next getSnapshot rebuilds with the
    // new state, then notify subscribers (useSyncExternalStore re-reads).
    this.snapshotCache.delete(threadId);
    for (const listener of this.listeners.get(threadId) ?? []) listener();
  }
}

export function createCollaborationTurnController(
  deps: CollaborationTurnControllerDeps,
): CollaborationTurnController {
  return new CollaborationTurnController(deps);
}

export { EMPTY_SNAPSHOT as emptyCollaborationSnapshot };
