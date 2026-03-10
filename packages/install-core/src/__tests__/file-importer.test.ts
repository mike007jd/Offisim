import { describe, expect, it } from 'vitest';
import { FileImportError, readPackageFile } from '../file-importer.js';

// ---------------------------------------------------------------------------
// Helpers — create mock File objects
// ---------------------------------------------------------------------------

function createMockFile(name: string, sizeOrContent: number | Uint8Array): File {
  if (typeof sizeOrContent === 'number') {
    // Create a file with the given size (content doesn't matter for validation)
    const content = new Uint8Array(Math.min(sizeOrContent, 1024));
    const blob = new Blob([content as Uint8Array<ArrayBuffer>]);
    // Override size for large-file testing
    const file = new File([blob], name);
    if (sizeOrContent !== content.length) {
      Object.defineProperty(file, 'size', { value: sizeOrContent });
    }
    return file;
  }
  return new File([sizeOrContent as Uint8Array<ArrayBuffer>], name);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('file-importer / readPackageFile', () => {
  // -----------------------------------------------------------------------
  // Extension validation
  // -----------------------------------------------------------------------
  describe('extension validation', () => {
    it('accepts .aicspkg files', async () => {
      const content = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // ZIP magic bytes
      const file = createMockFile('my-package.aicspkg', content);

      const result = await readPackageFile(file);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(4);
    });

    it('accepts .zip files', async () => {
      const content = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
      const file = createMockFile('my-package.zip', content);

      const result = await readPackageFile(file);
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('accepts .AICSPKG files (case insensitive)', async () => {
      const content = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
      const file = createMockFile('MY-PACKAGE.AICSPKG', content);

      const result = await readPackageFile(file);
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('rejects .tar.gz files', async () => {
      const file = createMockFile('my-package.tar.gz', new Uint8Array(10));

      await expect(readPackageFile(file)).rejects.toThrow(FileImportError);
      await expect(readPackageFile(file)).rejects.toThrow('Invalid file extension');
    });

    it('rejects .json files', async () => {
      const file = createMockFile('manifest.json', new Uint8Array(10));

      try {
        await readPackageFile(file);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(FileImportError);
        expect((err as FileImportError).code).toBe('invalid_extension');
      }
    });

    it('rejects files with no extension', async () => {
      const file = createMockFile('noextension', new Uint8Array(10));

      await expect(readPackageFile(file)).rejects.toThrow(FileImportError);
    });
  });

  // -----------------------------------------------------------------------
  // Size validation
  // -----------------------------------------------------------------------
  describe('size validation', () => {
    it('accepts a file under 50 MB', async () => {
      const content = new Uint8Array(100);
      const file = createMockFile('ok.aicspkg', content);

      const result = await readPackageFile(file);
      expect(result.length).toBe(100);
    });

    it('accepts a file at exactly 50 MB', async () => {
      // We mock the size but use small actual content to avoid memory issues
      const content = new Uint8Array(64);
      const file = createMockFile('exact.aicspkg', content);
      Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 });

      // The size check passes, but the actual content is 64 bytes
      const result = await readPackageFile(file);
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it('rejects a file over 50 MB', async () => {
      const file = createMockFile('huge.aicspkg', 51 * 1024 * 1024);

      try {
        await readPackageFile(file);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(FileImportError);
        expect((err as FileImportError).code).toBe('file_too_large');
        expect((err as FileImportError).message).toContain('50 MB');
      }
    });
  });

  // -----------------------------------------------------------------------
  // Successful read
  // -----------------------------------------------------------------------
  describe('reading bytes', () => {
    it('returns the exact bytes of the file', async () => {
      const content = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const file = createMockFile('test.aicspkg', content);

      const result = await readPackageFile(file);
      expect(result).toEqual(content);
    });
  });
});
