import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  NativeStreamIdleTimeoutError,
  NativeStreamProgressWatchdog,
  type StreamWatchdogScheduler,
} from '../apps/desktop/renderer/src/runtime/native-stream-progress-watchdog.ts';

type ScheduledTask = {
  readonly id: number;
  readonly at: number;
  readonly callback: () => void;
};

class ManualScheduler implements StreamWatchdogScheduler {
  private now = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, ScheduledTask>();

  setTimeout(callback: () => void, delayMs: number): number {
    const task = { id: this.nextId++, at: this.now + delayMs, callback };
    this.tasks.set(task.id, task);
    return task.id;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') this.tasks.delete(handle);
  }

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const next = [...this.tasks.values()]
        .filter((task) => task.at <= target)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!next) break;
      this.tasks.delete(next.id);
      this.now = next.at;
      next.callback();
    }
    this.now = target;
  }
}

const never = new Promise<never>(() => undefined);
const flushAsyncRecovery = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

{
  const scheduler = new ManualScheduler();
  let recoveries = 0;
  const watchdog = new NativeStreamProgressWatchdog({
    requestId: 'stalled-run',
    timeoutMs: 100,
    scheduler,
    onRecover: async () => {
      recoveries += 1;
      return false;
    },
  });
  const observed = watchdog.watch(never).then(
    () => null,
    (error: unknown) => error,
  );
  scheduler.advance(100);
  await flushAsyncRecovery();
  const error = await observed;
  assert(error instanceof NativeStreamIdleTimeoutError);
  assert.equal(error.failureKind, 'runtime');
  assert.equal(recoveries, 1, 'a stalled stream must attempt one finite recovery');
  const terminalEvent = {
    type: 'run.failed',
    payload: { status: 'failed', failureKind: error.failureKind },
  } as const;
  assert.deepEqual(terminalEvent, {
    type: 'run.failed',
    payload: { status: 'failed', failureKind: 'runtime' },
  });
}

{
  const scheduler = new ManualScheduler();
  let recoveries = 0;
  let settled = false;
  const watchdog = new NativeStreamProgressWatchdog({
    requestId: 'recover-once',
    timeoutMs: 100,
    scheduler,
    onRecover: async () => {
      recoveries += 1;
      return true;
    },
  });
  const observed = watchdog.watch(never).then(
    () => null,
    (error: unknown) => error,
  );
  void observed.finally(() => {
    settled = true;
  });
  scheduler.advance(100);
  await flushAsyncRecovery();
  assert.equal(settled, false, 'successful finite recovery must grant one fresh idle window');
  scheduler.advance(100);
  await flushAsyncRecovery();
  assert((await observed) instanceof NativeStreamIdleTimeoutError);
  assert.equal(recoveries, 1, 'the watchdog must never loop recovery attempts');
}

{
  const scheduler = new ManualScheduler();
  let recoveries = 0;
  const watchdog = new NativeStreamProgressWatchdog({
    requestId: 'hung-recovery',
    timeoutMs: 100,
    recoveryTimeoutMs: 25,
    scheduler,
    onRecover: () => {
      recoveries += 1;
      return never;
    },
  });
  const observed = watchdog.watch(never).then(
    () => null,
    (error: unknown) => error,
  );
  scheduler.advance(100);
  scheduler.advance(25);
  await flushAsyncRecovery();
  assert((await observed) instanceof NativeStreamIdleTimeoutError);
  assert.equal(recoveries, 1, 'a hung recovery must time out without another attempt');
}

{
  const scheduler = new ManualScheduler();
  const watchdog = new NativeStreamProgressWatchdog({
    requestId: 'event-progress',
    timeoutMs: 100,
    scheduler,
    onRecover: async () => false,
  });
  let settled = false;
  const observed = watchdog.watch(never).then(
    () => null,
    (error: unknown) => error,
  );
  void observed.finally(() => {
    settled = true;
  });
  scheduler.advance(80);
  watchdog.recordProgress();
  scheduler.advance(80);
  await flushAsyncRecovery();
  assert.equal(settled, false, 'any host event must reset the no-progress window');
  scheduler.advance(20);
  await flushAsyncRecovery();
  assert((await observed) instanceof NativeStreamIdleTimeoutError);
}

{
  const scheduler = new ManualScheduler();
  const watchdog = new NativeStreamProgressWatchdog({
    requestId: 'awaiting-user',
    timeoutMs: 100,
    scheduler,
    onRecover: async () => false,
  });
  let settled = false;
  const observed = watchdog.watch(never).then(
    () => null,
    (error: unknown) => error,
  );
  void observed.finally(() => {
    settled = true;
  });
  watchdog.pause();
  scheduler.advance(1_000);
  await flushAsyncRecovery();
  assert.equal(settled, false, 'a run awaiting explicit user input must not time out');
  watchdog.resume();
  scheduler.advance(100);
  await flushAsyncRecovery();
  assert((await observed) instanceof NativeStreamIdleTimeoutError);
}

const root = resolve(import.meta.dirname, '..');
const runtimeSource = readFileSync(
  resolve(root, 'apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts'),
  'utf8',
);
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};

assert.match(
  runtimeSource,
  /streamIdleTimeoutMs:\s*DEFAULT_NATIVE_STREAM_IDLE_TIMEOUT_MS/g,
  'api/codex/claude configs must share the same neutral watchdog timeout',
);
assert(
  (runtimeSource.match(/progressWatchdog\?\.recordProgress\(\)/g) ?? []).length >= 2,
  'fresh and reattached streams must both feed progress into the watchdog',
);
assert.match(
  runtimeSource,
  /NativeStreamIdleTimeoutError[\s\S]*invokeAbortOnce/,
  'watchdog failure must terminate the native host before terminalizing the run',
);
assert.match(
  runtimeSource,
  /event\.kind === 'uiRequest'[\s\S]*progressWatchdog\?\.pause\(\)/,
  'user interaction must pause the active no-progress timer',
);
assert.match(
  runtimeSource,
  /commands\.answer[\s\S]*progressWatchdogByRequest\.get\(answer\.requestId\)\?\.resume\(\)/,
  'a successfully delivered answer must resume the same request watchdog',
);
assert.match(
  packageJson.scripts?.validate ?? '',
  /harness:stream-watchdog/,
  'the stream watchdog harness must run in the release-gates node lane through validate',
);

console.log(
  '[harness-stream-watchdog] fault injection passed: idle -> one recovery -> abort/run.failed(runtime); progress resets; all native lanes wired',
);
