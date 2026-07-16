import assert from 'node:assert/strict';
import { ThreadLifecycleGuard } from '../apps/desktop/renderer/src/runtime/thread-lifecycle-guard.ts';

const guard = new ThreadLifecycleGuard();

const releaseMutation = guard.acquireMutation('thread-a');
assert.ok(releaseMutation, 'an idle thread can be mutated');
assert.equal(guard.beginRun('thread-a'), null, 'a mutation blocks a late run start');
releaseMutation();

const firstRun = guard.beginRun('thread-a');
assert.ok(firstRun, 'an idle thread accepts one root run');
assert.equal(guard.beginRun('thread-a'), null, 'a second root on the same thread is rejected');
assert.equal(guard.isRunActive('thread-a'), true);
assert.equal(guard.acquireMutation('thread-a'), null, 'an active run blocks archive/delete');

const otherThread = guard.beginRun('thread-b');
assert.ok(otherThread, 'a different thread may run in parallel');

const transferredRun = firstRun.transfer();
assert.ok(transferredRun, 'Conversation can atomically hand its lease to a Mission');
firstRun.release();
assert.equal(
  guard.beginRun('thread-a'),
  null,
  'cleanup from the old lane cannot release a transferred lease',
);
transferredRun.release();
transferredRun.release();
assert.equal(guard.isRunActive('thread-a'), false);
assert.equal(guard.isRunActive('thread-b'), true);
otherThread.release();

const afterRuns = guard.acquireMutation('thread-a');
assert.ok(afterRuns, 'mutation becomes available after the exclusive run stops');
afterRuns();

console.log('thread lifecycle guard harness: 10/10 passed');
