import assert from 'node:assert/strict';
import { LatestRequestCoordinator } from '../apps/desktop/renderer/src/surfaces/settings/latest-request-coordinator.js';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const coordinator = new LatestRequestCoordinator();
const applied: string[] = [];
const errors: string[] = [];

function applyDeferred(request: Deferred<string>) {
  const generation = coordinator.begin();
  return request.promise.then(
    (value) => {
      if (coordinator.isCurrent(generation)) applied.push(value);
    },
    (error: unknown) => {
      if (coordinator.isCurrent(generation)) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    },
  );
}

const staleRefresh = deferred<string>();
const authoritativeSave = deferred<string>();
const refreshWork = applyDeferred(staleRefresh);
const saveWork = applyDeferred(authoritativeSave);

authoritativeSave.resolve('saved-status');
await saveWork;
staleRefresh.resolve('old-refresh-status');
await refreshWork;
assert.deepEqual(applied, ['saved-status'], 'a late refresh must not overwrite a newer save');

const staleFailure = deferred<string>();
const latestRefresh = deferred<string>();
const staleFailureWork = applyDeferred(staleFailure);
const latestRefreshWork = applyDeferred(latestRefresh);
staleFailure.reject(new Error('stale refresh failed'));
await staleFailureWork;
latestRefresh.resolve('latest-refresh-status');
await latestRefreshWork;
assert.deepEqual(errors, [], 'a superseded request must not surface a stale error');
assert.deepEqual(applied, ['saved-status', 'latest-refresh-status']);

console.log('✓ settings-status-coordinator: out-of-order status responses stay monotonic');
