#!/usr/bin/env node
/**
 * Guard against new cross-package private-source imports.
 *
 * Reaching into another workspace package's `src/` (e.g.
 * `../packages/core/src/tools/...`) bypasses that package's public `exports`
 * surface and couples callers to its internal file layout. Product code under
 * `apps/` and `packages/` must import siblings through their `@offisim/<pkg>`
 * public entry, never their `src/`.
 *
 * The `scripts/` build/gate tooling is the deliberate exception: those harness
 * and host modules import source files directly so they run under plain `tsx`
 * without a build and get inlined by the desktop host bundler. Those existing
 * imports are grandfathered in ALLOWLIST below; any NEW cross-package `src/`
 * import — in scripts or product code — fails this check.
 *
 * Scans use a real TypeScript module AST so multiline static imports, dynamic
 * `import()`, `export … from`, and `require()` cannot evade the policy.
 * Allowlist validation is bidirectionally strict: missing and stale entries fail.
 *
 * Pure static scan: no build required, runs in an un-built workspace.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { harnessSourceImports } from './harness-manifest.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
// This guard's own ALLOWLIST strings and doc comments contain the very pattern
// it scans for, so it must skip itself.
const SELF = fileURLToPath(import.meta.url);
const MANIFEST = fileURLToPath(new URL('./harness-manifest.mjs', import.meta.url));
const IS_MAIN = Boolean(process.argv[1]) && resolvePath(process.argv[1]) === SELF;
const SCAN_ROOTS = ['apps', 'packages', 'scripts'];
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs', '.js'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', '.turbo', 'build', '.next']);
const PACKAGE_SRC_SPECIFIER_RE = /(?:^|\/)packages\/[^/]+\/src\//;

/**
 * Grandfathered intentional source imports in the scripts/ tooling layer, keyed
 * `<repo-relative-file>::<import-specifier>`. The authoritative entries live in
 * harness-manifest.mjs; product code must never appear in that tooling exception.
 */
const ALLOWLIST = Object.freeze([...harnessSourceImports]);

function walk(dir, files) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, files);
    else if (
      full !== SELF &&
      full !== MANIFEST &&
      SOURCE_EXTENSIONS.some((ext) => full.endsWith(ext))
    ) {
      files.push(full);
    }
  }
}

function scriptKindFor(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.ts') || file.endsWith('.mts') || file.endsWith('.cts')) {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.JS;
}

