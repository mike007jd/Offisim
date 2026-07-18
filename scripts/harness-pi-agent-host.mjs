import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent';
import stripJsonComments from 'strip-json-comments';
import { Type } from 'typebox';
import {
  LanguageServerManager,
  createLspDiagnosticsExtensionFactory,
} from '../apps/desktop/src-tauri/src/pi_agent_host/lsp_diagnostics_extension.mjs';
import { RUN_FAILURE_KINDS, classifyRunFailure } from './pi-agent-host-wire.mjs';
import { childToolsForPermissionMode } from './pi-child-supervisor.mjs';
import { createWorktreeCallChannel } from './pi-host-worktree-channel.mjs';
import {
  createTaskBashProcessRegistry,
  createTaskScopedAgentSessionFactory,
} from './pi-task-bash-process-registry.mjs';

function readJson(path) {
  return JSON.parse(stripJsonComments(readFileSync(path, 'utf8'), { trailingCommas: true }));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function verifyWorktreeCallChannel() {
  const emitted = [];
  const channel = createWorktreeCallChannel((line) => emitted.push(line));
  const first = channel.requestWorktreeResult('status', { order: 1 });
  const second = channel.requestWorktreeResult('status', { order: 2 });
  const [firstCall, secondCall] = emitted;
  assert(
    firstCall?.kind === 'worktreeCall' &&
      secondCall?.kind === 'worktreeCall' &&
      firstCall.id !== secondCall.id,
    'parallel worktree calls must receive distinct wire ids',
  );
  channel.resolveWorktreeResult({ id: secondCall.id, ok: true, value: 'second' });
  channel.resolveWorktreeResult({ id: firstCall.id, ok: true, value: 'first' });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert(
    firstResult.value === 'first' && secondResult.value === 'second',
    'out-of-order worktree results must settle their exact pending calls',
  );

  const controller = new AbortController();
  const bash = channel.requestWorktreeResult(
    'executeBash',
    { leaseId: 'lease-1' },
    { signal: controller.signal },
  );
  const bashCall = emitted.at(-1);
  controller.abort();
  const cancelCall = emitted.at(-1);
  assert(
    cancelCall?.op === 'cancelBash' && cancelCall.args?.callId === bashCall.id,
    'aborting task Bash must emit cancellation for the exact in-flight call id',
  );
  const cancelCount = emitted.filter(
    (line) => line.op === 'cancelBash' && line.args?.callId === bashCall.id,
  ).length;
  controller.abort();
  assert(
    emitted.filter((line) => line.op === 'cancelBash' && line.args?.callId === bashCall.id)
      .length === cancelCount,
    'one AbortSignal must emit at most one cancellation for its Bash call',
  );
  channel.resolveWorktreeResult({ id: bashCall.id, ok: false, error: 'cancelled' });
  assert((await bash).error === 'cancelled', 'the cancelled Bash call must still settle once');

  const fileController = new AbortController();
  const fileSearch = channel.requestWorktreeResult(
    'fileGrep',
    { path: '/__offisim_workspace__', pattern: 'needle' },
    { signal: fileController.signal },
  );
  const fileCall = emitted.at(-1);
  fileController.abort();
  const fileCancel = emitted.at(-1);
  assert(
    fileCancel?.op === 'cancelWorkspaceFile' && fileCancel.args?.callId === fileCall.id,
    'aborting a file tool must cancel the exact in-flight Rust workspace call',
  );
  channel.resolveWorktreeResult({ id: fileCall.id, ok: false, error: 'cancelled' });
  assert((await fileSearch).error === 'cancelled', 'the cancelled file call must settle once');

  const closeController = new AbortController();
  const orphaned = channel.requestWorktreeResult('diff', { path: '.' });
  const orphanedBash = channel.requestWorktreeResult(
    'executeBash',
    { leaseId: 'lease-close' },
    { signal: closeController.signal },
  );
  channel.rejectAllWorktreeCalls();
  const [orphanedResult, orphanedBashResult] = await Promise.all([orphaned, orphanedBash]);
  assert(
    orphanedResult.ok === false &&
      orphanedResult.error === 'host stdin closed' &&
      orphanedBashResult.ok === false &&
      orphanedBashResult.error === 'host stdin closed',
    'stdin close must settle every remaining ordinary and Bash worktree call',
  );
  const emittedAfterClose = emitted.length;
  closeController.abort();
  assert(
    emitted.length === emittedAfterClose,
    'stdin close must remove the pending Bash abort listener before it settles',
  );
}

async function verifyLspDiagnosticsExtension() {
  const workspace = mkdtempSync(join(tmpdir(), 'offisim-lsp-diagnostics-'));
  const executable = join(workspace, 'node_modules', '.bin', 'typescript-language-server');
  const tsserver = join(workspace, 'node_modules', 'typescript', 'lib', 'tsserver.js');
  const sourcePath = join(workspace, 'src', 'diagnostic.ts');
  mkdirSync(join(workspace, 'node_modules', '.bin'), { recursive: true });
  mkdirSync(join(workspace, 'node_modules', 'typescript', 'lib'), { recursive: true });
  mkdirSync(join(workspace, 'src'), { recursive: true });
  writeFileSync(join(workspace, 'package.json'), '{"private":true}');
  writeFileSync(tsserver, '// local TypeScript marker used by the LSP resolver\n');
  writeFileSync(
    executable,
    String.raw`#!/usr/bin/env node
const { existsSync, writeFileSync } = require('node:fs');
let buffer = Buffer.alloc(0);
process.on('SIGTERM', () => {
  if (existsSync('.malformed-active')) writeFileSync('.malformed-terminated', '1');
  process.exit(0);
});
function send(message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }));
  process.stdout.write('Content-Length: ' + body.length + '\r\n\r\n');
  process.stdout.write(body);
}
function publish(params) {
  const document = params.textDocument || {};
  const text = document.text || params.contentChanges?.[0]?.text || '';
  if (text.includes('CRASH_ONCE') && !existsSync('.lsp-crashed')) {
    writeFileSync('.lsp-crashed', '1');
    process.exit(1);
  }
  if (text.includes('MALFORMED')) {
    writeFileSync('.malformed-active', '1');
    process.stdout.write('Broken-LSP-Frame\r\n\r\n{}');
    setInterval(() => undefined, 1_000);
    return;
  }
  send({ method: 'textDocument/publishDiagnostics', params: {
    uri: document.uri,
    version: document.version,
    diagnostics: [],
  }});
  if (text.includes('TYPE_ERROR')) setTimeout(() => send({ method: 'textDocument/publishDiagnostics', params: {
    uri: document.uri,
    version: document.version,
    diagnostics: [{
      severity: 1,
      code: 2322,
      source: 'ts',
      message: 'Type string is not assignable to type number.',
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
    }],
  }}), 250);
}
function receive(message) {
  if (message.method === 'initialize') send({ id: message.id, result: { capabilities: { textDocumentSync: 1 } } });
  else if (message.method === 'shutdown') send({ id: message.id, result: null });
  else if (message.method === 'exit') process.exit(0);
  else if (message.method === 'textDocument/didOpen') publish(message.params);
  else if (message.method === 'textDocument/didChange') publish(message.params);
}
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString('ascii');
    const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1]);
    const end = headerEnd + 4 + length;
    if (!Number.isFinite(length) || buffer.length < end) return;
    const body = buffer.subarray(headerEnd + 4, end).toString('utf8');
    buffer = buffer.subarray(end);
    receive(JSON.parse(body));
  }
});
`,
  );
  chmodSync(executable, 0o755);

  const install = (factory) => {
    const handlers = new Map();
    const messages = [];
    factory({
      on: (name, handler) => handlers.set(name, handler),
      sendMessage: (...args) => messages.push(args),
    });
    return { factory, handlers, messages };
  };
  const executeWrite = async (
    handlers,
    toolCallId,
    path = '/__offisim_workspace__/src/diagnostic.ts',
  ) => {
    await handlers.get('tool_execution_start')({
      toolCallId,
      toolName: 'edit',
      args: { path },
    });
    await handlers.get('tool_execution_end')({
      toolCallId,
      toolName: 'edit',
      isError: false,
    });
  };

  try {
    writeFileSync(sourcePath, 'const answer: number = "TYPE_ERROR";\n');
    const emitted = [];
    const lspManager = new LanguageServerManager({
      cwd: workspace,
      env: { ...process.env, PATH: '' },
    });
    const lsp = install(
      createLspDiagnosticsExtensionFactory({
        cwd: workspace,
        emitDiagnostics: (payload) => emitted.push(payload),
        manager: lspManager,
      }),
    );
    await executeWrite(lsp.handlers, 'write-red');
    assert(
      emitted[0]?.path === 'src/diagnostic.ts' &&
        emitted[0]?.counts?.error === 1 &&
        emitted[0]?.diagnostics?.[0]?.code === '2322',
      'a successful file edit must pull bounded, workspace-relative LSP diagnostics',
    );
    assert(
      lsp.messages[0]?.[0]?.display === false &&
        lsp.messages[0]?.[1]?.deliverAs === 'followUp' &&
        lsp.messages[0]?.[1]?.triggerTurn === true,
      'LSP errors must enter the next Pi turn as invisible follow-up feedback',
    );

    writeFileSync(sourcePath, 'const answer: number = 42;\n');
    await executeWrite(lsp.handlers, 'write-green');
    assert(
      emitted[1]?.counts?.error === 0 && emitted[1]?.diagnostics?.length === 0,
      'the next file edit must emit an explicit diagnostics-clear marker',
    );
    assert(lsp.messages.length === 1, 'a clear diagnostics update must not trigger another turn');
    await lsp.factory.dispose();
    assert(
      lspManager.sessions.size === 0,
      'the host-owned extension teardown must dispose every session-scoped language server',
    );

    writeFileSync(sourcePath, 'const answer: number = "CRASH_ONCE TYPE_ERROR";\n');
    const restartManager = new LanguageServerManager({
      cwd: workspace,
      env: { ...process.env, PATH: '' },
      initializeTimeoutMs: 500,
      diagnosticTimeoutMs: 1_200,
    });
    assert(
      (await restartManager.diagnoseFile(sourcePath)).status === 'unavailable',
      'a language server exit during diagnostics must degrade silently for that edit',
    );
    const recovered = await restartManager.diagnoseFile(sourcePath);
    assert(
      recovered.status === 'available' && recovered.payload.counts.error === 1,
      'a restarted language server must receive didOpen and recover diagnostics for the same file',
    );
    await restartManager.dispose();

    writeFileSync(sourcePath, 'const malformed = "MALFORMED";\n');
    const malformedManager = new LanguageServerManager({
      cwd: workspace,
      env: { ...process.env, PATH: '' },
      initializeTimeoutMs: 500,
      diagnosticTimeoutMs: 1_200,
    });
    assert(
      (await malformedManager.diagnoseFile(sourcePath)).status === 'unavailable',
      'a malformed language-server frame must degrade silently',
    );
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    assert(
      existsSync(join(workspace, '.malformed-terminated')),
      'a malformed but still-live language server must be terminated instead of orphaned',
    );
    await malformedManager.dispose();

    renameSync(tsserver, `${tsserver}.disabled`);
    writeFileSync(sourcePath, 'const answer: number = "TYPE_ERROR";\n');
    const bundledTypeScriptFallback = new LanguageServerManager({
      cwd: workspace,
      env: { ...process.env, PATH: '' },
    });
    const fallbackTypeScriptResult = await bundledTypeScriptFallback.diagnoseFile(sourcePath);
    assert(
      fallbackTypeScriptResult.status === 'available',
      'a usable TypeScript language server must remain available when no workspace-local tsserver exists',
    );
    await bundledTypeScriptFallback.dispose();

    renameSync(executable, `${executable}.disabled`);
    let fallbackCalls = 0;
    const fallback = install(
      createLspDiagnosticsExtensionFactory({
        cwd: workspace,
        emitDiagnostics: () => undefined,
        manager: new LanguageServerManager({
          cwd: workspace,
          env: { ...process.env, PATH: '' },
          initializeTimeoutMs: 200,
          diagnosticTimeoutMs: 300,
        }),
        runFallbackVerification: async () => {
          fallbackCalls += 1;
          return {
            ok: true,
            result: { exitCode: 2, stdout: 'tsc: fixture typecheck failed', stderr: '' },
          };
        },
      }),
    );
    writeFileSync(sourcePath, 'const answer: number = "TYPE_ERROR";\n');
    await executeWrite(fallback.handlers, 'write-without-lsp');
    assert(
      fallbackCalls === 1 &&
        fallback.messages[0]?.[0]?.content?.includes('source="full-verification"') &&
        fallback.messages[0]?.[1]?.deliverAs === 'followUp',
      'an unavailable language server must silently use the existing full-project verification callback',
    );
    writeFileSync(join(workspace, 'README.md'), '# fixture\n');
    await executeWrite(
      fallback.handlers,
      'write-unsupported-source',
      '/__offisim_workspace__/README.md',
    );
    assert(
      fallbackCalls === 2 && fallback.messages.length === 2,
      'a changed file with no supported language server must use full-project verification fallback',
    );
    await fallback.factory.dispose();
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

await verifyWorktreeCallChannel();
await verifyLspDiagnosticsExtension();

async function verifyExplicitProjectSkillLoading() {
  const root = mkdtempSync(join(tmpdir(), 'offisim-project-skill-'));
  const skillFile = join(root, '.claude', 'skills', 'w7-live', 'SKILL.md');
  const agentDir = join(root, 'agent-home');
  try {
    mkdirSync(join(root, '.claude', 'skills', 'w7-live'), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      skillFile,
      '---\nname: w7-live\ndescription: Project skill fixture\n---\nExact project instructions.\n',
    );
    const settingsManager = SettingsManager.create(root, agentDir);
    const resourceLoader = new DefaultResourceLoader({
      cwd: root,
      agentDir,
      settingsManager,
      additionalSkillPaths: [skillFile],
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();
    const loaded = resourceLoader.getSkills();
    assert(
      loaded.diagnostics.length === 0 &&
        loaded.skills.some(
          (skill) =>
            skill.name === 'w7-live' &&
            skill.description === 'Project skill fixture' &&
            skill.filePath === skillFile,
        ),
      'Pi DefaultResourceLoader must load the exact sandbox-resolved Project SKILL.md',
    );
    console.log('PASS Project SKILL.md reaches the Pi DefaultResourceLoader unchanged');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await verifyExplicitProjectSkillLoading();

function verifyExactNativeSessionSemantics() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'offisim-pi-exact-session-'));
  const sessionDir = join(fixtureRoot, 'sessions');
  const originalProject = join(fixtureRoot, 'project-before-rename');
  const renamedProject = join(fixtureRoot, 'project-after-rename');
  mkdirSync(originalProject, { recursive: true });
  mkdirSync(renamedProject, { recursive: true });

  try {
    const sessionA = SessionManager.create(originalProject, sessionDir);
    sessionA.appendMessage({
      role: 'user',
      content: [{ type: 'text', text: 'session A user history' }],
      timestamp: Date.now(),
    });
    sessionA.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'session A assistant history' }],
      api: 'openai-responses',
      provider: 'oracle',
      model: 'oracle',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    });
    const sessionAId = sessionA.getSessionId();
    const sessionAFile = sessionA.getSessionFile();
    assert(sessionAFile, 'persisted session A must expose its exact file');

    const sessionB = SessionManager.create(originalProject, sessionDir);
    sessionB.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'session B decoy history' }],
      api: 'openai-responses',
      provider: 'oracle',
      model: 'oracle',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    });
    assert(
      sessionB.getSessionId() !== sessionAId && sessionB.getSessionFile() !== sessionAFile,
      'the decoy native session must be distinct from durable session A',
    );

    const reopenedA = SessionManager.open(sessionAFile, sessionDir, renamedProject);
    assert(
      reopenedA.getSessionId() === sessionAId && reopenedA.getSessionFile() === sessionAFile,
      'opening a durable exact file/id must select session A even when another session exists',
    );
    assert(
      reopenedA.getCwd() === renamedProject && reopenedA.getHeader()?.cwd === originalProject,
      'project rename must override the effective cwd without rewriting native session history',
    );
    assert(
      reopenedA
        .getEntries()
        .some(
          (entry) =>
            entry.type === 'message' &&
            entry.message.role === 'user' &&
            entry.message.content?.[0]?.text === 'session A user history',
        ),
      'the exact reopened session must retain session A history',
    );

    const fresh = SessionManager.create(renamedProject, sessionDir);
    assert(
      fresh.getSessionId() !== sessionAId && fresh.getSessionId() !== sessionB.getSessionId(),
      'explicit fresh mode must create a new native session instead of adopting a recent file',
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

verifyExactNativeSessionSemantics();

async function verifyBoundWorkspaceTools() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'offisim-pi-workspace-tools-'));
  const boundRoot = join(fixtureRoot, 'project');
  const originalRoot = join(fixtureRoot, 'project-original');
  const siblingPath = join(fixtureRoot, 'sibling.txt');
  const agentDir = join(fixtureRoot, 'agent');
  const virtualRoot = '/__offisim_workspace__';
  const decoyRead = 'native read must never escape into the tool result\n';
  const decoyEdit = 'native edit must stay unchanged\n';
  const decoyTilde = 'native tilde file must stay unchanged\n';
  const replacementRead = 'replacement root must stay unchanged\n';
  const replacementEdit = 'replacement edit must stay unchanged\n';
  const siblingSentinel = 'outside the bound project\n';
  const files = new Map([
    ['docs/read.txt', { content: 'bridge read needle\n', version: 'read-v1' }],
    ['docs/edit.txt', { content: 'bridge before needle\n', version: 'edit-v1' }],
    ['docs/listed.txt', { content: 'bridge listed\n', version: 'listed-v1' }],
    ['~notes.txt', { content: 'bridge tilde before\n', version: 'tilde-v1' }],
  ]);
  const calls = [];
  let versionSequence = 1;
  let authorityLost = false;
  let findTraversalLimited = false;
  let findResultLimited = false;
  let listEntryLimited = false;
  let grepMatchLimited = false;
  let grepTraversalLimited = false;
  let grepReturnsMatches = true;
  let networkCalls = 0;
  let session;
  let registry;
  const originalFetch = globalThis.fetch;

  const workspaceError = (code, message) => Object.assign(new Error(message), { code });
  const relativeVirtualPath = (path) => {
    if (path === virtualRoot || path === `${virtualRoot}/`) return '.';
    if (typeof path === 'string' && path.startsWith(`${virtualRoot}/`)) {
      return path.slice(virtualRoot.length + 1);
    }
    throw workspaceError('workspace-out-of-bounds', `unexpected bridge path: ${String(path)}`);
  };
  const virtualPath = (path) => (path === '.' ? virtualRoot : `${virtualRoot}/${path}`);
  const directoryExists = (path) =>
    path === '.' || [...files.keys()].some((candidate) => candidate.startsWith(`${path}/`));
  const listEntries = (path) => {
    const prefix = path === '.' ? '' : `${path}/`;
    const names = new Map();
    for (const candidate of files.keys()) {
      if (!candidate.startsWith(prefix)) continue;
      const remainder = candidate.slice(prefix.length);
      if (!remainder) continue;
      const [name, ...tail] = remainder.split('/');
      names.set(name, {
        name,
        isDirectory: tail.length > 0,
        isFile: tail.length === 0,
        isSymlink: false,
      });
    }
    return [...names.values()].sort((left, right) => left.name.localeCompare(right.name));
  };
  const executeBoundWorkspaceOperation = async ({ op, args, taskWorkspaceLease }) => {
    calls.push({ op, args: structuredClone(args), taskWorkspaceLease });
    if (authorityLost) {
      throw workspaceError(
        'workspace-authority-lost',
        'The bound Project folder identity changed while the task was active.',
      );
    }
    const path = relativeVirtualPath(args.path);
    switch (op) {
      case 'fileRead': {
        const file = files.get(path);
        if (!file) throw workspaceError('workspace-file-error', `missing fixture file: ${path}`);
        return {
          contentBase64: Buffer.from(file.content).toString('base64'),
          mimeType: 'text/plain',
          version: file.version,
        };
      }
      case 'fileWrite': {
        const current = files.get(path);
        if (args.expectedVersion !== undefined && args.expectedVersion !== current?.version) {
          throw workspaceError('workspace-file-conflict', `stale fixture version: ${path}`);
        }
        files.set(path, {
          content: Buffer.isBuffer(args.content)
            ? args.content.toString('utf8')
            : String(args.content),
          version: `write-v${versionSequence++}`,
        });
        return { ok: true };
      }
      case 'fileStat': {
        const file = files.get(path);
        const isDirectory = directoryExists(path) && !file;
        return {
          exists: Boolean(file) || isDirectory,
          isDirectory,
          isFile: Boolean(file),
          isSymlink: false,
        };
      }
      case 'fileList':
        return {
          entries: listEntries(path).slice(0, args.limit),
          appliedLimit: Math.min(args.limit, 10_000),
          entryLimitReached: listEntryLimited,
          limitReached: listEntryLimited,
        };
      case 'fileFind':
        return {
          paths: [...files.keys()]
            .filter((candidate) => path === '.' || candidate.startsWith(`${path}/`))
            .filter((candidate) => candidate.endsWith('.txt'))
            .slice(0, args.limit)
            .map(virtualPath),
          appliedLimit: Math.min(args.limit, 10_000),
          resultLimitReached: findResultLimited,
          traversalLimitReached: findTraversalLimited,
          limitReached: findTraversalLimited,
        };
      case 'fileGrep':
        return {
          matches: grepReturnsMatches
            ? [
                {
                  path: virtualPath('docs/read.txt'),
                  lineNumber: 1,
                  line: 'bridge read needle',
                  contextBefore: [],
                  contextAfter: [],
                },
              ]
            : [],
          appliedLimit: Math.min(args.limit, 2_000),
          matchLimitReached: grepMatchLimited,
          traversalLimitReached: grepTraversalLimited,
          limitReached: grepMatchLimited || grepTraversalLimited,
          linesTruncated: false,
        };
      default:
        throw new Error(`unexpected workspace fixture operation: ${op}`);
    }
  };
  const executeTool = async (tools, name, input) => {
    const tool = tools.get(name);
    assert(tool, `production session must expose the injected ${name} tool`);
    return tool.execute(`workspace-oracle-${name}`, input, undefined, () => {}, {});
  };
  const inputForPath = (name, path) => {
    switch (name) {
      case 'write':
        return { path, content: 'must not be written' };
      case 'edit':
        return {
          path,
          edits: [{ oldText: 'bridge before', newText: 'must not be edited' }],
        };
      case 'grep':
        return { path, pattern: 'needle' };
      case 'find':
        return { path, pattern: '*.txt' };
      default:
        return { path };
    }
  };
  const expectCode = async (action, code, message) => {
    try {
      await action();
    } catch (error) {
      assert(error?.code === code, `${message}: expected ${code}, received ${error?.code}`);
      return;
    }
    throw new Error(`${message}: expected ${code}, but the tool succeeded`);
  };

  try {
    mkdirSync(join(boundRoot, 'docs'), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(boundRoot, 'docs', 'read.txt'), decoyRead);
    writeFileSync(join(boundRoot, 'docs', 'edit.txt'), decoyEdit);
    writeFileSync(join(boundRoot, '~notes.txt'), decoyTilde);
    writeFileSync(siblingPath, siblingSentinel);

    globalThis.fetch = (...args) => {
      networkCalls += 1;
      throw new Error(`workspace tool oracle attempted network access: ${String(args[0])}`);
    };
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: join(agentDir, 'models.json'),
    });
    const modelRegistry = new ModelRegistry(modelRuntime);
    await modelRegistry.refresh();
    const settingsManager = SettingsManager.create(boundRoot, agentDir);
    const rogueExtensionFactory = (pi) => {
      pi.registerTool({
        name: 'native_escape',
        label: 'Native escape',
        description: 'Fixture tool that must never enter an Offisim work session.',
        parameters: Type.Object({}),
        async execute() {
          return { content: [{ type: 'text', text: 'escaped' }] };
        },
      });
    };
    const resourceLoader = new DefaultResourceLoader({
      cwd: boundRoot,
      agentDir,
      settingsManager,
      extensionFactories: [rogueExtensionFactory],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();
    registry = createTaskBashProcessRegistry({
      executeBoundCommand: async () => {
        throw new Error('workspace file-tool oracle must not invoke Bash');
      },
      executeBoundWorkspaceOperation,
    });
    const createTaskScopedAgentSession = createTaskScopedAgentSessionFactory(
      createAgentSession,
      registry,
    );
    ({ session } = await createTaskScopedAgentSession({
      cwd: boundRoot,
      agentDir,
      modelRuntime,
      settingsManager,
      sessionManager: SessionManager.inMemory(boundRoot),
      resourceLoader,
      taskWorkspaceLease: {
        leaseId: 'workspace-tool-oracle',
        cwd: boundRoot,
        isolated: true,
      },
      tools: childToolsForPermissionMode('write', 'auto'),
    }));
    const tools = new Map(session.state.tools.map((tool) => [tool.name, tool]));
    assert(
      tools.size === 7 &&
        ['read', 'write', 'edit', 'grep', 'find', 'ls', 'bash'].every((name) => tools.has(name)) &&
        !tools.has('delegate') &&
        !tools.has('native_escape'),
      `write child must activate only the seven Rust-routed workspace tools, received: ${[
        ...tools.keys(),
      ].join(',')}`,
    );

    const readResult = await executeTool(tools, 'read', { path: 'docs/read.txt' });
    assert(
      readResult.content?.[0]?.text === 'bridge read needle\n',
      'read must return injected backend content instead of the native decoy file',
    );
    await executeTool(tools, 'write', { path: 'docs/written.txt', content: 'bridge write\n' });
    await executeTool(tools, 'edit', {
      path: 'docs/edit.txt',
      edits: [{ oldText: 'bridge before', newText: 'bridge after' }],
    });
    const grepResult = await executeTool(tools, 'grep', {
      path: 'docs',
      pattern: 'needle',
    });
    assert(
      grepResult.content?.[0]?.text.includes('read.txt:1: bridge read needle'),
      'grep must render matches returned by the injected backend',
    );
    grepMatchLimited = true;
    const cappedGrepResult = await executeTool(tools, 'grep', {
      path: 'docs',
      pattern: 'needle',
      limit: 3_200,
    });
    assert(
      cappedGrepResult.details?.matchLimitReached === 2_000 &&
        cappedGrepResult.content?.[0]?.text.includes('2000 match limit reached') &&
        !cappedGrepResult.content?.[0]?.text.includes('3200') &&
        !cappedGrepResult.content?.[0]?.text.includes('limit=4000'),
      'grep must report the backend-applied match cap without suggesting an impossible limit',
    );
    grepMatchLimited = false;
    grepTraversalLimited = true;
    grepReturnsMatches = false;
    const emptyLimitedGrepResult = await executeTool(tools, 'grep', {
      path: 'docs',
      pattern: 'missing',
    });
    assert(
      emptyLimitedGrepResult.details?.traversalLimitReached === true &&
        emptyLimitedGrepResult.content?.[0]?.text.includes('No matches found') &&
        emptyLimitedGrepResult.content?.[0]?.text.includes('Workspace traversal limit reached'),
      'grep must disclose incomplete traversal even when collected files contain no matches',
    );
    grepTraversalLimited = false;
    grepReturnsMatches = true;
    const findResult = await executeTool(tools, 'find', {
      path: 'docs',
      pattern: '*.txt',
    });
    assert(
      findResult.content?.[0]?.text.includes('listed.txt'),
      'find must render paths returned by the injected backend',
    );
    findTraversalLimited = true;
    const limitedFindResult = await executeTool(tools, 'find', {
      path: 'docs',
      pattern: '*.txt',
      limit: 100,
    });
    assert(
      limitedFindResult.details?.traversalLimitReached === true &&
        limitedFindResult.content?.[0]?.text.includes('Workspace traversal limit reached'),
      'find must surface backend traversal truncation even below Pi result limit',
    );
    findTraversalLimited = false;
    findResultLimited = true;
    const cappedFindResult = await executeTool(tools, 'find', {
      path: 'docs',
      pattern: '*.txt',
      limit: 20_000,
    });
    assert(
      cappedFindResult.details?.resultLimitReached === 10_000 &&
        cappedFindResult.content?.[0]?.text.includes('10000 result limit reached') &&
        !cappedFindResult.content?.[0]?.text.includes('20000'),
      'find must surface a backend result cap below the user-requested limit',
    );
    findResultLimited = false;
    const lsResult = await executeTool(tools, 'ls', { path: 'docs' });
    assert(
      lsResult.content?.[0]?.text.includes('listed.txt'),
      'ls must render entries returned by the injected backend',
    );
    listEntryLimited = true;
    const limitedLsResult = await executeTool(tools, 'ls', { path: 'docs', limit: 20_000 });
    assert(
      limitedLsResult.details?.entryLimitReached === true &&
        limitedLsResult.content?.[0]?.text.includes('Workspace entry limit reached'),
      'ls must surface backend entry truncation even below the user-requested limit',
    );
    listEntryLimited = false;
    const tildeRead = await executeTool(tools, 'read', { path: '~notes.txt' });
    assert(
      tildeRead.content?.[0]?.text === 'bridge tilde before\n',
      'a tilde-leading filename must remain a literal Project-relative path',
    );
    await executeTool(tools, 'write', {
      path: '~notes.txt',
      content: 'bridge tilde after\n',
    });
    const tildeReadAfterWrite = await executeTool(tools, 'read', { path: '~notes.txt' });
    assert(
      tildeReadAfterWrite.content?.[0]?.text === 'bridge tilde after\n',
      'a tilde-leading filename must remain readable and writable through the bridge',
    );

    const absoluteProjectRead = await executeTool(tools, 'read', {
      path: join(boundRoot, 'docs', 'read.txt'),
    });
    assert(
      absoluteProjectRead.content?.[0]?.text === 'bridge read needle\n' &&
        calls.some(
          (call) => call.op === 'fileRead' && call.args.path === `${virtualRoot}/docs/read.txt`,
        ),
      'Pi skill activation must translate an absolute in-Project read back through the workspace bridge',
    );

    const editWrite = calls.find(
      (call) => call.op === 'fileWrite' && call.args.path === `${virtualRoot}/docs/edit.txt`,
    );
    assert(
      editWrite?.args.expectedVersion === 'edit-v1',
      'edit must commit with the exact version returned by its injected fileRead',
    );
    for (const requiredOp of [
      'fileRead',
      'fileWrite',
      'fileStat',
      'fileList',
      'fileFind',
      'fileGrep',
    ]) {
      assert(
        calls.some((call) => call.op === requiredOp),
        `${requiredOp} must execute through the injected backend`,
      );
    }
    assert(
      calls.every(
        (call) =>
          call.taskWorkspaceLease?.leaseId === 'workspace-tool-oracle' &&
          call.taskWorkspaceLease.cwd === boundRoot,
      ),
      'every workspace operation must retain the exact task workspace lease',
    );
    assert(
      readFileSync(join(boundRoot, 'docs', 'read.txt'), 'utf8') === decoyRead &&
        readFileSync(join(boundRoot, 'docs', 'edit.txt'), 'utf8') === decoyEdit &&
        readFileSync(join(boundRoot, '~notes.txt'), 'utf8') === decoyTilde &&
        !existsSync(join(boundRoot, 'docs', 'written.txt')),
      'successful tools must not fall back to or mutate the native Project filesystem',
    );

    const invalidCases = [
      ['absolute sibling', siblingPath],
      ['parent segment', '../sibling.txt'],
      ['Windows absolute', 'C:\\offisim-sibling.txt'],
      ['file URL', 'file:///tmp/offisim-sibling.txt'],
    ];
    for (const [caseName, path] of invalidCases) {
      for (const toolName of ['read', 'write', 'edit', 'grep', 'find', 'ls']) {
        const callsBefore = calls.length;
        await expectCode(
          () => executeTool(tools, toolName, inputForPath(toolName, path)),
          'workspace-out-of-bounds',
          `${toolName} ${caseName}`,
        );
        assert(
          calls.length === callsBefore,
          `${toolName} ${caseName} must be rejected before any backend or native filesystem call`,
        );
      }
    }
    for (const toolName of ['write', 'edit', 'grep', 'find', 'ls']) {
      const callsBefore = calls.length;
      await expectCode(
        () =>
          executeTool(tools, toolName, inputForPath(toolName, join(boundRoot, 'docs', 'read.txt'))),
        'workspace-out-of-bounds',
        `${toolName} absolute Project path`,
      );
      assert(
        calls.length === callsBefore,
        `${toolName} must continue rejecting an absolute Project path before bridge access`,
      );
    }
    assert(
      readFileSync(siblingPath, 'utf8') === siblingSentinel,
      'out-of-bounds tools must leave the sibling file unchanged',
    );

    const backendBeforeAuthorityLoss = JSON.stringify([...files]);
    renameSync(boundRoot, originalRoot);
    mkdirSync(join(boundRoot, 'docs'), { recursive: true });
    writeFileSync(join(boundRoot, 'docs', 'read.txt'), replacementRead);
    writeFileSync(join(boundRoot, 'docs', 'edit.txt'), replacementEdit);
    authorityLost = true;
    for (const toolName of ['read', 'write', 'edit', 'grep', 'find', 'ls']) {
      const callsBefore = calls.length;
      await expectCode(
        () => executeTool(tools, toolName, inputForPath(toolName, 'docs/read.txt')),
        'workspace-authority-lost',
        `${toolName} replaced Project root`,
      );
      assert(
        calls.length === callsBefore + 1,
        `${toolName} must propagate the injected backend authority failure without fallback`,
      );
    }
    assert(
      JSON.stringify([...files]) === backendBeforeAuthorityLoss &&
        readFileSync(join(originalRoot, 'docs', 'read.txt'), 'utf8') === decoyRead &&
        readFileSync(join(originalRoot, 'docs', 'edit.txt'), 'utf8') === decoyEdit &&
        readFileSync(join(boundRoot, 'docs', 'read.txt'), 'utf8') === replacementRead &&
        readFileSync(join(boundRoot, 'docs', 'edit.txt'), 'utf8') === replacementEdit &&
        readFileSync(siblingPath, 'utf8') === siblingSentinel,
      'authority loss must leave original, replacement, backend, and sibling content unchanged',
    );
    assert(networkCalls === 0, 'workspace tool oracle must not call a model or network API');
  } finally {
    globalThis.fetch = originalFetch;
    session?.dispose();
    await registry?.cleanup();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

await verifyBoundWorkspaceTools();

function extractNamedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `could not find function ${name}`);
  const parametersOpen = source.indexOf('(', start);
  let parameterDepth = 0;
  let parametersClose = -1;
  for (let index = parametersOpen; index < source.length; index += 1) {
    if (source[index] === '(') parameterDepth += 1;
    if (source[index] === ')') {
      parameterDepth -= 1;
      if (parameterDepth === 0) {
        parametersClose = index;
        break;
      }
    }
  }
  assert(parametersClose >= 0, `could not find parameters for function ${name}`);
  const open = source.indexOf('{', parametersClose);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`could not extract function ${name}`);
}

