//! At-rest encryption for renderer-held local secrets (S1/S2/S3).
//!
//! Two secrets currently sit in plaintext where a casual disk/localStorage read
//! exposes them:
//!   - the marketplace API token (`window.localStorage`, S1/S2)
//!   - the external-employee A2A Bearer token (SQLite `employees.a2a_token`, S3)
//!
//! This module gives the renderer two Tauri commands — `secret_encrypt` /
//! `secret_decrypt` — that seal/open a value behind a per-install opaque key.
//! The key never leaves the device and is not derived from a user password; the
//! threat model is "bytes at rest are not readable verbatim", not "resists an
//! attacker who already has code-exec as this user".
//!
//! ## Crypto
//!   - AEAD: ChaCha20-Poly1305 (`chacha20poly1305` 0.10.x, RustCrypto).
//!   - Key: 32 random bytes from `OsRng`, generated once and persisted at
//!     `<app_local_data_dir>/secret.key` with `0o600` on unix. Load-or-create.
//!   - Nonce: fresh 12 random bytes **per call** (never reused with one key).
//!   - Envelope: `base64( 0x01 || nonce[12] || ciphertext+tag )`.
//!
//! ## Backward compatibility (read path)
//! A pre-existing plaintext token is not a valid envelope. `secret_decrypt`
//! detects "not one of ours" (bad base64, wrong version byte, too short, or
//! AEAD-open failure on a value that *looks* like an envelope but isn't sealed
//! by our key) and returns the input **unchanged**. So existing plaintext
//! tokens keep working and get re-encrypted on the next write. The `0x01`
//! version prefix inside base64 makes a real envelope unambiguously detectable;
//! arbitrary user tokens (URLs, JWTs, hex, etc.) virtually never decode to a
//! 13+ byte buffer whose first byte is `0x01` *and* pass Poly1305, so a genuine
//! ciphertext is never mistaken for plaintext nor vice-versa.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use rand::rngs::OsRng;
use rand::RngCore;
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};
use thiserror::Error;

const KEY_FILE_NAME: &str = "secret.key";
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const ENVELOPE_VERSION: u8 = 0x01;

#[derive(Debug, Error, serde::Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SecretError {
    #[error("secret-key-io-failed: {0}")]
    KeyIo(String),
    #[error("secret-encrypt-failed")]
    Encrypt,
    /// AEAD-open failed on a value that parsed as a well-formed envelope.
    #[error("secret-decrypt-failed")]
    Decrypt,
}

/// Resolve the per-install key path under the OS app-local-data dir (never the
/// project folder).
fn key_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, SecretError> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|err| SecretError::KeyIo(format!("app_local_data_dir: {err}")))?;
    Ok(base.join(KEY_FILE_NAME))
}

/// Load the 32-byte key, generating + persisting it on first use.
fn load_or_create_key(path: &Path) -> Result<[u8; KEY_LEN], SecretError> {
    if let Ok(bytes) = std::fs::read(path) {
        if bytes.len() == KEY_LEN {
            let mut key = [0u8; KEY_LEN];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
        // A corrupt/short key file would otherwise wedge every secret forever.
        // We refuse to silently overwrite it (that would orphan any data sealed
        // under a prior good key); surface a typed error instead.
        return Err(SecretError::KeyIo(format!(
            "existing key file has unexpected length {} (expected {KEY_LEN})",
            bytes.len()
        )));
    }

    let mut key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| SecretError::KeyIo(format!("create key dir: {err}")))?;
    }
    write_key_file(path, &key)?;
    Ok(key)
}

#[cfg(unix)]
fn write_key_file(path: &Path, key: &[u8; KEY_LEN]) -> Result<(), SecretError> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    // 0o600 before any bytes land: create with the restrictive mode rather than
    // writing world-readable then chmod-ing.
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .map_err(|err| SecretError::KeyIo(format!("open key file: {err}")))?;
    file.write_all(key)
        .map_err(|err| SecretError::KeyIo(format!("write key file: {err}")))?;
    file.sync_all()
        .map_err(|err| SecretError::KeyIo(format!("sync key file: {err}")))?;
    Ok(())
}

#[cfg(not(unix))]
fn write_key_file(path: &Path, key: &[u8; KEY_LEN]) -> Result<(), SecretError> {
    std::fs::write(path, key).map_err(|err| SecretError::KeyIo(format!("write key file: {err}")))
}

/// Seal `plaintext` into a base64 envelope: `0x01 || nonce(12) || ct+tag`.
fn encrypt_with_key(key: &[u8; KEY_LEN], plaintext: &str) -> Result<String, SecretError> {
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|_| SecretError::Encrypt)?;

    let mut envelope = Vec::with_capacity(1 + NONCE_LEN + ciphertext.len());
    envelope.push(ENVELOPE_VERSION);
    envelope.extend_from_slice(&nonce_bytes);
    envelope.extend_from_slice(&ciphertext);
    Ok(B64.encode(envelope))
}

/// Outcome of attempting to parse a base64 string as one of our envelopes.
enum Parsed {
    /// A well-formed `0x01`-prefixed envelope with extractable nonce + ct.
    Envelope { nonce: [u8; NONCE_LEN], ct: Vec<u8> },
    /// Not one of ours — caller should treat the original input as plaintext.
    NotEnvelope,
}

