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
//!     `~/.offisim/secret.key` with `0o600` on unix. Load-or-create.
//!   - Nonce: fresh 12 random bytes **per call** (never reused with one key).
//!   - Envelope: `base64( 0x01 || nonce[12] || ciphertext+tag )`.
//!
//! Decryption is deliberately fail-closed. Offisim is prelaunch and has no
//! plaintext-secret compatibility contract: any value that is not a valid
//! authenticated envelope is rejected rather than returned to the renderer.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use rand::rngs::OsRng;
use rand::RngCore;
#[cfg(unix)]
use std::ffi::CString;
use std::fs::File;
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd};
#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use tauri::Runtime;
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
    #[error("secret-envelope-invalid")]
    InvalidEnvelope,
    /// AEAD-open failed on a value that parsed as a well-formed envelope.
    #[error("secret-decrypt-failed")]
    Decrypt,
}

/// Resolve the per-install key path under the user-owned Offisim dir (never the
/// project folder).
struct SecretKeyPath {
    root: PathBuf,
    #[cfg(not(unix))]
    path: PathBuf,
    #[cfg(unix)]
    root_device: u64,
    #[cfg(unix)]
    root_inode: u64,
}

fn key_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<SecretKeyPath, SecretError> {
    let _ = app;
    let raw_root = crate::local_paths::offisim_home_dir().map_err(SecretError::KeyIo)?;
    let raw_home = raw_root
        .parent()
        .ok_or_else(|| SecretError::KeyIo("Offisim key root has no home parent".into()))?;
    let canonical_home = raw_home
        .canonicalize()
        .map_err(|err| SecretError::KeyIo(format!("resolve key home: {err}")))?;
    let expected_root = canonical_home.join(
        raw_root
            .file_name()
            .ok_or_else(|| SecretError::KeyIo("Offisim key root has no basename".into()))?,
    );
    match std::fs::create_dir(&expected_root) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(err) => return Err(SecretError::KeyIo(format!("create key dir: {err}"))),
    }
    let location = validate_key_path(&expected_root.join(KEY_FILE_NAME))?;
    if location.root != expected_root {
        return Err(SecretError::KeyIo(
            "Offisim key root resolves outside the canonical home path".into(),
        ));
    }
    Ok(location)
}

/// Load the 32-byte key, generating + persisting it on first use.
fn validate_key_path(path: &Path) -> Result<SecretKeyPath, SecretError> {
    if path.file_name().and_then(|name| name.to_str()) != Some(KEY_FILE_NAME) {
        return Err(SecretError::KeyIo("unexpected secret key filename".into()));
    }
    let root = path
        .parent()
        .ok_or_else(|| SecretError::KeyIo("secret key path has no parent".into()))?;
    let root_metadata = std::fs::symlink_metadata(root)
        .map_err(|err| SecretError::KeyIo(format!("inspect key dir: {err}")))?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Err(SecretError::KeyIo(
            "secret key root must be a real directory".into(),
        ));
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|err| SecretError::KeyIo(format!("resolve key dir: {err}")))?;
    let canonical_metadata = std::fs::metadata(&canonical_root)
        .map_err(|err| SecretError::KeyIo(format!("inspect canonical key dir: {err}")))?;

    let canonical_path = canonical_root.join(KEY_FILE_NAME);
    match std::fs::symlink_metadata(&canonical_path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(SecretError::KeyIo(
                    "secret key path must be a regular file and cannot be a symlink".into(),
                ));
            }
            let resolved = canonical_path
                .canonicalize()
                .map_err(|err| SecretError::KeyIo(format!("resolve key file: {err}")))?;
            if resolved.parent() != Some(canonical_root.as_path()) {
                return Err(SecretError::KeyIo(
                    "secret key file resolves outside its canonical root".into(),
                ));
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => return Err(SecretError::KeyIo(format!("inspect key file: {err}"))),
    }

    Ok(SecretKeyPath {
        root: canonical_root,
        #[cfg(not(unix))]
        path: canonical_path,
        #[cfg(unix)]
        root_device: canonical_metadata.dev(),
        #[cfg(unix)]
        root_inode: canonical_metadata.ino(),
    })
}

