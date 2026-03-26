import type { PackageManifest } from '@aics/asset-schema';
import { describe, expect, it } from 'vitest';
import { resolveBindings } from '../binding-resolver.js';
import { TEST_MANIFEST } from './fixtures/create-test-pkg.js';

function requireDefined<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message);
  }
  return value;
}

describe('binding-resolver / resolveBindings', () => {
  // -----------------------------------------------------------------------
  // Manifest with recommended_models
  // -----------------------------------------------------------------------
  it('produces bindings for each recommended model in each asset', () => {
    const bindings = resolveBindings(TEST_MANIFEST);

    // TEST_MANIFEST has 1 asset with 2 recommended_models
    expect(bindings).toHaveLength(2);

    // First binding: reasoning-heavy
    const b0 = requireDefined(bindings[0], 'Expected first binding');
    expect(b0.assetId).toBe('test-writer-default');
    expect(b0.assetKind).toBe('employee');
    expect(b0.bindingType).toBe('model_profile');
    expect(b0.bindingKey).toBe('test-writer-default:reasoning-heavy');
    expect(b0.required).toBe(false);
    expect(b0.hint).toBe('for complex tasks');
    expect(b0.providerHints).toEqual(['openai', 'anthropic']);

    // Second binding: cheap-draft
    const b1 = requireDefined(bindings[1], 'Expected second binding');
    expect(b1.bindingKey).toBe('test-writer-default:cheap-draft');
    expect(b1.hint).toBe('for bulk work');
    expect(b1.providerHints).toBeUndefined(); // cheap-draft has no provider_hints in TEST_MANIFEST
  });

  // -----------------------------------------------------------------------
  // Manifest with no recommended_models
  // -----------------------------------------------------------------------
  it('returns empty array when no assets have recommended_models', () => {
    const noModelsManifest: PackageManifest = {
      ...TEST_MANIFEST,
      requirements: {
        ...TEST_MANIFEST.requirements,
        recommended_models: [],
      },
      assets: [
        {
          asset_id: 'bare-asset',
          kind: 'employee',
          path: 'assets/bare.json',
        },
      ],
    };

    const bindings = resolveBindings(noModelsManifest);
    expect(bindings).toHaveLength(0);
  });

  it('returns empty array when recommended_models is undefined on assets', () => {
    const manifest: PackageManifest = {
      ...TEST_MANIFEST,
      assets: [
        {
          asset_id: 'no-models',
          kind: 'skill',
          path: 'assets/skill.json',
          // recommended_models not specified
        },
      ],
    };

    const bindings = resolveBindings(manifest);
    expect(bindings).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Multiple assets with models
  // -----------------------------------------------------------------------
  it('collects bindings from all assets', () => {
    const multiAssetManifest: PackageManifest = {
      ...TEST_MANIFEST,
      assets: [
        {
          asset_id: 'writer-alpha',
          kind: 'employee',
          path: 'assets/alpha.json',
          recommended_models: ['reasoning-heavy'],
        },
        {
          asset_id: 'writer-beta',
          kind: 'employee',
          path: 'assets/beta.json',
          recommended_models: ['cheap-draft', 'reasoning-heavy'],
        },
        {
          asset_id: 'plain-skill',
          kind: 'skill',
          path: 'assets/skill.json',
          // no recommended_models
        },
      ],
    };

    const bindings = resolveBindings(multiAssetManifest);

    // alpha: 1 binding, beta: 2 bindings, plain-skill: 0
    expect(bindings).toHaveLength(3);

    const keys = bindings.map((b) => b.bindingKey);
    expect(keys).toContain('writer-alpha:reasoning-heavy');
    expect(keys).toContain('writer-beta:cheap-draft');
    expect(keys).toContain('writer-beta:reasoning-heavy');
  });

  // -----------------------------------------------------------------------
  // Binding without top-level hint
  // -----------------------------------------------------------------------
  it('produces binding with undefined hint when profile has no top-level entry', () => {
    const manifest: PackageManifest = {
      ...TEST_MANIFEST,
      requirements: {
        ...TEST_MANIFEST.requirements,
        recommended_models: [], // no top-level hints
      },
      assets: [
        {
          asset_id: 'orphan',
          kind: 'employee',
          path: 'assets/orphan.json',
          recommended_models: ['unknown-profile'],
        },
      ],
    };

    const bindings = resolveBindings(manifest);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.hint).toBeUndefined();
    expect(bindings[0]?.providerHints).toBeUndefined();
  });
});
