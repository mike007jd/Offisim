/**
 * Install-core hardening oracle harness.
 *
 * Covers three audit-remediation defects:
 *  - M3: undeclared/extra archive files must fail integrity.
 *  - M2: `package_sha256` is a REAL, verified content anchor (not a placeholder).
 *  - M4: a flush-then-rollback double-failure leaves a durable, recoverable
 *        repair marker (not just a console.warn).
 *
 * Style mirrors the other `scripts/harness-*.mts` oracles: top-level await,
 * `node:assert/strict`, throws on failure, prints a PASS line per check.
 */

import assert from 'node:assert/strict';
import { manifestFileDigestAnchor, sha256Hex } from '../packages/install-core/src/hash.ts';
import { checkIntegrity } from '../packages/install-core/src/integrity-checker.ts';
import { extractPackage } from '../packages/install-core/src/manifest-loader.ts';
import { materialize } from '../packages/install-core/src/materializer.ts';
import type { MaterializeResult } from '../packages/install-core/src/materializer.ts';
import { buildPackageArtifact } from '../packages/install-core/src/package-builder.ts';
import {
  recordVaultRepairMarker,
  rollback,
  vaultRepairMarkerPath,
} from '../packages/install-core/src/rollback.ts';
import type {
  ExtractedPackage,
  InstallPlan,
  InstallRepositories,
  InstallVaultFileSystem,
} from '../packages/install-core/src/types.ts';

const enc = new TextEncoder();

async function buildSampleArtifact() {
  return buildPackageArtifact({
    packageId: 'harness.sample',
    assetId: 'sample-asset',
    kind: 'employee',
    title: 'Harness Sample',
    summary: 'Sample package for the install-core integrity harness.',
    version: '1.0.0',
    license: 'MIT',
    tags: ['harness'],
    riskClass: 'data_asset',
    filesystemScope: 'none',
    networkScope: 'none',
    assetPath: 'assets/sample.json',
    assetBody: '{"hello":"world"}\n',
  });
}

// ---------------------------------------------------------------------------
// M2 — `package_sha256` is a real anchor (positive + tamper)
// ---------------------------------------------------------------------------
{
  const built = await buildSampleArtifact();

  // The builder must NOT write the old all-zeros placeholder anymore.
  assert.notEqual(
    built.manifest.integrity.package_sha256,
    '0'.repeat(64),
    'M2: builder still writes the all-zeros placeholder anchor',
  );

  // The written anchor must equal the recomputed content anchor over the
  // declared file digests — i.e. it is genuinely derived, not arbitrary.
  const expectedAnchor = await manifestFileDigestAnchor(built.manifest.integrity.files ?? []);
  assert.equal(
    built.manifest.integrity.package_sha256,
    expectedAnchor,
    'M2: builder anchor does not match the recomputed content anchor',
  );

  // A genuine extracted package passes integrity.
  const extracted = await extractPackage(built.zipBytes);
  const ok = await checkIntegrity(extracted);
  assert.equal(ok.valid, true, 'M2: genuine package failed integrity');
  assert.equal(ok.packageHashMatch, true, 'M2: genuine package anchor mismatch');

  // Tamper the anchor: integrity must now reject it (the check is REAL).
  const tamperedManifest = {
    ...extracted.manifest,
    integrity: {
      ...extracted.manifest.integrity,
      package_sha256: await sha256Hex(enc.encode('not-the-real-anchor')),
    },
  };
  const tampered: ExtractedPackage = { ...extracted, manifest: tamperedManifest };
  const bad = await checkIntegrity(tampered);
  assert.equal(bad.valid, false, 'M2: tampered package_sha256 anchor was NOT rejected');
  assert.equal(bad.packageHashMatch, false, 'M2: tampered anchor did not flag packageHashMatch');

  // Legacy all-zeros placeholder: unverifiable on its own (a crafted package
  // could set all-zeros to skip the anchor), but accepted when an external
  // expectedHash gates the bytes (registry transit path).
  const legacyManifest = {
    ...extracted.manifest,
    integrity: { ...extracted.manifest.integrity, package_sha256: '0'.repeat(64) },
  };
  const legacy: ExtractedPackage = { ...extracted, manifest: legacyManifest };
  const legacyNoGate = await checkIntegrity(legacy);
  assert.equal(
    legacyNoGate.valid,
    false,
    'M2: legacy all-zeros anchor must be unverifiable without an external expectedHash (bypass guard)',
  );
  const legacyGated = await checkIntegrity(legacy, extracted.packageHash);
  assert.equal(
    legacyGated.valid,
    true,
    'M2: legacy all-zeros anchor must pass when an external expectedHash gates the bytes',
  );

  console.log(
    'PASS M2: package_sha256 is a real, verified content anchor (tamper + bypass rejected)',
  );
}

