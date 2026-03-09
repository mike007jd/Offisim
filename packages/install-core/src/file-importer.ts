/**
 * File importer — browser File API adapter for .aicspkg archives.
 *
 * Validates file size and extension before reading bytes.
 * This module is intentionally browser-only (uses File API).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed archive size: 50 MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Allowed file extensions (lowercase, with dot). */
const ALLOWED_EXTENSIONS = new Set(['.aicspkg', '.zip']);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class FileImportError extends Error {
  readonly code: 'file_too_large' | 'invalid_extension' | 'read_failed';

  constructor(code: FileImportError['code'], message: string) {
    super(message);
    this.name = 'FileImportError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1) return '';
  return filename.slice(dotIndex).toLowerCase();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read a package file from the browser File API and return its raw bytes.
 *
 * @param file - A browser `File` object (e.g. from `<input type="file">`).
 * @returns The file contents as a Uint8Array.
 * @throws {FileImportError} If the file exceeds 50 MB or has an invalid extension.
 */
export async function readPackageFile(file: File): Promise<Uint8Array> {
  // 1. Validate extension
  const ext = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new FileImportError(
      'invalid_extension',
      `Invalid file extension '${ext}'. Expected one of: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
    );
  }

  // 2. Validate file size
  if (file.size > MAX_FILE_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    throw new FileImportError(
      'file_too_large',
      `File size (${sizeMB} MB) exceeds maximum allowed size of 50 MB`,
    );
  }

  // 3. Read file bytes
  try {
    const buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
  } catch (err) {
    throw new FileImportError(
      'read_failed',
      `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
