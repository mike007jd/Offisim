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

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;

/**
 * Drop leading `VAR=value` assignments so `FOO=bar rm -rf /` is classified by
 * the real command word, not the assignment token.
 */
function stripLeadingEnvAssignments(tokens: readonly string[]): string[] {
  let i = 0;
  while (i < tokens.length && ENV_ASSIGNMENT.test(tokens[i] ?? '')) i += 1;
  return tokens.slice(i);
}

// Transparent runners that exec the rest of the line as a new command. Without
// peeling these, `env rm -rf /` / `timeout 5 rm -rf /` bypass the command-word
// checks. Mirrors the Rust shell_classifier wrapper skip (keep both in sync).
const TRANSPARENT_WRAPPERS = new Set([
  'env',
  'command',
  'exec',
  'nice',
  'nohup',
  'timeout',
  'stdbuf',
]);

function stripTransparentWrappers(tokens: readonly string[]): string[] {
  let result = [...tokens];
  while (result.length > 0) {
    const head = result[0];
    if (!head || !TRANSPARENT_WRAPPERS.has(head)) break;
    let i = 1;
    while (i < result.length) {
      const token = result[i];
      if (token === undefined) break;
      if (token === '--') {
        i += 1;
        break;
      }
      if (token.startsWith('-')) {
        i += 1;
        continue;
      }
      if (ENV_ASSIGNMENT.test(token)) {
        // `env VAR=val cmd`
        i += 1;
        continue;
      }
      if ((head === 'timeout' || head === 'nice') && /^[0-9]/u.test(token)) {
        // leading duration / niceness argument
        i += 1;
        continue;
      }
      break;
    }
    result = result.slice(i);
  }
  return result;
}

/**
 * Peel every layer that hides the real command word — env assignments,
 * privilege escalators, and transparent wrappers — looping until stable so
 * interleaved forms like `FOO=bar sudo env X=1 rm -rf /` resolve to `rm`.
 */
function stripCommandPrefixes(tokens: readonly string[]): string[] {
  let result = [...tokens];
  for (;;) {
    const before = result.length;
    result = stripLeadingEnvAssignments(result);
    result = stripPrivilegeEscalation(result);
    result = stripTransparentWrappers(result);
    if (result.length === before) break;
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
  // NFKC fold homoglyph attacks (fullwidth `ｓudo`, subscript `sᵤdo`, etc.)
  // before any pattern matching. Without this, `sᵤdo rm -rf /` passes every
  // ASCII-only check because the first token doesn't textually equal "sudo".
  // ref: openai/codex#13095
  const normalized = command.normalize('NFKC').trim();
  if (!normalized) return { decision: 'deny', reason: 'empty command' };
  for (const { pattern, reason } of CATASTROPHIC_PATTERNS) {
    if (pattern.test(normalized)) {
      return { decision: 'deny', reason: `Catastrophic shell command blocked: ${reason}.` };
    }
  }
  // Classify the top-level command AND every command-substitution body
  // (`$(...)` / backticks) so a payload smuggled inside a substitution —
  // e.g. `echo $(rm -rf /)` — is caught instead of treated as an argument.
  const commandsToScan = [normalized, ...extractSubstitutionBodies(normalized)];
  for (const cmd of commandsToScan) {
    for (const segment of splitShellSegments(cmd)) {
      const tokens = stripCommandPrefixes(tokenizeSegment(segment));
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
  }
  return { decision: 'allow' };
}

/**
 * Extract the bodies of every `$(...)` and backtick command substitution,
 * including nested `$(...)`. The single forward scan pushes a start index for
 * each `$(` and emits the enclosed body when the matching `)` is reached, so
 * both the inner and outer command of `$(echo $(rm -rf /))` are returned.
 * Best-effort (does not model quoting/escapes) — the Rust sandbox is the
 * authoritative gate; this raises the floor for the renderer-facing ask/deny.
 */
function extractSubstitutionBodies(command: string): string[] {
  const bodies: string[] = [];
  const starts: number[] = [];
  for (let i = 0; i < command.length; i += 1) {
    if (command[i] === '$' && command[i + 1] === '(') {
      starts.push(i + 2);
      i += 1;
    } else if (command[i] === ')' && starts.length > 0) {
      const start = starts.pop();
      if (start !== undefined) {
        const body = command.slice(start, i).trim();
        if (body) bodies.push(body);
      }
    }
  }
  const backtick = /`([^`]*)`/gu;
  for (let m = backtick.exec(command); m !== null; m = backtick.exec(command)) {
    const body = (m[1] ?? '').trim();
    if (body) bodies.push(body);
  }
  return bodies;
}

function splitShellSegments(command: string): string[] {
  // Split on every command separator a shell would honour, INCLUDING newlines
  // and carriage returns — a multi-line script must have each line classified,
  // otherwise `echo ok\nrm -rf /` would only ever see the benign first line.
  return command
    .split(/(?:&&|\|\||;|\||\n|\r)/u)
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

function isDestructive(
  first: string,
  second: string | undefined,
  tokens: readonly string[],
): boolean {
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
