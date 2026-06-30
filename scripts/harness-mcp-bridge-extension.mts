/**
 * MCP bridge extension oracle (Epic B, B3) — the agent-facing 3 meta tools + the
 * write-tool confirm gate.
 *
 * Drives the REAL {@link createMcpBridgeExtensionFactory} over a fake `pi`
 * (capturing registerTool + the tool_call gate) and a fake `requestMcpResult` /
 * `ctx.ui.confirm`. No Pi SDK, no host process. Proves: the registered schema is
 * ALWAYS exactly 3 tools (token-proxy invariant) regardless of tool count;
 * search/describe shapes; mcp_call routes to requestMcpResult; a write-class tool
 * pauses for confirm; a deny blocks it; a read-only tool never prompts; write
 * execution fails closed unless it can consume an exact approval token.
 *
 * Inject-proof (run manually, then revert): make the gate confirm EVERY mcp_call
 * (drop the isWriteMcpTool check) → check (8) read-tool-no-prompt fails; OR make
 * it confirm NONE → check (7) write-deny-blocks fails. That proves the write
 * classification is load-bearing.
 */

import assert from 'node:assert/strict';
import {
  createMcpBridgeExtensionFactory,
  isWriteMcpTool,
  MCP_APPROVAL_TOKEN_TTL_MS,
} from './pi-mcp-bridge-extension.mjs';

let passed = 0;
let failed = 0;
const TOTAL = 19;

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

type Tool = Record<string, unknown> & { name: string };
type McpCallTool = Record<string, unknown> & {
  execute: (id: string, p: unknown) => Promise<{ content: Array<{ text?: string }>; isError?: boolean }>;
};

function makeFakePi() {
  const registered: Array<Record<string, unknown>> = [];
  let toolCallHandler: ((event: unknown, ctx: unknown) => unknown) | null = null;
  const pi = {
    registerTool: (def: Record<string, unknown>) => registered.push(def),
    on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      if (name === 'tool_call') toolCallHandler = handler;
    },
  };
  return { pi, registered, handler: () => toolCallHandler };
}

const READ_TOOL = {
  name: 'read_file',
  server: 'filesystem',
  description: 'Read a file from the workspace.',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  annotations: { readOnlyHint: true },
};
const WRITE_TOOL = {
  name: 'write_file',
  server: 'filesystem',
  description: 'Write a file.',
  annotations: { readOnlyHint: false, destructiveHint: true },
};

function build(mcpTools: Tool[], requestMcpResult: (s: string, t: string, a: object) => Promise<unknown>) {
  const env = makeFakePi();
  createMcpBridgeExtensionFactory({ mcpTools, requestMcpResult } as never)(env.pi as never);
  const tool = (name: string) =>
    env.registered.find((t) => t.name === name) as Record<string, unknown> & {
      execute: (id: string, p: unknown) => Promise<{ content: Array<{ text?: string }>; isError?: boolean }>;
    };
  return { ...env, tool };
}

function mcpCallTool(env: { registered: Array<Record<string, unknown>> }): McpCallTool {
  return env.registered.find((t) => t.name === 'mcp_call') as McpCallTool;
}

const noop = async () => ({ ok: true, content: [] });

