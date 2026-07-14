import { isAbsolute, posix, relative, resolve, sep, win32 } from 'node:path';
import {
  DEFAULT_MAX_BYTES,
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  formatSize,
  getShellConfig,
  truncateHead,
  truncateLine,
} from '@earendil-works/pi-coding-agent';

const VIRTUAL_WORKSPACE_ROOT = '/__offisim_workspace__';
const PROTECTED_TOOL_NAMES = new Set(['read', 'write', 'edit', 'grep', 'find', 'ls', 'bash']);
const PI_SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
const DEFAULT_GREP_LIMIT = 100;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function workspaceOutOfBounds(message) {
  return Object.assign(new Error(message), { code: 'workspace-out-of-bounds' });
}

function rejectsBoundWorkspacePath(path) {
  return (
    isAbsolute(path) || win32.isAbsolute(path) || /^[A-Za-z]:/.test(path) || /^file:/i.test(path)
  );
}

function normalizeRawWorkspaceRelativePath(value, fallback) {
  const source = value === undefined || value === null ? fallback : value;
  if (typeof source !== 'string') throw new Error('Workspace tool path must be a string.');
  if (source.includes('\0')) {
    throw workspaceOutOfBounds('Workspace tool path contains a NUL byte.');
  }

  // Pi normally strips a leading @ and expands ~/ before resolving a tool path.
  // Apply those lexical rules here first so no disguised absolute/parent path can
  // reach Pi's local path helpers.
  let path = source.startsWith('@') ? source.slice(1) : source;
  if (path === VIRTUAL_WORKSPACE_ROOT || path === `${VIRTUAL_WORKSPACE_ROOT}/`) {
    path = '.';
  } else if (path.startsWith(`${VIRTUAL_WORKSPACE_ROOT}/`)) {
    path = path.slice(VIRTUAL_WORKSPACE_ROOT.length + 1);
  } else if (rejectsBoundWorkspacePath(path)) {
    throw workspaceOutOfBounds(
      'Workspace tools only accept paths relative to the bound Project folder.',
    );
  }

  const segments = path.split(/[\\/]+/);
  if (segments.includes('..')) {
    throw workspaceOutOfBounds('Workspace tool paths cannot contain a parent-directory segment.');
  }
  const normalized = segments.filter((segment) => segment && segment !== '.').join('/');
  const relativePath = normalized || '.';
  if (rejectsBoundWorkspacePath(relativePath)) {
    throw workspaceOutOfBounds(
      'Workspace tools only accept paths relative to the bound Project folder.',
    );
  }
  if (relativePath === '~' || relativePath.startsWith('~/')) {
    throw workspaceOutOfBounds('Workspace tools do not accept home-relative paths.');
  }
  return relativePath;
}

function normalizeBridgeRelativePath(value, fallback) {
  const source = value === undefined || value === null ? fallback : value;
  if (typeof source !== 'string') throw new Error('Workspace bridge path must be a string.');
  if (source.includes('\0')) {
    throw workspaceOutOfBounds('Workspace bridge path contains a NUL byte.');
  }
  if (isAbsolute(source) || win32.isAbsolute(source) || /^[A-Za-z]:/.test(source)) {
    throw workspaceOutOfBounds('Workspace bridge returned an absolute path.');
  }
  const segments = source.split(/[\\/]+/);
  if (segments.includes('..')) {
    throw workspaceOutOfBounds('Workspace bridge returned a parent-directory path.');
  }
  return segments.filter((segment) => segment && segment !== '.').join('/') || '.';
}

function relativeFromVirtualPath(absolutePath) {
  if (typeof absolutePath !== 'string') throw new Error('Workspace bridge path must be a string.');
  const relativePath = relative(VIRTUAL_WORKSPACE_ROOT, absolutePath).split(sep).join('/');
  return normalizeBridgeRelativePath(relativePath || '.');
}

function virtualPathFromRelative(relativePath) {
  const normalized = normalizeBridgeRelativePath(relativePath, '.');
  return normalized === '.'
    ? VIRTUAL_WORKSPACE_ROOT
    : resolve(VIRTUAL_WORKSPACE_ROOT, ...normalized.split('/'));
}