/// Detect + split an envelope without touching the key. Anything that isn't an
/// unambiguous `0x01` envelope returns `NotEnvelope` (backward-compat passthrough).
fn parse_envelope(value: &str) -> Parsed {
    let raw = match B64.decode(value.as_bytes()) {
        Ok(raw) => raw,
        Err(_) => return Parsed::NotEnvelope,
    };
    // Need version byte + nonce + at least the 16-byte Poly1305 tag.
    if raw.len() < 1 + NONCE_LEN + 16 || raw[0] != ENVELOPE_VERSION {
        return Parsed::NotEnvelope;
    }
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&raw[1..1 + NONCE_LEN]);
    let ct = raw[1 + NONCE_LEN..].to_vec();
    Parsed::Envelope { nonce, ct }
}

/// Open an envelope, or pass plaintext through unchanged.
fn decrypt_with_key(key: &[u8; KEY_LEN], value: &str) -> Result<String, SecretError> {
    match parse_envelope(value) {
        // Not an envelope → pre-existing plaintext token; return verbatim.
        Parsed::NotEnvelope => Ok(value.to_string()),
        Parsed::Envelope { nonce, ct } => {
            let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
            let plaintext = cipher
                .decrypt(Nonce::from_slice(&nonce), ct.as_ref())
                .map_err(|_| SecretError::Decrypt)?;
            String::from_utf8(plaintext).map_err(|_| SecretError::Decrypt)
        }
    }
}

#[tauri::command]
pub fn secret_encrypt<R: Runtime>(
    app: tauri::AppHandle<R>,
    plaintext: String,
) -> Result<String, SecretError> {
    let key = load_or_create_key(&key_path(&app)?)?;
    encrypt_with_key(&key, &plaintext)
}

#[tauri::command]
pub fn secret_decrypt<R: Runtime>(
    app: tauri::AppHandle<R>,
    envelope: String,
) -> Result<String, SecretError> {
    let key = load_or_create_key(&key_path(&app)?)?;
    decrypt_with_key(&key, &envelope)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic non-random key for round-trip assertions.
    fn test_key() -> [u8; KEY_LEN] {
        let mut k = [0u8; KEY_LEN];
        for (i, b) in k.iter_mut().enumerate() {
            *b = (i as u8).wrapping_mul(7).wrapping_add(13);
        }
        k
    }

    #[test]
    fn round_trip_recovers_input() {
        let key = test_key();
        for input in ["", "hunter2", "Bearer abc.def.ghi", "🔐 unicode 值"] {
            let env = encrypt_with_key(&key, input).expect("encrypt");
            let out = decrypt_with_key(&key, &env).expect("decrypt");
            assert_eq!(out, input, "round-trip mismatch for {input:?}");
        }
    }

    #[test]
    fn ciphertext_differs_from_plaintext() {
        let key = test_key();
        let input = "secret-token-value";
        let env = encrypt_with_key(&key, input).expect("encrypt");
        assert_ne!(env, input);
        // Plaintext bytes must not appear verbatim in the envelope.
        let raw = B64.decode(env.as_bytes()).expect("b64");
        assert!(
            !raw.windows(input.len()).any(|w| w == input.as_bytes()),
            "plaintext leaked into ciphertext"
        );
    }

    #[test]
    fn fresh_nonce_makes_each_envelope_unique() {
        let key = test_key();
        let a = encrypt_with_key(&key, "same-input").expect("encrypt a");
        let b = encrypt_with_key(&key, "same-input").expect("encrypt b");
        assert_ne!(a, b, "nonce reuse: identical envelopes for identical input");
        assert_eq!(decrypt_with_key(&key, &a).unwrap(), "same-input");
        assert_eq!(decrypt_with_key(&key, &b).unwrap(), "same-input");
    }

    #[test]
    fn tampered_envelope_fails_to_decrypt() {
        let key = test_key();
        let env = encrypt_with_key(&key, "do-not-tamper").expect("encrypt");
        let mut raw = B64.decode(env.as_bytes()).expect("b64");
        // Flip a bit in the ciphertext+tag region (past version + nonce).
        let last = raw.len() - 1;
        raw[last] ^= 0x01;
        let tampered = B64.encode(&raw);
        let err = decrypt_with_key(&key, &tampered).expect_err("tamper must fail");
        assert!(matches!(err, SecretError::Decrypt));
    }

    #[test]
    fn wrong_key_fails_to_decrypt() {
        let env = encrypt_with_key(&test_key(), "cross-key").expect("encrypt");
        let mut other = test_key();
        other[0] ^= 0xff;
        let err = decrypt_with_key(&other, &env).expect_err("wrong key must fail");
        assert!(matches!(err, SecretError::Decrypt));
    }

    #[test]
    fn plaintext_passthrough_unchanged() {
        let key = test_key();
        // Values a real user might have stored before encryption existed.
        for legacy in [
            "plain-marketplace-token",
            "https://registry.example.com",
            "eyJhbGciOiJIUzI1Ni1.abcDEF.signature",
            "deadbeefcafebabe",
            "",
            "not base64!!! @#$",
        ] {
            let out = decrypt_with_key(&key, legacy).expect("passthrough");
            assert_eq!(out, legacy, "legacy plaintext was altered: {legacy:?}");
        }
    }

    #[test]
    fn load_or_create_key_round_trips_via_temp_path() {
        let dir = std::env::temp_dir().join(format!("offisim-secret-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("secret.key");
        let _ = std::fs::remove_file(&path);

        let k1 = load_or_create_key(&path).expect("create");
        assert!(path.exists());
        let k2 = load_or_create_key(&path).expect("load existing");
        assert_eq!(k1, k2, "key must be stable across loads");

        // A value sealed under the persisted key opens back to plaintext.
        let env = encrypt_with_key(&k1, "persisted-key-data").expect("encrypt");
        assert_eq!(decrypt_with_key(&k2, &env).unwrap(), "persisted-key-data");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "key file must be 0o600");
        }

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&dir);
    }
}
