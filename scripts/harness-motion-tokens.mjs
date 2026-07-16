#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const CSS_PATH = join(ROOT, 'apps/desktop/renderer/src/styles/motion.css');
const TS_PATH = join(ROOT, 'apps/desktop/renderer/src/styles/motion-tokens.ts');
const motionCss = readFileSync(CSS_PATH, 'utf8');
const motionTs = readFileSync(TS_PATH, 'utf8');

let failures = 0;
let checks = 0;

function check(name, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function parseCssDuration(name) {
  const match = new RegExp(`--off-motion-${name}:\\s*([\\d.]+)(ms|s)\\s*;`).exec(motionCss);
  if (!match) return null;
  const value = Number(match[1]);
  return match[2] === 'ms' ? value / 1000 : value;
}

function parseTsDuration(name) {
  const block = /export const MOTION_DURATION\s*=\s*\{([\s\S]*?)\}\s*as const;/.exec(motionTs)?.[1];
  if (!block) return null;
  const match = new RegExp(`\\b${name}:\\s*([\\d.]+)`).exec(block);
  return match ? Number(match[1]) : null;
}

function parseCssEase(name) {
  const match = new RegExp(`--off-motion-${name}:\\s*cubic-bezier\\(([^)]+)\\)\\s*;`).exec(
    motionCss,
  );
  return match ? match[1].split(',').map((value) => Number(value.trim())) : null;
}

function parseTsEase(name) {
  const block = /export const MOTION_EASE\s*=\s*\{([\s\S]*?)\}\s*as const;/.exec(motionTs)?.[1];
  if (!block) return null;
  const match = new RegExp(`\\b${name}:\\s*\\[([^\\]]+)\\]`).exec(block);
  return match ? match[1].split(',').map((value) => Number(value.trim())) : null;
}

console.log('motion-tokens gate');

for (const name of ['instant', 'fast', 'quick', 'base', 'slow']) {
  const cssValue = parseCssDuration(name);
  const tsValue = parseTsDuration(name);
  check(
    `${name} duration mirrors motion.css`,
    cssValue !== null && tsValue !== null && Math.abs(cssValue - tsValue) < 1e-9,
    `CSS=${String(cssValue)} TS=${String(tsValue)}`,
  );
}

for (const name of ['ease', 'spring']) {
  const cssValue = parseCssEase(name);
  const tsValue = parseTsEase(name);
  check(
    `${name} easing mirrors motion.css`,
    cssValue !== null && tsValue !== null && JSON.stringify(cssValue) === JSON.stringify(tsValue),
    `CSS=${JSON.stringify(cssValue)} TS=${JSON.stringify(tsValue)}`,
  );
}

const presets = /export const motionPresets\s*=\s*\{([\s\S]*?)\n\}\s*as const;/.exec(motionTs)?.[1];
check('motionPresets block is parseable', Boolean(presets));
check(
  'motionPresets contains no duration literals',
  Boolean(presets) && !/duration:\s*[\d.]/.test(presets),
);
check('motionPresets contains no easing arrays', Boolean(presets) && !/ease:\s*\[/.test(presets));

for (const name of ['off-spin', 'off-pulse', 'off-shimmer']) {
  check(`${name} shared keyframe exists`, new RegExp(`@keyframes\\s+${name}\\b`).test(motionCss));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`motion-tokens gate FAILED (${failures} failing)`);
  process.exit(1);
}
console.log('motion-tokens gate OK');
