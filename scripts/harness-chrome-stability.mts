import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_ENTRIES } from '../apps/desktop/renderer/src/app/nav-registry.js';
import { runPipelinePresentation } from '../apps/desktop/renderer/src/assistant/parts/run-pipeline-presentation.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const officeSurface = read('apps/desktop/renderer/src/surfaces/office/OfficeSurface.tsx');
const workspacePanel = read('apps/desktop/renderer/src/surfaces/office/WorkspacePanel.tsx');
const chatRail = read('apps/desktop/renderer/src/surfaces/office/ChatRail.tsx');
const teamDock = read('apps/desktop/renderer/src/surfaces/office/TeamDock.tsx');
const stageViewer = read('apps/desktop/renderer/src/surfaces/office/stage-viewer/StageViewer.tsx');
const runPill = read('apps/desktop/renderer/src/assistant/parts/RunPipelinePill.tsx');
const workspaceNav = read('apps/desktop/renderer/src/design-system/shell/WorkspaceNav.tsx');
const shellCss = read('apps/desktop/renderer/src/design-system/shell/shell.css');
const officeCss = read('apps/desktop/renderer/src/surfaces/office/office.css');
const connectCss = read('apps/desktop/renderer/src/surfaces/office/rail/connect/connect.css');

let passed = 0;

function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`✓ ${name}`);
}

