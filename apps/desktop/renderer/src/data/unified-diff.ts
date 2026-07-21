type UnifiedDiffFileStatus = 'modified' | 'added' | 'deleted' | 'renamed';

export interface UnifiedDiffLine {
  id: string;
  kind: 'context' | 'add' | 'remove' | 'meta';
  text: string;
  raw: string;
  oldLine: number | undefined;
  newLine: number | undefined;
}

export interface UnifiedDiffHunk {
  id: string;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: UnifiedDiffLine[];
  additions: number;
  deletions: number;
  patch: string;
}

export interface UnifiedDiffFile {
  id: string;
  path: string;
  oldPath: string | null;
  newPath: string | null;
  status: UnifiedDiffFileStatus;
  headers: string[];
  hunks: UnifiedDiffHunk[];
  additions: number;
  deletions: number;
  patch: string;
  binary: boolean;
  supportsPartialPatch: boolean;
}

export interface UnifiedDiffDocument {
  files: UnifiedDiffFile[];
  additions: number;
  deletions: number;
  revision: string;
}

interface UnifiedDiffInput {
  path?: string;
  diff: string;
}

export type UnifiedDiffSource = string | UnifiedDiffInput;

interface DiffSection {
  patch: string;
  pathHint?: string;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/;
const DIFF_SECTION = /^diff --git /;

function fingerprint(value: string): string {
  // Two seeded FNV-1a passes keep anchors deterministic without relying on a
  // browser or Node crypto implementation. The IDs are identity anchors, not
  // security boundaries.
  const hash = (seed: number) => {
    let result = seed >>> 0;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 0x01000193);
    }
    return (result >>> 0).toString(36).padStart(7, '0');
  };
  return `${hash(0x811c9dc5)}${hash(0x9e3779b9)}`;
}

function withTrailingNewline(value: string): string {
  if (!value) return '';
  return value.endsWith('\n') ? value : `${value}\n`;
}

function splitLines(value: string): string[] {
  const normalized = value.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function splitSections(source: UnifiedDiffSource): DiffSection[] {
  const pathHint = typeof source === 'string' ? undefined : source.path;
  const diff = typeof source === 'string' ? source : source.diff;
  const lines = splitLines(diff);
  if (lines.length === 0) return [];

  const starts: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (DIFF_SECTION.test(lines[index] ?? '')) starts.push(index);
  }
  if (starts.length === 0) return [{ patch: withTrailingNewline(lines.join('\n')), pathHint }];

  return starts.map((start, sectionIndex) => {
    const end = starts[sectionIndex + 1] ?? lines.length;
    return {
      patch: withTrailingNewline(lines.slice(start, end).join('\n')),
      pathHint,
    };
  });
}

function unquoteGitPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  const body = value.slice(1, -1);
  let decoded = '';
  let escapedBytes: number[] = [];
  const flushEscapedBytes = () => {
    if (escapedBytes.length === 0) return;
    decoded += new TextDecoder().decode(new Uint8Array(escapedBytes));
    escapedBytes = [];
  };

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] ?? '';
    if (character !== '\\') {
      flushEscapedBytes();
      decoded += character;
      continue;
    }

    const escaped = body[index + 1];
    if (escaped === undefined) {
      flushEscapedBytes();
      decoded += '\\';
      continue;
    }
    if (/[0-7]/.test(escaped)) {
      const octal = body.slice(index + 1).match(/^[0-7]{1,3}/)?.[0] ?? escaped;
      escapedBytes.push(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    }
    flushEscapedBytes();
    const simple: Record<string, string> = {
      a: '\u0007',
      b: '\b',
      t: '\t',
      n: '\n',
      v: '\u000b',
      f: '\f',
      r: '\r',
      '"': '"',
      '\\': '\\',
    };
    decoded += simple[escaped] ?? escaped;
    index += 1;
  }

  flushEscapedBytes();
  return decoded;
}

function stripSidePrefix(path: string): string {
  if (path === '/dev/null') return path;
  return path.startsWith('a/') || path.startsWith('b/') ? path.slice(2) : path;
}

