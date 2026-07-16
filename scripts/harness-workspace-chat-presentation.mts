import assert from 'node:assert/strict';
import { runWorkspaceDisclosureMarkupOracle } from '../apps/desktop/renderer/scripts/workspace-disclosure-markup-oracle.js';
import { formatWorkspaceProvenance } from '../apps/desktop/renderer/src/assistant/presentation/workspace-provenance.js';
import {
  type PresentationMessage,
  hasVisibleAssistantPayload,
  mergePresentationMessages,
  shouldShowPendingReply,
  visibleWorkspaceMessages,
} from '../apps/desktop/renderer/src/surfaces/office/rail/connect/company-chat-presentation.js';

type ScenarioEvidence = Record<string, unknown>;

const ATTEMPT = 'attempt-1';

/** A boss/user turn (always visible). */
function boss(id: string, body = 'Run the launch checklist'): PresentationMessage {
  return { id, author: 'boss', body, attemptId: ATTEMPT };
}

/** An EMPTY assistant shell — no body / reasoning / tool calls / attachment.
 *  This is the legacy/persisted row that used to render as a second pending
 *  box mislabeled `Employee`. */
function emptyAssistantShell(
  id: string,
  overrides: Partial<PresentationMessage> = {},
): PresentationMessage {
  return { id, author: 'employee', body: '', ...overrides };
}

/** A run snapshot stub. */
function run(
  phase: string,
  attemptId: string | null = ATTEMPT,
): {
  phase: string;
  attemptId: string | null;
} {
  return { phase, attemptId };
}

/**
 * Compute what the component computes: filter the merged list to visible, then
 * decide whether the single pending row shows. Returns the rendered shape so the
 * assertions read like the DOM the user sees.
 */
function render(input: {
  phase: string;
  attemptId?: string | null;
  merged: PresentationMessage[];
}): {
  visible: PresentationMessage[];
  visibleAssistantCount: number;
  pending: boolean;
  pendingRows: number;
  assistantResponseSlots: number;
} {
  const attemptId = input.attemptId ?? ATTEMPT;
  const visible = visibleWorkspaceMessages(input.merged);
  const pending = shouldShowPendingReply({
    run: run(input.phase, attemptId),
    visibleMessages: visible,
    activeAttemptId: attemptId,
  });
  const visibleAssistantCount = visible.filter((m) => m.author !== 'boss').length;
  return {
    visible,
    visibleAssistantCount,
    pending,
    pendingRows: pending ? 1 : 0,
    // The invariant: at most one assistant response slot per active attempt —
    // either the pending row OR a real assistant turn, never both.
    assistantResponseSlots: visibleAssistantCount + (pending ? 1 : 0),
  };
}

