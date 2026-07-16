#!/usr/bin/env node

import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// tauri-build resolves bundle resources during cargo test even though tests
// never launch them. Generated runtime files are git-ignored, so a clean
// checkout needs inert placeholders. Codex is deliberately not listed here:
// the orchestration adapter launches the user's own CLI instead of bundling it.
export function ensureDesktopCargoTestPrereqs() {
  const executableStubs = [path.join(root, 'apps/desktop/src-tauri/resources/node/bin/node')];
  const fileStubs = [
    {
      path: path.join(root, 'apps/desktop/src-tauri/resources/pi-agent-host.mjs'),
      content: 'THIS IS A CARGO-TEST-ONLY STUB — run scripts/build-pi-agent-host.mjs\n',
    },
  ];

  for (const filePath of executableStubs) {
    if (existsSync(filePath)) continue;
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, '#!/bin/sh\nexit 1\n');
    chmodSync(filePath, 0o755);
    console.log(`[cargo-test-prereqs] stubbed missing executable ${filePath}`);
  }

  for (const stub of fileStubs) {
    if (existsSync(stub.path)) continue;
    mkdirSync(path.dirname(stub.path), { recursive: true });
    writeFileSync(stub.path, stub.content);
    console.log(`[cargo-test-prereqs] stubbed missing resource ${stub.path}`);
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  ensureDesktopCargoTestPrereqs();
}
