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
 * Pure static scan: no build required, runs in an un-built workspace.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
// This guard's own ALLOWLIST strings and doc comments contain the very pattern
// it scans for, so it must skip itself.
const SELF = fileURLToPath(import.meta.url);
const SCAN_ROOTS = ['apps', 'packages', 'scripts'];
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs', '.js'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', '.turbo', 'build', '.next']);

/**
 * Grandfathered intentional source imports in the scripts/ tooling layer, keyed
 * `<repo-relative-file>::<import-specifier>`. Add a new entry ONLY for a script
 * that must be bundled/run without a build; product code must never appear here.
 */
const ALLOWLIST = new Set([
  'scripts/harness-registry-client-security.mts::../packages/registry-client/src/index.ts',
  'scripts/pi-agent-permission-modes.mts::../packages/core/src/tools/builtin/shell-command-classifier.ts',
  'scripts/harness-web-fetch-security.mts::../packages/core/src/tools/builtin/web-fetch-tool.js',
  'scripts/harness-git-source-security.mts::../packages/core/src/skills/skill-source-resolvers/git.ts',
  'scripts/harness-git-source-security.mts::../packages/core/src/skills/skill-source-resolvers/upload.ts',
  'scripts/harness-doc-engine-csv-security.mts::../packages/doc-engine/src/export.js',
  'scripts/harness-doc-engine-xlsx-limits.mts::../packages/doc-engine/src/import/index.js',
  'scripts/harness-web-search-security.mts::../packages/core/src/tools/builtin/web-search-tool.ts',
  'scripts/harness-conversation-run-controller.mts::../packages/core/src/browser.js',
  'scripts/harness-workspace-repo-contract.mts::../packages/core/src/runtime/repos/workspace/drizzle.js',
  'scripts/harness-install-core-integrity.mts::../packages/install-core/src/integrity-checker.ts',
  'scripts/harness-install-core-integrity.mts::../packages/install-core/src/package-builder.ts',
  'scripts/harness-install-core-integrity.mts::../packages/install-core/src/manifest-loader.ts',
  'scripts/harness-install-core-integrity.mts::../packages/install-core/src/hash.ts',
  'scripts/harness-install-core-integrity.mts::../packages/install-core/src/materializer.ts',
  'scripts/harness-template-contract.mts::../packages/core/src/browser.js',
  'scripts/harness-template-contract.mts::../packages/shared-types/src/index.js',
  'scripts/harness-computer-rich-detail.mts::../packages/shared-types/src/index.js',
  'scripts/harness-employee-version-on-save.mts::../packages/core/src/browser.js',
  'scripts/harness-agent-run-projection.mts::../packages/shared-types/src/index.js',
  'scripts/harness-beat-composer.mts::../packages/shared-types/src/index.js',
  'scripts/harness-scene-staging.mts::../packages/shared-types/src/index.js',
  'scripts/harness-office-projection.mts::../packages/shared-types/src/index.js',
  'scripts/harness-mission-office-projection.mts::../packages/shared-types/src/index.js',
  'scripts/harness-mcp-bridge-extension.mts::../packages/shared-types/src/index.js',
  'scripts/harness-dramaturgy-modes.mts::../packages/shared-types/src/index.js',
  'scripts/harness-dramaturgy-stress.mts::../packages/shared-types/src/index.js',
  'scripts/harness-scene-cue.mts::../packages/shared-types/src/index.js',
  'scripts/harness-mission-service.mts::../packages/core/src/runtime/repos/mission/memory.ts',
  'scripts/harness-mission-service.mts::../packages/core/src/runtime/mission/mission-service.ts',
  'scripts/harness-mission-evaluators.mts::../packages/core/src/runtime/mission/evaluators/registry.ts',
  'scripts/harness-mission-evaluators.mts::../packages/core/src/runtime/mission/evaluators/types.ts',
  'scripts/harness-mission-loop-controller.mts::../packages/core/src/runtime/repos/mission/memory.ts',
  'scripts/harness-mission-loop-controller.mts::../packages/core/src/runtime/mission/mission-service.ts',
  'scripts/harness-mission-loop-controller.mts::../packages/core/src/runtime/mission/mission-loop-controller.ts',
  'scripts/harness-mission-loop-controller.mts::../packages/core/src/runtime/mission/evaluators/registry.ts',
  'scripts/harness-mission-loop-controller.mts::../packages/core/src/runtime/mission/evaluators/types.ts',
  'scripts/harness-mission-run-controller.mts::../packages/core/src/browser.js',
  'scripts/harness-mission-run-controller.mts::../packages/core/src/runtime/repos/mission/memory.ts',
  'scripts/harness-mission-run-controller.mts::../packages/core/src/runtime/repos/deliverables/memory.ts',
  'scripts/harness-mission-recovery.mts::../packages/core/src/runtime/repos/mission/memory.ts',
  'scripts/harness-mission-recovery.mts::../packages/core/src/runtime/mission/mission-service.ts',
  'scripts/harness-mission-recovery.mts::../packages/core/src/runtime/mission/recovery/safe-boundary.ts',
  'scripts/harness-mission-recovery.mts::../packages/core/src/runtime/mission/recovery/compatibility-hash.ts',
  'scripts/harness-mission-recovery.mts::../packages/core/src/runtime/mission/recovery/reconciliation.ts',
  'scripts/harness-mission-recovery.mts::../packages/core/src/runtime/mission/recovery/retry-safety.ts',
  'scripts/harness-mission-recovery.mts::../packages/core/src/runtime/mission/recovery/resume-plan.ts',
  'scripts/harness-mission-recovery.mts::../packages/core/src/runtime/mission/recovery/types.ts',
  'scripts/harness-workspace-lease.mts::../packages/core/src/runtime/mission/workspace/lease-manager.ts',
  'scripts/harness-run-recovery.mts::../packages/core/src/runtime/repositories.ts',
  'scripts/harness-run-recovery.mts::../packages/core/src/runtime/repos/agent-runs/memory.ts',
  'scripts/harness-playbook-validation.mts::../packages/shared-types/src/index.ts',
  'scripts/harness-playbook-validation.mts::../packages/core/src/runtime/mission/evaluators/registry.ts',
  'scripts/harness-playbook-validation.mts::../packages/core/src/runtime/mission/playbook/validate.ts',
  'scripts/harness-playbook-validation.mts::../packages/core/src/runtime/mission/playbook/materialize.ts',
  'scripts/harness-loop-compiler.mts::../packages/shared-types/src/loops/ir.ts',
  'scripts/harness-loop-compiler.mts::../packages/core/src/loops/index.ts',
  'scripts/harness-loop-compiler.mts::../packages/core/src/loops/validate.ts',
  'scripts/harness-loop-compiler.mts::../packages/core/src/loops/types.ts',
  'scripts/harness-loop-repository.mts::../packages/core/src/runtime/memory-repositories.ts',
  'scripts/harness-loop-repository.mts::../packages/core/src/loops/loop-service.ts',
  'scripts/harness-loop-repository.mts::../packages/core/src/loops/types.ts',
  'scripts/harness-loop-mission-adapter.mts::../packages/shared-types/src/loops/index.ts',
  'scripts/harness-loop-mission-adapter.mts::../packages/core/src/loops/mission-adapter.ts',
  'scripts/harness-loop-mission-adapter.mts::../packages/core/src/loops/index.ts',
  'scripts/harness-loop-mission-adapter.mts::../packages/core/src/runtime/repos/mission/memory.ts',
  'scripts/harness-loop-mission-adapter.mts::../packages/core/src/runtime/mission/mission-service.ts',
  'scripts/harness-loop-mission-adapter.mts::../packages/core/src/loops/types.ts',
  // PR-02 collaboration repo-contract harness (grandfathered alongside the loop
  // harnesses; same build/gate-tooling pattern as the mission harnesses above).
  'scripts/harness-collaboration-repo-contract.mts::../packages/core/src/runtime/repositories.js',
  'scripts/harness-collaboration-repo-contract.mts::../packages/core/src/runtime/repos/collaboration/drizzle.js',
  // PR-03 collaboration runtime harness (same build/gate-tooling pattern): it
  // drives the controller against the in-memory collaboration repos + service.
  'scripts/harness-pi-collaboration-runtime.mts::../packages/core/src/runtime/repos/collaboration/memory.js',
  'scripts/harness-pi-collaboration-runtime.mts::../packages/core/src/runtime/collaboration/collaboration-service.js',
  // PR-05 Connect chat-flow harness (same build/gate-tooling pattern): it drives
  // the real CollaborationService + drizzle repos against the actual SQL schema so
  // chat_threads isolation is a DB-enforced fact.
  'scripts/harness-connect-chat-flow.mts::../packages/core/src/runtime/collaboration/collaboration-service.js',
  'scripts/harness-connect-chat-flow.mts::../packages/core/src/runtime/repos/collaboration/drizzle.js',
  // PR-10 Loop → Office Send invocation harness (same build/gate-tooling pattern as
  // the loop/mission harnesses): it drives the pure send-time materializer against
  // the in-memory loop + mission repos and the real LoopService/MissionService.
  'scripts/harness-loop-office-invocation.mts::../packages/core/src/runtime/memory-repositories.ts',
  'scripts/harness-loop-office-invocation.mts::../packages/core/src/browser.ts',
  'scripts/harness-loop-office-invocation.mts::../packages/core/src/loops/types.ts',
  // PR-08 Loops authoring-flow harness: drives the pure state machine + the
  // model-adapter mapping over the in-memory loop repos (un-built, like its peers).
  'scripts/harness-loop-authoring-flow.mts::../packages/core/src/runtime/memory-repositories.ts',
  'scripts/harness-loop-authoring-flow.mts::../packages/core/src/browser.ts',
  'scripts/harness-loop-authoring-flow.mts::../packages/core/src/loops/types.ts',
]);

