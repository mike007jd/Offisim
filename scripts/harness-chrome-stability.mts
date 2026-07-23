import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_ENTRIES } from '../apps/desktop/renderer/src/app/nav-registry.js';
import { runPipelinePresentation } from '../apps/desktop/renderer/src/assistant/parts/run-pipeline-presentation.js';
import {
  OFFICE_LAYOUT_BREAKPOINTS,
  OFFICE_PANEL_SIZES,
  officeRailTierForWidth,
  officeRailsCanCoexist,
  responsiveOfficeRailState,
} from '../apps/desktop/renderer/src/surfaces/office/office-layout.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const officeSurface = read('apps/desktop/renderer/src/surfaces/office/OfficeSurface.tsx');
const officeStage = read('apps/desktop/renderer/src/surfaces/office/OfficeStage.tsx');
const workspacePanel = read('apps/desktop/renderer/src/surfaces/office/WorkspacePanel.tsx');
const chatRail = read('apps/desktop/renderer/src/surfaces/office/ChatRail.tsx');
const teamDock = read('apps/desktop/renderer/src/surfaces/office/TeamDock.tsx');
const composerSettings = read(
  'apps/desktop/renderer/src/assistant/composer/ComposerSettingsMenu.tsx',
);
const composerTriggers = read('apps/desktop/renderer/src/assistant/composer/composer-triggers.ts');
const capabilityManifest = read(
  'apps/desktop/renderer/src/surfaces/office/rail/CapabilityManifest.tsx',
);
const aiAccounts = read('apps/desktop/renderer/src/surfaces/settings/AiAccountsPane.tsx');
const engineMark = read('apps/desktop/renderer/src/design-system/grammar/EngineMark.tsx');
const grammarCss = read('apps/desktop/renderer/src/design-system/grammar/grammar.css');
const engineBrandProvenance = read('Docs/architecture/2026-07-21-engine-brand-assets.md');
const stageViewer = [
  read('apps/desktop/renderer/src/surfaces/office/stage-viewer/StageViewer.tsx'),
  read('apps/desktop/renderer/src/surfaces/office/stage-viewer/StageTopBar.tsx'),
].join('\n');
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
  assert.match(officeSurface, /if \(!stageMaximized\) setLeftCollapsed\(size\.inPixels === 0\)/);
  assert.match(officeSurface, /if \(!stageMaximized\) setRightCollapsed\(size\.inPixels === 0\)/);
  assert.equal(
    officeSurface.match(/collapsedSize=\{0\}/g)?.length,
    2,
    'both rails collapse to a numeric zero width',
  );
  assert.doesNotMatch(
    officeSurface,
    /collapsedSize="/,
    'collapse size is numeric zero, never a percentage string',
  );
  assert.match(officeCss, /\.off-office-aux-panel\s*{[\s\S]*overflow:\s*hidden/);
  assert.match(officeCss, /\.off-office-resize-handle\.is-hidden\s*{\s*display:\s*none/);
  assert.doesNotMatch(
    officeCss,
    /grid-area:\s*(workspace|stage|team|chat)/,
    'retired outer-grid placement would push panel children into implicit rows',
  );
});

check('Office panels use the pixel sizing contract', () => {
  const workspacePanelJsx =
    officeSurface.match(/id="office-workspace"[\s\S]*?<\/Panel>/)?.[0] ?? '';
  assert.deepEqual(OFFICE_PANEL_SIZES.workspace, { default: 296, min: 244, max: 360 });
  assert.match(workspacePanelJsx, /defaultSize=\{OFFICE_PANEL_SIZES\.workspace\.default\}/);
  assert.match(workspacePanelJsx, /minSize=\{OFFICE_PANEL_SIZES\.workspace\.min\}/);
  assert.match(workspacePanelJsx, /maxSize=\{OFFICE_PANEL_SIZES\.workspace\.max\}/);
  assert.match(workspacePanelJsx, /groupResizeBehavior="preserve-pixel-size"/);
  const centerPanelJsx = officeSurface.match(/id="office-stage"[\s\S]*?<\/Panel>/)?.[0] ?? '';
  assert.deepEqual(OFFICE_PANEL_SIZES.stage, { min: 620 });
  assert.match(centerPanelJsx, /minSize=\{OFFICE_PANEL_SIZES\.stage\.min\}/);
  assert.match(centerPanelJsx, /groupResizeBehavior="preserve-relative-size"/);
  const conversationPanelJsx =
    officeSurface.match(/id="office-conversations"[\s\S]*?<\/Panel>/)?.[0] ?? '';
  assert.deepEqual(OFFICE_PANEL_SIZES.conversations, { default: 448, min: 400, max: 560 });
  assert.match(conversationPanelJsx, /defaultSize=\{OFFICE_PANEL_SIZES\.conversations\.default\}/);
  assert.match(conversationPanelJsx, /minSize=\{OFFICE_PANEL_SIZES\.conversations\.min\}/);
  assert.match(conversationPanelJsx, /maxSize=\{OFFICE_PANEL_SIZES\.conversations\.max\}/);
  assert.match(conversationPanelJsx, /groupResizeBehavior="preserve-pixel-size"/);
  assert.doesNotMatch(
    officeSurface,
    /(?:defaultSize|minSize|maxSize)="/,
    'panel sizes are numeric pixels, never percentages',
  );
});

