/**
 * Install planner — orchestrates the pre-install pipeline.
 *
 * Pipeline: extractPackage → checkIntegrity → checkCompatibility → resolveBindings
 * Produces a PlanResult with either an InstallPlan (ok) or an error with stage info.
 */

import { resolveBindings } from './binding-resolver.js';
import { checkCompatibility } from './compatibility-checker.js';
import { checkIntegrity } from './integrity-checker.js';
import { extractPackage } from './manifest-loader.js';
import type { ExtractedPackage, PlanResult, RuntimeEnvironment } from './types.js';

// ---------------------------------------------------------------------------
// Confirmation logic
// ---------------------------------------------------------------------------

/**
 * Determine whether user confirmation is required before materialization.
 *
 * Reasons (from install state machine spec §6):
 * - risk_class === 'privileged_asset'
 * - network_scope !== 'none'
 * - filesystem_scope !== 'none' && filesystem_scope !== 'workspace'
 */
function computeConfirmation(manifest: {
  permissions: {
    risk_class: string;
    network_scope: string;
    filesystem_scope: string;
  };
}): { needsConfirmation: boolean; confirmationReasons: string[] } {
  const reasons: string[] = [];
  const perms = manifest.permissions;

  if (perms.risk_class === 'privileged_asset') {
    reasons.push('Package is classified as privileged_asset');
  }

  if (perms.network_scope !== 'none') {
    reasons.push(`Package requires network access (scope: ${perms.network_scope})`);
  }

  if (perms.filesystem_scope !== 'none' && perms.filesystem_scope !== 'workspace') {
    reasons.push(
      `Package requires filesystem access beyond workspace (scope: ${perms.filesystem_scope})`,
    );
  }

  return {
    needsConfirmation: reasons.length > 0,
    confirmationReasons: reasons,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the full pre-install pipeline and produce an install plan.
 *
 * @param archiveBytes - Raw bytes of the .offisimpkg ZIP archive.
 * @param env - Current runtime environment for compatibility checks.
 * @param expectedHash - Optional expected SHA-256 of the archive (e.g. from registry).
 * @returns PlanResult — either { ok: true, plan } or { ok: false, stage, error }.
 */
export async function createInstallPlan(
  archiveBytes: Uint8Array,
  env: RuntimeEnvironment,
  expectedHash?: string,
): Promise<PlanResult> {
  // 1. Extract and validate manifest
  let extracted: ExtractedPackage;
  try {
    extracted = await extractPackage(archiveBytes);
  } catch (err) {
    return {
      ok: false,
      stage: 'manifest_loaded',
      error: err instanceof Error ? err.message : String(err),
      errorCode: 'manifest_invalid',
    };
  }

  // 2. Integrity check
  const integrity = await checkIntegrity(extracted, expectedHash);
  if (!integrity.valid) {
    const details: string[] = [];
    if (!integrity.packageHashMatch) {
      details.push('package hash mismatch');
    }
    if (integrity.fileHashErrors.length > 0) {
      details.push(`file hash errors: ${integrity.fileHashErrors.join(', ')}`);
    }
    return {
      ok: false,
      stage: 'integrity_checked',
      error: `Integrity check failed: ${details.join('; ')}`,
      errorCode: 'integrity_mismatch',
    };
  }

  // 3. Compatibility check
  const compatibility = checkCompatibility(extracted.manifest, env);
  if (!compatibility.compatible) {
    const messages = compatibility.errors.map((e) => e.message).join('; ');
    return {
      ok: false,
      stage: 'compatibility_checked',
      error: `Compatibility check failed: ${messages}`,
      errorCode: 'compatibility_unsupported',
    };
  }

  // 4. Resolve bindings
  const bindings = resolveBindings(extracted.manifest);

  // 5. Determine confirmation requirements
  const { needsConfirmation, confirmationReasons } = computeConfirmation(extracted.manifest);

  return {
    ok: true,
    plan: {
      manifest: extracted.manifest,
      compatibility,
      bindings,
      needsConfirmation,
      confirmationReasons,
      packageHash: extracted.packageHash,
      manifestHash: extracted.manifestHash,
    },
  };
}
