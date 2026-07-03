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
// inside `mcp_call.execute`, using the ToolDefinition execution context Pi passes
// to custom tools.
//
// Registered alongside the other extensions in resourceLoader.extensionFactories.
// The renderer (B4) owns scope + per-tool grants + audit; this is the agent-facing
// surface only.

import { Type } from 'typebox';
import { agentRunLine } from './pi-agent-host-wire.mjs';

const DEFAULT_MCP_CALL_TIMEOUT_MS = 90_000;
const DEFAULT_MCP_APPROVAL_TIMEOUT_MS = 75_000;

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
  input: Type.Optional(
    Type.Object(
      {},
      {
        additionalProperties: true,
        description:
          'The tool input object — must match the tool inputSchema from mcp_describe_tool.',
      },
    ),
  ),
  arguments: Type.Optional(
    Type.Object(
      {},
      {
        additionalProperties: true,
        description:
          'Legacy alias for input. Prefer input because some tool-call runtimes reserve arguments.',
      },
    ),
  ),
});

/**
 * A tool is WRITE-class (needs operator approval) if the renderer flagged it so,
 * else if its MCP annotations say it is not read-only or is destructive. Unknown
 * annotations fall back to read (the renderer's grant system is the real gate).
 * @param {{ write?: boolean, annotations?: { readOnlyHint?: boolean, destructiveHint?: boolean } }} tool
 */
export function isWriteMcpTool(tool) {
  if (tool?.category === 'computer-use') return true;
  if (typeof tool?.write === 'boolean') return tool.write;
  const ann = tool?.annotations;
  return ann?.readOnlyHint === false || ann?.destructiveHint === true;
}

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function pickNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function cappedText(value, max = 160) {
  const text = pickString(value);
  if (!text) return undefined;
  const normalized = text.replace(/\s+/g, ' ');
  return normalized.length > max ? normalized.slice(0, max) : normalized;
}

const SENSITIVE_KEY_VALUE_PATTERN =
  /\b(password|passwd|pwd|passphrase|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key|bearer|authorization)\b(\s*[:=]\s*|\s+)(\S+)/gi;
const SENSITIVE_TOKEN_PATTERN =
  /\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|gho_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,})\b/g;

// Mask credential-shaped content before the typed text leaves the host.
// Mirrored in shared-types agent-run.ts (parse side).
function redactSensitiveText(text) {
  if (!text) return text;
  return text
    .replace(SENSITIVE_KEY_VALUE_PATTERN, (_match, key, sep) => `${key}${sep}•••`)
    .replace(SENSITIVE_TOKEN_PATTERN, '•••');
}

function firstImageBlock(content) {
  if (!Array.isArray(content)) return undefined;
  return content.find(
    (item) =>
      item &&
      typeof item === 'object' &&
      item.type === 'image' &&
      typeof item.mimeType === 'string' &&
      item.mimeType.startsWith('image/'),
  );
}

function computerActionForTool(toolName, args) {
  const name = String(toolName ?? '').toLowerCase();
  const action = pickString(args?.action)?.toLowerCase();
  const source = `${name} ${action ?? ''}`;
  if (/screenshot|screen[_-]?shot|capture/.test(source)) return 'screenshot';
  if (/click|tap/.test(source)) return 'click';
  if (/type|input|insert|text/.test(source)) return 'type';
  if (/key|press|hotkey/.test(source)) return 'key';
  if (/scroll|wheel/.test(source)) return 'scroll';
  if (/wait|sleep/.test(source)) return 'wait';
  if (/drag/.test(source)) return 'drag';
  if (/move|hover/.test(source)) return 'move';
  return 'observe';
}

function coordinatesFromArgs(args) {
  const coordinates =
    args?.coordinates && typeof args.coordinates === 'object' ? args.coordinates : {};
  const x = pickNumber(args?.x, coordinates.x);
  const y = pickNumber(args?.y, coordinates.y);
  return x == null || y == null ? undefined : { x, y };
}

