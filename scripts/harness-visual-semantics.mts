import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { threadToVm } from '../apps/desktop/renderer/src/data/adapters.js';
import type {
  ChatThread,
  Employee,
  ThreadRuntimeStatus,
} from '../apps/desktop/renderer/src/data/types.js';
import { presenceFor } from '../apps/desktop/renderer/src/surfaces/office/employee-presence.js';
import { terminalVisualOptionsFromCss } from '../apps/desktop/renderer/src/surfaces/office/stage-terminal/terminal-theme.js';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function sourceFiles(root: string, extensions: ReadonlySet<string>): string[] {
  const files: string[] = [];
  const stack = [join(ROOT, root)];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const name of readdirSync(current)) {
      const next = join(current, name);
      const stats = statSync(next);
      if (stats.isDirectory()) stack.push(next);
      else if (extensions.has(extname(name))) files.push(next);
    }
  }
  return files;
}

const employee = {
  online: true,
  disabled: false,
} satisfies Pick<Employee, 'online' | 'disabled'>;
const thread = (runtimeStatus: ThreadRuntimeStatus): ChatThread => ({
  id: `thread-${runtimeStatus ?? 'idle'}`,
  projectId: 'project-1',
  title: 'Visual semantics',
  subtitle: 'Deterministic presence projection',
  scope: 'direct',
  employeeId: 'employee-1',
  updatedAt: 0,
  runState:
    runtimeStatus === 'queued' || runtimeStatus === 'running'
      ? 'running'
      : runtimeStatus === 'blocked' || runtimeStatus === 'failed'
        ? 'error'
        : runtimeStatus === 'paused'
          ? 'paused'
          : runtimeStatus === 'completed'
            ? 'done'
            : 'idle',
  runtimeStatus,
});

assert.equal(presenceFor(employee, thread('queued')), 'working');
assert.equal(presenceFor(employee, thread('running')), 'working');
assert.equal(presenceFor(employee, thread('blocked')), 'blocked');
assert.equal(presenceFor(employee, thread('paused')), 'blocked');
assert.equal(presenceFor(employee, thread('failed')), 'failed');
assert.equal(presenceFor(employee, thread('completed')), 'idle');
assert.equal(presenceFor(employee, thread('cancelled')), 'idle');
assert.equal(presenceFor({ online: false, disabled: false }, thread('running')), 'offline');
assert.equal(presenceFor({ online: true, disabled: true }, thread('running')), 'offline');

const projectedFailure = threadToVm({
  thread_id: 'thread-failed',
  project_id: 'project-1',
  employee_id: 'employee-1',
  title: 'Failed run',
  summary: null,
  updated_at: '2026-07-16T00:00:00.000Z',
  run_status: 'failed',
});
assert.equal(projectedFailure.runtimeStatus, 'failed');
assert.equal(projectedFailure.runState, 'error');
assert.equal(presenceFor(employee, projectedFailure), 'failed');

const tokens = read('apps/desktop/renderer/src/styles/tokens.css');
const semanticRadiusRoles = [
  '--off-radius-control',
  '--off-radius-container',
  '--off-radius-overlay',
  '--off-radius-status',
  '--off-radius-round',
] as const;
const radiusValues = semanticRadiusRoles.map((role) => {
  const match = tokens.match(new RegExp(`${role}:\\s*([^;]+);`));
  assert.ok(match, `missing semantic radius role ${role}`);
  return match[1].trim();
});
assert.equal(new Set(radiusValues).size, semanticRadiusRoles.length, 'radius roles must be unique');
const radiusAliases = {
  '--off-r-2xs': '--off-radius-control',
  '--off-r-xs': '--off-radius-control',
  '--off-r-sm': '--off-radius-control',
  '--off-r-md': '--off-radius-container',
  '--off-r-lg': '--off-radius-overlay',
  '--off-r-pill': '--off-radius-status',
  '--off-r-full': '--off-radius-status',
  '--off-r-round': '--off-radius-round',
} as const;
for (const [alias, role] of Object.entries(radiusAliases)) {
  assert.match(tokens, new RegExp(`${alias}:\\s*var\\(${role}\\);`));
}

const terminalTokens = new Map(
  [...tokens.matchAll(/(--off-terminal-[a-z-]+):\s*([^;]+);/g)].map((match) => [
    match[1],
    match[2].trim(),
  ]),
);
const terminalOptions = terminalVisualOptionsFromCss({
  getPropertyValue: (name) => terminalTokens.get(name) ?? '',
});
assert.equal(terminalOptions.theme.background, terminalTokens.get('--off-terminal-background'));
assert.equal(terminalOptions.fontSize, 12);
assert.equal(terminalOptions.lineHeight, 1.25);

const officeCss = read('apps/desktop/renderer/src/surfaces/office/office.css');
for (const state of ['working', 'idle', 'blocked', 'failed', 'offline']) {
  assert.match(officeCss, new RegExp(`\\.off-team-status\\.is-${state}\\b`));
}
const motionCss = read('apps/desktop/renderer/src/styles/motion.css');
assert.match(motionCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
assert.match(motionCss, /animation-duration:\s*1ms\s*!important/);
assert.match(officeCss, /\.off-messages\s*\{[^}]*var\(--off-chat-column-inset\)/s);
assert.match(officeCss, /\.off-errbanner\s*\{[^}]*var\(--off-chat-column-inset\)/s);

const rawRadius = /(?:border(?:-(?:top|bottom)-(?:left|right))?-radius)\s*:\s*([^;}]+)/g;
const rawLength = /(-?(?:\d+\.?\d*|\.\d+))(px|%|rem|em|vh|vw)\b/g;
for (const file of sourceFiles('apps/desktop/renderer/src', new Set(['.css']))) {
  const rel = relative(ROOT, file);
  if (rel === 'apps/desktop/renderer/src/styles/tokens.css') continue;
  const text = readFileSync(file, 'utf8');
  for (const declaration of text.matchAll(rawRadius)) {
    for (const length of declaration[1].matchAll(rawLength)) {
      assert.equal(Number(length[1]), 0, `${rel} has raw nonzero radius ${length[0]}`);
    }
  }
}

console.log('[harness-visual-semantics] ok');
