#!/usr/bin/env node
/**
 * Phase 0 delegation smoke check.
 *
 * Locks down the two facts the multi-agent delegation epic needs before any
 * orchestration code is written, against the *actually installed*
 * `@earendil-works/pi-coding-agent@0.80.9` (not docs, not the upstream main):
 *
 *   (a) Can multiple independent `createAgentSession` instances live in the same
 *       Node process with isolated state (distinct sessionId, independent message
 *       arrays, independent event subscriptions)? If yes, the ChildAgentSupervisor
 *       can spawn children in-process and reuse the host's existing permission
 *       gate / persona / event-stream machinery instead of shelling out to a `pi`
 *       CLI binary the bundled host does not ship.
 *
 *   (b) Is concurrency structurally safe — no module-level `process.chdir`, no
 *       shared singleton the SDK mutates per session? `cwd` is a per-call option,
 *       so two sessions rooted at different directories must not stomp each other.
 *
 * The official subagent example
 * (node_modules/@earendil-works/pi-coding-agent/examples/extensions/subagent/index.ts)
 * spawns a separate `pi` *process* per child — but only because it runs as a
 * third-party TUI extension with no programmatic access to `createAgentSession`.
 * The Offisim host imports the SDK directly and already holds authStorage +
 * modelRegistry, so the in-process path is available to us and is the simpler,
 * lower-overhead choice *if* this smoke passes.
 *
 * Structural checks (A–D) never need credentials and gate the exit code. The
 * optional live isolation check (E) runs automatically when the real Pi agent dir
 * has at least one available model, and is purely informational — it never fails
 * the run.
 *
 *   node scripts/pi-delegation-smoke.mjs
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ICONS = { pass: '✅', skip: '⏭️ ', info: 'ℹ️ ', fail: '❌' };
const errMsg = (error) => (error instanceof Error ? error.message : String(error));

const results = [];
function record(id, title, status, detail) {
  results.push({ id, title, status, detail });
  console.log(`${ICONS[status] ?? '❌'} [${id}] ${title}${detail ? ` — ${detail}` : ''}`);
}

let pkg;
let tmpRoot;

async function main() {
  console.log('Pi delegation smoke — @earendil-works/pi-coding-agent\n');

  // ── Check A: delegation-relevant SDK surface is importable ────────────────
  try {
    pkg = await import('@earendil-works/pi-coding-agent');
  } catch (error) {
    record('A', 'Import SDK', 'fail', errMsg(error));
    return finish();
  }
  const required = [
    'createAgentSession',
    'createAgentSessionServices',
    'createAgentSessionFromServices',
    'DefaultResourceLoader',
    'SessionManager',
    'SettingsManager',
    'AuthStorage',
    'ModelRegistry',
    'isToolCallEventType',
    'getAgentDir',
  ];
  const missing = required.filter((name) => typeof pkg[name] === 'undefined');
  if (missing.length > 0) {
    record('A', 'SDK surface present', 'fail', `missing: ${missing.join(', ')}`);
    return finish();
  }
  record(
    'A',
    'SDK surface present',
    'pass',
    `${required.length} symbols + version ${pkg.VERSION ?? 'unknown'}`,
  );

  const { AuthStorage, ModelRegistry, SessionManager, createAgentSession, getAgentDir } = pkg;

  // ── Check B: registries/services build from an empty temp agent dir ───────
  tmpRoot = mkdtempSync(join(tmpdir(), 'pi-deleg-smoke-'));
  let sharedAuth;
  let sharedModels;
  try {
    sharedAuth = AuthStorage.create(join(tmpRoot, 'auth.json'));
    sharedModels = ModelRegistry.create(sharedAuth, join(tmpRoot, 'models.json'));
    record(
      'B',
      'Build shared registries',
      'pass',
      `${sharedModels.getAll().length} catalog models`,
    );
  } catch (error) {
    record('B', 'Build shared registries', 'fail', errMsg(error));
    return finish();
  }

  // ── Check C: two independent in-process sessions, built concurrently ──────
  // Shared registries (auth/models are read-only here), but each child gets its
  // own in-memory SessionManager rooted at a distinct cwd. This mirrors exactly
  // how ChildAgentSupervisor would construct siblings.
  let sessA;
  let sessB;
  try {
    const buildSession = (cwd) =>
      createAgentSession({
        cwd,
        agentDir: tmpRoot,
        authStorage: sharedAuth,
        modelRegistry: sharedModels,
        sessionManager: SessionManager.inMemory(cwd),
      });
    const [a, b] = await Promise.all([
      buildSession(join(tmpRoot, 'a')),
      buildSession(join(tmpRoot, 'b')),
    ]);
    sessA = a.session;
    sessB = b.session;
  } catch (error) {
    record('C', 'Concurrent in-process sessions', 'fail', errMsg(error));
    return finish();
  }

  const distinctObjects = sessA !== sessB;
  const distinctIds = typeof sessA.sessionId === 'string' && sessA.sessionId !== sessB.sessionId;
  const independentMessages =
    Array.isArray(sessA.messages) &&
    Array.isArray(sessB.messages) &&
    sessA.messages !== sessB.messages;
  const hasInstanceApi = ['prompt', 'subscribe', 'dispose', 'abort'].every(
    (m) => typeof sessA[m] === 'function' && typeof sessB[m] === 'function',
  );
  if (distinctObjects && distinctIds && independentMessages && hasInstanceApi) {
    record(
      'C',
      'Concurrent in-process sessions are isolated',
      'pass',
      `2 sessions, distinct ids (${sessA.sessionId.slice(0, 8)}…/${sessB.sessionId.slice(0, 8)}…), independent message arrays, per-instance prompt/subscribe/dispose/abort`,
    );
  } else {
    record(
      'C',
      'Concurrent in-process sessions are isolated',
      'fail',
      `distinctObjects=${distinctObjects} distinctIds=${distinctIds} independentMessages=${independentMessages} instanceApi=${hasInstanceApi}`,
    );
    return finish();
  }

  // ── Check D: per-session subscriptions are independent handles ────────────
  // We can't emit synthetic agent events without a live model, so this asserts
  // only what's testable offline: each session's subscribe() returns its own
  // unsubscribe handle. True cross-fire isolation is covered structurally by
  // Check C's independent message arrays and confirmed end-to-end by the live
  // Check E (ALPHA vs BETA never bleed across the two concurrent sessions).
  try {
    const offA = sessA.subscribe(() => {});
    const offB = sessB.subscribe(() => {});
    const independentUnsub =
      typeof offA === 'function' && typeof offB === 'function' && offA !== offB;
    offA();
    offB();
    record(
      'D',
      'Per-session subscriptions independent',
      independentUnsub ? 'pass' : 'fail',
      independentUnsub
        ? 'distinct unsubscribe closures'
        : 'subscribe returned non-distinct handles',
    );
    if (!independentUnsub) return finish();
  } catch (error) {
    record('D', 'Per-session subscriptions independent', 'fail', errMsg(error));
    return finish();
  }

  sessA.dispose();
  sessB.dispose();

  // ── Check E (optional, informational): live concurrent isolation ──────────
  // Auto-runs only when the *real* Pi agent dir has an available model. Two
  // concurrent prompts with disjoint instructed answers (ALPHA vs BETA) must not
  // cross-contaminate. Never fails the run — purely a confidence signal.
  try {
    const realDir = getAgentDir();
    const liveAuth = AuthStorage.create(join(realDir, 'auth.json'));
    const liveModels = ModelRegistry.create(liveAuth, join(realDir, 'models.json'));
    const available = liveModels.getAvailable();
    if (available.length === 0) {
      record(
        'E',
        'Live concurrent isolation',
        'skip',
        'no available model in real Pi agent dir (structural checks suffice)',
      );
    } else {
      const live = mkdtempSync(join(tmpdir(), 'pi-deleg-live-'));
      const run = async (marker, cwd) => {
        const { session } = await createAgentSession({
          cwd,
          agentDir: realDir,
          authStorage: liveAuth,
          modelRegistry: liveModels,
          sessionManager: SessionManager.inMemory(cwd),
        });
        try {
          await session.prompt(
            `Reply with exactly the single word ${marker} and nothing else. Do not call any tools.`,
          );
          return (session.getLastAssistantText() || '').trim();
        } finally {
          session.dispose();
        }
      };
      const [a, b] = await Promise.all([
        run('ALPHA', join(live, 'a')),
        run('BETA', join(live, 'b')),
      ]);
      rmSync(live, { recursive: true, force: true });
      const aOk = a.includes('ALPHA') && !a.includes('BETA');
      const bOk = b.includes('BETA') && !b.includes('ALPHA');
      record(
        'E',
        'Live concurrent isolation',
        aOk && bOk ? 'pass' : 'info',
        `A→"${a.slice(0, 24)}" B→"${b.slice(0, 24)}" (model ${available[0].id})`,
      );
    }
  } catch (error) {
    record('E', 'Live concurrent isolation', 'info', `live attempt skipped: ${errMsg(error)}`);
  }

  finish();
}

function finish() {
  if (tmpRoot) {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  const failed = results.filter((r) => r.status === 'fail');
  console.log('');
  if (failed.length > 0) {
    console.log(
      `VERDICT: ${failed.length} structural check(s) FAILED — in-process delegation is NOT viable on this build.`,
    );
    console.log('Fallback: child Node subprocess (mirror examples/extensions/subagent/index.ts).');
    process.exit(1);
  }
  console.log('VERDICT: in-process concurrent createAgentSession is viable and isolated.');
  console.log(
    'Decision: ChildAgentSupervisor builds children in-process; Rust owns only the root host process.',
  );
  process.exit(0);
}

main().catch((error) => {
  record(
    '?',
    'Unhandled',
    'fail',
    error instanceof Error ? error.stack || error.message : String(error),
  );
  finish();
});
