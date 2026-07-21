import type { VirtualTree } from './types.js';

const PAX_MAX_RECORD_BYTES = 64 * 1024;
const PAX_MAX_TOTAL_BYTES = 1024 * 1024;
const PAX_MAX_LENGTH_DIGITS = String(PAX_MAX_RECORD_BYTES).length;

export interface UntarToTreeOptions {
  /**
   * GitHub tarballs wrap repo contents under `<repo>-<sha>/`; uploads do not.
   */
  readonly stripFirstPathSegment?: boolean;
}

/**
 * Minimal ustar parser for skill-source archives.
 *
 * Supports the path forms that matter for real GitHub/upload tarballs:
 * ustar `prefix`, GNU `L` long-name records, and PAX `path=` records. Link
 * entries and directories are intentionally ignored.
 */
export function untarToTree(bytes: Uint8Array, options: UntarToTreeOptions = {}): VirtualTree {
  const files: VirtualTree['files'] = [];
  let offset = 0;
  const td = new TextDecoder('utf-8');
  let pendingNameOverride: string | null = null;
  let paxBytesParsed = 0;

  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;

    let name = decodeTarString(td, header.subarray(0, 100));
    const prefix = decodeTarString(td, header.subarray(345, 500));
    if (prefix) name = `${prefix}/${name}`;

    const sizeStr = decodeTarString(td, header.subarray(124, 136)).trim();
    const size = sizeStr ? Number.parseInt(sizeStr, 8) : 0;
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    offset += 512;
    const body = bytes.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;

    if (typeFlag === 'L') {
      const raw = td.decode(body);
      const end = raw.indexOf('\0');
      pendingNameOverride = (end === -1 ? raw : raw.slice(0, end)) || null;
      continue;
    }
    if (typeFlag === 'x' || typeFlag === 'g') {
      paxBytesParsed += body.byteLength;
      if (paxBytesParsed > PAX_MAX_TOTAL_BYTES) {
        throw new Error(`PAX extended headers exceed ${PAX_MAX_TOTAL_BYTES} bytes.`);
      }
      const override = parsePaxPath(body, td);
      if (override) pendingNameOverride = override;
      continue;
    }

    const effectiveName = pendingNameOverride ?? name;
    pendingNameOverride = null;

    if ((typeFlag === '0' || typeFlag === '\0') && effectiveName && size > 0) {
      const normalized = normalizeArchiveEntryPath(effectiveName, options);
      if (normalized.length > 0) {
        files.push({ path: normalized, content: new Uint8Array(body) });
      }
    }
  }

  return { files };
}

function decodeTarString(td: TextDecoder, bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return td.decode(end === -1 ? bytes : bytes.subarray(0, end));
}

export function normalizeArchiveEntryPath(path: string, options: UntarToTreeOptions = {}): string {
  const withoutDot = path.replace(/^\.\//u, '');
  assertArchiveEntryPathSafe(withoutDot, path);
  const normalized = options.stripFirstPathSegment
    ? withoutDot.split('/').slice(1).join('/')
    : withoutDot;
  if (normalized.length === 0) return normalized;
  assertArchiveEntryPathSafe(normalized, path);
  return normalized;
}

function assertArchiveEntryPathSafe(path: string, originalPath: string): void {
  if (path.length === 0) return;
  if (
    path !== path.trim() ||
    path.startsWith('/') ||
    path.startsWith('\\') ||
    /^[A-Za-z]:/.test(path) ||
    path.includes('\\')
  ) {
    throw new Error(`Unsafe archive entry path '${originalPath}'.`);
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe archive entry path '${originalPath}'.`);
  }
}

function parsePaxPath(bytes: Uint8Array, td: TextDecoder): string | null {
  let offset = 0;
  let pathOverride: string | null = null;

  while (offset < bytes.byteLength) {
    const recordStart = offset;
    let recordLength = 0;
    let lengthDigits = 0;

    while (offset < bytes.byteLength) {
      const byte = bytes[offset];
      if (byte === undefined || byte < 0x30 || byte > 0x39) break;
      lengthDigits += 1;
      if (lengthDigits > PAX_MAX_LENGTH_DIGITS) {
        throw new Error('PAX record length field is too long.');
      }
      recordLength = recordLength * 10 + (byte - 0x30);
      offset += 1;
    }

    if (lengthDigits === 0 || bytes[offset] !== 0x20) {
      throw new Error('PAX record length must be followed by a space.');
    }
    if (recordLength > PAX_MAX_RECORD_BYTES) {
      throw new Error(`PAX record exceeds ${PAX_MAX_RECORD_BYTES} bytes.`);
    }

    const fieldStart = offset + 1;
    const recordEnd = recordStart + recordLength;
    if (recordLength < fieldStart - recordStart + 3 || recordEnd > bytes.byteLength) {
      throw new Error('PAX record length exceeds the available header bytes.');
    }
    if (bytes[recordEnd - 1] !== 0x0a) {
      throw new Error('PAX record must end with a newline.');
    }

    let equalsOffset = fieldStart;
    while (equalsOffset < recordEnd - 1 && bytes[equalsOffset] !== 0x3d) {
      equalsOffset += 1;
    }
    if (equalsOffset === fieldStart || equalsOffset >= recordEnd - 1) {
      throw new Error('PAX record must contain a non-empty keyword and equals sign.');
    }

    if (pathOverride === null) {
      const keyword = td.decode(bytes.subarray(fieldStart, equalsOffset));
      if (keyword === 'path') {
        const value = td.decode(bytes.subarray(equalsOffset + 1, recordEnd - 1));
        if (value.length > 0) pathOverride = value;
      }
    }

    offset = recordEnd;
  }

  return pathOverride;
}
