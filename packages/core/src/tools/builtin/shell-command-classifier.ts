export type ShellCommandClassification =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | { decision: 'ask'; reason: string };

const CATASTROPHIC_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  // Classic `:(){ :|:& };:` (and spaceless / `;` variants).
  { pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*[;&]+\s*\}\s*;\s*:/u, reason: 'fork bomb' },
  // Named-function fork bomb: `f(){ f|f& };f`.
  {
    pattern: /\b(\w+)\s*\(\s*\)\s*\{\s*\1\s*\|\s*\1\s*[;&]+\s*\}\s*;\s*\1\b/u,
    reason: 'fork bomb',
  },
  { pattern: /\bmkfs(?:\.[\w-]+)?\b/u, reason: 'filesystem formatting' },
  { pattern: /\bwipefs\b/u, reason: 'filesystem signature wipe' },
  { pattern: /\bdd\s+[^;&|]*(?:of=\/dev\/|if=\/dev\/)/u, reason: 'raw device write/read' },
  { pattern: /\bchmod\s+-R\s+0{3,4}\b/u, reason: 'recursive permission destruction' },
  { pattern: /\bchmod\s+-R\s+777\b/u, reason: 'recursive world-writable chmod' },
  { pattern: />\s*\/dev\/(?:sd|disk|rdisk|nvme)/u, reason: 'raw device redirection' },
  { pattern: /\bcurl\b[\s\S]*\|\s*(?:sh|bash|zsh)\b/u, reason: 'download-pipe-shell' },
];

const PRIVILEGE_ESCALATORS = new Set(['sudo', 'doas']);
const SUDO_VALUE_FLAGS = new Set([
  '-u',
  '--user',
  '-g',
  '--group',
  '-p',
  '--prompt',
  '-C',
  '-h',
  '--host',
  '-R',
  '--chroot',
  '-D',
  '--chdir',
]);

/**
 * Strip a leading `sudo`/`doas` (and its option/value flags) so the inner
 * command is classified, not the escalator. Without this, `sudo rm -rf /`
 * bypasses every command-level check because the first token is `sudo`.
 */
function stripPrivilegeEscalation(tokens: readonly string[]): string[] {
  let result = [...tokens];
  while (result.length > 0) {
    const head = result[0];
    if (!head || !PRIVILEGE_ESCALATORS.has(head)) break;
    let i = 1;
    while (i < result.length) {
      const token = result[i];
      if (token === undefined) break;
      if (token === '--') {
        i += 1;
        break;
      }
      if (token.startsWith('-')) {
        i += SUDO_VALUE_FLAGS.has(token) ? 2 : 1;
        continue;
      }
      break;
    }
    result = result.slice(i);
  }
  return result;
}

const WRITE_COMMANDS = new Set([
  'cp',
  'mv',
  'rm',
  'mkdir',
  'rmdir',
  'touch',
  'chmod',
  'chown',
  'tee',
  'install',
  'truncate',
  'git',
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'cargo',
]);

const MUTATING_GIT = new Set([
  'add',
  'am',
  'apply',
  'branch',
  'checkout',
  'cherry-pick',
  'clean',
  'commit',
  'merge',
  'mv',
  'pull',
  'push',
  'rebase',
  'reset',
  'restore',
  'revert',
  'rm',
  'switch',
  'tag',
]);

export function classifyShellCommand(
  command: string,
  options: { readOnly?: boolean } = {},
): ShellCommandClassification {
  const normalized = command.trim();
  if (!normalized) return { decision: 'deny', reason: 'empty command' };
  for (const { pattern, reason } of CATASTROPHIC_PATTERNS) {
    if (pattern.test(normalized)) {
      return { decision: 'deny', reason: `Catastrophic shell command blocked: ${reason}.` };
    }
  }
  const segments = splitShellSegments(normalized);
  for (const segment of segments) {
    const tokens = stripPrivilegeEscalation(tokenizeSegment(segment));
    const [first, second] = tokens;
    if (!first) continue;
    if (isUnsafeRecursiveDelete(first, tokens)) {
      return {
        decision: 'deny',
        reason: 'Catastrophic shell command blocked: recursive delete against an unsafe target.',
      };
    }
    if (options.readOnly && isWriteSegment(segment, first, second)) {
      return { decision: 'deny', reason: `Read-only mode blocks write command '${first}'.` };
    }
    if (isDestructive(first, second, tokens)) {
      return {
        decision: 'ask',
        reason: `Destructive shell command '${[first, second].filter(Boolean).join(' ')}' requires approval.`,
      };
    }
  }
  return { decision: 'allow' };
}

function splitShellSegments(command: string): string[] {
  return command
    .split(/(?:&&|\|\||;|\|)/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function tokenizeSegment(segment: string): string[] {
  const tokens = segment.match(/(?:[^\s"'`]+|"[^"]*"|'[^']*'|`[^`]*`)+/gu) ?? [];
  return tokens.map((token) => token.replace(/^["'`]+|["'`]+$/gu, ''));
}

function isUnsafeRecursiveDelete(first: string, tokens: readonly string[]): boolean {
  if (first !== 'rm') return false;
  const flags = tokens.filter((token) => token.startsWith('-') && token !== '--').join('');
  if (!flags.includes('r') || !flags.includes('f')) return false;
  return tokens.some((token) => isUnsafeDeleteTarget(token));
}

function isUnsafeDeleteTarget(token: string): boolean {
  const normalized = token.replace(/^["'`]+|["'`]+$/gu, '').replace(/\/+$/u, '') || '/';
  return (
    normalized === '/' ||
    normalized === '~' ||
    normalized === '.' ||
    normalized === '..' ||
    normalized === '*' ||
    normalized === '/*' ||
    normalized.startsWith('../')
  );
}

function isWriteSegment(segment: string, first: string, second: string | undefined): boolean {
  if (/(^|[^>])>>?([^>&]|$)/u.test(segment)) return true;
  if (first === 'sed' && segment.includes('-i')) return true;
  if (first === 'git' && second && MUTATING_GIT.has(second)) return true;
  return WRITE_COMMANDS.has(first);
}

function isDestructive(first: string, second: string | undefined, tokens: readonly string[]): boolean {
  if (first === 'rm' && tokens.some((token) => /^-[\w-]*r[\w-]*f|^-[\w-]*f[\w-]*r/u.test(token))) {
    return true;
  }
  if (first === 'git' && second && ['push', 'reset', 'clean', 'rebase'].includes(second)) {
    return true;
  }
  return (
    first === 'chmod' ||
    first === 'chown' ||
    first === 'mkfs' ||
    first === 'shred' ||
    (first === 'dd' && tokens.some((token) => token.startsWith('of=')))
  );
}
