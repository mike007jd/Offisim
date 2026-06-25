// S12 — Live Ask human-in-the-loop pause → decide (live host, creds-gated).
//
// payload permissionMode:"ask" + `rm -rf ./scratch` of a sentinel created in the
// workspace. The Ask bash gate classifies a local recursive delete as the
// destructive-but-recoverable band → it PAUSES on Pi's extension UI, which the
// headless host forwards as a `uiRequest` JSONL line and parks the tool until a
// matching `uiResponse` line arrives on stdin.
//
//   (a) reject: answer { id, confirmed:false } → tool blocked, sentinel SURVIVES.
//   (b) approve: answer { id, confirmed:true } → `scratch` removed.
//
// PASS iff (a) emits a uiRequest, the run pauses, reject keeps the sentinel; and
// (b) approve deletes scratch. When the Pi agent dir is not configured → SKIP.
// z.ai/MiniMax compat only.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectPiEnv,
  emitFail,
  emitPass,
  emitSkip,
  runPiHost,
} from './live-harness-shared.mjs';

function makeScratch(workspace) {
  const scratchDir = join(workspace, 'scratch');
  mkdirSync(scratchDir, { recursive: true });
  const sentinel = join(scratchDir, 'SENTINEL');
  writeFileSync(sentinel, 'do-not-delete-without-approval\n');
  return { scratchDir, sentinel };
}

/**
 * One Ask-mode sub-run. `confirmed` decides the answer written back to the host's
 * stdin when the first `uiRequest` arrives. Resolves with whether a uiRequest was
 * seen plus the parsed lines, so the caller can assert pause + outcome.
 */
async function runAsk(env, workspace, confirmed) {
  let sawUiRequest = false;
  let answered = false;

  const payload = {
    mode: 'execute',
    text: 'Using bash, run: rm -rf ./scratch',
    cwd: workspace,
    agentDir: env.agentDir,
    permissionMode: 'ask',
  };

  const { lines } = await runPiHost(payload, {
    timeoutMs: 180_000,
    onLine: (line, child) => {
      if (line?.kind === 'uiRequest' && typeof line.id === 'string' && !answered) {
        sawUiRequest = true;
        answered = true;
        // Mirror the host's uiResponse protocol: { id, confirmed }.
        child.stdin.write(`${JSON.stringify({ id: line.id, confirmed })}\n`);
      }
    },
  });

  return { sawUiRequest, lines };
}

async function main() {
  const env = detectPiEnv();
  if (!env.configured) {
    emitSkip('pi env not configured');
    return;
  }

  const workspace = mkdtempSync(join(process.cwd(), 'test-loop-s12-'));

  try {
    // --- (a) reject: pause → confirmed:false → sentinel survives ----------
    const reject = makeScratch(workspace);
    const a = await runAsk(env, workspace, false);

    const rejectError = a.lines.find((line) => line?.kind === 'error');
    if (rejectError) {
      emitFail(`host emitted error (reject case): ${rejectError.message ?? rejectError.code}`);
      return;
    }
    if (!a.sawUiRequest) {
      emitFail('ask mode did not emit a uiRequest — run did not pause for approval');
      return;
    }
    if (!existsSync(reject.sentinel)) {
      emitFail('reject kept-alive failed — sentinel was deleted despite confirmed:false');
      return;
    }

    // --- (b) approve: pause → confirmed:true → scratch removed ------------
    const approve = makeScratch(workspace);
    const b = await runAsk(env, workspace, true);

    const approveError = b.lines.find((line) => line?.kind === 'error');
    if (approveError) {
      emitFail(`host emitted error (approve case): ${approveError.message ?? approveError.code}`);
      return;
    }
    if (!b.sawUiRequest) {
      emitFail('ask mode did not emit a uiRequest on the approve sub-case');
      return;
    }
    if (existsSync(approve.scratchDir)) {
      emitFail('approve failed — scratch directory still exists after confirmed:true');
      return;
    }

    emitPass({ rejectKeptSentinel: true, approveDeletedScratch: true });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  emitFail(error instanceof Error ? error.message : String(error));
});
