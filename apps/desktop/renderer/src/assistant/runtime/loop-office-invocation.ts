/**
 * Loop → Office Send materializer (PR-10).
 *
 * Pure, injected-deps orchestrator for the send-time transaction that turns a
 * pinned Loop reference into a runnable Mission. NO React, NO Tauri, NO Pi —
 * everything it needs (loop service, mission create, invocation repo, run start,
 * id/clock factories) is passed in, so the harness drives the EXACT same code over
 * in-memory fakes and the renderer wires the real services. This is the single
 * authority for the Send-time ordering and the no-orphan compensation.
 *
 * Invariants (the PR-10 contract this module owns):
 *   - This module is the SOLE writer of `loop_invocations` (only at Send).
 *   - The pinned `revisionId` is read fresh and verified usable (ready, or
 *     archived-but-immutable). A deleted / corrupt / not-ready revision BLOCKS the
 *     send (throws) — it never materializes a half message.
 *   - The Mission REUSES the current Office thread — it never mints a dedicated
 *     mission chat thread (no sidebar pollution).
 *   - The run prompt carries the RESOLVED revision snapshot, so a future revision
 *     edit never changes already-executed history.
 *   - Ordering: invocation → mission → link(setMissionId) → run. If any step after
 *     the invocation insert fails, the invocation is compensated (deleted or marked
 *     failed) so no orphan invocation/mission survives a failed send.
 */

import {
  type CreateMissionInput,
  type LoopExecutionPacket,
  type LoopInvocationRepository,
  type LoopService,
  buildLoopExecutionPacket,
} from '@offisim/core/browser';
import type { LoopIR, LoopRevision } from '@offisim/shared-types';

/** Why a Loop reference cannot be sent — surfaced to the composer so the user can
 *  remove / reselect. Distinct from an infrastructure failure (those throw). */
export type LoopSendBlockReason =
  | 'revision-not-found' // deleted
  | 'revision-corrupt' // IR will not parse
  | 'revision-not-ready'; // compileStatus !== 'ready' (and not an archived ready snapshot)

export class LoopSendBlockedError extends Error {
  constructor(
    readonly reason: LoopSendBlockReason,
    message: string,
  ) {
    super(message);
    this.name = 'LoopSendBlockedError';
  }
}

/** The mission-create seam the materializer calls. Mirrors the existing manual
 *  `createMission` + `markReady` path, but threaded so the Mission REUSES the
 *  Office thread instead of minting a dedicated one. Returns the new mission id. */
export interface LoopMissionCreator {
  createReadyMission(input: CreateMissionInput): Promise<{ missionId: string }>;
}

export interface MaterializeLoopSendDeps {
  loopService: Pick<LoopService, 'getRevision' | 'listSkillBindings'>;
  loopInvocations: Pick<LoopInvocationRepository, 'insert' | 'setMissionId' | 'findById'>;
  missionCreator: LoopMissionCreator;
  /** Compensation for a post-invocation failure: remove the orphan invocation. The
   *  renderer wires a hard delete; if a backend cannot delete, it may mark the row
   *  `failed` — either way the invocation never dangles as a phantom `pending`. */
  compensateInvocation: (invocationId: string) => Promise<void>;
  newId: () => string;
  /** ISO-8601 now(). */
  now: () => string;
}

export interface MaterializeLoopSendInput {
  reference: {
    loopId: string;
    /** The PINNED revision id — read fresh here, never trusted from the snapshot. */
    revisionId: string;
  };
  companyId: string;
  projectId: string | null;
  /** The CURRENT Office thread the Mission reuses (no dedicated mission thread). */
  threadId: string;
  /** The user message row id this invocation binds to. */
  messageId: string;
}

export interface MaterializeLoopSendResult {
  invocationId: string;
  missionId: string;
  packet: LoopExecutionPacket;
}

/** The runtime-context block the Mission run carries (the resolved revision
 *  snapshot). Frozen so a later revision edit cannot rewrite executed history. */
