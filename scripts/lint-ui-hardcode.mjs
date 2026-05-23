import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const defaultRoots = [
  'apps/desktop/renderer/src/components',
  'packages/ui-office/src/components',
  'packages/ui-core/src/components',
  'packages/ui-core/src/tokens',
];
const scanRoots = process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultRoots;
const fileExtensions = new Set(['.ts', '.tsx', '.css']);
const skipParts = ['/dist/', '/node_modules/', '/src-tauri/', '/generated/', '/assets/'];
const runtimeGeometryFiles = [
  '/packages/ui-office/src/components/office/editor/PresetPalette.tsx',
  '/packages/ui-office/src/components/scene/MeetingBubble3D.tsx',
  '/packages/ui-office/src/components/scene/ManagerPresence3D.tsx',
  '/packages/ui-office/src/components/scene/Office2DCanvasView.tsx',
  '/packages/ui-office/src/components/scene/Office3DView.tsx',
  '/packages/ui-office/src/components/scene/PerformanceHUD.tsx',
  '/packages/ui-office/src/components/scene/office3d-employees.tsx',
  '/packages/ui-office/src/components/scene/office3d-primitives.tsx',
  '/packages/ui-office/src/components/scene/office3d-scene-primitives.tsx',
  '/packages/ui-office/src/components/scene/office3d-sections.tsx',
  '/packages/ui-office/src/components/scene/scene-error-panel.tsx',
  '/packages/ui-office/src/components/scene/character-mesh-builder.tsx',
  '/packages/ui-office/src/components/scene/hooks/useCanvasViewport.ts',
  '/packages/ui-office/src/components/scene/prefabs/RestAreaMesh3D.tsx',
  '/packages/ui-office/src/components/scene/prefabs/WorkstationMesh3D.tsx',
  '/packages/ui-office/src/components/studio/StudioCanvas.tsx',
  '/packages/ui-office/src/components/studio/StudioGhost.tsx',
  '/packages/ui-office/src/components/studio/StudioPlacedPrefabs.tsx',
  '/packages/ui-office/src/components/studio/StudioZoneGhost.tsx',
];
const allowedMarker = 'ui-hardcode-allowed';
const primitiveImplementationParts = [
  '/packages/ui-core/src/components/badge.tsx',
  '/packages/ui-core/src/components/button.tsx',
  '/packages/ui-core/src/components/input.tsx',
  '/packages/ui-core/src/components/overlay-shell.tsx',
  '/packages/ui-core/src/components/segmented-control.tsx',
  '/packages/ui-core/src/components/textarea.tsx',
  '/packages/ui-core/src/components/toast-banner.tsx',
];

const checks = [
  {
    name: 'inline style object',
    regex: /\bstyle=\{/g,
    note: 'move layout/styling to Tailwind token classes, CSS variables on primitives, or mark runtime geometry with ui-hardcode-allowed',
  },
  {
    name: 'raw interactive element',
    regex: /<(?:button|input|textarea|select)\b/g,
    note: 'use shadcn/ui-core primitives unless this is a hidden file input or explicitly allowed',
  },
  {
    name: 'inline grid template',
    regex: /\bgridTemplate(?:Columns|Rows)\s*:/g,
    note: 'use flex, named CSS utility, or shared split layout primitive',
  },
  {
    name: 'inline visual styling',
    regex: /\b(?:boxShadow|background|backgroundColor|borderRadius|borderColor|color|zIndex)\s*:/g,
    note: 'use semantic tokens, variants, and shadcn/ui-core components',
  },
  {
    name: 'color-mix outside tokens',
    regex: /\bcolor-mix\(/g,
    note: 'encode the value in tokens or a shared variant instead of per-component styling',
  },
  {
    name: 'arbitrary Tailwind value',
    regex:
      /\b(?:-?[a-z0-9]+:|[a-z0-9-]+\[[^\]]+\]:)*(?:bg|border|ring|from|via|to|w|h|min-w|max-w|min-h|max-h|size|gap|px|py|p|m|mt|mb|ml|mr|inset|top|right|bottom|left|rounded(?:-[trblxyse]|-[trbl][trbl])?|text|tracking|aspect|shadow|grid-cols|grid-rows|z)-\[[^\]]+\]/g,
    note: 'promote this to a token, named utility, or reusable primitive',
  },
  {
    name: 'space utility',
    regex: /\b(?:-?[a-z0-9]+:)*-?space-[xy]-\d/g,
    note: 'use flex/grid gap tokens instead of child-margin space utilities',
  },
  {
    name: 'legacy local token',
    regex:
      /\b(?:text|bg|border|ring)-(?:hud|ocean|sand|shell|pearl|koi|lobster|aqua|dawn|night|coral|kelp|sea|abyss|foam)(?:-[a-z0-9/]+)?\b/g,
    note: 'use shared semantic V3 tokens instead of surface-local palette names',
  },
];

function shouldSkip(file) {
  const normalized = file.replaceAll('\\', '/');
  return skipParts.some((part) => normalized.includes(part));
}

function shouldSkipCheck(file, checkName) {
  const normalized = file.replaceAll('\\', '/');
  if (
    checkName === 'color-mix outside tokens' &&
    normalized.includes('/packages/ui-core/src/tokens/')
  ) {
    return true;
  }
  if (
    (checkName === 'inline style object' ||
      checkName === 'inline visual styling' ||
      checkName === 'color-mix outside tokens') &&
    runtimeGeometryFiles.some((part) => normalized.endsWith(part))
  ) {
    return true;
  }
  return checkName === 'raw interactive element'
    ? primitiveImplementationParts.some((part) => normalized.endsWith(part))
    : false;
}

function* walk(entry) {
  const abs = resolve(rootDir, entry);
  if (shouldSkip(abs)) return;
  const stat = statSync(abs);
  if (stat.isDirectory()) {
    for (const child of readdirSync(abs)) {
      yield* walk(join(entry, child));
    }
    return;
  }
  if (fileExtensions.has(extname(abs))) yield abs;
}

const violations = [];
for (const root of scanRoots) {
  for (const file of walk(root)) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const previousLine = lineIndex > 0 ? lines[lineIndex - 1] : '';
      if (line.includes(allowedMarker) || previousLine.includes(allowedMarker)) continue;
      for (const check of checks) {
        if (shouldSkipCheck(file, check.name)) continue;
        check.regex.lastIndex = 0;
        let match = check.regex.exec(line);
        while (match !== null) {
          violations.push({
            file: relative(rootDir, file),
            line: lineIndex + 1,
            column: match.index + 1,
            literal: match[0],
            name: check.name,
            note: check.note,
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
      `${violation.file}:${violation.line}:${violation.column}: ${violation.name}: ${violation.literal} — ${violation.note}`,
    );
  }
  console.error(`\n${violations.length} UI hardcode violation(s) found.`);
  process.exit(1);
}

console.log('OK — no UI hardcode violations found.');
