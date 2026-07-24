import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RuntimeEngineCapabilityManifest } from '@offisim/shared-types';
import { stageTabForTarget, useUiState } from '../apps/desktop/renderer/src/app/ui-state.js';
import { CANVAS_FONT_TOKENS } from '../apps/desktop/renderer/src/styles/visual-tokens.js';
import { resolveComputerRoute } from '../apps/desktop/renderer/src/surfaces/office/computer/computer-route.js';
import { syncOfficeCanvasBackingStore } from '../apps/desktop/renderer/src/surfaces/office/scene/OfficeScene2D.js';
import { newestBrowserSnapshot } from '../apps/desktop/renderer/src/surfaces/office/stage-browser/browser-session-state.js';
import {
  NATIVE_SURFACE_OVERLAY_SELECTOR,
  anyOverlayIntersectsHost,
  computeVisibleNativeBounds,
  rectsIntersect,
  sameNativeBounds,
} from '../apps/desktop/renderer/src/surfaces/office/stage-browser/native-bounds.js';
import {
  bytesToBase64,
  terminalReplayStep,
} from '../apps/desktop/renderer/src/surfaces/office/stage-terminal/terminal-replay.js';
import {
  acquireNativeStageSessionLease,
  nativeStageSessionLeaseRegistrySize,
  planStageSessionReconciliation,
  reconcileStageSessionScope,
  stageSessionReconciliationRetryDelay,
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

const routeManifest = {
  stop: true,
  steer: true,
  resume: true,
  attachmentInput: { textFiles: true, images: 'supported' },
  permissionModes: ['plan', 'auto', 'full'],
  interactions: { approval: true, userInput: true },
  interactionRoutes: {
    browser: [
      {
        id: 'offisim-browser',
        source: 'offisim-local',
        label: 'Offisim Browser',
        availability: 'available',
      },
    ],
    computer: [
      {
        id: 'native-computer',
        source: 'engine-native',
        label: 'Native Computer',
        availability: 'unsupported',
        reason: 'Not exposed by this adapter.',
      },
      {
        id: 'offisim-computer',
        source: 'offisim-local',
        label: 'Offisim Computer Use',
        availability: 'runtime-determined',
      },
    ],
  },
  processEvents: { reasoning: true, toolCalls: true, fileChanges: true },
  pace: { speedReport: 'unreported' },
} as const satisfies RuntimeEngineCapabilityManifest;

assert.equal(
  resolveComputerRoute(routeManifest, true).effective.id,
  'offisim-computer',
  'automatic Computer routing uses the declared available local route instead of guessing by engine brand',
);
assert.equal(
  resolveComputerRoute(routeManifest, false).effective.availability,
  'setup-required',
  'a disconnected local driver remains a declared setup route',
);
assert.equal(
  resolveComputerRoute(routeManifest, true).routes.find((route) => route.source === 'engine-native')
    ?.availability,
  'unsupported',
  'the resolver preserves unsupported native route truth alongside the effective local route',
);

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
  nativeBrowsers: [
    { sessionId: 'browser-a', agent: false },
    { sessionId: 'browser-orphan', agent: false },
    { sessionId: 'agent-thread-a', agent: true },
  ],
  visibleTabIds: new Set(['browser-session:browser-a']),
});
assert.deepEqual(nativePlan.closeTerminalIds, ['terminal-orphan']);
assert.deepEqual(nativePlan.closeBrowserIds, ['browser-orphan']);
assert.deepEqual(nativePlan.browserVisibility, [
  { sessionId: 'browser-a', visible: true },
  { sessionId: 'agent-thread-a', visible: false },
]);
assert.ok(
  !nativePlan.closeBrowserIds.includes('agent-thread-a'),
  'Stage reconciliation never closes an agent browser merely because no spectator tab is open',
);
assert.ok(
  nativePlan.browserVisibility.some(
    (entry) => entry.sessionId === 'agent-thread-a' && entry.visible === false,
  ),
  'an agent browser with no spectator tab is explicitly hidden, restoring the off-screen invariant',
);
assert.notEqual(
  stageSessionScopeKey({ ...scope, threadId: null }),
  stageSessionScopeKey(scope),
  'draft project scope and persisted thread scope are reconciled independently',
);