// ---------------------------------------------------------------------------
// M3 — undeclared / extra archive files fail integrity
// ---------------------------------------------------------------------------
{
  const built = await buildSampleArtifact();
  const extracted = await extractPackage(built.zipBytes);

  // Baseline: untouched package is valid.
  const baseline = await checkIntegrity(extracted);
  assert.equal(baseline.valid, true, 'M3: baseline package unexpectedly invalid');

  // Tamper: inject an extra, undeclared file into the extracted archive.
  const tamperedFiles = new Map(extracted.files);
  tamperedFiles.set('assets/EVIL.sh', enc.encode('#!/bin/sh\nrm -rf /\n'));
  const tampered: ExtractedPackage = { ...extracted, files: tamperedFiles };

  const result = await checkIntegrity(tampered);
  assert.equal(result.valid, false, 'M3: extra undeclared file did NOT fail integrity');
  assert.ok(
    result.fileHashErrors.includes('assets/EVIL.sh'),
    'M3: undeclared file not reported in fileHashErrors',
  );

  // manifest.json is allowed to be undeclared (self-referential) and must NOT
  // trip the extra-file guard.
  assert.ok(extracted.files.has('manifest.json'), 'M3: extracted set missing manifest.json');
  assert.ok(
    !baseline.fileHashErrors.includes('manifest.json'),
    'M3: manifest.json wrongly flagged as an extra file',
  );

  console.log('PASS M3: undeclared/extra archive file fails integrity');
}

// ---------------------------------------------------------------------------
// M4 — flush-then-rollback double-failure leaves a durable repair marker
// ---------------------------------------------------------------------------

/** In-memory vault that fails writes for skill files and fails removes too,
 *  forcing the flush AND the compensating rollback to both fail. */
function makeFailingVault(): {
  vault: InstallVaultFileSystem;
  written: Map<string, string>;
} {
  const written = new Map<string, string>();
  const vault: InstallVaultFileSystem = {
    root: '/vault',
    async readFile(rel) {
      const v = written.get(rel);
      if (v === undefined) throw new Error(`no such file: ${rel}`);
      return v;
    },
    async writeFile(rel, content) {
      // Repair markers (under _repair/) must succeed so we can observe them.
      if (rel.startsWith('_repair/')) {
        written.set(rel, content);
        return;
      }
      // Every SKILL.md flush fails — this is the post-commit flush failure.
      throw new Error(`flush failed for ${rel}`);
    },
    async listDir() {
      return [...written.keys()];
    },
    async stat() {
      return null;
    },
    async remove() {
      // Rollback's vault.remove ALSO fails → double failure.
      throw new Error('rollback remove failed');
    },
    async mkdir() {},
    async exists(rel) {
      return written.has(rel);
    },
  };
  return { vault, written };
}