check('responsive rail tiers collapse and restore around the wide layout', () => {
  assert.deepEqual(OFFICE_LAYOUT_BREAKPOINTS, { compactMax: 1100, wideMin: 1366 });
  assert.equal(officeRailTierForWidth(1366), 'wide');
  assert.equal(officeRailTierForWidth(1365), 'mid');
  assert.equal(officeRailTierForWidth(1101), 'mid');
  assert.equal(officeRailTierForWidth(1100), 'compact');
  assert.deepEqual(responsiveOfficeRailState('wide', { left: false, right: true }), {
    left: false,
    right: true,
  });
  assert.deepEqual(responsiveOfficeRailState('mid', { left: false, right: false }), {
    left: true,
    right: false,
  });
  assert.deepEqual(responsiveOfficeRailState('mid', { left: false, right: true }), {
    left: true,
    right: true,
  });
  assert.deepEqual(responsiveOfficeRailState('compact', { left: false, right: false }), {
    left: true,
    right: true,
  });
  assert.equal(officeRailsCanCoexist(1265), false);
  assert.equal(officeRailsCanCoexist(1266), true);
  assert.match(
    officeSurface,
    /preResponsiveRails/,
    'the pre-responsive rail state is preserved for wide-mode restore',
  );
  assert.match(
    officeSurface,
    /responsiveOfficeRailState\(/,
    'responsive rail state is derived from the shared layout policy',
  );
  assert.match(
    stageViewer,
    /!officeRailsCanCoexist\(window\.innerWidth\)/,
    'opening a rail swaps the other one whenever all three panel minimums cannot coexist',
  );
  assert.doesNotMatch(
    [officeSurface, workspacePanel, chatRail].join('\n'),
    /48px|icon-rail|off-rail-icon/,
    'no 48px icon rail is introduced at narrow widths',
  );
});

check('height ownership is unbroken from the Group to the rails', () => {
  assert.match(officeCss, /\.off-office\s*{[^}]*position:\s*absolute;[^}]*inset:\s*0/s);
  assert.match(officeCss, /\.off-office-center\s*{[^}]*min-height:\s*0/s);
  assert.match(officeCss, /\.off-ws-panel\s*{[^}]*height:\s*100%[^}]*min-height:\s*0/s);
  assert.match(
    officeCss,
    /\.off-rail\s*{[^}]*height:\s*100%[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/s,
    'the chat rail owns its height so the composer pins to the rail bottom',
  );
  assert.match(
    officeCss,
    /\.off-thread\s*{[^}]*height:\s*100%[^}]*display:\s*flex;[^}]*flex-direction:\s*column/s,
  );
  assert.match(
    officeCss,
    /\.off-thread-viewport\s*{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto/s,
    'the message viewport is the sole vertical scroller of a thread',
  );
  assert.doesNotMatch(
    officeCss,
    /\.off-office\s*{[^}]*overflow:\s*(auto|scroll)/s,
    'the Office root never becomes a scroller',
  );
});

