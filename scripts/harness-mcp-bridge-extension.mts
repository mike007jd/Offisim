/**
 * MCP bridge extension oracle (Epic B, B3) — the agent-facing 3 meta tools + the
 * write-tool execute-time confirm gate.
 *
 * Drives the REAL {@link createMcpBridgeExtensionFactory} over a fake `pi`
 * (capturing registerTool) and a fake `requestMcpResult` / `ctx.ui.confirm`.
 * No Pi SDK, no host process. Proves: the registered schema is
 * ALWAYS exactly 3 tools (token-proxy invariant) regardless of tool count;
 * search/describe shapes; mcp_call routes to requestMcpResult; a write-class tool
 * pauses for confirm; a deny blocks it; a read-only tool never prompts; write
 * execution fails closed unless Pi provides the tool execution UI context.
 *
 * Inject-proof (run manually, then revert): make the execute path confirm EVERY mcp_call
 * (drop the isWriteMcpTool check) → check (8) read-tool-no-prompt fails; OR make
 * it confirm NONE → check (7) write-deny-blocks fails. That proves the write
 * classification is load-bearing.
 */

import assert from 'node:assert/strict';
import { createMcpBridgeExtensionFactory, isWriteMcpTool } from './pi-mcp-bridge-extension.mjs';
import { parseToolRichDetail } from '../packages/shared-types/src/index.js';