async function main(): Promise<void> {
  console.log('harness:mcp-bridge-extension — 3 meta tools + write gate\n');

  await check('(1) registers exactly 3 fixed meta tools', () => {
    const { registered } = build([READ_TOOL, WRITE_TOOL], noop);
    const names = registered.map((t) => t.name).sort();
    assert.deepEqual(names, ['mcp_call', 'mcp_describe_tool', 'mcp_search_tools']);
  });

  await check('(2) constant schema — 50 tools still register exactly 3', () => {
    const many: Tool[] = Array.from({ length: 50 }, (_, i) => ({
      name: `tool_${i}`,
      server: 'srv',
      annotations: { readOnlyHint: true },
    }));
    const { registered } = build(many, noop);
    assert.equal(registered.length, 3, 'token-proxy: schema is independent of tool count');
  });

  await check('(3) mcp_search_tools lists matches / all / none', async () => {
    const { tool } = build([READ_TOOL, WRITE_TOOL], noop);
    const all = await tool('mcp_search_tools').execute('1', {});
    assert.match(all.content[0].text ?? '', /read_file/);
    assert.match(all.content[0].text ?? '', /write_file/);
    const one = await tool('mcp_search_tools').execute('1', { query: 'write' });
    assert.match(one.content[0].text ?? '', /write_file/);
    assert.doesNotMatch(one.content[0].text ?? '', /read_file/);
    const none = await tool('mcp_search_tools').execute('1', { query: 'zzz-nomatch' });
    assert.match(none.content[0].text ?? '', /No MCP tools match/);
  });

  await check('(4) mcp_describe_tool returns schema + write class; unknown errors', async () => {
    const { tool } = build([READ_TOOL, WRITE_TOOL], noop);
    const desc = await tool('mcp_describe_tool').execute('1', { name: 'write_file' });
    const json = JSON.parse(desc.content[0].text ?? '{}');
    assert.equal(json.server, 'filesystem');
    assert.equal(json.write, true);
    assert.equal(json.annotations.destructiveHint, true);
    const unknown = await tool('mcp_describe_tool').execute('1', { name: 'nope' });
    assert.equal(unknown.isError, true);
  });

  await check('(5) mcp_call routes to requestMcpResult and returns content', async () => {
    const calls: Array<[string, string, object]> = [];
    const req = async (server: string, t: string, args: object) => {
      calls.push([server, t, args]);
      return { id: 'mcp-1', ok: true, content: [{ type: 'text', text: 'file body' }], isError: false };
    };
    const { tool } = build([READ_TOOL], req);
    const res = await tool('mcp_call').execute('1', { name: 'read_file', input: { path: 'a' } });
    assert.deepEqual(calls[0], ['filesystem', 'read_file', { path: 'a' }]);
    assert.equal(res.content[0].text, 'file body');
    assert.notEqual(res.isError, true);
  });

  await check('(6) mcp_call emits a neutral audit agentRun line', async () => {
    const emitted: unknown[] = [];
    const env = makeFakePi();
    createMcpBridgeExtensionFactory({
      mcpTools: [READ_TOOL],
      requestMcpResult: async () => ({ ok: true, content: [{ type: 'text', text: 'file body' }] }),
      emit: (line: unknown) => emitted.push(line),
      threadId: 'thread-1',
      rootRunId: 'run-1',
      employeeId: 'emp-1',
    } as never)(env.pi as never);
    const tool = mcpCallTool(env);
    await tool.execute('1', { name: 'read_file', input: { path: 'a' } });
    assert.equal(emitted.length, 1);
    assert.deepEqual(
      emitted[0],
      {
        kind: 'agentRun',
        threadId: 'thread-1',
        rootRunId: 'run-1',
        runId: 'run-1',
        employeeId: 'emp-1',
        runType: 'mcp.tool.called',
        payload: {
          server: 'filesystem',
          tool: 'read_file',
          arguments: { path: 'a' },
          result: { content: [{ type: 'text', text: 'file body' }] },
          isError: false,
          error: null,
          latencyMs: (emitted[0] as { payload: { latencyMs: number } }).payload.latencyMs,
          write: false,
          approvalStatus: 'not_required',
          approved: false,
        },
      },
    );
  });

  await check('(6b) mcp_call still accepts legacy arguments alias', async () => {
    const calls: Array<[string, string, object]> = [];
    const req = async (server: string, t: string, args: object) => {
      calls.push([server, t, args]);
      return { id: 'mcp-1', ok: true, content: [{ type: 'text', text: 'legacy' }], isError: false };
    };
    const { tool } = build([READ_TOOL], req);
    const res = await tool('mcp_call').execute('1', { name: 'read_file', arguments: { path: 'legacy' } });
    assert.deepEqual(calls[0], ['filesystem', 'read_file', { path: 'legacy' }]);
    assert.equal(res.content[0].text, 'legacy');
  });

  await check('(7) mcp_call on an unknown tool errors WITHOUT invoking requestMcpResult', async () => {
    let called = false;
    const req = async () => {
      called = true;
      return { ok: true, content: [] };
    };
    const { tool } = build([READ_TOOL], req);
    const res = await tool('mcp_call').execute('1', { name: 'ghost', arguments: {} });
    assert.equal(res.isError, true);
    assert.equal(called, false, 'unknown tool must not reach the MCP server');
  });

  await check('(8) gate: write tool pauses for confirm; DENY blocks it', async () => {
    const emitted: unknown[] = [];
    const env = makeFakePi();
    createMcpBridgeExtensionFactory({
      mcpTools: [READ_TOOL, WRITE_TOOL],
      requestMcpResult: noop,
      emit: (line: unknown) => emitted.push(line),
      threadId: 'thread-1',
      rootRunId: 'run-1',
      employeeId: 'emp-1',
    } as never)(env.pi as never);
    let confirmed = false;
    const ctx = {
      ui: {
        confirm: async () => {
          confirmed = true;
          return false; // operator denies
        },
      },
    };
    const verdict = await env.handler()!({ toolName: 'mcp_call', input: { name: 'write_file' } }, ctx);
    assert.equal(confirmed, true, 'a write tool must prompt');
    assert.equal((verdict as { block?: boolean })?.block, true, 'deny blocks the call');
    assert.equal(emitted.length, 1, 'deny emits a rejected audit line');
    assert.equal(
      (emitted[0] as { payload?: { approvalStatus?: string; error?: string } }).payload
        ?.approvalStatus,
      'human_denied',
    );
    // Approve path → no block.
    const okVerdict = await env.handler()!(
      { toolName: 'mcp_call', input: { name: 'write_file' } },
      { ui: { confirm: async () => true } },
    );
    assert.equal(okVerdict, undefined, 'approve lets the call run');
  });

  await check('(9) gate: read-only tool runs WITHOUT a prompt', async () => {
    const { handler } = build([READ_TOOL, WRITE_TOOL], noop);
    let confirmed = false;
    const verdict = await handler()!(
      { toolName: 'mcp_call', input: { name: 'read_file' } },
      { ui: { confirm: async () => { confirmed = true; return false; } } },
    );
    assert.equal(confirmed, false, 'a read-only tool must NOT prompt');
    assert.equal(verdict, undefined);
  });

  await check('(10) gate ignores non-mcp_call tool events', async () => {
    const { handler } = build([WRITE_TOOL], noop);
    const verdict = await handler()!(
      { toolName: 'bash', input: { command: 'rm -rf /' } },
      { ui: { confirm: async () => false } },
    );
    assert.equal(verdict, undefined, 'the MCP gate only governs mcp_call');
  });

  await check('(11) isWriteMcpTool: explicit flag overrides; annotations fallback', () => {
    assert.equal(isWriteMcpTool({ write: false, annotations: { destructiveHint: true } }), false);
    assert.equal(isWriteMcpTool({ write: true, annotations: { readOnlyHint: true } }), true);
    assert.equal(isWriteMcpTool({ annotations: { readOnlyHint: false } }), true);
    assert.equal(isWriteMcpTool({ annotations: { destructiveHint: true } }), true);
    assert.equal(isWriteMcpTool({ annotations: { readOnlyHint: true } }), false);
    assert.equal(isWriteMcpTool({}), false, 'unknown annotations fall back to read');
  });

  await check('(12) write MCP execution emits human_approved audit status', async () => {
    const emitted: unknown[] = [];
    const calls: Array<[string, string, object]> = [];
    const env = makeFakePi();
    createMcpBridgeExtensionFactory({
      mcpTools: [WRITE_TOOL],
      requestMcpResult: async (server: string, t: string, args: object) => {
        calls.push([server, t, args]);
        return { ok: true, content: [{ type: 'text', text: 'ok' }] };
      },
      emit: (line: unknown) => emitted.push(line),
      threadId: 'thread-1',
      rootRunId: 'run-1',
      employeeId: 'emp-1',
    } as never)(env.pi as never);
    const tool = mcpCallTool(env);
    await env.handler()!(
      { toolName: 'mcp_call', toolCallId: 'call-a', input: { name: 'write_file', input: { path: 'a' } } },
      { ui: { confirm: async () => true } },
    );
    await tool.execute('call-a', { name: 'write_file', input: { path: 'a' } });
    assert.deepEqual(calls[0], ['filesystem', 'write_file', { path: 'a' }]);
    assert.equal(
      (emitted[0] as { payload?: { approvalStatus?: string; approved?: boolean } }).payload
        ?.approvalStatus,
      'human_approved',
    );
    assert.equal((emitted[0] as { payload?: { approved?: boolean } }).payload?.approved, true);
  });

  await check('(13) write MCP execution without gate fails closed before server call', async () => {
    const emitted: unknown[] = [];
    const env = makeFakePi();
    let called = false;
    createMcpBridgeExtensionFactory({
      mcpTools: [WRITE_TOOL],
      requestMcpResult: async () => {
        called = true;
        return { ok: true, content: [{ type: 'text', text: 'ok' }] };
      },
      emit: (line: unknown) => emitted.push(line),
      threadId: 'thread-1',
      rootRunId: 'run-1',
      employeeId: 'emp-1',
    } as never)(env.pi as never);
    const tool = mcpCallTool(env);
    const res = await tool.execute('1', { name: 'write_file', input: { path: 'a' } });
    assert.equal(called, false, 'missing approval must not reach the MCP server');
    assert.equal(res.isError, true);
    assert.match(res.content[0].text ?? '', /requires approval/);
    assert.equal(
      (emitted[0] as { payload?: { approvalStatus?: string; approved?: boolean; error?: string } }).payload
        ?.approvalStatus,
      'human_denied',
    );
    assert.equal((emitted[0] as { payload?: { approved?: boolean } }).payload?.approved, false);
    assert.equal(
      (emitted[0] as { payload?: { error?: string } }).payload?.error,
      'missing_required_approval',
    );
  });

  await check('(14) write approval with toolCallId requires the same call and input', async () => {
    const calls: Array<[string, string, object]> = [];
    const env = makeFakePi();
    createMcpBridgeExtensionFactory({
      mcpTools: [WRITE_TOOL],
      requestMcpResult: async (server: string, t: string, args: object) => {
        calls.push([server, t, args]);
        return { ok: true, content: [{ type: 'text', text: 'ok' }] };
      },
    } as never)(env.pi as never);
    const tool = mcpCallTool(env);
    await env.handler()!(
      {
        toolName: 'mcp_call',
        toolCallId: 'call-bound',
        input: { name: 'write_file', input: { path: 'approved' } },
      },
      { ui: { confirm: async () => true } },
    );
    const mutatedInput = await tool.execute('call-bound', {
      name: 'write_file',
      input: { path: 'mutated' },
    });
    const swappedCall = await tool.execute('different-call', {
      name: 'write_file',
      input: { path: 'approved' },
    });
    const exact = await tool.execute('call-bound', {
      name: 'write_file',
      input: { path: 'approved' },
    });
    assert.equal(mutatedInput.isError, true, 'same call id with changed input must fail closed');
    assert.equal(swappedCall.isError, true, 'same input with different call id must fail closed');
    assert.equal(exact.isError, undefined, 'the approved exact call/input pair still executes');
    assert.deepEqual(calls, [['filesystem', 'write_file', { path: 'approved' }]]);
  });

  await check('(15) write approval without toolCallId falls back to exact input hash', async () => {
    const emitted: unknown[] = [];
    const calls: Array<[string, string, object]> = [];
    const env = makeFakePi();
    createMcpBridgeExtensionFactory({
      mcpTools: [WRITE_TOOL],
      requestMcpResult: async (server: string, t: string, args: object) => {
        calls.push([server, t, args]);
        return { ok: true, content: [{ type: 'text', text: 'ok' }] };
      },
      emit: (line: unknown) => emitted.push(line),
      threadId: 'thread-1',
      rootRunId: 'run-1',
      employeeId: 'emp-1',
    } as never)(env.pi as never);
    const tool = mcpCallTool(env);
    await env.handler()!(
      { toolName: 'mcp_call', input: { name: 'write_file', input: { path: 'a', mode: '0644' } } },
      { ui: { confirm: async () => true } },
    );
    const res = await tool.execute('different-call-id', {
      name: 'write_file',
      input: { mode: '0644', path: 'a' },
    });
    assert.equal(res.isError, undefined, 'same input with sorted object keys consumes hash fallback');
    assert.deepEqual(calls, [['filesystem', 'write_file', { mode: '0644', path: 'a' }]]);

    const denied = await tool.execute('different-call-id-2', {
      name: 'write_file',
      input: { path: 'b', mode: '0644' },
    });
    assert.equal(denied.isError, true, 'different input must not consume the previous approval');
    assert.equal(calls.length, 1, 'different input must not reach the MCP server');
    assert.equal(
      (emitted.at(-1) as { payload?: { approvalStatus?: string; error?: string } }).payload
        ?.approvalStatus,
      'human_denied',
    );
  });

  await check('(16) write approval hash keeps sparse array input distinct', async () => {
    let calls = 0;
    const env = makeFakePi();
    createMcpBridgeExtensionFactory({
      mcpTools: [WRITE_TOOL],
      requestMcpResult: async () => {
        calls += 1;
        return { ok: true, content: [{ type: 'text', text: 'ok' }] };
      },
    } as never)(env.pi as never);
    const tool = mcpCallTool(env);
    await env.handler()!(
      { toolName: 'mcp_call', input: { name: 'write_file', input: { values: [undefined] } } },
      { ui: { confirm: async () => true } },
    );
    const denied = await tool.execute('different-call-id', {
      name: 'write_file',
      input: { values: [] },
    });
    assert.equal(denied.isError, true, 'sparse array-like input must not match empty array input');
    assert.equal(calls, 0, 'hash collision must not reach the MCP server');
  });

  await check('(17) write approval hash fallback expires if execute never arrives', async () => {
    const originalNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    try {
      let calls = 0;
      const env = makeFakePi();
      createMcpBridgeExtensionFactory({
        mcpTools: [WRITE_TOOL],
        requestMcpResult: async () => {
          calls += 1;
          return { ok: true, content: [{ type: 'text', text: 'ok' }] };
        },
      } as never)(env.pi as never);
      const tool = mcpCallTool(env);
      await env.handler()!(
        { toolName: 'mcp_call', input: { name: 'write_file', input: { path: 'a' } } },
        { ui: { confirm: async () => true } },
      );
      now += MCP_APPROVAL_TOKEN_TTL_MS + 1;
      const denied = await tool.execute('late-call', { name: 'write_file', input: { path: 'a' } });
      assert.equal(denied.isError, true, 'stale hash fallback token must not execute later');
      assert.equal(calls, 0, 'expired approval must not reach the MCP server');
    } finally {
      Date.now = originalNow;
    }
  });

  await check('(18) one approval token is consumed once only', async () => {
    let calls = 0;
    const env = makeFakePi();
    createMcpBridgeExtensionFactory({
      mcpTools: [WRITE_TOOL],
      requestMcpResult: async () => {
        calls += 1;
        return { ok: true, content: [{ type: 'text', text: 'ok' }] };
      },
    } as never)(env.pi as never);
    const tool = mcpCallTool(env);
    await env.handler()!(
      { toolName: 'mcp_call', toolCallId: 'call-once', input: { name: 'write_file', input: { path: 'a' } } },
      { ui: { confirm: async () => true } },
    );
    const first = await tool.execute('call-once', { name: 'write_file', input: { path: 'a' } });
    const second = await tool.execute('call-once', { name: 'write_file', input: { path: 'a' } });
    assert.equal(first.isError, undefined);
    assert.equal(second.isError, true);
    assert.equal(calls, 1, 'retry without a new approval must not call the server');
  });

  console.log(`\n${passed}/${TOTAL} checks passed${failed ? `, ${failed} FAILED` : ''}.`);
  if (failed > 0 || passed !== TOTAL) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
