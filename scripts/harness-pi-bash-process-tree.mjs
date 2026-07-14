#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskBashProcessRegistry } from './pi-task-bash-process-registry.mjs';

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyBoundBridgeContract() {
  const cwd = '/fixture/project/.offisim/worktrees/lease-1';
  const claim = {
    leaseId: 'lease-1',
    registeredRunId: 'run-registered',
    workspaceRoot: '/fixture/project',
    cwd,
    branch: 'offisim/lease/run-registered-lease-1',
  };
  const calls = [];
  const registry = createTaskBashProcessRegistry({
    executeBoundCommand: async (call) => {
      calls.push(call);
      if (call.command === 'timeout-case') {
        return { stdout: '', stderr: 'Command timed out', exitCode: -1, timedOut: true };
      }
      if (call.command === 'exit-case') {
        return { stdout: '', stderr: 'bridge-err', exitCode: 7, timedOut: false };
      }
      return { stdout: 'bridge-out', stderr: 'bridge-err', exitCode: 0, timedOut: false };
    },
  });
  try {
    const rootTool = registry.createBashTool('.');
    assert.match(
      rootTool.description,
      /run commands synchronously[\s\S]*do not start persistent or detached processes/i,
      'model-visible Bash contract must reject persistent daemonization',
    );
    const rootResult = await rootTool.execute(
      'root-result',
      { command: 'root-case' },
      new AbortController().signal,
      () => {},
    );
    const rootCall = calls.at(-1);
    assert.match(JSON.stringify(rootResult), /bridge-out/);
    assert.equal(rootCall?.cwd, '.', 'root/shared Bash must retain the inherited dot cwd');
    assert.equal(
      rootCall?.taskWorkspaceLease,
      undefined,
      'root/shared Bash must not invent an isolated lease claim',
    );

    await assert.rejects(
      registry
        .createBashTool(cwd)
        .execute('missing-claim', { command: 'true' }, new AbortController().signal, () => {}),
      /exact registered workspace lease/i,
    );
    await assert.rejects(
      registry
        .createBashTool(cwd, { taskWorkspaceLease: { ...claim, cwd: `${cwd}-other` } })
        .execute('mismatched-claim', { command: 'true' }, new AbortController().signal, () => {}),
      /exact registered workspace lease/i,
    );
    await assert.rejects(
      registry
        .createBashTool('.', { taskWorkspaceLease: claim })
        .execute('claim-in-root', { command: 'true' }, new AbortController().signal, () => {}),
      /cannot execute in the shared root lane/i,
    );

    const result = await registry
      .createBashTool(cwd, { taskWorkspaceLease: claim })
      .execute('bound-result', { command: 'result-case' }, new AbortController().signal, () => {});
    assert.match(JSON.stringify(result), /bridge-out/);
    assert.match(JSON.stringify(result), /bridge-err/);
    const isolatedCall = calls.at(-1);
    assert.equal(
      isolatedCall?.taskWorkspaceLease,
      claim,
      'bridge must receive the exact child claim object',
    );
    assert.equal(isolatedCall?.cwd, cwd);

    await assert.rejects(
      registry
        .createBashTool(cwd, { taskWorkspaceLease: claim })
        .execute('bound-exit', { command: 'exit-case' }, new AbortController().signal, () => {}),
      (error) => /bridge-err/.test(String(error)) && /code 7/.test(String(error)),
    );

    await assert.rejects(
      registry
        .createBashTool(cwd, { taskWorkspaceLease: claim })
        .execute(
          'default-timeout',
          { command: 'timeout-case' },
          new AbortController().signal,
          () => {},
        ),
      (error) =>
        /timed out after 120 seconds/i.test(String(error)) && !/undefined/.test(String(error)),
    );
  } finally {
    await registry.cleanup();
  }

  const noBridge = createTaskBashProcessRegistry();
  try {
    await assert.rejects(
      noBridge
        .createBashTool('.')
        .execute('no-bridge', { command: 'true' }, new AbortController().signal, () => {}),
      /host-bound execution bridge/i,
    );
  } finally {
    await noBridge.cleanup();
  }

  for (const mode of ['abort', 'cleanup']) {
    let bridgeCall;
    let abortCount = 0;
    const remote = createTaskBashProcessRegistry({
      executeBoundCommand: (call) => {
        bridgeCall = call;
        return new Promise((_, reject) => {
          const rejectAborted = () => {
            abortCount += 1;
            reject(new Error('aborted'));
          };
          if (call.signal.aborted) rejectAborted();
          else call.signal.addEventListener('abort', rejectAborted, { once: true });
        });
      },
    });
    const controller = new AbortController();
    const rootLane = mode === 'abort';
    const execution = remote
      .createBashTool(rootLane ? '.' : cwd, rootLane ? {} : { taskWorkspaceLease: claim })
      .execute(`remote-${mode}`, { command: 'wait' }, controller.signal, () => {});
    const rejection = assert.rejects(execution, /aborted/i);
    while (remote.activeCount !== 1) await wait(1);
    assert.equal(remote.activeCount, 1, `${mode} must register the in-flight Rust bridge call`);
    if (mode === 'abort') {
      controller.abort();
      controller.abort();
    } else {
      await remote.cleanup();
    }
    await rejection;
    assert.equal(abortCount, 1, `${mode} must cancel the exact bridge call once`);
    assert.equal(remote.activeCount, 0, `${mode} must drain the remote Bash registry`);
    assert.equal(bridgeCall?.cwd, rootLane ? '.' : cwd);
    assert.equal(bridgeCall?.taskWorkspaceLease, rootLane ? undefined : claim);
    if (mode === 'abort') await remote.cleanup();
  }
}

function verifyHostWiring() {
  const host = readFileSync(join(ROOT, 'scripts/tauri-pi-agent-host.entry.mjs'), 'utf8');
  for (const expected of [
    'function createWorkAgentSession(options)',
    'createTaskScopedAgentSessionFactory(',
    'return createTaskScopedAgentSession(options)',
    'createAgentSession: createWorkAgentSession',
    'activeRootSession.abort()',
    'for (const controller of activeChildControllers.values()) controller.abort()',
    "process.once('SIGTERM'",
    "process.once('SIGHUP'",
    "rl.on('close'",
    'shutdownActiveWork({ abort: true })',
    'await taskBashRegistry.cleanup()',
  ]) {
    assert.ok(host.includes(expected), `host is missing Bash shutdown wiring: ${expected}`);
  }
  assert.match(
    host,
    /createTaskBashProcessRegistry\(\{\s*executeBoundCommand:/,
    'production task Bash must always receive the Rust-bound execution bridge',
  );
  assert.match(
    host,
    /requestWorktreeResult\(\s*'executeBash'/,
    'production task Bash must route every root/shared/isolated call through executeBash',
  );
}

async function main() {
  verifyHostWiring();
  await verifyBoundBridgeContract();
  console.log('  ✓ root/shared cwd: dot authority, no isolated claim');
  console.log('  ✓ isolated cwd: exact registered claim');
  console.log('  ✓ Rust bridge: result, exit, timeout, Abort/cancel, cleanup, activeCount');
  console.log('  ✓ model contract: synchronous Bash, no persistent detached processes');
  console.log('Pi task-scoped Bash Rust-bridge harness: PASS');
}

main().catch((error) => {
  console.error('Pi task-scoped Bash Rust-bridge harness: FAIL');
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
