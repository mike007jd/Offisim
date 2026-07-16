import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
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
  runtime,
  transport,
  permissions,
  packageJson,
  desktopPackage,
  tauriConfig,
] = await Promise.all([
  readText('scripts/tauri-claude-agent-host.entry.mjs'),
  readText('apps/desktop/src-tauri/src/claude_agent_host/mod.rs'),
  readText('apps/desktop/src-tauri/src/claude_agent_host/commands.rs'),
  readText('apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts'),
  readText('apps/desktop/renderer/src/runtime/native-agent-command-transport.ts'),
  readText('apps/desktop/src-tauri/permissions/agent-bridges.toml'),
  readText('package.json').then(JSON.parse),
  readText('apps/desktop/package.json').then(JSON.parse),
  readText('apps/desktop/src-tauri/tauri.conf.json').then(JSON.parse),
]);

assert.equal(packageJson.dependencies['@anthropic-ai/claude-agent-sdk'], '0.3.211');
assert.equal(packageJson.dependencies['@anthropic-ai/sdk'], '0.111.0');
assert.match(entry, /from '@anthropic-ai\/claude-agent-sdk'/);
assert.match(entry, /pathToClaudeCodeExecutable/);
assert.match(entry, /initializationResult\(\)/);
assert.match(entry, /skills: !ephemeral && hasWorkspace \? 'all' : \[\]/);
assert.match(entry, /createClaudeWorkspaceGuard\(process\.cwd\(\)\)/);
assert.match(entry, /allowUnsandboxedCommands: false/);
assert.match(entry, /question\.multiSelect === true/);
assert.match(entry, /values\.map\(\(value\) => nonEmpty\(value\)\)\.join\(', '\)/);
assert.match(entry, /ANTHROPIC_API_KEY/);
assert.match(entry, /CLAUDE_CODE_OAUTH_TOKEN/);
assert.match(entry, /apiProvider !== 'firstParty'/);
assert.match(entry, /subscription-run-diagnostic/);
assert.match(entry, /remaining: used === undefined \? 'Not reported'/);
assert.doesNotMatch(entry, /usage\.cost_usd|total_cost_usd/);
assert.match(rust, /CLAUDE_HOST_PROTOCOL_VERSION: u64 = 1/);
assert.match(rust, /resolve_conversation_opaque_native_session_for_execute/);
assert.match(rust, /validate_task_workspace_binding_authority/);
assert.match(commands, /pub async fn claude_agent_execute/);
assert.match(commands, /pub fn claude_agent_abort/);
assert.match(runtime, /engineId: 'claude'/);
assert.match(runtime, /runtimeVersion: '0\.3\.211'/);
assert.match(transport, /call\('claude_agent_execute'/);
assert.match(transport, /call\('claude_agent_answer'/);
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
  assert.match(
    permissions,
    new RegExp(`"${command}"`),
    `${command} must be callable from the release renderer`,
  );
}
assert.ok(desktopPackage.scripts['build:frontend'].includes('build:claude-agent-host'));
assert.ok(tauriConfig.bundle.resources.includes('resources/claude-agent-host.mjs'));
assert.ok(tauriConfig.bundle.resources.includes('resources/third-party/claude-agent-sdk/NOTICE'));

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
    (
      await guard(
        preToolUse('Bash', {
          command: 'pwd',
          dangerouslyDisableSandbox: true,
        }),
      )
    ).hookSpecificOutput?.permissionDecision,
    'deny',
  );
} finally {
  await rm(guardFixture, { recursive: true, force: true });
}

const isolatedHome = await mkdtemp(join(tmpdir(), 'offisim-claude-host-harness-'));
try {
  const child = spawn(
    process.execPath,
    [resolve(ROOT, 'apps/desktop/src-tauri/resources/claude-agent-host.mjs')],
    {
      cwd: isolatedHome,
      env: {
        HOME: isolatedHome,
        PATH: '/usr/bin:/bin',
        LANG: 'C',
        ANTHROPIC_API_KEY: 'must-not-leak-harness-secret',
        OFFISIM_CLAUDE_EXECUTABLE: join(isolatedHome, 'missing-claude'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  child.stdin.end(`${JSON.stringify({ mode: 'status' })}\n`);
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const exitCode = await new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Claude status harness timed out.'));
    }, 15_000);
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });
  const output = Buffer.concat(stdout).toString('utf8');
  const errorOutput = Buffer.concat(stderr).toString('utf8');
  assert.equal(exitCode, 0, errorOutput || output);
  assert.doesNotMatch(`${output}\n${errorOutput}`, /must-not-leak-harness-secret/);
  const frames = output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.deepEqual(frames[0], { kind: 'ready', protocolVersion: 10 });
  assert.equal(frames.at(-1)?.kind, 'result');
  assert.equal(frames.at(-1)?.response?.accounts?.[0]?.engineId, 'claude');
  assert.equal(frames.at(-1)?.response?.accounts?.[0]?.billingMode, 'subscription');
  assert.equal(frames.at(-1)?.response?.accounts?.[0]?.status, 'unavailable');
} finally {
  await rm(isolatedHome, { recursive: true, force: true });
}

console.log('Claude Agent host harness passed.');
