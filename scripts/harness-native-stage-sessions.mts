import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stageTabForTarget, useUiState } from '../apps/desktop/renderer/src/app/ui-state.js';
import { newestBrowserSnapshot } from '../apps/desktop/renderer/src/surfaces/office/stage-browser/browser-session-state.js';
import { bytesToBase64, terminalReplayStep } from '../apps/desktop/renderer/src/surfaces/office/stage-terminal/terminal-replay.js';
import {
  planStageSessionReconciliation,
  stageSessionScopeKey,
} from '../apps/desktop/renderer/src/surfaces/office/stage-viewer/StageSessionReconciler.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}/${path}`, 'utf8');

const scope = { companyId: 'company-a', projectId: 'project-a', threadId: 'thread-a' };
const terminal = {
  kind: 'terminal-session' as const,
  sessionId: 'terminal-a',
  scope,
  title: 'Terminal',
};
const browser = {
  kind: 'browser-session' as const,
  sessionId: 'browser-a',
  scope,
  initialUrl: 'https://example.com/',
  title: 'Browser',
};

useUiState.setState({
  companyId: scope.companyId,
  projectId: scope.projectId,
  selectedThreadId: scope.threadId,
  stagePrimaryTab: 'game',
  stageView: { kind: 'scene' },
  stageOpenTabs: [],
  activeStageTabId: null,
  stageSplitTabId: null,
});

assert.equal(stageTabForTarget(terminal), 'terminal');
assert.equal(stageTabForTarget(browser), 'preview');
assert.equal(stageTabForTarget({ kind: 'logs', title: 'Pi tool' }), 'terminal');
assert.equal(
  stageTabForTarget({ kind: 'preview', ref: { source: 'browser', sourceId: 'pi-browser' } }),
  'preview',
);

useUiState.getState().openStageView(terminal);
useUiState.getState().openStageView(browser);
let state = useUiState.getState();
assert.deepEqual(
  state.stageOpenTabs.map((tab) => tab.id),
  ['terminal-session:terminal-a', 'browser-session:browser-a'],
);
assert.equal(state.activeStageTabId, 'browser-session:browser-a');

useUiState.getState().openStageView({ ...terminal, title: 'Project shell' });
state = useUiState.getState();
assert.equal(state.stageOpenTabs.length, 2, 'the same native session updates one stable tab');
assert.equal(
  state.stageOpenTabs[0]?.target.kind === 'terminal-session'
    ? state.stageOpenTabs[0].target.title
    : null,
  'Project shell',
);

useUiState.getState().toggleStageSplitTab('browser-session:browser-a');
assert.equal(useUiState.getState().stageSplitTabId, 'browser-session:browser-a');

useUiState.getState().setScope('company-b', 'project-b');
state = useUiState.getState();
assert.deepEqual(state.stageOpenTabs, [], 'scope reset drops native session tabs');
assert.equal(state.activeStageTabId, null);
assert.equal(state.stageSplitTabId, null);

const nativePlan = planStageSessionReconciliation({
  tabs: [
    { id: 'terminal-session:terminal-a', target: terminal },
    { id: 'browser-session:browser-a', target: browser },
  ],
  nativeTerminalIds: ['terminal-a', 'terminal-orphan'],
  nativeBrowserIds: ['browser-a', 'browser-orphan'],
  visibleTabIds: new Set(['browser-session:browser-a']),
});
assert.deepEqual(nativePlan.closeTerminalIds, ['terminal-orphan']);
assert.deepEqual(nativePlan.closeBrowserIds, ['browser-orphan']);
assert.deepEqual(nativePlan.browserVisibility, [{ sessionId: 'browser-a', visible: true }]);
assert.notEqual(
  stageSessionScopeKey({ ...scope, threadId: null }),
  stageSessionScopeKey(scope),
  'draft project scope and persisted thread scope are reconciled independently',
);

const terminalBytes = new TextEncoder().encode('A🙂B');
const terminalChunk = {
  startCursor: 10,
  endCursor: 10 + terminalBytes.length,
  dataBase64: bytesToBase64(terminalBytes),
};
assert.equal(terminalReplayStep(9, terminalChunk).kind, 'gap');
assert.equal(terminalReplayStep(terminalChunk.endCursor, terminalChunk).kind, 'ignore');
const overlap = terminalReplayStep(11, terminalChunk);
assert.equal(overlap.kind, 'write');
assert.deepEqual(
  overlap.kind === 'write' ? [...overlap.bytes] : [],
  [...terminalBytes.subarray(1)],
  'byte-cursor replay trims overlap without decoding UTF-8 chunks as strings',
);