check('Team dock keeps a sole horizontal card scroller and a count-only label', () => {
  assert.match(
    officeCss,
    /\.off-team\s*{[^}]*overflow:\s*hidden/s,
    'the dock itself never scrolls or leaks horizontally',
  );
  assert.doesNotMatch(
    officeCss.match(/\.off-team\s*{[^}]*}/gs)?.join('\n') ?? '',
    /overflow:\s*visible|overflow-x:\s*auto/,
    'no late overflow:visible or dock-level scroller regression',
  );
  assert.match(
    officeCss,
    /\.off-dock-strip\s*{[^}]*flex:\s*1;[^}]*min-width:\s*0;[^}]*overflow-x:\s*auto/s,
    'the card strip is the only horizontal scroller',
  );
  assert.match(officeCss, /\.off-dock-label\s*{[^}]*flex:\s*none/s);
  assert.match(officeCss, /\.off-dock-tools\s*{[^}]*flex:\s*none/s);
  assert.doesNotMatch(
    teamDock,
    /companyModelSummary|modelSummary/,
    'the dock label carries no model summary',
  );
  assert.match(
    teamDock,
    /<span className="off-dock-count">\s*\{rosterSize\} \{rosterSize === 1 \? 'person' : 'people'\}\s*<\/span>/,
    'the dock label is only TEAM and the person count',
  );
  assert.doesNotMatch(teamDock, /addEventListener\('wheel'|onWheel/, 'no JS wheel interception');
});