const scenarios: Array<{
  name: string;
  criteria: string;
  run: () => ScenarioEvidence;
}> = [
  {
    name: 'workspace disclosure -> production display markup keeps complete provenance',
    criteria:
      'The production display components wired into RunActivityStrip and MessageItem expose the complete cwd + reason; expanded disclosure is selectable and never uses the generic 22-character summary.',
    run: runWorkspaceDisclosureMarkupOracle,
  },
  {
    name: 'group + preparing + only user live -> exactly 1 pending (Team)',
    criteria:
      'Active group run with only the user message yields exactly one pending row and no assistant shell.',
    run: () => {
      const r = render({ phase: 'preparing', merged: [boss('u1')] });
      assert.equal(r.visibleAssistantCount, 0);
      assert.equal(r.pendingRows, 1);
      assert.equal(r.assistantResponseSlots, 1);
      return { ...r, visibleIds: r.visible.map((m) => m.id) };
    },
  },
  {
    name: 'group + persisted empty employee shell + live user -> still 1 pending row',
    criteria:
      'A persisted EMPTY assistant shell is filtered out, so only the synthetic pending row remains.',
    run: () => {
      const merged = [boss('u1'), emptyAssistantShell('a-empty', { attemptId: ATTEMPT })];
      const r = render({ phase: 'running', merged });
      // The empty shell must NOT render and must NOT close the pending slot.
      assert.equal(
        r.visible.some((m) => m.id === 'a-empty'),
        false,
      );
      assert.equal(r.visibleAssistantCount, 0);
      assert.equal(r.pendingRows, 1);
      assert.equal(r.assistantResponseSlots, 1);
      return { ...r, visibleIds: r.visible.map((m) => m.id) };
    },
  },
  {
    name: 'direct + employee id -> 1 employee-named pending row',
    criteria:
      'A direct chat with an active run shows exactly one pending row (the label is the employee name, decided by the view; the invariant is the single slot).',
    run: () => {
      const r = render({ phase: 'running', merged: [boss('u1')] });
      assert.equal(r.pendingRows, 1);
      assert.equal(r.assistantResponseSlots, 1);
      return r;
    },
  },
  {
    name: 'first body chunk -> pending gone, 1 real assistant row',
    criteria:
      'Once the assistant body has content the pending row disappears and the real row is the only slot.',
    run: () => {
      const merged: PresentationMessage[] = [
        boss('u1'),
        { id: 'a1', author: 'employee', body: 'Launch ready', attemptId: ATTEMPT },
      ];
      const r = render({ phase: 'running', merged });
      assert.equal(r.pending, false);
      assert.equal(r.visibleAssistantCount, 1);
      assert.equal(r.assistantResponseSlots, 1);
      assert.equal(merged[1] ? hasVisibleAssistantPayload(merged[1]) : false, true);
      return { ...r, visibleIds: r.visible.map((m) => m.id) };
    },
  },
  {
    name: 'reasoning before body -> pending gone, reasoning row visible',
    criteria:
      'A reasoning-only assistant turn (no body yet) is a visible payload: pending closes, the reasoning row shows.',
    run: () => {
      const merged: PresentationMessage[] = [
        boss('u1'),
        {
          id: 'a1',
          author: 'employee',
          body: '',
          reasoning: 'checking context',
          attemptId: ATTEMPT,
        },
      ];
      const r = render({ phase: 'running', merged });
      assert.equal(r.pending, false);
      assert.equal(r.visibleAssistantCount, 1);
      assert.equal(r.assistantResponseSlots, 1);
      return { ...r, visibleIds: r.visible.map((m) => m.id) };
    },
  },
  {
    name: 'tool state before body -> no empty bubble, one real activity row',
    criteria:
      'A running tool call (no body yet) is a presentable activity: no empty bubble, pending closes, one real row.',
    run: () => {
      const merged: PresentationMessage[] = [
        boss('u1'),
        {
          id: 'a1',
          author: 'employee',
          body: '',
          toolCalls: [{ id: 'tool-read', name: 'read_file', status: 'running' }],
          attemptId: ATTEMPT,
        },
      ];
      const r = render({ phase: 'running', merged });
      assert.equal(r.pending, false);
      assert.equal(r.visibleAssistantCount, 1);
      assert.equal(r.assistantResponseSlots, 1);
      return { ...r, visibleIds: r.visible.map((m) => m.id) };
    },
  },
  {
    name: 'completed recovered workspace -> reload keeps full cwd + reason visible',
    criteria:
      'A durable workspace disclosure is real assistant payload: after reload it remains one visible turn with the complete path and recovery reason, without a synthetic pending row.',
    run: () => {
      const workspaceProvenance = {
        availability: 'bound' as const,
        source: 'known_root_recovery' as const,
        reasonCode: 'renamed_same_filesystem_object' as const,
        displayPath: '/Users/alex/Work/renamed-client-project/game',
      };
      const persistedAfterReload: PresentationMessage = {
        id: 'a-workspace',
        author: 'employee',
        body: '',
        workspaceProvenance,
        attemptId: ATTEMPT,
      };
      assert.equal(hasVisibleAssistantPayload(persistedAfterReload), true);
      const r = render({ phase: 'completed', merged: [boss('u1'), persistedAfterReload] });
      assert.equal(r.pending, false);
      assert.equal(r.visibleAssistantCount, 1);
      assert.equal(r.assistantResponseSlots, 1);
      assert.deepEqual(r.visible[1]?.workspaceProvenance, workspaceProvenance);
      const visibleProvenance = r.visible[1]?.workspaceProvenance;
      assert.ok(visibleProvenance);
      const disclosure = formatWorkspaceProvenance(visibleProvenance);
      assert.match(disclosure ?? '', /renamed-client-project\/game/);
      assert.match(disclosure ?? '', /filesystem identity still matches/);
      return {
        visibleIds: r.visible.map((message) => message.id),
        workspaceProvenance: r.visible[1]?.workspaceProvenance,
        disclosure,
      };
    },
  },
  {
    name: 'checkpoint + live draft same id -> 1 row, live draft wins',
    criteria:
      'When a persisted EMPTY checkpoint shell and a live draft share an id, the merge (base→persisted→live order) keeps the live draft, so exactly one real row renders and the empty shell never wins.',
    run: () => {
      // Exercise the REAL de-dup: same id appears as an empty persisted shell AND
      // as a live draft with content. Sources are ordered base -> persisted -> live
      // exactly as the component passes them; the live draft (last) must survive.
      const base: PresentationMessage[] = [boss('u1')];
      const persisted: PresentationMessage[] = [
        emptyAssistantShell('a-shared', { attemptId: ATTEMPT, at: 10 }),
      ];
      const live: PresentationMessage[] = [
        { id: 'a-shared', author: 'employee', body: 'live draft text', attemptId: ATTEMPT, at: 20 },
      ];
      const merged = mergePresentationMessages(base, persisted, live);
      // Exactly one entry for the shared id, and it is the live draft (real body).
      const sharedRows = merged.filter((m) => m.id === 'a-shared');
      assert.equal(sharedRows.length, 1, 'merge must collapse the shared id to one row');
      assert.equal(
        sharedRows[0]?.body,
        'live draft text',
        'live draft must win over the empty shell',
      );
      const r = render({ phase: 'running', merged });
      assert.equal(r.visible.filter((m) => m.id === 'a-shared').length, 1);
      assert.equal(r.visibleAssistantCount, 1);
      assert.equal(r.pending, false);
      assert.equal(r.assistantResponseSlots, 1);
      return { ...r, mergedBodyForSharedId: sharedRows[0]?.body };
    },
  },
  {
    name: 'completed empty response / error -> terminal state, NOT a permanent thinking row',
    criteria:
      'A failed/interrupted terminal turn renders as an explicit terminal row and the run is no longer active, so there is no permanent pending row.',
    run: () => {
      const failedTerminal = emptyAssistantShell('a-failed', {
        status: 'failed',
        attemptId: ATTEMPT,
      });
      // Terminal turn is itself a visible payload even with empty body.
      assert.equal(hasVisibleAssistantPayload(failedTerminal), true);
      const r = render({ phase: 'failed', merged: [boss('u1'), failedTerminal] });
      assert.equal(r.pending, false);
      assert.equal(
        r.visible.some((m) => m.id === 'a-failed'),
        true,
      );
      assert.equal(r.assistantResponseSlots, 1);
      // Also prove a completed run with no assistant payload at all does not hang
      // a pending row (run no longer active).
      const completedNoReply = render({ phase: 'completed', merged: [boss('u1')] });
      assert.equal(completedNoReply.pending, false);
      return { failedSlots: r.assistantResponseSlots, completedPending: completedNoReply.pending };
    },
  },
  {
    name: 'thread switch during run -> old thread pending does not leak to new thread',
    criteria:
      "A different attempt's assistant turn does not close the new attempt's pending slot; switching to an idle thread shows no pending row.",
    run: () => {
      // New active attempt, but the only assistant turn present belongs to a
      // PRIOR attempt id. The pending row for the CURRENT attempt must still show.
      const merged: PresentationMessage[] = [
        boss('u-new'),
        {
          id: 'a-old',
          author: 'employee',
          body: 'old thread answer',
          attemptId: 'attempt-old',
        },
      ];
      const r = render({ phase: 'running', attemptId: 'attempt-new', merged });
      assert.equal(r.pending, true, 'prior-attempt answer must not close the new pending slot');
      // Switching to an idle thread: no run, no pending.
      const idle = render({ phase: 'idle', attemptId: null, merged: [boss('u-new')] });
      assert.equal(idle.pending, false);
      return { runningPending: r.pending, idlePending: idle.pending };
    },
  },
  {
    name: 'stop/cancel before first token -> pending gone, interrupted legal state',
    criteria:
      'After Stop before any token, the run is interrupted (not active) so the pending row is gone; the interrupted turn renders as a terminal state.',
    run: () => {
      const interrupted = emptyAssistantShell('a-int', {
        status: 'interrupted',
        attemptId: ATTEMPT,
      });
      assert.equal(hasVisibleAssistantPayload(interrupted), true);
      const r = render({ phase: 'interrupted', merged: [boss('u1'), interrupted] });
      assert.equal(r.pending, false);
      assert.equal(
        r.visible.some((m) => m.id === 'a-int'),
        true,
      );
      assert.equal(r.assistantResponseSlots, 1);
      // And a plain stop with no checkpoint at all: just no pending row.
      const bare = render({ phase: 'interrupted', merged: [boss('u1')] });
      assert.equal(bare.pending, false);
      return { interruptedSlots: r.assistantResponseSlots, barePending: bare.pending };
    },
  },
  {
    name: 'invariant guard: never two slots for one active attempt',
    criteria:
      'For every active phase, a real visible assistant turn and the pending row are mutually exclusive — assistantResponseSlots is always <= 1.',
    run: () => {
      const cases: Array<{ merged: PresentationMessage[]; phase: string }> = [
        { phase: 'preparing', merged: [boss('u1')] },
        {
          phase: 'running',
          merged: [boss('u1'), emptyAssistantShell('e', { attemptId: ATTEMPT })],
        },
        {
          phase: 'running',
          merged: [boss('u1'), { id: 'a', author: 'employee', body: 'hi', attemptId: ATTEMPT }],
        },
        { phase: 'awaiting-approval', merged: [boss('u1')] },
      ];
      const slots = cases.map(
        (c) => render({ phase: c.phase, merged: c.merged }).assistantResponseSlots,
      );
      for (const s of slots) assert.ok(s <= 1, `expected <=1 slot, got ${s}`);
      return { slots };
    },
  },
];

const results: Array<{
  name: string;
  criteria: string;
  method: 'pass/fail';
  outcome: 'pass' | 'fail';
  evidence?: ScenarioEvidence;
  error?: string;
}> = [];

for (const scenario of scenarios) {
  try {
    const evidence = scenario.run();
    results.push({
      name: scenario.name,
      criteria: scenario.criteria,
      method: 'pass/fail',
      outcome: 'pass',
      evidence,
    });
  } catch (error) {
    results.push({
      name: scenario.name,
      criteria: scenario.criteria,
      method: 'pass/fail',
      outcome: 'fail',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const failed = results.filter((result) => result.outcome === 'fail');
console.log(JSON.stringify({ scenarioCount: scenarios.length, results }, null, 2));
if (failed.length > 0) {
  console.error(`workspace-chat-presentation harness failed: ${failed.length}/${scenarios.length}`);
  process.exit(1);
}
console.log(`workspace-chat-presentation harness passed: ${scenarios.length}/${scenarios.length}`);