function makeRepos(vault: InstallVaultFileSystem): InstallRepositories {
  const noop = async () => {};
  return {
    installTransactions: {
      create: async (txn) => ({ ...txn, finished_at: null }) as never,
      findById: async () => null,
      findByIdempotencyKey: async () => null,
      updateState: noop,
      finish: noop,
    },
    installedPackages: {
      create: async (pkg) => pkg,
      findByPackageId: async () => [],
      // rollback deletes the package last; make it fail too so cleanup is partial.
      delete: async () => {
        throw new Error('installedPackages.delete failed');
      },
    },
    installedAssets: {
      create: async (a) => a,
      delete: async () => {
        throw new Error('installedAssets.delete failed');
      },
    },
    assetBindings: {
      create: async (b) => b,
      findByTransaction: async () => [],
      updateStatus: noop,
      delete: noop,
    },
    employees: {
      create: async () => ({ employee_id: 'emp_1' }),
      delete: noop,
    },
    skills: {
      insert: noop,
      // rollback deletes the skill row; make it fail to keep cleanup partial.
      delete: async () => {
        throw new Error('skills.delete failed');
      },
    },
    vault,
  };
}

function makeSkillPlan(): InstallPlan {
  return {
    manifest: {
      spec_version: '1.0.0',
      package: {
        id: 'harness.skill',
        kind: 'skill',
        version: '1.0.0',
        title: 'Harness Skill',
        summary: 'Skill for the M4 double-failure harness.',
        license: 'MIT',
        publisher: {},
        tags: [],
      },
      compatibility: {
        runtime_range: '>=0.1 <2.0',
        schema_version: '2026-03',
        supported_environments: ['desktop'],
      },
      requirements: { required_capabilities: [], required_mcps: [] },
      permissions: {
        risk_class: 'data_asset',
        declares_secrets: false,
        filesystem_scope: 'none',
        network_scope: 'none',
      },
      assets: [
        {
          asset_id: 'skill-asset',
          kind: 'skill',
          path: 'assets/skill.md',
          default_enabled: true,
        },
      ],
      integrity: { package_sha256: '0'.repeat(64), files: [] },
      previews: { readme_path: 'README.md' },
      custom: {
        skill_slug: 'harness-skill',
        skill_md_content: '---\nname: harness-skill\n---\nbody\n',
      },
    } as InstallPlan['manifest'],
    compatibility: { compatible: true, errors: [] },
    bindings: [],
    needsConfirmation: false,
    confirmationReasons: [],
    packageHash: 'x'.repeat(64),
    manifestHash: 'y'.repeat(64),
  };
}

{
  // Direct unit-style proof that rollback now SIGNALS partial failure and the
  // marker writer persists a durable, recoverable record.
  const { vault, written } = makeFailingVault();
  const repos = makeRepos(vault);
  const fakeResult: MaterializeResult = {
    installedPackageId: 'pkg_1',
    installedAssetIds: ['asset_1'],
    employeeIds: [],
    skillIds: ['skill_1'],
    skillVaultPaths: ['companies/c1/skills/harness-skill/SKILL.md'],
    companyTemplateIds: [],
    officeLayoutIds: [],
    prefabInstanceIds: [],
    bindingIds: [],
  };
  const outcome = await rollback(fakeResult, repos);
  assert.ok(outcome.errors.length > 0, 'M4: rollback did not report its partial-cleanup failures');

  const markerPath = await recordVaultRepairMarker(vault, {
    kind: 'install-rollback-failure',
    installTxnId: 'txn_unit',
    recordedAt: new Date().toISOString(),
    flushError: 'flush failed',
    rollbackError: outcome.errors.join('; '),
    orphaned: fakeResult,
  });
  assert.equal(markerPath, vaultRepairMarkerPath('txn_unit'), 'M4: marker path mismatch');
  const raw = written.get(markerPath!);
  assert.ok(raw, 'M4: durable repair marker was not written to the vault');
  const parsed = JSON.parse(raw!);
  assert.equal(parsed.installTxnId, 'txn_unit', 'M4: marker missing install txn id');
  assert.equal(parsed.orphaned.installedPackageId, 'pkg_1', 'M4: marker missing orphan ids');

  console.log('PASS M4 (unit): rollback signals partial failure; marker is durable + recoverable');
}

