// S10 — Real agent run end-to-end (live host, creds-gated).
//
// Drives the production Pi agent lane headlessly: payload asks the agent to use
// bash to write `OFFISIM_OK` into a temp file in its cwd, then stop. PASS iff the
// JSONL stream carries ≥1 `tool` line + a `result` line with a `model`, AND the
// temp file exists on disk containing `OFFISIM_OK`. This is the only headless way
// to prove the agent ACTUALLY runs (bash → disk) and that the z.ai/MiniMax compat
// lane really served the request.
//
// When the Pi agent dir is not configured (no auth.json + models.json) → SKIP.
// Never tests against real OpenAI/Anthropic keys (project provider policy).

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectPiEnv,
  emitFail,
  emitPass,
  emitSkip,
  findResultLine,
  runPiHost,
  toolLines,
} from './live-harness-shared.mjs';

const SENTINEL = 'OFFISIM_OK';

async function main() {
  const env = detectPiEnv();
  if (!env.configured) {
    emitSkip('pi env not configured');
    return;
  }

  // The host's cwd must be a real on-disk workspace it can write into. Use a
  // temp dir under the project tree so the bash tool's relative write lands
  // somewhere we can inspect (the host binds cwd as the Pi session root).
  const workspace = mkdtempSync(join(process.cwd(), 'test-loop-s10-'));
  const outFile = join(workspace, 'out.txt');

  try {
    const payload = {
      mode: 'execute',
      // ASCII only — smart-quote substitution silently corrupts flag strings.
      text: `Using bash, create a file out.txt containing the exact text ${SENTINEL} in the current directory, then stop.`,
      cwd: workspace,
      agentDir: env.agentDir,
      permissionMode: 'full',
    };

    const { lines, stderr } = await runPiHost(payload, { timeoutMs: 180_000 });

    const errorLine = lines.find((line) => line?.kind === 'error');
    if (errorLine) {
      emitFail(`host emitted error: ${errorLine.message ?? errorLine.code ?? 'unknown'}`);
      return;
    }

    const tools = toolLines(lines);
    if (tools.length === 0) {
      emitFail(`expected ≥1 tool line, got 0${stderr ? ` (stderr: ${stderr.slice(0, 200)})` : ''}`);
      return;
    }

    const result = findResultLine(lines);
    if (!result?.response?.model) {
      emitFail('result line missing a model — provider did not serve the run');
      return;
    }

    let contents = '';
    try {
      contents = readFileSync(outFile, 'utf8');
    } catch {
      emitFail(`out.txt was not created at ${outFile} — bash did not write to disk`);
      return;
    }
    if (!contents.includes(SENTINEL)) {
      emitFail(`out.txt exists but does not contain ${SENTINEL}`);
      return;
    }

    emitPass({
      tools: tools.length,
      model: result.response.model.id ?? result.response.model.name,
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  emitFail(error instanceof Error ? error.message : String(error));
});