let releaseMutation!: () => void;
const mutationGate = new Promise<void>((resolve) => {
  releaseMutation = resolve;
});
const mutationOrder: string[] = [];
const leaseRegistryBaseline = nativeStageSessionLeaseRegistrySize();
const firstLease = acquireNativeStageSessionLease('browser', scope, 'browser-race');
const firstMutation = firstLease.runIfCurrent(async () => {
  mutationOrder.push('old-start');
  await mutationGate;
  mutationOrder.push('old-finish');
});
await Promise.resolve();
firstLease.release();
const staleHide = firstLease.runIfLatest(async () => {
  mutationOrder.push('old-hide');
});
const nextLease = acquireNativeStageSessionLease('browser', scope, 'browser-race');
const nextShow = nextLease.runIfCurrent(async () => {
  mutationOrder.push('new-show');
});
releaseMutation();
await Promise.all([firstMutation, staleHide, nextShow]);
assert.ok(nextLease.generation > firstLease.generation, 'a remount advances session ownership');
assert.deepEqual(
  mutationOrder,
  ['old-start', 'old-finish', 'new-show'],
  'a stale cleanup cannot hide a session acquired by the next mount',
);
nextLease.release();
for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
assert.equal(
  nativeStageSessionLeaseRegistrySize(),
  leaseRegistryBaseline,
  'released generations are removed after their latest mutation tail settles',
);

let failList = true;
let failClose = true;
const reconciliationCalls: string[] = [];
const reconciliationCommands = {
  async listTerminals() {
    if (failList) throw new Error('transient terminal list failure');
    return [{ sessionId: 'terminal-orphan' }];
  },
  async listBrowsers() {
    return [
      { sessionId: 'browser-a', agent: false },
      { sessionId: 'browser-orphan', agent: false },
      { sessionId: 'agent-thread-a', agent: true },
    ];
  },
  async closeTerminal(_scope: typeof scope, sessionId: string) {
    reconciliationCalls.push(`close-terminal:${sessionId}`);
    return true;
  },
  async closeBrowser(_scope: typeof scope, sessionId: string) {
    reconciliationCalls.push(`close-browser:${sessionId}`);
    return !failClose;
  },
  async setBrowserVisible(_scope: typeof scope, sessionId: string, visible: boolean) {
    reconciliationCalls.push(`visible:${sessionId}:${visible}`);
    return true;
  },
};
const reconciliationInput = {
  scope,
  tabs: [{ id: 'browser-session:browser-a', target: browser }],
  visibleTabIds: new Set<string>(),
};
assert.equal(
  await reconcileStageSessionScope(reconciliationInput, reconciliationCommands),
  false,
  'a list failure stays retryable instead of becoming an empty native session list',
);
assert.deepEqual(reconciliationCalls, [], 'no destructive work runs from a partial list');
failList = false;
assert.equal(
  await reconcileStageSessionScope(reconciliationInput, reconciliationCommands),
  false,
  'a failed close keeps the scope retryable',
);
failClose = false;
assert.equal(
  await reconcileStageSessionScope(reconciliationInput, reconciliationCommands),
  true,
  'the scope converges only after every close and visibility mutation succeeds',
);
assert.deepEqual(
  [0, 1, 2, 3, 4, 5].map(stageSessionReconciliationRetryDelay),
  [250, 500, 1_000, 2_000, 4_000, 4_000],
  'reconciliation retries use bounded exponential backoff',
);