{
  // End-to-end proof through materialize(): a skill install whose post-commit
  // flush fails AND whose rollback fails must leave a recoverable marker.
  const { vault, written } = makeFailingVault();
  const repos = makeRepos(vault);
  const plan = makeSkillPlan();
  const installTxnId = 'txn_e2e';

  let threw = false;
  try {
    await materialize(plan, [], repos, 'company-1', installTxnId, {
      // asyncTransact that just runs the callback (commit succeeds in-memory).
      asyncTransact: async (fn) => fn(),
    });
  } catch {
    threw = true; // flush error is re-thrown — expected.
  }
  assert.equal(threw, true, 'M4: materialize did not surface the flush failure');

  const markerPath = vaultRepairMarkerPath(installTxnId);
  const raw = written.get(markerPath);
  assert.ok(raw, 'M4: end-to-end double-failure left NO durable repair marker');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.kind, 'install-rollback-failure', 'M4: marker has wrong kind');
  assert.equal(parsed.installTxnId, installTxnId, 'M4: marker has wrong txn id');
  assert.ok(
    typeof parsed.flushError === 'string' && parsed.flushError.length > 0,
    'M4: marker missing flushError',
  );
  assert.ok(
    typeof parsed.rollbackError === 'string' && parsed.rollbackError.length > 0,
    'M4: marker missing rollbackError',
  );

  console.log('PASS M4 (e2e): flush-then-rollback double-failure leaves a recoverable marker');
}

// ---------------------------------------------------------------------------
// ST4 — installing unfinished asset kinds (prefab / office_layout /
//        company_template) is BLOCKED with a clear error; employee/skill still
//        materialize. (Decision D-4 default = block install with a clear error.)
// ---------------------------------------------------------------------------

/** Permissive in-memory repos: every create/insert succeeds, so the ONLY thing
 *  that can stop materialization is the kind gate itself. */
function makeAllowAllRepos(): InstallRepositories & {
  written: {
    employees: number;
    skills: number;
    templates: number;
    layouts: number;
    prefabs: number;
  };
} {
  const written = { employees: 0, skills: 0, templates: 0, layouts: 0, prefabs: 0 };
  const noop = async () => {};
  const vaultStore = new Map<string, string>();
  const vault: InstallVaultFileSystem = {
    root: '/vault',
    async readFile(rel) {
      const v = vaultStore.get(rel);
      if (v === undefined) throw new Error(`no such file: ${rel}`);
      return v;
    },
    async writeFile(rel, content) {
      vaultStore.set(rel, content);
    },
    async listDir() {
      return [...vaultStore.keys()];
    },
    async stat() {
      return null;
    },
    async remove(rel) {
      vaultStore.delete(rel);
    },
    async mkdir() {},
    async exists(rel) {
      return vaultStore.has(rel);
    },
  };
  return {
    installTransactions: {
      create: async (txn) => ({ ...txn, finished_at: null }) as never,
      findById: async () => null,
      findByIdempotencyKey: async () => null,
      updateState: noop,
      finish: noop,
    },
    installedPackages: {
      create: async (pkg) => pkg,
      findByPackageId: async () => [],
      delete: noop,
    },
    installedAssets: { create: async (a) => a, delete: noop },
    assetBindings: {
      create: async (b) => b,
      findByTransaction: async () => [],
      updateStatus: noop,
      delete: noop,
    },
    employees: {
      create: async () => {
        written.employees += 1;
        return { employee_id: `emp_${written.employees}` };
      },
      delete: noop,
    },
    skills: {
      insert: async () => {
        written.skills += 1;
      },
      delete: noop,
    },
    companyTemplates: {
      create: async () => {
        written.templates += 1;
      },
      delete: noop,
    },
    officeLayouts: {
      create: async () => {
        written.layouts += 1;
      },
      delete: noop,
    },
    prefabInstances: {
      create: async () => {
        written.prefabs += 1;
      },
      delete: noop,
    },
    vault,
    written,
  } as never;
}

