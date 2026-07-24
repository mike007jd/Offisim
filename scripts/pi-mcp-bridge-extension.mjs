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
  server: Type.Optional(
    Type.String({
      description: 'Exact MCP server name. Use this to narrow duplicate tool names.',
    }),
  ),
});

const DescribeParams = Type.Object({
  name: Type.String({
    description:
      'The MCP tool name or qualified server::tool identity to describe (from mcp_search_tools).',
  }),
  server: Type.Optional(
    Type.String({
      description: 'Exact MCP server name; required when a bare tool name is ambiguous.',
    }),
  ),
});

const CallParams = Type.Object({
  name: Type.String({
    description:
      'The MCP tool name or qualified server::tool identity to invoke (from mcp_search_tools).',
  }),
  server: Type.Optional(
    Type.String({
      description: 'Exact MCP server name; required when a bare tool name is ambiguous.',
    }),
  ),
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
  /\b(password|passwd|pwd|passphrase|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key|bearer|authorization)\b(?:(\s*[:=]\s*)(\S+)|(\s+)((?=\S*[0-9~!@#$%^&*_+=\/\\-])\S{8,}))/gi;
const SENSITIVE_TOKEN_PATTERN =
  /\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|gho_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,})\b/g;
const SENSITIVE_KEY_NAME_PATTERN =
  /^(?:authorization|bearer|tokens?|api[_-]?keys?|secrets?|passwo?r?ds?|passphrases?|pwd|access[_-]?(?:tokens?|keys?)|client[_-]?secrets?|private[_-]?keys?|credentials?)$/i;

// Mask credential-shaped content before computer previews or persisted MCP audit
// payloads leave the host. SENSITIVE_KEY_VALUE_PATTERN / SENSITIVE_TOKEN_PATTERN
// are mirrored in shared-types agent-run.ts (parse side) and
// SENSITIVE_KEY_NAME_PATTERN in renderer activity-data.ts (projection side);
// all three are gated by check-redaction-pattern-sync.mjs.
function redactSensitiveText(text) {
  if (!text) return text;
  return text
    .replace(
      SENSITIVE_KEY_VALUE_PATTERN,
      (_match, key, eqSep, _eqValue, wsSep) => `${key}${eqSep ?? wsSep}•••`,
    )
    .replace(SENSITIVE_TOKEN_PATTERN, '•••');
}

// Depth cap so a pathologically nested MCP result cannot blow the stack while
// building the audit line; anything deeper is collapsed rather than emitted raw.
const MAX_REDACTION_DEPTH = 64;

function redactSensitiveStructure(value, depth = 0) {
  if (depth >= MAX_REDACTION_DEPTH) return '•••';
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitiveStructure(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        // A key that names a credential masks its value whole — a bare password
        // in a `password`/`token`/… field has no shape a pattern could catch.
        SENSITIVE_KEY_NAME_PATTERN.test(key) ? '•••' : redactSensitiveStructure(nested, depth + 1),
      ]),
    );
  }
  return value;
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

function catalogIdentityKey(server, name) {
  return JSON.stringify([server, name]);
}

function qualifiedToolName(tool) {
  return `${encodeURIComponent(tool.server)}::${encodeURIComponent(tool.name)}`;
}

function parseQualifiedToolName(value) {
  const separator = value.indexOf('::');
  if (separator <= 0 || separator >= value.length - 2) return undefined;
  try {
    return {
      server: decodeURIComponent(value.slice(0, separator)),
      name: decodeURIComponent(value.slice(separator + 2)),
    };
  } catch {
    return undefined;
  }
}

function resolveCatalogTool(nameValue, serverValue, byIdentity, byName) {
  const rawName = typeof nameValue === 'string' ? nameValue.trim() : '';
  const explicitServer = typeof serverValue === 'string' ? serverValue.trim() : '';
  const qualified = parseQualifiedToolName(rawName);
  if (qualified && explicitServer && qualified.server !== explicitServer) {
    return {
      error: `MCP tool identity "${rawName}" conflicts with server "${explicitServer}".`,
    };
  }

  const name = qualified?.name ?? rawName;
  const server = qualified?.server ?? explicitServer;
  if (server) {
    const tool = byIdentity.get(catalogIdentityKey(server, name));
    return tool
      ? { tool }
      : {
          error: `Unknown MCP tool "${server}::${name}". Use mcp_search_tools first.`,
        };
  }

  const matches = byName.get(name) ?? [];
  if (matches.length === 1) return { tool: matches[0] };
  if (matches.length > 1) {
    const choices = matches.map(qualifiedToolName).sort().join(', ');
    return {
      error: `Ambiguous MCP tool "${name}". Choose a server or qualified identity: ${choices}.`,
    };
  }
  return { error: `Unknown MCP tool "${name}". Use mcp_search_tools first.` };
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

    const timeoutId = setTimeout(() => {
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

function requestApprovalWithTimeout(request, { timeoutMs, signal }) {
  if (signal?.aborted === true) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
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

    const timeoutId = setTimeout(() => {
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
  // A tool's stable identity is the (server, name) tuple. Deduplicate exact
  // repeats, retain same-name tools from different servers, and keep a reverse
  // name index so a bare unique name remains the easy path.
  const byIdentity = new Map();
  for (const candidate of Array.isArray(mcpTools) ? mcpTools : []) {
    const name = typeof candidate?.name === 'string' ? candidate.name.trim() : '';
    const server = typeof candidate?.server === 'string' ? candidate.server.trim() : '';
    if (!name || !server) continue;
    const key = catalogIdentityKey(server, name);
    if (!byIdentity.has(key)) byIdentity.set(key, { ...candidate, name, server });
  }
  const tools = [...byIdentity.values()];
  const byName = new Map();
  for (const tool of tools) {
    const matches = byName.get(tool.name) ?? [];
    matches.push(tool);
    byName.set(tool.name, matches);
  }
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
        const server = typeof params?.server === 'string' ? params.server.trim() : '';
        const matches = tools.filter(
          (t) =>
            (!server || t.server === server) &&
            (!q ||
              t.name.toLowerCase().includes(q) ||
              t.server.toLowerCase().includes(q) ||
              qualifiedToolName(t).toLowerCase().includes(q) ||
              (t.description ?? '').toLowerCase().includes(q)),
        );
        if (matches.length === 0) {
          if (tools.length === 0) {
            // Empty catalog = this employee has no MCP grants. Give an actionable
            // setup state instead of a dead end (closes the screenshot-1 apology).
            return textResult(
              'No MCP tools are granted to you yet. MCP servers and their tools are enabled per employee in Settings › MCP — ask your operator to grant them, then search again.',
            );
          }
          return textResult(
            q ? `No MCP tools match "${params.query}".` : 'No MCP tools are available.',
          );
        }
        const lines = matches.map((t) => {
          const rw = isWriteMcpTool(t) ? 'write' : 'read';
          const category = t.category ? `, ${t.category}` : '';
          const desc = (t.description ?? '').split('\n')[0].slice(0, 120);
          return `- ${qualifiedToolName(t)} [${rw}${category}]${desc ? `: ${desc}` : ''}`;
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
        const resolved = resolveCatalogTool(params?.name, params?.server, byIdentity, byName);
        if (!resolved.tool) return textResult(resolved.error, true);
        const tool = resolved.tool;
        return textResult(
          JSON.stringify(
            {
              name: tool.name,
              server: tool.server,
              qualifiedName: qualifiedToolName(tool),
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
        const resolved = resolveCatalogTool(params?.name, params?.server, byIdentity, byName);
        if (!resolved.tool) return textResult(resolved.error, true);
        const tool = resolved.tool;
        const name = tool.name;
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

// Typed text has no credential shape a pattern could recognise — a password
// typed into a login field is just a word. The live tool result keeps the
// pattern-redacted preview (the model already produced the text), but the
// persisted audit line must not carry typed content at all.
const TYPED_TEXT_ARG_KEYS = ['text', 'value', 'input'];

function auditSafeComputerCall(args, computerDetail) {
  const action = computerDetail?.computer?.action;
  if (action !== 'type' && action !== 'key') {
    return { args, computer: computerDetail?.computer };
  }
  const maskedArgs = { ...args };
  for (const key of TYPED_TEXT_ARG_KEYS) {
    if (typeof maskedArgs[key] === 'string' && maskedArgs[key]) maskedArgs[key] = '•••';
  }
  const computer = { ...computerDetail.computer };
  if (typeof computer.textPreview === 'string' && computer.textPreview) {
    computer.textPreview = '•••';
  }
  return { args: maskedArgs, computer };
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
  const safe = auditSafeComputerCall(args, computerDetail);
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
        arguments: redactSensitiveStructure(safe.args),
        result:
          result?.ok === true
            ? { content: redactSensitiveStructure(result.content ?? null) }
            : null,
        ...(computerDetail ? { computer: safe.computer } : {}),
        isError: result?.ok === true ? result.isError === true : true,
        error:
          result?.ok === true ? null : redactSensitiveText(String(result?.error ?? 'unknown error')),
        latencyMs,
        write,
        approvalStatus,
        approved: approvalStatus === 'human_approved',
      },
    }),
  );
}
