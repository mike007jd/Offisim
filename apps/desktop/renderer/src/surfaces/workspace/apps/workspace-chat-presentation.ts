/**
 * Pure presentation invariant for the Workspace/Connect assistant transcript.
 *
 * One active attempt owns exactly one assistant response slot. Before the first
 * visible assistant content arrives we render a single synthetic
 * `PendingAssistantRow`; the instant any real assistant payload lands the
 * pending row disappears in the same render. These functions are deliberately
 * React-free and side-effect-free so they can be unit-tested directly by the
 * `harness-workspace-chat-presentation` harness.
 *
 * The bug this fixes: a persisted EMPTY assistant shell (no body / reasoning /
 * tool calls) used to render through `ThreadPrimitive.Messages` AT THE SAME TIME
 * as the synthetic thinking row — two pending boxes, and the empty non-boss
 * shell mislabeled as `Employee`. The fix filters on payload, never on label,
 * height, or `display:none`.
 */

/** A presentable tool call. We treat any tool call with an id as renderable —
 *  a started-but-unfinished tool is already a real activity (spec case 6). */
interface PresentationToolCall {
  id?: string;
  name?: string;
  status?: string;
}

/** The minimal shape both the base/persisted `WsMessage` projection and the
 *  live `ChatMessage` projection map onto. Anything the invariant needs to
 *  decide visibility lives here; presentation-only fields (avatars, time label)
 *  stay in the view layer. */
export interface PresentationMessage {
  id: string;
  /** 'boss' is the local user; anything else is an assistant/employee turn. */
  author: string;
  body?: string;
  reasoning?: string;
  toolCalls?: readonly PresentationToolCall[] | undefined;
  /** Inline attachment (a real deliverable/file on the turn). */
  attachment?: unknown;
  /** Deliverable card on the turn. */
  deliverable?: unknown;
  /**
   * Live persistence/run state. A terminal `interrupted`/`failed` is itself a
   * visible payload — the turn must render an honest empty/error terminal state
   * rather than hang as a permanent thinking row (spec cases 8 + 10).
   */
  status?: string;
  /** Run attempt that produced this turn; lets pending detection key on the
   *  CURRENT attempt instead of "did this thread ever have an assistant turn". */
  attemptId?: string | null;
  /** Epoch ms used only to order the merged transcript; optional so the pure
   *  predicates can run on fixtures that don't care about ordering. */
  at?: number;
}

/** The minimal shape `mergePresentationMessages` needs to de-dup + order. */
export interface MergeableMessage {
  id: string;
  at?: number;
}

/**
 * Merge ordered message sources into one transcript, de-duping by id.
 *
 * Spec requirement 5: exactly one row per id, and when the same id appears in
 * both a persisted checkpoint and the live draft the LIVE draft must win. That
 * guarantee is purely positional — later sources overwrite earlier ones in the
 * `Map` — so callers MUST pass sources in `base → persisted → live` order. The
 * live draft (passed last) therefore survives; an empty persisted shell under
 * the same id is replaced by the real live row and then clears the payload
 * filter. Result is stably ordered by `at`.
 */