// Matches an import/export/require specifier that reaches into a package's src,
// e.g. `from '../packages/core/src/x.ts'` or `import('.../packages/db/src/y')`.
const SPECIFIER_RE = /['"]([^'"]*packages\/[^'"/]+\/src\/[^'"]+)['"]/;
const IMPORT_LINE_RE = /\b(?:import|export)\b|\brequire\s*\(/;

function walk(dir, files) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, files);
    else if (full !== SELF && SOURCE_EXTENSIONS.some((ext) => full.endsWith(ext))) files.push(full);
  }
}

const files = [];
for (const root of SCAN_ROOTS) {
  try {
    walk(join(repoRoot, root), files);
  } catch {
    // Root may not exist in every checkout; skip it.
  }
}

const violations = [];
for (const file of files) {
  const rel = relative(repoRoot, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (!IMPORT_LINE_RE.test(line)) return;
    const match = SPECIFIER_RE.exec(line);
    if (!match) return;
    const specifier = match[1];
    if (ALLOWLIST.has(`${rel}::${specifier}`)) return;
    violations.push({ rel, line: index + 1, specifier });
  });
}

if (violations.length > 0) {
  console.error('[check-cross-package-src-imports] new cross-package private-source import(s):\n');
  for (const v of violations) {
    console.error(`  ${v.rel}:${v.line}  →  ${v.specifier}`);
  }
  console.error(
    '\nImport the package through its `@offisim/<pkg>` public entry instead of its src/.',
  );
  console.error(
    'If this is intentional build/gate tooling that must run un-built, add it to ALLOWLIST in this script.',
  );
  process.exit(1);
}

console.log(`[check-cross-package-src-imports] ok (${ALLOWLIST.size} grandfathered, 0 new)`);