const browserBase = {
  sessionId: 'browser-a',
  scope,
  status: 'loading' as const,
  url: 'https://example.com/old',
  title: null,
  canGoBack: false,
  canGoForward: false,
  sequence: 7,
  visible: true,
};
const browserNew = { ...browserBase, sequence: 8, status: 'ready' as const, url: 'https://example.com/new' };
assert.equal(newestBrowserSnapshot(browserBase, browserNew), browserNew);
assert.equal(
  newestBrowserSnapshot(browserNew, { ...browserBase, sequence: 6 }),
  browserNew,
  'late command responses cannot overwrite newer native navigation events',
);

for (const path of [
  'apps/desktop/src-tauri/capabilities/default.json',
  'apps/desktop/src-tauri/capabilities/agent-bridges.json',
  'apps/desktop/src-tauri/capabilities/fs-shell.json',
  'apps/desktop/src-tauri/capabilities/github.json',
]) {
  const capability = JSON.parse(read(path)) as Record<string, unknown>;
  assert.deepEqual(capability.webviews, ['main', 'main-live'], `${path} targets main renderers`);
  assert.equal(capability.windows, undefined, `${path} cannot flow through the containing window`);
  assert.equal(capability.remote, undefined, `${path} cannot grant a remote origin`);
}

const permission = read('apps/desktop/src-tauri/permissions/fs-shell.toml');
const commandFacade = read('apps/desktop/renderer/src/lib/tauri-commands.ts');
const lib = read('apps/desktop/src-tauri/src/lib.rs');
const commands = [
  'terminal_session_create',
  'terminal_session_write',
  'terminal_session_resize',
  'terminal_session_snapshot',
  'terminal_session_list_scoped',
  'terminal_session_close',
  'browser_session_create',
  'browser_session_navigate',
  'browser_session_back',
  'browser_session_forward',
  'browser_session_reload',
  'browser_session_set_bounds',
  'browser_session_set_visible',
  'browser_session_snapshot',
  'browser_session_list_scoped',
  'browser_session_close',
];
for (const command of commands) {
  assert.match(permission, new RegExp(`"${command}"`));
  assert.match(commandFacade, new RegExp(`\\b${command}:`));
  assert.match(lib, new RegExp(`\\b${command},`));
}

const terminalSource = read(
  'apps/desktop/renderer/src/surfaces/office/stage-terminal/TerminalSessionView.tsx',
);
const terminalNativeSource = read('apps/desktop/src-tauri/src/terminal_session.rs');
assert.match(terminalSource, /dataBase64/);
assert.match(terminalSource, /afterCursor: cursorRef\.current/);
assert.doesNotMatch(terminalSource, /localStorage|sessionStorage/);

const browserSource = read(
  'apps/desktop/renderer/src/surfaces/office/stage-browser/BrowserSessionView.tsx',
);
const browserNativeSource = read('apps/desktop/src-tauri/src/browser_session.rs');
assert.match(browserSource, /Only http:\/\/ and https:\/\//);
assert.match(browserSource, /No local access/);
assert.match(browserSource, /ResizeObserver/);

for (const [label, rendererSource, nativeSource] of [
  ['terminal', terminalSource, terminalNativeSource],
  ['browser', browserSource, browserNativeSource],
] as const) {
  const rendererEvent = rendererSource.match(/const [A-Z_]+ = '([^']+)'/)?.[1];
  const nativeEvent = nativeSource.match(/const [A-Z_]+: &str = "([^"]+)"/)?.[1];
  assert.ok(rendererEvent, `${label} renderer event is declared`);
  assert.equal(rendererEvent, nativeEvent, `${label} renderer/native event names match`);
  assert.match(
    rendererEvent,
    /^[A-Za-z0-9_:/-]+$/,
    `${label} event name satisfies the Tauri runtime character contract`,
  );
}

console.log('native-stage-sessions: PASS (targets, lifecycle, ACL, 16 typed commands)');
