import { describe, it, expect } from 'vitest';
import { validateManifest } from '../validate.js';
import validManifest from './fixtures/valid-manifest.json';

describe('validateManifest', () => {
  it('accepts a valid manifest', () => {
    const result = validateManifest(validManifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('rejects a manifest missing required fields', () => {
    const result = validateManifest({});
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('rejects invalid network_scope value', () => {
    const bad = {
      ...validManifest,
      permissions: { ...validManifest.permissions, network_scope: 'open' },
    };
    const result = validateManifest(bad);
    expect(result.valid).toBe(false);
  });

  it('rejects invalid filesystem_scope value', () => {
    const bad = {
      ...validManifest,
      permissions: { ...validManifest.permissions, filesystem_scope: 'project_root' },
    };
    const result = validateManifest(bad);
    expect(result.valid).toBe(false);
  });
});