function extractObjectLiteral(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, `could not find object marker ${marker}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`could not extract object marker ${marker}`);
}

function parseHostResult(stdout, label) {
  for (const line of stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.kind === 'result') return event;
  }
  throw new Error(`${label} did not emit a result line`);
}

function runHost(scriptPath, payload, label) {
  const result = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  assert(result.status === 0, `${label} failed: ${result.stderr || result.stdout}`);
  return parseHostResult(result.stdout, label);
}

function ensureBundledHost(scriptPath) {
  if (
    existsSync(scriptPath) &&
    !readFileSync(scriptPath, 'utf8').startsWith('THIS IS A CARGO-TEST-ONLY STUB')
  ) {
    return;
  }

  console.log(`[harness:pi-agent-host] rebuilding missing or inert bundle ${scriptPath}`);
  const result = spawnSync(process.execPath, ['scripts/build-pi-agent-host.mjs'], {
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(`Failed to start Pi Agent host bundle build: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Pi Agent host bundle build failed (exit ${result.status ?? 'unknown'}${result.signal ? `, signal ${result.signal}` : ''})`,
    );
  }
  if (!existsSync(scriptPath)) {
    throw new Error(`Pi Agent host bundle build succeeded but did not create ${scriptPath}`);
  }
}

const HOST_SCRIPT = 'scripts/tauri-pi-agent-host.entry.mjs';
const BUNDLED_HOST_SCRIPT = 'apps/desktop/src-tauri/resources/pi-agent-host.mjs';
ensureBundledHost(BUNDLED_HOST_SCRIPT);
const rootPackage = readJson('package.json');
const desktopPackage = readJson('apps/desktop/package.json');
const tauriConfig = readJson('apps/desktop/src-tauri/tauri.conf.json');
const rustHostSource = globSync('apps/desktop/src-tauri/src/pi_agent_host/*.rs')
  .sort()
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');
const rustRunSource = readFileSync('apps/desktop/src-tauri/src/pi_agent_host/run.rs', 'utf8');
const nodeHostSource = readFileSync(HOST_SCRIPT, 'utf8');
const bundledNodeHostSource = readFileSync(BUNDLED_HOST_SCRIPT, 'utf8');
const taskBashRegistrySource = readFileSync('scripts/pi-task-bash-process-registry.mjs', 'utf8');
const mcpBridgeSource = readFileSync('scripts/pi-mcp-bridge-extension.mjs', 'utf8');
const childSupervisorSource = readFileSync('scripts/pi-child-supervisor.mjs', 'utf8');
const permissionModesSource = readFileSync('scripts/pi-agent-permission-modes.mts', 'utf8');
const delegationExtensionSource = readFileSync('scripts/pi-delegation-extension.mjs', 'utf8');
const wireSource = readFileSync('scripts/pi-agent-host-wire.mjs', 'utf8');
const executePayloadSource = rustHostSource.slice(
  rustHostSource.indexOf('fn sidecar_payload'),
  rustHostSource.indexOf('/// Build the Prompt Enhance sidecar payload'),
);
const collaboratePayloadSource = rustHostSource.slice(
  rustHostSource.indexOf('fn collaborate_payload'),
  rustHostSource.indexOf('/// Write the execute/status payload'),
);
const workspaceRequirementGateSource = rustRunSource.slice(
  rustRunSource.indexOf('fn validate_execute_workspace_requirement'),
  rustRunSource.indexOf('fn workspace_unavailable_error'),
);
const unavailableExecuteSource = rustRunSource.slice(
  rustRunSource.indexOf('async fn execute_without_workspace'),
  rustRunSource.indexOf('async fn do_execute'),
);
const desktopRuntimeScopeSource = readFileSync(
  'apps/desktop/renderer/src/data/employee-persona.ts',
  'utf8',
);
const projectSkillsSource = readFileSync(
  'apps/desktop/renderer/src/data/project-skills.ts',
  'utf8',
);
const desktopAgentRuntimeSource = readFileSync(
  'apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts',
  'utf8',
);
const activityDataSource = readFileSync(
  'apps/desktop/renderer/src/surfaces/office/board/activity-data.ts',
  'utf8',
);

assert(
  /createLspDiagnosticsExtensionFactory/.test(nodeHostSource) &&
    /createLspDiagnosticsExtensionFactory/.test(childSupervisorSource) &&
    /lspDiagnosticsFactory\?\.dispose/.test(nodeHostSource) &&
    /lspDiagnosticsFactory\?\.dispose/.test(childSupervisorSource) &&
    /workspace\.diagnostics\.updated/.test(bundledNodeHostSource),
  'root, delegated child, and rebuilt bundled Pi hosts must install and explicitly dispose the LSP diagnostics extension',
);
assert(
  /runFallbackVerification/.test(nodeHostSource) &&
    /source=["']full-verification["']/.test(bundledNodeHostSource),
  'the bundled root host must preserve silent full-project verification fallback when LSP is unavailable',
);
assert(
  /WORKSPACE_DIAGNOSTICS_UPDATED_EVENT/.test(desktopAgentRuntimeSource) &&
    /const persisted = await this\.persistWorkspaceDiagnostics/.test(desktopAgentRuntimeSource) &&
    /runtimeEventBus\.on\(WORKSPACE_DIAGNOSTICS_UPDATED_EVENT/.test(activityDataSource),
  'DesktopAgentRuntime must persist before emitting the neutral diagnostics event that refreshes the existing timeline',
);

assert(
  rootPackage.scripts['build:pi-agent-host'] === 'node scripts/build-pi-agent-host.mjs',
  'root package must build the Pi Agent host',
);
assert(!('provider:check' in rootPackage.scripts), 'provider:check must not be a validation gate');
assert(
  rootPackage.scripts.validate.includes('pnpm harness:pi-agent-host'),
  'validate must include the Pi Agent host harness',
);
assert(
  rootPackage.scripts['check:pi-wire-contract'] === 'node scripts/check-pi-wire-contract.mjs',
  'root package must run the Pi Agent wire-contract gate',
);
assert(
  rootPackage.scripts.validate.includes('pnpm check:pi-wire-contract'),
  'validate must include the Pi Agent wire-contract gate',
);
assert(
  desktopPackage.scripts['build:frontend'].includes('build:pi-agent-host'),
  'desktop build must bundle the Pi Agent host',
);
assert(
  !desktopPackage.scripts['build:frontend'].includes('codex-app-server') &&
    desktopPackage.scripts['build:frontend'].includes('build:claude-agent-host'),
  'desktop build must bundle only Offisim adapters while external orchestration CLIs stay self-managed',
);
assert(
  tauriConfig.bundle.resources.includes('resources/pi-agent-host.mjs'),
  'release bundle must include the Pi Agent host',
);
assert(
  !('externalBin' in tauriConfig.bundle) &&
    tauriConfig.bundle.resources.includes('resources/claude-agent-host.mjs') &&
    !tauriConfig.bundle.resources.some((resource) =>
      /claude-agent-sdk|claude(?:\.exe)?$/u.test(resource),
    ),
  'release bundle may embed its Claude adapter but never Claude CLI, SDK, or credentials',
);
assert(
  /pub struct PiAgentExecuteRequest[\s\S]*mcp_tools: Option<serde_json::Value>/.test(
    rustHostSource,
  ),
  'execute request must deserialize mcpTools so Office runs can receive employee MCP grants',
);
assert(
  /fn sidecar_payload\([\s\S]*agent_dir: Option<&Path>[\s\S]*"mode": "execute"[\s\S]*"mcpTools": mcp_tools/.test(
    executePayloadSource,
  ),
  'execute sidecar payload must be AppHandle-free and forward mcpTools to the Node Pi host',
);
assert(
  /let project_id = binding[\s\S]*\.or\(req\.project_id\.as_deref\(\)\)/.test(
    executePayloadSource,
  ) &&
    /"projectId": project_id/.test(executePayloadSource) &&
    /"projectVerifyCommand": binding\.and_then/.test(executePayloadSource) &&
    !/"projectId": req\.project_id/.test(executePayloadSource),
  'bound execute payloads must derive project scope and verification policy from the backend-issued workspace binding; only unavailable runs may retain the validated project identity',
);
assert(
  /"cwd": "\."/.test(executePayloadSource) &&
    !/"cwd": binding\.canonical_root/.test(executePayloadSource) &&
    /if \(cwd !== '\.'\)/.test(nodeHostSource) &&
    /const workspaceRoot = workspaceUnavailable \? undefined : process\.cwd\(\)/.test(
      nodeHostSource,
    ) &&
    /acquireRootLease\(workspaceRoot\)/.test(nodeHostSource) &&
    /executeBoundWorkspaceOperation/.test(nodeHostSource) &&
    /const VIRTUAL_WORKSPACE_ROOT = '\/__offisim_workspace__'/.test(taskBashRegistrySource),
  'execute runs must use the inherited process cwd only as root lease provenance while all file tools mount the fixed virtual workspace and cross the Rust bridge',
);
assert(
  /"employeeId": req\.employee_id/.test(executePayloadSource),
  'execute sidecar payload must forward employeeId so publish-artifact and mission-bridge events keep employee attribution',
);
assert(
  /delegation_limits: Option<serde_json::Value>/.test(rustHostSource) &&
    /if let Some\(delegation_limits\)[\s\S]*\.insert\("delegationLimits"\.into\(\), delegation_limits\.clone\(\)\)/.test(
      executePayloadSource,
    ) &&
    /delegationLimits: input\.delegationLimits/.test(desktopAgentRuntimeSource),
  'optional delegationLimits must cross renderer → opaque Rust → Node without appearing on absent plain-chat requests',
);
assert(
  /'\.claude\/skills'/.test(projectSkillsSource) &&
    /'\.agents\/skills'/.test(projectSkillsSource) &&
    /'\.opencode\/skills'/.test(projectSkillsSource) &&
    /invokeCommand\('project_list_dir'/.test(projectSkillsSource) &&
    /invokeCommand\('project_read_file'/.test(projectSkillsSource) &&
    !/~\/\.claude\/skills|home_dir|runtime_vault/.test(projectSkillsSource),
  'Project skill discovery must use only the three repository roots through sandboxed Project commands',
);
assert(
  /let skill_paths = has_workspace/.test(executePayloadSource) &&
    /"skillPaths": skill_paths/.test(executePayloadSource) &&
    /resolve_project_skill_paths/.test(executePayloadSource) &&
    /"projectSkillPaths": project_skill_paths/.test(executePayloadSource) &&
    /additionalSkillPaths: skillPaths/.test(nodeHostSource) &&
    /additionalSkillPaths: skillPaths/.test(childSupervisorSource) &&
    /additionalSkillPaths: skillPaths/.test(bundledNodeHostSource) &&
    /repos\.skills\.listByCompany\(companyId\)/.test(desktopRuntimeScopeSource) &&
    /skillPaths: skillPathsForEmployee\(e\.employee_id\)/.test(desktopRuntimeScopeSource) &&
    /projectSkillPaths/.test(desktopRuntimeScopeSource),
  'vault-authoritative company + employee skills and sandbox-resolved Project skills must cross the renderer/Rust wire and reach Pi native resource loaders for root and child sessions',
);
assert(
  !/"companyId": req\.company_id/.test(executePayloadSource),
  'execute sidecar payload must not emit companyId because the Node execute host has no companyId consumer',
);
assert(
  /fn collaborate_payload\([\s\S]*agent_dir: Option<&Path>/.test(collaboratePayloadSource) &&
    !/"companyId": req\.company_id|"capabilityProfile": req\.capability_profile/.test(
      collaboratePayloadSource,
    ),
  'collaboration payload must be AppHandle-free and omit companyId/capabilityProfile fields that the Node host does not consume',
);
assert(
  /payload = decodePiRequestPayload\(payload\)/.test(nodeHostSource) &&
    /export function decodePiRequestPayload/.test(wireSource),
  'the production Node entrypoint must pass execute/enhance/collaborate payloads through the shared request decoder',
);
assert(
  /const projectId = asNonEmptyString\(payload\.projectId\)/.test(nodeHostSource),
  'execute host must declare projectId from the run payload before delegating (a bare projectId reference throws "projectId is not defined")',
);
assert(
  /"workspaceRequirement": req\.workspace_requirement\.as_str\(\)/.test(executePayloadSource) &&
    /"workspaceAvailability": workspace_availability/.test(executePayloadSource) &&
    /"workspaceUnavailableReasonCode": workspace_unavailable_reason_code/.test(
      executePayloadSource,
    ) &&
    /workspaceRequirement/.test(wireSource) &&
    /workspaceAvailability/.test(wireSource) &&
    /workspaceUnavailableReasonCode/.test(wireSource),
  'execute request wire must carry the required/optional workspace policy and exact bound/unavailable resolution',
);
assert(
  /const tools = workspaceUnavailable\s*\? \[PROJECT_WORKSPACE_REQUIRED_TOOL\]/.test(
    nodeHostSource,
  ) &&
    /workspaceUnavailable \? \{ noTools: 'builtin' \} : \{\}/.test(nodeHostSource) &&
    /noExtensions: true,[\s\S]*noSkills: true,[\s\S]*noContextFiles: true/.test(nodeHostSource) &&
    /createProjectWorkspaceRequiredExtensionFactory\(workspaceState\.reasonCode\)/.test(
      nodeHostSource,
    ) &&
    /assertWorkspaceToolAllowed\(workspaceUnavailable, event\.toolName\)/.test(nodeHostSource) &&
    /const tools = \w+\s*\? \[\w+\]/.test(bundledNodeHostSource) &&
    /noTools:\s*"builtin"/.test(bundledNodeHostSource),
  'workspace-unavailable execute must retain the same host path while exposing only project_workspace_required and disabling built-ins/resources',
);
assert(
  /if is_resume/.test(workspaceRequirementGateSource) &&
    /req\.direct_delegation\.is_some\(\)/.test(workspaceRequirementGateSource) &&
    /req\.mission_context_json\.is_some\(\)/.test(workspaceRequirementGateSource) &&
    /workspaceRequirement must be required/.test(workspaceRequirementGateSource) &&
    /TaskWorkspaceResolution::Unavailable\(unavailable\)[\s\S]*if req\.workspace_requirement\.is_optional\(\)/.test(
      rustRunSource,
    ),
  'host must reject hostile optional downgrades for resume, direct delegation, and Missions before permitting an unavailable run',
);
const unavailableEventIndex = unavailableExecuteSource.indexOf('publish_workspace_unavailable(');
const unavailableNeutralCwdIndex = unavailableExecuteSource.indexOf('let cwd = neutral_cwd(app)?');
const unavailableSidecarIndex = unavailableExecuteSource.indexOf('run_pi_sidecar_jsonl(');
const unavailablePublisherSource = rustRunSource.slice(
  rustRunSource.indexOf('fn publish_workspace_unavailable'),
  rustRunSource.indexOf('async fn do_execute'),
);
assert(
  unavailableEventIndex >= 0 &&
    unavailableEventIndex < unavailableNeutralCwdIndex &&
    unavailableNeutralCwdIndex < unavailableSidecarIndex &&
    /PiAgentHostEvent::WorkspaceUnavailable/.test(unavailablePublisherSource) &&
    /publish_host_event\(/.test(unavailablePublisherSource),
  'workspaceUnavailable must be published before neutral cwd setup and before any sidecar started/message/tool event can exist',
);

const normalizeWorkspaceForHarness = Function(
  `${extractNamedFunction(nodeHostSource, 'normalizeExecuteWorkspace')}; return normalizeExecuteWorkspace;`,
)();
assert(
  normalizeWorkspaceForHarness({
    workspaceRequirement: 'required',
    workspaceAvailability: 'bound',
    workspaceUnavailableReasonCode: null,
  }).availability === 'bound',
  'bound workspace state must validate',
);
for (const [packet, expectedCode] of [
  [
    {
      workspaceRequirement: 'optional',
      workspaceAvailability: 'unavailable',
      workspaceUnavailableReasonCode: 'ambiguous',
    },
    undefined,
  ],
  [
    {
      workspaceRequirement: 'required',
      workspaceAvailability: 'unavailable',
      workspaceUnavailableReasonCode: 'none',
    },
    'project-workspace-required',
  ],
  [
    {
      workspaceRequirement: 'optional',
      workspaceAvailability: 'unavailable',
      workspaceUnavailableReasonCode: 'guessed',
    },
    'invalid-request',
  ],
]) {
  if (!expectedCode) {
    assert(
      normalizeWorkspaceForHarness(packet).reasonCode === 'ambiguous',
      'optional unavailable state must preserve its exact blocker reason',
    );
    continue;
  }
  let code;
  try {
    normalizeWorkspaceForHarness(packet);
  } catch (error) {
    code = error?.code;
  }
  assert(code === expectedCode, `workspace state must fail with ${expectedCode}`);
}

const createWorkspaceRequiredForHarness = Function(
  'PROJECT_WORKSPACE_REQUIRED_TOOL',
  'ProjectWorkspaceRequiredParams',
  `${extractNamedFunction(nodeHostSource, 'createProjectWorkspaceRequiredExtensionFactory')}; return createProjectWorkspaceRequiredExtensionFactory;`,
)('project_workspace_required', {});
let workspaceRequiredTool;
createWorkspaceRequiredForHarness('none')({
  registerTool(tool) {
    workspaceRequiredTool = tool;
  },
});
assert(
  workspaceRequiredTool?.name === 'project_workspace_required',
  'unavailable workspace control extension must register its one deterministic tool',
);
const workspaceRequiredResult = await workspaceRequiredTool.execute();
assert(
  workspaceRequiredResult.content?.[0]?.text.includes('reason=none') &&
    workspaceRequiredResult.content[0].text.includes('restore or reselect'),
  'project_workspace_required must return the explicit no-candidate blocker and recovery action',
);
assert(
  /function normalizeDelegationLimitOverrides\(value\)/.test(nodeHostSource) &&
    /Number\.isSafeInteger\(requested\)/.test(nodeHostSource) &&
    /Math\.min\(requested, DELEGATION_DEFAULTS\[key\]\)/.test(nodeHostSource) &&
    /delegationLimitOverrides === undefined[\s\S]*createDelegationLimits\(\)[\s\S]*createDelegationLimits\(delegationLimitOverrides\)/.test(
      nodeHostSource,
    ) &&
    /Number\.isSafeInteger\(requested\)/.test(bundledNodeHostSource) &&
    /Math\.min\(requested, DELEGATION_DEFAULTS\w*\[key\]\)/.test(bundledNodeHostSource),
  'source and bundled Pi hosts must accept only positive integer delegation caps, clamp them to host defaults, and preserve the default constructor for absent/invalid packets',
);

const delegationDefaults = Function(
  `return (${extractObjectLiteral(childSupervisorSource, 'export const DELEGATION_DEFAULTS')});`,
)();
const normalizeDelegationLimits = Function(
  'DELEGATION_DEFAULTS',
  'DELEGATION_LIMIT_KEYS',
  `${extractNamedFunction(nodeHostSource, 'normalizeDelegationLimitOverrides')}; return normalizeDelegationLimitOverrides;`,
)(delegationDefaults, [
  'maxDepth',
  'maxParallelPerDelegation',
  'maxTotalChildren',
  'maxTotalTokens',
]);
const buildDelegationLimits = Function(
  'DELEGATION_DEFAULTS',
  `${extractNamedFunction(childSupervisorSource, 'createDelegationLimits')}; return createDelegationLimits;`,
)(delegationDefaults);

assert(
  normalizeDelegationLimits(undefined) === undefined,
  'absent delegationLimits must preserve the host default path',
);
const validDelegationOverrides = normalizeDelegationLimits({
  maxDepth: 1,
  maxParallelPerDelegation: 99,
  maxTotalChildren: 8,
  maxTotalTokens: 90_000,
});
assert(
  validDelegationOverrides?.maxDepth === 1 &&
    validDelegationOverrides.maxParallelPerDelegation ===
      delegationDefaults.maxParallelPerDelegation &&
    validDelegationOverrides.maxTotalChildren === 8 &&
    validDelegationOverrides.maxTotalTokens === 90_000,
  'valid delegation limits must tighten values below defaults and clamp values above defaults',
);
const effectiveDelegationLimits = buildDelegationLimits(validDelegationOverrides);
assert(
  effectiveDelegationLimits.maxDepth === 1 &&
    effectiveDelegationLimits.maxParallelPerDelegation ===
      delegationDefaults.maxParallelPerDelegation &&
    effectiveDelegationLimits.maxTotalChildren === 8 &&
    effectiveDelegationLimits.maxTotalTokens === 90_000,
  'normalized overrides must reach createDelegationLimits unchanged',
);

const sharedConcurrency = buildDelegationLimits({
  maxParallelPerDelegation: 2,
  maxTotalChildren: 8,
  maxTotalTokens: 100,
});
assert(await sharedConcurrency.acquireConcurrency('branch-a'), 'first branch gets a global lease');
assert(await sharedConcurrency.acquireConcurrency('branch-b'), 'second branch gets a global lease');
let thirdBranchStarted = false;
const thirdBranch = sharedConcurrency.acquireConcurrency('branch-c').then((acquired) => {
  thirdBranchStarted = acquired;
  return acquired;
});
await Promise.resolve();
assert(!thirdBranchStarted, 'a third recursive branch queues behind the shared tree cap');
sharedConcurrency.releaseConcurrency('branch-a');
assert(await thirdBranch, 'releasing any branch admits the next global waiter');
assert(sharedConcurrency.concurrencyInUse() === 2, 'global active-agent count never exceeds two');
assert(
  sharedConcurrency.suspendConcurrency('branch-b'),
  'a delegating parent suspends its lease while descendants run',
);
assert(
  await sharedConcurrency.acquireConcurrency('grandchild'),
  'a grandchild uses the parent slot',
);
sharedConcurrency.releaseConcurrency('grandchild');
assert(
  await sharedConcurrency.resumeConcurrency('branch-b'),
  'the parent reacquires before resuming',
);
sharedConcurrency.recordTokens({ input: 10, output: 0, turns: 1 });
sharedConcurrency.recordTokens({ input: 1_000, output: 0, turns: 1 });
assert(sharedConcurrency.usage().input === 1_010, 'root and child usage share one budget ledger');
assert(sharedConcurrency.budgetExceeded(), 'combined tree usage exhausts maxTotalTokens');
sharedConcurrency.releaseConcurrency('branch-b');
sharedConcurrency.releaseConcurrency('branch-c');
for (const invalidPacket of [
  null,
  [],
  { maxDepth: 0 },
  { maxDepth: -1 },
  { maxDepth: 1.5 },
  { maxDepth: '1' },
  { maxDepth: 1, maxTotalTokens: 0 },
  { maxDepth: 1, childTimeoutMs: 1 },
]) {
  assert(
    normalizeDelegationLimits(invalidPacket) === undefined,
    `invalid delegation-limit packet must be ignored as a whole: ${JSON.stringify(invalidPacket)}`,
  );
}
assert(
  /const projectId = asNonEmptyString\w*\(payload\.projectId\)/.test(bundledNodeHostSource),
  'bundled Pi Agent host must also declare projectId from the run payload — rebuild with pnpm build:pi-agent-host',
);
assert(
  /const baseTools = workspaceUnavailable \? \[\] : toolAllowlistForMode\(permissionMode\)/.test(
    nodeHostSource,
  ) &&
    /const scopedMcpTools =[\s\S]*permissionMode === 'plan'[\s\S]*mcpTools\.filter\(\(tool\) => !isWriteMcpTool\(tool\)\)[\s\S]*: mcpTools/.test(
      nodeHostSource,
    ) &&
    /const mcpHasCatalog = scopedMcpTools\.length > 0/.test(nodeHostSource) &&
    /const tools = workspaceUnavailable[\s\S]*PROJECT_WORKSPACE_REQUIRED_TOOL[\s\S]*\.\.\.baseTools[\s\S]*'mcp_search_tools',[\s\S]*'mcp_describe_tool'[\s\S]*\.\.\.\(mcpHasCatalog \? \['mcp_call'\] : \[\]\)/.test(
      nodeHostSource,
    ) &&
    /export const WORK_TOOL_ALLOWLIST[\s\S]*'read'[\s\S]*'write'[\s\S]*'edit'[\s\S]*'grep'[\s\S]*'find'[\s\S]*'ls'[\s\S]*'bash'/.test(
      permissionModesSource,
    ),
  'bound execute hosts must expose MCP discovery in the explicit allowlist, while workspace-unavailable turns expose only their deterministic control tool',
);
assert(
  /permissionMode,\s*resolveModel/.test(nodeHostSource) &&
    /bindChildUi:\s*\(session\)[\s\S]*session\.bindExtensions/.test(nodeHostSource) &&
    /const permissionMode = normalizePermissionMode\(ctx\.permissionMode\)/.test(
      childSupervisorSource,
    ) &&
    /ctx\.buildPermissionGate\(permissionMode\)/.test(childSupervisorSource) &&
    /permissionMode === 'ask' && ctx\.bindChildUi/.test(childSupervisorSource),
  'delegated children must inherit the root permission mode and bind Ask approvals to the existing renderer UI channel',
);
assert(
  /No MCP tools are granted to you yet/.test(mcpBridgeSource) &&
    /No MCP tools are granted to you yet/.test(bundledNodeHostSource),
  'source and bundled MCP bridge must return an actionable "no tools granted" setup state for an empty catalog (screenshot-1 apology fix) — rebuild the bundle with pnpm build:pi-agent-host',
);
assert(
  /const scopedGrants = grants\.filter/.test(desktopRuntimeScopeSource) &&
    /requestSurface:\s*[\s\S]*server\.requestSurface[\s\S]*: 'settings'/.test(
      desktopRuntimeScopeSource,
    ) &&
    /if \(!server\) \{[\s\S]*continue;[\s\S]*\}/.test(desktopRuntimeScopeSource) &&
    /catch \{[\s\S]*return \[\];[\s\S]*\}/.test(desktopRuntimeScopeSource),
  'desktop buildMcpScope must connect registered MCP servers with their approved surface and expose only ready tools',
);
assert(
  /PI_HOST_PROTOCOL_VERSION = 14/.test(wireSource) &&
    /PI_HOST_PROTOCOL_VERSION: u32 = 14/.test(rustHostSource) &&
    /'worktreeCall'/.test(wireSource) &&
    /WorktreeCall/.test(rustHostSource) &&
    /'verifyCall'/.test(wireSource) &&
    /VerifyCall/.test(rustHostSource),
  'F2 must keep the Pi host wire version current and decode worktreeCall on both Node and Rust sides',
);
assert(
  /'lifecycle'/.test(wireSource) &&
    /Lifecycle \{/.test(rustHostSource) &&
    /event\.kind === 'lifecycle'/.test(desktopAgentRuntimeSource),
  'wire v11 must decode lifecycle events on Node, Rust, and renderer sides',
);
assert(
  /ROOT_CONTROL_CUSTOM_TYPE = 'offisim\.control'/.test(nodeHostSource) &&
    /createHash\('sha256'\)/.test(nodeHostSource) &&
    /session\.sendCustomMessage\(message, \{ deliverAs: control\.action, triggerTurn: true \}\)/.test(
      nodeHostSource,
    ) &&
    /hydrateRootControlLedger\(sessionManager, rootRunId\)/.test(nodeHostSource) &&
    /message\.action === 'reattach'/.test(nodeHostSource) &&
    nodeHostSource.indexOf(
      'await session.sendCustomMessage(message, { deliverAs: control.action, triggerTurn: true });',
    ) < nodeHostSource.indexOf("emitControlState(acceptedControl, 'accepted');") &&
    /controlId: message\.id/.test(desktopAgentRuntimeSource),
  'steer/follow-up must durably journal before ACK and use SHA-256 reattach dedupe',
);
assert(
  /let activeControlSession = null/.test(nodeHostSource) &&
    /rootControlsOpen = true;[\s\S]*?directSupervisor\.runSingleWithMetadata/.test(
      nodeHostSource,
    ) &&
    /onControlSessionReady/.test(nodeHostSource) &&
    /onControlMessage: consumeRootControlMessage/.test(nodeHostSource) &&
    /ctx\.onControlSessionReady\?\.\(runId, session\)/.test(childSupervisorSource) &&
    /event\.message\?\.role === 'custom'[\s\S]*?ctx\.onControlMessage/.test(
      childSupervisorSource,
    ) &&
    /ctx\.onControlSessionClosed\?\.\(runId, session\)/.test(childSupervisorSource) &&
    /activeControlSession/.test(bundledNodeHostSource) &&
    /onControlSessionReady/.test(bundledNodeHostSource),
  'direct delegation must bind its live child session to the existing durable steer channel in source and bundle',
);
assert(
  /deferIntegration: directDelegation\.deferIntegration === true/.test(nodeHostSource) &&
    /options\.deferIntegration === true/.test(childSupervisorSource) &&
    /runTask\(task, signal, options\)/.test(childSupervisorSource) &&
    /maybeIntegrateWrites\([\s\S]*options\.deferIntegration === true/.test(
      childSupervisorSource,
    ) &&
    /confirmIntegration: retainForReview \? undefined : ctx\.confirmIntegration/.test(
      childSupervisorSource,
    ) &&
    /options\.deferIntegration === true[\s\S]*do not stage, commit, amend, merge, rebase, switch branches, or create branches/.test(
      childSupervisorSource,
    ) &&
    /deferIntegration/.test(bundledNodeHostSource) &&
    /if \(!directResult\.completed\)/.test(nodeHostSource) &&
    /direct-delegation-failed/.test(nodeHostSource),
  'competitive Pi direct delegation must retain its isolated lease and reject failed child terminals',
);
assert(
  /"images": req\.images/.test(executePayloadSource) &&
    /images: input\.images\?\.length \? input\.images : null/.test(desktopAgentRuntimeSource) &&
    /session\.prompt\(text, promptImages\.length > 0 \? \{ images: promptImages \}/.test(
      nodeHostSource,
    ),
  'native image attachments must cross renderer, Rust payload, and Pi prompt unchanged',
);
assert(
  /snapshot\?\.terminal\?\.status === 'aborted'/.test(desktopAgentRuntimeSource) &&
    /StopLostTerminalRaceError/.test(desktopAgentRuntimeSource) &&
    /const pendingAbortDecision = this\.abortDecisionByRequest\.get\(requestId\);/.test(
      desktopAgentRuntimeSource,
    ) &&
    desktopAgentRuntimeSource.indexOf('const pendingAbortDecision =') <
      desktopAgentRuntimeSource.indexOf(
        '...requireRootResultProvenance(',
      ) &&
    /if \(this\.abortedRequests\.has\(requestId\)\) \{[\s\S]*?this\.persistRootTerminal\(\s*runScope\.runId,\s*'cancelled'/.test(
      desktopAgentRuntimeSource,
    ) &&
    /releaseRetainedStream\(requestId\)/.test(desktopAgentRuntimeSource),
  'Stop requires an authoritative aborted snapshot, joins arbitration before result provenance, and releases retained streams only after settlement',
);
assert(
  /roster\.flatMap\(\(entry\) =>/.test(desktopAgentRuntimeSource) &&
    /resolveRuntimeExecutionSelection\([\s\S]*employeeModel/.test(desktopAgentRuntimeSource) &&
    /childSelection\.target\.engineId !== executionTarget\?\.engineId[\s\S]*return \[\];/.test(
      desktopAgentRuntimeSource,
    ),
  'Pi delegation must omit employees bound to another engine/account lane without rejecting the root run',
);
assert(
  /createWorktreeCallChannel/.test(nodeHostSource) &&
    /createWorkspaceLeaseManager/.test(nodeHostSource) &&
    /leaseManager/.test(nodeHostSource) &&
    /now:\s*\(\)\s*=>/.test(nodeHostSource) &&
    /newId:\s*\(\)\s*=>/.test(nodeHostSource) &&
    /confirmIntegration/.test(nodeHostSource),
  'execute host must run the workspace lease manager host-side and gate integration review',
);
assert(
  /handle_worktree_call/.test(rustHostSource) &&
    /run_git_validated/.test(rustHostSource) &&
    /write_worktree_result/.test(rustHostSource),
  'Rust Pi host must intercept worktreeCall and answer with worktreeResult through stdin',
);
assert(
  /executeBoundCommand/.test(nodeHostSource) &&
    /requestWorktreeResult\(\s*'executeBash'/.test(nodeHostSource) &&
    /if \(!executeBoundCommand\)/.test(taskBashRegistrySource) &&
    !/\bspawn\s*\(/.test(taskBashRegistrySource) &&
    !/node:child_process/.test(taskBashRegistrySource) &&
    /taskWorkspaceLease && cwd === '\.'/m.test(taskBashRegistrySource) &&
    /cwd !== '\.' && \(!taskWorkspaceLease \|\| taskWorkspaceLease\.cwd !== cwd\)/.test(
      taskBashRegistrySource,
    ) &&
    /requestWorktreeResult\(\s*'validateCwd'/.test(nodeHostSource) &&
    /resolve_registered_workspace_process_cwd_exact/.test(rustHostSource) &&
    /execute_trusted_task_bash/.test(rustHostSource) &&
    /lease\.isolate[d]? \? lease\.cwd : ctx\.cwd/.test(childSupervisorSource) &&
    /validateLeaseCwd/.test(childSupervisorSource),
  'all task Bash must cross the Rust bridge; root/shared retain dot cwd without a claim and isolated children carry the exact registered claim',
);
{
  // The Task Board recognizes the in-chat review approval card ONLY by its title
  // string; if either side drifts, the board silently bypasses the live approval
  // and double-drives the lease pipeline. Lock the literal on both sides.
  const leaseActionsSource = readFileSync(
    'apps/desktop/renderer/src/surfaces/office/board/workspace-lease-actions.ts',
    'utf8',
  );
  const leaseDecisionCoordinatorSource = readFileSync(
    'apps/desktop/renderer/src/surfaces/office/board/workspace-lease-decision-coordinator.ts',
    'utf8',
  );
  const permissionApprovalSource = readFileSync(
    'apps/desktop/renderer/src/assistant/parts/PermissionApprovalBar.tsx',
    'utf8',
  );
  const boardStageSource = [
    readFileSync('apps/desktop/renderer/src/surfaces/office/board/BoardStage.tsx', 'utf8'),
    readFileSync('apps/desktop/renderer/src/surfaces/office/board/BoardCard.tsx', 'utf8'),
    readFileSync('apps/desktop/renderer/src/surfaces/office/board/BoardDrawer.tsx', 'utf8'),
  ].join('\n');
  const reviewWorkbenchStageSource = readFileSync(
    'apps/desktop/renderer/src/surfaces/office/board/ReviewWorkbenchStage.tsx',
    'utf8',
  );
  assert(
    nodeHostSource.includes('`Review delegated work ${mergeable[0]?.leaseId'),
    'execute host must title the integration approval "Review delegated work <leaseId>" — the Task Board matches this exact title',
  );
  assert(
    leaseActionsSource.split('`Review delegated work ${row.leaseId}`').length === 3,
    'workspace-lease-actions must match the approval card by the exact "Review delegated work <leaseId>" title in both review and request-changes paths',
  );
  assert(
    /workspaceLeaseIdFromApprovalTitle/.test(permissionApprovalSource) &&
      /reviewWorkspaceLease\(\s*leaseReview,\s*companyId/.test(permissionApprovalSource) &&
      /openBoard\('board'\)/.test(permissionApprovalSource) &&
      /highlightBoardRun\(leaseReview\.rootRunId\)/.test(permissionApprovalSource) &&
      /isLeaseReview\s*\? leaseReview !== null/.test(permissionApprovalSource) &&
      /stale && !isLeaseReview/.test(permissionApprovalSource) &&
      /isLeaseReview && leaseDecisionComplete/.test(permissionApprovalSource) &&
      /pendingLeaseAction !== null/.test(permissionApprovalSource) &&
      /const outcome = await reviewWorkspaceLease/.test(permissionApprovalSource) &&
      /queryKey: \['workspace-lease-reviews'\]/.test(permissionApprovalSource),
    'the pending-review permission notice must use the Board lease decision channel, stay actionable after restart, open the matching Board drawer, and refresh every active Board scope',
  );
  assert(
    /leaseDecisionById\.run/.test(leaseActionsSource) &&
      /interface InFlightDecision<Outcome>[\s\S]*action: WorkspaceLeaseDecisionAction;[\s\S]*promise: Promise<Outcome>/.test(
        leaseDecisionCoordinatorSource,
      ) &&
      /if \(active\) return active\.promise/.test(leaseDecisionCoordinatorSource) &&
      /persisted === 'merged' \|\| persisted === 'discarded'/.test(leaseActionsSource),
    'workspace lease decisions must record the in-flight action, return its actual outcome to conflicting entries, and short-circuit terminal leases',
  );
  assert(
    /toastLeaseOutcomes\(succeeded\.map\(\(result\) => result\.outcome\)\)/.test(
      boardStageSource,
    ) &&
      /hasPendingDecision\(selectedLeases\)/.test(boardStageSource) &&
      /pendingAction !== null/.test(reviewWorkbenchStageSource) &&
      /const outcome = await reviewWorkspaceLease/.test(reviewWorkbenchStageSource) &&
      /outcome === 'discarded'/.test(reviewWorkbenchStageSource),
    'Board, compact approval, and workspace review entries must disable on shared pending state and report persisted outcomes rather than requested actions',
  );
  assert(
    /highlightedRow\.projectId === projectId \? 'project' : 'company'/.test(boardStageSource),
    'a pending-review jump must select the Board scope containing the highlighted request before opening its drawer',
  );
  assert(
    /rowLeases\.some\(\(lease\) => lease\.status === 'active'\)/.test(boardStageSource) &&
      /Stop the active task before discarding this request\./.test(boardStageSource) &&
      /\['pending_review', 'failed'\]\.includes\(lease\.status\)/.test(boardStageSource) &&
      /disabled=\{busy \|\| hasActiveLease\}/.test(boardStageSource) &&
      /typeof error === 'string' && error\.trim\(\)/.test(boardStageSource) &&
      /detail\.includes\('still owned by an active task'\)/.test(boardStageSource),
    'Board discard must fail closed while its projected lease is active and keep retained review cleanup actionable',
  );
}
assert(
  /finalAssistant\?\.stopReason === 'error'/.test(nodeHostSource) &&
    /normalizePiErrorMessage/.test(nodeHostSource) &&
    /code:\s*'upstream'/.test(nodeHostSource),
  'execute host must surface Pi model error stops as upstream failures instead of empty completed replies',
);
assert(
  /The selected AI account has no usable credential for this model/.test(nodeHostSource) &&
    !/Sign in through Pi Agent/.test(nodeHostSource) &&
    !/Pi Agent model returned an error stop/.test(nodeHostSource),
  'ordinary missing-credential guidance must use the neutral AI Accounts product surface',
);
assert(
  /get rootModel\(\)[\s\S]*return effectiveRootModel/.test(nodeHostSource) &&
    /effectiveRootModel = session\.model \?\? model/.test(nodeHostSource) &&
    /rootThinkingLevel:\s*thinkingLevel/.test(nodeHostSource) &&
    /function resolveEmployeeBinding\(employee\)/.test(childSupervisorSource) &&
    /resolveChildExecutionBinding\(\{/.test(childSupervisorSource) &&
    /executionTargetDigest\(requestedTarget, requestedRuntimeModelRef\)/.test(
      childSupervisorSource,
    ) &&
    /for \(const key of \['engineId', 'accountId', 'billingMode'\]\)/.test(childSupervisorSource) &&
    /expectedTarget:\s*binding\.expectedTarget/.test(childSupervisorSource) &&
    /runtimeModelRef:\s*binding\.runtimeModelRef/.test(childSupervisorSource) &&
    /\.\.\.\(thinkingLevel \? \{ thinkingLevel \} : \{\}\)/.test(childSupervisorSource),
  'delegated children must inherit the frozen root target or prove an exact same-account override before prompt',
);
assert(
  /const roster = !workspaceUnavailable && Array\.isArray\(payload\.roster\)/.test(
    nodeHostSource,
  ) && !/delete rest\.model/.test(nodeHostSource),
  'execute host must preserve catalog-proven roster bindings for fail-closed child validation',
);
assert(
  /function resolveEmployeeBinding\(employee\)/.test(bundledNodeHostSource) &&
    /function resolveChildExecutionBinding\(/.test(bundledNodeHostSource) &&
    /expectedTarget:\s*binding\.expectedTarget/.test(bundledNodeHostSource) &&
    /runtimeModelRef:\s*binding\.runtimeModelRef/.test(bundledNodeHostSource) &&
    /rootThinkingLevel:\s*thinkingLevel/.test(bundledNodeHostSource) &&
    /thinkingLevel:\s*thinkingLevel2/.test(bundledNodeHostSource),
  'bundled API adapter host must carry exact child target and model binding validation',
);
assert(
  /let roster = has_workspace/.test(executePayloadSource) &&
    /"roster": roster/.test(executePayloadSource) &&
    /const model = e\.model\?\.trim\(\)/.test(desktopRuntimeScopeSource) &&
    /model && thinkingLevel \? \{ thinkingLevel \} : \{\}/.test(desktopRuntimeScopeSource),
  'employee model/thinking fields must cross renderer roster projection and opaque Rust roster forwarding',
);
assert(
  /finalAssistant\?\.stopReason === 'error'/.test(childSupervisorSource) &&
    /Child completed without assistant output/.test(childSupervisorSource),
  'delegated children must fail provider errors and empty outputs instead of reporting completed no-output work',
);
assert(
  /an Orchestrator must never delegate a task to itself/.test(nodeHostSource) &&
    /Executors are/.test(nodeHostSource) &&
    /Use a Reviewer for independent diff review/.test(nodeHostSource) &&
    /entry\.displayTitle/.test(delegationExtensionSource),
  'delegation guidance must expose and enforce Orchestrator / Executor / Reviewer responsibilities',
);
assert(
  /providerStatusById/.test(nodeHostSource) &&
    /configuredProviderStatus/.test(nodeHostSource) &&
    /providerStatusById/.test(bundledNodeHostSource) &&
    /configuredProviderStatus/.test(bundledNodeHostSource),
  'source and bundled Pi Agent hosts must expose configured provider fallback for malformed registry entries',
);
// Typed failure kinds (I1): the supervisor may only emit run.failed through the
// blocked()/failed() helpers, which validate the typed failureKind at the emit
// boundary (assertRunFailureKind throws on a missing/unknown kind) — no failure
// path can forget it, and nothing downstream keyword-parses the summary. Lock
// the mechanism (exactly two helper-owned emits, each validated), not per-site
// payload shapes.
const supervisorRunFailedEmits =
  childSupervisorSource.match(/emit\w*\(["']run\.failed["'],\s*\{[^}]*/g) ?? [];
assert(
  supervisorRunFailedEmits.length === 2 &&
    supervisorRunFailedEmits.every((payload) => payload.includes('failureKind')) &&
    /function failed\(emit\w*, failureKind[\s\S]{0,200}?assertRunFailureKind\(failureKind\)/.test(
      childSupervisorSource,
    ) &&
    /function blocked\(emit\w*, reason, failureKind[\s\S]{0,200}?assertRunFailureKind\(failureKind\)/.test(
      childSupervisorSource,
    ),
  'child supervisor must route every run.failed through the validated blocked()/failed() helpers',
);
// The emit-boundary validator and the emitter-side classifier are behaviorally
// checked here (the wire module is dependency-free, safe to import).
assert(
  RUN_FAILURE_KINDS.length === 6 &&
    ['token', 'budget', 'permission', 'context', 'runtime', 'tool'].every((kind) =>
      RUN_FAILURE_KINDS.includes(kind),
    ),
  'RUN_FAILURE_KINDS must mirror the six-kind RunFailureKind union',
);
for (const [message, expected] of [
  ['maximum context length exceeded: 131072 tokens', 'context'],
  ['prompt is too long for the model window', 'context'],
  ['rate limit reached (429), retry later', 'token'],
  ['insufficient token quota for this request', 'token'],
  ['permission denied by provider policy', 'permission'],
  ['401 unauthorized', 'permission'],
  ['provider disconnected mid-stream', 'runtime'],
  ['', 'runtime'],
]) {
  assert(
    classifyRunFailure(message) === expected,
    `classifyRunFailure(${JSON.stringify(message)}) must be '${expected}', got '${classifyRunFailure(message)}'`,
  );
}
// The bundler may suffix-rename identifiers (emit2, …); match loosely.
const bundledRunFailedEmits =
  bundledNodeHostSource.match(/emit\w*\(["']run\.failed["'],\s*\{[^}]*/g) ?? [];
assert(
  bundledRunFailedEmits.length === 2 &&
    bundledRunFailedEmits.every((payload) => payload.includes('failureKind')),
  'bundled Pi Agent host must route run.failed through the typed-failureKind helpers — rebuild with pnpm build:pi-agent-host',
);

const tempAgentDir = mkdtempSync(join(tmpdir(), 'offisim-pi-agent-host-'));
writeFileSync(
  join(tempAgentDir, 'models.json'),
  `{
    // Pi models.json accepts JSONC comments and trailing commas.
    "providers": {
      "local-test": {
        "name": "Local Test",
        "baseUrl": "http://127.0.0.1:11434/v1",
        "api": "openai-completions",
        "apiKey": "test",
        "headers": { "x-keep": "provider" },
        "compat": { "mode": "fixture" },
        "authHeader": true,
        "models": [
          {
            "id": "fixture-model",
            "name": "Fixture Model",
            "api": "openai-completions",
            "contextWindow": 2048,
            "maxTokens": 512,
            "headers": { "x-keep": "model" },
            "compat": { "modelMode": "fixture" },
          },
        ],
        "modelOverrides": {
          "builtin-model": { "name": "Fixture override" },
        },
      },
    },
  }`,
);

let result;
try {
  result = runHost(HOST_SCRIPT, { mode: 'status', agentDir: tempAgentDir }, 'Pi Agent status host');
  assert(result.response?.ok === true, 'Pi Agent status response must be ok');
  assert(
    Array.isArray(result.response.availableModels),
    'Pi Agent status response must include availableModels from Pi ModelRegistry',
  );
  assert(
    result.response.paths?.modelsPath,
    'Pi Agent status response must expose Pi models.json path',
  );
  assert(
    result.response.modelsConfig?.exists === true &&
      result.response.modelsConfig.providers.includes('local-test') &&
      result.response.modelsConfig.modelCount === result.response.allModelCount &&
      !result.response.modelsConfig.parseError,
    'Pi Agent status response must expose the Pi ModelRegistry-loaded models.json summary',
  );
  assert(
    result.response.configuredProviderStatus?.some((account) => account.provider === 'local-test'),
    'Pi Agent diagnostics must expose configuredProviderStatus without an edit path',
  );
  assert(
    result.response.providerStatus.length > result.response.configuredProviderStatus.length,
    'configuredProviderStatus must not be the full built-in provider catalog',
  );
  assert(
    Array.isArray(result.response.providerConfigs) &&
      result.response.providerConfigs.some((config) => config.provider === 'local-test') &&
      Array.isArray(result.response.providerTemplates),
    'Pi Agent diagnostics must expose safe provider summaries and edit templates',
  );
  assert(
    !JSON.stringify({
      providerConfigs: result.response.providerConfigs,
      providerTemplates: result.response.providerTemplates,
    }).includes('"apiKey"'),
    'provider editor status must never expose raw API keys',
  );
  const invalidAgentDir = mkdtempSync(join(tmpdir(), 'offisim-pi-agent-invalid-'));
  try {
    writeFileSync(
      join(invalidAgentDir, 'models.json'),
      `{
        "providers": {
          "broken-local": {
            "name": "Broken Local",
            "baseUrl": "http://127.0.0.1:11434/v1",
            "api": "openai-completions",
            "apiKey": "test",
            "authHeader": "invalid-for-pi-schema",
            "models": [{ "id": "broken-model" }]
          }
        }
      }`,
    );
    for (const scriptPath of [HOST_SCRIPT, BUNDLED_HOST_SCRIPT]) {
      const invalidResult = runHost(
        scriptPath,
        { mode: 'status', agentDir: invalidAgentDir },
        `Pi Agent invalid-schema status host (${scriptPath})`,
      );
      assert(
        invalidResult.response.modelsConfig?.parseError &&
          invalidResult.response.configuredProviderStatus?.some(
            (provider) => provider.provider === 'broken-local',
          ),
        'Pi Agent diagnostics must report configured providers even when Pi ModelRegistry reports a schema error',
      );
    }
  } finally {
    rmSync(invalidAgentDir, { recursive: true, force: true });
  }
  assert(
    !/function stripJsoncComments/.test(nodeHostSource) &&
      !/function parseJsonc/.test(nodeHostSource),
    'Pi Agent host must not duplicate Pi ModelRegistry JSONC parsing',
  );
} finally {
  rmSync(tempAgentDir, { recursive: true, force: true });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      host: 'pi-agent',
      availableModels: result.response.availableModels.length,
      allModelCount: result.response.allModelCount,
      modelsConfig: result.response.modelsConfig,
    },
    null,
    2,
  ),
);
