import { describe, expect, it } from 'vitest';
import { extractPackage } from '../manifest-loader.js';
import { TEST_MANIFEST, computeSha256, createTestPkg } from './fixtures/create-test-pkg.js';

function requireDefined<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message);
  }
  return value;
}

describe('manifest-loader / extractPackage', () => {
  // -----------------------------------------------------------------------
  // Valid ZIP
  // -----------------------------------------------------------------------
  it('extracts a valid ZIP with correct manifest and files', async () => {
    const archive = createTestPkg();
    const result = await extractPackage(archive);

    expect(result.manifest.package.id).toBe(TEST_MANIFEST.package.id);
    expect(result.manifest.spec_version).toBe('1.0.0');
    expect(result.files.has('manifest.json')).toBe(true);
    expect(result.files.has('assets/employee.test-writer.json')).toBe(true);
    expect(result.files.has('README.md')).toBe(true);
  });

  it('computes correct SHA-256 hashes as 64-char hex strings', async () => {
    const archive = createTestPkg();
    const result = await extractPackage(archive);

    // Hashes are 64-char lowercase hex
    expect(result.packageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.manifestHash).toMatch(/^[a-f0-9]{64}$/);

    // Package hash matches independently computed hash of archive bytes
    const expectedPkgHash = await computeSha256(archive);
    expect(result.packageHash).toBe(expectedPkgHash);

    // Manifest hash matches hash of the manifest.json bytes inside the zip
    const manifestBytes = requireDefined(
      result.files.get('manifest.json'),
      'Expected manifest.json bytes in extracted files',
    );
    const expectedManifestHash = await computeSha256(manifestBytes);
    expect(result.manifestHash).toBe(expectedManifestHash);
  });

  // -----------------------------------------------------------------------
  // Missing manifest.json
  // -----------------------------------------------------------------------
  it('throws when ZIP has no manifest.json', async () => {
    const archive = createTestPkg({ omitManifest: true });
    await expect(extractPackage(archive)).rejects.toThrow('manifest.json');
  });

  // -----------------------------------------------------------------------
  // Invalid / malformed manifest JSON
  // -----------------------------------------------------------------------
  it('throws when manifest.json is not valid JSON', async () => {
    const archive = createTestPkg({
      omitManifest: true,
      extraFiles: {
        'manifest.json': '{ this is not json }',
      },
    });
    await expect(extractPackage(archive)).rejects.toThrow('parse');
  });

  it('throws when manifest fails schema validation', async () => {
    // A manifest missing required fields
    const archive = createTestPkg({
      omitManifest: true,
      extraFiles: {
        'manifest.json': JSON.stringify({ spec_version: '1.0.0' }),
      },
    });
    await expect(extractPackage(archive)).rejects.toThrow('Invalid manifest');
  });

  // -----------------------------------------------------------------------
  // Corrupt / non-ZIP bytes
  // -----------------------------------------------------------------------
  it('throws on corrupt (non-ZIP) bytes', async () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
    await expect(extractPackage(garbage)).rejects.toThrow('decompress');
  });

  it('throws on empty bytes', async () => {
    const empty = new Uint8Array(0);
    await expect(extractPackage(empty)).rejects.toThrow('decompress');
  });
});
