import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const VIRTUAL_WORKSPACE_ROOT = '/__offisim_workspace__';
const DEFAULT_INITIALIZE_TIMEOUT_MS = 2_500;
const DEFAULT_DIAGNOSTIC_TIMEOUT_MS = 4_000;
const DIAGNOSTIC_QUIET_MS = 600;
const MAX_DIAGNOSTICS_PER_FILE = 50;
const MAX_MESSAGE_CHARS = 1_200;
const MAX_FEEDBACK_CHARS = 12_000;

const LANGUAGE_SERVERS = Object.freeze([
  {
    id: 'typescript',
    extensions: Object.freeze(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']),
    languageIds: Object.freeze({
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.mts': 'typescript',
      '.cts': 'typescript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
    }),
    commands: Object.freeze([{ name: 'typescript-language-server', args: ['--stdio'] }]),
    rootMarkers: Object.freeze([
      'tsconfig.json',
      'jsconfig.json',
      'package.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'package-lock.json',
    ]),
    needsWorkspaceTypeScript: true,
  },
  {
    id: 'vue',
    extensions: Object.freeze(['.vue']),
    languageIds: Object.freeze({ '.vue': 'vue' }),
    commands: Object.freeze([{ name: 'vue-language-server', args: ['--stdio'] }]),
    rootMarkers: Object.freeze([
      'package.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'package-lock.json',
    ]),
  },
  {
    id: 'python',
    extensions: Object.freeze(['.py']),
    languageIds: Object.freeze({ '.py': 'python' }),
    commands: Object.freeze([
      { name: 'basedpyright-langserver', args: ['--stdio'] },
      { name: 'pyright-langserver', args: ['--stdio'] },
      { name: 'pylsp', args: [] },
    ]),
    rootMarkers: Object.freeze(['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt']),
  },
  {
    id: 'rust',
    extensions: Object.freeze(['.rs']),
    languageIds: Object.freeze({ '.rs': 'rust' }),
    commands: Object.freeze([{ name: 'rust-analyzer', args: [] }]),
    rootMarkers: Object.freeze(['Cargo.toml']),
  },
  {
    id: 'go',
    extensions: Object.freeze(['.go']),
    languageIds: Object.freeze({ '.go': 'go' }),
    commands: Object.freeze([{ name: 'gopls', args: ['serve'] }]),
    rootMarkers: Object.freeze(['go.work', 'go.mod']),
  },
  {
    id: 'clangd',
    extensions: Object.freeze(['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp']),
    languageIds: Object.freeze({
      '.c': 'c',
      '.h': 'c',
      '.cc': 'cpp',
      '.cpp': 'cpp',
      '.cxx': 'cpp',
      '.hpp': 'cpp',
    }),
    commands: Object.freeze([{ name: 'clangd', args: [] }]),
    rootMarkers: Object.freeze(['compile_commands.json', 'compile_flags.txt', 'CMakeLists.txt']),
  },
]);

const WRITE_TOOL_NAMES = new Set([
  'write',
  'edit',
  'apply_patch',
  'project_write_file',
  'project_edit_file',
]);
const PATH_KEYS = new Set(['path', 'file', 'filePath', 'file_path', 'paths', 'files']);

function clampText(value, max = MAX_MESSAGE_CHARS) {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function isFile(path, executable = false) {
  try {
    const details = await stat(path);
    if (!details.isFile()) return false;
    if (executable) await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function insideWorkspace(workspaceRoot, path) {
  const rel = relative(workspaceRoot, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function actualWorkspacePath(workspaceRoot, rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) return null;
  const trimmed = rawPath.trim();
  let candidate;
  if (trimmed === VIRTUAL_WORKSPACE_ROOT) candidate = workspaceRoot;
  else if (trimmed.startsWith(`${VIRTUAL_WORKSPACE_ROOT}/`)) {
    candidate = resolve(workspaceRoot, trimmed.slice(VIRTUAL_WORKSPACE_ROOT.length + 1));
  } else {
    candidate = isAbsolute(trimmed) ? resolve(trimmed) : resolve(workspaceRoot, trimmed);
  }
  return insideWorkspace(workspaceRoot, candidate) ? candidate : null;
}

function collectPathValues(value, out = []) {
  if (!isRecord(value)) return out;
  for (const [key, child] of Object.entries(value)) {
    if (!PATH_KEYS.has(key)) continue;
    if (typeof child === 'string') out.push(child);
    else if (Array.isArray(child)) {
      for (const entry of child) if (typeof entry === 'string') out.push(entry);
    }
  }
  return out;
}

function changedFilePathsFromTool(toolName, args, workspaceRoot) {
  if (!WRITE_TOOL_NAMES.has(String(toolName ?? '').toLowerCase())) return [];
  return [
    ...new Set(
      collectPathValues(args)
        .map((path) => actualWorkspacePath(workspaceRoot, path))
        .filter(Boolean),
    ),
  ];
}

function languageServerForPath(path) {
  const extension = extname(path).toLowerCase();
  const definition = LANGUAGE_SERVERS.find((server) => server.extensions.includes(extension));
  return definition ? { definition, extension } : null;
}

function ancestorsWithin(start, workspaceRoot) {
  const directories = [];
  let cursor = resolve(start);
  const root = resolve(workspaceRoot);
  if (!insideWorkspace(root, cursor)) return [root];
  for (;;) {
    directories.push(cursor);
    if (cursor === root) break;
    const parent = dirname(cursor);
    if (parent === cursor || !insideWorkspace(root, parent)) break;
    cursor = parent;
  }
  if (directories.at(-1) !== root) directories.push(root);
  return directories;
}

async function nearestServerRoot(filePath, workspaceRoot, markers) {
  const directories = ancestorsWithin(dirname(filePath), workspaceRoot);
  for (const directory of directories) {
    for (const marker of markers) {
      if (await isFile(join(directory, marker))) return directory;
    }
  }
  return resolve(workspaceRoot);
}

function executableNames(name) {
  return process.platform === 'win32' ? [name, `${name}.cmd`, `${name}.exe`] : [name];
}

async function findExecutable(name, filePath, workspaceRoot, env) {
  for (const directory of ancestorsWithin(dirname(filePath), workspaceRoot)) {
    for (const executable of executableNames(name)) {
      const local = join(directory, 'node_modules', '.bin', executable);
      if (await isFile(local, process.platform !== 'win32')) return local;
      const virtualEnvironment = join(directory, '.venv', 'bin', executable);
      if (await isFile(virtualEnvironment, process.platform !== 'win32')) {
        return virtualEnvironment;
      }
    }
  }
  for (const directory of String(env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)) {
    for (const executable of executableNames(name)) {
      const global = join(directory, executable);
      if (await isFile(global, process.platform !== 'win32')) return global;
    }
  }
  return null;
}

async function findWorkspaceTypeScript(filePath, workspaceRoot) {
  for (const directory of ancestorsWithin(dirname(filePath), workspaceRoot)) {
    const tsserver = join(directory, 'node_modules', 'typescript', 'lib', 'tsserver.js');
    if (await isFile(tsserver)) return tsserver;
  }
  return null;
}

function severityName(value) {
  if (value === 1) return 'error';
  if (value === 2) return 'warning';
  if (value === 3) return 'information';
  return 'hint';
}

function normalizeDiagnostic(raw) {
  const range = isRecord(raw?.range) ? raw.range : {};
  const start = isRecord(range.start) ? range.start : {};
  const end = isRecord(range.end) ? range.end : start;
  const line = Number.isInteger(start.line) ? start.line + 1 : 1;
  const column = Number.isInteger(start.character) ? start.character + 1 : 1;
  const endLine = Number.isInteger(end.line) ? end.line + 1 : line;
  const endColumn = Number.isInteger(end.character) ? end.character + 1 : column;
  const code =
    typeof raw?.code === 'string' || typeof raw?.code === 'number' ? String(raw.code) : undefined;
  const source = typeof raw?.source === 'string' ? clampText(raw.source, 80) : undefined;
  return {
    severity: severityName(raw?.severity),
    message: clampText(raw?.message || 'Language server diagnostic'),
    ...(code ? { code } : {}),
    ...(source ? { source } : {}),
    range: { start: { line, column }, end: { line: endLine, column: endColumn } },
  };
}

function diagnosticCounts(diagnostics) {
  const counts = { error: 0, warning: 0, information: 0, hint: 0 };
  for (const diagnostic of diagnostics) counts[diagnostic.severity] += 1;
  return counts;
}

function diagnosticsMessage(path, counts) {
  const parts = [];
  if (counts.error) parts.push(`${counts.error} error${counts.error === 1 ? '' : 's'}`);
  if (counts.warning) parts.push(`${counts.warning} warning${counts.warning === 1 ? '' : 's'}`);
  if (counts.information) parts.push(`${counts.information} info`);
  if (counts.hint) parts.push(`${counts.hint} hint${counts.hint === 1 ? '' : 's'}`);
  return parts.length
    ? `Diagnostics · ${path} · ${parts.join(', ')}`
    : `Diagnostics clear · ${path}`;
}

class JsonRpcConnection {
  constructor(processHandle, { initializeTimeoutMs, diagnosticTimeoutMs }) {
    this.process = processHandle;
    this.initializeTimeoutMs = initializeTimeoutMs;
    this.diagnosticTimeoutMs = diagnosticTimeoutMs;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.diagnosticWaiters = new Map();
    this.disposed = false;
    processHandle.stdout.on('data', (chunk) => this.onData(chunk));
    processHandle.once('error', () => this.fail());
    processHandle.once('exit', () => this.fail());
  }

  send(message) {
    if (this.disposed || !this.process.stdin.writable) throw new Error('LSP connection closed');
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8');
    this.process.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.process.stdin.write(body);
  }

  request(method, params, timeoutMs = this.initializeTimeoutMs) {
    const id = this.nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`LSP request timed out: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectPromise(error);
      }
    });
  }

  notify(method, params) {
    this.send({ method, params });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const lengthMatch = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(header);
      if (!lengthMatch) {
        this.fail();
        return;
      }
      const bodyLength = Number(lengthMatch[1]);
      const frameEnd = headerEnd + 4 + bodyLength;
      if (this.buffer.length < frameEnd) return;
      const body = this.buffer.subarray(headerEnd + 4, frameEnd).toString('utf8');
      this.buffer = this.buffer.subarray(frameEnd);
      try {
        this.onMessage(JSON.parse(body));
      } catch {
        this.fail();
        return;
      }
    }
  }

  onMessage(message) {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(clampText(message.error.message || 'LSP error')));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && typeof message.method === 'string') {
      let result = null;
      if (message.method === 'workspace/configuration') {
        result = Array.isArray(message.params?.items) ? message.params.items.map(() => ({})) : [];
      } else if (message.method === 'workspace/workspaceFolders') {
        result = null;
      }
      this.send({ id: message.id, result });
      return;
    }
    if (message.method !== 'textDocument/publishDiagnostics') return;
    const uri = message.params?.uri;
    const waiter = typeof uri === 'string' ? this.diagnosticWaiters.get(uri) : null;
    if (!waiter) return;
    const publishedVersion = message.params?.version;
    if (Number.isInteger(publishedVersion) && publishedVersion !== waiter.version) return;
    waiter.latest = Array.isArray(message.params?.diagnostics) ? message.params.diagnostics : [];
    if (waiter.quietTimer) clearTimeout(waiter.quietTimer);
    waiter.quietTimer = setTimeout(() => waiter.finish(waiter.latest), DIAGNOSTIC_QUIET_MS);
    waiter.quietTimer.unref?.();
  }

  async initialize(root, initializationOptions = {}) {
    const rootUri = pathToFileURL(root).href;
    await this.request('initialize', {
      processId: process.pid,
      clientInfo: { name: 'Offisim', version: 'w3-lsp' },
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: root.split(sep).at(-1) || 'workspace' }],
      capabilities: {
        workspace: { configuration: true, workspaceFolders: true },
        textDocument: { publishDiagnostics: { relatedInformation: true, versionSupport: true } },
      },
      initializationOptions,
    });
    this.notify('initialized', {});
  }

  collectDiagnostics(uri, version, publishDocument) {
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.diagnosticWaiters.delete(uri);
        rejectPromise(new Error('LSP diagnostics timed out'));
      }, this.diagnosticTimeoutMs);
      timeout.unref?.();
      const finish = (diagnostics) => {
        const waiter = this.diagnosticWaiters.get(uri);
        if (!waiter || waiter.version !== version) return;
        clearTimeout(timeout);
        if (waiter.quietTimer) clearTimeout(waiter.quietTimer);
        this.diagnosticWaiters.delete(uri);
        resolvePromise(diagnostics);
      };
      this.diagnosticWaiters.set(uri, {
        version,
        latest: [],
        quietTimer: null,
        finish,
        reject: rejectPromise,
        timeout,
      });
      try {
        publishDocument();
      } catch (error) {
        clearTimeout(timeout);
        this.diagnosticWaiters.delete(uri);
        rejectPromise(error);
      }
    });
  }

  fail() {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('LSP process exited'));
    }
    this.pending.clear();
    for (const waiter of this.diagnosticWaiters.values()) {
      clearTimeout(waiter.timeout);
      if (waiter.quietTimer) clearTimeout(waiter.quietTimer);
      waiter.reject(new Error('LSP process exited'));
    }
    this.diagnosticWaiters.clear();
    if (this.process.exitCode === null && !this.process.killed) {
      try {
        this.process.kill('SIGTERM');
      } catch {
        // A concurrent process exit is already equivalent to teardown.
      }
    }
  }

  async dispose() {
    if (this.disposed) return;
    try {
      await this.request('shutdown', null, 400);
      this.notify('exit');
    } catch {
      // Session teardown is deliberately silent.
    }
    this.disposed = true;
    this.process.kill('SIGTERM');
  }
}

export class LanguageServerManager {
  constructor({
    cwd,
    env = process.env,
    initializeTimeoutMs = DEFAULT_INITIALIZE_TIMEOUT_MS,
    diagnosticTimeoutMs = DEFAULT_DIAGNOSTIC_TIMEOUT_MS,
  }) {
    this.cwd = resolve(cwd);
    this.env = env;
    this.initializeTimeoutMs = initializeTimeoutMs;
    this.diagnosticTimeoutMs = diagnosticTimeoutMs;
    this.sessions = new Map();
    this.documentVersions = new Map();
  }

  async startSession(definition, filePath) {
    const root = await nearestServerRoot(filePath, this.cwd, definition.rootMarkers);
    const key = `${definition.id}:${root}`;
    if (this.sessions.has(key)) return this.sessions.get(key);
    const start = (async () => {
      let selected = null;
      for (const command of definition.commands) {
        const executable = await findExecutable(command.name, filePath, this.cwd, this.env);
        if (executable) {
          selected = { ...command, executable };
          break;
        }
      }
      if (!selected) return null;
      let initializationOptions = {};
      if (definition.needsWorkspaceTypeScript) {
        const tsserver = await findWorkspaceTypeScript(filePath, this.cwd);
        if (tsserver) initializationOptions = { tsserver: { path: tsserver } };
      }
      const processHandle = spawn(selected.executable, selected.args, {
        cwd: root,
        env: {
          ...this.env,
          PATH: [dirname(process.execPath), this.env.PATH].filter(Boolean).join(delimiter),
        },
        shell: false,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const connection = new JsonRpcConnection(processHandle, {
        initializeTimeoutMs: this.initializeTimeoutMs,
        diagnosticTimeoutMs: this.diagnosticTimeoutMs,
      });
      try {
        await connection.initialize(root, initializationOptions);
        return { connection, root, serverId: definition.id, openDocuments: new Set() };
      } catch {
        await connection.dispose();
        return null;
      }
    })();
    this.sessions.set(key, start);
    const session = await start;
    if (!session) this.sessions.delete(key);
    return session;
  }

  async diagnoseFile(filePath) {
    const language = languageServerForPath(filePath);
    if (!language || !(await isFile(filePath))) return { status: 'unsupported' };
    const session = await this.startSession(language.definition, filePath);
    if (!session) return { status: 'unavailable' };
    const uri = pathToFileURL(filePath).href;
    const version = (this.documentVersions.get(uri) ?? 0) + 1;
    this.documentVersions.set(uri, version);
    const text = await readFile(filePath, 'utf8');
    const languageId =
      language.definition.languageIds[language.extension] ?? language.definition.id;
    try {
      const rawDiagnostics = await session.connection.collectDiagnostics(uri, version, () => {
        if (session.openDocuments.has(uri)) {
          session.connection.notify('textDocument/didChange', {
            textDocument: { uri, version },
            contentChanges: [{ text }],
          });
        } else {
          session.openDocuments.add(uri);
          session.connection.notify('textDocument/didOpen', {
            textDocument: { uri, languageId, version, text },
          });
        }
      });
      const diagnostics = rawDiagnostics
        .slice(0, MAX_DIAGNOSTICS_PER_FILE)
        .map((diagnostic) => normalizeDiagnostic(diagnostic));
      const path = relative(this.cwd, filePath).split(sep).join('/');
      const counts = diagnosticCounts(diagnostics);
      return {
        status: 'available',
        payload: {
          path,
          languageId,
          serverId: session.serverId,
          source: 'lsp',
          version,
          diagnostics,
          counts,
          message: diagnosticsMessage(path, counts),
          capturedAt: new Date().toISOString(),
        },
      };
    } catch {
      await session.connection.dispose();
      this.sessions.delete(`${language.definition.id}:${session.root}`);
      return { status: 'unavailable' };
    }
  }

  async dispose() {
    const sessions = await Promise.allSettled([...this.sessions.values()]);
    this.sessions.clear();
    await Promise.all(
      sessions.flatMap((result) =>
        result.status === 'fulfilled' && result.value ? [result.value.connection.dispose()] : [],
      ),
    );
  }
}

function diagnosticFeedback(payloads) {
  const diagnostics = payloads.flatMap((payload) =>
    payload.diagnostics
      .filter((diagnostic) => diagnostic.severity === 'error' || diagnostic.severity === 'warning')
      .map(
        (diagnostic) =>
          `- ${payload.path}:${diagnostic.range.start.line}:${diagnostic.range.start.column} ` +
          `${diagnostic.severity}${diagnostic.code ? ` ${diagnostic.code}` : ''}: ${diagnostic.message}`,
      ),
  );
  if (diagnostics.length === 0) return null;
  return clampText(
    [
      '<offisim_workspace_diagnostics source="lsp">',
      'The language server reported these diagnostics immediately after your file change:',
      ...diagnostics,
      'Fix these diagnostics now. Re-read the affected files and keep the change scoped; the diagnostics will run again after your next edit.',
      '</offisim_workspace_diagnostics>',
    ].join('\n'),
    MAX_FEEDBACK_CHARS,
  );
}

function verificationOutput(response) {
  const result = response?.ok === true ? response.result : null;
  if (!result || result.exitCode === 0) return null;
  const output = [result.stdout, result.stderr].filter(
    (part) => typeof part === 'string' && part.trim(),
  );
  return clampText(
    [
      '<offisim_workspace_diagnostics source="full-verification">',
      `The project verification command failed with exit code ${result.exitCode}.`,
      ...output,
      'Fix the reported failures now. This is the existing full-project fallback because no language server was available.',
      '</offisim_workspace_diagnostics>',
    ].join('\n'),
    MAX_FEEDBACK_CHARS,
  );
}

/**
 * Pi extension seam for W3. It observes only successful write/edit tools, asks
 * the session-scoped manager for diagnostics, emits an engine-neutral payload,
 * and queues diagnostics as a follow-up so Pi's own loop performs the repair.
 * Every LSP failure is swallowed; an existing project verification callback is
 * the only fallback, so this adds no configuration or user-facing error path.
 */
export function createLspDiagnosticsExtensionFactory({
  cwd,
  emitDiagnostics,
  runFallbackVerification,
  manager = new LanguageServerManager({ cwd }),
}) {
  const toolInputs = new Map();
  let diagnosticQueue = Promise.resolve();
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    toolInputs.clear();
    await diagnosticQueue.catch(() => undefined);
    await manager.dispose().catch(() => undefined);
  };
  const factory = (pi) => {
    pi.on('tool_execution_start', (event) => {
      if (WRITE_TOOL_NAMES.has(String(event.toolName ?? '').toLowerCase())) {
        toolInputs.set(event.toolCallId, event.args);
      }
    });

    pi.on('tool_execution_end', async (event) => {
      const args = toolInputs.get(event.toolCallId);
      toolInputs.delete(event.toolCallId);
      if (event.isError || !args) return;
      const paths = changedFilePathsFromTool(event.toolName, args, cwd);
      if (paths.length === 0) return;
      diagnosticQueue = diagnosticQueue
        .then(async () => {
          const results = await Promise.all(paths.map((path) => manager.diagnoseFile(path)));
          const available = results
            .filter((result) => result.status === 'available')
            .map((result) => result.payload);
          for (const payload of available) emitDiagnostics(payload);
          const lspFeedback = diagnosticFeedback(available);
          const needsFallback = results.some((result) => result.status !== 'available');
          const fallbackFeedback =
            needsFallback && runFallbackVerification
              ? verificationOutput(await runFallbackVerification())
              : null;
          const feedback = [lspFeedback, fallbackFeedback].filter(Boolean).join('\n\n');
          if (feedback) {
            pi.sendMessage(
              {
                customType: 'offisim.workspace-diagnostics',
                content: feedback,
                display: false,
              },
              { triggerTurn: true, deliverAs: 'followUp' },
            );
          }
        })
        .catch(() => undefined);
      await diagnosticQueue;
    });

    pi.on('session_shutdown', dispose);
  };
  factory.dispose = dispose;
  return factory;
}