fn key_from_bytes(bytes: &[u8]) -> Result<[u8; KEY_LEN], SecretError> {
    if bytes.len() != KEY_LEN {
        return Err(SecretError::KeyIo(format!(
            "existing key file has unexpected length {} (expected {KEY_LEN})",
            bytes.len()
        )));
    }
    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(bytes);
    Ok(key)
}

#[cfg(unix)]
fn open_key_root(location: &SecretKeyPath) -> Result<File, SecretError> {
    let root = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(&location.root)
        .map_err(|err| SecretError::KeyIo(format!("open key dir: {err}")))?;
    let metadata = root
        .metadata()
        .map_err(|err| SecretError::KeyIo(format!("inspect opened key dir: {err}")))?;
    if metadata.dev() != location.root_device || metadata.ino() != location.root_inode {
        return Err(SecretError::KeyIo(
            "secret key root was replaced during access".into(),
        ));
    }
    Ok(root)
}

#[cfg(unix)]
fn read_key_file(root: &File) -> Result<Option<[u8; KEY_LEN]>, SecretError> {
    let name = CString::new(KEY_FILE_NAME).expect("static key filename has no NUL");
    let fd = unsafe {
        libc::openat(
            root.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
        )
    };
    if fd < 0 {
        let err = std::io::Error::last_os_error();
        if err.kind() == std::io::ErrorKind::NotFound {
            return Ok(None);
        }
        return Err(SecretError::KeyIo(format!("open key file: {err}")));
    }
    let mut file = unsafe { File::from_raw_fd(fd) };
    let metadata = file
        .metadata()
        .map_err(|err| SecretError::KeyIo(format!("inspect key file: {err}")))?;
    if !metadata.is_file() || metadata.nlink() != 1 || metadata.mode() & 0o077 != 0 {
        return Err(SecretError::KeyIo(
            "secret key path must be a private single-linked regular file".into(),
        ));
    }
    let mut bytes = Vec::with_capacity(KEY_LEN);
    file.read_to_end(&mut bytes)
        .map_err(|err| SecretError::KeyIo(format!("read key file: {err}")))?;
    key_from_bytes(&bytes).map(Some)
}

#[cfg(unix)]
fn load_or_create_key(location: &SecretKeyPath) -> Result<[u8; KEY_LEN], SecretError> {
    let root = open_key_root(location)?;
    if let Some(key) = read_key_file(&root)? {
        return Ok(key);
    }

    let mut key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    if write_key_file(&root, &key)? {
        return Ok(key);
    }
    read_key_file(&root)?.ok_or_else(|| {
        SecretError::KeyIo("secret key appeared concurrently but could not be opened".into())
    })
}

#[cfg(unix)]
fn write_key_file(root: &File, key: &[u8; KEY_LEN]) -> Result<bool, SecretError> {
    write_key_file_with(root, key, |file, key| {
        file.write_all(key)?;
        file.sync_all()
    })
}

