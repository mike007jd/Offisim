import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
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
  commandInvocations,
  commandDefinitions,
  tauriCommands,
  runtimeConfig,
  permissions,
  packageJson,
  desktopPackage,
  tauriConfig,
  cargoTestPrereqs,
] = await Promise.all([
  readText('scripts/tauri-claude-agent-host.entry.mjs'),
  readText('apps/desktop/src-tauri/src/claude_agent_host/mod.rs'),
  readText('apps/desktop/src-tauri/src/claude_agent_host/commands.rs'),
  readText('apps/desktop/src-tauri/src/agent_host_runtime.rs'),
  readText('apps/desktop/renderer/src/lib/tauri-commands.ts'),
  readText('apps/desktop/renderer/src/runtime/native-engine-runtime-config.ts'),
  readText('apps/desktop/src-tauri/permissions/agent-bridges.toml'),
  readText('package.json').then(JSON.parse),
  readText('apps/desktop/package.json').then(JSON.parse),
  readText('apps/desktop/src-tauri/tauri.conf.json').then(JSON.parse),
  readText('scripts/prepare-desktop-cargo-test.mjs'),
]);
const commands = `${commandInvocations}\n${commandDefinitions}`;
const entryLines = new Set(entry.split('\n').map((line) => line.trim()));

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
assert.match(entry, /Fast 模式 · 消耗 usage credits/);
assert.doesNotMatch(entry, /OFFISIM_CLAUDE_EXECUTABLE/);
assert.ok(entryLines.has(`const CLAUDE_CLI_SOURCE_URL = '${SOURCE_URL}';`));
assert.ok(entryLines.has(`const CLAUDE_AUTH_DOCS_URL = '${AUTH_URL}';`));
assert.match(rust, /CLAUDE_HOST_PROTOCOL_VERSION: u64 = 1/);
assert.match(rust, /resolve_conversation_opaque_native_session_for_execute/);
assert.match(rust, /validate_task_workspace_binding_authority/);
assert.match(rust, /deny_unknown_fields/);
assert.match(
  rust,
  /let run_env = claude_run_env\(binding\.as_ref\(\)\.map\(\|_\| &cwd\), browser_gateway\.config\(\)\)/u,
  'Claude execute environment must derive workspace authority and per-run browser MCP authority together',
);
assert.match(
  rust,
  /run_bound_sidecar\([\s\S]*?&script_path,[\s\S]*?payload,\s*run_env/u,
  'bound Claude execute must pass the canonical authorized task workspace',
);
assert.match(
  rust,
  /workspace_binding:\s*None,[\s\S]*?env:\s*run_env/u,
  'unbound Claude sidecars must not claim a task workspace boundary',
);
assert.match(commands, /pub async fn claude_agent_execute/);
assert.match(commands, /pub fn claude_agent_abort/);
assert.match(runtimeConfig, /const CLAUDE_ENGINE_RUNTIME[\s\S]*protocolVersion: 1/);
assert.match(
  runtimeConfig,
  /const CLAUDE_ENGINE_RUNTIME[\s\S]*interactions: \{ approval: false, userInput: false \}/,
);

function body(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `${label} must exist`);
  return match[1];
}

