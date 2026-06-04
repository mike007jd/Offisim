#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const reportOnly = process.argv.includes('--report');

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
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

function callExpressionBlock(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) return '';
  const bodyStart = text.indexOf('(', start);
  if (bodyStart < 0) return '';
  let depth = 0;
  for (let i = bodyStart; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    if (text[i] === ')') depth -= 1;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

const failures = [];
const warnings = [];

function fail(check, detail) {
  failures.push({ check, ...detail });
}

function warn(check, detail) {
  warnings.push({ check, ...detail });
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
  const relPath = 'apps/desktop/renderer/src/design-system/shell/IconBar.tsx';
  const text = read(relPath);
  const utilityFilter = callExpressionBlock(text, 'UTILITY_NAV.filter');
  const hasOfficeScopedStudio =
    /entry\.key\s*!==\s*['"]studio['"]/.test(utilityFilter) &&
    /surface\s*===\s*['"]office['"]/.test(utilityFilter) &&
    /surface\s*===\s*['"]studio['"]/.test(utilityFilter);
  const rendersFilteredEntries = /visibleEntries\.map\(/.test(text);
  if (!hasOfficeScopedStudio || !rendersFilteredEntries) {
    fail('Studio appears in global utility iconbar', {
      file: relPath,
      line: lineNumber(text, Math.max(0, text.indexOf('UTILITY_NAV'))),
      match:
        'IconBar must filter Studio to Office/Studio surfaces and render visibleEntries.map(...)',
    });
  }
}

{
  const relPath = 'apps/desktop/renderer/src/surfaces/market/market.css';
  const text = read(relPath);
  const card = cssBlock(text, '.off-mkt-card');
  const cover = cssBlock(text, '.off-mc-cover');
  const cardHeight = numericCssValue(card, 'height');
  const coverHeight = numericCssValue(cover, 'height');
  if (cardHeight === null || cardHeight > 180) {
    fail('Market card exceeds V3 inventory density', {
      file: relPath,
      line: lineNumber(text, text.indexOf('.off-mkt-card')),
      match: `.off-mkt-card height is ${cardHeight ?? 'missing'}px; expected <= 180px`,
    });
  }
  if (coverHeight === null || coverHeight > 70) {
    fail('Market cover band is too tall for normal cards', {
      file: relPath,
      line: lineNumber(text, text.indexOf('.off-mc-cover')),
      match: `.off-mc-cover height is ${coverHeight ?? 'missing'}px; expected about 60px`,
    });
  }
}

{
  const relPath = 'apps/desktop/renderer/src/surfaces/settings/settings.css';
  const text = read(relPath);
  const pane = cssBlock(text, '.off-set-pane');
  if (!/max-width:\s*720px/.test(pane)) {
    fail('Settings content is not constrained to 720px', {
      file: relPath,
      line: lineNumber(text, text.indexOf('.off-set-pane')),
      match: '.off-set-pane missing max-width: 720px',
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
    /padding:\s*3px/.test(tabs) &&
    /background:\s*var\(--off-surface-[12]\)/.test(tabs);
  if (!hasContainerGrammar) {
    fail('Personnel inspector tabs do not use V3 container grammar', {
      file: relPath,
      line: lineNumber(text, text.indexOf('.off-pers-insp-tabs')),
      match: '.off-pers-insp-tabs missing bordered 30-36px chip container grammar',
    });
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