interface LoopRunContext {
  loopId: string;
  revisionId: string;
  revisionNumber: number;
  title: string;
  sourcePrompt: string;
}

function parseIr(revision: LoopRevision): LoopIR {
  let parsed: unknown;
  try {
    parsed = JSON.parse(revision.compiledIrJson);
  } catch {
    throw new LoopSendBlockedError(
      'revision-corrupt',
      `Loop revision ${revision.revisionId} has a corrupt IR and cannot be run.`,
    );
  }
  // A ready revision always carries a non-empty IR object; an empty `{}` (the
  // needs_input/invalid placeholder) is corrupt for execution purposes.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LoopSendBlockedError(
      'revision-corrupt',
      `Loop revision ${revision.revisionId} has a non-object IR and cannot be run.`,
    );
  }
  const ir = parsed as LoopIR;
  if (!ir.completion || !Array.isArray(ir.completion.acceptance)) {
    throw new LoopSendBlockedError(
      'revision-corrupt',
      `Loop revision ${revision.revisionId} IR is missing its completion contract.`,
    );
  }
  return ir;
}

/**
 * Verify the pinned revision is usable and build the execution packet. Throws
 * {@link LoopSendBlockedError} for a user-fixable block (deleted / corrupt / not
 * ready) so the composer can prompt remove/reselect WITHOUT having written
 * anything. Does NOT touch the invocation/mission tables — read + build only.
 *
 * `compileStatus === 'ready'` is the gate; an ARCHIVED loop is irrelevant here —
 * a revision is immutable, so a ready revision stays replayable even after its
 * loop is archived (the spec's "archived-but-immutable still usable").
 */
export async function buildLoopPacketForSend(
  deps: Pick<MaterializeLoopSendDeps, 'loopService'>,
  reference: { loopId: string; revisionId: string },
): Promise<{ packet: LoopExecutionPacket; revision: LoopRevision; ir: LoopIR }> {
  let revision: LoopRevision;
  try {
    revision = await deps.loopService.getRevision(reference.revisionId);
  } catch (error) {
    // Structural check, not `instanceof`: `LoopServiceError` is re-exported through
    // the `@offisim/core/browser` barrel AND defined in source, so a dual module
    // instance can make `instanceof` falsely fail under the harness loader. Keying
    // off the stable `code` string is robust across both.
    if (isLoopServiceErrorCode(error, 'revision_not_found')) {
      throw new LoopSendBlockedError(
        'revision-not-found',
        `Loop revision ${reference.revisionId} no longer exists. Remove or reselect the Loop.`,
      );
    }
    throw error;
  }
  if (revision.compileStatus !== 'ready') {
    throw new LoopSendBlockedError(
      'revision-not-ready',
      `Loop revision ${reference.revisionId} is "${revision.compileStatus}", not ready to run.`,
    );
  }
  const ir = parseIr(revision);
  const skills = await deps.loopService.listSkillBindings(reference.revisionId);
  const packet = buildLoopExecutionPacket(revision, ir, skills);
  return { packet, revision, ir };
}

/** The resolved-revision snapshot the run carries (frozen execution history). */
function loopRunContext(
  packet: LoopExecutionPacket,
  revisionNumber: number,
): LoopRunContext {
  return {
    loopId: packet.loopId,
    revisionId: packet.revisionId,
    revisionNumber,
    title: packet.title,
    sourcePrompt: packet.sourcePrompt,
  };
}

/**
 * The send-time transaction. Assumes the chat thread + user message have ALREADY
 * been materialized by the caller (existing Office Send rule) — this owns only the
 * loop-specific records and their no-orphan ordering:
 *
 *   1. (pre) verify revision + build packet — throws (no writes) if blocked.
 *   2. insert loop_invocation (status `pending`, mission_id null) bound to
 *      message/thread/project.
 *   3. create + ready the Mission, REUSING `threadId` (no dedicated thread).
 *   4. link: setMissionId(invocationId, missionId).
 *
 * If step 3 or 4 throws, the invocation is compensated (step 2 undone) so it never
 * orphans. The run itself (LoopRunStarter) is fired by the CALLER after this
 * returns, outside the durable transaction.
 */
