import { gunzipSync, unzipSync } from 'fflate';
import { scanSkillDir } from '../skill-scanner.js';
import { firstLevelDirs, subtreeOf } from '../virtual-tree-utils.js';
import type { ScannedSkill, SkillResolverError, VirtualTree } from './types.js';

export interface UploadResolverInput {
  filename: string;
  bytes: Uint8Array;
  /** Pick one skill from a multi-SKILL.md archive; mirrors git's subpath param. */
  subpath?: string;
}

export interface UploadResolverResult {
  tree: VirtualTree;
  scan: ScannedSkill;
  sourceRef: string;
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function isSkillMd(filename: string): boolean {
  return /(^|\/)SKILL\.md$/iu.test(filename);
}

function isTar(bytes: Uint8Array): boolean {
  // ustar magic at offset 257
  if (bytes.length < 265) return false;
  return (
    bytes[257] === 0x75 &&
    bytes[258] === 0x73 &&
    bytes[259] === 0x74 &&
    bytes[260] === 0x61 &&
    bytes[261] === 0x72
  );
}

function untarToTree(bytes: Uint8Array): VirtualTree {
  // Minimal ustar parser: 512-byte header blocks + 512-aligned content.
  const files: VirtualTree['files'] = [];
  let offset = 0;
  const td = new TextDecoder('utf-8');
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const nameBytes = header.subarray(0, 100);
    const nameEnd = nameBytes.indexOf(0);
    const name = td.decode(nameEnd === -1 ? nameBytes : nameBytes.subarray(0, nameEnd));
    const sizeStr = td.decode(header.subarray(124, 136)).replace(/\0.*$/u, '').trim();
    const size = sizeStr ? Number.parseInt(sizeStr, 8) : 0;
    const typeFlag = String.fromCharCode(header[156]!);
    offset += 512;
    if ((typeFlag === '0' || typeFlag === '\0') && name && size > 0) {
      const content = bytes.subarray(offset, offset + size);
      files.push({ path: name.replace(/^\.\//u, ''), content: new Uint8Array(content) });
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return { files };
}

function unzipToTree(bytes: Uint8Array): VirtualTree {
  const entries = unzipSync(bytes);
  const files: VirtualTree['files'] = [];
  for (const [path, content] of Object.entries(entries)) {
    if (path.endsWith('/')) continue; // directory entry
    files.push({ path: path.replace(/^\.\//u, ''), content });
  }
  return { files };
}

/**
 * Upload resolver: accepts a zip, tar.gz, or bare SKILL.md payload and returns
 * a staged virtual tree + scanner output. Returns structured errors for
 * ambiguous / missing / unsupported payloads so the LLM can route the user.
 */
export function resolveUploadSource(
  input: UploadResolverInput,
): UploadResolverResult | SkillResolverError {
  const { bytes, filename } = input;

  if (isSkillMd(filename) && !isZip(bytes) && !isGzip(bytes)) {
    const tree: VirtualTree = { files: [{ path: 'SKILL.md', content: bytes }] };
    const scan = scanSkillDir(tree);
    if ('kind' in scan) return scan;
    return { tree, scan, sourceRef: `upload:${filename}` };
  }

  let tree: VirtualTree;
  try {
    if (isZip(bytes)) {
      tree = unzipToTree(bytes);
    } else if (isGzip(bytes)) {
      tree = untarToTree(gunzipSync(bytes));
    } else if (isTar(bytes)) {
      tree = untarToTree(bytes);
    } else {
      return {
        kind: 'upload-unsupported-format',
        message: `Unsupported upload format for "${filename}" (expected zip, tar.gz, or SKILL.md).`,
        sourceRef: filename,
      };
    }
  } catch (err) {
    return {
      kind: 'upload-unsupported-format',
      message: `Failed to decompress "${filename}": ${err instanceof Error ? err.message : String(err)}`,
      sourceRef: filename,
    };
  }

  if (input.subpath) {
    const scoped = subtreeOf(tree, input.subpath);
    if (scoped.files.length === 0) {
      const dirs = firstLevelDirs(tree);
      return {
        kind: 'upload-subpath-not-found',
        message: `Subpath "${input.subpath}" not found in "${filename}". ${
          dirs.length > 0
            ? `Retry install_skill_from_upload with subpath=<one of: ${dirs.map((d) => `"${d}"`).join(', ')}>.`
            : 'No candidate directories available.'
        }`,
        sourceRef: filename,
        candidates: dirs.map((name) => ({ path: `${name}/` })),
      };
    }
    tree = scoped;
  }

  const scan = scanSkillDir(tree);
  if ('kind' in scan) {
    if (scan.kind === 'skill-scanner-missing') {
      return { kind: 'upload-no-skill-md', message: scan.message, sourceRef: filename };
    }
    if (scan.kind === 'skill-scanner-ambiguous') {
      const dirs =
        scan.candidates && scan.candidates.length > 0
          ? scan.candidates.map((c) => c.path.replace(/\/$/u, ''))
          : firstLevelDirs(tree);
      const candidates = dirs.map((name) => ({ path: `${name}/` }));
      const message =
        dirs.length > 0
          ? `Archive "${filename}" contains multiple SKILL.md files. Retry install_skill_from_upload with the same fileRef AND subpath=<one of: ${dirs.map((d) => `"${d}"`).join(', ')}>.`
          : scan.message;
      return {
        kind: 'upload-multiple-skills',
        message,
        sourceRef: filename,
        ...(candidates.length > 0 ? { candidates } : {}),
      };
    }
    return scan;
  }
  const sourceRef = input.subpath ? `upload:${filename}#${input.subpath}` : `upload:${filename}`;
  return { tree, scan, sourceRef };
}
