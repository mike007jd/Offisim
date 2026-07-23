#!/usr/bin/env node
// Redaction-pattern sync check for the MCP audit emit path and agent-run parse path.
// The two regex literals must remain byte-for-byte identical so neither boundary
// silently accepts credential shapes that the other boundary misses.

import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const EMIT_PATH = resolve(REPO_ROOT, 'scripts/pi-mcp-bridge-extension.mjs');
const PARSE_PATH = resolve(REPO_ROOT, 'packages/shared-types/src/events/agent-run.ts');
const PATTERN_NAMES = ['SENSITIVE_KEY_VALUE_PATTERN', 'SENSITIVE_TOKEN_PATTERN'];

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
  const emitSource = readSource(EMIT_PATH);
  const parseSource = readSource(PARSE_PATH);

  for (const patternName of PATTERN_NAMES) {
    const emitLiteral = extractRegexLiteral(emitSource, EMIT_PATH, patternName);
    const parseLiteral = extractRegexLiteral(parseSource, PARSE_PATH, patternName);
    if (emitLiteral !== parseLiteral) {
      fail(
        `${patternName} differs byte-for-byte between ${displayPath(EMIT_PATH)} (${emitLiteral}) and ${displayPath(PARSE_PATH)} (${parseLiteral}). Edit both mirrored literals together.`,
      );
    }
  }

  console.log(
    `OK — redaction-pattern-sync: ${PATTERN_NAMES.join(', ')} match byte-for-byte between ` +
      `${displayPath(EMIT_PATH)} and ${displayPath(PARSE_PATH)}.`,
  );
}

main();
