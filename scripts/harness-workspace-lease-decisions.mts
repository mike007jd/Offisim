import assert from 'node:assert/strict';
import { WorkspaceLeaseDecisionCoordinator } from '../apps/desktop/renderer/src/surfaces/office/board/workspace-lease-decision-coordinator.js';

type Outcome = 'merged' | 'discarded';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function oppositeDecisionReturnsActualOutcome(
  firstAction: 'merge' | 'discard',
  secondAction: 'merge' | 'discard',
  outcome: Outcome,
): Promise<void> {
  const coordinator = new WorkspaceLeaseDecisionCoordinator<Outcome>();
  const operation = deferred<Outcome>();
  let firstCalls = 0;
  let secondCalls = 0;
  const first = coordinator.run('lease-1', firstAction, async () => {
    firstCalls += 1;
    return operation.promise;
  });
  const second = coordinator.run('lease-1', secondAction, async () => {
    secondCalls += 1;
    return secondAction === 'merge' ? 'merged' : 'discarded';
  });

  assert.equal(coordinator.actionFor('lease-1'), firstAction);
  operation.resolve(outcome);
  assert.deepEqual(await Promise.all([first, second]), [outcome, outcome]);
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 0);
  assert.equal(coordinator.actionFor('lease-1'), null);
}

await oppositeDecisionReturnsActualOutcome('merge', 'discard', 'merged');
console.log('  ✓ concurrent merge then discard reports merged to both entries');
await oppositeDecisionReturnsActualOutcome('discard', 'merge', 'discarded');
console.log('  ✓ concurrent discard then merge reports discarded to both entries');

console.log('workspace-lease-decisions: 2/2 checks passed');
