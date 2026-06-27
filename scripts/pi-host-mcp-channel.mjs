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

/**
 * Build an MCP-call channel bound to an `emit(line)` sink (the host's stdout
 * writer). Returns the three operations the host wires in:
 *   - requestMcpResult(server, tool, args) → Promise<mcpResult>
 *   - resolveMcpResult(line) — settle the parked call matching line.id
 *   - rejectAllMcpCalls() — fail every parked call (stdin EOF / abort)
 */
export function createMcpCallChannel(emit) {
  let seq = 0;
  const pending = new Map(); // mcp call id -> resolve(resultObject)

  return {
    requestMcpResult(server, tool, args) {
      seq += 1;
      const id = `mcp-${seq}`;
      emit(mcpCallLine({ id, server, tool, arguments: args }));
      return new Promise((resolve) => {
        pending.set(id, resolve);
      });
    },

    resolveMcpResult(result) {
      if (!result || typeof result.id !== 'string') return;
      const resolve = pending.get(result.id);
      if (resolve) {
        pending.delete(result.id);
        resolve(result);
      }
    },

    rejectAllMcpCalls() {
      for (const [id, resolve] of pending) {
        pending.delete(id);
        resolve({ id, ok: false, error: 'host stdin closed' });
      }
    },
  };
}