export function mergePresentationMessages<T extends MergeableMessage>(
  ...sources: ReadonlyArray<readonly T[]>
): T[] {
  const merged = new Map<string, T>();
  for (const source of sources) {
    for (const message of source) {
      merged.set(message.id, message);
    }
  }
  return Array.from(merged.values()).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

function isBoss(message: Pick<PresentationMessage, 'author'>): boolean {
  return message.author === 'boss';
}

function hasNonEmpty(value: string | undefined): boolean {
  return !!value && value.trim().length > 0;
}

function hasPresentableToolCall(toolCalls: readonly PresentationToolCall[] | undefined): boolean {
  if (!toolCalls || toolCalls.length === 0) return false;
  // A tool call is presentable as soon as it has an identity — even a
  // still-running one is a real activity, so it must suppress the pending row.
  return toolCalls.some((tool) => !!tool && (hasNonEmpty(tool.id) || hasNonEmpty(tool.name)));
}

/** Terminal run states that should render as an explicit empty/error message
 *  rather than leave a permanent pending row. `streaming` and `complete` are
 *  deliberately EXCLUDED: a streaming turn is only visible once it carries real
 *  body/reasoning/tool payload (the pending row covers the zero-content window),
 *  and a `complete` turn likewise stands on its own payload. Adding `streaming`
 *  here would let an empty in-flight shell masquerade as visible content and
 *  prematurely close the pending slot. */
const TERMINAL_STATUSES = new Set(['interrupted', 'failed']);

/**
 * True iff an assistant message has at least one renderable thing:
 * non-empty body, OR non-empty reasoning, OR ≥1 presentable tool call, OR an
 * attachment/deliverable, OR an explicit terminal error/interrupted status.
 * An empty assistant shell → false. (Boss/user messages are not the concern of
 * this predicate; callers gate on author first.)
 */
export function hasVisibleAssistantPayload(message: PresentationMessage): boolean {
  if (hasNonEmpty(message.body)) return true;
  if (hasNonEmpty(message.reasoning)) return true;
  if (hasPresentableToolCall(message.toolCalls)) return true;
  if (message.attachment != null) return true;
  if (message.deliverable != null) return true;
  if (message.status && TERMINAL_STATUSES.has(message.status)) return true;
  return false;
}

/**
 * Filter out empty assistant shells so they never reach the transcript.
 *
 * - boss/user messages always pass;
 * - assistant messages pass only when `hasVisibleAssistantPayload` is true.
 *
 * Empty persisted assistant shells (legacy rows, just-created checkpoints) are
 * removed from the rendered list — the underlying DB row is untouched, and if
 * real content later arrives under the same id the merge replaces the shell so
 * it passes the filter on the next render.
 */
export function visibleWorkspaceMessages<T extends PresentationMessage>(
  messages: readonly T[],
): T[] {
  return messages.filter((message) =>
    isBoss(message) ? true : hasVisibleAssistantPayload(message),
  );
}

/**
 * Decide whether to show the single synthetic pending assistant row for the
 * CURRENT attempt.
 *
 * True iff the run is active AND there is no visible assistant message for the
 * active attempt yet. It must not be fooled by:
 *  - a prior thread's / prior attempt's assistant message (key on attemptId);
 *  - an empty persisted shell (those are already removed from `visibleMessages`,
 *    and we re-check payload defensively here).
 *
 * `activeAttemptId` is the run's current `attemptId`. When the run has no
 * attempt id (idle / not yet prepared) we never show a pending row.
 */
export function shouldShowPendingReply(input: {
  run: { phase: string; attemptId?: string | null };
  visibleMessages: readonly PresentationMessage[];
  activeAttemptId?: string | null;
}): boolean {
  const { run, visibleMessages } = input;
  if (!isRunPhaseActive(run.phase)) return false;
  const activeAttemptId = input.activeAttemptId ?? run.attemptId ?? null;
  if (!activeAttemptId) {
    // Active run with no attempt id yet (preparing before the attempt lands):
    // there cannot be a visible assistant turn for it, so show the pending row.
    return true;
  }
  // A visible assistant turn for THIS attempt closes the pending slot. We accept
  // a turn that either carries the active attemptId, or carries no attemptId at
  // all (base/persisted projections drop it) — in the latter case the message is
  // only in `visibleMessages` because it already passed the payload filter, so
  // it is a real, in-thread assistant turn for the live run.
  const hasVisibleAssistantForAttempt = visibleMessages.some((message) => {
    if (isBoss(message)) return false;
    if (!hasVisibleAssistantPayload(message)) return false;
    if (message.attemptId == null) return true;
    return message.attemptId === activeAttemptId;
  });
  return !hasVisibleAssistantForAttempt;
}

/**
 * Phases where the run is still owed a reply. Mirrors the controller's
 * `isConversationRunActive`; duplicated here to keep this module dependency-free
 * and unit-testable without the React/runtime graph.
 *
 * Message id de-dup (spec requirement 5 — one row per id, live draft wins over a
 * persisted checkpoint) is already guaranteed upstream by the merge step, which
 * keys a `Map` by id over sources ordered base → persisted → live, so the live
 * draft is the surviving value. `visibleWorkspaceMessages` operates on that
 * already-deduped list and never re-expands an id.
 */
function isRunPhaseActive(phase: string): boolean {
  return phase === 'preparing' || phase === 'running' || phase === 'awaiting-approval';
}
