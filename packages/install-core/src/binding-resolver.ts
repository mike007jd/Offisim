/**
 * Binding resolver — extract binding requirements from a package manifest.
 *
 * MVP scope: only model_profile bindings from asset.recommended_models,
 * cross-referenced with manifest.requirements.recommended_models for hints.
 */

import type { PackageManifest } from '@offisim/asset-schema';
import type { BindingRequirement } from './types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve all binding requirements from a manifest's assets.
 *
 * For each asset with recommended_models, produces one BindingRequirement per
 * model profile string. Hints and providerHints are sourced from the top-level
 * manifest.requirements.recommended_models array (matched by profile name).
 *
 * @returns Array of BindingRequirement objects. Empty if no bindings needed.
 */
export function resolveBindings(manifest: PackageManifest): BindingRequirement[] {
  const bindings: BindingRequirement[] = [];

  // Build a lookup from profile name to the top-level recommended_models entry
  const modelHints = new Map<string, { reason?: string; provider_hints?: readonly string[] }>();
  if (manifest.requirements.recommended_models) {
    for (const model of manifest.requirements.recommended_models) {
      modelHints.set(model.profile, {
        reason: model.reason,
        provider_hints: model.provider_hints,
      });
    }
  }

  for (const asset of manifest.assets) {
    if (!asset.recommended_models || asset.recommended_models.length === 0) {
      continue;
    }

    for (const profile of asset.recommended_models) {
      const hints = modelHints.get(profile);

      bindings.push({
        assetId: asset.asset_id,
        assetKind: asset.kind,
        bindingType: 'model_profile',
        bindingKey: `${asset.asset_id}:${profile}`,
        required: false, // recommended models are optional
        hint: hints?.reason,
        providerHints: hints?.provider_hints,
      });
    }
  }

  return bindings;
}
