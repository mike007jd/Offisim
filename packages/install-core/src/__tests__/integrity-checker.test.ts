import { describe, it, expect } from 'vitest';
import { checkIntegrity } from '../integrity-checker.js';
import { extractPackage } from '../manifest-loader.js';
import { createTestPkg, computeSha256, TEST_ASSET_CONTENT } from './fixtures/create-test-pkg.js';

describe('integrity-checker / checkIntegrity', () => {
  // -----------------------------------------------------------------------
  // Helper: extract a test package and patch its manifest integrity to match
  // the actual computed hashes (so we can test a "valid" baseline).
  // -----------------------------------------------------------------------
  async function extractWithCorrectHashes() {
    // First pass: extract to get actual file hashes
    const archive = createTestPkg();
    const extracted = await extractPackage(archive);

    // Compute real hash for the asset file
    const assetBytes = extracted.files.get('assets/employee.test-writer.json')!;
    const assetHash = await computeSha256(assetBytes);

    // Rebuild archive with correct file hashes in manifest
    const correctArchive = createTestPkg({
      manifestOverride: {
        integrity: {
          package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          files: [
            { path: 'assets/employee.test-writer.json', sha256: assetHash },
          ],
        },
      },
    });

    return extractPackage(correctArchive);
  }

  // -----------------------------------------------------------------------
  // Valid package passes integrity
  // -----------------------------------------------------------------------
  it('valid package with correct file hashes passes integrity', async () => {
    const extracted = await extractWithCorrectHashes();
    const result = await checkIntegrity(extracted);

    expect(result.valid).toBe(true);
    expect(result.packageHashMatch).toBe(true);
    expect(result.fileHashErrors).toHaveLength(0);
  });

  it('valid package with correct expectedHash passes', async () => {
    const archive = createTestPkg();
    const extracted = await extractPackage(archive);
    // Remove file hash checking by using empty files array
    const archiveNoFileCheck = createTestPkg({
      manifestOverride: {
        integrity: {
          package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          files: [],
        },
      },
    });
    const extractedNoFileCheck = await extractPackage(archiveNoFileCheck);
    const result = await checkIntegrity(extractedNoFileCheck, extractedNoFileCheck.packageHash);

    expect(result.valid).toBe(true);
    expect(result.packageHashMatch).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Mismatched expectedHash
  // -----------------------------------------------------------------------
  it('mismatched expectedHash -> valid: false', async () => {
    const archive = createTestPkg({
      manifestOverride: {
        integrity: {
          package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          files: [],
        },
      },
    });
    const extracted = await extractPackage(archive);
    const wrongHash = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

    const result = await checkIntegrity(extracted, wrongHash);

    expect(result.valid).toBe(false);
    expect(result.packageHashMatch).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Mismatched file hash
  // -----------------------------------------------------------------------
  it('mismatched file hash -> valid: false, path in fileHashErrors', async () => {
    // Create archive with intentionally wrong file hash
    const archive = createTestPkg({
      manifestOverride: {
        integrity: {
          package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          files: [
            {
              path: 'assets/employee.test-writer.json',
              sha256: 'deaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddead',
            },
          ],
        },
      },
    });
    const extracted = await extractPackage(archive);
    const result = await checkIntegrity(extracted);

    expect(result.valid).toBe(false);
    expect(result.fileHashErrors).toContain('assets/employee.test-writer.json');
  });

  // -----------------------------------------------------------------------
  // Missing expected file
  // -----------------------------------------------------------------------
  it('missing expected file -> valid: false, path in fileHashErrors', async () => {
    const archive = createTestPkg({
      manifestOverride: {
        integrity: {
          package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          files: [
            {
              path: 'assets/nonexistent-file.json',
              sha256: 'deaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddead',
            },
          ],
        },
      },
    });
    const extracted = await extractPackage(archive);
    const result = await checkIntegrity(extracted);

    expect(result.valid).toBe(false);
    expect(result.fileHashErrors).toContain('assets/nonexistent-file.json');
  });

  // -----------------------------------------------------------------------
  // No file hashes in manifest (should pass)
  // -----------------------------------------------------------------------
  it('manifest with no file hashes still passes', async () => {
    const archive = createTestPkg({
      manifestOverride: {
        integrity: {
          package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
    });
    const extracted = await extractPackage(archive);
    const result = await checkIntegrity(extracted);

    expect(result.valid).toBe(true);
    expect(result.fileHashErrors).toHaveLength(0);
  });
});
