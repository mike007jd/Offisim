/**
 * safe-archive — streaming, zip-bomb-resistant guards for the OOXML importers.
 *
 * OOXML files (pptx / docx / xlsx) are ZIP archives. The parser libraries
 * (JSZip, mammoth, SheetJS) all inflate the WHOLE archive into memory and
 * expose no streaming/size hook, so a maliciously crafted "zip bomb" (tiny
 * compressed → many GB inflated) would OOM the renderer before any size check
 * could run. The compressed input cap upstream (8 MB on desktop) bounds the
 * INPUT but not the inflated size — DEFLATE reaches ~1032:1.
 *
 * The only real defence is to inflate WITH a hard cap and bail mid-stream. We
 * drive fflate's streaming `Unzip`/`UnzipInflate` and accumulate decompressed
 * bytes per chunk, throwing the moment the cap is crossed — before the
 * gigabytes are allocated. A declared-size budget would NOT be safe because the
 * central-directory size fields can be forged; the streaming accumulator
 * measures the real inflated bytes.
 *
 * This mirrors `@offisim/install-core`'s `safe-unzip`, duplicated here on
 * purpose: install-core only exposes its barrel (`.`) entry, whose index
 * re-exports the entire install graph (install-service / materializer /
 * planner / db-local types). Importing it from doc-engine would drag all of
 * that into a browser doc-parsing bundle for one leaf function. The limits and
 * surface also differ per boundary (doc-engine adds the validate-only
 * `assertArchiveInflationBudget`; install-core adds tar.gz `safeGunzipSync`).
 */

import { Unzip, UnzipInflate } from 'fflate';

export interface SafeArchiveLimits {
  maxCompressedBytes?: number;
  maxDecompressedBytes?: number;
  maxEntryBytes?: number;
  maxEntryCount?: number;
}

// OOXML documents legitimately bundle many parts (slides, media, styles), so
// the entry count is generous; the byte budgets are the real bomb guard.
export const DEFAULT_DOC_ARCHIVE_LIMITS: Required<SafeArchiveLimits> = {
  maxCompressedBytes: 32 * 1024 * 1024, // 32 MB compressed input
  maxDecompressedBytes: 128 * 1024 * 1024, // 128 MB total inflated
  maxEntryBytes: 64 * 1024 * 1024, // 64 MB per part
  maxEntryCount: 8192,
};

/** Thrown when an archive trips a zip-bomb / resource cap. */
export class ZipBombError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipBombError';
  }
}

function concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Streaming, bomb-resistant ZIP extraction. Returns `Record<path, bytes>`.
 * Throws {@link ZipBombError} if any cap is exceeded, or a plain Error on a
 * corrupt archive. Directory entries are skipped.
 */
export function safeUnzipEntries(
  bytes: Uint8Array,
  limits: SafeArchiveLimits = {},
): Record<string, Uint8Array> {
  const cfg = { ...DEFAULT_DOC_ARCHIVE_LIMITS, ...limits };

  if (bytes.byteLength > cfg.maxCompressedBytes) {
    throw new ZipBombError(
      `Compressed archive exceeds ${cfg.maxCompressedBytes} byte cap (${bytes.byteLength} bytes)`,
    );
  }

  const files: Record<string, Uint8Array> = {};
  let totalInflated = 0;
  let entryCount = 0;
  let captured: Error | null = null;

  const unzip = new Unzip((file) => {
    if (captured) return;
    if (file.name.endsWith('/')) return; // directory entry

    entryCount += 1;
    if (entryCount > cfg.maxEntryCount) {
      captured = new ZipBombError(`Archive contains too many entries (> ${cfg.maxEntryCount})`);
      return;
    }
    if (typeof file.originalSize === 'number' && file.originalSize > cfg.maxEntryBytes) {
      captured = new ZipBombError(
        `Entry "${file.name}" declares ${file.originalSize} bytes, exceeding per-entry cap ${cfg.maxEntryBytes}`,
      );
      return;
    }

    const chunks: Uint8Array[] = [];
    let entryInflated = 0;
    file.ondata = (err, chunk, final) => {
      if (captured) return;
      if (err) {
        captured = err instanceof Error ? err : new Error(String(err));
        return;
      }
      entryInflated += chunk.length;
      totalInflated += chunk.length;
      if (entryInflated > cfg.maxEntryBytes) {
        captured = new ZipBombError(
          `Entry "${file.name}" inflates beyond per-entry cap ${cfg.maxEntryBytes} bytes (possible zip bomb)`,
        );
        return;
      }
      if (totalInflated > cfg.maxDecompressedBytes) {
        captured = new ZipBombError(
          `Archive inflates beyond ${cfg.maxDecompressedBytes} bytes; refusing to load (possible zip bomb)`,
        );
        return;
      }
      chunks.push(chunk);
      if (final) files[file.name.replace(/^\.\//u, '')] = concatChunks(chunks, entryInflated);
    };
    file.start();
  });

  unzip.register(UnzipInflate);

  // Feed compressed bytes in 64 KB slices so the sync inflate emits output
  // incrementally and the accumulator trips before allocating the full buffer.
  const PUSH_SLICE_BYTES = 64 * 1024;
  try {
    for (let offset = 0; offset < bytes.length; offset += PUSH_SLICE_BYTES) {
      if (captured) break;
      const end = Math.min(offset + PUSH_SLICE_BYTES, bytes.length);
      unzip.push(bytes.subarray(offset, end), end === bytes.length);
    }
    if (bytes.length === 0) unzip.push(new Uint8Array(0), true);
  } catch (err) {
    if (captured) throw captured;
    throw err instanceof Error ? err : new Error(String(err));
  }

  if (captured) throw captured;
  return files;
}

/**
 * Validation gate for parser libraries that do their OWN zip parsing (SheetJS,
 * mammoth): we inflate once with a hard cap purely to PROVE the real inflated
 * size is bounded, then the caller hands the original bytes to the library.
 * Throws {@link ZipBombError} if the archive is a bomb, so the library never
 * sees it. The validation itself is bounded — it throws before exceeding the
 * cap, so this cannot OOM.
 */
export function assertArchiveInflationBudget(
  bytes: Uint8Array,
  limits: SafeArchiveLimits = {},
): void {
  // safeUnzipEntries throws on any cap violation; discard the result.
  safeUnzipEntries(bytes, limits);
}
