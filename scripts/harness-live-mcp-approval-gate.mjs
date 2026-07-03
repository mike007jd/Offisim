// Live MCP approval gate: Node Pi host pauses a write-class MCP tool call,
// receives a uiResponse, then emits mcpCall and resumes with mcpResult.
//
// This is a live-provider harness, so missing Pi auth/models config is infra
// SKIP, not product FAIL. It does not exercise the Tauri desktop shell; release
// .app validation still owns the final end-to-end proof.

import { detectPiEnv, emitFail, emitPass, emitSkip, runPiHost } from './live-harness-shared.mjs';

async function main() {
  const env = detectPiEnv();
  if (!env.configured) {
    emitSkip('pi env not configured');
    return;
  }

  let sawUiRequest = false;
  let sawMcpCall = false;
  let answeredUi = false;
  let answeredMcp = false;

  const payload = {
    mode: 'execute',
    text: [
      'Release validation.',
      'Use mcp_search_tools to find list_apps, then call mcp_call with name list_apps and input {} exactly once.',
      'If an approval prompt appears, wait for approval.',
      'After the tool result, reply only with the integer app count.',
    ].join(' '),
    cwd: process.cwd(),
    agentDir: env.agentDir,
    permissionMode: 'full',
    threadId: 'thread-live-mcp-approval-gate',
    rootRunId: 'run-live-mcp-approval-gate',
    employeeId: 'emp-live-mcp-approval-gate',
    mcpTools: [
      {
        name: 'list_apps',
        server: 'cua-driver',
        category: 'computer-use',
        description: 'List macOS apps.',
        inputSchema: { type: 'object', additionalProperties: false },
        annotations: { readOnlyHint: true },
        write: true,
      },
    ],
  };

  const { lines, exitCode, stderr } = await runPiHost(payload, {
    timeoutMs: 180_000,
    onLine: (line, child) => {
      if (line?.kind === 'uiRequest' && typeof line.id === 'string' && !answeredUi) {
        sawUiRequest = true;
        answeredUi = true;
        child.stdin.write(`${JSON.stringify({ id: line.id, confirmed: true })}\n`);
      }
      if (line?.kind === 'mcpCall' && typeof line.id === 'string' && !answeredMcp) {
        sawMcpCall = true;
        answeredMcp = true;
        child.stdin.write(
          `${JSON.stringify({
            id: line.id,
            ok: true,
            content: [{ type: 'text', text: '42' }],
            isError: false,
          })}\n`,
        );
      }
    },
  });

  const hostError = lines.find((line) => line?.kind === 'error');
  if (hostError) {
    emitFail(`host emitted error: ${hostError.message ?? hostError.code}`);
    return;
  }
  if (exitCode !== 0) {
    emitFail(`host exited ${exitCode}: ${stderr || 'no stderr'}`);
    return;
  }
  if (!sawUiRequest) {
    emitFail('mcp write tool did not emit a uiRequest approval pause');
    return;
  }
  if (!sawMcpCall) {
    emitFail('approved mcp write tool did not emit mcpCall');
    return;
  }

  emitPass({ sawUiRequest: true, sawMcpCall: true });
}

main().catch((error) => {
  emitFail(error instanceof Error ? error.message : String(error));
});