check('Team and AI Accounts share Offisim-owned engine identity glyphs', () => {
  assert.match(teamDock, /<EngineMark[\s\S]*size=\{16\}/);
  assert.match(aiAccounts, /<EngineMark[\s\S]*size=\{32\}/);
  assert.match(officeCss, /\.off-team-card\s*{[^}]*width:\s*144px;[^}]*height:\s*56px/s);
  assert.match(officeCss, /\.off-dock-label\s*{[^}]*width:\s*96px/s);
  assert.doesNotMatch(teamDock, /Codex CLI<\/|Claude Code<\//);
  assert.doesNotMatch(engineMark, /style=\{|CSSProperties|--off-provider-brand/);
  assert.match(engineMark, /codex:\s*{[\s\S]*glyph:\s*'\{\}'/);
  assert.match(engineMark, /claude:\s*{[\s\S]*glyph:\s*'◇'/);
  assert.doesNotMatch(engineMark, /assets\/brands|<img|visual:\s*'image'/);
  assert.doesNotMatch(grammarCss, /off-engine-mark-image|data-visual="image"/);
  assert.match(engineBrandProvenance, /Offisim-owned glyphs/);
  assert.match(engineBrandProvenance, /no third-party image bytes/);
});

check('composer settings drill in within one menu and preserve footer space', () => {
  assert.doesNotMatch(composerSettings, /DropdownMenuSub/);
  assert.match(
    composerSettings,
    /type PickerLayer = 'root' \| 'model' \| 'reasoning' \| 'speed' \| 'mode'/,
  );
  assert.match(composerSettings, /ArrowLeft/);
  assert.match(composerSettings, /modelLeafId\(effectiveModel\)/);
  const trigger =
    composerSettings.match(
      /className="off-composer-chip off-composer-settings-chip[\s\S]*?<\/button>/,
    )?.[0] ?? '';
  assert.ok(trigger);
  assert.doesNotMatch(trigger, /SlidersHorizontal/);
  assert.equal(trigger.match(/<Icon/g)?.length, 1, 'the trigger keeps only its disclosure chevron');
  const settingsChipCss = officeCss.match(/\.off-composer-settings-chip\s*{[^}]*}/s)?.[0] ?? '';
  assert.match(settingsChipCss, /max-width:\s*160px/);
  assert.match(settingsChipCss, /flex:\s*0 1 auto/);
});

check('composer capabilities are quiet and slash palette owns advanced actions', () => {
  assert.match(capabilityManifest, /off-thread-pit-quiet/);
  assert.match(capabilityManifest, /aria-label=\{`Thread capabilities:/);
  assert.doesNotMatch(capabilityManifest, />\s*Tools\s*</);
  for (const category of ['Commands', 'Skills', 'Tools & MCP', 'Modes', 'Navigation']) {
    assert.ok(composerTriggers.includes(category), `missing slash category ${category}`);
  }
  assert.match(composerTriggers, /id: `skill:\$\{skill\.name\}`/);
  assert.match(composerTriggers, /id: `tool:\$\{tool\.id\}`/);
});

check('AI Accounts prioritizes subscriptions and merges provider activity', () => {
  const subscriptionIndex = aiAccounts.indexOf('<CapsLabel>Subscription engines</CapsLabel>');
  const providerIndex = aiAccounts.indexOf('<CapsLabel>API providers</CapsLabel>');
  assert.ok(subscriptionIndex >= 0 && providerIndex > subscriptionIndex);
  assert.match(aiAccounts, /off-set-provider-overview-row is-merged/);
  assert.match(aiAccounts, /off-set-provider-merged-body/);
  assert.doesNotMatch(aiAccounts, /<CapsLabel>API account activity<\/CapsLabel>/i);
  assert.doesNotMatch(aiAccounts, /off-set-pv-logo/);
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

check('only controller-owned active runs render progress and receive Stop', () => {
  assert.match(runPill, /const run = activeRun/);
  assert.match(runPill, /if \(!activeRun \|\| presentation\.phase === 'idle'\) return null/);
  assert.match(runPill, /conversationRunController\.stop\(activeRun\.threadId\)/);
  assert.doesNotMatch(runPill, /terminalRun|selectedRun\.phase ===|presentation\.terminalLabel/);
});

check('idle and terminal presentation remains defined but consumes no Stage chrome', () => {
  const idle = runPipelinePresentation('idle');
  const completed = runPipelinePresentation('completed');
  assert.equal(idle.phaseLabel, 'Ready');
  assert.equal(idle.terminalLabel, null);
  assert.equal(completed.phaseLabel, 'Complete');
  assert.equal(completed.terminalLabel, 'Done');
  assert.match(runPill, /run\?\.phase \?\? 'idle'/);
  assert.match(stageViewer, /if \(!isRunning\) return null/);
});

check(
  'stage tab row contains only tabs and layout controls; run status lives in content chrome',
  () => {
    const topbarSourceStart = stageViewer.indexOf('export function StageTopBar()');
    const topbarSourceEnd = stageViewer.indexOf('/** Run state belongs', topbarSourceStart);
    assert.ok(topbarSourceStart >= 0 && topbarSourceEnd > topbarSourceStart);
    const topbarSource = stageViewer.slice(topbarSourceStart, topbarSourceEnd);
    assert.doesNotMatch(
      topbarSource,
      /RunPipelinePill|off-stage-status-cluster|off-stage-readout|data-stage-run-status|accounting|isRunning|off-pipe|Stop/,
      'the view-tab row must never own run state, progress, usage, or Stop',
    );
    assert.match(topbarSource, /<nav className="off-stage-tabs" aria-label="Stage views">/);
    assert.match(topbarSource, /<StageViewMenu \/>/);
    assert.equal(topbarSource.match(/data-rail=/g)?.length, 2);
    assert.match(topbarSource, /off-stage-max-btn/);
    assert.match(
      stageViewer,
      /function StageViewerHead[\s\S]*<StageRunStatusCluster isRunning={isRunning} accounting={accounting} \/>/,
    );
    assert.match(
      officeStage,
      /stagePrimaryTab === 'game'[\s\S]*off-scene-hud[\s\S]*<StageRunStatusCluster isRunning={isRunning} accounting={accounting} \/>/,
    );
    assert.match(
      stageViewer,
      /className="off-stage-status-cluster" data-stage-run-status aria-label="Stage run status"/,
    );
    const topbarStart = officeCss.indexOf('.off-stage-topbar {');
    const topbarEnd = officeCss.indexOf('.off-stage-readout-div', topbarStart);
    const topbarCss = officeCss.slice(topbarStart, topbarEnd);
    const pipelineStart = officeCss.indexOf('/* === Pipeline pill');
    const pipelineEnd = officeCss.indexOf('/* === Staged attachments', pipelineStart);
    const pipelineCss = officeCss.slice(pipelineStart, pipelineEnd);
    assert.match(officeCss, /container:\s*off-stage \/ inline-size/);
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
    assert.match(pipelineCss, /@container off-stage-pane \(max-width: 760px\)/);
    assert.match(
      officeCss,
      /\.off-stage-viewer-pane\s*{[\s\S]*container:\s*off-stage-pane \/ inline-size/,
    );
    assert.match(pipelineCss, /\.off-pipe-task\s*{\s*display:\s*none;/);
    for (const required of ['off-pipe-phase-label', 'off-pipe-progress', 'off-pipe-stop']) {
      assert.doesNotMatch(
        pipelineCss,
        new RegExp(`\\.${required}\\s*\\{[^}]*display:\\s*none`, 's'),
      );
    }
  },
);

console.log(`\nChrome stability harness: ${passed} checks passed`);
