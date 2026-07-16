import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HOST = resolve(ROOT, 'apps/desktop/src-tauri/resources/claude-agent-host.mjs');
const SOURCE_URL = 'https://code.claude.com/docs/en/cli-usage';
const AUTH_URL = 'https://code.claude.com/docs/en/authentication';
const readText = (path) => readFile(resolve(ROOT, path), 'utf8');
const { createClaudeWorkspaceGuard } = await import('./claude-workspace-guard.mjs');

const build = spawnSync(process.execPath, [resolve(ROOT, 'scripts/build-claude-agent-host.mjs')], {
  cwd: ROOT,
  encoding: 'utf8',
});
assert.equal(build.status, 0, build.stderr || build.stdout);

const [
  entry,
  rust,
  commands,
  tauriCommands,
  runtime,
  permissions,
  packageJson,
  desktopPackage,
  tauriConfig,
] = await Promise.all([
  readText('scripts/tauri-claude-agent-host.entry.mjs'),
  readText('apps/desktop/src-tauri/src/claude_agent_host/mod.rs'),
  readText('apps/desktop/src-tauri/src/claude_agent_host/commands.rs'),
  readText('apps/desktop/renderer/src/lib/tauri-commands.ts'),
  readText('apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts'),
  readText('apps/desktop/src-tauri/permissions/agent-bridges.toml'),
  readText('package.json').then(JSON.parse),
  readText('apps/desktop/package.json').then(JSON.parse),
  readText('apps/desktop/src-tauri/tauri.conf.json').then(JSON.parse),
]);

assert.equal(packageJson.dependencies?.['@anthropic-ai/claude-agent-sdk'], undefined);
assert.equal(packageJson.dependencies?.['@anthropic-ai/sdk'], undefined);
assert.doesNotMatch(entry, /from '@anthropic-ai\/|total_cost_usd|usage projection|model catalog/iu);
assert.match(entry, /spawn\(binary, cliArgs\(payload, sessionId\)/);
assert.match(entry, /'--output-format',\s*'stream-json'/);
assert.match(entry, /'--include-hook-events'/);
assert.match(entry, /'--workspace-hook'/);
assert.match(entry, /allowUnsandboxedCommands: false/);
assert.match(entry, /failIfUnavailable: true/);
assert.match(entry, /subscription-run-diagnostic/);
assert.match(entry, /订阅内 · 无 API 成本/);
assert.match(entry, new RegExp(SOURCE_URL.replaceAll('/', '\\/')));
assert.match(entry, new RegExp(AUTH_URL.replaceAll('/', '\\/')));
assert.match(rust, /CLAUDE_HOST_PROTOCOL_VERSION: u64 = 1/);
assert.match(rust, /resolve_conversation_opaque_native_session_for_execute/);
assert.match(rust, /validate_task_workspace_binding_authority/);
assert.match(rust, /deny_unknown_fields/);
assert.match(commands, /pub async fn claude_agent_execute/);
assert.match(commands, /pub fn claude_agent_abort/);
assert.match(runtime, /const CLAUDE_ENGINE_RUNTIME[\s\S]*runtimeVersion: '1'/);
assert.match(
  runtime,
  /const CLAUDE_ENGINE_RUNTIME[\s\S]*interactions: \{ approval: false, userInput: false \}/,
);

function body(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `${label} must exist`);
  return match[1];
}

function tsFields(name) {
  return [
    ...body(tauriCommands, new RegExp(`interface ${name} \\{([\\s\\S]*?)\\n\\}`), name).matchAll(
      /^\s+(\w+)\??:/gmu,
    ),
  ]
    .map((match) => match[1])
    .sort();
}

function rustFields(name) {
  return [
    ...body(rust, new RegExp(`struct ${name} \\{([\\s\\S]*?)\\n\\}`), name).matchAll(
      /^\s+(\w+):/gmu,
    ),
  ]
    .map((match) => match[1].replace(/_([a-z])/gu, (_, letter) => letter.toUpperCase()))
    .sort();
}

assert.deepEqual(
  tsFields('ClaudeAgentExecuteRequest'),
  rustFields('ClaudeAgentExecuteRequest'),
  'renderer and Rust Claude execute fields must remain lockstep',
);
assert.deepEqual(
  tsFields('ClaudeAgentEnhanceRequest'),
  rustFields('ClaudeAgentEnhanceRequest'),
  'renderer and Rust Claude enhance fields must remain lockstep',
);
for (const fields of [
  tsFields('ClaudeAgentExecuteRequest'),
  tsFields('ClaudeAgentEnhanceRequest'),
]) {
  assert.ok(!fields.includes('model'));
  assert.ok(!fields.includes('runtimeModelRef'));
  assert.ok(!fields.includes('thinkingLevel'));
}

for (const command of [
  'claude_agent_execute',
  'claude_agent_resume',
  'claude_agent_enhance',
  'claude_agent_abort',
  'claude_agent_answer',
  'claude_agent_stream_snapshot',
  'claude_agent_release_stream',
  'claude_agent_reattach',
  'claude_agent_status',
]) {
  assert.match(permissions, new RegExp(`"${command}"`), `${command} must be release-callable`);
}
assert.ok(desktopPackage.scripts['build:frontend'].includes('build:claude-agent-host'));
assert.ok(tauriConfig.bundle.resources.includes('resources/claude-agent-host.mjs'));
assert.ok(!tauriConfig.bundle.resources.some((path) => /claude-agent-sdk/iu.test(path)));

const guardFixture = await mkdtemp(join(tmpdir(), 'offisim-claude-workspace-guard-'));
try {
  const workspace = join(guardFixture, 'workspace');
  const outside = join(guardFixture, 'outside');
  await Promise.all([mkdir(workspace), mkdir(outside)]);
  await symlink(outside, join(workspace, 'escape'));
  const guard = createClaudeWorkspaceGuard(workspace);
  const preToolUse = (toolName, toolInput) => ({
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: `tool-${toolName}`,
  });
  assert.deepEqual(
    await guard(preToolUse('Write', { file_path: join(workspace, 'inside.txt') })),
    {},
  );
  assert.equal(
    (await guard(preToolUse('Write', { file_path: join(outside, 'outside.txt') })))
      .hookSpecificOutput?.permissionDecision,
    'deny',
  );
  assert.equal(
    (await guard(preToolUse('Write', { file_path: join(workspace, 'escape', 'symlink.txt') })))
      .hookSpecificOutput?.permissionDecision,
    'deny',
  );
  assert.equal(
    (await guard(preToolUse('Read', {}))).hookSpecificOutput?.permissionDecision,
    'deny',
  );
  assert.deepEqual(await guard(preToolUse('Grep', { pattern: 'needle' })), {});
  assert.equal(
    (await guard(preToolUse('Bash', { command: 'pwd', dangerouslyDisableSandbox: true })))
      .hookSpecificOutput?.permissionDecision,
    'deny',
  );
} finally {
  await rm(guardFixture, { recursive: true, force: true });
}

function runHost({ cwd, env, payload, stopAfterMs }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [HOST], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    // Rust retains this pipe for native run control. The host must still close
    // its read side after the one request frame so successful runs can exit.
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    const stopTimer = stopAfterMs
      ? setTimeout(() => child.kill('SIGTERM'), stopAfterMs)
      : undefined;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Claude host harness timed out.'));
    }, 15_000);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (stopTimer) clearTimeout(stopTimer);
      const output = Buffer.concat(stdout).toString('utf8');
      resolveRun({
        code,
        signal,
        output,
        errorOutput: Buffer.concat(stderr).toString('utf8'),
        frames: output
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      });
    });
  });
}