function computerDetailForMcpTool(tool, toolName, args, result) {
  if (tool?.category !== 'computer-use') return undefined;
  const image = firstImageBlock(result?.content);
  const computer = {
    action: computerActionForTool(toolName, args),
    targetApp: pickString(
      args?.targetApp,
      args?.target_app,
      args?.app,
      args?.application,
      args?.bundleId,
    ),
    targetWindow: pickString(
      args?.targetWindow,
      args?.target_window,
      args?.window,
      args?.windowTitle,
    ),
    url: pickString(args?.url),
    coordinates: coordinatesFromArgs(args),
    textPreview: redactSensitiveText(cappedText(args?.text ?? args?.value ?? args?.input)),
    resultState: result?.ok === true && result?.isError !== true ? 'ok' : 'failed',
    artifactPaths: Array.isArray(result?.artifactPaths)
      ? result.artifactPaths.filter((item) => typeof item === 'string' && item.length > 0)
      : undefined,
  };
  for (const key of Object.keys(computer)) {
    if (computer[key] === undefined) delete computer[key];
  }
  return { computer, ...(image ? { image } : {}) };
}

function normalizedCallArgs(params) {
  const rawInput =
    params?.input !== undefined
      ? params.input
      : params?.arguments !== undefined
        ? params.arguments
        : {};
  return rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : {};
}

function normalizeTimeoutMs(value) {
  return Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : DEFAULT_MCP_CALL_TIMEOUT_MS;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function requestMcpResultWithTimeout(request, { server, toolName, timeoutMs, signal }) {
  if (signal?.aborted === true) {
    return Promise.resolve({ ok: false, error: `MCP call ${server}.${toolName} aborted.` });
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId;
    let abortHandler;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (signal && abortHandler && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', abortHandler);
      }
      resolve(result);
    };

    timeoutId = setTimeout(() => {
      settle({
        ok: false,
        error: `MCP call ${server}.${toolName} timed out after ${timeoutMs}ms.`,
      });
    }, timeoutMs);

    if (signal && typeof signal.addEventListener === 'function') {
      abortHandler = () => settle({ ok: false, error: `MCP call ${server}.${toolName} aborted.` });
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    try {
      Promise.resolve(request()).then(
        (result) => settle(result),
        (error) => settle({ ok: false, error: errorMessage(error) }),
      );
    } catch (error) {
      settle({ ok: false, error: errorMessage(error) });
    }
  });
}

function requestApprovalWithTimeout(request, { server, toolName, timeoutMs, signal }) {
  if (signal?.aborted === true) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId;
    let abortHandler;

    const settle = (approved) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (signal && abortHandler && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', abortHandler);
      }
      resolve(approved === true);
    };

    timeoutId = setTimeout(() => {
      settle(false);
    }, timeoutMs);

    if (signal && typeof signal.addEventListener === 'function') {
      abortHandler = () => settle(false);
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    try {
      Promise.resolve(request()).then(
        (approved) => settle(approved),
        () => settle(false),
      );
    } catch {
      settle(false);
    }
  });
}

/**
 * Build the MCP bridge extension factory.
 * @param {{ mcpTools: Array<{name:string, server:string, description?:string, inputSchema?:object, annotations?:object, write?:boolean, category?:string}>, requestMcpResult: (server:string, tool:string, args:object) => Promise<{id:string, ok:boolean, content?:unknown, isError?:boolean, error?:string, artifactPaths?:string[]}>, confirmMcpToolCall?: (input: { server:string, toolName:string, args:object, tool: object }) => Promise<boolean> | boolean, emit?: (line: object) => void, threadId?: string, rootRunId?: string, employeeId?: string, mcpCallTimeoutMs?: number, mcpApprovalTimeoutMs?: number }} deps
 */
