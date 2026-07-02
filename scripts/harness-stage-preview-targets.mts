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
} from '../apps/desktop/renderer/src/surfaces/office/stage-preview/preview-target.js';

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

console.log(`\nstage-preview-targets: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`stage-preview-targets gate FAILED with ${failures} failure(s)`);
  process.exit(1);
}
console.log('stage-preview-targets gate PASSED');
