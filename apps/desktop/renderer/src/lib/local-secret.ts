/**
 * Renderer-side wrapper for the `secret_encrypt` / `secret_decrypt` Tauri
 * commands (S1/S2/S3 — at-rest sealing of renderer-held tokens).
 *
 * The Rust side (`apps/desktop/src-tauri/src/local_secret.rs`) holds the opaque
 * per-install key and does the ChaCha20-Poly1305 AEAD. This module is a thin
 * bridge with a development-only preview stub:
 *
 *   - Plain-browser development previews may echo values because they cannot
 *     persist release secrets. A production build outside Tauri fails closed.
 *   - Tauri command failures propagate to the save/read boundary. Callers must
 *     never persist plaintext or treat ciphertext as a usable secret.
 */

import { isTauriRuntime } from '@/data/adapters.js';
import { invokeCommand } from '@/lib/tauri-commands.js';

/** Seal a value for at-rest storage. Returns an opaque envelope string. */
export async function secretEncrypt(plaintext: string): Promise<string> {
  if (!isTauriRuntime()) {
    if (import.meta.env.DEV) return plaintext;
    throw new Error('local secret encryption requires the Tauri runtime');
  }
  return invokeCommand('secret_encrypt', { plaintext });
}

/**
 * Open a sealed value. Non-envelope and corrupted values fail closed.
 */
export async function secretDecrypt(envelope: string): Promise<string> {
  if (!isTauriRuntime()) {
    if (import.meta.env.DEV) return envelope;
    throw new Error('local secret decryption requires the Tauri runtime');
  }
  return invokeCommand('secret_decrypt', { envelope });
}
