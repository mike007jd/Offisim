import type { VirtualTree } from './types.js';

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

  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;

    let name = decodeTarString(td, header.subarray(0, 100));
    const prefix = decodeTarString(td, header.subarray(345, 500));
    if (prefix) name = `${prefix}/${name}`;

    const sizeStr = td.decode(header.subarray(124, 136)).replace(/\0.*$/u, '').trim();
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
      const override = parsePaxPath(td.decode(body));
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

function parsePaxPath(record: string): string | null {
  const re = /\d+ ([^=]+)=([^\n]*)\n/gu;
  let match: RegExpExecArray | null = re.exec(record);
  while (match !== null) {
    if (match[1] === 'path' && match[2]) return match[2];
    match = re.exec(record);
  }
  return null;
}
