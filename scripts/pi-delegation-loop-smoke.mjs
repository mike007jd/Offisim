#!/usr/bin/env node
/**
 * Phase 1 delegation-loop smoke. Proves the two Node-side mechanisms of the
 * single-delegation slice against the real Pi SDK + a live model:
 *
 *   1. Tool registration — the `delegate` tool (typebox schema) registers on a
 *      root session and shows up in its active tool list. This is the check that
 *      would catch a typebox-instance mismatch between our import and Pi's.
 *   2. Supervisor execution — `supervisor.runSingle()` builds an in-process child,
 *      runs it, emits the neutral agentRun envelope (run.started → run.completed),
 *      and returns the child's summary.
 *
 * Auto-skips (exit 0) when the real Pi agent dir has no available model, so it is
 * safe to run anywhere. The model-driven end-to-end (root agent autonomously
 * choosing to call delegate) is verified in the release .app live step.
 *
 *   node scripts/pi-delegation-loop-smoke.mjs
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SettingsManager,
  createAgentSession,
  getAgentDir,
} from '@earendil-works/pi-coding-agent';
import { createChildSupervisor } from './pi-child-supervisor.mjs';
import { createDelegationExtensionFactory } from './pi-delegation-extension.mjs';

const errMsg = (e) => (e instanceof Error ? e.message : String(e));

async function main() {
  const agentDir = getAgentDir();
  const authStorage = AuthStorage.create(join(agentDir, 'auth.json'));
  const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, 'models.json'));
  const available = modelRegistry.getAvailable();
  if (available.length === 0) {
    console.log('⏭️  No available model in the real Pi agent dir — skipping (structural pieces are tested elsewhere).');
    process.exit(0);
  }
  const model = available[0];
  console.log(`Using model ${model.id}\n`);

  const cwd = mkdtempSync(join(tmpdir(), 'pi-deleg-loop-'));
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const emitted = [];
  const roster = [
    {
      employeeId: 'emp-scout',
      name: 'Scout',
      roleSlug: 'researcher',
      persona: 'You are a terse fact-finder. Answer in a single short sentence. Do not use tools.',
    },
  ];

  const supervisor = createChildSupervisor({
    emit: (line) => emitted.push(line),
    agentDir,
    authStorage,
    modelRegistry,
    cwd,
    settingsManager,
    threadId: 'thread-smoke',
    rootRunId: 'attempt-smoke',
    roster,
    resolveModel: () => undefined,
    buildPermissionGate: () => null,
  });

  let failed = false;
  const check = (ok, label, detail) => {
    console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failed = true;
  };

  // ── 1. Tool registration ────────────────────────────────────────────────
  try {
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      extensionFactories: [createDelegationExtensionFactory(supervisor)],
    });
    await loader.reload();
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      authStorage,
      modelRegistry,
      model,
      resourceLoader: loader,
    });
    const toolNames = session.getActiveToolNames();
    check(toolNames.includes('delegate'), 'delegate tool registers on root session', `tools: ${toolNames.join(', ')}`);
    session.dispose();
  } catch (error) {
    check(false, 'delegate tool registers on root session', errMsg(error));
  }

  // ── 2. Supervisor execution ──────────────────────────────────────────────
  try {
    const summary = await supervisor.runSingle(
      { employeeId: 'emp-scout', objective: 'What is the capital of France? One word.', access: 'read' },
      undefined,
    );
    const types = emitted.map((l) => l.runType);
    check(types.includes('run.started'), 'child emits run.started', types.join(' → '));
    check(
      types.includes('run.completed') || types.includes('run.failed'),
      'child emits a terminal run event',
      types.join(' → '),
    );
    const started = emitted.find((l) => l.runType === 'run.started');
    check(
      started?.runId?.startsWith('run-') && started.parentRunId === 'attempt-smoke' && started.relation === 'delegate',
      'agentRun envelope carries run scope',
      `runId=${started?.runId} parent=${started?.parentRunId} relation=${started?.relation}`,
    );
    check(typeof summary === 'string' && summary.trim().length > 0, 'supervisor returns a summary', `"${summary.slice(0, 48)}"`);
  } catch (error) {
    check(false, 'supervisor execution', errMsg(error));
  }

  rmSync(cwd, { recursive: true, force: true });
  console.log('');
  console.log(failed ? 'VERDICT: delegation loop FAILED' : 'VERDICT: delegation loop works (tool registration + supervisor execution)');
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error('Unhandled:', errMsg(error));
  process.exit(1);
});
