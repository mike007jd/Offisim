import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitTailwindThemeCss } from '../packages/ui-core/dist/tokens/index.js';

/**
 * Emits the committed Tailwind 4 theme CSS from the built ui-core token SSOT.
 * The SHA is trace metadata only; token values remain deterministic.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const outFile = resolve(rootDir, 'apps/desktop/renderer/src/generated/tailwind-theme.css');

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

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, emitTailwindThemeCss(readGitSha()), 'utf8');