function literalModuleName(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

function isPackageSrcSpecifier(specifier) {
  return PACKAGE_SRC_SPECIFIER_RE.test(specifier);
}

/**
 * Collect static module dependency specifiers that reach into a package `src/`.
 * Covers ImportDeclaration, ExportDeclaration (export-from), dynamic import(),
 * and require() with a string/no-sub template literal argument.
 *
 * @param {string} file
 * @param {string} text
 * @returns {{ specifier: string, line: number }[]}
 */
export function collectPackageSrcImports(file, text) {
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    scriptKindFor(file),
  );
  /** @type {{ specifier: string, line: number }[]} */
  const found = [];

  function record(specifierNode) {
    const specifier = literalModuleName(specifierNode);
    if (!specifier || !isPackageSrcSpecifier(specifier)) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(specifierNode.getStart(sourceFile));
    found.push({ specifier, line: line + 1 });
  }

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      record(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      record(node.moduleSpecifier);
    } else if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) {
        record(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/**
 * @param {{
 *   roots?: string[],
 *   allowlist?: readonly string[],
 *   repoRoot?: string,
 *   skipFiles?: Set<string>,
 * }} [options]
 */
export function checkCrossPackageSrcImports(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const allowlist = options.allowlist ?? ALLOWLIST;
  const skipFiles = options.skipFiles ?? new Set([SELF, MANIFEST]);
  const scanRoots = options.roots ?? SCAN_ROOTS;

  if (new Set(allowlist).size !== allowlist.length) {
    const seen = new Set();
    const duplicates = [];
    for (const entry of allowlist) {
      if (seen.has(entry)) duplicates.push(entry);
      seen.add(entry);
    }
    return {
      ok: false,
      violations: [],
      stale: [],
      missing: [],
      duplicates,
      observed: new Set(),
      allowlistSize: allowlist.length,
    };
  }

  for (const entry of allowlist) {
    if (!entry.startsWith('scripts/')) {
      return {
        ok: false,
        violations: [
          {
            rel: entry.split('::')[0] ?? entry,
            line: 0,
            specifier: entry.split('::')[1] ?? '',
            reason: 'allowlist entry must live under scripts/',
          },
        ],
        stale: [],
        missing: [],
        duplicates: [],
        observed: new Set(),
        allowlistSize: allowlist.length,
      };
    }
  }

  const files = [];
  for (const scanRoot of scanRoots) {
    const dir = join(root, scanRoot);
    try {
      walk(dir, files);
    } catch {
      // Root may not exist in every checkout; skip it.
    }
  }

  // When called with a custom repoRoot (self-tests), still honor skip by basename
  // only for SELF/MANIFEST absolute paths from this module.
  const filtered = files.filter((full) => !skipFiles.has(full));

  /** @type {Set<string>} */
  const observed = new Set();
  /** @type {{ rel: string, line: number, specifier: string }[]} */
  const violations = [];

  for (const file of filtered) {
    const rel = relative(root, file).split('\\').join('/');
    const text = readFileSync(file, 'utf8');
    for (const { specifier, line } of collectPackageSrcImports(file, text)) {
      const key = `${rel}::${specifier}`;
      observed.add(key);
      if (!allowlist.includes(key)) {
        violations.push({ rel, line, specifier });
      }
    }
  }

  const allowlistSet = new Set(allowlist);
  const missing = violations.map((v) => `${v.rel}::${v.specifier}`);
  const stale = [...allowlistSet].filter((entry) => !observed.has(entry));

  return {
    ok: violations.length === 0 && stale.length === 0,
    violations,
    stale,
    missing,
    duplicates: [],
    observed,
    allowlistSize: allowlist.length,
  };
}

function printFailures(result) {
  if (result.duplicates.length > 0) {
    console.error('[check-cross-package-src-imports] duplicate allowlist entries:\n');
    for (const entry of result.duplicates) {
      console.error(`  ${entry}`);
    }
  }
  if (result.violations.length > 0) {
    console.error(
      '[check-cross-package-src-imports] new cross-package private-source import(s):\n',
    );
    for (const v of result.violations) {
      const suffix = v.reason ? `  (${v.reason})` : '';
      console.error(`  ${v.rel}:${v.line}  →  ${v.specifier}${suffix}`);
    }
    console.error(
      '\nImport the package through its `@offisim/<pkg>` public entry instead of its src/.',
    );
    console.error(
      'If this is intentional build/gate tooling that must run un-built, add it to harnessSourceImports in harness-manifest.mjs.',
    );
  }
  if (result.stale.length > 0) {
    console.error(
      '[check-cross-package-src-imports] stale harnessSourceImports allowlist entries:\n',
    );
    for (const entry of result.stale) {
      console.error(`  ${entry}`);
    }
    console.error(
      '\nRemove allowlist entries that no longer match a real module import (AST), or restore the import.',
    );
  }
}

function writeFixture(root, rel, contents) {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
  return full;
}

function runSelfTests() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'offisim-src-imports-'));
  /** @type {string[]} */
  const failures = [];

  try {
    writeFixture(
      fixtureRoot,
      'scripts/multiline.mts',
      `import {\n  foo\n} from '../packages/core/src/tools/x.ts';\n`,
    );
    writeFixture(
      fixtureRoot,
      'scripts/dynamic.mjs',
      `const mod = await import(\n  '../packages/core/src/tools/y.ts',\n);\nexport default mod;\n`,
    );
    writeFixture(
      fixtureRoot,
      'scripts/export-from.mts',
      `export { bar } from '../packages/shared-types/src/index.ts';\n`,
    );
    writeFixture(
      fixtureRoot,
      'scripts/require.cjs',
      `const x = require('../packages/core/src/tools/z.js');\nmodule.exports = x;\n`,
    );
    writeFixture(
      fixtureRoot,
      'scripts/url-false-positive.mts',
      `import { readFileSync } from 'node:fs';\nreadFileSync(new URL('../packages/db-local/src/schema.sql', import.meta.url), 'utf8');\n`,
    );
    writeFixture(
      fixtureRoot,
      'apps/desktop/renderer/src/leak.ts',
      `import { x } from '../../../../packages/core/src/browser.ts';\n`,
    );
    // Empty packages/ tree so walk succeeds.
    mkdirSync(join(fixtureRoot, 'packages'), { recursive: true });

    const evasion = checkCrossPackageSrcImports({
      repoRoot: fixtureRoot,
      allowlist: [],
      skipFiles: new Set(),
    });
    const expectedMissing = [
      'scripts/multiline.mts::../packages/core/src/tools/x.ts',
      'scripts/dynamic.mjs::../packages/core/src/tools/y.ts',
      'scripts/export-from.mts::../packages/shared-types/src/index.ts',
      'scripts/require.cjs::../packages/core/src/tools/z.js',
      'apps/desktop/renderer/src/leak.ts::../../../../packages/core/src/browser.ts',
    ];
    for (const key of expectedMissing) {
      if (!evasion.missing.includes(key) && ![...evasion.observed].includes(key)) {
        failures.push(`expected AST to observe ${key}`);
      }
      if (![...evasion.observed].includes(key)) {
        failures.push(`missing observation for ${key}`);
      }
    }
    if ([...evasion.observed].some((key) => key.includes('schema.sql'))) {
      failures.push('URL/import.meta schema.sql must not count as a module import');
    }

    const allowlisted = checkCrossPackageSrcImports({
      repoRoot: fixtureRoot,
      allowlist: [
        'scripts/multiline.mts::../packages/core/src/tools/x.ts',
        'scripts/dynamic.mjs::../packages/core/src/tools/y.ts',
        'scripts/export-from.mts::../packages/shared-types/src/index.ts',
        'scripts/require.cjs::../packages/core/src/tools/z.js',
      ],
      skipFiles: new Set(),
    });
    if (allowlisted.stale.length !== 0) {
      failures.push(`unexpected stale after exact allowlist: ${allowlisted.stale.join(', ')}`);
    }
    if (
      !allowlisted.missing.includes(
        'apps/desktop/renderer/src/leak.ts::../../../../packages/core/src/browser.ts',
      )
    ) {
      failures.push('product leak must remain a missing allowlist violation');
    }

    const stale = checkCrossPackageSrcImports({
      repoRoot: fixtureRoot,
      allowlist: [
        'scripts/multiline.mts::../packages/core/src/tools/x.ts',
        'scripts/gone.mts::../packages/core/src/missing.ts',
      ],
      skipFiles: new Set(),
      roots: ['scripts'],
    });
    if (!stale.stale.includes('scripts/gone.mts::../packages/core/src/missing.ts')) {
      failures.push('stale allowlist entry must fail');
    }

    const dup = checkCrossPackageSrcImports({
      repoRoot: fixtureRoot,
      allowlist: [
        'scripts/multiline.mts::../packages/core/src/tools/x.ts',
        'scripts/multiline.mts::../packages/core/src/tools/x.ts',
      ],
      skipFiles: new Set(),
      roots: ['scripts'],
    });
    if (dup.duplicates.length === 0) {
      failures.push('duplicate allowlist entries must fail');
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error('[check-cross-package-src-imports] self-test failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('[check-cross-package-src-imports] self-test ok');
}

const selfTest = process.argv.includes('--self-test');
if (IS_MAIN) {
  if (selfTest) {
    runSelfTests();
  } else {
    const result = checkCrossPackageSrcImports();
    if (!result.ok) {
      printFailures(result);
      process.exit(1);
    }
    console.log(
      `[check-cross-package-src-imports] ok (${result.allowlistSize} grandfathered, 0 new, 0 stale)`,
    );
  }
}
