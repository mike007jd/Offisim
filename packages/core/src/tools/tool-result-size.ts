import type { ToolDef } from '../llm/gateway.js';
import { generateId } from '../utils/generate-id.js';

const DEFAULT_MAX_RESULT_SIZE_CHARS = 30_000;
const PREVIEW_CHARS = 4_000;
const SPILL_DIR_NAME = 'offisim-tool-result-spills';

// Bounded LRU + TTL cache for spilled tool results. Without these caps a long
// session would accumulate every overflowed tool result in memory, and the
// matching FS files would never be unlinked.
const SPILL_MAX_ENTRIES = 256;
const SPILL_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface SpillEntry {
  readonly text: string;
  readonly createdAt: number;
  readonly filePath?: string;
}

// JS Map preserves insertion order; we re-set on access to keep the LRU
// ordering correct.
const spills = new Map<string, SpillEntry>();

function evictOldestSpill(): void {
  const oldestKey = spills.keys().next().value;
  if (oldestKey === undefined) return;
  const entry = spills.get(oldestKey);
  spills.delete(oldestKey);
  if (entry?.filePath) {
    void unlinkSpillFile(entry.filePath);
  }
}

function isExpired(entry: SpillEntry, now: number): boolean {
  return now - entry.createdAt > SPILL_TTL_MS;
}

async function unlinkSpillFile(filePath: string): Promise<void> {
  if (!hasNodeProcess()) return;
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<unknown>;
    const fs = (await dynamicImport('node:fs/promises')) as {
      unlink(path: string): Promise<void>;
    };
    await fs.unlink(filePath);
  } catch {
    // best-effort — file may already be gone
  }
}

export async function capToolResultForModel(tool: ToolDef, result: unknown): Promise<unknown> {
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  const maxChars = tool.maxResultSizeChars ?? DEFAULT_MAX_RESULT_SIZE_CHARS;
  if (!text || text.length <= maxChars) return result;
  const spillId = generateId('tool-spill');
  const spillPath = await persistToolResultSpill(spillId, text);
  const entry: SpillEntry = {
    text,
    createdAt: Date.now(),
    ...(spillPath ? { filePath: spillPath } : {}),
  };
  while (spills.size >= SPILL_MAX_ENTRIES) {
    evictOldestSpill();
  }
  spills.set(spillId, entry);
  return {
    kind: 'tool-result-spilled',
    spillId,
    ...(spillPath ? { spillPath } : {}),
    originalChars: text.length,
    preview: `${text.slice(0, Math.min(PREVIEW_CHARS, maxChars))}\n[TRUNCATED: full tool result stored as ${spillPath ?? spillId}]`,
  };
}

export function readToolResultSpill(spillId: string): string | null {
  const entry = spills.get(spillId);
  if (!entry) return null;
  if (isExpired(entry, Date.now())) {
    spills.delete(spillId);
    if (entry.filePath) void unlinkSpillFile(entry.filePath);
    return null;
  }
  // Touch for LRU.
  spills.delete(spillId);
  spills.set(spillId, entry);
  return entry.text;
}

async function persistToolResultSpill(spillId: string, text: string): Promise<string | null> {
  if (!hasNodeProcess()) return null;
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<unknown>;
    const fs = (await dynamicImport('node:fs/promises')) as {
      mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
      writeFile(path: string, data: string, encoding: string): Promise<void>;
    };
    const os = (await dynamicImport('node:os')) as { tmpdir(): string };
    const path = (await dynamicImport('node:path')) as {
      join(...parts: string[]): string;
    };
    const dir = path.join(os.tmpdir(), SPILL_DIR_NAME);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${sanitizeSpillId(spillId)}.txt`);
    await fs.writeFile(filePath, text, 'utf8');
    return filePath;
  } catch {
    return null;
  }
}

function hasNodeProcess(): boolean {
  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
  return typeof proc?.versions?.node === 'string';
}

function sanitizeSpillId(spillId: string): string {
  return spillId.replace(/[^a-zA-Z0-9_.-]/gu, '_');
}