export async function materializeLoopSend(
  deps: MaterializeLoopSendDeps,
  input: MaterializeLoopSendInput,
): Promise<MaterializeLoopSendResult> {
  const { packet, revision } = await buildLoopPacketForSend(deps, input.reference);

  const invocationId = deps.newId();
  await deps.loopInvocations.insert({
    invocation_id: invocationId,
    loop_id: packet.loopId,
    revision_id: packet.revisionId,
    company_id: input.companyId,
    project_id: input.projectId,
    thread_id: input.threadId,
    message_id: input.messageId,
    mission_id: null,
    status: 'pending',
    created_at: deps.now(),
  });

  try {
    // The Mission REUSES the Office thread. The run prompt carries the resolved
    // revision snapshot so executed history is frozen against future edits. The IR
    // is NOT copied into the mission table — only the packet's missionDraft (goal /
    // policy / budget / criteria) lands; the IR stays the loop revision's truth.
    const runtimeContextJson = JSON.stringify(loopRunContext(packet, revision.revisionNumber));
    const created = await deps.missionCreator.createReadyMission({
      companyId: input.companyId,
      threadId: input.threadId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      title: packet.title,
      goal: packet.missionDraft.goal,
      runtimeId: 'pi',
      // Fold the resolved-revision snapshot into the runtime policy the mission
      // carries (the policy already encodes profile + loop/revision ids from the
      // packet; add the human-readable snapshot so the run prompt is reproducible).
      runtimePolicyJson: mergeRuntimePolicy(packet.missionDraft.runtimePolicyJson, runtimeContextJson),
      budgetJson: packet.missionDraft.budgetJson,
      criteria: packet.missionDraft.criteria.map((c) => ({
        description: c.description,
        evaluatorId: c.evaluatorId,
        evaluatorConfigJson: c.evaluatorConfigJson,
        required: c.required,
        orderIndex: c.orderIndex,
      })),
    });
    await deps.loopInvocations.setMissionId(invocationId, created.missionId);
    return { invocationId, missionId: created.missionId, packet };
  } catch (error) {
    // Compensate: the mission create / link failed AFTER the invocation insert.
    // Undo the invocation so a failed send leaves NO orphan. Compensation failure
    // is logged by the caller but never masks the original error.
    try {
      await deps.compensateInvocation(invocationId);
    } catch (compensationError) {
      throw new AggregateLoopSendError(error, compensationError);
    }
    throw error;
  }
}

/** Raised when BOTH the transaction body and its compensation fail — surfaces both
 *  so the caller can log the leak (an invocation that could not be undone). */
export class AggregateLoopSendError extends Error {
  constructor(
    readonly cause: unknown,
    readonly compensationError: unknown,
  ) {
    super(
      `Loop send failed and compensation also failed. cause=${describe(cause)} compensation=${describe(compensationError)}`,
    );
    this.name = 'AggregateLoopSendError';
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True when `error` is a LoopServiceError carrying the given `code` — checked
 *  structurally (name + code) so a dual module instance never breaks detection. */
function isLoopServiceErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'LoopServiceError' &&
    (error as { code?: unknown }).code === code
  );
}

/** Merge the packet's runtime policy with the resolved-revision snapshot under a
 *  stable `loopRunContext` key, without losing the packet's profile/loop trace. */
function mergeRuntimePolicy(policyJson: string, runContextJson: string): string {
  let policy: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(policyJson) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      policy = parsed as Record<string, unknown>;
    }
  } catch {
    policy = {};
  }
  let runContext: unknown = {};
  try {
    runContext = JSON.parse(runContextJson);
  } catch {
    runContext = {};
  }
  return JSON.stringify({ ...policy, loopRunContext: runContext });
}
