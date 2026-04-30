import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitTailwindThemeCss } from '../packages/ui-core/dist/tokens/index.js';

/**
 * Verifies the committed generated Tailwind CSS matches the ui-core token SSOT.
 * The commit header line is ignored so release metadata does not create churn.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const generatedFile = resolve(rootDir, 'apps/web/src/generated/tailwind-theme.css');

function readGitSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'dev';
  }
}

function normalizeHeader(css) {
  return css
    .split('\n')
    .map((line) => (line.startsWith('/* AUTO-GENERATED') ? '/* AUTO-GENERATED HEADER */' : line))
    .join('\n');
}

if (!existsSync(generatedFile)) {
  console.error(`Missing generated theme file: ${generatedFile}`);
  process.exit(1);
}

const expected = normalizeHeader(emitTailwindThemeCss(readGitSha()));
const actual = normalizeHeader(readFileSync(generatedFile, 'utf8'));

if (actual !== expected) {
  const actualLines = actual.split('\n');
  const expectedLines = expected.split('\n');
  const max = Math.max(actualLines.length, expectedLines.length);
  for (let i = 0; i < max; i += 1) {
    if (actualLines[i] !== expectedLines[i]) {
      console.error(`Generated Tailwind theme is stale at line ${i + 1}.`);
      console.error(`actual:   ${actualLines[i] ?? '<missing>'}`);
      console.error(`expected: ${expectedLines[i] ?? '<missing>'}`);
      break;
    }
  }
  process.exit(1);
}