let passed = 0;
let failed = 0;
const TOTAL = 21;

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
type ToolExecutionCtx = { ui?: { confirm?: () => Promise<boolean> | boolean } };
type McpCallTool = Record<string, unknown> & {
  execute: (
    id: string,
    p: unknown,
    signal?: unknown,
    onUpdate?: unknown,
    ctx?: ToolExecutionCtx,
  ) => Promise<{ content: Array<{ text?: string }>; isError?: boolean }>;
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
const COMPUTER_TOOL = {
  name: 'computer_click',
  server: 'cua-driver',
  category: 'computer-use',
  description: 'Click a coordinate in a target app.',
  annotations: { readOnlyHint: true },
};

function build(
  mcpTools: Tool[],
  requestMcpResult: (s: string, t: string, a: object) => Promise<unknown>,
  options: Record<string, unknown> = {},
) {
  const env = makeFakePi();
  createMcpBridgeExtensionFactory({ mcpTools, requestMcpResult, ...options } as never)(
    env.pi as never,
  );
  const tool = (name: string) =>
    env.registered.find((t) => t.name === name) as Record<string, unknown> & {
      execute: (
        id: string,
        p: unknown,
        signal?: unknown,
        onUpdate?: unknown,
        ctx?: ToolExecutionCtx,
      ) => Promise<{ content: Array<{ text?: string }>; isError?: boolean }>;
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
      return {
        id: 'mcp-1',
        ok: true,
        content: [{ type: 'text', text: 'file body' }],
        isError: false,
      };
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
    assert.deepEqual(emitted[0], {
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
    });
  });

  await check('(6b) mcp_call still accepts legacy arguments alias', async () => {
    const calls: Array<[string, string, object]> = [];
    const req = async (server: string, t: string, args: object) => {
      calls.push([server, t, args]);
      return { id: 'mcp-1', ok: true, content: [{ type: 'text', text: 'legacy' }], isError: false };
    };
    const { tool } = build([READ_TOOL], req);
    const res = await tool('mcp_call').execute('1', {
      name: 'read_file',
      arguments: { path: 'legacy' },
    });
    assert.deepEqual(calls[0], ['filesystem', 'read_file', { path: 'legacy' }]);
    assert.equal(res.content[0].text, 'legacy');
  });

  await check(
    '(7) mcp_call on an unknown tool errors WITHOUT invoking requestMcpResult',
    async () => {
      let called = false;
      const req = async () => {
        called = true;
        return { ok: true, content: [] };
      };
      const { tool } = build([READ_TOOL], req);
      const res = await tool('mcp_call').execute('1', { name: 'ghost', arguments: {} });
      assert.equal(res.isError, true);
      assert.equal(called, false, 'unknown tool must not reach the MCP server');
    },
  );

  await check('(8) execute gate: write tool pauses for confirm; DENY blocks it', async () => {
    const emitted: unknown[] = [];
    const env = makeFakePi();
    let called = false;
    createMcpBridgeExtensionFactory({
      mcpTools: [READ_TOOL, WRITE_TOOL],
      requestMcpResult: async () => {
        called = true;
        return { ok: true, content: [{ type: 'text', text: 'ok' }] };
      },
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
    const tool = mcpCallTool(env);
    const res = await tool.execute(
      'call-deny',
      { name: 'write_file', input: { path: 'a' } },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(confirmed, true, 'a write tool must prompt');
    assert.equal(called, false, 'deny blocks the MCP server call');
    assert.equal(res.isError, true, 'deny returns a tool error');
    assert.equal(emitted.length, 1, 'deny emits a rejected audit line');
    assert.equal(
      (emitted[0] as { payload?: { approvalStatus?: string; error?: string } }).payload
        ?.approvalStatus,
      'human_denied',
    );
    assert.equal(
      (emitted[0] as { payload?: { error?: string } }).payload?.error,
      'mcp_write_tool_rejected',
    );
  });

  await check('(9) execute gate: write APPROVE calls the MCP server', async () => {
    const calls: Array<[string, string, object]> = [];
    const { tool } = build([WRITE_TOOL], async (server: string, t: string, args: object) => {
      calls.push([server, t, args]);
      return { ok: true, content: [{ type: 'text', text: 'ok' }] };
    });
    let confirmed = false;
    const res = await tool('mcp_call').execute(
      'call-approve',
      { name: 'write_file', input: { path: 'a' } },
      undefined,
      undefined,
      {
        ui: {
          confirm: async () => {
            confirmed = true;
            return true;
          },
        },
      },
    );
    assert.equal(confirmed, true, 'a write tool must prompt');
    assert.deepEqual(calls, [['filesystem', 'write_file', { path: 'a' }]]);
    assert.equal(res.isError, undefined);
  });

  await check('(9b) execute gate: injected host approval works without Pi ctx', async () => {
    const calls: Array<[string, string, object]> = [];
    let approvalInput: { server?: string; toolName?: string; args?: object } | null = null;
    const { tool } = build(
      [WRITE_TOOL],
      async (server: string, t: string, args: object) => {
        calls.push([server, t, args]);
        return { ok: true, content: [{ type: 'text', text: 'ok' }] };
      },
      {
        confirmMcpToolCall: async (input: { server: string; toolName: string; args: object }) => {
          approvalInput = { server: input.server, toolName: input.toolName, args: input.args };
          return true;
        },
      },
    );
    const res = await tool('mcp_call').execute('call-host-approve', {
      name: 'write_file',
      input: { path: 'a' },
    });
    assert.deepEqual(calls, [['filesystem', 'write_file', { path: 'a' }]]);
    assert.deepEqual(approvalInput, {
      server: 'filesystem',
      toolName: 'write_file',
      args: { path: 'a' },
    });
    assert.equal(res.isError, undefined);
  });

  await check('(9c) execute gate: hanging approval times out closed', async () => {
    let called = false;
    const { tool } = build(
      [WRITE_TOOL],
      async () => {
        called = true;
        return { ok: true, content: [{ type: 'text', text: 'ok' }] };
      },
      {
        mcpApprovalTimeoutMs: 25,
        confirmMcpToolCall: async () => new Promise(() => {}),
      },
    );
    const res = await tool('mcp_call').execute('call-host-approval-timeout', {
      name: 'write_file',
      input: { path: 'a' },
    });
    assert.equal(called, false, 'timeout must not reach the MCP server');
    assert.equal(res.isError, true);
    assert.match(res.content[0].text ?? '', /rejected by operator/);
  });

  await check('(10) execute gate: read-only tool runs WITHOUT a prompt', async () => {
    const { tool } = build([READ_TOOL, WRITE_TOOL], async () => ({
      ok: true,
      content: [{ type: 'text', text: 'read' }],
    }));
    let confirmed = false;
    const res = await tool('mcp_call').execute(
      'call-read',
      { name: 'read_file', input: { path: 'a' } },
      undefined,
      undefined,
      {
        ui: {
          confirm: async () => {
            confirmed = true;
            return false;
          },
        },
      },
    );
    assert.equal(confirmed, false, 'a read-only tool must NOT prompt');
    assert.equal(res.content[0].text, 'read');
  });

  await check('(11) execute gate: missing UI context fails closed before server call', async () => {
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
    const res = await tool.execute('call-no-ui', { name: 'write_file', input: { path: 'a' } });
    assert.equal(called, false, 'missing approval context must not reach the MCP server');
    assert.equal(res.isError, true);
    assert.match(res.content[0].text ?? '', /rejected by operator/);
    assert.equal(
      (emitted[0] as { payload?: { approvalStatus?: string; approved?: boolean; error?: string } })
        .payload?.approvalStatus,
      'human_denied',
    );
    assert.equal((emitted[0] as { payload?: { approved?: boolean } }).payload?.approved, false);
    assert.equal(
      (emitted[0] as { payload?: { error?: string } }).payload?.error,
      'mcp_write_tool_rejected',
    );
  });

  await check('(12) isWriteMcpTool: explicit flag overrides; annotations fallback', () => {
    assert.equal(isWriteMcpTool({ write: false, annotations: { destructiveHint: true } }), false);
    assert.equal(isWriteMcpTool({ write: true, annotations: { readOnlyHint: true } }), true);
    assert.equal(isWriteMcpTool({ annotations: { readOnlyHint: false } }), true);
    assert.equal(isWriteMcpTool({ annotations: { destructiveHint: true } }), true);
    assert.equal(isWriteMcpTool({ annotations: { readOnlyHint: true } }), false);
    assert.equal(
      isWriteMcpTool({ category: 'computer-use', annotations: { readOnlyHint: true } }),
      true,
    );
    assert.equal(isWriteMcpTool({}), false, 'unknown annotations fall back to read');
  });

  await check('(13) write MCP execution emits human_approved audit status', async () => {
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
    await tool.execute(
      'call-a',
      { name: 'write_file', input: { path: 'a' } },
      undefined,
      undefined,
      { ui: { confirm: async () => true } },
    );
    assert.deepEqual(calls[0], ['filesystem', 'write_file', { path: 'a' }]);
    assert.equal(
      (emitted[0] as { payload?: { approvalStatus?: string; approved?: boolean } }).payload
        ?.approvalStatus,
      'human_approved',
    );
    assert.equal((emitted[0] as { payload?: { approved?: boolean } }).payload?.approved, true);
  });

  await check('(14) failed MCP result emits one audit line', async () => {
    const emitted: unknown[] = [];
    const env = makeFakePi();
    createMcpBridgeExtensionFactory({
      mcpTools: [WRITE_TOOL],
      requestMcpResult: async () => {
        return { ok: false, error: 'boom' };
      },
      emit: (line: unknown) => emitted.push(line),
      threadId: 'thread-1',
      rootRunId: 'run-1',
      employeeId: 'emp-1',
    } as never)(env.pi as never);
    const tool = mcpCallTool(env);
    const res = await tool.execute(
      'call-fail',
      { name: 'write_file', input: { path: 'a' } },
      undefined,
      undefined,
      { ui: { confirm: async () => true } },
    );
    assert.equal(emitted.length, 1);
    assert.equal(res.isError, true);
    assert.match(res.content[0].text ?? '', /boom/);
    assert.equal(
      (emitted[0] as { payload?: { approvalStatus?: string; approved?: boolean; error?: string } })
        .payload?.error,
      'boom',
    );
    assert.equal(
      (emitted[0] as { payload?: { approvalStatus?: string } }).payload?.approvalStatus,
      'human_approved',
    );
  });

  await check('(14b) mcp_call times out if the host result never returns', async () => {
    const emitted: unknown[] = [];
    const env = makeFakePi();
    createMcpBridgeExtensionFactory({
      mcpTools: [READ_TOOL],
      requestMcpResult: async () => new Promise<never>(() => undefined),
      emit: (line: unknown) => emitted.push(line),
      threadId: 'thread-1',
      rootRunId: 'run-1',
      employeeId: 'emp-1',
      mcpCallTimeoutMs: 5,
    } as never)(env.pi as never);
    const tool = mcpCallTool(env);
    const res = await tool.execute('call-timeout', { name: 'read_file', input: { path: 'a' } });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text ?? '', /timed out after 5ms/);
    assert.equal(emitted.length, 1);
    assert.match(
      (emitted[0] as { payload?: { error?: string } }).payload?.error ?? '',
      /timed out after 5ms/,
    );
  });

  await check('(15) bridge:computer-category-tags-detail', async () => {
    const env = build([COMPUTER_TOOL], async () => ({
      ok: true,
      content: [{ type: 'text', text: 'clicked' }],
    }));
    const input = {
      name: 'computer_click',
      input: { targetApp: 'Safari', targetWindow: 'Example', coordinates: { x: 12, y: 34 } },
    };
    const res = await env.tool('mcp_call').execute('call-computer', input, undefined, undefined, {
      ui: { confirm: async () => true },
    });
    assert.equal((res as { computer?: { action?: string } }).computer?.action, 'click');
    const rich = parseToolRichDetail('mcp_call', JSON.stringify({ result: res }));
    assert.equal(rich.family, 'computer');
    if (rich.family !== 'computer') return;
    assert.equal(rich.targetApp, 'Safari');
    assert.deepEqual(rich.coordinates, { x: 12, y: 34 });
    assert.equal(rich.resultState, 'ok');
  });

  await check('(16) bridge:non-computer-tools-untouched', async () => {
    const { tool } = build([READ_TOOL], async () => ({
      ok: true,
      content: [{ type: 'text', text: 'file body' }],
    }));
    const res = await tool('mcp_call').execute('read', { name: 'read_file', input: { path: 'a' } });
    assert.equal((res as { computer?: unknown }).computer, undefined);
    const rich = parseToolRichDetail('mcp_call', JSON.stringify({ result: res }));
    assert.equal(rich.family, 'generic');
  });

  await check('(17) bridge:screenshot-image-block-passthrough', async () => {
    const screenshotTool = { ...COMPUTER_TOOL, name: 'computer_screenshot' };
    const env = build([screenshotTool], async () => ({
      ok: true,
      content: [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }],
    }));
    const input = { name: 'computer_screenshot', input: { targetApp: 'Safari' } };
    const res = await env.tool('mcp_call').execute('call-shot', input, undefined, undefined, {
      ui: { confirm: async () => true },
    });
    assert.deepEqual((res as { image?: unknown }).image, {
      type: 'image',
      mimeType: 'image/png',
      data: 'aGVsbG8=',
    });
    const rich = parseToolRichDetail('mcp_call', JSON.stringify({ result: res }));
    assert.equal(rich.family, 'computer');
    if (rich.family !== 'computer') return;
    assert.equal(rich.action, 'screenshot');
    assert.deepEqual(rich.screenshot, {
      mimeType: 'image/png',
      dataRef: 'data:image/png;base64,aGVsbG8=',
    });
  });

  console.log(`\n${passed}/${TOTAL} checks passed${failed ? `, ${failed} FAILED` : ''}.`);
  if (failed > 0 || passed !== TOTAL) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
