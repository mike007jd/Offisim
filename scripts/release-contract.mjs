import { readFileSync } from 'node:fs';
import path from 'node:path';

function jsonVersion(root, relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')).version;
}

export function readReleaseContract(root) {
  const version = String(jsonVersion(root, 'apps/desktop/src-tauri/tauri.conf.json') ?? '');
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(version)) {
    throw new Error('tauri.conf.json version must be an Apple-safe three-integer version');
  }
  const versionSources = [
    ['package.json', jsonVersion(root, 'package.json')],
    ['apps/desktop/package.json', jsonVersion(root, 'apps/desktop/package.json')],
    ['apps/desktop/renderer/package.json', jsonVersion(root, 'apps/desktop/renderer/package.json')],
    [
      'apps/desktop/src-tauri/Cargo.toml',
      /^version\s*=\s*"([^"]+)"/mu.exec(
        readFileSync(path.join(root, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8'),
      )?.[1],
    ],
    [
      'apps/desktop/src-tauri/Cargo.lock',
      /\[\[package\]\]\s+name\s*=\s*"offisim-desktop"\s+version\s*=\s*"([^"]+)"/mu.exec(
        readFileSync(path.join(root, 'apps/desktop/src-tauri/Cargo.lock'), 'utf8'),
      )?.[1],
    ],
  ];
  for (const [source, sourceVersion] of versionSources) {
    if (sourceVersion !== version) {
      throw new Error(`${source} version must exactly match tauri.conf.json (${version})`);
    }
  }
  const nodeVersion = readFileSync(path.join(root, '.nvmrc'), 'utf8').trim();
  if (process.version !== `v${nodeVersion}`) {
    throw new Error(`release must run with Node v${nodeVersion}; found ${process.version}`);
  }
  return { nodeVersion, version };
}
