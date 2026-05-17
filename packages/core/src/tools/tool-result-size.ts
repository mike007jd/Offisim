import type { ToolDef } from '../llm/gateway.js';
import { generateId } from '../utils/generate-id.js';

const DEFAULT_MAX_RESULT_SIZE_CHARS = 30_000;
const PREVIEW_CHARS = 4_000;
const SPILL_DIR_NAME = 'offisim-tool-result-spills';
const spills = new Map<string, string>();

export async function capToolResultForModel(tool: ToolDef, result: unknown): Promise<unknown> {
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  const maxChars = tool.maxResultSizeChars ?? DEFAULT_MAX_RESULT_SIZE_CHARS;
  if (!text || text.length <= maxChars) return result;
  const spillId = generateId('tool-spill');
  spills.set(spillId, text);
  const spillPath = await persistToolResultSpill(spillId, text);
  return {
    kind: 'tool-result-spilled',
    spillId,
    ...(spillPath ? { spillPath } : {}),
    originalChars: text.length,
    preview: `${text.slice(0, Math.min(PREVIEW_CHARS, maxChars))}\n[TRUNCATED: full tool result stored as ${spillPath ?? spillId}]`,
  };
}

export function readToolResultSpill(spillId: string): string | null {
  return spills.get(spillId) ?? null;
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
