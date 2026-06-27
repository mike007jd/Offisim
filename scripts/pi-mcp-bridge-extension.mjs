// MCP bridge extension — registers a FIXED set of 3 meta tools on the root Pi
// session so the agent can discover and call MCP tools from connected servers
// (filesystem, github, …) without paying per-tool context cost.
//
// Token-proxy pattern (borrowed from pi-mcp-adapter): no matter how many MCP
// tools are scoped to this run, the agent always sees exactly three tools —
// `mcp_search_tools` (find), `mcp_describe_tool` (inspect inputs), `mcp_call`
// (invoke). The full tool catalog lives in the `mcpTools` payload, searched at
// call time, not registered as individual Pi tools. This also sidesteps the
// JSON-Schema → TypeBox conversion fidelity problem for arbitrary tool schemas.
//
// Invocation routes through the Rust host's in-process mcpCall interception
// (B2): `mcp_call`'s execute calls the injected `requestMcpResult`, which emits a
// `mcpCall` line; the Rust host calls mcp_bridge::call_tool and writes `mcpResult`
// back. A WRITE-class tool call first pauses for the operator's `ctx.ui.confirm`
// through a tool_call gate (the same seam the bash permission gate uses).
//
// Registered alongside the other extensions in resourceLoader.extensionFactories.
// The renderer (B4) owns scope + per-tool grants + audit; this is the agent-facing
// surface only.

import { Type } from 'typebox';

const SearchParams = Type.Object({
  query: Type.Optional(
    Type.String({
      description:
        'Substring matched against tool name/description. Omit to list every available MCP tool.',
    }),
  ),
});

const DescribeParams = Type.Object({
  name: Type.String({ description: 'The MCP tool name to describe (from mcp_search_tools).' }),
});

const CallParams = Type.Object({
  name: Type.String({ description: 'The MCP tool name to invoke (from mcp_search_tools).' }),
  arguments: Type.Optional(
    Type.Unknown({
      description: 'The tool input object — must match the tool inputSchema from mcp_describe_tool.',
    }),
  ),
});

/**
 * A tool is WRITE-class (needs operator approval) if the renderer flagged it so,
 * else if its MCP annotations say it is not read-only or is destructive. Unknown
 * annotations fall back to read (the renderer's grant system is the real gate).
 * @param {{ write?: boolean, annotations?: { readOnlyHint?: boolean, destructiveHint?: boolean } }} tool
 */
export function isWriteMcpTool(tool) {
  if (typeof tool?.write === 'boolean') return tool.write;
  const ann = tool?.annotations;
  return ann?.readOnlyHint === false || ann?.destructiveHint === true;
}

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

/**
 * Build the MCP bridge extension factory.
 * @param {{ mcpTools: Array<{name:string, server:string, description?:string, inputSchema?:object, annotations?:object, write?:boolean}>, requestMcpResult: (server:string, tool:string, args:object) => Promise<{id:string, ok:boolean, content?:unknown, isError?:boolean, error?:string}> }} deps
 */
export function createMcpBridgeExtensionFactory({ mcpTools, requestMcpResult }) {
  // Drop malformed entries up front (a tool needs a name + server to be
  // searchable / callable) so a bad payload entry can't crash search/describe.
  const tools = (Array.isArray(mcpTools) ? mcpTools : []).filter(
    (t) => typeof t?.name === 'string' && typeof t?.server === 'string',
  );
  const byName = new Map(tools.map((t) => [t.name, t]));

  return (pi) => {
    // Write-class MCP tool calls pause for ctx.ui.confirm BEFORE running (the
    // tool_call gate runs before execute; a {block} verdict prevents the call).
    // Equivalent to the SDK's isToolCallEventType('mcp_call', event) check.
    pi.on('tool_call', async (event, ctx) => {
      if (event?.toolName !== 'mcp_call') return undefined;
      const name = typeof event.input?.name === 'string' ? event.input.name : '';
      const tool = byName.get(name);
      if (!tool || !isWriteMcpTool(tool)) return undefined;
      const approved = await ctx.ui.confirm(
        'Approve MCP tool call?',
        `${tool.server} → ${name} can modify data outside this chat. Approve to run it.`,
      );
      return approved
        ? undefined
        : { block: true, reason: `MCP write tool "${name}" rejected by operator.` };
    });

    pi.registerTool({
      name: 'mcp_search_tools',
      label: 'Search MCP tools',
      description:
        'Search the MCP tools available to you (from connected servers like filesystem or github). Returns matching tool names + their server + read/write class. Use mcp_describe_tool for a tool’s inputs, then mcp_call to run it.',
      parameters: SearchParams,
      async execute(_toolCallId, params) {
        const q = typeof params?.query === 'string' ? params.query.trim().toLowerCase() : '';
        const matches = tools.filter(
          (t) =>
            !q ||
            t.name.toLowerCase().includes(q) ||
            (t.description ?? '').toLowerCase().includes(q),
        );
        if (matches.length === 0) {
          return textResult(
            q ? `No MCP tools match "${params.query}".` : 'No MCP tools are available.',
          );
        }
        const lines = matches.map((t) => {
          const rw = isWriteMcpTool(t) ? 'write' : 'read';
          const desc = (t.description ?? '').split('\n')[0].slice(0, 120);
          return `- ${t.name} [${t.server}, ${rw}]${desc ? `: ${desc}` : ''}`;
        });
        return textResult(`${matches.length} MCP tool(s):\n${lines.join('\n')}`);
      },
    });

    pi.registerTool({
      name: 'mcp_describe_tool',
      label: 'Describe MCP tool',
      description:
        'Show one MCP tool’s full input schema + behavior hints (read-only / destructive) so you can call it correctly with mcp_call.',
      parameters: DescribeParams,
      async execute(_toolCallId, params) {
        const name = typeof params?.name === 'string' ? params.name : '';
        const tool = byName.get(name);
        if (!tool) return textResult(`Unknown MCP tool "${name}". Use mcp_search_tools first.`, true);
        return textResult(
          JSON.stringify(
            {
              name: tool.name,
              server: tool.server,
              description: tool.description ?? '',
              write: isWriteMcpTool(tool),
              inputSchema: tool.inputSchema ?? {},
              annotations: tool.annotations ?? {},
            },
            null,
            2,
          ),
        );
      },
    });

    pi.registerTool({
      name: 'mcp_call',
      label: 'Call MCP tool',
      description:
        'Invoke an MCP tool by name with its arguments (see mcp_describe_tool for the input shape). Write-class tools pause for the operator’s approval.',
      parameters: CallParams,
      async execute(_toolCallId, params) {
        const name = typeof params?.name === 'string' ? params.name : '';
        const tool = byName.get(name);
        if (!tool) return textResult(`Unknown MCP tool "${name}". Use mcp_search_tools first.`, true);
        const args =
          params?.arguments &&
          typeof params.arguments === 'object' &&
          !Array.isArray(params.arguments)
            ? params.arguments
            : {};
        const result = await requestMcpResult(tool.server, name, args);
        if (!result || result.ok !== true) {
          return textResult(`MCP call failed: ${result?.error ?? 'unknown error'}`, true);
        }
        const content = Array.isArray(result.content)
          ? result.content
          : [{ type: 'text', text: JSON.stringify(result.content ?? null) }];
        return { content, ...(result.isError ? { isError: true } : {}) };
      },
    });
  };
}
