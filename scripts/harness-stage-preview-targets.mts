import assert from 'node:assert/strict';
import {
  stageTabForTarget,
  useUiState,
  type StageViewTarget,
} from '../apps/desktop/renderer/src/app/ui-state.js';
import {
  resolveViewerKind,
  trustLevelFor,
  type PreviewSourceRef,
  type ResolvedPreviewTarget,
} from '../apps/desktop/renderer/src/surfaces/office/stage-preview/preview-target.js';
import { parseCsvRows } from '../apps/desktop/renderer/src/surfaces/office/stage-preview/csv-parse.js';
import {
  mediaStreamUrl,
  mimeForPreviewExtension,
  planPreviewLoad,
  resolvePreviewMimeType,
} from '../apps/desktop/renderer/src/surfaces/office/stage-preview/preview-data.js';

let checks = 0;
let failures = 0;

function check(name: string, fn: () => void): void {
  checks += 1;
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

function resetUiState(): void {
  useUiState.setState(useUiState.getInitialState(), true);
}

console.log('stage-preview-targets gate');

check('resolver:md-extension-maps-markdown', () => {
  assert.equal(resolveViewerKind({ extension: 'md', hasText: true }), 'markdown');
});

check('resolver:mime-wins-over-extension', () => {
  assert.equal(
    resolveViewerKind({ mimeType: 'application/pdf', extension: 'txt', hasText: true }),
    'pdf',
  );
});

check('resolver:unknown-binary-unsupported', () => {
  assert.equal(resolveViewerKind({ extension: 'bin', hasText: false }), 'unsupported');
});

check('resolver:text-fallback-when-hasText', () => {
  assert.equal(resolveViewerKind({ extension: 'unknown', hasText: true }), 'text');
});

check('resolver:glb-maps-model3d', () => {
  assert.equal(resolveViewerKind({ extension: 'glb', hasText: false }), 'model3d');
});

check('resolver:vrm-maps-model3d', () => {
  assert.equal(resolveViewerKind({ extension: 'vrm', hasText: false }), 'model3d');
});

check('trust:workspace-file-is-workspace', () => {
  const ref: PreviewSourceRef = { source: 'workspace-file', path: '/repo/a.md' };
  assert.equal(trustLevelFor(ref), 'workspace');
});

check('trust:deliverable-is-generated', () => {
  const ref: PreviewSourceRef = { source: 'deliverable', deliverableId: 'del-1', threadId: null };
  assert.equal(trustLevelFor(ref), 'generated');
});

check('trust:computer-artifact-is-computer', () => {
  const ref: PreviewSourceRef = { source: 'computer-artifact', path: '/repo/out.png' };
  assert.equal(trustLevelFor(ref), 'computer');
});

check('ui-state:preview-target-maps-preview-tab', () => {
  const target: StageViewTarget = {
    kind: 'preview',
    ref: { source: 'workspace-file', path: '/repo/a.md' },
  };
  assert.equal(stageTabForTarget(target), 'preview');
});

check('ui-state:computer-target-maps-computer-tab', () => {
  assert.equal(stageTabForTarget({ kind: 'computer', threadId: 'thread-1' }), 'computer');
});

check('ui-state:tab-id-stable-for-same-file', () => {
  resetUiState();
  const target: StageViewTarget = {
    kind: 'preview',
    ref: { source: 'workspace-file', path: '/repo/a.md' },
  };
  useUiState.getState().openStageView(target);
  useUiState.getState().openStageView({ ...target, title: 'Renamed' });
  const state = useUiState.getState();
  assert.equal(state.stageOpenTabs.length, 1);
  assert.equal(state.activeStageTabId, 'preview:workspace-file:/repo/a.md');
});

check('ui-state:open-activate-close-roundtrip', () => {
  resetUiState();
  const previewTarget: StageViewTarget = {
    kind: 'preview',
    ref: { source: 'workspace-file', path: '/repo/a.md' },
  };
  const computerTarget: StageViewTarget = { kind: 'computer', threadId: 'thread-1' };
  useUiState.getState().openStageView(previewTarget);
  const previewTabId = useUiState.getState().activeStageTabId;
  assert.equal(useUiState.getState().stagePrimaryTab, 'preview');
  useUiState.getState().openStageView(computerTarget);
  assert.equal(useUiState.getState().stagePrimaryTab, 'computer');
  assert.equal(useUiState.getState().stageOpenTabs.length, 2);
  assert.ok(previewTabId);
  useUiState.getState().activateStageTab(previewTabId);
  assert.equal(useUiState.getState().stagePrimaryTab, 'preview');
  useUiState.getState().closeStageTab(previewTabId);
  assert.equal(useUiState.getState().stagePrimaryTab, 'computer');
  useUiState.getState().closeStageView();
  assert.equal(useUiState.getState().stagePrimaryTab, 'game');
  assert.deepEqual(useUiState.getState().stageView, { kind: 'scene' });
});

check('ui-state:split-view-pin-swap-close-roundtrip', () => {
  resetUiState();
  useUiState.getState().openStageView({ kind: 'changes', path: 'src/App.tsx' });
  const reviewTabId = useUiState.getState().activeStageTabId;
  useUiState.getState().openStageView({ kind: 'logs', sourceId: 'run-1', title: 'Terminal' });
  const terminalTabId = useUiState.getState().activeStageTabId;
  assert.ok(reviewTabId && terminalTabId);

  useUiState.getState().toggleStageSplitTab(reviewTabId);
  assert.equal(useUiState.getState().activeStageTabId, terminalTabId);
  assert.equal(useUiState.getState().stageSplitTabId, reviewTabId);
  assert.equal(useUiState.getState().scenePipCollapsed, false);

  useUiState.getState().activateStageTab(reviewTabId);
  assert.equal(useUiState.getState().activeStageTabId, reviewTabId);
  assert.equal(useUiState.getState().stageSplitTabId, terminalTabId);

  useUiState.getState().closeStageTab(terminalTabId);
  assert.equal(useUiState.getState().stageSplitTabId, null);
  assert.equal(useUiState.getState().activeStageTabId, reviewTabId);
});

check('ui-state:pinning-active-view-keeps-a-distinct-left-view', () => {
  resetUiState();
  useUiState.getState().openStageView({ kind: 'changes', path: 'src/App.tsx' });
  const reviewTabId = useUiState.getState().activeStageTabId;
  useUiState.getState().openStageView({ kind: 'logs', sourceId: 'run-1', title: 'Terminal' });
  const terminalTabId = useUiState.getState().activeStageTabId;
  assert.ok(reviewTabId && terminalTabId);

  useUiState.getState().toggleStageSplitTab(terminalTabId);
  assert.equal(useUiState.getState().activeStageTabId, reviewTabId);
  assert.equal(useUiState.getState().stageSplitTabId, terminalTabId);

  useUiState.getState().closeStageTab(reviewTabId);
  assert.equal(useUiState.getState().activeStageTabId, terminalTabId);
  assert.equal(useUiState.getState().stageSplitTabId, null);
});

check('ui-state:game-and-board-restore-single-view', () => {
  resetUiState();
  useUiState.getState().openStageView({ kind: 'changes', path: 'src/App.tsx' });
  const reviewTabId = useUiState.getState().activeStageTabId;
  useUiState.getState().openStageView({ kind: 'logs', sourceId: 'run-1', title: 'Terminal' });
  assert.ok(reviewTabId);
  useUiState.getState().toggleStageSplitTab(reviewTabId);

  useUiState.getState().openBoard();
  assert.equal(useUiState.getState().stagePrimaryTab, 'board');
  assert.equal(useUiState.getState().stageSplitTabId, null);

  useUiState.getState().activateStageTab(reviewTabId);
  const terminalTabId = useUiState
    .getState()
    .stageOpenTabs.find((tab) => tab.target.kind === 'logs')?.id;
  assert.ok(terminalTabId);
  useUiState.getState().toggleStageSplitTab(terminalTabId);
  useUiState.getState().setStagePrimaryTab('game');
  assert.equal(useUiState.getState().stagePrimaryTab, 'game');
  assert.equal(useUiState.getState().stageSplitTabId, null);
});

function resolved(
  ref: PreviewSourceRef,
  viewerKind: ResolvedPreviewTarget['viewerKind'],
  meta: ResolvedPreviewTarget['meta'] = { title: 'preview' },
): ResolvedPreviewTarget {
  return { ref, viewerKind, trustLevel: trustLevelFor(ref), meta };
}

check('data:workspace-md-loads-text-lane', () => {
  assert.equal(
    planPreviewLoad(
      resolved(
        { source: 'workspace-file', path: '/repo/README.md' },
        'markdown',
        { title: 'README.md', extension: 'md', path: '/repo/README.md' },
      ),
      { hasText: true },
    ),
    'text',
  );
});

check('data:mp4-routes-stream-no-read', () => {
  assert.equal(
    planPreviewLoad(
      resolved(
        { source: 'workspace-file', path: '/repo/demo.mp4' },
        'video',
        { title: 'demo.mp4', extension: 'mp4', path: '/repo/demo.mp4' },
      ),
    ),
    'stream',
  );
});

check('data:mp3-routes-stream-no-read', () => {
  assert.equal(
    planPreviewLoad(
      resolved(
        { source: 'workspace-file', path: '/repo/audio.mp3' },
        'audio',
        { title: 'audio.mp3', extension: 'mp3', path: '/repo/audio.mp3' },
      ),
    ),
    'stream',
  );
});

check('data:avi-routes-stream-for-codec-fallback', () => {
  assert.equal(
    planPreviewLoad(
      resolved(
        { source: 'workspace-file', path: '/repo/legacy.avi' },
        'video',
        { title: 'legacy.avi', extension: 'avi', path: '/repo/legacy.avi' },
      ),
    ),
    'stream',
  );
});

check('data:media-stream-url-encodes-path-and-project', () => {
  assert.equal(
    mediaStreamUrl('/repo/My File.mp4', 'proj-1'),
    'offisim-media://localhost/file?path=%2Frepo%2FMy+File.mp4&projectId=proj-1',
  );
});

check('data:docx-extension-official-mime', () => {
  assert.equal(
    mimeForPreviewExtension('docx'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
});

check('data:docx-zip-sniff-prefers-official-mime', () => {
  assert.equal(
    resolvePreviewMimeType('application/zip', 'docx'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
});

check('data:xlsx-routes-bytes', () => {
  assert.equal(
    planPreviewLoad(
      resolved(
        { source: 'workspace-file', path: '/repo/book.xlsx' },
        'spreadsheet',
        {
          title: 'book.xlsx',
          extension: 'xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          path: '/repo/book.xlsx',
        },
      ),
    ),
    'bytes',
  );
});

check('data:html-deliverable-inline-html', () => {
  assert.equal(
    planPreviewLoad(
      resolved(
        { source: 'deliverable', deliverableId: 'del-html', threadId: 'th', format: 'html' },
        'html',
        { title: 'page.html', extension: 'html', threadId: 'th' },
      ),
      { hasText: true },
    ),
    'inline-html',
  );
});

check('data:browser-localhost-embeds-url', () => {
  assert.equal(
    planPreviewLoad(
      resolved(
        { source: 'browser', url: 'http://localhost:5173/' },
        'browser',
        { title: 'Localhost', url: 'http://localhost:5173/' },
      ),
    ),
    'url',
  );
});

check('data:browser-external-falls-to-screenshot', () => {
  assert.equal(
    planPreviewLoad(
      resolved(
        { source: 'browser', url: 'https://example.com/' },
        'browser',
        { title: 'External', url: 'https://example.com/' },
      ),
      { hasScreenshot: true },
    ),
    'screenshot',
  );
});

check('csv:quoted-comma', () => {
  assert.deepEqual(parseCsvRows('name,notes\nA,\"hello, world\"'), [
    ['name', 'notes'],
    ['A', 'hello, world'],
  ]);
});

check('csv:escaped-quote', () => {
  assert.deepEqual(parseCsvRows('name,quote\nA,\"say \"\"hi\"\"\"'), [
    ['name', 'quote'],
    ['A', 'say "hi"'],
  ]);
});

check('csv:crlf', () => {
  assert.deepEqual(parseCsvRows('a,b\r\n1,2\r\n3,4'), [
    ['a', 'b'],
    ['1', '2'],
    ['3', '4'],
  ]);
});

console.log(`\nstage-preview-targets: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`stage-preview-targets gate FAILED with ${failures} failure(s)`);
  process.exit(1);
}
console.log('stage-preview-targets gate PASSED');
