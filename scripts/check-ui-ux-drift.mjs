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

const failures = [];

function fail(check, detail) {
  failures.push({ check, ...detail });
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

if (failures.length > 0) {
  console.error('[check-ui-ux-drift] renderer drift found');
  for (const failure of failures) {
    console.error(`- ${failure.check}: ${failure.file}:${failure.line} :: ${failure.match}`);
  }
} else {
  console.log('[check-ui-ux-drift] renderer drift ok');
}

if (failures.length > 0 && !reportOnly) {
  process.exit(1);
}
