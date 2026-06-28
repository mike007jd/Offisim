import { create } from 'zustand';

/**
 * Composer Loop reference state (PR-10).
 *
 * A Loop reference is a STRUCTURED, pinned-revision chip in the composer — never a
 * mutable `@LoopName` string in the textarea. The user inserts it from the Loops
 * page ("Use in Office") or the in-composer `/loop` picker (both call the same
 * insert API); it does NOT run on insert. Only Send materializes the invocation +
 * Mission (see loop-office-invocation.ts).
 *
 * Frozen reference shape: a snapshot of the loop title/revision number/profile at
 * insert time, plus the immutable `revisionId` that pins execution history. The
 * snapshot never follows a later revision edit — a "newer revision available"
 * badge is surfaced by the chip from a fresh read, and the user must EXPLICITLY
 * Update (`replaceReference`), it is never auto-swapped.
 *
 * Per-thread + ephemeral (NOT persisted): a pinned revision must not survive a
 * reload as a dangling chip — the draft is gone, the chip goes with it. Mirrors
 * the per-thread shape of `pi-thread-model-store`, the ephemerality of
 * `composer-attachment-store`.
 *
 * v1 rule (FROZEN + tested): at most ONE primary execution Loop per message. A
 * second `/loop` insert is BLOCKED with a clear reason rather than silently
 * dropped or appended — multiple supporting refs are an explicit future scope.
 */

/** The structured, pinned-revision Loop reference held in composer state. */
export interface ComposerLoopReference {
  /** Local chip id (stable within a thread's draft lifetime). */
  id: string;
  loopId: string;
  /** Pinned, immutable — the execution-history anchor. */
  revisionId: string;
  /** Loop title at insert time (snapshot; not re-read on Send). */
  titleSnapshot: string;
  /** Revision number at insert time (the `vN` the chip shows). */
  revisionNumber: number;
  profileId: string;
  insertedAt: number;
}

/** Result of an insert attempt: `ok` carries the new ref; otherwise a reason the
 *  caller surfaces (the v1 single-primary rule, or a same-revision no-op). */
type InsertLoopReferenceResult =
  | { ok: true; reference: ComposerLoopReference }
  | { ok: false; reason: 'already-present'; existing: ComposerLoopReference };

export interface InsertLoopReferenceInput {
  loopId: string;
  revisionId: string;
  titleSnapshot: string;
  revisionNumber: number;
  profileId: string;
}

interface ComposerLoopReferenceStore {
  /** One primary reference per thread (v1). Absent = no Loop on this draft. */
  byThread: Record<string, ComposerLoopReference>;
  /**
   * Insert the primary Loop reference for a thread. Blocks a second DISTINCT loop
   * (v1 single-primary rule). Re-inserting the SAME loop+revision is a no-op that
   * still reports `already-present` (idempotent), so a double "Use in Office"
   * never duplicates or errors confusingly.
   */
  insertReference: (threadId: string, input: InsertLoopReferenceInput) => InsertLoopReferenceResult;
  /**
   * Explicit user Update to a newer/other revision of the SAME loop — replaces the
   * pinned revision in place (keeps the chip id). Never called automatically.
   */
  replaceReference: (threadId: string, input: InsertLoopReferenceInput) => ComposerLoopReference;
  /** Remove the Loop reference from a thread (chip "remove" / reselect). */
  removeReference: (threadId: string) => void;
  /** Clear after the message is sent (or the draft is abandoned). */
  clearReference: (threadId: string) => void;
}

function nextChipId(): string {
  return `loopref-${crypto.randomUUID()}`;
}

export const useComposerLoopReferenceStore = create<ComposerLoopReferenceStore>((set, get) => ({
  byThread: {},
  insertReference: (threadId, input) => {
    const existing = get().byThread[threadId];
    if (existing) {
      // v1: one primary Loop per message. A second insert — whether the same loop
      // or a different one — is blocked, not appended. The caller decides whether
      // to surface "already references <title>" or "Updated" (for same-loop).
      return { ok: false, reason: 'already-present', existing };
    }
    const reference: ComposerLoopReference = {
      id: nextChipId(),
      loopId: input.loopId,
      revisionId: input.revisionId,
      titleSnapshot: input.titleSnapshot,
      revisionNumber: input.revisionNumber,
      profileId: input.profileId,
      insertedAt: Date.now(),
    };
    set((state) => ({ byThread: { ...state.byThread, [threadId]: reference } }));
    return { ok: true, reference };
  },
  replaceReference: (threadId, input) => {
    const existing = get().byThread[threadId];
    const reference: ComposerLoopReference = {
      id: existing?.id ?? nextChipId(),
      loopId: input.loopId,
      revisionId: input.revisionId,
      titleSnapshot: input.titleSnapshot,
      revisionNumber: input.revisionNumber,
      profileId: input.profileId,
      insertedAt: existing?.insertedAt ?? Date.now(),
    };
    set((state) => ({ byThread: { ...state.byThread, [threadId]: reference } }));
    return reference;
  },
  removeReference: (threadId) =>
    set((state) => {
      if (!state.byThread[threadId]) return {};
      const next = { ...state.byThread };
      delete next[threadId];
      return { byThread: next };
    }),
  clearReference: (threadId) =>
    set((state) => {
      if (!state.byThread[threadId]) return {};
      const next = { ...state.byThread };
      delete next[threadId];
      return { byThread: next };
    }),
}));

/** Read the current primary Loop reference for a thread (null when none). */
export function resolveLoopReference(threadId: string): ComposerLoopReference | null {
  return useComposerLoopReferenceStore.getState().byThread[threadId] ?? null;
}

/** The stable chip-token form a Loop reference emits into a message body so the
 *  PR-06 protected-span pipeline detects + preserves it across Enhance, and the
 *  transcript can render the chip. Shape: `[[loop:<revisionId>]]` — frozen with
 *  the enhance contract (protected-spans.ts LOOP_REF_RE). The id carried is the
 *  immutable revision id, so the protected token pins the executed revision too. */
export function loopReferenceToken(reference: ComposerLoopReference): string {
  return `[[loop:${reference.revisionId}]]`;
}

/** Matches any loop token (same shape as the enhance contract's LOOP_REF_RE). */
const LOOP_TOKEN_RE = /\[\[loop:[A-Za-z0-9._-]+\]\]/g;

/** Remove every loop token from a string. Used so the structured chip is the single
 *  source of the loop reference — the token is appended exactly once at send time,
 *  never carried as user-typed text (even if a seed/paste introduced one). */
export function stripLoopTokens(text: string): string {
  return text
    .replace(LOOP_TOKEN_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
