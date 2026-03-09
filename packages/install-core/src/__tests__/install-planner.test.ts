import { describe, it, expect } from 'vitest';
import { createInstallPlan } from '../install-planner.js';
import type { RuntimeEnvironment } from '../types.js';
import { createTestPkg, computeSha256, TEST_MANIFEST } from './fixtures/create-test-pkg.js';

const COMPAT_ENV: RuntimeEnvironment = {
  runtimeVersion: '1.5.0',
  environment: 'desktop',
  schemaVersion: '2026-03',
};

describe('install-planner / createInstallPlan', () => {
  // -----------------------------------------------------------------------
  // Full happy path
  // -----------------------------------------------------------------------
  it('produces a complete plan for a valid package', async () => {
    // Create archive with integrity.files removed to avoid hash mismatch
    const archive = createTestPkg({
      manifestOverride: {
        integrity: {
          package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          // No file hashes -> integrity passes trivially
        },
      },
    });

    const result = await createInstallPlan(archive, COMPAT_ENV);

    expect(result.ok).toBe(true);
    if (!result.ok) return; // type narrowing

    expect(result.plan.manifest.package.id).toBe(TEST_MANIFEST.package.id);
    expect(result.plan.compatibility.compatible).toBe(true);
    expect(result.plan.bindings.length).toBeGreaterThan(0);
    expect(result.plan.packageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.plan.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('passes with correct expectedHash', async () => {
    const archive = createTestPkg({
      manifestOverride: {
        integrity: {
          package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
    });
    const hash = await computeSha256(archive);

    const result = await createInstallPlan(archive, COMPAT_ENV, hash);
    expect(result.ok).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Integrity failure
  // -----------------------------------------------------------------------
  it('returns error at integrity stage when expectedHash mismatches', async () => {
    const archive = createTestPkg({
      manifestOverride: {
        integrity: {
          package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
    });
    const wrongHash = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';

    const result = await createInstallPlan(archive, COMPAT_ENV, wrongHash);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('integrity_checked');
    expect(result.errorCode).toBe('integrity_mismatch');
    expect(result.error).toContain('hash');
  });

  // -----------------------------------------------------------------------
  // Manifest failure
  // -----------------------------------------------------------------------
  it('returns error at manifest stage for corrupt archive', async () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02]);

    const result = await createInstallPlan(garbage, COMPAT_ENV);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('manifest_loaded');
    expect(result.errorCode).toBe('manifest_invalid');
  });

  // -----------------------------------------------------------------------
  // Compatibility failure
  // -----------------------------------------------------------------------
  it('returns error at compatibility stage for incompatible runtime', async () => {
    const archive = createTestPkg({
      manifestOverride: {
        integrity: {
          package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
    });

    const incompatibleEnv: RuntimeEnvironment = {
      runtimeVersion: '0.1.0',
      environment: 'desktop',
      schemaVersion: '2026-03',
    };

    const result = await createInstallPlan(archive, incompatibleEnv);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('compatibility_checked');
    expect(result.errorCode).toBe('compatibility_unsupported');
  });

  it('returns error at compatibility stage for unsupported environment', async () => {
    const archive = createTestPkg({
      manifestOverride: {
        integrity: {
          package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
    });

    const webEnv: RuntimeEnvironment = {
      runtimeVersion: '1.5.0',
      environment: 'web_limited',
      schemaVersion: '2026-03',
    };

    const result = await createInstallPlan(archive, webEnv);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('compatibility_checked');
  });

  // -----------------------------------------------------------------------
  // Confirmation logic
  // -----------------------------------------------------------------------
  it('needsConfirmation is false for safe package', async () => {
    // TEST_MANIFEST has risk_class: logic_asset, network_scope: none, filesystem_scope: workspace
    const archive = createTestPkg({
      manifestOverride: {
        permissions: {
          risk_class: 'logic_asset',
          declares_secrets: false,
          filesystem_scope: 'none',
          network_scope: 'none',
        },
        integrity: {
          package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
    });

    const result = await createInstallPlan(archive, COMPAT_ENV);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.needsConfirmation).toBe(false);
    expect(result.plan.confirmationReasons).toHaveLength(0);
  });

  it('needsConfirmation is true for privileged_asset', async () => {
    const archive = createTestPkg({
      manifestOverride: {
        permissions: {
          risk_class: 'privileged_asset',
          declares_secrets: false,
          filesystem_scope: 'none',
          network_scope: 'none',
        },
        integrity: {
          package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
    });

    const result = await createInstallPlan(archive, COMPAT_ENV);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.needsConfirmation).toBe(true);
    expect(result.plan.confirmationReasons.some((r) => r.includes('privileged'))).toBe(true);
  });

  it('needsConfirmation is true for non-none network_scope', async () => {
    const archive = createTestPkg({
      manifestOverride: {
        permissions: {
          risk_class: 'data_asset',
          declares_secrets: false,
          filesystem_scope: 'none',
          network_scope: 'limited',
        },
        integrity: {
          package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
    });

    const result = await createInstallPlan(archive, COMPAT_ENV);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.needsConfirmation).toBe(true);
    expect(result.plan.confirmationReasons.some((r) => r.includes('network'))).toBe(true);
  });

  it('needsConfirmation is true for filesystem_scope beyond workspace', async () => {
    const archive = createTestPkg({
      manifestOverride: {
        permissions: {
          risk_class: 'data_asset',
          declares_secrets: false,
          filesystem_scope: 'project',
          network_scope: 'none',
        },
        integrity: {
          package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
    });

    const result = await createInstallPlan(archive, COMPAT_ENV);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.needsConfirmation).toBe(true);
    expect(result.plan.confirmationReasons.some((r) => r.includes('filesystem'))).toBe(true);
  });

  it('needsConfirmation is false when filesystem_scope is workspace', async () => {
    const archive = createTestPkg({
      manifestOverride: {
        permissions: {
          risk_class: 'data_asset',
          declares_secrets: false,
          filesystem_scope: 'workspace',
          network_scope: 'none',
        },
        integrity: {
          package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
    });

    const result = await createInstallPlan(archive, COMPAT_ENV);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.needsConfirmation).toBe(false);
  });
});
