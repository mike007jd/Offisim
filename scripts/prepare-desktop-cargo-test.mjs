#!/usr/bin/env node

import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// tauri-build resolves bundle resources and externalBin during cargo test even
// though tests never launch them. Generated runtime files are git-ignored, so a
// clean checkout needs inert placeholders. A real Tauri build always runs
// build:frontend first, which replaces every placeholder with its verified
// production artifact before bundling.
export function ensureDesktopCargoTestPrereqs() {
  const executableStubs = [
    path.join(root, 'apps/desktop/src-tauri/resources/node/bin/node'),
    path.join(root, 'apps/desktop/src-tauri/binaries/codex-app-server-aarch64-apple-darwin'),
  ];
  const fileStubs = [
    {
      path: path.join(root, 'apps/desktop/src-tauri/resources/pi-agent-host.mjs'),
      content: 'THIS IS A CARGO-TEST-ONLY STUB — run scripts/build-pi-agent-host.mjs\n',
    },
    {
      path: path.join(root, 'apps/desktop/src-tauri/resources/claude-agent-host.mjs'),
      content: 'THIS IS A CARGO-TEST-ONLY STUB — run scripts/build-claude-agent-host.mjs\n',
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