let widthWrites = 0;
let heightWrites = 0;
let backingWidth = 0;
let backingHeight = 0;
const fakeCanvas = {
  get width() {
    return backingWidth;
  },
  set width(value: number) {
    backingWidth = value;
    widthWrites += 1;
  },
  get height() {
    return backingHeight;
  },
  set height(value: number) {
    backingHeight = value;
    heightWrites += 1;
  },
  style: { width: '', height: '' },
};
assert.equal(syncOfficeCanvasBackingStore(fakeCanvas, 320, 180, 2), true);
assert.equal(syncOfficeCanvasBackingStore(fakeCanvas, 320, 180, 2), false);
assert.deepEqual(
  [widthWrites, heightWrites],
  [1, 1],
  'an animation frame with stable size does not reset the canvas backing store',
);
assert.equal(syncOfficeCanvasBackingStore(fakeCanvas, 320, 180, 1.5), true);
assert.deepEqual([backingWidth, backingHeight], [480, 270]);
const officeScene2DSource = [
  read('apps/desktop/renderer/src/surfaces/office/scene/OfficeScene2D.tsx'),
  read('apps/desktop/renderer/src/surfaces/office/scene/render2d/background.ts'),
].join('\n');
assert.equal(
  CANVAS_FONT_TOKENS.canvasReset,
  '10px sans-serif',
  'the tokenized Canvas reset preserves the browser baseline value',
);
for (const baseline of [
  "ctx.filter = 'none'",
  "ctx.lineCap = 'butt'",
  "ctx.lineJoin = 'miter'",
  'ctx.shadowBlur = 0',
  'ctx.shadowOffsetX = 0',
  'ctx.shadowOffsetY = 0',
  'ctx.fillStyle = OFFICE_SCENE_2D_COLORS.name',
  'ctx.strokeStyle = OFFICE_SCENE_2D_COLORS.name',
  'ctx.shadowColor = OFFICE_SCENE_2D_COLORS.transparent',
  'ctx.font = CANVAS_FONT_TOKENS.canvasReset',
]) {
  assert.match(
    officeScene2DSource,
    new RegExp(baseline.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `stable-frame drawing restores the canvas baseline: ${baseline}`,
  );
}

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
  agent: false,
  status: 'loading' as const,
  url: 'https://example.com/old',
  title: null,
  canGoBack: false,
  canGoForward: false,
  sequence: 7,
  visible: true,
};
const browserNew = {
  ...browserBase,
  sequence: 8,
  status: 'ready' as const,
  url: 'https://example.com/new',
};
assert.equal(newestBrowserSnapshot(browserBase, browserNew), browserNew);
assert.equal(
  newestBrowserSnapshot(browserNew, { ...browserBase, sequence: 6 }),
  browserNew,
  'late command responses cannot overwrite newer native navigation events',
);
const browserOtherSession = {
  ...browserBase,
  sessionId: 'browser-b',
  sequence: 1,
  url: 'https://example.com/other',
};
assert.equal(
  newestBrowserSnapshot(browserNew, browserOtherSession),
  browserOtherSession,
  'a new browser tab resets sequence ordering instead of retaining a high-sequence prior tab',
);

