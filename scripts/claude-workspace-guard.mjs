import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const REQUIRED_PATH_KEYS = Object.freeze({
  Edit: 'file_path',
  NotebookEdit: 'notebook_path',
  Read: 'file_path',
  Write: 'file_path',
});

const OPTIONAL_PATH_KEYS = Object.freeze({
  Glob: 'path',
  Grep: 'path',
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWithin(root, candidate) {
  const suffix = relative(root, candidate);
  return (
    suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`))
  );
}

async function nearestExistingAncestor(candidate) {
  let current = candidate;
  for (;;) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

async function pathIsWithinWorkspace(workspaceRoot, value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const root = await realpath(workspaceRoot);
  const candidate = resolve(workspaceRoot, value.trim());
  const ancestor = await nearestExistingAncestor(candidate);
  const resolvedAncestor = await realpath(ancestor);
  if (!isWithin(root, resolvedAncestor)) return false;
  return isWithin(root, resolve(resolvedAncestor, relative(ancestor, candidate)));
}

function deny(reason) {
  return {
    systemMessage: reason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

export function createClaudeWorkspaceGuard(workspaceRoot) {
  return async (input) => {
    if (!isRecord(input) || input.hook_event_name !== 'PreToolUse') return {};
    const toolName = typeof input.tool_name === 'string' ? input.tool_name : '';
    const toolInput = isRecord(input.tool_input) ? input.tool_input : {};

    if (toolName === 'Bash' && toolInput.dangerouslyDisableSandbox === true) {
      return deny('Commands cannot disable the Project workspace sandbox.');
    }

    const requiredKey = REQUIRED_PATH_KEYS[toolName];
    const optionalKey = OPTIONAL_PATH_KEYS[toolName];
    const pathKey = requiredKey ?? optionalKey;
    if (!pathKey) return {};
    const rawPath = toolInput[pathKey];
    if (optionalKey && (rawPath === undefined || rawPath === null || rawPath === '')) return {};
    if (!(await pathIsWithinWorkspace(workspaceRoot, rawPath))) {
      return deny(`${toolName} is limited to the current Project folder.`);
    }
    return {};
  };
}