function parsePathValue(raw: string): string | null {
  const withoutTimestamp = raw.startsWith('"')
    ? (raw.match(/^("(?:[^"\\]|\\.)*")(?=\t|$)/)?.[1] ?? raw)
    : (raw.split('\t', 1)[0]?.trimEnd() ?? raw);
  const decoded = unquoteGitPath(withoutTimestamp);
  return decoded === '/dev/null' ? null : stripSidePrefix(decoded);
}

function parseDiffGitPaths(header: string): { oldPath: string | null; newPath: string | null } {
  const value = header.slice('diff --git '.length);
  const quoted = value.match(/^("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*")$/);
  if (quoted) {
    return {
      oldPath: parsePathValue(quoted[1] ?? ''),
      newPath: parsePathValue(quoted[2] ?? ''),
    };
  }

  const separator = value.lastIndexOf(' b/');
  if (separator >= 0) {
    return {
      oldPath: parsePathValue(value.slice(0, separator)),
      newPath: parsePathValue(value.slice(separator + 1)),
    };
  }
  return { oldPath: null, newPath: null };
}

function parseHunk(
  rawLines: string[],
  fileAnchor: string,
  duplicateIndex: number,
): UnifiedDiffHunk | null {
  const header = rawLines[0] ?? '';
  const match = header.match(HUNK_HEADER);
  if (!match) return null;

  const oldStart = Number.parseInt(match[1] ?? '0', 10);
  const oldLines = Number.parseInt(match[2] ?? '1', 10);
  const newStart = Number.parseInt(match[3] ?? '0', 10);
  const newLines = Number.parseInt(match[4] ?? '1', 10);
  const bodySignature = rawLines.slice(1).join('\n');
  const stableHeader = header.replace(/^@@ [^@]+@@/, '@@');
  const hunkId = `hunk-${fingerprint(
    `${fileAnchor}\0${stableHeader}\0${bodySignature}\0${duplicateIndex}`,
  )}`;
  const lineOccurrences = new Map<string, number>();
  const lines: UnifiedDiffLine[] = [];
  let oldLine = oldStart;
  let newLine = newStart;
  let additions = 0;
  let deletions = 0;

  for (const raw of rawLines.slice(1)) {
    let kind: UnifiedDiffLine['kind'];
    let parsedOldLine: number | undefined;
    let parsedNewLine: number | undefined;
    let text: string;

    if (raw.startsWith('+')) {
      kind = 'add';
      parsedNewLine = newLine;
      newLine += 1;
      additions += 1;
      text = raw.slice(1);
    } else if (raw.startsWith('-')) {
      kind = 'remove';
      parsedOldLine = oldLine;
      oldLine += 1;
      deletions += 1;
      text = raw.slice(1);
    } else if (raw.startsWith(' ')) {
      kind = 'context';
      parsedOldLine = oldLine;
      parsedNewLine = newLine;
      oldLine += 1;
      newLine += 1;
      text = raw.slice(1);
    } else {
      kind = 'meta';
      text = raw.startsWith('\\ ') ? raw.slice(2) : raw;
    }

    const occurrenceKey = `${kind}\0${raw}`;
    const occurrence = lineOccurrences.get(occurrenceKey) ?? 0;
    lineOccurrences.set(occurrenceKey, occurrence + 1);
    lines.push({
      id: `line-${fingerprint(`${hunkId}\0${occurrenceKey}\0${occurrence}`)}`,
      kind,
      text,
      raw,
      oldLine: parsedOldLine,
      newLine: parsedNewLine,
    });
  }

  return {
    id: hunkId,
    header,
    oldStart,
    oldLines,
    newStart,
    newLines,
    lines,
    additions,
    deletions,
    patch: withTrailingNewline(rawLines.join('\n')),
  };
}

function parseSection(section: DiffSection): UnifiedDiffFile | null {
  const lines = splitLines(section.patch);
  if (lines.length === 0) return null;

  let oldPath: string | null = null;
  let newPath: string | null = null;
  const diffHeader = lines.find((line) => DIFF_SECTION.test(line));
  if (diffHeader) ({ oldPath, newPath } = parseDiffGitPaths(diffHeader));

  for (const line of lines) {
    if (line.startsWith('rename from '))
      oldPath = unquoteGitPath(line.slice('rename from '.length));
    if (line.startsWith('rename to ')) newPath = unquoteGitPath(line.slice('rename to '.length));
    if (line.startsWith('--- ')) oldPath = parsePathValue(line.slice(4));
    if (line.startsWith('+++ ')) newPath = parsePathValue(line.slice(4));
  }

  const path = newPath ?? oldPath ?? section.pathHint;
  if (!path) return null;
  const isNewFile = lines.some((line) => line.startsWith('new file mode '));
  const isDeletedFile = lines.some((line) => line.startsWith('deleted file mode '));
  const status: UnifiedDiffFileStatus =
    (oldPath === null || isNewFile) && newPath !== null
      ? 'added'
      : (newPath === null || isDeletedFile) && oldPath !== null
        ? 'deleted'
        : oldPath !== null && newPath !== null && oldPath !== newPath
          ? 'renamed'
          : 'modified';
  const fileAnchor = `${oldPath ?? '/dev/null'}\0${newPath ?? '/dev/null'}`;

  const firstHunk = lines.findIndex((line) => HUNK_HEADER.test(line));
  const headers = firstHunk < 0 ? [...lines] : lines.slice(0, firstHunk);
  const hunkRanges: Array<{ start: number; end: number }> = [];
  for (let index = Math.max(firstHunk, 0); index < lines.length; index += 1) {
    if (!HUNK_HEADER.test(lines[index] ?? '')) continue;
    const previous = hunkRanges.at(-1);
    if (previous) previous.end = index;
    hunkRanges.push({ start: index, end: lines.length });
  }

  const duplicateHunks = new Map<string, number>();
  const hunks = hunkRanges.flatMap(({ start, end }) => {
    const rawHunk = lines.slice(start, end);
    const signature = `${rawHunk[0]?.replace(/^@@ [^@]+@@/, '@@') ?? ''}\0${rawHunk.slice(1).join('\n')}`;
    const duplicateIndex = duplicateHunks.get(signature) ?? 0;
    duplicateHunks.set(signature, duplicateIndex + 1);
    const parsed = parseHunk(rawHunk, fileAnchor, duplicateIndex);
    return parsed ? [parsed] : [];
  });
  const additions = hunks.reduce((sum, hunk) => sum + hunk.additions, 0);
  const deletions = hunks.reduce((sum, hunk) => sum + hunk.deletions, 0);
  const binary = lines.some((line) => {
    return (
      line.startsWith('Binary files ') ||
      line === 'GIT binary patch' ||
      line.startsWith('Binary file ')
    );
  });
  const hasFileLevelMetadata = headers.some((line) =>
    /^(?:new file mode|deleted file mode|old mode|new mode|similarity index|dissimilarity index|rename from|rename to|copy from|copy to) /.test(
      line,
    ),
  );

  return {
    id: `file-${fingerprint(`${fileAnchor}\0${withTrailingNewline(lines.join('\n'))}`)}`,
    path,
    oldPath,
    newPath,
    status,
    headers,
    hunks,
    additions,
    deletions,
    patch: withTrailingNewline(lines.join('\n')),
    binary,
    supportsPartialPatch: status === 'modified' && !binary && !hasFileLevelMetadata,
  };
}

function revisionFromFiles(files: readonly UnifiedDiffFile[]): string {
  const value = files.map((file) => `${file.path}\0${file.patch}`).join('\n');
  return `diff-${fingerprint(value)}`;
}

export function diffRevision(raw: readonly UnifiedDiffSource[] | UnifiedDiffDocument): string {
  if ('files' in raw) return revisionFromFiles(raw.files);
  const files = raw.flatMap(splitSections).flatMap((section) => {
    const parsed = parseSection(section);
    return parsed ? [parsed] : [];
  });
  return revisionFromFiles(files);
}

export function parseUnifiedDiffFiles(raw: readonly UnifiedDiffSource[]): UnifiedDiffDocument {
  const files = raw.flatMap(splitSections).flatMap((section) => {
    const parsed = parseSection(section);
    return parsed ? [parsed] : [];
  });
  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    revision: revisionFromFiles(files),
  };
}

export function buildUnifiedPatch(file: UnifiedDiffFile, hunkIds?: readonly string[]): string {
  if (hunkIds === undefined) return file.patch;
  if (!file.supportsPartialPatch) return '';
  if (hunkIds.length === 0) return '';
  const selected = new Set(hunkIds);
  const hunks = file.hunks.filter((hunk) => selected.has(hunk.id));
  if (hunks.length === 0 || hunks.length !== selected.size) return '';
  return withTrailingNewline(
    [...file.headers, ...hunks.flatMap((hunk) => splitLines(hunk.patch))].join('\n'),
  );
}
