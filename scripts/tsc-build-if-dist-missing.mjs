import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const result = {
    project: 'tsconfig.json',
    outDir: 'dist',
    buildInfo: 'tsconfig.tsbuildinfo',
    extra: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--project' && argv[i + 1]) {
      result.project = argv[i + 1];
      i += 1;
      continue;
    }
    if (value === '--out-dir' && argv[i + 1]) {
      result.outDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (value === '--build-info' && argv[i + 1]) {
      result.buildInfo = argv[i + 1];
      i += 1;
      continue;
    }
    result.extra.push(value);
  }

  return result;
}

function collectExportTargets(value, acc = []) {
  if (typeof value === 'string') {
    acc.push(value);
    return acc;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectExportTargets(entry, acc);
    return acc;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectExportTargets(entry, acc);
  }
  return acc;
}

function hasMissingExportOutput(cwd) {
  const packageJsonPath = resolve(cwd, 'package.json');
  if (!existsSync(packageJsonPath)) return false;

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const targets = collectExportTargets(packageJson.exports).filter(
      (target) => typeof target === 'string' && target.startsWith('./dist/'),
    );
    return targets.some((target) => !existsSync(resolve(cwd, target)));
  } catch {
    return false;
  }
}

const options = parseArgs(process.argv.slice(2));
const cwd = process.cwd();
const outDir = resolve(cwd, options.outDir);
const buildInfo = resolve(cwd, options.buildInfo);

if ((!existsSync(outDir) || hasMissingExportOutput(cwd)) && existsSync(buildInfo)) {
  rmSync(buildInfo, { force: true });
}

const result = spawnSync('tsc', ['--project', options.project, ...options.extra], {
  cwd,
  stdio: 'inherit',
  env: process.env,
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);