export function createMcpBridgeExtensionFactory({
  mcpTools,
  requestMcpResult,
  confirmMcpToolCall,
  emit,
  threadId,
  rootRunId,
  employeeId,
  mcpCallTimeoutMs,
  mcpApprovalTimeoutMs,
}) {
  // Drop malformed entries up front (a tool needs a name + server to be
  // searchable / callable) so a bad payload entry can't crash search/describe.
  const tools = (Array.isArray(mcpTools) ? mcpTools : []).filter(
    (t) => typeof t?.name === 'string' && typeof t?.server === 'string',
  );
  const byName = new Map(tools.map((t) => [t.name, t]));
  const callTimeoutMs = normalizeTimeoutMs(mcpCallTimeoutMs);
  const approvalTimeoutMs = normalizeTimeoutMs(
    mcpApprovalTimeoutMs ?? DEFAULT_MCP_APPROVAL_TIMEOUT_MS,
  );

  return (pi) => {
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
          const category = t.category ? `, ${t.category}` : '';
          const desc = (t.description ?? '').split('\n')[0].slice(0, 120);
          return `- ${t.name} [${t.server}, ${rw}${category}]${desc ? `: ${desc}` : ''}`;
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
        if (!tool)
          return textResult(`Unknown MCP tool "${name}". Use mcp_search_tools first.`, true);
        return textResult(
          JSON.stringify(
            {
              name: tool.name,
              server: tool.server,
              description: tool.description ?? '',
              write: isWriteMcpTool(tool),
              ...(tool.category ? { category: tool.category } : {}),
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
        'Invoke an MCP tool by name with input matching mcp_describe_tool. Write-class tools pause for the operator’s approval.',
      parameters: CallParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const name = typeof params?.name === 'string' ? params.name : '';
        const tool = byName.get(name);
        if (!tool)
          return textResult(`Unknown MCP tool "${name}". Use mcp_search_tools first.`, true);
        const args = normalizedCallArgs(params);
        const write = isWriteMcpTool(tool);
        if (write) {
          const approved = await requestApprovalWithTimeout(
            () =>
              typeof confirmMcpToolCall === 'function'
                ? confirmMcpToolCall({ server: tool.server, toolName: name, args, tool })
                : ctx?.ui?.confirm?.(
                    'Approve MCP tool call?',
                    `${tool.server} → ${name} can modify data outside this chat. Approve to run it.`,
                  ),
            {
              server: tool.server,
              toolName: name,
              timeoutMs: approvalTimeoutMs,
              signal: _signal,
            },
          );
          if (approved !== true) {
            const result = { ok: false, error: 'mcp_write_tool_rejected' };
            emitMcpAuditLine({
              emit,
              threadId,
              rootRunId,
              employeeId,
              server: tool.server,
              toolName: name,
              args,
              result,
              latencyMs: 0,
              write: true,
              approvalStatus: 'human_denied',
            });
            return textResult(`MCP write tool "${name}" rejected by operator.`, true);
          }
        }
        const startedAt = Date.now();
        const result = await requestMcpResultWithTimeout(
          () => requestMcpResult(tool.server, name, args),
          {
            server: tool.server,
            toolName: name,
            timeoutMs: callTimeoutMs,
            signal: _signal,
          },
        );
        const latencyMs = Math.max(0, Date.now() - startedAt);
        const computerDetail = computerDetailForMcpTool(tool, name, args, result);
        emitMcpAuditLine({
          emit,
          threadId,
          rootRunId,
          employeeId,
          server: tool.server,
          toolName: name,
          args,
          result,
          latencyMs,
          write,
          approvalStatus: write ? 'human_approved' : 'not_required',
          computerDetail,
        });
        if (!result || result.ok !== true) {
          return {
            ...textResult(`MCP call failed: ${result?.error ?? 'unknown error'}`, true),
            ...(computerDetail ?? {}),
          };
        }
        const content = Array.isArray(result.content)
          ? result.content
          : [{ type: 'text', text: JSON.stringify(result.content ?? null) }];
        return { content, ...(result.isError ? { isError: true } : {}), ...(computerDetail ?? {}) };
      },
    });
  };
}

function emitMcpAuditLine({
  emit,
  threadId,
  rootRunId,
  employeeId,
  server,
  toolName,
  args,
  result,
  latencyMs,
  write,
  approvalStatus,
  computerDetail,
}) {
  if (typeof emit !== 'function' || !threadId || !rootRunId) return;
  emit(
    agentRunLine({
      threadId,
      rootRunId,
      runId: rootRunId,
      ...(employeeId ? { employeeId } : {}),
      runType: 'mcp.tool.called',
      payload: {
        server,
        tool: toolName,
        arguments: args,
        result: result?.ok === true ? { content: result.content ?? null } : null,
        ...(computerDetail ? { computer: computerDetail.computer } : {}),
        isError: result?.ok === true ? result.isError === true : true,
        error: result?.ok === true ? null : (result?.error ?? 'unknown error'),
        latencyMs,
        write,
        approvalStatus,
        approved: approvalStatus === 'human_approved',
      },
    }),
  );
}
