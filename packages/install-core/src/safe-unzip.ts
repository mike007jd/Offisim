/**
 * safe-unzip — streaming, zip-bomb-resistant ZIP extraction.
 *
 * Root cause this fixes: `unzipSync(bytes)` inflates the ENTIRE archive into
 * memory first, so any "decompressed size" cap checked afterwards is useless —
 * the OOM has already happened by the time you measure it. A 64 MB archive can
 * inflate to many gigabytes before a post-hoc check ever runs.
 *
 * `safeUnzipSync` instead drives fflate's streaming `Unzip` with the
 * synchronous `UnzipInflate` codec and accumulates decompressed bytes in the
 * per-entry `ondata` handler. The moment cumulative (or per-entry) inflated
 * bytes exceed the configured cap, it throws — BEFORE the gigabytes are
 * allocated. Entry count and per-entry size are also bounded.
 *
 * It is a drop-in replacement for `unzipSync`: returns `Record<path, bytes>`.
 */

import { Gunzip, Unzip, UnzipInflate } from 'fflate';

export interface SafeUnzipLimits {
  /** Reject the compressed input itself above this many bytes. */
  maxCompressedBytes?: number;
  /** Reject once cumulative inflated bytes across all entries exceed this. */
  maxDecompressedBytes?: number;
  /** Reject any single entry that inflates beyond this many bytes. */
  maxEntryBytes?: number;
  /** Reject archives declaring/containing more than this many file entries. */
  maxEntryCount?: number;
}

export const DEFAULT_SAFE_UNZIP_LIMITS: Required<SafeUnzipLimits> = {
  maxCompressedBytes: 64 * 1024 * 1024, // 64 MB
  maxDecompressedBytes: 64 * 1024 * 1024, // 64 MB
  maxEntryBytes: 16 * 1024 * 1024, // 16 MB
  maxEntryCount: 2000,
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
 * Streaming, bomb-resistant ZIP extraction. Throws {@link ZipBombError} if any
 * cap is exceeded, or a plain Error on a corrupt/unsupported archive.
 *
 * Directory entries (paths ending in `/`) are skipped, matching the previous
 * `unzipSync` consumers' behavior.
 */
export function safeUnzipSync(
  bytes: Uint8Array,
  limits: SafeUnzipLimits = {},
): Record<string, Uint8Array> {
  const cfg = { ...DEFAULT_SAFE_UNZIP_LIMITS, ...limits };

  if (bytes.byteLength > cfg.maxCompressedBytes) {
    throw new ZipBombError(
      `Compressed archive exceeds ${cfg.maxCompressedBytes} byte cap (${bytes.byteLength} bytes)`,
    );
  }

  const files: Record<string, Uint8Array> = {};
  let totalInflated = 0;
  let entryCount = 0;
  // fflate's streaming callbacks swallow throws from inside `ondata`, so we
  // capture the first cap violation here and re-throw after push() returns.
  let captured: Error | null = null;

  const unzip = new Unzip((file) => {
    if (captured) return;

    if (file.name.endsWith('/')) {
      // Directory entry — nothing to inflate.
      return;
    }

    entryCount += 1;
    if (entryCount > cfg.maxEntryCount) {
      captured = new ZipBombError(`Archive contains too many entries (> ${cfg.maxEntryCount})`);
      return;
    }

    // Early reject when the local header already declares an oversize entry.
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
      if (final) {
        files[file.name.replace(/^\.\//u, '')] = concatChunks(chunks, entryInflated);
      }
    };

    file.start();
  });

  unzip.register(UnzipInflate);

  // Feed the compressed bytes in small slices instead of one `push(bytes,true)`.
  // The synchronous inflate codec emits decompressed output per slice, so a
  // single-entry bomb (tiny compressed → huge inflated) trips the `ondata`
  // accumulator after roughly one slice's worth of expansion rather than
  // allocating the whole multi-GB buffer up front. 64 KB compressed bounds the
  // worst-case single-chunk allocation to ~64 MB (DEFLATE max ratio ~1032:1).
  const PUSH_SLICE_BYTES = 64 * 1024;
  try {
    for (let offset = 0; offset < bytes.length; offset += PUSH_SLICE_BYTES) {
      if (captured) break;
      const end = Math.min(offset + PUSH_SLICE_BYTES, bytes.length);
      unzip.push(bytes.subarray(offset, end), end === bytes.length);
    }
    // Zero-length archive still needs a terminal push so fflate finalizes.
    if (bytes.length === 0) unzip.push(new Uint8Array(0), true);
  } catch (err) {
    // Surface our captured cap error in preference to fflate's internal state.
    if (captured) throw captured;
    throw err instanceof Error ? err : new Error(String(err));
  }

  if (captured) throw captured;
  return files;
}

export interface SafeGunzipLimits {
  /** Reject the compressed input itself above this many bytes. */
  maxCompressedBytes?: number;
  /** Reject once cumulative inflated bytes exceed this. */
  maxDecompressedBytes?: number;
}

/**
 * Streaming, bomb-resistant gzip inflation (for `.tar.gz` payloads). Same
 * defence as {@link safeUnzipSync}: the gzip stream is inflated incrementally
 * with a sliced push, and the `ondata` accumulator trips the cap BEFORE the
 * full multi-GB output is allocated — unlike `gunzipSync`, which would inflate
 * a gzip bomb entirely in memory first.
 */
export function safeGunzipSync(bytes: Uint8Array, limits: SafeGunzipLimits = {}): Uint8Array {
  const maxCompressedBytes =
    limits.maxCompressedBytes ?? DEFAULT_SAFE_UNZIP_LIMITS.maxCompressedBytes;
  const maxDecompressedBytes =
    limits.maxDecompressedBytes ?? DEFAULT_SAFE_UNZIP_LIMITS.maxDecompressedBytes;

  if (bytes.byteLength > maxCompressedBytes) {
    throw new ZipBombError(
      `Compressed input exceeds ${maxCompressedBytes} byte cap (${bytes.byteLength} bytes)`,
    );
  }

  const chunks: Uint8Array[] = [];
  let totalInflated = 0;
  let captured: Error | null = null;

  const gunzip = new Gunzip((chunk, _final) => {
    if (captured) return;
    totalInflated += chunk.length;
    if (totalInflated > maxDecompressedBytes) {
      captured = new ZipBombError(
        `gzip stream inflates beyond ${maxDecompressedBytes} bytes; refusing to load (possible bomb)`,
      );
      return;
    }
    chunks.push(chunk);
  });

  const PUSH_SLICE_BYTES = 64 * 1024;
  try {
    for (let offset = 0; offset < bytes.length; offset += PUSH_SLICE_BYTES) {
      if (captured) break;
      const end = Math.min(offset + PUSH_SLICE_BYTES, bytes.length);
      gunzip.push(bytes.subarray(offset, end), end === bytes.length);
    }
    if (bytes.length === 0) gunzip.push(new Uint8Array(0), true);
  } catch (err) {
    if (captured) throw captured;
    throw err instanceof Error ? err : new Error(String(err));
  }

  if (captured) throw captured;
  return concatChunks(chunks, totalInflated);
}