function makeSingleAssetPlan(
  kind: 'employee' | 'skill' | 'company_template' | 'office_layout' | 'prefab',
  custom: Record<string, unknown> = {},
): InstallPlan {
  return {
    manifest: {
      spec_version: '1.0.0',
      package: {
        id: `harness.${kind}`,
        kind,
        version: '1.0.0',
        title: `Harness ${kind}`,
        summary: `ST4 ${kind} package.`,
        license: 'MIT',
        publisher: {},
        tags: [],
      },
      compatibility: {
        runtime_range: '>=0.1 <2.0',
        schema_version: '2026-03',
        supported_environments: ['desktop'],
      },
      requirements: { required_capabilities: [], required_mcps: [] },
      permissions: {
        risk_class: 'data_asset',
        declares_secrets: false,
        filesystem_scope: 'none',
        network_scope: 'none',
      },
      assets: [
        { asset_id: `${kind}-asset`, kind, path: `assets/${kind}.json`, default_enabled: true },
      ],
      integrity: { package_sha256: '0'.repeat(64), files: [] },
      previews: { readme_path: 'README.md' },
      custom,
    } as InstallPlan['manifest'],
    compatibility: { compatible: true, errors: [] },
    bindings: [],
    needsConfirmation: false,
    confirmationReasons: [],
    packageHash: 'x'.repeat(64),
    manifestHash: 'y'.repeat(64),
  };
}

// Blocked kinds: each must fail fast with the clear "not supported yet" error
// and write ZERO kind-specific rows (no partial materialization).
for (const kind of ['prefab', 'office_layout', 'company_template'] as const) {
  const repos = makeAllowAllRepos();
  await assert.rejects(
    () =>
      materialize(makeSingleAssetPlan(kind), [], repos, 'company-1', `txn_${kind}`, {
        asyncTransact: async (fn) => fn(),
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error, `ST4: ${kind} threw a non-Error`);
      assert.equal(
        err.message,
        `Installing ${kind} packages is not supported yet`,
        `ST4: ${kind} blocked with wrong message`,
      );
      return true;
    },
    `ST4: installing a ${kind} asset was NOT blocked`,
  );
  assert.equal(repos.written.templates, 0, `ST4: ${kind} install wrote a company_template row`);
  assert.equal(repos.written.layouts, 0, `ST4: ${kind} install wrote an office_layout row`);
  assert.equal(repos.written.prefabs, 0, `ST4: ${kind} install wrote a prefab row`);
}

// Live kind: employee still materializes successfully (no regression).
{
  const repos = makeAllowAllRepos();
  const result = await materialize(
    makeSingleAssetPlan('employee'),
    [],
    repos,
    'company-1',
    'txn_employee',
    { asyncTransact: async (fn) => fn() },
  );
  assert.equal(result.employeeIds.length, 1, 'ST4: employee install did not create an employee');
  assert.equal(repos.written.employees, 1, 'ST4: employee row was not written');
}

// Live kind: skill still materializes successfully (no regression). Uses the
// asyncTransact + deferred-vault-flush path, the real install route for skills.
{
  const repos = makeAllowAllRepos();
  const result = await materialize(
    makeSingleAssetPlan('skill', {
      skill_slug: 'harness-st4-skill',
      skill_md_content: '---\nname: harness-st4-skill\n---\nbody\n',
    }),
    [],
    repos,
    'company-1',
    'txn_skill',
    { asyncTransact: async (fn) => fn() },
  );
  assert.equal(result.skillIds.length, 1, 'ST4: skill install did not create a skill');
  assert.equal(repos.written.skills, 1, 'ST4: skill row was not written');
}

console.log(
  'PASS ST4: prefab/office_layout/company_template installs are blocked; employee/skill still materialize',
);

console.log('\nAll install-core integrity harness checks passed.');
