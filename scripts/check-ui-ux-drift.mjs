#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const reportOnly = process.argv.includes('--report');

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
}

function maskCssNoise(text) {
  return text.replace(
    /\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g,
    (ignored) => ignored.replace(/[^\n]/g, ' '),
  );
}

function collectCssFiles(relDir) {
  const files = [];
  for (const entry of readdirSync(join(ROOT, relDir), { withFileTypes: true })) {
    const relPath = join(relDir, entry.name);
    if (entry.isDirectory()) files.push(...collectCssFiles(relPath));
    else if (entry.isFile() && relPath.endsWith('.css')) files.push(relPath);
  }
  return files;
}

function rightmostCompound(selector) {
  let start = 0;
  let roundDepth = 0;
  let squareDepth = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (char === '(') roundDepth += 1;
    else if (char === ')') roundDepth -= 1;
    else if (char === '[') squareDepth += 1;
    else if (char === ']') squareDepth -= 1;
    else if (roundDepth === 0 && squareDepth === 0 && /\s|>|\+|~/.test(char)) start = index + 1;
  }
  return selector.slice(start).trim();
}

function selectorTargetsConsumer(candidate, target) {
  const classPattern = /\.([_a-zA-Z][\w-]*)/g;
  if (
    target.includes(':first-child') &&
    candidate.includes(':last-child') &&
    !candidate.includes(':first-child')
  ) {
    return false;
  }
  if (
    target.includes(':last-child') &&
    candidate.includes(':first-child') &&
    !candidate.includes(':last-child')
  ) {
    return false;
  }

  const targetTail = rightmostCompound(target);
  const candidateTail = rightmostCompound(candidate);
  const terminalClass = [...targetTail.matchAll(classPattern)].at(-1)?.[1];
  if (terminalClass) {
    return new RegExp(`\\.${terminalClass}(?![\\w-])`).test(candidateTail);
  }
  const terminalTag = /^([a-z][\w-]*)/i.exec(targetTail)?.[1];
  if (!terminalTag) return false;
  const targetClasses = [...target.matchAll(classPattern)].map((match) => match[1]);
  const candidateClasses = new Set([...candidate.matchAll(classPattern)].map((match) => match[1]));
  if (targetClasses.some((name) => !candidateClasses.has(name))) return false;
  return new RegExp(`(?<![.#\\w-])${terminalTag}(?![\\w-])`, 'i').test(candidateTail);
}

function cssBlocks(text, selector, includeRelatedSelectors = false) {
  const activeText = maskCssNoise(text);
  const normalizedTarget = selector.replace(/\s+/g, ' ').trim();
  const blocks = [];
  const splitSelectors = (prelude) => {
    const selectors = [];
    let start = 0;
    let roundDepth = 0;
    let squareDepth = 0;
    for (let index = 0; index < prelude.length; index += 1) {
      const char = prelude[index];
      if (char === '(') roundDepth += 1;
      else if (char === ')') roundDepth -= 1;
      else if (char === '[') squareDepth += 1;
      else if (char === ']') squareDepth -= 1;
      else if (char === ',' && roundDepth === 0 && squareDepth === 0) {
        selectors.push(prelude.slice(start, index));
        start = index + 1;
      }
    }
    selectors.push(prelude.slice(start));
    return selectors.map((item) => item.replace(/\s+/g, ' ').trim());
  };
  const matchingBrace = (open, end) => {
    let depth = 0;
    for (let index = open; index < end; index += 1) {
      if (activeText[index] === '{') depth += 1;
      else if (activeText[index] === '}') depth -= 1;
      if (depth === 0) return index;
    }
    return end;
  };
  const resolveNestedSelectors = (localSelectors, parentSelectors) => {
    if (parentSelectors.length === 0) return localSelectors;
    return parentSelectors.flatMap((parent) =>
      localSelectors.map((local) =>
        local.includes('&') ? local.replaceAll('&', parent) : `${parent} ${local}`,
      ),
    );
  };
  const visit = (start, end, parentSelectors = []) => {
    let cursor = start;
    while (cursor < end) {
      while (/\s|;/.test(activeText[cursor] ?? '')) cursor += 1;
      if (cursor >= end) break;
      let terminator = cursor;
      let roundDepth = 0;
      let squareDepth = 0;
      for (; terminator < end; terminator += 1) {
        const char = activeText[terminator];
        if (char === '(') roundDepth += 1;
        else if (char === ')') roundDepth -= 1;
        else if (char === '[') squareDepth += 1;
        else if (char === ']') squareDepth -= 1;
        else if ((char === '{' || char === ';') && roundDepth === 0 && squareDepth === 0) break;
      }
      if (terminator >= end) break;
      if (activeText[terminator] === ';') {
        cursor = terminator + 1;
        continue;
      }
      const prelude = activeText.slice(cursor, terminator).trim();
      const close = matchingBrace(terminator, end);
      if (/^@(media|supports|layer|container|scope|starting-style|document)\b/i.test(prelude)) {
        visit(terminator + 1, close, parentSelectors);
      } else if (!prelude.startsWith('@')) {
        const selectors = resolveNestedSelectors(splitSelectors(prelude), parentSelectors);
        const matches = includeRelatedSelectors
          ? selectors.some((candidate) => selectorTargetsConsumer(candidate, normalizedTarget))
          : selectors.includes(normalizedTarget);
        if (matches) {
          blocks.push({ block: text.slice(cursor, close + 1), index: cursor, selectors });
        }
        visit(terminator + 1, close, selectors);
      }
      cursor = close + 1;
    }
  };
  visit(0, activeText.length);
  return blocks;
}

