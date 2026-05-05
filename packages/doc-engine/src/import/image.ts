import type { ParsedAttachment } from '@offisim/shared-types';
import { bytesToBase64 } from './base64.js';

/** Minimal image header parser used in Node and as a parity fallback when
 * `createImageBitmap` is not available. Returns `null` when the format isn't
 * recognized so the caller can decide what to surface. */
function readDimensionsFromHeader(
  bytes: Uint8Array,
  mimeHint: string,
): { width: number; height: number; format: string } | null {
  const mime = mimeHint.toLowerCase();
  if (mime === 'image/png' && bytes.length > 24) {
    // PNG signature (89 50 4E 47 0D 0A 1A 0A) followed by IHDR chunk; width @ 16, height @ 20 (big-endian uint32).
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (sig.every((b, i) => bytes[i] === b)) {
      const w = readUint32BE(bytes, 16);
      const h = readUint32BE(bytes, 20);
      return { width: w, height: h, format: 'png' };
    }
  }
  if ((mime === 'image/jpeg' || mime === 'image/jpg') && bytes.length > 4) {
    const dims = readJpegDimensions(bytes);
    if (dims) return { ...dims, format: 'jpeg' };
  }
  if (mime === 'image/gif' && bytes.length > 10) {
    // Header `GIF87a`/`GIF89a`, width @ 6 (LE uint16), height @ 8.
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      const w = readUint16LE(bytes, 6);
      const h = readUint16LE(bytes, 8);
      return { width: w, height: h, format: 'gif' };
    }
  }
  if (mime === 'image/webp' && bytes.length > 30) {
    // RIFF + WEBP, then either VP8/VP8L/VP8X.
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      const fourcc = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
      if (fourcc === 'VP8X') {
        const w = (readUint24LE(bytes, 24) ?? 0) + 1;
        const h = (readUint24LE(bytes, 27) ?? 0) + 1;
        return { width: w, height: h, format: 'webp' };
      }
      if (fourcc === 'VP8 ') {
        const w = readUint16LE(bytes, 26) & 0x3fff;
        const h = readUint16LE(bytes, 28) & 0x3fff;
        return { width: w, height: h, format: 'webp' };
      }
      if (fourcc === 'VP8L') {
        const b1 = bytes[21] ?? 0;
        const b2 = bytes[22] ?? 0;
        const b3 = bytes[23] ?? 0;
        const b4 = bytes[24] ?? 0;
        const w = 1 + ((b2 & 0x3f) * 256 + b1);
        const h = 1 + (((b4 & 0x0f) * 1024) + (b3 * 4) + ((b2 & 0xc0) >> 6));
        return { width: w, height: h, format: 'webp' };
      }
    }
  }
  return null;
}

function readUint32BE(b: Uint8Array, o: number): number {
  return ((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0);
}
function readUint16LE(b: Uint8Array, o: number): number {
  return (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
}
function readUint24LE(b: Uint8Array, o: number): number | null {
  if (o + 2 >= b.length) return null;
  return (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16);
}

function readJpegDimensions(b: Uint8Array): { width: number; height: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    let marker = b[i + 1] ?? 0;
    while (marker === 0xff) {
      i += 1;
      marker = b[i + 1] ?? 0;
    }
    i += 2;
    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      const h = ((b[i + 3] ?? 0) << 8) | (b[i + 4] ?? 0);
      const w = ((b[i + 5] ?? 0) << 8) | (b[i + 6] ?? 0);
      return { width: w, height: h };
    }
    const segLen = ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
    if (segLen < 2) return null;
    i += segLen;
  }
  return null;
}

export async function parseImage(bytes: Uint8Array, mimeType: string): Promise<ParsedAttachment> {
  const headerDims = readDimensionsFromHeader(bytes, mimeType);
  if (headerDims) {
    return {
      kind: 'image',
      base64: bytesToBase64(bytes),
      width: headerDims.width,
      height: headerDims.height,
      format: headerDims.format,
    };
  }
  // Fallback for unrecognized image headers: only attempt createImageBitmap in
  // a browser/webview env where it exists.
  if (typeof createImageBitmap === 'function' && typeof Blob !== 'undefined') {
    try {
      // copy into a fresh ArrayBuffer so we satisfy the BlobPart shape under
      // strict typing (Uint8Array's buffer may otherwise be SharedArrayBuffer).
      const buf = bytes.slice().buffer as ArrayBuffer;
      const blob = new Blob([buf], { type: mimeType });
      const bitmap = await createImageBitmap(blob);
      const out: ParsedAttachment = {
        kind: 'image',
        base64: bytesToBase64(bytes),
        width: bitmap.width,
        height: bitmap.height,
        format: mimeType.replace(/^image\//, '') || 'unknown',
      };
      bitmap.close?.();
      return out;
    } catch {
      // fall through to unsupported
    }
  }
  return { kind: 'unsupported', reason: 'image-format-not-recognized' };
}
