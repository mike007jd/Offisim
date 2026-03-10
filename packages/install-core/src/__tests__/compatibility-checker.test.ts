import { describe, expect, it } from 'vitest';
import {
  checkCompatibility,
  compareVersions,
  parseVersionRange,
} from '../compatibility-checker.js';
import type { RuntimeEnvironment } from '../types.js';
import { TEST_MANIFEST } from './fixtures/create-test-pkg.js';

// Default compatible environment for the TEST_MANIFEST
const COMPAT_ENV: RuntimeEnvironment = {
  runtimeVersion: '1.5.0',
  environment: 'desktop',
  schemaVersion: '2026-03',
};

describe('compatibility-checker', () => {
  // -----------------------------------------------------------------------
  // Version helpers
  // -----------------------------------------------------------------------
  describe('parseVersionRange', () => {
    it('parses ">=1.0 <2.0"', () => {
      const range = parseVersionRange('>=1.0 <2.0');
      expect(range.gte).toEqual([1, 0]);
      expect(range.lt).toEqual([2, 0]);
    });

    it('parses ">=1.0.0 <2.0.0"', () => {
      const range = parseVersionRange('>=1.0.0 <2.0.0');
      expect(range.gte).toEqual([1, 0, 0]);
      expect(range.lt).toEqual([2, 0, 0]);
    });

    it('parses ">=0.9" (lower bound only)', () => {
      const range = parseVersionRange('>=0.9');
      expect(range.gte).toEqual([0, 9]);
      expect(range.lt).toBeUndefined();
    });

    it('parses "<3.0" (upper bound only)', () => {
      const range = parseVersionRange('<3.0');
      expect(range.gte).toBeUndefined();
      expect(range.lt).toEqual([3, 0]);
    });
  });

  describe('compareVersions', () => {
    it('returns 0 for equal versions', () => {
      expect(compareVersions([1, 0, 0], [1, 0, 0])).toBe(0);
    });
    it('returns -1 when a < b', () => {
      expect(compareVersions([1, 0], [2, 0])).toBe(-1);
      expect(compareVersions([1, 0, 0], [1, 0, 1])).toBe(-1);
    });
    it('returns 1 when a > b', () => {
      expect(compareVersions([2, 0], [1, 9])).toBe(1);
      expect(compareVersions([1, 1], [1, 0, 99])).toBe(1);
    });
    it('treats missing segments as 0', () => {
      expect(compareVersions([1, 0], [1, 0, 0])).toBe(0);
      expect(compareVersions([1], [1, 0, 0])).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Compatible package passes
  // -----------------------------------------------------------------------
  describe('compatible package', () => {
    it('passes all checks with compatible environment', () => {
      const result = checkCompatibility(TEST_MANIFEST, COMPAT_ENV);
      expect(result.compatible).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes at the exact lower bound', () => {
      const env: RuntimeEnvironment = { ...COMPAT_ENV, runtimeVersion: '1.0.0' };
      const result = checkCompatibility(TEST_MANIFEST, env);
      expect(result.compatible).toBe(true);
    });

    it('passes with docker environment (also supported)', () => {
      const env: RuntimeEnvironment = { ...COMPAT_ENV, environment: 'docker' };
      const result = checkCompatibility(TEST_MANIFEST, env);
      expect(result.compatible).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Runtime version out of range
  // -----------------------------------------------------------------------
  describe('runtime version out of range', () => {
    it('fails when runtime version is below range', () => {
      const env: RuntimeEnvironment = { ...COMPAT_ENV, runtimeVersion: '0.9.0' };
      const result = checkCompatibility(TEST_MANIFEST, env);
      expect(result.compatible).toBe(false);
      expect(result.errors.some((e) => e.code === 'runtime_range')).toBe(true);
    });

    it('fails when runtime version equals upper bound (exclusive)', () => {
      const env: RuntimeEnvironment = { ...COMPAT_ENV, runtimeVersion: '2.0.0' };
      const result = checkCompatibility(TEST_MANIFEST, env);
      expect(result.compatible).toBe(false);
      expect(result.errors.some((e) => e.code === 'runtime_range')).toBe(true);
    });

    it('fails when runtime version is above range', () => {
      const env: RuntimeEnvironment = { ...COMPAT_ENV, runtimeVersion: '3.0.0' };
      const result = checkCompatibility(TEST_MANIFEST, env);
      expect(result.compatible).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Unsupported environment
  // -----------------------------------------------------------------------
  describe('unsupported environment', () => {
    it('fails when environment is not in supported list', () => {
      const env: RuntimeEnvironment = { ...COMPAT_ENV, environment: 'web_limited' };
      const result = checkCompatibility(TEST_MANIFEST, env);
      expect(result.compatible).toBe(false);
      expect(result.errors.some((e) => e.code === 'environment')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Schema version mismatch
  // -----------------------------------------------------------------------
  describe('schema version mismatch', () => {
    it('fails when schema version does not match', () => {
      const env: RuntimeEnvironment = { ...COMPAT_ENV, schemaVersion: '2025-12' };
      const result = checkCompatibility(TEST_MANIFEST, env);
      expect(result.compatible).toBe(false);
      expect(result.errors.some((e) => e.code === 'schema_version')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Multiple failures reported
  // -----------------------------------------------------------------------
  describe('multiple failures', () => {
    it('reports all errors when multiple checks fail', () => {
      const env: RuntimeEnvironment = {
        runtimeVersion: '0.1.0',
        environment: 'web_limited',
        schemaVersion: '2025-01',
      };
      const result = checkCompatibility(TEST_MANIFEST, env);
      expect(result.compatible).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);

      const codes = result.errors.map((e) => e.code);
      expect(codes).toContain('runtime_range');
      expect(codes).toContain('environment');
      expect(codes).toContain('schema_version');
    });
  });
});
