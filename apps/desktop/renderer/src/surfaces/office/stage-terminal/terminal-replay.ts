import type { TerminalOutputChunk } from '@/lib/tauri-commands.js';

export type TerminalReplayStep =
  | { kind: 'ignore'; nextCursor: number }
  | { kind: 'gap'; nextCursor: number }
  | { kind: 'write'; nextCursor: number; bytes: Uint8Array };

function bytesFromBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const batch = 0x8000;
  for (let index = 0; index < bytes.length; index += batch) {
    binary += String.fromCharCode(...bytes.subarray(index, index + batch));
  }
  return globalThis.btoa(binary);
}

export function terminalReplayStep(
  cursor: number,
  chunk: TerminalOutputChunk,
): TerminalReplayStep {
  if (chunk.endCursor <= cursor) return { kind: 'ignore', nextCursor: cursor };
  if (chunk.startCursor > cursor) return { kind: 'gap', nextCursor: cursor };
  const bytes = bytesFromBase64(chunk.dataBase64);
  const overlap = Math.max(0, cursor - chunk.startCursor);
  return {
    kind: 'write',
    nextCursor: chunk.endCursor,
    bytes: overlap > 0 ? bytes.subarray(overlap) : bytes,
  };
}
