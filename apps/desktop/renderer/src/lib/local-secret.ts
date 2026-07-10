/**
 * Renderer-side wrapper for the `secret_encrypt` / `secret_decrypt` Tauri
 * commands (S1/S2/S3 — at-rest sealing of renderer-held tokens).
 *
 * The Rust side (`apps/desktop/src-tauri/src/local_secret.rs`) holds the opaque
 * per-install key and does the ChaCha20-Poly1305 AEAD. This module is a thin
 * bridge plus graceful degradation:
 *
 *   - Outside Tauri (plain-browser dev/preview, where `__TAURI_INTERNALS__` is
 *     absent) the commands are unavailable. We do NOT block the surface: encrypt
 *     stores the value verbatim and decrypt returns it verbatim. The threat
 *     model is "release `.app` disk/localStorage at rest", and the dev browser
 *     never persists real production secrets.
 *   - `secretDecrypt` is backward-compatible by construction: the Rust command
 *     returns a non-envelope (legacy plaintext) input unchanged, so tokens
 *     written before this feature keep working and are re-sealed on next write.
 *   - If a command unexpectedly throws at runtime, we fail soft so a crypto
 *     hiccup never bricks marketplace/A2A flows: encrypt falls back to the raw
 *     value (still functional, just unsealed) and decrypt returns the stored
 *     value as-is (covers the legacy-plaintext case too).
 */

import { isTauriRuntime } from '@/data/adapters.js';
import { invokeCommand } from '@/lib/tauri-commands.js';

/** Seal a value for at-rest storage. Returns an opaque envelope string. */
export async function secretEncrypt(plaintext: string): Promise<string> {
  if (!isTauriRuntime()) return plaintext;
  try {
    return await invokeCommand('secret_encrypt', { plaintext });
  } catch (err) {
    // Never block a save on a crypto failure — persist unsealed rather than
    // silently dropping the user's token.
    console.warn('[local-secret] secret_encrypt failed; storing unsealed', err);
    return plaintext;
  }
}

/**
 * Open a sealed value. A non-envelope (legacy plaintext) input is returned
 * unchanged by the Rust command, so this is safe to call on any stored value.
 */
export async function secretDecrypt(envelope: string): Promise<string> {
  if (!isTauriRuntime()) return envelope;
  try {
    return await invokeCommand('secret_decrypt', { envelope });
  } catch (err) {
    // AEAD-open failure on a real envelope is the only case the Rust side
    // throws; returning the stored value as-is keeps legacy plaintext working
    // and avoids a hard failure on a corrupted-but-present token.
    console.warn('[local-secret] secret_decrypt failed; using stored value', err);
    return envelope;
  }
}
