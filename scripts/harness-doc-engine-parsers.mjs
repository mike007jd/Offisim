#!/usr/bin/env node
/**
 * Deterministic doc-engine importer harness.
 *
 * Loads fixtures from `packages/doc-engine/harness/fixtures/` and runs each
 * scenario from `packages/doc-engine/harness/scenarios.json` through the built
 * `parseAttachment` entry. Asserts structural invariants per scenario; failure
 * exits non-zero with a JSON report.
 *
 * Aligned with the deterministic-harness exception in CLAUDE.md: no vitest, no
 * Playwright, no sample-stuffed `finalOutputContains` self-attestation. Each
 * scenario asserts properties that can only hold if the parser actually
 * decoded the bytes (page counts, sheet names, image dimensions parsed from
 * binary headers, etc).
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HARNESS_DIR = resolve(ROOT, 'packages/doc-engine/harness');
const FIXTURES_DIR = resolve(HARNESS_DIR, 'fixtures');
const SCENARIOS_FILE = resolve(HARNESS_DIR, 'scenarios.json');
// Import the importer subtree directly. Going through dist/index.js would force
// Node to resolve the existing exporter chain (csv/docx/pdf/etc), whose source
// uses bundler-style extensionless relative imports — fine for vite, broken
// for raw Node ESM. The importer subtree is self-contained and uses .js
// extensions explicitly.
const DOC_ENGINE_DIST = resolve(ROOT, 'packages/doc-engine/dist/import/index.js');

async function main() {
  const scenarios = JSON.parse(await readFile(SCENARIOS_FILE, 'utf8'));
  const docEngine = await import(new URL(`file://${DOC_ENGINE_DIST}`));
  const fixturesPresent = new Set(await readdir(FIXTURES_DIR));

  const results = [];
  let failed = 0;
  for (const scenario of scenarios.scenarios) {
    if (!fixturesPresent.has(scenario.fixture)) {
      results.push({ id: scenario.id, ok: false, reason: `fixture missing: ${scenario.fixture}` });
      failed += 1;
      continue;
    }
    const bytes = await readFile(resolve(FIXTURES_DIR, scenario.fixture));
    const parsed = await docEngine.parseAttachment(
      new Uint8Array(bytes),
      scenario.mimeType,
      scenario.filename,
    );
    const verdict = checkExpectations(parsed, scenario);
    results.push({
      id: scenario.id,
      ok: verdict.ok,
      ...(verdict.ok ? {} : { failures: verdict.failures }),
    });
    if (!verdict.ok) failed += 1;
  }

  const report = {
    suite: 'doc-engine-parsers',
    ok: failed === 0,
    scenarioCount: scenarios.scenarios.length,
    failed,
    results,
  };
  console.log(JSON.stringify(report, null, 2));
  if (failed > 0) process.exit(1);
}

function checkExpectations(parsed, scenario) {
  const failures = [];
  if (parsed.kind !== scenario.expectKind) {
    failures.push(`expected kind=${scenario.expectKind}, got kind=${parsed.kind}`);
    return { ok: false, failures };
  }
  const e = scenario.expect ?? {};
  if (parsed.kind === 'pdf') {
    if (typeof e.pagesLength === 'number' && parsed.pages.length !== e.pagesLength) {
      failures.push(`expected pages.length=${e.pagesLength}, got ${parsed.pages.length}`);
    }
    if (Array.isArray(e.textIncludes)) {
      for (const needle of e.textIncludes) {
        if (!parsed.text.includes(needle)) failures.push(`pdf text missing "${needle}"`);
      }
    }
  } else if (parsed.kind === 'docx') {
    if (Array.isArray(e.textIncludes)) {
      for (const needle of e.textIncludes) {
        if (!parsed.text.includes(needle)) failures.push(`docx text missing "${needle}"`);
      }
    }
    if (Array.isArray(e.htmlIncludes)) {
      for (const needle of e.htmlIncludes) {
        if (!parsed.html.includes(needle)) failures.push(`docx html missing "${needle}"`);
      }
    }
  } else if (parsed.kind === 'xlsx') {
    if (typeof e.sheetCount === 'number' && parsed.sheets.length !== e.sheetCount) {
      failures.push(`expected sheets.length=${e.sheetCount}, got ${parsed.sheets.length}`);
    }
    if (Array.isArray(e.sheetNames)) {
      const got = parsed.sheets.map((s) => s.name);
      const ok = e.sheetNames.every((n) => got.includes(n));
      if (!ok)
        failures.push(
          `expected sheet names ${JSON.stringify(e.sheetNames)}, got ${JSON.stringify(got)}`,
        );
    }
    if (typeof e.totalRowsAtLeast === 'number') {
      const total = parsed.sheets.reduce((acc, s) => acc + s.rowCount, 0);
      if (total < e.totalRowsAtLeast)
        failures.push(`expected total rows >= ${e.totalRowsAtLeast}, got ${total}`);
    }
  } else if (parsed.kind === 'pptx') {
    if (typeof e.slideCount === 'number' && parsed.slides.length !== e.slideCount) {
      failures.push(`expected slides.length=${e.slideCount}, got ${parsed.slides.length}`);
    }
    if (Array.isArray(e.textIncludes)) {
      for (const needle of e.textIncludes) {
        if (!parsed.text.includes(needle)) failures.push(`pptx text missing "${needle}"`);
      }
    }
  } else if (parsed.kind === 'image') {
    if (typeof e.width === 'number' && parsed.width !== e.width)
      failures.push(`expected width=${e.width}, got ${parsed.width}`);
    if (typeof e.height === 'number' && parsed.height !== e.height)
      failures.push(`expected height=${e.height}, got ${parsed.height}`);
    if (typeof e.format === 'string' && parsed.format !== e.format)
      failures.push(`expected format=${e.format}, got ${parsed.format}`);
    if (typeof parsed.base64 !== 'string' || parsed.base64.length === 0)
      failures.push('image base64 missing/empty');
  } else if (parsed.kind === 'text') {
    if (Array.isArray(e.textIncludes)) {
      for (const needle of e.textIncludes) {
        if (!parsed.text.includes(needle)) failures.push(`text missing "${needle}"`);
      }
    }
  } else if (parsed.kind === 'unsupported') {
    if (e.reasonNonEmpty && (typeof parsed.reason !== 'string' || parsed.reason.length === 0)) {
      failures.push('unsupported reason must be non-empty');
    }
  } else if (parsed.kind === 'binary') {
    if (typeof parsed.base64 !== 'string' || parsed.base64.length === 0)
      failures.push('binary base64 missing/empty');
  }
  return { ok: failures.length === 0, failures };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