function findMatches(relPath, pattern) {
  const text = read(relPath);
  const regex = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
  return [...text.matchAll(regex)].map((match) => ({
    file: relPath,
    line: lineNumber(text, match.index ?? 0),
    match: match[0].slice(0, 140).replace(/\s+/g, ' ').trim(),
  }));
}

function cssBlock(text, selector) {
  const start = text.indexOf(`${selector} {`);
  if (start < 0) return '';
  const bodyStart = text.indexOf('{', start);
  if (bodyStart < 0) return '';
  let depth = 0;
  for (let i = bodyStart; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') depth -= 1;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

function numericCssValue(block, property) {
  const match = new RegExp(`${property}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(block);
  return match ? Number(match[1]) : null;
}

const failures = [];
const warnings = [];

function fail(check, detail) {
  failures.push({ check, ...detail });
}

function warn(check, detail) {
  warnings.push({ check, ...detail });
}

function requireContract(check, file, text, pattern, expected) {
  if (pattern.test(text)) return;
  fail(check, { file, line: 1, match: expected });
}

function forbidContract(check, file, text, pattern, expected) {
  const match = pattern.exec(text);
  if (!match) return;
  fail(check, {
    file,
    line: lineNumber(text, match.index),
    match: expected,
  });
}

for (const detail of findMatches(
  'apps/desktop/renderer/src/surfaces/office/OfficeStage.tsx',
  /\bBell\b|off-stage-notif-count|bell badge|bell click|top-right chrome/i,
)) {
  fail('Office notification chrome reintroduced', detail);
}

for (const detail of findMatches(
  'apps/desktop/renderer/src/surfaces/office/office.css',
  /\.off-stage-notif-count\b/,
)) {
  fail('Office notification numeric count style', detail);
}

{
  const relPath = 'apps/desktop/renderer/src/surfaces/market/market.css';
  const text = read(relPath);
  const card = cssBlock(text, '.off-mkt-card');
  const cover = cssBlock(text, '.off-mc-cover');
  const cardHeight = numericCssValue(card, 'height');
  if (cardHeight === null || cardHeight > 180) {
    fail('Market card exceeds V3 inventory density', {
      file: relPath,
      line: lineNumber(text, text.indexOf('.off-mkt-card')),
      match: `.off-mkt-card height is ${cardHeight ?? 'missing'}px; expected <= 180px`,
    });
  }
  // The cover height is a derived contract (badge band + viz row + padding)
  // shared with the skeleton via local custom properties — assert both consume
  // the var rather than re-deriving literals that can drift apart.
  const skelCover = cssBlock(text, '.off-mkt-skel-cover');
  const coverUsesContract = /height:\s*var\(--off-mc-cover-h\)/.test(cover);
  const skelUsesContract = /height:\s*var\(--off-mc-cover-h\)/.test(skelCover);
  const contractDefined = /--off-mc-cover-h:\s*calc\(/.test(text);
  if (!contractDefined || !coverUsesContract || !skelUsesContract) {
    fail('Market cover geometry is not on the shared contract vars', {
      file: relPath,
      line: lineNumber(text, text.indexOf('.off-mc-cover')),
      match:
        '.off-mc-cover and .off-mkt-skel-cover must take height from --off-mc-cover-h (calc of band + viz + padding)',
    });
  }
}

{
  const relPath = 'apps/desktop/renderer/src/surfaces/settings/settings.css';
  const text = read(relPath);
  // The width cap moved from a hardcoded 720px on the pane to the shared
  // layout token consumed by the settings body grid.
  if (!/grid-template-columns:\s*minmax\(0,\s*var\(--off-form-col-max\)\)/.test(text)) {
    fail('Settings content is not constrained to the form column token', {
      file: relPath,
      line: lineNumber(text, text.indexOf('.off-set-pane')),
      match: 'settings.css missing grid-template-columns: minmax(0, var(--off-form-col-max))',
    });
  }
}

{
  const relPath = 'apps/desktop/renderer/src/surfaces/personnel/personnel.css';
  const text = read(relPath);
  const tabs = cssBlock(text, '.off-pers-insp-tabs');
  const hasContainerGrammar =
    /height:\s*3[0-6]px/.test(tabs) &&
    /border:\s*1px\s+solid/.test(tabs) &&
    /border-radius:\s*var\(--off-r-md\)/.test(tabs) &&
    /padding:\s*(?:3px|var\(--off-sp-1\))/.test(tabs) &&
    /background:\s*var\(--off-surface-[12]\)/.test(tabs);
  if (!hasContainerGrammar) {
    fail('Personnel inspector tabs do not use V3 container grammar', {
      file: relPath,
      line: lineNumber(text, text.indexOf('.off-pers-insp-tabs')),
      match: '.off-pers-insp-tabs missing bordered 30-36px chip container grammar',
    });
  }
}

{
  const tokenPath = 'apps/desktop/renderer/src/styles/tokens.css';
  const tokenText = read(tokenPath);
  const cssFiles = collectCssFiles('apps/desktop/renderer/src');
  const aliases = [
    ['--off-radius-control', '--off-r-sm'],
    ['--off-radius-container', '--off-r-md'],
    ['--off-radius-overlay', '--off-r-lg'],
    ['--off-radius-status', '--off-r-pill'],
    ['--off-radius-round', '--off-r-round'],
  ];
  for (const [alias, scale] of aliases) {
    const declarations = cssFiles.flatMap((file) => {
      const text = read(file);
      return [
        ...maskCssNoise(text).matchAll(new RegExp(`(?<![-\\w])${alias}\\s*:\\s*([^;}]*)`, 'g')),
      ].map((match) => ({ file, value: match[1]?.trim(), index: match.index ?? 0, text }));
    });
    if (
      declarations.length === 1 &&
      declarations[0]?.file === tokenPath &&
      declarations[0]?.value === `var(${scale})`
    ) {
      continue;
    }
    const first = declarations[0];
    fail('Semantic radius alias mapping drifted', {
      file: first?.file ?? tokenPath,
      line: first ? lineNumber(first.text, first.index) : lineNumber(tokenText, 0),
      match: `${alias} must be defined once, only in tokens.css, and map exactly to var(${scale})`,
    });
  }

  const consumers = [
    {
      file: 'apps/desktop/renderer/src/design-system/grammar/grammar.css',
      selector: '.off-seg',
      value: 'var(--off-radius-container)',
    },
    {
      file: 'apps/desktop/renderer/src/design-system/grammar/grammar.css',
      selector: '.off-seg-btn',
      value: 'var(--off-radius-control)',
    },
    {
      file: 'apps/desktop/renderer/src/design-system/grammar/grammar.css',
      selector: '.off-status-pill',
      value: 'var(--off-radius-status)',
    },
    {
      file: 'apps/desktop/renderer/src/surfaces/office/board/board.css',
      selector: '.off-board-segment',
      value: 'var(--off-radius-container)',
    },
    {
      file: 'apps/desktop/renderer/src/surfaces/office/board/board.css',
      selector: '.off-board-segment button',
      value: 'var(--off-radius-control)',
    },
    {
      file: 'apps/desktop/renderer/src/surfaces/office/office.css',
      selector: '.off-stage-render-toggle',
      value: 'var(--off-radius-container)',
    },
    {
      file: 'apps/desktop/renderer/src/surfaces/office/office.css',
      selector: '.off-stage-render-toggle .off-stage-mode-btn:first-child',
      value: 'var(--off-radius-control) 0 0 var(--off-radius-control)',
    },
    {
      file: 'apps/desktop/renderer/src/surfaces/office/office.css',
      selector: '.off-stage-render-toggle .off-stage-mode-btn:last-child',
      value: '0 var(--off-radius-control) var(--off-radius-control) 0',
    },
    {
      file: 'apps/desktop/renderer/src/surfaces/office/office.css',
      selector: '.off-pipe',
      value: 'var(--off-radius-container)',
    },
    {
      file: 'apps/desktop/renderer/src/surfaces/office/office.css',
      selector: '.off-pipe-dot',
      value: 'var(--off-radius-round)',
    },
    {
      file: 'apps/desktop/renderer/src/surfaces/office/office.css',
      selector: '.off-pipe-stop',
      value: 'var(--off-radius-control)',
    },
  ];
  for (const consumer of consumers) {
    const relatedRules = cssFiles.flatMap((file) => {
      const text = read(file);
      return cssBlocks(text, consumer.selector, true).map((rule) => ({ ...rule, file, text }));
    });
    const radiusRules = relatedRules
      .map((rule) => ({
        ...rule,
        declarations: [
          ...maskCssNoise(rule.block).matchAll(
            /(?<![-\w])((?:-[a-z]+-)?(?:border-radius|border-(?:top|bottom)-(?:left|right)-radius|border-(?:start|end)-(?:start|end)-radius))\s*:\s*([^;}]*)/gi,
          ),
        ].map((match) => ({ property: match[1]?.toLowerCase(), value: match[2]?.trim() })),
      }))
      .filter((rule) => rule.declarations.length > 0);
    const baseRule = radiusRules[0];
    if (
      radiusRules.length === 1 &&
      baseRule?.file === consumer.file &&
      baseRule.selectors.length === 1 &&
      baseRule.selectors[0] === consumer.selector &&
      baseRule.declarations.length === 1 &&
      baseRule.declarations[0]?.property === 'border-radius' &&
      baseRule.declarations[0]?.value === consumer.value
    ) {
      continue;
    }
    const text = baseRule?.text ?? read(consumer.file);
    fail('Semantic radius consumer drifted', {
      file: baseRule?.file ?? consumer.file,
      line: lineNumber(text, baseRule?.index ?? Math.max(0, text.indexOf(consumer.selector))),
      match: `${consumer.selector} must have one exact base radius ${consumer.value} and no state/cross-file override`,
    });
  }
}

{
  const appFramePath = 'apps/desktop/renderer/src/design-system/shell/AppFrame.tsx';
  const shellPath = 'apps/desktop/renderer/src/design-system/shell/shell.css';
  const officePath = 'apps/desktop/renderer/src/surfaces/office/office.css';
  const appFrame = read(appFramePath);
  const shell = read(shellPath);
  const office = read(officePath);
  const toggleCount = [...appFrame.matchAll(/className="off-topbar-rail-toggle off-focusable"/g)]
    .length;
  if (toggleCount !== 2) {
    fail('Office rail controls are not owned once by the topbar', {
      file: appFramePath,
      line: 1,
      match: `expected exactly 2 symmetric topbar rail controls, found ${toggleCount}`,
    });
  }
  const railTooltipCount = [
    ...appFrame.matchAll(
      /<TooltipContent side="bottom">\{(?:left|right)RailAction\}<\/TooltipContent>/g,
    ),
  ].length;
  if (railTooltipCount !== 2) {
    fail('Office rail controls lost their visible tooltips', {
      file: appFramePath,
      line: 1,
      match: `expected 2 dynamic rail tooltips, found ${railTooltipCount}`,
    });
  }
  requireContract(
    'Office left rail control lost visibility semantics',
    appFramePath,
    appFrame,
    /aria-expanded=\{leftRailVisible\}/,
    'left toggle must expose actual visibility through aria-expanded',
  );
  requireContract(
    'Office right rail control lost visibility semantics',
    appFramePath,
    appFrame,
    /aria-expanded=\{rightRailVisible\}/,
    'right toggle must expose actual visibility through aria-expanded',
  );
  requireContract(
    'Topbar no longer reserves a stable centered navigation column',
    shellPath,
    cssBlock(shell, '.off-topbar'),
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/,
    '.off-topbar must use symmetric 1fr / auto / 1fr columns',
  );
  forbidContract(
    'Left rail focus ring is clipped asymmetrically',
    shellPath,
    cssBlock(shell, '.off-topbar-start'),
    /overflow:\s*hidden/,
    '.off-topbar-start must not clip the 3.5px off-focusable ring',
  );

  const railSources = [
    'apps/desktop/renderer/src/surfaces/office/WorkspacePanel.tsx',
    'apps/desktop/renderer/src/surfaces/office/ChatRail.tsx',
    'apps/desktop/renderer/src/surfaces/office/TeamDock.tsx',
    officePath,
    'apps/desktop/renderer/src/surfaces/office/rail/connect/connect.css',
  ];
  for (const file of railSources) {
    const text = read(file);
    forbidContract(
      'Legacy rail collapse chrome or compensation returned',
      file,
      text,
      /off-rail-collapse|calc\([^;\n]*(?:\+\s*(?:32|34)px)|\bpr-12\b/,
      'rail content must not contain mini-rail chrome or 32/34px/pr-12 compensation',
    );
  }

  const collapsedColumns = [
    ['.off-office.is-left-collapsed', /^\s*0\s+minmax\(0,\s*1fr\)/m],
    ['.off-office.is-right-collapsed', /minmax\(0,\s*1fr\)\s+0\s*$/m],
    ['.off-office.is-left-collapsed.is-right-collapsed', /^\s*0\s+minmax\(0,\s*1fr\)\s+0\s*$/m],
  ];
  for (const [selector, pattern] of collapsedColumns) {
    const blocks = cssBlocks(office, selector);
    const valid =
      blocks.length > 0 &&
      blocks.every(({ block }) => {
        const value = /grid-template-columns:\s*([^;]+);/.exec(block)?.[1] ?? '';
        return pattern.test(value);
      });
    if (!valid) {
      fail('Collapsed Office rail still reserves a launcher column', {
        file: officePath,
        line: lineNumber(office, Math.max(0, office.indexOf(selector))),
        match: `${selector} must collapse its rail column to 0 in every responsive block`,
      });
    }
  }
  requireContract(
    'Collapsed Office panels remain rendered into the zero-width grid',
    officePath,
    office,
    /\.off-office\.is-left-collapsed \.off-ws-panel,\s*\.off-office\.is-right-collapsed \.off-rail\s*\{\s*display:\s*none;/,
    'collapsed workspace/chat panels must be display:none while their component state stays mounted',
  );

  forbidContract(
    'Visible token or cost output returned to the global topbar',
    appFramePath,
    appFrame,
    /off-topbar-cost|<output\b/,
    'AppFrame may coordinate budget alerts but must not render visible token/cost output',
  );
  requireContract(
    'Global budget alert coordination was removed with the visible cost output',
    appFramePath,
    appFrame,
    /useRunCost\(\)[\s\S]*toast\.warning\(/,
    'AppFrame must retain useRunCost alert querying and warning toasts',
  );
  const compactStart = office.indexOf('@media (max-width: 1500px)');
  const compactEnd = office.indexOf('/* === Staged attachments', compactStart);
  const compactPipe =
    compactStart >= 0 && compactEnd > compactStart ? office.slice(compactStart, compactEnd) : '';
  requireContract(
    'Compact run pipeline does not retain the active stage',
    officePath,
    compactPipe,
    /\.off-pipe-stage:not\(\.is-active\)/,
    'compact pipeline may hide only inactive stages',
  );
  requireContract(
    'Compact run pipeline lost deterministic step progress',
    officePath,
    compactPipe,
    /\.off-pipe-task > :not\(\.off-pipe-step\)/,
    'compact pipeline must preserve .off-pipe-step while hiding non-step task detail',
  );
  forbidContract(
    'Compact run pipeline hides the active stage label',
    officePath,
    compactPipe,
    /\.off-pipe-stage-label\s*\{[^}]*display:\s*none/,
    'active stage text must remain visible at compact widths',
  );

  const narrowStageStart = office.indexOf('@container off-stage (max-width: 420px)');
  const narrowStageEnd = office.indexOf('/* === Staged attachments', narrowStageStart);
  const narrowStage =
    narrowStageStart >= 0 && narrowStageEnd > narrowStageStart
      ? office.slice(narrowStageStart, narrowStageEnd)
      : '';
  requireContract(
    'Narrow Stage topbar no longer owns two non-clipping rows',
    officePath,
    narrowStage,
    /\.off-stage-topbar\s*\{[^}]*height:\s*calc\(var\(--off-stage-lane\) \* 2\)[^}]*flex-wrap:\s*wrap/,
    'the 256px Stage must wrap tabs and run controls into two local rows',
  );
  requireContract(
    'Narrow Stage content overlaps its two-row topbar',
    officePath,
    narrowStage,
    /\.off-scene-host,\s*\.off-stage-viewer\s*\{[^}]*inset:\s*calc\(var\(--off-stage-lane\) \* 2\) 0 0/,
    'scene and viewer content must begin below the local two-row topbar',
  );
  requireContract(
    'Narrow Stage run controls cannot shrink into the available row',
    officePath,
    narrowStage,
    /\.off-stage-topbar-right \.off-pipe\s*\{[^}]*flex:\s*1 1 0[^}]*min-width:\s*0/,
    'the compact pipeline must absorb narrow-row pressure without clipping cost or maximize',
  );
  requireContract(
    'Narrow Stage cost readout lost its bounded token/cost footprint',
    officePath,
    narrowStage,
    /\.off-stage-readout\s*\{[^}]*flex:\s*0 1 88px[^}]*max-width:\s*88px/,
    'token and cost values must retain a bounded readable footprint at 256px',
  );
}

{
  const navPath = 'apps/desktop/renderer/src/design-system/shell/WorkspaceNav.tsx';
  const shellPath = 'apps/desktop/renderer/src/design-system/shell/shell.css';
  const nav = read(navPath);
  const shell = read(shellPath);
  const labels = [...nav.matchAll(/<span className="off-nav-label">\{item\.label\}<\/span>/g)];
  if (labels.length !== 1) {
    fail('Workspace destinations do not have one stable label footprint', {
      file: navPath,
      line: 1,
      match: `expected one unconditional NAV_ENTRIES label template, found ${labels.length}`,
    });
  }
  requireContract(
    'Workspace destination labels became conditional',
    navPath,
    nav,
    /<Icon\b[^>]*\/>\s*<span className="off-nav-label">\{item\.label\}<\/span>/,
    'each mapped destination must render its icon immediately followed by an unconditional label',
  );
  forbidContract(
    'Workspace utility label is active-only again',
    navPath,
    nav,
    /active\s*[?&][^\n]{0,120}<span className="off-nav-label"/,
    'active state must not control label existence',
  );
  forbidContract(
    'Active workspace navigation changes button geometry',
    shellPath,
    cssBlock(shell, '.off-workspace-nav .is-active'),
    /\b(?:padding|width|display|font-weight)\s*:/,
    'active state may change tone only, never padding, width, label display, or font metrics',
  );
  forbidContract(
    'Workspace labels are hidden at a supported narrow width',
    shellPath,
    shell,
    /@media\s*\(max-width:\s*1280px\)[\s\S]{0,900}off-nav-label/,
    '1024px support compresses ScopeBar; it must not hide nav labels',
  );
  forbidContract(
    'Workspace navigation escaped the centered topbar grid',
    shellPath,
    cssBlock(shell, '.off-workspace-nav'),
    /position:\s*absolute/,
    'workspace nav must stay in the topbar center grid column',
  );
}

{
  const marketPath = 'apps/desktop/renderer/src/surfaces/market/MarketSurface.tsx';
  const marketCssPath = 'apps/desktop/renderer/src/surfaces/market/market.css';
  const market = read(marketPath);
  const marketCss = read(marketCssPath);
  for (const [file, text] of [
    [marketPath, market],
    [marketCssPath, marketCss],
  ]) {
    forbidContract(
      'Market transparent search placeholder returned',
      file,
      text,
      /off-mkt-search-placeholder/,
      'disconnected Market must not reserve an invisible search footprint',
    );
  }
  const modeIndex = market.indexOf('options={MODE_TABS}');
  const manageIndex = market.indexOf("{mode === 'manage' ? (");
  const searchIndex = market.indexOf('<SearchInput');
  const searchGuard = market.lastIndexOf(
    "{mode === 'explore' && !registryNotConnected ? (",
    searchIndex,
  );
  if (!(modeIndex >= 0 && modeIndex < manageIndex && manageIndex < searchIndex)) {
    fail('Market mode control is not the stable first toolbar group', {
      file: marketPath,
      line: 1,
      match: 'MODE_TABS must precede manage controls and search in source order',
    });
  }
  if (searchGuard < 0 || searchIndex - searchGuard > 220) {
    fail('Market search is rendered in an inert mode or connection state', {
      file: marketPath,
      line: lineNumber(market, Math.max(0, searchIndex)),
      match: "SearchInput must be guarded by mode === 'explore' && !registryNotConnected",
    });
  }
}

{
  const officePath = 'apps/desktop/renderer/src/surfaces/office/office.css';
  const teamPath = 'apps/desktop/renderer/src/surfaces/office/TeamDock.tsx';
  const office = read(officePath);
  const team = read(teamPath);
  const teamDockBlocks = cssBlocks(office, '.off-team');
  const teamDockBlock =
    teamDockBlocks.find(({ block }) => /overflow:\s*hidden/.test(block))?.block ?? '';
  requireContract(
    'Narrow TeamDock can spill into the chat rail',
    officePath,
    teamDockBlock,
    /min-width:\s*0[\s\S]*overflow:\s*hidden/,
    'the Stage-owned dock must contain its flex row at the 256px supported width',
  );
  const narrowTeamDock =
    teamDockBlocks.find(({ block }) => /display:\s*grid/.test(block))?.block ?? '';
  requireContract(
    'Supported narrow TeamDock does not reserve a full-width roster row',
    officePath,
    narrowTeamDock,
    /height:\s*104px[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto[\s\S]*grid-template-rows:\s*32px minmax\(0,\s*1fr\)/,
    'at <=1200px the dock must split summary/tools from a full-width scrollable roster',
  );
  const narrowDockStrip =
    cssBlocks(office, '.off-dock-strip').find(({ block }) => /grid-column:\s*1 \/ -1/.test(block))
      ?.block ?? '';
  requireContract(
    'Supported narrow TeamDock roster can collapse behind its tools',
    officePath,
    narrowDockStrip,
    /grid-column:\s*1 \/ -1[\s\S]*grid-row:\s*2[\s\S]*width:\s*100%/,
    'the roster must own the entire second row even while search/filter controls are open',
  );
  requireContract(
    'TeamDock label refuses to shrink before tools and cards',
    officePath,
    cssBlock(office, '.off-dock-label'),
    /flex:\s*0 1 180px[\s\S]*min-width:\s*0[\s\S]*max-width:\s*min\(180px,\s*40%\)/,
    'the dock summary must shrink and ellipsize instead of displacing tools into Chat',
  );
  for (const selector of ['.off-dock-title', '.off-dock-count']) {
    requireContract(
      'TeamDock summary lost bounded ellipsis behavior',
      officePath,
      cssBlock(office, selector),
      /max-width:\s*100%[\s\S]*overflow:\s*hidden[\s\S]*text-overflow:\s*ellipsis[\s\S]*white-space:\s*nowrap/,
      `${selector} must remain inside the shrinkable dock label`,
    );
  }
  requireContract(
    'Conversation viewport lost its shared content inset',
    officePath,
    cssBlock(office, '.off-thread-viewport'),
    /--off-thread-content-inset:\s*var\(--off-sp-6\)/,
    'thread viewport must own --off-thread-content-inset',
  );
  requireContract(
    'Messages no longer consume the shared conversation inset',
    officePath,
    cssBlock(office, '.off-messages'),
    /padding:[^;]*var\(--off-thread-content-inset\)/,
    'message horizontal padding must consume --off-thread-content-inset',
  );
  requireContract(
    'Chat error banner no longer aligns to the message column',
    officePath,
    cssBlock(office, '.off-errbanner'),
    /margin:[^;]*var\(--off-thread-content-inset\)/,
    'error banner horizontal margin must consume --off-thread-content-inset',
  );
  requireContract(
    'Chat error summary cannot wrap an unbroken failure message',
    officePath,
    cssBlock(office, '.off-errbanner-msg'),
    /min-width:\s*0[\s\S]*overflow-wrap:\s*anywhere/,
    'error summary must shrink and wrap long unbroken text without displacing Dismiss',
  );
  requireContract(
    'Chat technical detail cannot wrap an unbroken path or payload',
    officePath,
    cssBlock(office, '.off-errbanner-tech'),
    /max-width:\s*100%[\s\S]*white-space:\s*pre-wrap[\s\S]*overflow-wrap:\s*anywhere/,
    'technical detail must preserve lines and wrap long unbroken content inside the rail',
  );
  requireContract(
    'Runtime thread states no longer reach all live presence semantics',
    teamPath,
    team,
    /runState === 'running'\) return 'working';[\s\S]*runState === 'paused'\) return 'blocked';[\s\S]*runState === 'error'\) return 'failed';/,
    'running, paused, and error direct-thread states must project as working, blocked, and failed',
  );
  requireContract(
    'Presence detail copy contradicts the visible blocked/failed state',
    teamPath,
    team,
    /paused:\s*'Blocked'[\s\S]*error:\s*'Failed'/,
    'paused and error detail copy must match the Blocked and Failed presence labels',
  );
  const presenceContracts = [
    [/working:\s*'is-running'/, /working:\s*'Working'/, '.off-team-status.is-running'],
    [/idle:\s*'is-idle'/, /idle:\s*'Idle'/, '.off-team-status.is-idle'],
    [/blocked:\s*'is-blocked'/, /blocked:\s*'Blocked'/, '.off-team-status.is-blocked'],
    [/failed:\s*'is-failed'/, /failed:\s*'Failed'/, '.off-team-status.is-failed'],
    [/offline:\s*'is-offline'/, /offline:\s*'Offline'/, '.off-team-status.is-offline'],
  ];
  for (const [classPattern, textPattern, selector] of presenceContracts) {
    if (classPattern.test(team) && textPattern.test(team) && office.includes(selector)) continue;
    fail('Presence state lost static text/class/style semantics', {
      file: teamPath,
      line: 1,
      match: `${selector} must have an explicit class, visible label, and CSS treatment`,
    });
  }
  requireContract(
    'Blocked and failed presence shapes are no longer distinct',
    officePath,
    office,
    /\.off-team-status\.is-blocked \.off-team-dot\s*\{[^}]*border-radius:\s*0[^}]*background:\s*var\(--off-warn\)[^}]*\}[\s\S]*\.off-team-status\.is-failed \.off-team-dot\s*\{[^}]*background:\s*var\(--off-danger\)[^}]*transform:\s*rotate\(45deg\)/,
    'blocked must be a warning square and failed must be a danger diamond',
  );
  requireContract(
    'Offline presence lost its static distinction from idle',
    officePath,
    cssBlock(office, '.off-team-status.is-offline .off-team-dot'),
    /height:\s*2px[\s\S]*border-radius:\s*0[\s\S]*background:\s*currentColor[\s\S]*opacity:\s*0\.72/,
    'offline must use a short static dash while idle remains a hollow circle',
  );
  requireContract(
    'Presence labels lost their shared readable contrast',
    officePath,
    cssBlock(office, '.off-team-status'),
    /color:\s*var\(--off-ink-3\)/,
    'all five labels must inherit --off-ink-3; state color belongs only to decorative dots',
  );
  for (const state of ['running', 'idle', 'blocked', 'failed', 'offline']) {
    forbidContract(
      'Presence state applies low-contrast color or opacity to its label',
      officePath,
      cssBlock(office, `.off-team-status.is-${state}`),
      /\b(?:color|opacity)\s*:/,
      `${state} tone and opacity may affect only .off-team-dot`,
    );
  }
}

const docsWarningFiles = [
  'Docs/design/offisim-activity-prototype.html',
  'Docs/design/offisim-workspace-prototype.html',
  'Docs/design/offisim-market-prototype.html',
];

const docsPatterns = [
  { label: 'stale --fs-2xl token in design docs', pattern: /--fs-2xl\b/ },
  { label: 'stale --r-xl token in design docs', pattern: /--r-xl\b/ },
  { label: 'stale count badge class in design docs', pattern: /\.nb\b|class=["'][^"']*\bnb\b/ },
  { label: 'stale bell symbol in design docs', pattern: /i-bell\b/ },
  { label: 'hero language on dense workbench surface docs', pattern: /\bhero\b/i },
];

for (const relFile of docsWarningFiles) {
  const text = read(relFile);
  if (/data-v3-superseded|Superseded by V3 DNA/.test(text)) {
    continue;
  }
  for (const { label, pattern } of docsPatterns) {
    const regex = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
    for (const match of text.matchAll(regex)) {
      warn(label, {
        file: relFile,
        line: lineNumber(text, match.index ?? 0),
        match: match[0].slice(0, 140).replace(/\s+/g, ' ').trim(),
      });
    }
  }
}

if (failures.length > 0) {
  console.error('[check-ui-ux-drift] renderer drift found');
  for (const failure of failures) {
    console.error(`- ${failure.check}: ${failure.file}:${failure.line} :: ${failure.match}`);
  }
} else {
  console.log('[check-ui-ux-drift] renderer drift ok');
}

if (warnings.length > 0) {
  console.warn(`[check-ui-ux-drift] docs warnings: ${warnings.length}`);
  for (const warning of warnings.slice(0, 40)) {
    console.warn(`- ${warning.check}: ${warning.file}:${warning.line} :: ${warning.match}`);
  }
  if (warnings.length > 40) console.warn(`... ${warnings.length - 40} more docs warnings omitted`);
}

if (failures.length > 0 && !reportOnly) {
  process.exit(1);
}