#[cfg(unix)]
fn write_key_file_with<F>(root: &File, key: &[u8; KEY_LEN], persist: F) -> Result<bool, SecretError>
where
    F: FnOnce(&mut File, &[u8; KEY_LEN]) -> std::io::Result<()>,
{
    let name = CString::new(KEY_FILE_NAME).expect("static key filename has no NUL");
    let fd = unsafe {
        libc::openat(
            root.as_raw_fd(),
            name.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if fd < 0 {
        let err = std::io::Error::last_os_error();
        if err.kind() == std::io::ErrorKind::AlreadyExists {
            return Ok(false);
        }
        return Err(SecretError::KeyIo(format!("create key file: {err}")));
    }
    let mut file = unsafe { File::from_raw_fd(fd) };
    let created = file
        .metadata()
        .map_err(|err| SecretError::KeyIo(format!("inspect created key file: {err}")))?;
    if let Err(error) = persist(&mut file, key) {
        drop(file);
        if !key_entry_matches(root, &name, &created)? {
            return Err(SecretError::KeyIo(format!(
                "write key file: {error}; key path changed before rollback"
            )));
        }
        if unsafe { libc::unlinkat(root.as_raw_fd(), name.as_ptr(), 0) } != 0 {
            let cleanup = std::io::Error::last_os_error();
            return Err(SecretError::KeyIo(format!(
                "write key file: {error}; remove partial key file: {cleanup}"
            )));
        }
        let _ = root.sync_all();
        return Err(SecretError::KeyIo(format!("write key file: {error}")));
    }
    if !key_entry_matches(root, &name, &created)? {
        return Err(SecretError::KeyIo(
            "secret key path changed before creation completed".into(),
        ));
    }
    root.sync_all()
        .map_err(|err| SecretError::KeyIo(format!("sync key directory: {err}")))?;
    Ok(true)
}

#[cfg(unix)]
fn key_entry_matches(
    root: &File,
    name: &CString,
    expected: &std::fs::Metadata,
) -> Result<bool, SecretError> {
    use std::mem::MaybeUninit;

    let mut live = MaybeUninit::<libc::stat>::uninit();
    if unsafe {
        libc::fstatat(
            root.as_raw_fd(),
            name.as_ptr(),
            live.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } != 0
    {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::NotFound {
            return Ok(false);
        }
        return Err(SecretError::KeyIo(format!(
            "inspect live key file: {error}"
        )));
    }
    let live = unsafe { live.assume_init() };
    Ok(live.st_mode & libc::S_IFMT == libc::S_IFREG
        && live.st_dev as u64 == expected.dev()
        && live.st_ino == expected.ino()
        && live.st_nlink == 1
        && live.st_mode & 0o077 == 0)
}

#[cfg(not(unix))]
fn load_or_create_key(location: &SecretKeyPath) -> Result<[u8; KEY_LEN], SecretError> {
    if let Ok(bytes) = std::fs::read(&location.path) {
        return key_from_bytes(&bytes);
    }
    let mut key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    if write_key_file(&location.path, &key)? {
        return Ok(key);
    }
    let bytes = std::fs::read(&location.path)
        .map_err(|err| SecretError::KeyIo(format!("read key file: {err}")))?;
    key_from_bytes(&bytes)
}

#[cfg(not(unix))]
fn write_key_file(path: &Path, key: &[u8; KEY_LEN]) -> Result<bool, SecretError> {
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
    {
        Ok(mut file) => {
            file.write_all(key)
                .map_err(|err| SecretError::KeyIo(format!("write key file: {err}")))?;
            file.sync_all()
                .map_err(|err| SecretError::KeyIo(format!("sync key file: {err}")))?;
            Ok(true)
        }
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(err) => Err(SecretError::KeyIo(format!("create key file: {err}"))),
    }
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

/// Detect + split an envelope without touching the key.
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

/// Open an authenticated envelope. Plaintext and malformed values are rejected.
fn decrypt_with_key(key: &[u8; KEY_LEN], value: &str) -> Result<String, SecretError> {
    match parse_envelope(value) {
        Parsed::NotEnvelope => Err(SecretError::InvalidEnvelope),
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
    use std::time::{SystemTime, UNIX_EPOCH};

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
    fn plaintext_and_malformed_values_are_rejected() {
        let key = test_key();
        for invalid in [
            "plain-marketplace-token",
            "https://registry.example.com",
            "eyJhbGciOiJIUzI1Ni1.abcDEF.signature",
            "deadbeefcafebabe",
            "",
            "not base64!!! @#$",
        ] {
            let err = decrypt_with_key(&key, invalid).expect_err("plaintext must fail closed");
            assert!(matches!(err, SecretError::InvalidEnvelope));
        }
    }

    #[test]
    fn load_or_create_key_round_trips_via_temp_path() {
        let dir = std::env::temp_dir().join(format!("offisim-secret-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("secret.key");
        let _ = std::fs::remove_file(&path);
        let location = validate_key_path(&path).expect("validate key path");

        let k1 = load_or_create_key(&location).expect("create");
        assert!(path.exists());
        let k2 = load_or_create_key(&location).expect("load existing");
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

    #[cfg(unix)]
    #[test]
    fn key_load_rejects_leaf_symlink_replacement_without_touching_target() {
        use std::os::unix::fs::symlink;

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("offisim-secret-leaf-{stamp}"));
        let outside = std::env::temp_dir().join(format!("offisim-secret-outside-{stamp}"));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let path = root.join(KEY_FILE_NAME);
        let outside_key = outside.join("outside.key");
        let sentinel = [0x5au8; KEY_LEN];
        std::fs::write(&outside_key, sentinel).unwrap();
        let location = validate_key_path(&path).expect("validate missing key path");

        symlink(&outside_key, &path).unwrap();
        let error = load_or_create_key(&location).expect_err("leaf symlink replacement must fail");
        assert!(error.to_string().contains("key file"), "{error}");
        assert_eq!(std::fs::read(&outside_key).unwrap(), sentinel);

        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(outside).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn key_path_rejects_symlinked_root_without_creating_a_key() {
        use std::os::unix::fs::symlink;

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let outside = std::env::temp_dir().join(format!("offisim-secret-root-target-{stamp}"));
        let linked_root = std::env::temp_dir().join(format!("offisim-secret-root-link-{stamp}"));
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, &linked_root).unwrap();

        let error = match validate_key_path(&linked_root.join(KEY_FILE_NAME)) {
            Ok(_) => panic!("symlinked key root must be rejected"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("real directory"), "{error}");
        assert!(!outside.join(KEY_FILE_NAME).exists());

        std::fs::remove_file(linked_root).unwrap();
        std::fs::remove_dir_all(outside).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn key_load_rejects_root_directory_replacement_without_creating_a_key() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("offisim-secret-root-{stamp}"));
        let original = std::env::temp_dir().join(format!("offisim-secret-original-{stamp}"));
        std::fs::create_dir_all(&root).unwrap();
        let location = validate_key_path(&root.join(KEY_FILE_NAME)).expect("validate key root");

        std::fs::rename(&root, &original).unwrap();
        std::fs::create_dir(&root).unwrap();
        let error = load_or_create_key(&location).expect_err("root replacement must fail");
        assert!(error.to_string().contains("replaced"), "{error}");
        assert!(!root.join(KEY_FILE_NAME).exists());
        assert!(!original.join(KEY_FILE_NAME).exists());

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(original).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn key_load_rejects_fifo_replacement_without_blocking() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        use std::sync::mpsc;
        use std::time::Duration;

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("offisim-secret-fifo-{stamp}"));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join(KEY_FILE_NAME);
        let location = validate_key_path(&path).expect("validate missing key path");
        let encoded = CString::new(path.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(encoded.as_ptr(), 0o600) }, 0);

        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = sender.send(load_or_create_key(&location));
        });
        let result = receiver
            .recv_timeout(Duration::from_millis(500))
            .expect("FIFO replacement must not block secret loading");
        assert!(result.is_err());

        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn failed_key_write_removes_the_partial_file() {
        use std::io::Write;

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("offisim-secret-rollback-{stamp}"));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join(KEY_FILE_NAME);
        let location = validate_key_path(&path).expect("validate missing key path");
        let directory = open_key_root(&location).expect("open key root");
        let key = test_key();

        let error = write_key_file_with(&directory, &key, |file, key| {
            file.write_all(&key[..1])?;
            Err(std::io::Error::other("injected key write failure"))
        })
        .expect_err("partial key write must fail");
        assert!(error.to_string().contains("write key file"), "{error}");
        assert!(!path.exists(), "partial key file must be rolled back");

        std::fs::remove_dir_all(root).unwrap();
    }
}