function normalizeVirtualWorkspacePath(absolutePath) {
  return virtualPathFromRelative(relativeFromVirtualPath(absolutePath));
}

function normalizedPathInput(input, fallback) {
  return {
    ...input,
    path: normalizeRawWorkspaceRelativePath(input?.path, fallback),
  };
}

function normalizedPiPathInput(input, fallback) {
  const normalized = normalizedPathInput(input, fallback);
  return {
    ...normalized,
    // Pi strips one leading @ during resolution. Preserve literal @ names after
    // our one raw-input normalization pass by making the relative form explicit.
    path: normalized.path.startsWith('@') ? `./${normalized.path}` : normalized.path,
  };
}

function appendWorkspaceNotice(result, notice, details) {
  return {
    ...result,
    content: result.content.map((item) =>
      item.type === 'text' ? { ...item, text: `${item.text}\n\n[${notice}]` } : item,
    ),
    details: { ...(result.details ?? {}), ...details },
  };
}

function decodeBase64(contentBase64, operation) {
  if (
    typeof contentBase64 !== 'string' ||
    contentBase64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64)
  ) {
    throw new Error(`${operation} returned invalid base64 content.`);
  }
  return Buffer.from(contentBase64, 'base64');
}

function normalizeFileReadResult(value) {
  if (!isRecord(value)) throw new Error('fileRead returned an invalid response.');
  return {
    bytes: decodeBase64(value.contentBase64, 'fileRead'),
    mimeType:
      typeof value.mimeType === 'string' && value.mimeType.trim() ? value.mimeType : undefined,
    version: typeof value.version === 'string' && value.version ? value.version : undefined,
  };
}

function normalizeFileStatResult(value) {
  if (!isRecord(value) || typeof value.exists !== 'boolean') {
    throw new Error('fileStat returned an invalid response.');
  }
  return {
    exists: value.exists,
    isDirectory: value.exists && value.isDirectory === true,
    isFile: value.exists && value.isFile === true,
    isSymlink: value.exists && value.isSymlink === true,
  };
}

function asPiStat(value) {
  if (!value.exists) throw new Error('Workspace path does not exist.');
  return { isDirectory: () => value.isDirectory };
}

function normalizeListEntry(value) {
  if (!isRecord(value) || typeof value.name !== 'string') {
    throw new Error('fileList returned an invalid entry.');
  }
  if (!value.name || value.name === '.' || value.name === '..' || /[\\/\0]/.test(value.name)) {
    throw new Error('fileList returned an unsafe entry name.');
  }
  return {
    name: value.name,
    exists: true,
    isDirectory: value.isDirectory === true,
    isFile: value.isFile === true,
    isSymlink: value.isSymlink === true,
  };
}

function pathWithinSearchRoot(path, searchRoot) {
  return searchRoot === '.' || path === searchRoot || path.startsWith(`${searchRoot}/`);
}

function displayPathFromWorkspacePath(path, searchRoot) {
  if (!pathWithinSearchRoot(path, searchRoot)) {
    throw workspaceOutOfBounds('Workspace search returned a path outside its requested root.');
  }
  if (searchRoot === '.') return path;
  if (path === searchRoot) return posix.basename(path);
  return posix.relative(searchRoot, path);
}

function safeEditRenderCall(template, args, theme, context) {
  if (!template.renderCall) return undefined;
  let safeArgs;
  try {
    safeArgs = normalizedPiPathInput(args);
  } catch {
    safeArgs = { ...args, path: '.offisim-invalid-workspace-path' };
  }
  return template.renderCall(safeArgs, theme, {
    ...context,
    args: safeArgs,
    cwd: VIRTUAL_WORKSPACE_ROOT,
  });
}

/** Every production Bash and workspace-file call crosses the Rust host. Node
 * never owns a project cwd, process group, or fallback filesystem/process lane;
 * it only adapts Pi's tool contracts to backend-signed authority. */
