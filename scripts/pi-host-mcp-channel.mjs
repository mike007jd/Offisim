// Park-and-resume channel for host→Rust MCP tool calls (Epic B, B2).
//
// The host's MCP bridge extension (B3) invokes an MCP tool by calling
// `requestMcpResult`, which emits an `mcpCall` line and parks the returned
// promise until a matching `mcpResult` lands on stdin (delivered via
// `resolveMcpResult`). Unlike every other host→client line, the Rust host
// intercepts `mcpCall` in-process — it calls mcp_bridge::call_tool and writes the
// `mcpResult` back to the host's stdin — so the renderer is never on this path.
//
// This is the exact park-and-resume shape as the uiRequest/uiResponse channel,
// extracted into a standalone factory so it is unit-testable without spawning the
// host process. The `mcp-` id namespace keeps mcpResult dispatch from colliding
// with the `ui-` uiResponse dispatch when both are routed through one stdin line.

import { mcpCallLine } from './pi-agent-host-wire.mjs';

export const DEFAULT_MCP_RESULT_TIMEOUT_MS = 90_000;

/**
 * Build an MCP-call channel bound to an `emit(line)` sink (the host's stdout
 * writer). Returns the three operations the host wires in:
 *   - requestMcpResult(server, tool, args) → Promise<mcpResult>
 *   - resolveMcpResult(line) — settle the parked call matching line.id
 *   - rejectAllMcpCalls() — fail every parked call (stdin EOF / abort)
 */
export function createMcpCallChannel(emit, options = {}) {
  let seq = 0;
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? Math.max(1, Math.floor(options.timeoutMs))
      : DEFAULT_MCP_RESULT_TIMEOUT_MS;
  const keepTimeoutRef = options.keepTimeoutRef === true;
  const pending = new Map(); // mcp call id -> { resolve(resultObject), timeoutId }

  function settle(id, result) {
    const entry = pending.get(id);
    if (!entry) return false;
    pending.delete(id);
    clearTimeout(entry.timeoutId);
    entry.resolve(result);
    return true;
  }

  return {
    requestMcpResult(server, tool, args) {
      seq += 1;
      const id = `mcp-${seq}`;
      emit(mcpCallLine({ id, server, tool, arguments: args }));
      return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          settle(id, {
            id,
            ok: false,
            error: `MCP result timed out after ${Math.round(timeoutMs / 1000)}s: ${server}.${tool}`,
          });
        }, timeoutMs);
        if (!keepTimeoutRef) timeoutId.unref?.();
        pending.set(id, { resolve, timeoutId });
      });
    },

    resolveMcpResult(result) {
      if (!result || typeof result.id !== 'string') return;
      settle(result.id, result);
    },

    rejectAllMcpCalls() {
      for (const id of [...pending.keys()]) {
        settle(id, { id, ok: false, error: 'host stdin closed' });
      }
    },
  };
}
