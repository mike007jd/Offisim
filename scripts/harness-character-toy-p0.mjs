#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const harness = fileURLToPath(
  new URL('../apps/desktop/renderer/scripts/harness-character-toy-p0.mjs', import.meta.url),
);
const result = spawnSync(process.execPath, [harness], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
