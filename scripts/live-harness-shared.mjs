// Shared helpers for the VM-005 live-host harnesses (S10–S12).
//
// Each live harness drives the production agent lane directly:
// `node scripts/tauri-pi-agent-host.entry.mjs` reading ONE JSON run payload on
// stdin and emitting JSONL on stdout (no `.app`, no WebView). When the Pi agent
// dir is not configured (z.ai/MiniMax compat creds absent) the harness must
// SKIP — an INFRA condition — never product-FAIL. The detection + host
// invocation pattern is factored here so the three harnesses stay thin and the
// proven `harness-pi-agent-host.mjs` invocation shape is not re-derived per file.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PI_HOST_ENTRY = 'scripts/tauri-pi-agent-host.entry.mjs';

/**
 * The default Pi agent dir, mirroring the Rust host's `app_pi_agent_dir`
 * (`home.join(".pi/agent")`). The host does NOT expand `~`, so a harness must
 * pass an already-resolved absolute path — exactly as Rust does in production.
 */
export function defaultPiAgentDir() {
  return join(homedir(), '.pi', 'agent');
}

/**
 * Pi env is "configured" iff the agent dir carries BOTH `auth.json` (provider
 * credentials) and `models.json` (Pi-owned model registry/config). The functional
 * test loop §1 ties SKIP-for-S10–S12 to exactly this pair being present. A bare
 * `auth.json` with no `models.json` (or vice-versa) means the agent cannot route
 * a real run → SKIP, not FAIL.
 */
export function detectPiEnv(agentDir = defaultPiAgentDir()) {
  const authPath = join(agentDir, 'auth.json');
  const modelsPath = join(agentDir, 'models.json');
  const hasAuth = existsSync(authPath);
  const hasModels = existsSync(modelsPath);
  return {
    configured: hasAuth && hasModels,
    agentDir,
    authPath,
    modelsPath,
    hasAuth,
    hasModels,
  };
}

/** Emit the canonical SKIP verdict the orchestrator classifies as infra, then exit 0. */
export function emitSkip(reason) {
  process.stdout.write(`${JSON.stringify({ qaState: 'SKIP', reason })}\n`);
  process.exit(0);
}

/** Emit the canonical PASS verdict (orchestrator prefers this over the exit code). */
export function emitPass(detail) {
  process.stdout.write(`${JSON.stringify({ qaState: 'PASS', ...(detail ? { detail } : {}) })}\n`);
  process.exit(0);
}

/** Emit the canonical FAIL verdict and exit non-zero. */
export function emitFail(reason) {
  process.stdout.write(`${JSON.stringify({ qaState: 'FAIL', reason })}\n`);
  process.exit(1);
}

/**
 * Run one Pi host invocation: spawn the entry, write `payload` as the first
 * stdin line, parse JSONL stdout into an array of line objects, and resolve when
 * the host process exits. An optional `onLine(line, child)` callback fires for
 * each parsed JSONL line as it arrives — this is how S12 answers a mid-run
 * `uiRequest` by writing a `uiResponse` line back to the host's stdin while the
 * run is still parked. The host keeps stdin open as a response channel and exits
 * itself once the run settles, so we never have to force-close it.
 *
 * Resolves `{ lines, exitCode, stderr }`. Rejects only on a spawn-level error
 * (ENOENT etc.) so the caller can classify that distinctly from a clean run that
 * happened to assert-fail.
 */
export function runPiHost(payload, { onLine, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PI_HOST_ENTRY], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const lines = [];
    let stdoutBuffer = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // best effort
      }
      reject(new Error(`Pi host timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    const consume = (chunk) => {
      stdoutBuffer += chunk;
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const raw = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (raw) {
          let line;
          try {
            line = JSON.parse(raw);
          } catch {
            line = undefined;
          }
          if (line) {
            lines.push(line);
            if (onLine) {
              try {
                onLine(line, child);
              } catch {
                // A handler error must not crash the harness mid-parse.
              }
            }
          }
        }
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', consume);
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Flush any trailing partial line that lacked a newline.
      const tail = stdoutBuffer.trim();
      if (tail) {
        try {
          lines.push(JSON.parse(tail));
        } catch {
          // ignore non-JSON trailing noise
        }
      }
      resolve({ lines, exitCode: code ?? 0, stderr });
    });

    // First stdin line is the run payload. Keep stdin OPEN — Ask mode (S12)
    // answers a parked `uiRequest` with a later `uiResponse` line, and the host
    // exits on its own once the run settles.
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}

/** Convenience: the `result` line (kind === 'result') from a parsed run, if any. */
export function findResultLine(lines) {
  return lines.find((line) => line?.kind === 'result');
}

/** Convenience: all tool lines (kind === 'tool') from a parsed run. */
export function toolLines(lines) {
  return lines.filter((line) => line?.kind === 'tool');
}
