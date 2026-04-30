import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const roots = [
  'apps/web/src',
  'packages/ui-office/src',
  'packages/ui-core/src',
  'packages/renderer/src',
];
const skipParts = [
  '/dist/',
  '/node_modules/',
  '/packages/ui-core/src/tokens/',
  '/apps/web/src/generated/',
  '/catalog/provider-source-registry/',
];
const fileExtensions = new Set(['.ts', '.tsx', '.css']);
const checks = [
  // Negative lookbehind avoids false positives from SVG fragment URLs (`url(#foo)`),
  // Tailwind arbitrary values (`bg-[#abc]`), URL fragments, and inline SVG attributes.
  { name: 'raw hex', regex: /(?<![\w[#=:'"(])#[0-9a-fA-F]{3,8}\b/g },
  { name: 'arbitrary z-index class', regex: /\bz-\[\d+\]/g },
  { name: 'arbitrary shadow class', regex: /\bshadow-\[/g },
  { name: 'inline zIndex number', regex: /\bzIndex\s*:\s*\d+/g },
  {
    name: 'hard-coded transition timing',
    regex: /\btransition\s*:\s*['"][^'"]*\b\d+(\.\d+)?s\b/g,
  },
];

function shouldSkip(file) {
  const normalized = file.replaceAll('\\', '/');
  return skipParts.some((part) => normalized.includes(part));
}

function extensionOf(file) {
  if (file.endsWith('.tsx')) return '.tsx';
  if (file.endsWith('.ts')) return '.ts';
  if (file.endsWith('.css')) return '.css';
  return '';
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry);
    if (shouldSkip(file)) continue;
    const stat = statSync(file);
    if (stat.isDirectory()) {
      yield* walk(file);
    } else if (fileExtensions.has(extensionOf(file))) {
      yield file;
    }
  }
}

const violations = [];
for (const root of roots) {
  const absRoot = resolve(rootDir, root);
  for (const file of walk(absRoot)) {
    const content = readFileSync(file, 'utf8');
    const fileAllowsRawHex = content.includes('raw-hex-allowed-file');
    const lines = content.split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (line.includes('// raw-hex-allowed')) continue;
      for (const check of checks) {
        if (check.name === 'raw hex' && fileAllowsRawHex) continue;
        check.regex.lastIndex = 0;
        let match = check.regex.exec(line);
        while (match !== null) {
          violations.push({
            file: relative(rootDir, file),
            line: lineIndex + 1,
            column: match.index + 1,
            literal: match[0],
            name: check.name,
          });
          match = check.regex.exec(line);
        }
      }
    }
  }
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line}:${violation.column}: ${violation.name}: ${violation.literal}`,
    );
  }
  process.exit(1);
}