export function createTaskBashProcessRegistry(options = {}) {
  const executeBoundCommand = options.executeBoundCommand;
  const executeBoundWorkspaceOperation = options.executeBoundWorkspaceOperation;
  const remoteExecutions = new Set();
  let closing = false;

  const runTracked = async (signal, execute) => {
    if (closing || signal?.aborted) throw new Error('aborted');
    const controller = new AbortController();
    let resolveFinished;
    const finished = new Promise((resolveFinishedPromise) => {
      resolveFinished = resolveFinishedPromise;
    });
    const remote = { controller, finished };
    remoteExecutions.add(remote);
    const abortRemote = () => controller.abort();
    signal?.addEventListener('abort', abortRemote, { once: true });
    try {
      const result = await execute(controller.signal);
      if (signal?.aborted || controller.signal.aborted || closing) throw new Error('aborted');
      return result;
    } finally {
      signal?.removeEventListener('abort', abortRemote);
      remoteExecutions.delete(remote);
      resolveFinished();
    }
  };

  const assertBoundLane = (cwd, taskWorkspaceLease, toolName) => {
    if (taskWorkspaceLease && cwd === '.') {
      throw new Error(
        `An isolated workspace lease cannot execute ${toolName} in the shared root lane.`,
      );
    }
    if (cwd !== '.' && (!taskWorkspaceLease || taskWorkspaceLease.cwd !== cwd)) {
      throw new Error(`${toolName} is missing its exact registered workspace lease.`);
    }
  };

  const requestWorkspaceOperation = async (cwd, taskWorkspaceLease, op, args, signal) => {
    assertBoundLane(cwd, taskWorkspaceLease, op);
    if (!executeBoundWorkspaceOperation) {
      throw new Error(`${op} requires the host-bound workspace bridge.`);
    }
    return runTracked(signal, (bridgeSignal) =>
      executeBoundWorkspaceOperation({
        op,
        args,
        ...(taskWorkspaceLease ? { taskWorkspaceLease } : {}),
        signal: bridgeSignal,
      }),
    );
  };

  const operations = (shellPath, taskWorkspaceLease) => ({
    exec: async (command, cwd, { onData, signal, timeout }) => {
      if (taskWorkspaceLease && cwd === '.') {
        throw new Error('An isolated workspace lease cannot execute in the shared root lane.');
      }
      if (!executeBoundCommand) {
        throw new Error('Task Bash requires the host-bound execution bridge.');
      }
      assertBoundLane(cwd, taskWorkspaceLease, 'Bash');
      const { shell } = getShellConfig(shellPath);
      const timeoutMs =
        Number.isFinite(timeout) && timeout > 0 ? Math.max(1, Math.round(timeout * 1000)) : 120_000;
      const result = await runTracked(signal, (bridgeSignal) =>
        executeBoundCommand({
          command,
          cwd,
          shellPath: shell,
          timeoutMs,
          taskWorkspaceLease,
          signal: bridgeSignal,
        }),
      );
      if (typeof result?.stdout === 'string' && result.stdout) {
        onData(Buffer.from(result.stdout));
      }
      if (typeof result?.stderr === 'string' && result.stderr) {
        onData(Buffer.from(result.stderr));
      }
      if (result?.timedOut) throw new Error(`timeout:${timeoutMs / 1000}`);
      return { exitCode: Number.isInteger(result?.exitCode) ? result.exitCode : -1 };
    },
  });

  const createReadTool = (cwd, taskWorkspaceLease, autoResizeImages) => {
    const template = createReadToolDefinition(VIRTUAL_WORKSPACE_ROOT, { autoResizeImages });
    return {
      ...template,
      async execute(toolCallId, input, signal, onUpdate, context) {
        const safeInput = normalizedPiPathInput(input);
        let pendingRead;
        const load = (absolutePath) => {
          pendingRead ??= requestWorkspaceOperation(
            cwd,
            taskWorkspaceLease,
            'fileRead',
            { path: normalizeVirtualWorkspacePath(absolutePath) },
            signal,
          ).then(normalizeFileReadResult);
          return pendingRead;
        };
        const inner = createReadToolDefinition(VIRTUAL_WORKSPACE_ROOT, {
          autoResizeImages,
          operations: {
            access: async (absolutePath) => {
              await load(absolutePath);
            },
            detectImageMimeType: async (absolutePath) => {
              const mimeType = (await load(absolutePath)).mimeType;
              return mimeType && PI_SUPPORTED_IMAGE_MIME_TYPES.has(mimeType) ? mimeType : undefined;
            },
            readFile: async (absolutePath) => (await load(absolutePath)).bytes,
          },
        });
        return inner.execute(toolCallId, safeInput, signal, onUpdate, context);
      },
    };
  };

  const createWriteTool = (cwd, taskWorkspaceLease) => {
    const template = createWriteToolDefinition(VIRTUAL_WORKSPACE_ROOT);
    return {
      ...template,
      async execute(toolCallId, input, signal, onUpdate, context) {
        const safeInput = normalizedPiPathInput(input);
        const inner = createWriteToolDefinition(VIRTUAL_WORKSPACE_ROOT, {
          operations: {
            // Parent creation and the final atomic replace are one descriptor-bound
            // Rust operation. A separate mkdir would reopen the TOCTOU window.
            mkdir: async () => {},
            writeFile: async (absolutePath, content) => {
              await requestWorkspaceOperation(
                cwd,
                taskWorkspaceLease,
                'fileWrite',
                {
                  path: normalizeVirtualWorkspacePath(absolutePath),
                  content,
                },
                signal,
              );
            },
          },
        });
        return inner.execute(toolCallId, safeInput, signal, onUpdate, context);
      },
    };
  };

  const createEditTool = (cwd, taskWorkspaceLease) => {
    const template = createEditToolDefinition(VIRTUAL_WORKSPACE_ROOT);
    return {
      ...template,
      renderCall: template.renderCall
        ? (args, theme, context) => safeEditRenderCall(template, args, theme, context)
        : undefined,
      async execute(toolCallId, input, signal, onUpdate, context) {
        const safeInput = normalizedPiPathInput(input);
        let pendingRead;
        const load = (absolutePath) => {
          pendingRead ??= requestWorkspaceOperation(
            cwd,
            taskWorkspaceLease,
            'fileRead',
            { path: normalizeVirtualWorkspacePath(absolutePath) },
            signal,
          ).then(normalizeFileReadResult);
          return pendingRead;
        };
        const inner = createEditToolDefinition(VIRTUAL_WORKSPACE_ROOT, {
          operations: {
            access: async (absolutePath) => {
              await load(absolutePath);
            },
            readFile: async (absolutePath) => (await load(absolutePath)).bytes,
            writeFile: async (absolutePath, content) => {
              const original = await load(absolutePath);
              if (!original.version) {
                throw new Error('fileRead must return a version before an edit can be committed.');
              }
              await requestWorkspaceOperation(
                cwd,
                taskWorkspaceLease,
                'fileWrite',
                {
                  path: normalizeVirtualWorkspacePath(absolutePath),
                  content,
                  expectedVersion: original.version,
                },
                signal,
              );
            },
          },
        });
        // Pi wraps access() failures in a fresh Error and drops structured host
        // codes. Preflight through the same lazy read so authority/boundary
        // failures propagate intact and the successful path still reads once.
        await load(virtualPathFromRelative(normalizeRawWorkspaceRelativePath(input?.path)));
        return inner.execute(toolCallId, safeInput, signal, onUpdate, context);
      },
    };
  };

  const createFindTool = (cwd, taskWorkspaceLease) => {
    const template = createFindToolDefinition(VIRTUAL_WORKSPACE_ROOT);
    return {
      ...template,
      async execute(toolCallId, input, signal, onUpdate, context) {
        const safeInput = normalizedPiPathInput(input, '.');
        let traversalLimitReached = false;
        let resultLimitReached;
        const statCache = new Map();
        const stat = async (absolutePath) => {
          const path = normalizeVirtualWorkspacePath(absolutePath);
          if (!statCache.has(path)) {
            statCache.set(
              path,
              requestWorkspaceOperation(cwd, taskWorkspaceLease, 'fileStat', { path }, signal).then(
                normalizeFileStatResult,
              ),
            );
          }
          return statCache.get(path);
        };
        const inner = createFindToolDefinition(VIRTUAL_WORKSPACE_ROOT, {
          operations: {
            exists: async (absolutePath) => (await stat(absolutePath)).exists,
            glob: async (pattern, absoluteRoot, findOptions) => {
              const searchRoot = relativeFromVirtualPath(absoluteRoot);
              const response = await requestWorkspaceOperation(
                cwd,
                taskWorkspaceLease,
                'fileFind',
                {
                  path: virtualPathFromRelative(searchRoot),
                  pattern,
                  limit: findOptions.limit,
                },
                signal,
              );
              if (
                !isRecord(response) ||
                !Array.isArray(response.paths) ||
                !Number.isInteger(response.appliedLimit) ||
                response.appliedLimit < 1 ||
                response.appliedLimit > findOptions.limit ||
                typeof response.resultLimitReached !== 'boolean' ||
                typeof response.traversalLimitReached !== 'boolean'
              ) {
                throw new Error('fileFind returned an invalid response.');
              }
              traversalLimitReached ||= response.traversalLimitReached;
              if (
                response.resultLimitReached &&
                response.appliedLimit < findOptions.limit &&
                (resultLimitReached === undefined || response.appliedLimit < resultLimitReached)
              ) {
                resultLimitReached = response.appliedLimit;
              }
              return response.paths.map((path) => {
                const normalized = relativeFromVirtualPath(path);
                if (!pathWithinSearchRoot(normalized, searchRoot)) {
                  throw workspaceOutOfBounds(
                    'fileFind returned a path outside its requested root.',
                  );
                }
                return virtualPathFromRelative(normalized);
              });
            },
          },
        });
        const result = await inner.execute(toolCallId, safeInput, signal, onUpdate, context);
        const notices = [];
        const details = {};
        if (resultLimitReached !== undefined) {
          details.resultLimitReached = resultLimitReached;
          notices.push(
            `${resultLimitReached} result limit reached. Refine the path or pattern for complete results`,
          );
        }
        if (traversalLimitReached) {
          details.traversalLimitReached = true;
          notices.push(
            'Workspace traversal limit reached. Refine the path or pattern for complete results',
          );
        }
        return notices.length > 0
          ? appendWorkspaceNotice(result, notices.join('. '), details)
          : result;
      },
    };
  };

  const createLsTool = (cwd, taskWorkspaceLease) => {
    const template = createLsToolDefinition(VIRTUAL_WORKSPACE_ROOT);
    return {
      ...template,
      async execute(toolCallId, input, signal, onUpdate, context) {
        const safeInput = normalizedPiPathInput(input, '.');
        const statCache = new Map();
        const listCache = new Map();
        let entryLimitReached = false;
        const effectiveLimit = Math.max(1, safeInput.limit ?? 500);
        const stat = async (absolutePath) => {
          const path = normalizeVirtualWorkspacePath(absolutePath);
          if (!statCache.has(path)) {
            statCache.set(
              path,
              requestWorkspaceOperation(cwd, taskWorkspaceLease, 'fileStat', { path }, signal).then(
                normalizeFileStatResult,
              ),
            );
          }
          return statCache.get(path);
        };
        const list = async (absolutePath) => {
          const path = relativeFromVirtualPath(absolutePath);
          if (!listCache.has(path)) {
            listCache.set(
              path,
              requestWorkspaceOperation(
                cwd,
                taskWorkspaceLease,
                'fileList',
                // Pi needs one look-ahead entry to preserve its entry-limit
                // notice; the bridge response itself is otherwise opaque to readdir().
                { path: virtualPathFromRelative(path), limit: effectiveLimit + 1 },
                signal,
              ).then((response) => {
                if (
                  !isRecord(response) ||
                  !Array.isArray(response.entries) ||
                  typeof response.entryLimitReached !== 'boolean'
                ) {
                  throw new Error('fileList returned an invalid response.');
                }
                entryLimitReached ||= response.entryLimitReached;
                return response.entries.map(normalizeListEntry);
              }),
            );
          }
          const entries = await listCache.get(path);
          for (const entry of entries) {
            const childPath = path === '.' ? entry.name : `${path}/${entry.name}`;
            statCache.set(virtualPathFromRelative(childPath), Promise.resolve(entry));
          }
          return entries;
        };
        const inner = createLsToolDefinition(VIRTUAL_WORKSPACE_ROOT, {
          operations: {
            exists: async (absolutePath) => (await stat(absolutePath)).exists,
            stat: async (absolutePath) => asPiStat(await stat(absolutePath)),
            readdir: async (absolutePath) => (await list(absolutePath)).map((entry) => entry.name),
          },
        });
        const result = await inner.execute(toolCallId, safeInput, signal, onUpdate, context);
        if (!entryLimitReached) return result;
        return appendWorkspaceNotice(
          result,
          'Workspace entry limit reached. Narrow the path for complete results',
          { entryLimitReached: true },
        );
      },
    };
  };

  const createGrepTool = (cwd, taskWorkspaceLease) => {
    const template = createGrepToolDefinition(VIRTUAL_WORKSPACE_ROOT);
    return {
      ...template,
      async execute(_toolCallId, input, signal) {
        const safeInput = normalizedPathInput(input, '.');
        const effectiveLimit = Math.max(1, safeInput.limit ?? DEFAULT_GREP_LIMIT);
        const response = await requestWorkspaceOperation(
          cwd,
          taskWorkspaceLease,
          'fileGrep',
          {
            path: virtualPathFromRelative(safeInput.path),
            pattern: safeInput.pattern,
            ...(safeInput.glob ? { glob: safeInput.glob } : {}),
            ignoreCase: safeInput.ignoreCase === true,
            literal: safeInput.literal === true,
            context: Math.max(0, safeInput.context ?? 0),
            limit: effectiveLimit,
          },
          signal,
        );
        if (
          !isRecord(response) ||
          !Array.isArray(response.matches) ||
          !Number.isInteger(response.appliedLimit) ||
          response.appliedLimit < 1 ||
          response.appliedLimit > effectiveLimit ||
          typeof response.matchLimitReached !== 'boolean' ||
          typeof response.traversalLimitReached !== 'boolean'
        ) {
          throw new Error('fileGrep returned an invalid response.');
        }

        let linesTruncated = false;
        const selectedMatches = response.matches.slice(0, response.appliedLimit);
        const lines = selectedMatches.flatMap((match) => {
          if (
            !isRecord(match) ||
            typeof match.path !== 'string' ||
            !Number.isInteger(match.lineNumber) ||
            match.lineNumber < 1 ||
            typeof match.line !== 'string' ||
            !Array.isArray(match.contextBefore) ||
            !match.contextBefore.every((line) => typeof line === 'string') ||
            !Array.isArray(match.contextAfter) ||
            !match.contextAfter.every((line) => typeof line === 'string')
          ) {
            throw new Error('fileGrep returned an invalid match.');
          }
          const path = relativeFromVirtualPath(match.path);
          const displayPath = displayPathFromWorkspacePath(path, safeInput.path);
          const formatLine = (line, lineNumber, isMatch) => {
            const sanitized = line.replace(/\r\n/g, '\n').replace(/\r/g, '').replace(/\n$/, '');
            const truncated = truncateLine(sanitized);
            if (truncated.wasTruncated) linesTruncated = true;
            return isMatch
              ? `${displayPath}:${lineNumber}: ${truncated.text}`
              : `${displayPath}-${lineNumber}- ${truncated.text}`;
          };
          const firstContextLine = match.lineNumber - match.contextBefore.length;
          if (firstContextLine < 1) {
            throw new Error('fileGrep returned invalid context line numbers.');
          }
          return [
            ...match.contextBefore.map((line, index) =>
              formatLine(line, firstContextLine + index, false),
            ),
            formatLine(match.line, match.lineNumber, true),
            ...match.contextAfter.map((line, index) =>
              formatLine(line, match.lineNumber + index + 1, false),
            ),
          ];
        });
        const renderedMatches = lines.length > 0 ? lines.join('\n') : 'No matches found';
        const truncation = truncateHead(renderedMatches, { maxLines: Number.MAX_SAFE_INTEGER });
        const matchLimitReached =
          response.matchLimitReached || response.matches.length > response.appliedLimit;
        const details = {};
        const notices = [];
        if (matchLimitReached) {
          details.matchLimitReached = response.appliedLimit;
          notices.push(
            `${response.appliedLimit} match limit reached. Refine the path or pattern for complete results`,
          );
        }
        if (response.traversalLimitReached) {
          details.traversalLimitReached = true;
          notices.push(
            'Workspace traversal limit reached. Refine the path or pattern for complete results',
          );
        }
        if (truncation.truncated) {
          details.truncation = truncation;
          notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
        }
        if (linesTruncated || response.linesTruncated === true) {
          details.linesTruncated = true;
          notices.push('Some lines were truncated. Use read to inspect the full line');
        }
        const output =
          notices.length > 0
            ? `${truncation.content}\n\n[${notices.join('. ')}]`
            : truncation.content;
        return {
          content: [{ type: 'text', text: output }],
          details: Object.keys(details).length > 0 ? details : undefined,
        };
      },
    };
  };

  return {
    createBashTool(cwd, toolOptions = {}) {
      const { taskWorkspaceLease, ...bashToolOptions } = toolOptions;
      const tool = createBashToolDefinition(cwd, {
        ...bashToolOptions,
        operations: operations(toolOptions.shellPath, taskWorkspaceLease),
      });
      return {
        ...tool,
        description: `${tool.description}\n\nRun commands synchronously. Background jobs are supported only when this command waits for them. Do not start persistent or detached processes with nohup, disown, daemonization, or jobs intended to outlive the command.`,
      };
    },
    createWorkspaceTools(cwd, toolOptions = {}) {
      const taskWorkspaceLease = toolOptions.taskWorkspaceLease;
      return [
        createReadTool(cwd, taskWorkspaceLease, toolOptions.autoResizeImages),
        createWriteTool(cwd, taskWorkspaceLease),
        createEditTool(cwd, taskWorkspaceLease),
        createGrepTool(cwd, taskWorkspaceLease),
        createFindTool(cwd, taskWorkspaceLease),
        createLsTool(cwd, taskWorkspaceLease),
      ];
    },
    async cleanup() {
      closing = true;
      for (const remote of remoteExecutions) remote.controller.abort();
      await Promise.all([...remoteExecutions].map((remote) => remote.finished));
    },
    get activeCount() {
      return remoteExecutions.size;
    },
  };
}

export function withTaskScopedBash(options, registry) {
  const { taskWorkspaceLease, ...sessionOptions } = options;
  const customTools = Array.isArray(sessionOptions.customTools)
    ? sessionOptions.customTools.filter((tool) => !PROTECTED_TOOL_NAMES.has(tool?.name))
    : [];
  const workspaceTools = registry.createWorkspaceTools(sessionOptions.cwd, {
    autoResizeImages: sessionOptions.settingsManager?.getImageAutoResize?.(),
    taskWorkspaceLease,
  });
  return {
    ...sessionOptions,
    customTools: [
      ...customTools,
      ...workspaceTools,
      registry.createBashTool(sessionOptions.cwd, {
        commandPrefix: sessionOptions.settingsManager?.getShellCommandPrefix?.(),
        shellPath: sessionOptions.settingsManager?.getShellPath?.(),
        taskWorkspaceLease,
      }),
    ],
  };
}

export function createTaskScopedAgentSessionFactory(createSession, registry) {
  return (options) => createSession(withTaskScopedBash(options, registry));
}
