/**
 * MCP host park-channel oracle (Epic B, B2) — the host→Rust mcpCall round-trip.
 *
 * Drives the REAL {@link createMcpCallChannel} (the same factory the bundled host
 * wires into stdin/stdout) with a fake `emit` sink and synthetic `mcpResult`
 * lines. No host process, no Rust, no B3 extension — just the park-and-resume
 * logic in isolation. Proves: a request emits a well-formed `mcpCall` line and
 * parks; the matching `mcpResult` settles it; a non-matching id never settles it;
 * delivery is idempotent; stdin-close / timeout fail parked calls; concurrent calls
 * stay independent.
 *
 * Inject-proof (run manually, then revert): drop the `pending.delete` /
 * id-correlation in resolveMcpResult (settle the FIRST pending regardless of id)
 * → check (3) wrong-id-does-not-settle and (6) independence fail. That proves the
 * id correlation is load-bearing, not a tautology.
 */

import assert from 'node:assert/strict';
import { createMcpCallChannel } from './pi-host-mcp-channel.mjs';

let passed = 0;
let failed = 0;
const TOTAL = 7;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`  ✗ ${name}\n    ${message}`);
  }
}

function makeChannel(timeoutMs?: number, keepTimeoutRef = false) {
  const emitted: Array<Record<string, unknown>> = [];
  const channel = createMcpCallChannel(
    (line: Record<string, unknown>) => emitted.push(line),
    timeoutMs == null ? undefined : { timeoutMs, keepTimeoutRef },
  );
  return { channel, emitted };
}

async function main(): Promise<void> {
  console.log('harness:mcp-host-channel — host mcpCall park-and-resume\n');

  await check('(1) requestMcpResult emits a well-formed mcpCall line + parks', async () => {
    const { channel, emitted } = makeChannel();
    let settled = false;
    void channel.requestMcpResult('filesystem', 'read_file', { path: 'README.md' }).then(() => {
      settled = true;
    });
    assert.equal(emitted.length, 1, 'one mcpCall emitted');
    const line = emitted[0];
    assert.equal(line.kind, 'mcpCall');
    assert.equal(line.server, 'filesystem');
    assert.equal(line.tool, 'read_file');
    assert.deepEqual(line.arguments, { path: 'README.md' });
    assert.equal(typeof line.id, 'string');
    await Promise.resolve();
    assert.equal(settled, false, 'the call parks until a mcpResult arrives');
  });

  await check('(2) resolveMcpResult settles the matching call', async () => {
    const { channel, emitted } = makeChannel();
    const p = channel.requestMcpResult('filesystem', 'read_file', {});
    const id = emitted[0].id as string;
    channel.resolveMcpResult({
      id,
      ok: true,
      content: [{ type: 'text', text: 'hi' }],
      isError: false,
    });
    const result = await p;
    assert.equal(result.ok, true);
    assert.equal(result.isError, false);
    assert.equal((result.content as Array<{ text: string }>)[0].text, 'hi');
  });

  await check('(3) a non-matching id never settles the call', async () => {
    const { channel, emitted } = makeChannel();
    let settled = false;
    void channel.requestMcpResult('github', 'list_issues', {}).then(() => {
      settled = true;
    });
    const realId = emitted[0].id as string;
    channel.resolveMcpResult({ id: `${realId}-WRONG`, ok: true });
    await Promise.resolve();
    assert.equal(settled, false, 'wrong id must not settle a parked call');
  });

  await check('(4) delivery is idempotent (second mcpResult is a no-op)', async () => {
    const { channel, emitted } = makeChannel();
    const p = channel.requestMcpResult('filesystem', 'read_file', {});
    const id = emitted[0].id as string;
    channel.resolveMcpResult({ id, ok: true, content: [] });
    await p;
    // A duplicate / late mcpResult for the same id must not throw or re-resolve.
    assert.doesNotThrow(() => channel.resolveMcpResult({ id, ok: false, error: 'late' }));
  });

  await check('(5) rejectAllMcpCalls fails parked calls (stdin close)', async () => {
    const { channel, emitted } = makeChannel();
    const p = channel.requestMcpResult('filesystem', 'read_file', {});
    assert.equal(emitted.length, 1);
    channel.rejectAllMcpCalls();
    const result = await p;
    assert.equal(result.ok, false, 'a parked call fails on stdin close');
    assert.equal(result.error, 'host stdin closed');
  });

  await check('(6) concurrent calls stay independent (distinct ids)', async () => {
    const { channel, emitted } = makeChannel();
    const pa = channel.requestMcpResult('a', 'toolA', {});
    const pb = channel.requestMcpResult('b', 'toolB', {});
    const idA = emitted[0].id as string;
    const idB = emitted[1].id as string;
    assert.notEqual(idA, idB, 'each call gets a distinct id');
    // Resolve B first, then A — order must not cross the wires.
    channel.resolveMcpResult({ id: idB, ok: true, content: [{ text: 'B' }] });
    channel.resolveMcpResult({ id: idA, ok: true, content: [{ text: 'A' }] });
    const [ra, rb] = await Promise.all([pa, pb]);
    assert.equal((ra.content as Array<{ text: string }>)[0].text, 'A');
    assert.equal((rb.content as Array<{ text: string }>)[0].text, 'B');
  });

  await check('(7) a parked call fails if no mcpResult arrives before timeout', async () => {
    const { channel, emitted } = makeChannel(5, true);
    const result = await channel.requestMcpResult('slow-server', 'slow_tool', {});
    assert.equal(emitted.length, 1);
    assert.equal(result.ok, false);
    assert.match(String(result.error), /MCP result timed out after/);
    assert.match(String(result.error), /slow-server\.slow_tool/);
  });

  console.log(`\n${passed}/${TOTAL} checks passed${failed ? `, ${failed} FAILED` : ''}.`);
  if (failed > 0 || passed !== TOTAL) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
