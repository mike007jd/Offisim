import type { PackageManifest } from '@offisim/asset-schema';
import { describe, expect, it } from 'vitest';
import { computeUpgradeDiff } from '../upgrade-differ.js';
import { TEST_MANIFEST } from './fixtures/create-test-pkg.js';

/**
 * Helper: create a manifest with deep overrides via JSON round-trip.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function withOverrides(overrides: Record<string, unknown>): PackageManifest {
  const base: unknown = JSON.parse(JSON.stringify(TEST_MANIFEST));
  if (!isRecord(base)) {
    throw new Error('TEST_MANIFEST clone must be an object');
  }

  for (const [path, value] of Object.entries(overrides)) {
    const keys = path.split('.');
    let obj: unknown = base;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!isRecord(obj)) {
        throw new Error(`Cannot descend into override path: ${path}`);
      }

      const key = keys[i];
      if (key === undefined) {
        throw new Error(`Invalid override path: ${path}`);
      }

      const next = obj[key];
      if (!isRecord(next)) {
        throw new Error(`Cannot descend into override path: ${path}`);
      }

      obj = next;
    }

    const lastKey = keys[keys.length - 1];
    if (lastKey === undefined) {
      throw new Error(`Invalid override path: ${path}`);
    }

    if (!isRecord(obj)) {
      throw new Error(`Cannot descend into override path: ${path}`);
    }

    obj[lastKey] = value;
  }
  return base as unknown as PackageManifest;
}

describe('upgrade-differ', () => {
  // -----------------------------------------------------------------------
  // No changes
  // -----------------------------------------------------------------------
  it('returns empty diff for identical manifests', () => {
    const diff = computeUpgradeDiff(TEST_MANIFEST, TEST_MANIFEST);
    expect(diff.entries).toHaveLength(0);
    expect(diff.maxSeverity).toBe('info');
    expect(diff.requiresMigration).toBe(false);
    expect(diff.counts).toEqual({ info: 0, warning: 0, breaking: 0 });
    expect(diff.fromVersion).toBe('1.0.0');
    expect(diff.toVersion).toBe('1.0.0');
  });

  // -----------------------------------------------------------------------
  // Metadata changes
  // -----------------------------------------------------------------------
  describe('metadata', () => {
    it('detects title change as info', () => {
      const newM = withOverrides({ 'package.title': 'New Title' });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      const entry = diff.entries.find((e) => e.field === 'package.title');
      expect(entry).toBeDefined();
      expect(entry?.severity).toBe('info');
      expect(entry?.category).toBe('metadata');
      expect(entry?.oldValue).toBe('Test Writer');
      expect(entry?.newValue).toBe('New Title');
    });

    it('detects summary change as info', () => {
      const newM = withOverrides({ 'package.summary': 'Updated summary' });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      expect(diff.entries.some((e) => e.field === 'package.summary')).toBe(true);
    });

    it('detects kind change as breaking', () => {
      const newM = withOverrides({ 'package.kind': 'sop' });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      const entry = diff.entries.find((e) => e.field === 'package.kind');
      expect(entry).toBeDefined();
      expect(entry?.severity).toBe('breaking');
    });

    it('detects license change as warning', () => {
      const newM = withOverrides({ 'package.license': 'GPL-3.0' });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      const entry = diff.entries.find((e) => e.field === 'package.license');
      expect(entry).toBeDefined();
      expect(entry?.severity).toBe('warning');
    });

    it('detects spec_version change as warning', () => {
      const newM = withOverrides({ spec_version: '2.0.0' });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      const entry = diff.entries.find((e) => e.field === 'spec_version');
      expect(entry).toBeDefined();
      expect(entry?.severity).toBe('warning');
    });

    it('detects tag changes', () => {
      const oldM = withOverrides({ 'package.tags': ['ai', 'writer'] });
      const newM = withOverrides({ 'package.tags': ['ai', 'coder'] });
      const diff = computeUpgradeDiff(oldM, newM);
      const entry = diff.entries.find((e) => e.field === 'package.tags');
      expect(entry).toBeDefined();
      expect(entry?.description).toContain('Added tags: coder');
      expect(entry?.description).toContain('Removed tags: writer');
    });
  });

  // -----------------------------------------------------------------------
  // Compatibility changes
  // -----------------------------------------------------------------------
  describe('compatibility', () => {
    it('detects runtime_range change as warning', () => {
      const newM = withOverrides({ 'compatibility.runtime_range': '>=2.0 <3.0' });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      const entry = diff.entries.find((e) => e.field === 'compatibility.runtime_range');
      expect(entry).toBeDefined();
      expect(entry?.severity).toBe('warning');
    });

    it('detects schema_version change as breaking + sets requiresMigration', () => {
      const newM = withOverrides({ 'compatibility.schema_version': '2026-06' });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      expect(diff.requiresMigration).toBe(true);
      const entry = diff.entries.find((e) => e.field === 'compatibility.schema_version');
      expect(entry).toBeDefined();
      expect(entry?.severity).toBe('breaking');
    });

    it('detects dropped environment support as breaking', () => {
      const newM = withOverrides({
        'compatibility.supported_environments': ['desktop'],
      });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      const entry = diff.entries.find(
        (e) => e.field === 'compatibility.supported_environments' && e.severity === 'breaking',
      );
      expect(entry).toBeDefined();
      expect(entry?.description).toContain('docker');
    });

    it('detects added environment support as info', () => {
      const newM = withOverrides({
        'compatibility.supported_environments': ['desktop', 'docker', 'web_limited'],
      });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      const entry = diff.entries.find(
        (e) => e.field === 'compatibility.supported_environments' && e.severity === 'info',
      );
      expect(entry).toBeDefined();
      expect(entry?.description).toContain('web_limited');
    });
  });

  // -----------------------------------------------------------------------
  // Requirements changes
  // -----------------------------------------------------------------------
  describe('requirements', () => {
    it('detects new required capabilities as warning', () => {
      const newM = withOverrides({
        'requirements.required_capabilities': ['chat', 'code_execution'],
      });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      const entry = diff.entries.find(
        (e) => e.field === 'requirements.required_capabilities' && e.severity === 'warning',
      );
      expect(entry).toBeDefined();
      expect(entry?.description).toContain('code_execution');
    });

    it('detects new required MCPs as warning', () => {
      const newM = withOverrides({
        'requirements.required_mcps': ['filesystem'],
      });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      const entry = diff.entries.find(
        (e) => e.field === 'requirements.required_mcps' && e.severity === 'warning',
      );
      expect(entry).toBeDefined();
    });

    it('detects removed required MCPs as info', () => {
      const oldM = withOverrides({ 'requirements.required_mcps': ['git'] });
      const newM = withOverrides({ 'requirements.required_mcps': [] });
      const diff = computeUpgradeDiff(oldM, newM);
      const entry = diff.entries.find(
        (e) => e.field === 'requirements.required_mcps' && e.severity === 'info',
      );
      expect(entry).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Permission changes
  // -----------------------------------------------------------------------
  describe('permissions', () => {
    it('detects risk class escalation as breaking', () => {
      const newM = withOverrides({ 'permissions.risk_class': 'privileged_asset' });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      const entry = diff.entries.find((e) => e.field === 'permissions.risk_class');
      expect(entry).toBeDefined();
      expect(entry?.severity).toBe('breaking');
      expect(entry?.description).toContain('ESCALATED');
    });

    it('detects risk class de-escalation as info', () => {
      const newM = withOverrides({ 'permissions.risk_class': 'data_asset' });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      const entry = diff.entries.find((e) => e.field === 'permissions.risk_class');
      expect(entry).toBeDefined();
      expect(entry?.severity).toBe('info');
    });

    it('detects filesystem scope escalation as breaking', () => {
      const newM = withOverrides({ 'permissions.filesystem_scope': 'custom_path' });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      const entry = diff.entries.find((e) => e.field === 'permissions.filesystem_scope');
      expect(entry).toBeDefined();
      expect(entry?.severity).toBe('breaking');
      expect(entry?.description).toContain('ESCALATED');
    });

    it('detects network scope escalation as breaking', () => {
      const newM = withOverrides({ 'permissions.network_scope': 'unrestricted' });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      const entry = diff.entries.find((e) => e.field === 'permissions.network_scope');
      expect(entry).toBeDefined();
      expect(entry?.severity).toBe('breaking');
    });

    it('detects new secret declaration as warning', () => {
      const newM = withOverrides({ 'permissions.declares_secrets': true });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      const entry = diff.entries.find((e) => e.field === 'permissions.declares_secrets');
      expect(entry).toBeDefined();
      expect(entry?.severity).toBe('warning');
    });

    it('detects new secret slots as warning', () => {
      const newM = withOverrides({
        'permissions.secret_slots_required': ['OPENAI_API_KEY'],
      });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      const entry = diff.entries.find((e) => e.field === 'permissions.secret_slots_required');
      expect(entry).toBeDefined();
      expect(entry?.severity).toBe('warning');
    });
  });

  // -----------------------------------------------------------------------
  // Asset changes
  // -----------------------------------------------------------------------
  describe('assets', () => {
    it('detects added assets', () => {
      const newM = withOverrides({
        assets: [
          ...TEST_MANIFEST.assets,
          {
            asset_id: 'new-skill',
            kind: 'skill',
            path: 'assets/skill.json',
          },
        ],
      });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      const entry = diff.entries.find(
        (e) => e.category === 'assets' && e.description.includes('Added'),
      );
      expect(entry).toBeDefined();
      expect(entry?.severity).toBe('info');
    });

    it('detects removed assets as warning', () => {
      const newM = withOverrides({ assets: [] });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      const entry = diff.entries.find(
        (e) => e.category === 'assets' && e.description.includes('Removed'),
      );
      expect(entry).toBeDefined();
      expect(entry?.severity).toBe('warning');
    });

    it('detects asset kind change as breaking', () => {
      const newM = withOverrides({
        assets: [
          {
            ...TEST_MANIFEST.assets[0],
            kind: 'skill',
          },
        ],
      });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      const entry = diff.entries.find((e) => e.category === 'assets' && e.severity === 'breaking');
      expect(entry).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // maxSeverity and counts
  // -----------------------------------------------------------------------
  describe('aggregate', () => {
    it('maxSeverity reflects the worst entry', () => {
      const newM = withOverrides({
        'package.title': 'New Title', // info
        'permissions.risk_class': 'privileged_asset', // breaking
      });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      expect(diff.maxSeverity).toBe('breaking');
      expect(diff.counts.breaking).toBeGreaterThanOrEqual(1);
      expect(diff.counts.info).toBeGreaterThanOrEqual(1);
    });

    it('counts all entries by severity', () => {
      const newM = withOverrides({
        'package.title': 'A', // info
        'package.summary': 'B', // info
        'package.license': 'GPL', // warning
      });
      const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
      expect(diff.counts.info).toBe(2);
      expect(diff.counts.warning).toBe(1);
      expect(diff.counts.breaking).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Version tracking
  // -----------------------------------------------------------------------
  it('tracks fromVersion and toVersion', () => {
    const newM = withOverrides({ 'package.version': '2.0.0' });
    const diff = computeUpgradeDiff(TEST_MANIFEST, newM);
    expect(diff.fromVersion).toBe('1.0.0');
    expect(diff.toVersion).toBe('2.0.0');
  });
});