// The Rust host's model closed set and the sidecar's CLAUDE_RUN_OPTIONS are two
// hand-written copies of the same list, each covered by a different CI lane.
// Bind them here so adding a model to one side without the other fails the
// node lane instead of surfacing as a runtime rejection.
{
  const declarationBlock = body(
    entry,
    /const CLAUDE_RUN_OPTIONS = Object\.freeze\(\{([\s\S]*?)\n\}\);/u,
    'sidecar CLAUDE_RUN_OPTIONS declaration',
  );
  const declaredModelIds = [...declarationBlock.matchAll(/^\s*id: '([^']+)',$/gmu)].map(
    (match) => match[1],
  );
  const rustClosedSet = body(
    rust,
    /matches!\(\s*target\.model_id\.as_str\(\),\s*([^)]+)\)/u,
    'Rust Claude model closed set',
  )
    .split('|')
    .map((token) => token.trim().replaceAll('"', ''))
    .filter(Boolean);
  assert.deepEqual(
    rustClosedSet,
    ['engine-managed', ...declaredModelIds],
    'the Rust model closed set must mirror the sidecar CLAUDE_RUN_OPTIONS model ids',
  );
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
assert.ok(tsFields('ClaudeAgentExecuteRequest').includes('effort'));
assert.ok(tsFields('ClaudeAgentExecuteRequest').includes('speedMode'));
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
assert.match(cargoTestPrereqs, /resources\/claude-agent-host\.mjs/);
assert.match(cargoTestPrereqs, /scripts\/build-claude-agent-host\.mjs/);

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
  const skillPluginDir = join(fixtureRoot, 'offisim-skills-plugin');
  const fakeClaude = join(fixtureRoot, '.local', 'bin', 'claude');
  const maliciousClaude = join(workspace, 'claude');
  const maliciousMarker = join(fixtureRoot, 'malicious-claude-ran');
  const argsLog = join(fixtureRoot, 'args.json');
  await Promise.all([
    mkdir(workspace),
    mkdir(skillPluginDir),
    mkdir(join(fixtureRoot, '.local', 'bin'), { recursive: true }),
  ]);
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
  send({ type: 'system', subtype: 'init', session_id: session, model: 'claude-opus-4-8' });
  send({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'Inspecting workspace' }, { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'README.md' } }, { type: 'text', text: 'done' }] } });
  send({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }] } });
  send({ type: 'result', subtype: 'success', is_error: false, session_id: session, result: 'done', num_turns: 1, total_cost_usd: 99, usage: { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 3 } });
}
`,
  );
  await chmod(fakeClaude, 0o755);
  await writeFile(
    maliciousClaude,
    `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(
      maliciousMarker,
    )}, 'executed');\n`,
  );
  await chmod(maliciousClaude, 0o755);
  const env = {
    HOME: fixtureRoot,
    PATH: `.:${workspace}:/usr/bin:/bin:${process.env.PATH ?? ''}`,
    OFFISIM_WORKSPACE_ROOT: await realpath(workspace),
    OFFISIM_CLAUDE_EXECUTABLE: maliciousClaude,
    OFFISIM_CLAUDE_ARGS_LOG: argsLog,
    OFFISIM_BROWSER_MCP_URL: 'http://127.0.0.1:49152/mcp',
    OFFISIM_BROWSER_MCP_TOKEN: 'fixture-browser-token-must-not-enter-argv',
    ANTHROPIC_API_KEY: 'must-not-leak-harness-secret',
  };

  const status = await runHost({ cwd: workspace, env, payload: { mode: 'status' } });
  assert.equal(status.code, 0, status.errorOutput || status.output);
  assert.deepEqual(status.frames[0], { kind: 'ready', protocolVersion: 14 });
  const projection = status.frames.at(-1)?.response;
  assert.equal(projection.engineId, 'claude');
  assert.equal(projection.state, 'ready');
  assert.equal(projection.version, '2.1.211 (Claude Code)');
  assert.equal(projection.loginCommand, 'claude auth login');
  assert.equal(projection.docsUrl, AUTH_URL);
  assert.equal(projection.sourceUrl, SOURCE_URL);
  assert.ok(Number.isFinite(Date.parse(projection.checkedAt)));
  assert.equal(projection.runOptions.sourceUrl, 'https://code.claude.com/docs/en/cli-reference');
  assert.equal(projection.runOptions.checkedAt, '2026-07-24');
  assert.deepEqual(
    projection.runOptions.models.map((model) => model.id),
    ['sonnet', 'opus', 'haiku', 'fable'],
  );
  assert.equal(projection.runOptions.models[0].isDefault, true);
  assert.deepEqual(projection.runOptions.models[0].reasoningEfforts, [
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ]);
  assert.equal(projection.runOptions.models[0].defaultReasoningEffort, undefined);
  assert.deepEqual(projection.runOptions.models[1].speedModes, ['standard', 'fast']);
  assert.equal(
    projection.runOptions.models[1].fastModeNote,
    'Fast mode bills usage credits beyond your subscription',
  );
  assert.deepEqual(projection.runOptions.models[2].speedModes, ['standard']);
  assert.deepEqual(
    projection.runOptions.models[2].reasoningEfforts,
    [],
    'Haiku is absent from the official effort table and must not declare effort levels',
  );
  assert.deepEqual(projection.runOptions.models[3].speedModes, ['standard']);
  assert.deepEqual(projection.runOptions.models[3].reasoningEfforts, [
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ]);
  assert.deepEqual(projection.capabilities.permissionModes, ['plan', 'auto', 'full']);
  assert.equal(projection.capabilities.interactions.userInput, false);
  assert.deepEqual(
    projection.capabilities.interactionRoutes.computer.map((route) => [
      route.id,
      route.availability,
    ]),
    [
      ['claude-native-computer', 'unsupported'],
      ['offisim-computer', 'runtime-determined'],
    ],
  );
  assert.doesNotMatch(`${status.output}\n${status.errorOutput}`, /must-not-project|must-not-leak/);
  await assert.rejects(readFile(maliciousMarker), /ENOENT/u);
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
      skillPluginDir,
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
  assert.equal(invokedArgs[invokedArgs.indexOf('--allowedTools') + 1], 'mcp__offisim_browser__*');
  const mcpConfig = JSON.parse(invokedArgs[invokedArgs.indexOf('--mcp-config') + 1]);
  assert.equal(mcpConfig.mcpServers.offisim_browser.url, 'http://127.0.0.1:49152/mcp');
  assert.equal(
    mcpConfig.mcpServers.offisim_browser.headers.Authorization,
    'Bearer ${OFFISIM_BROWSER_MCP_TOKEN}',
  );
  assert.doesNotMatch(JSON.stringify(invokedArgs), /fixture-browser-token-must-not-enter-argv/u);
  assert.equal(invokedArgs[invokedArgs.indexOf('--plugin-dir') + 1], skillPluginDir);
  assert.ok(!invokedArgs.includes('--model'));
  assert.ok(!invokedArgs.includes('--effort'));
  assert.ok(!invokedArgs.includes('--dangerously-skip-permissions'));
  assert.equal(invokedArgs.filter((arg) => arg === '--settings').length, 1);
  const settings = JSON.parse(invokedArgs[invokedArgs.indexOf('--settings') + 1]);
  assert.equal(settings.sandbox.failIfUnavailable, true);
  assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
  assert.ok(settings.hooks.PreToolUse[0].hooks[0].args.includes('--workspace-hook'));
  assert.equal(settings.fastMode, undefined);
  const defaultStarted = execute.frames.find((frame) => frame.kind === 'started');
  assert.equal(defaultStarted?.model?.id, 'claude');
  assert.equal(
    defaultStarted?.model?.name,
    'claude-opus-4-8',
    'engine-managed runs adopt the CLI-reported model instead of claiming the declared default alias',
  );
  assert.equal(defaultStarted?.model?.reasoning, true);
  assert.equal(response.usage.scope.modelId, 'engine-managed');

  const opusTarget = { ...target, modelId: 'opus' };
  const explicitResume = await runHost({
    cwd: workspace,
    env,
    payload: {
      mode: 'execute',
      requestId: 'request-opus-fast',
      text: 'resume with explicit options',
      cwd: workspace,
      workspaceAvailability: 'bound',
      permissionMode: 'auto',
      model: 'opus',
      effort: 'xhigh',
      speedMode: 'fast',
      systemPromptAppend: null,
      skillPluginDir,
      rootRunId: 'run-opus-fast',
      nativeSessionId: 'opaque-resume',
      expectedTarget: opusTarget,
    },
  });
  assert.equal(explicitResume.code, 0, explicitResume.errorOutput || explicitResume.output);
  const explicitArgs = JSON.parse(await readFile(argsLog, 'utf8'));
  assert.equal(explicitArgs[explicitArgs.indexOf('--model') + 1], 'opus');
  assert.equal(explicitArgs[explicitArgs.indexOf('--effort') + 1], 'xhigh');
  assert.equal(explicitArgs[explicitArgs.indexOf('--resume') + 1], 'opaque-resume');
  assert.ok(!explicitArgs.includes('--session-id'));
  assert.equal(explicitArgs.filter((arg) => arg === '--settings').length, 1);
  const explicitSettings = JSON.parse(explicitArgs[explicitArgs.indexOf('--settings') + 1]);
  assert.equal(explicitSettings.fastMode, true);
  assert.equal(explicitSettings.sandbox.failIfUnavailable, true);
  assert.ok(explicitSettings.hooks.PreToolUse[0].hooks[0].args.includes('--workspace-hook'));
  const explicitStarted = explicitResume.frames.find((frame) => frame.kind === 'started');
  assert.equal(explicitStarted?.model?.id, 'claude:opus');
  assert.equal(explicitStarted?.model?.name, 'Opus (claude-opus-4-8)');
  assert.equal(explicitStarted?.model?.reasoning, true);
  const explicitResponse = explicitResume.frames.at(-1)?.response;
  assert.equal(explicitResponse.provenance.modelId, 'opus');
  assert.equal(explicitResponse.usage.scope.modelId, 'opus');
  assert.deepEqual(
    explicitResponse.usage.cost,
    { kind: 'unavailable', reason: 'Fast 模式 · 消耗 usage credits' },
    'a fast run bills usage credits and must not claim it had no cost',
  );

  const unboundFast = await runHost({
    cwd: workspace,
    env,
    payload: {
      mode: 'execute',
      requestId: 'request-opus-fast-unbound',
      text: 'run without workspace hooks',
      cwd: workspace,
      workspaceAvailability: 'unavailable',
      permissionMode: 'plan',
      model: 'opus',
      effort: 'low',
      speedMode: 'fast',
      rootRunId: 'run-opus-fast-unbound',
      nativeSessionId: null,
      expectedTarget: opusTarget,
    },
  });
  assert.equal(unboundFast.code, 0, unboundFast.errorOutput || unboundFast.output);
  const unboundArgs = JSON.parse(await readFile(argsLog, 'utf8'));
  assert.equal(unboundArgs.filter((arg) => arg === '--settings').length, 1);
  assert.deepEqual(JSON.parse(unboundArgs[unboundArgs.indexOf('--settings') + 1]), {
    fastMode: true,
  });

  const invalidFast = await runHost({
    cwd: workspace,
    env,
    payload: {
      mode: 'execute',
      requestId: 'request-sonnet-fast',
      text: 'reject unsupported fast mode',
      cwd: workspace,
      workspaceAvailability: 'bound',
      permissionMode: 'auto',
      model: 'sonnet',
      speedMode: 'fast',
      rootRunId: 'run-sonnet-fast',
      nativeSessionId: null,
      expectedTarget: { ...target, modelId: 'sonnet' },
    },
  });
  assert.notEqual(invalidFast.code, 0);
  assert.equal(invalidFast.frames.at(-1)?.kind, 'error');
  assert.equal(invalidFast.frames.at(-1)?.code, 'request-invalid');
  assert.match(invalidFast.frames.at(-1)?.message ?? '', /explicit opus/u);

  const invalidEffort = await runHost({
    cwd: workspace,
    env,
    payload: {
      mode: 'execute',
      requestId: 'request-invalid-effort',
      text: 'reject invalid effort',
      cwd: workspace,
      workspaceAvailability: 'bound',
      permissionMode: 'auto',
      model: 'opus',
      effort: 'ultra',
      rootRunId: 'run-invalid-effort',
      nativeSessionId: null,
      expectedTarget: opusTarget,
    },
  });
  assert.notEqual(invalidEffort.code, 0);
  assert.equal(invalidEffort.frames.at(-1)?.code, 'request-invalid');
  assert.match(invalidEffort.frames.at(-1)?.message ?? '', /low, medium, high, xhigh, max/u);

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
    env: {
      ...env,
      HOME: join(fixtureRoot, 'missing-home'),
      PATH: `.:${workspace}`,
    },
    payload: { mode: 'status' },
  });
  assert.equal(missing.code, 0);
  assert.equal(missing.frames.at(-1)?.response?.state, 'not-installed');
  assert.deepEqual(
    missing.frames.at(-1)?.response?.runOptions?.models.map((model) => model.id),
    ['sonnet', 'opus', 'haiku', 'fable'],
  );
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

console.log('Claude CLI orchestration host harness passed.');
