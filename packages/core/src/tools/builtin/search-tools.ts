import type { BuiltinTool, BuiltinToolConfig } from './types.js';

const MAX_RESULTS = 200;

export function createGlobTool(config: BuiltinToolConfig): BuiltinTool | null {
  const listDirCandidate = config.fs?.listDir;
  if (config.executionMode === 'browser-limited' || !config.fs || !listDirCandidate) return null;
  const fs = config.fs;
  const listDir = listDirCandidate.bind(fs);
  return {
    def: {
      name: 'glob',
      description: 'Find files under a path using a simple glob pattern.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string' },
        },
        required: ['pattern'],
      },
      maxResultSizeChars: 20_000,
    },
    async execute(args, context) {
      const root = (args.path as string | undefined) ?? '.';
      const regex = globToRegex(args.pattern as string);
      const matches: string[] = [];
      await visitFiles(listDir, root, context?.threadId, async (file) => {
        if (regex.test(file)) matches.push(file);
        return matches.length < MAX_RESULTS;
      });
      return matches.join('\n') || '(no matches)';
    },
  };
}

export function createGrepTool(config: BuiltinToolConfig): BuiltinTool | null {
  const listDirCandidate = config.fs?.listDir;
  if (config.executionMode === 'browser-limited' || !config.fs || !listDirCandidate) return null;
  const fs = config.fs;
  const listDir = listDirCandidate.bind(fs);
  return {
    def: {
      name: 'grep',
      description: 'Search file contents under a path.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string' },
        },
        required: ['pattern'],
      },
      maxResultSizeChars: 30_000,
    },
    async execute(args, context) {
      const root = (args.path as string | undefined) ?? '.';
      // Malformed user-supplied regex (e.g. '[' / '(unclosed') would
      // otherwise throw SyntaxError uncaught and crash the turn instead of
      // returning a clean tool error.
      let regex: RegExp;
      try {
        regex = new RegExp(args.pattern as string, 'iu');
      } catch (err) {
        return `Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`;
      }
      // ReDoS guard: cap the total time spent in regex.test across the whole
      // grep call, and skip individual lines that exceed the per-line size
      // cap. JS RegExp is V8-backtracking; a malicious pattern like
      // `(a+)+$` can otherwise stall the event loop indefinitely on a long
      // line. RE2 would be the proper fix but pulls in a wasm dep — the
      // budget covers the realistic abuse path.
      const startMs = Date.now();
      const MAX_REGEX_BUDGET_MS = 1500;
      const MAX_LINE_LEN_FOR_REGEX = 4096;
      const results: string[] = [];
      let budgetExhausted = false;
      await visitFiles(listDir, root, context?.threadId, async (file) => {
        let text = '';
        try {
          text = await fs.readFile(
            file,
            context?.threadId ? { threadId: context.threadId } : undefined,
          );
        } catch {
          return true;
        }
        const lines = text.split(/\r?\n/u);
        for (let index = 0; index < lines.length; index++) {
          if (results.length >= MAX_RESULTS) break;
          if (Date.now() - startMs > MAX_REGEX_BUDGET_MS) {
            budgetExhausted = true;
            break;
          }
          const line = lines[index] ?? '';
          if (line.length > MAX_LINE_LEN_FOR_REGEX) continue;
          if (regex.test(line)) {
            results.push(`${file}:${index + 1}:${line}`);
          }
        }
        return results.length < MAX_RESULTS && !budgetExhausted;
      });
      const body = results.join('\n') || '(no matches)';
      return budgetExhausted ? `${body}\n(grep stopped: regex budget exhausted)` : body;
    },
  };
}

async function visitFiles(
  listDir: NonNullable<NonNullable<BuiltinToolConfig['fs']>['listDir']>,
  root: string,
  threadId: string | undefined,
  visit: (file: string) => Promise<boolean>,
): Promise<void> {
  const queue = [root];
  let visitedFiles = 0;
  while (queue.length > 0 && visitedFiles < MAX_RESULTS * 5) {
    const current = queue.shift();
    if (current === undefined) break;
    const entries = await listDir(current, threadId ? { threadId } : undefined);
    for (const entry of entries) {
      if (entry.isDirectory) queue.push(entry.path);
      if (!entry.isFile) continue;
      visitedFiles += 1;
      const shouldContinue = await visit(entry.path);
      if (!shouldContinue || visitedFiles >= MAX_RESULTS * 5) return;
    }
  }
}

function globToRegex(pattern: string): RegExp {
  const parts: string[] = ['^'];
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern.charAt(index);
    const next = pattern.charAt(index + 1);
    if (char === '*' && next === '*') {
      parts.push('.*');
      index += 1;
    } else if (char === '*') {
      parts.push('[^/]*');
    } else if (char === '?') {
      parts.push('.');
    } else {
      parts.push(char.replace(/[.+^${}()|[\]\\]/u, '\\$&'));
    }
  }
  parts.push('$');
  return new RegExp(parts.join(''), 'iu');
}
