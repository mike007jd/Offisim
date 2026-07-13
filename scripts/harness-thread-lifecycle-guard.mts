import assert from 'node:assert/strict';
import { ThreadLifecycleGuard } from '../apps/desktop/renderer/src/runtime/thread-lifecycle-guard.ts';

const guard = new ThreadLifecycleGuard();

const releaseMutation = guard.acquireMutation('thread-a');
assert.ok(releaseMutation, 'an idle thread can be mutated');
assert.equal(guard.beginRun('thread-a'), null, 'a mutation blocks a late Mission start');
releaseMutation();

const releaseFirstRun = guard.beginRun('thread-a');
const releaseSecondRun = guard.beginRun('thread-a');
assert.ok(releaseFirstRun && releaseSecondRun, 'multiple Missions may share one thread');
assert.equal(guard.isRunActive('thread-a'), true);
assert.equal(guard.acquireMutation('thread-a'), null, 'active Missions block archive/delete');

releaseFirstRun();
releaseFirstRun();
assert.equal(guard.acquireMutation('thread-a'), null, 'idempotent release preserves other runs');
releaseSecondRun();
assert.equal(guard.isRunActive('thread-a'), false);

const afterRuns = guard.acquireMutation('thread-a');
assert.ok(afterRuns, 'mutation becomes available after every Mission stops');
afterRuns();

console.log('thread lifecycle guard harness: 6/6 passed');