check('Office rails use resizable zero-collapse panels with synchronized state', () => {
  assert.match(officeSurface, /<Group[\s\S]*orientation="horizontal"/);
  assert.match(officeSurface, /id="office-workspace"[\s\S]*collapsible[\s\S]*collapsedSize="0%"/);
  assert.match(officeSurface, /if \(!stageMaximized\) setLeftCollapsed\(size\.inPixels === 0\)/);
  assert.match(officeSurface, /if \(!stageMaximized\) setRightCollapsed\(size\.inPixels === 0\)/);
  assert.match(officeSurface, /id="office-conversations"[\s\S]*collapsedSize="0%"/);
  assert.match(officeCss, /\.off-office-aux-panel\s*{[\s\S]*overflow:\s*hidden/);
  assert.match(officeCss, /\.off-office-resize-handle\.is-hidden\s*{\s*display:\s*none/);
  assert.doesNotMatch(
    officeCss,
    /grid-area:\s*(workspace|stage|team|chat)/,
    'retired outer-grid placement would push panel children into implicit rows',
  );
});

check('the two rail toggles live only in Office top chrome', () => {
  assert.equal(stageViewer.match(/data-rail=/g)?.length, 2);
  assert.match(stageViewer, /data-rail="workspace"/);
  assert.match(stageViewer, /data-rail="conversations"/);
  for (const panel of [workspacePanel, chatRail]) {
    assert.doesNotMatch(panel, /off-rail-collapse|off-rail-icon-tab|Chevrons/);
    assert.doesNotMatch(panel, /office(?:Left|Right)RailCollapsed/);
  }
});

check('content headers and Team dock contain no rail compensation dead zones', () => {
  const relevantSource = [workspacePanel, chatRail, teamDock, officeCss, connectCss].join('\n');
  assert.doesNotMatch(relevantSource, /\+ 32px|\+ 34px|pr-12|absolute top-3 right-3/);
  assert.doesNotMatch(officeCss, /off-rail-collapse|off-rail-icon-tab/);
});

check('all six surfaces always render their names', () => {
  assert.deepEqual(
    NAV_ENTRIES.map((entry) => entry.label),
    ['Office', 'Loops', 'Personnel', 'Market', 'Studio', 'Settings'],
  );
  assert.match(workspaceNav, /<span className="off-nav-label">{item\.label}<\/span>/);
  assert.doesNotMatch(workspaceNav, /\(!isUtility \|\| active\).*off-nav-label/);
  assert.doesNotMatch(shellCss, /\.off-nav-label\s*{[^}]*display:\s*none/s);
});

check('surface active state never changes tab geometry', () => {
  const baseCss = shellCss.slice(0, shellCss.indexOf('@media (max-width: 1200px)'));
  assert.doesNotMatch(baseCss, /button\.is-icon\s*{[^}]*padding:/s);
  assert.doesNotMatch(baseCss, /button\.is-icon\.is-active\s*{[^}]*padding:/s);
  assert.match(shellCss, /\.off-workspace-nav button\s*{[^}]*padding:\s*0 var\(--off-sp-3\)/s);
});

check('laptop width compresses ScopeBar and nav spacing without hiding names', () => {
  assert.match(shellCss, /max-width:\s*clamp\(84px, calc\(50vw - 350px\), 460px\)/);
  const compact = shellCss.slice(shellCss.indexOf('@media (max-width: 1200px)'));
  assert.match(compact, /\.off-workspace-nav button,[\s\S]*padding:\s*0 var\(--off-sp-2\)/);
  assert.doesNotMatch(compact, /off-nav-label[\s\S]*display:\s*none/);
});

check('run phases map to deterministic progress', () => {
  const expected = [
    ['idle', 0, 0],
    ['preparing', 0, 1],
    ['running', 1, 1],
    ['awaiting-approval', 2, 1],
    ['completed', 4, 0],
    ['interrupted', 0, 0],
    ['failed', 0, 0],
  ] as const;
  for (const [phase, completed, activeCount] of expected) {
    const view = runPipelinePresentation(phase);
    assert.equal(view.completedStages, completed, phase);
    assert.equal(view.progressValue, (completed / 4) * 100, phase);
    assert.equal(
      view.stages.filter((stage) => stage.state === 'active').length,
      activeCount,
      phase,
    );
  }
});

check('only controller-owned active runs receive Stop', () => {
  assert.match(runPill, /const canStop = activeRun !== null/);
  assert.match(
    runPill,
    /canStop \? \([\s\S]*conversationRunController\.stop\(activeRun\.threadId\)/,
  );
  assert.match(runPill, /selectedRun\.phase === 'completed'/);
  assert.match(runPill, /selectedRun\.phase === 'interrupted'/);
  assert.match(runPill, /selectedRun\.phase === 'failed'/);
  assert.doesNotMatch(runPill, /if \(!run\) return null/);
});

check('idle and terminal states use meaningful status instead of a ghost Stop', () => {
  const idle = runPipelinePresentation('idle');
  const completed = runPipelinePresentation('completed');
  assert.equal(idle.phaseLabel, 'Ready');
  assert.equal(idle.terminalLabel, null);
  assert.equal(completed.phaseLabel, 'Complete');
  assert.equal(completed.terminalLabel, 'Done');
  assert.match(runPill, /run\?\.phase \?\? 'idle'/);
  assert.match(runPill, /presentation\.terminalLabel \? \([\s\S]*off-pipe-status/);
});

check('stage-width topbar partition retains tabs, progress, and the live action', () => {
  const topbarStart = officeCss.indexOf('.off-stage-topbar {');
  const topbarEnd = officeCss.indexOf('.off-stage-readout-div', topbarStart);
  const topbarCss = officeCss.slice(topbarStart, topbarEnd);
  const pipelineStart = officeCss.indexOf('/* === Pipeline pill');
  const pipelineEnd = officeCss.indexOf('/* === Staged attachments', pipelineStart);
  const pipelineCss = officeCss.slice(pipelineStart, pipelineEnd);
  assert.match(officeCss, /container:\s*off-stage \/ inline-size/);
  assert.match(
    officeCss,
    /@media \(max-width: 1100px\)[\s\S]*?\.off-stage-readout\s*{\s*display:\s*none/,
  );
  assert.match(topbarCss, /grid-template-columns:\s*minmax\(80px, 1fr\) max-content/);
  assert.match(
    topbarCss,
    /\.off-stage-topbar-tabs\s*{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden/s,
  );
  assert.match(topbarCss, /\.off-stage-tabs\s*{[^}]*min-width:\s*0;[^}]*overflow-x:\s*auto/s);
  assert.match(
    topbarCss,
    /\.off-stage-topbar-right\s*{[^}]*justify-self:\s*end;[^}]*overflow:\s*hidden/s,
  );
  assert.match(pipelineCss, /@container off-stage \(max-width: 920px\)/);
  assert.match(pipelineCss, /@container off-stage \(max-width: 420px\)/);
  assert.match(pipelineCss, /\.off-pipe-task\s*{\s*display:\s*none;/);
  for (const required of ['off-pipe-phase-label', 'off-pipe-progress', 'off-pipe-stop']) {
    assert.doesNotMatch(pipelineCss, new RegExp(`\\.${required}\\s*\\{[^}]*display:\\s*none`, 's'));
  }
});

console.log(`\nChrome stability harness: ${passed}/10 checks passed`);
