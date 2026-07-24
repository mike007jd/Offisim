#!/usr/bin/env node
// Redaction-pattern sync check across the MCP audit emit path, the agent-run
// parse path, and the renderer activity projection. Mirrored regex literals must
// remain byte-for-byte identical so no boundary silently accepts credential
// shapes that another boundary misses.
//
// Intentionally NOT in scope: apps/desktop/renderer/src/data/redact-secrets.ts.
// That is the display-layer ruleset (stricter token thresholds, URL userinfo
// credentials, personal-information heuristics) applied on top of already
// emit-redacted data; it is allowed to diverge from the disk-boundary patterns.

import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const EMIT_PATH = resolve(REPO_ROOT, 'scripts/pi-mcp-bridge-extension.mjs');
const PARSE_PATH = resolve(REPO_ROOT, 'packages/shared-types/src/events/agent-run.ts');
const ACTIVITY_PATH = resolve(REPO_ROOT, 'apps/desktop/renderer/src/data/board/activity-data.ts');

const PATTERN_SPECS = [
  { name: 'SENSITIVE_KEY_VALUE_PATTERN', files: [EMIT_PATH, PARSE_PATH] },
  { name: 'SENSITIVE_TOKEN_PATTERN', files: [EMIT_PATH, PARSE_PATH] },
  { name: 'SENSITIVE_KEY_NAME_PATTERN', files: [EMIT_PATH, ACTIVITY_PATH] },
];

function fail(message) {
  console.error(`FAIL — redaction-pattern-sync: ${message}`);
  process.exit(1);
}

function displayPath(filePath) {
  return relative(REPO_ROOT, filePath);
}

function readSource(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    fail(`could not read ${displayPath(filePath)}: ${error.message}`);
  }
}

function extractRegexLiteral(source, filePath, patternName) {
  const declarationPattern = new RegExp(
    `\\bconst\\s+${patternName}\\s*=\\s*(\\/(?:\\\\.|[^/\\\\\\r\\n])+\\/[dgimsuvy]*)\\s*;`,
    'g',
  );
  const matches = [...source.matchAll(declarationPattern)];
  if (matches.length !== 1) {
    fail(
      `expected exactly one \`const ${patternName} = /.../flags;\` literal in ${displayPath(filePath)}, found ${matches.length}. Restore that literal shape or update scripts/check-redaction-pattern-sync.mjs alongside the refactor.`,
    );
  }
  return matches[0][1];
}

function main() {
  for (const { name, files } of PATTERN_SPECS) {
    const [referencePath, ...mirrorPaths] = files;
    const referenceLiteral = extractRegexLiteral(readSource(referencePath), referencePath, name);
    for (const mirrorPath of mirrorPaths) {
      const mirrorLiteral = extractRegexLiteral(readSource(mirrorPath), mirrorPath, name);
      if (referenceLiteral !== mirrorLiteral) {
        fail(
          `${name} differs byte-for-byte between ${displayPath(referencePath)} (${referenceLiteral}) and ${displayPath(mirrorPath)} (${mirrorLiteral}). Edit both mirrored literals together.`,
        );
      }
    }
  }

  console.log(
    `OK — redaction-pattern-sync: ${PATTERN_SPECS.map((spec) => spec.name).join(', ')} match byte-for-byte across their mirrored files.`,
  );
}

main();
