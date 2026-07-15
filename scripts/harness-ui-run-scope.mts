import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  advanceComposerEditRevision,
  shouldClearAcceptedComposerText,
} from '../apps/desktop/renderer/src/assistant/composer/active-run-composer.js';
import { submitPermissionInputOnEnter } from '../apps/desktop/renderer/src/assistant/parts/permission-approval-keyboard.js';
import { scopeConversationRunsToCompany } from '../apps/desktop/renderer/src/assistant/runtime/conversation-run-scope.js';

const runA = { threadId: 'thread-a', companyId: 'company-a' };
const runB = { threadId: 'thread-b', companyId: 'company-b' };
const finishedA = { threadId: 'finished-a', companyId: 'company-a' };
const snapshot = {
  runs: [finishedA, runB, runA],
  activeRuns: [runB, runA],
};

const companyA = scopeConversationRunsToCompany(snapshot, 'company-a');
assert.deepEqual(
  companyA.runs.map((run) => run.threadId),
  ['finished-a', 'thread-a'],
  'historical projection must include only the current company',
);
assert.deepEqual(
  companyA.activeRuns.map((run) => run.threadId),
  ['thread-a'],
  'active projection must not fall back to a run from another company',
);
assert.deepEqual(
  scopeConversationRunsToCompany(snapshot, null),
  { runs: [], activeRuns: [] },
  'no selected company must expose no global run controls',
);

assert.equal(
  shouldClearAcceptedComposerText(
    { text: 'sent snapshot', revision: 1 },
    { text: 'sent snapshot', revision: 1 },
    true,
  ),
  true,
  'an accepted unchanged snapshot clears',
);
assert.equal(
  shouldClearAcceptedComposerText(
    { text: 'new typing', revision: 2 },
    { text: 'sent snapshot', revision: 1 },
    true,
  ),
  false,
  'typing entered while awaiting ACK is preserved',
);
assert.equal(
  shouldClearAcceptedComposerText(
    { text: 'sent snapshot', revision: 1 },
    { text: 'sent snapshot', revision: 1 },
    false,
  ),
  false,
  'a rejected send preserves the snapshot for retry',
);
const roundTripRevision = { current: 1 };
advanceComposerEditRevision(roundTripRevision);
advanceComposerEditRevision(roundTripRevision);
assert.equal(roundTripRevision.current, 3, 'both the A → B edit and B → A edit advance revision');
assert.equal(
  shouldClearAcceptedComposerText(
    { text: 'A', revision: roundTripRevision.current },
    { text: 'A', revision: 1 },
    true,
  ),
  false,
  'A → B → A edits are preserved even though the final text matches the submitted snapshot',
);

function permissionKeyEvent(input: {
  key?: string;
  shiftKey?: boolean;
  isComposing?: boolean;
}) {
  let prevented = 0;
  let stopped = 0;
  return {
    event: {
      key: input.key ?? 'Enter',
      shiftKey: input.shiftKey ?? false,
      nativeEvent: { isComposing: input.isComposing ?? false },
      preventDefault: () => {
        prevented += 1;
      },
      stopPropagation: () => {
        stopped += 1;
      },
    },
    effects: () => ({ prevented, stopped }),
  };
}

const enter = permissionKeyEvent({});
let submitted = 0;
assert.equal(
  submitPermissionInputOnEnter(enter.event, false, () => {
    submitted += 1;
  }),
  true,
  'plain Enter submits a single-line Pi input request',
);
assert.deepEqual(enter.effects(), { prevented: 1, stopped: 1 });
assert.equal(submitted, 1);

const composingEnter = permissionKeyEvent({ isComposing: true });
assert.equal(
  submitPermissionInputOnEnter(composingEnter.event, false, () => {
    submitted += 1;
  }),
  false,
  'IME composition Enter stays inside the input',
);
assert.deepEqual(composingEnter.effects(), { prevented: 0, stopped: 0 });

const shiftEnter = permissionKeyEvent({ shiftKey: true });
assert.equal(
  submitPermissionInputOnEnter(shiftEnter.event, false, () => {
    submitted += 1;
  }),
  false,
  'Shift+Enter does not submit the single-line request',
);

const decidingEnter = permissionKeyEvent({});
assert.equal(
  submitPermissionInputOnEnter(decidingEnter.event, true, () => {
    submitted += 1;
  }),
  false,
  'Enter is contained but does not submit again while a decision is in flight',
);
assert.deepEqual(decidingEnter.effects(), { prevented: 1, stopped: 1 });
assert.equal(submitted, 1, 'only the first eligible Enter submits');

const permissionApprovalSource = readFileSync(
  new URL(
    '../apps/desktop/renderer/src/assistant/parts/PermissionApprovalBar.tsx',
    import.meta.url,
  ),
  'utf8',
);
const inputMarkup = permissionApprovalSource
  .split('{inputRequest ? (')[1]
  ?.split('{editorRequest ? (')[0];
const editorMarkup = permissionApprovalSource
  .split('{editorRequest ? (')[1]
  ?.split('<div className="off-permission-actions">')[0];
assert.match(inputMarkup ?? '', /onKeyDown=/, 'single-line input owns the Enter submit handler');
assert.doesNotMatch(
  editorMarkup ?? '',
  /onKeyDown=/,
  'editor keeps native multiline Enter behavior',
);

const enhanceSource = readFileSync(
  new URL(
    '../apps/desktop/renderer/src/assistant/enhance/OfficeEnhanceButton.tsx',
    import.meta.url,
  ),
  'utf8',
);
assert.equal(
  enhanceSource.match(/onComposerTextMutation\(\)/g)?.length,
  2,
  'Enhance Apply and Undo both advance the composer edit revision',
);
const officeThreadSource = readFileSync(
  new URL('../apps/desktop/renderer/src/assistant/OfficeThread.tsx', import.meta.url),
  'utf8',
);
assert.match(
  officeThreadSource,
  /onComposerTextMutation=/,
  'Office composer injects its shared edit revision into Enhance',
);

console.log('UI run scope harness passed (21 assertions)');
