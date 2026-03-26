import { describe, expect, it, vi } from 'vitest';
import { CompositeToolExecutor } from '../../tools/composite-tool-executor.js';
import type { BuiltinTool } from '../../tools/builtin/types.js';
import type { ToolCallRequest, ToolExecutor } from '../../runtime/tool-executor.js';
import type { ToolDef } from '../../llm/gateway.js';

// ---- Helpers ----

function mockBuiltinTool(name: string, result: unknown): BuiltinTool {
  return {
    def: { name, description: `${name} tool`, parameters: { type: 'object', properties: {} } },
    execute: vi.fn().mockResolvedValue(result),
  };
}

function mockMcpExecutor(overrides?: Partial<ToolExecutor>): ToolExecutor {
  return {
    execute: vi.fn().mockResolvedValue({ success: true, result: 'mcp-result' }),
    listAvailable: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeCall(name: string, args?: Record<string, unknown>): ToolCallRequest {
  return {
    toolCallId: 'tc-1',
    name,
    arguments: args ?? {},
  };
}

// ---- Tests ----

describe('CompositeToolExecutor', () => {
  it('routes builtin tool calls to builtin executor', async () => {
    const bash = mockBuiltinTool('bash', 'hello from bash');
    const builtins = new Map([['bash', bash]]);
    const mcp = mockMcpExecutor();
    const executor = new CompositeToolExecutor(builtins, mcp);

    const result = await executor.execute(makeCall('bash', { command: 'echo hi' }));

    expect(result.success).toBe(true);
    expect(result.result).toBe('hello from bash');
    expect(bash.execute).toHaveBeenCalledWith({ command: 'echo hi' });
    expect(mcp.execute).not.toHaveBeenCalled();
  });

  it('routes non-builtin tool calls to MCP executor', async () => {
    const builtins = new Map<string, BuiltinTool>();
    const mcp = mockMcpExecutor();
    const executor = new CompositeToolExecutor(builtins, mcp);

    const call = makeCall('some_mcp_tool', { arg: 'value' });
    const result = await executor.execute(call);

    expect(result.success).toBe(true);
    expect(result.result).toBe('mcp-result');
    expect(mcp.execute).toHaveBeenCalledWith(call);
  });

  it('listAvailable combines both sources', async () => {
    const bash = mockBuiltinTool('bash', '');
    const readFile = mockBuiltinTool('read_file', '');
    const builtins = new Map([
      ['bash', bash],
      ['read_file', readFile],
    ]);

    const mcpDefs: ToolDef[] = [
      { name: 'mcp_tool_1', description: 'MCP tool 1', parameters: { type: 'object' } },
    ];
    const mcp = mockMcpExecutor({ listAvailable: vi.fn().mockResolvedValue(mcpDefs) });
    const executor = new CompositeToolExecutor(builtins, mcp);

    const available = await executor.listAvailable('company-1');

    expect(available).toHaveLength(3);
    expect(available.map((d) => d.name)).toEqual(['bash', 'read_file', 'mcp_tool_1']);
    expect(mcp.listAvailable).toHaveBeenCalledWith('company-1');
  });

  it('handles builtin tool errors gracefully', async () => {
    const failing = mockBuiltinTool('bash', '');
    (failing.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('exec failed'));

    const builtins = new Map([['bash', failing]]);
    const mcp = mockMcpExecutor();
    const executor = new CompositeToolExecutor(builtins, mcp);

    const result = await executor.execute(makeCall('bash', { command: 'boom' }));

    expect(result.success).toBe(false);
    expect(result.error).toBe('exec failed');
    expect(mcp.execute).not.toHaveBeenCalled();
  });
});