for (const path of [
  'apps/desktop/src-tauri/capabilities/default.json',
  'apps/desktop/src-tauri/capabilities/agent-bridges.json',
  'apps/desktop/src-tauri/capabilities/fs-shell.json',
  'apps/desktop/src-tauri/capabilities/github.json',
]) {
  const capability = JSON.parse(read(path)) as Record<string, unknown>;
  assert.deepEqual(capability.webviews, ['main'], `${path} targets the main renderer`);
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
assert.match(terminalSource, /nextUnlisten\(\)/, 'late terminal listeners dispose themselves');
assert.doesNotMatch(
  terminalSource,
  /terminal_session_close/,
  'terminal close ownership stays with the generation-aware reconciler',
);
assert.doesNotMatch(terminalSource, /localStorage|sessionStorage/);

const browserSource = [
  read('apps/desktop/renderer/src/surfaces/office/stage-browser/BrowserSessionView.tsx'),
  read('apps/desktop/renderer/src/surfaces/office/stage-browser/use-agent-browser-sessions.ts'),
].join('\n');
const nativeBoundsSource = read(
  'apps/desktop/renderer/src/surfaces/office/stage-browser/native-bounds.ts',
);
const browserNativeSource = read('apps/desktop/src-tauri/src/browser_session.rs');
assert.match(browserSource, /Only http:\/\/ and https:\/\//);
assert.match(browserSource, /No local access/);
assert.match(browserSource, /ResizeObserver/);
assert.match(browserSource, /nextUnlisten\(\)/, 'late browser listeners dispose themselves');
assert.match(browserSource, /runIfLatest/, 'browser cleanup is generation-gated');
assert.doesNotMatch(
  `${browserSource}\n${nativeBoundsSource}`,
  /Math\.max\(\s*(120|80)\b/,
  'no forced native minimum bounds',
);
assert.doesNotMatch(
  `${browserSource}\n${nativeBoundsSource}`,
  /devicePixelRatio/,
  'native bounds stay in Tauri logical coordinates',
);
assert.match(
  browserSource,
  /requestAnimationFrame/,
  'ResizeObserver/geometry updates are coalesced through requestAnimationFrame',
);
assert.match(
  browserSource,
  /sameNativeBounds/,
  'bounds are only re-sent when rounded logical bounds change',
);
assert.match(
  browserSource,
  /computeVisibleNativeBounds/,
  'native bounds derive from the host rect intersected with the viewport',
);
assert.match(
  browserSource,
  /<div ref=\{hostRef\} className="off-browser-native-host"/,
  'the native canvas tracks the dedicated host grid track below the Browser chrome',
);
assert.match(
  browserSource,
  /const rect = host\.getBoundingClientRect\(\)/,
  'chrome exclusion is the host element layout contract, not a chrome measurement',
);
assert.doesNotMatch(
  `${browserSource}\n${nativeBoundsSource}`,
  /computeNativeContentRect|measureChromeContentHeight|chromeObserver/,
  'no fragile chrome-content measuring: the host rect already excludes app-owned chrome',
);
assert.match(
  browserSource,
  /observer\.observe\(host\)/,
  'host geometry changes trigger native bounds resynchronization',
);
assert.match(
  browserSource,
  /window\.setInterval\(\(\) => \{[\s\S]*?scheduleSync\(\);[\s\S]*?browser_session_snapshot/,
  'the snapshot poll also resyncs geometry so missed or failed bounds updates converge',
);
assert.match(
  browserSource,
  /visible !== lastVisible/,
  'zero-area and overlay-blocked hosts hide the native WebView instead of sending zero bounds',
);
assert.match(
  browserSource,
  /MutationObserver/,
  'application overlays trigger a native visibility resync',
);
assert.match(
  browserSource,
  /document\.addEventListener\('scroll', scheduleSync, true\)/,
  'ancestor scrolling resyncs the native child even when the DOM host size does not change',
);
assert.match(
  browserSource,
  /NATIVE_SURFACE_OVERLAY_SELECTOR/,
  'overlay detection reuses the shared portal-surface contract',
);
assert.match(
  browserSource,
  /if \(!bounds \|\| !visible\) return/,
  'a native child is never created while clipped or covered by an overlay',
);
assert.match(
  browserSource,
  /else if \(visible\) return/,
  'a failed bounds update cannot reveal a native child at stale geometry',
);
assert.match(
  browserSource,
  /event\.key\.toLowerCase\(\) !== 'l'/,
  'Cmd/Ctrl+L focuses the Offisim address bar even when the main renderer owns focus',
);
assert.match(
  browserNativeSource,
  /fn bounds_in_parent_window/,
  'native placement converts renderer viewport bounds into parent window coordinates',
);
assert.match(
  browserNativeSource,
  /contentLayoutRect/,
  'macOS native placement reads the actual unobscured content inset instead of hard-coding a title-bar height',
);
assert.match(
  browserNativeSource,
  /add_child\([\s\S]*?LogicalPosition::new\(native_bounds\.x, native_bounds\.y\)[\s\S]*?LogicalSize::new\(native_bounds\.width, native_bounds\.height\)/,
  'native Browser creation offsets the renderer bounds into parent window coordinates',
);
assert.match(
  browserNativeSource,
  /browser_session_set_bounds[\s\S]*?\.set_bounds\(native_bounds\.native_rect\(\)\)/,
  'native Browser updates preserve the same renderer-to-parent coordinate contract',
);
assert.match(
  browserNativeSource,
  /\.focused\(false\)/,
  'creating the native child does not steal focus from the address bar',
);
{
  const viewport = { width: 1280, height: 800 };
  assert.deepEqual(
    computeVisibleNativeBounds({ left: 100, top: 50, right: 700, bottom: 500 }, viewport),
    { x: 100, y: 50, width: 600, height: 450 },
  );
  assert.deepEqual(
    computeVisibleNativeBounds({ left: -40, top: 60, right: 300, bottom: 400 }, viewport),
    { x: 0, y: 60, width: 300, height: 340 },
    'the host rect is clipped to the app viewport',
  );
  assert.deepEqual(
    computeVisibleNativeBounds({ left: 1200, top: 100, right: 1400, bottom: 400 }, viewport),
    { x: 1200, y: 100, width: 80, height: 300 },
    'a partially offscreen host keeps only its visible area',
  );
  assert.equal(
    computeVisibleNativeBounds({ left: 1300, top: 100, right: 1400, bottom: 400 }, viewport),
    null,
    'a fully offscreen host reports no visible area',
  );
  assert.equal(
    computeVisibleNativeBounds({ left: 100, top: 100, right: 100, bottom: 400 }, viewport),
    null,
    'a zero-width host reports no visible area',
  );
  assert.equal(
    sameNativeBounds({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 4 }),
    true,
  );
  assert.equal(
    sameNativeBounds({ x: 1, y: 2, width: 3, height: 4 }, { x: 2, y: 2, width: 3, height: 4 }),
    false,
    'a 1px logical change is a bounds change',
  );
  assert.equal(sameNativeBounds(null, null), true);
  assert.equal(sameNativeBounds(null, { x: 0, y: 0, width: 1, height: 1 }), false);
  const hostRect = { left: 100, top: 100, right: 400, bottom: 400 };
  assert.equal(
    anyOverlayIntersectsHost(hostRect, [{ left: 300, top: 120, right: 520, bottom: 320 }]),
    true,
    'an overlay intersecting the host must appear above the native surface',
  );
  assert.equal(
    anyOverlayIntersectsHost(hostRect, [{ left: 500, top: 120, right: 720, bottom: 320 }]),
    false,
    'a non-intersecting overlay does not hide the native surface',
  );
  assert.equal(anyOverlayIntersectsHost(hostRect, []), false);
  assert.equal(rectsIntersect(hostRect, hostRect), true);
  assert.equal(
    NATIVE_SURFACE_OVERLAY_SELECTOR,
    '[data-radix-popper-content-wrapper]',
    'the overlay contract tracks the shared Radix portal surface',
  );
}
const stageViewerSource = [
  read('apps/desktop/renderer/src/surfaces/office/stage-viewer/StageViewer.tsx'),
  read('apps/desktop/renderer/src/surfaces/office/stage-viewer/views/ChangesView.tsx'),
].join('\n');
const officeStageSource = read('apps/desktop/renderer/src/surfaces/office/OfficeStage.tsx');
assert.match(
  officeStageSource,
  /nativeViewOwnsTheCanvas/,
  'native Browser, Terminal, and Computer views replace the canvas instead of revealing the Game View PiP behind them',
);
assert.match(
  officeStageSource,
  /ownsNativeCanvas\(splitTarget\?\.kind\)/,
  'a native Browser, Terminal, or Computer split pane also owns the canvas and suppresses Game View PiP',
);
assert.match(
  stageViewerSource,
  /<BrowserSessionView key=\{target\.sessionId\} target=\{target\} \/>/,
  'browser session changes remount local snapshot/address state at the session boundary',
);
assert.doesNotMatch(
  browserSource,
  /browser_session_close/,
  'a stale browser mount delegates close ownership to the reconciler',
);

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

console.log(
  'native-stage-sessions: PASS (targets, lifecycle, ACL, 16 typed commands, native bounds contract)',
);