const fixtureRoot = await mkdtemp(join(tmpdir(), 'offisim-claude-host-harness-'));
try {
  const workspace = join(fixtureRoot, 'workspace');
  const fakeClaude = join(fixtureRoot, 'claude');
  const argsLog = join(fixtureRoot, 'args.json');
  await mkdir(workspace);
  await writeFile(
    fakeClaude,
    `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('2.1.211 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') { console.log(JSON.stringify({ loggedIn: true, email: 'must-not-project@example.invalid' })); process.exit(0); }
writeFileSync(process.env.OFFISIM_CLAUDE_ARGS_LOG, JSON.stringify(args));
if (args.at(-1) === 'WAIT_FOR_STOP') { setInterval(() => {}, 1000); } else {
  const session = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : args[args.indexOf('--session-id') + 1];
  const send = (value) => console.log(JSON.stringify(value));
  send({ type: 'system', subtype: 'init', session_id: session });
  send({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'Inspecting workspace' }, { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'README.md' } }, { type: 'text', text: 'done' }] } });
  send({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }] } });
  send({ type: 'result', subtype: 'success', is_error: false, session_id: session, result: 'done', num_turns: 1, total_cost_usd: 99, usage: { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 3 } });
}
`,
  );
  await chmod(fakeClaude, 0o755);
  const env = {
    HOME: fixtureRoot,
    PATH: `/usr/bin:/bin:${process.env.PATH ?? ''}`,
    OFFISIM_CLAUDE_EXECUTABLE: fakeClaude,
    OFFISIM_CLAUDE_ARGS_LOG: argsLog,
    ANTHROPIC_API_KEY: 'must-not-leak-harness-secret',
  };

  const status = await runHost({ cwd: workspace, env, payload: { mode: 'status' } });
  assert.equal(status.code, 0, status.errorOutput || status.output);
  assert.deepEqual(status.frames[0], { kind: 'ready', protocolVersion: 10 });
  const projection = status.frames.at(-1)?.response;
  assert.equal(projection.engineId, 'claude');
  assert.equal(projection.state, 'ready');
  assert.equal(projection.version, '2.1.211 (Claude Code)');
  assert.equal(projection.loginCommand, 'claude auth login');
  assert.equal(projection.docsUrl, AUTH_URL);
  assert.equal(projection.sourceUrl, SOURCE_URL);
  assert.ok(Number.isFinite(Date.parse(projection.checkedAt)));
  assert.deepEqual(projection.capabilities.permissionModes, ['plan', 'auto', 'full']);
  assert.equal(projection.capabilities.interactions.userInput, false);
  assert.doesNotMatch(`${status.output}\n${status.errorOutput}`, /must-not-project|must-not-leak/);
  assert.equal(projection.accounts, undefined);
  assert.equal(projection.models, undefined);

  const target = {
    engineId: 'claude',
    accountId: 'claude:local',
    billingMode: 'subscription',
    modelId: 'engine-managed',
    modelSource: { kind: 'native' },
  };
  const execute = await runHost({
    cwd: workspace,
    env,
    payload: {
      mode: 'execute',
      requestId: 'request-1',
      text: 'finish safely',
      cwd: workspace,
      workspaceAvailability: 'bound',
      permissionMode: 'auto',
      systemPromptAppend: null,
      rootRunId: 'run-1',
      nativeSessionId: null,
      expectedTarget: target,
    },
  });
  assert.equal(execute.code, 0, execute.errorOutput || execute.output);
  assert.ok(execute.frames.some((frame) => frame.kind === 'executionPrepared'));
  assert.ok(execute.frames.some((frame) => frame.kind === 'started'));
  assert.ok(
    execute.frames.some(
      (frame) => frame.kind === 'tool' && frame.status === 'started' && frame.toolName === 'Read',
    ),
  );
  assert.ok(
    execute.frames.some(
      (frame) => frame.kind === 'tool' && frame.status === 'completed' && frame.toolName === 'Read',
    ),
  );
  assert.ok(
    execute.frames.some((frame) => frame.kind === 'messageDelta' && frame.channel === 'reasoning'),
  );
  const response = execute.frames.at(-1)?.response;
  assert.equal(response.text, 'done');
  assert.equal(response.usage.input, 11);
  assert.equal(response.usage.output, 7);
  assert.equal(response.usage.durationMs >= 0, true);
  assert.deepEqual(response.usage.cost, { kind: 'unavailable', reason: '订阅内 · 无 API 成本' });
  assert.doesNotMatch(JSON.stringify(response), /total_cost_usd|\$99|"kind":"available"/u);
  const invokedArgs = JSON.parse(await readFile(argsLog, 'utf8'));
  assert.ok(invokedArgs.includes('-p'));
  assert.ok(invokedArgs.includes('stream-json'));
  assert.ok(invokedArgs.includes('--settings'));
  assert.ok(invokedArgs.includes('--session-id'));
  assert.ok(!invokedArgs.includes('--model'));
  assert.ok(!invokedArgs.includes('--dangerously-skip-permissions'));
  const settings = JSON.parse(invokedArgs[invokedArgs.indexOf('--settings') + 1]);
  assert.equal(settings.sandbox.failIfUnavailable, true);
  assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
  assert.ok(settings.hooks.PreToolUse[0].hooks[0].args.includes('--workspace-hook'));

  const stopped = await runHost({
    cwd: workspace,
    env,
    stopAfterMs: 250,
    payload: {
      mode: 'execute',
      requestId: 'request-stop',
      text: 'WAIT_FOR_STOP',
      cwd: workspace,
      workspaceAvailability: 'bound',
      permissionMode: 'plan',
      systemPromptAppend: null,
      rootRunId: 'run-stop',
      nativeSessionId: null,
      expectedTarget: target,
    },
  });
  assert.notEqual(stopped.code, 0);
  assert.equal(stopped.frames.at(-1)?.kind, 'error');
  assert.equal(stopped.frames.at(-1)?.code, 'aborted');

  const missing = await runHost({
    cwd: workspace,
    env: { ...env, OFFISIM_CLAUDE_EXECUTABLE: join(fixtureRoot, 'missing') },
    payload: { mode: 'status' },
  });
  assert.equal(missing.code, 0);
  assert.equal(missing.frames.at(-1)?.response?.state, 'not-installed');
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

console.log('Claude CLI orchestration host harness passed.');
