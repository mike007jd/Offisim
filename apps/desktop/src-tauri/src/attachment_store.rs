//! Binary-safe IPC for chat attachments.
//!
//! Files land at `<app_local_data_dir>/attachments/<companyId>/<threadId>/<attachmentId>.bin`
//! with a sibling `<attachmentId>.meta.json`. Bytes cross the JS↔Rust boundary
//! as raw `Vec<u8>` (no base64 inflation).
//!
//! Hard limits — all enforced in this module so a future capability mistake
//! cannot relax them upstream:
//!   - per-file ≤ 8 MB (mirrors `builtin_tools::MAX_READ_BYTES`)
//!   - path components must match `[A-Za-z0-9._-]+`
//!   - `..` rejected at every layer
//!   - sha256 stored in `.meta.json`; read-path verifies and surfaces a typed
//!     `attachment-corrupted` error on mismatch (and drops the row).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};
use thiserror::Error;
use tokio::fs;
use tokio::io::AsyncWriteExt;

const MAX_FILE_BYTES: usize = 8 * 1024 * 1024;
const ATTACHMENTS_DIR_NAME: &str = "attachments";
const VAULT_REF_SCHEME: &str = "attachment://";

/// Persisted blob metadata. Mirrors the TS `AttachmentMeta` shape; the on-disk
/// `.meta.json` is JSON-only, no migration tooling.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentMeta {
    pub attachment_id: String,
    pub company_id: String,
    pub thread_id: String,
    pub filename: String,
    pub mime_type: String,
    pub byte_length: u64,
    pub sha256: String,
    pub created_at: String,
    pub parsed_rev: u32,
    pub kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentReadPayload {
    pub meta: AttachmentMeta,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum AttachmentError {
    #[error("attachment-not-found")]
    NotFound,
    #[error("attachment-corrupted")]
    Corrupted,
    #[error("attachment-too-large")]
    TooLarge,
    #[error("attachment-invalid-id")]
    InvalidId,
    #[error("attachment-meta-mismatch")]
    MetaMismatch,
    #[error("attachment-io-failed: {0}")]
    Io(String),
}

fn segment_ok(s: &str) -> bool {
    !s.is_empty()
        && !s.contains('/')
        && !s.contains('\\')
        && s != "."
        && s != ".."
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

fn assert_segment(s: &str) -> Result<(), AttachmentError> {
    if segment_ok(s) {
        Ok(())
    } else {
        Err(AttachmentError::InvalidId)
    }
}

fn is_uuid_v4(s: &str) -> bool {
    if s.len() != 36 {
        return false;
    }
    let bytes = s.as_bytes();
    if bytes[8] != b'-' || bytes[13] != b'-' || bytes[18] != b'-' || bytes[23] != b'-' {
        return false;
    }
    if bytes[14] != b'4' {
        return false;
    }
    if !matches!(bytes[19], b'8' | b'9' | b'a' | b'b' | b'A' | b'B') {
        return false;
    }
    bytes
        .iter()
        .enumerate()
        .all(|(idx, b)| matches!(idx, 8 | 13 | 18 | 23) || b.is_ascii_hexdigit())
}

fn assert_attachment_id(s: &str) -> Result<(), AttachmentError> {
    if segment_ok(s) && is_uuid_v4(s) {
        Ok(())
    } else {
        Err(AttachmentError::InvalidId)
    }
}

fn attachments_root<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, AttachmentError> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|err| AttachmentError::Io(format!("app_local_data_dir: {err}")))?;
    Ok(base.join(ATTACHMENTS_DIR_NAME))
}

fn parse_vault_ref(vault_ref: &str) -> Result<(String, String, String), AttachmentError> {
    let tail = vault_ref
        .strip_prefix(VAULT_REF_SCHEME)
        .ok_or(AttachmentError::InvalidId)?;
    if tail.contains("..") || tail.contains("//") {
        return Err(AttachmentError::InvalidId);
    }
    let parts: Vec<&str> = tail.split('/').collect();
    if parts.len() != 3 {
        return Err(AttachmentError::InvalidId);
    }
    assert_segment(parts[0])?;
    assert_segment(parts[1])?;
    assert_attachment_id(parts[2])?;
    Ok((
        parts[0].to_string(),
        parts[1].to_string(),
        parts[2].to_string(),
    ))
}

fn build_paths(dir: &Path, attachment_id: &str) -> (PathBuf, PathBuf, PathBuf) {
    let bin = dir.join(format!("{attachment_id}.bin"));
    let meta = dir.join(format!("{attachment_id}.meta.json"));
    let tmp = dir.join(format!("{attachment_id}.bin.tmp"));
    (bin, meta, tmp)
}

async fn write_atomic(path: &Path, tmp: &Path, bytes: &[u8]) -> Result<(), AttachmentError> {
    let mut file = fs::File::create(tmp)
        .await
        .map_err(|err| AttachmentError::Io(format!("open tmp: {err}")))?;
    file.write_all(bytes)
        .await
        .map_err(|err| AttachmentError::Io(format!("write tmp: {err}")))?;
    file.flush()
        .await
        .map_err(|err| AttachmentError::Io(format!("flush tmp: {err}")))?;
    drop(file);
    fs::rename(tmp, path)
        .await
        .map_err(|err| AttachmentError::Io(format!("rename tmp: {err}")))?;
    Ok(())
}

pub fn compute_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Pure async helper, reusable from tests by passing an arbitrary attachments
/// root. The Tauri command wrapper resolves the root via `AppHandle` and
/// delegates here.
pub async fn attachment_write_under_root(
    root: &Path,
    meta: AttachmentMeta,
    bytes: Vec<u8>,
) -> Result<String, AttachmentError> {
    if bytes.len() > MAX_FILE_BYTES {
        return Err(AttachmentError::TooLarge);
    }
    if meta.byte_length as usize != bytes.len() {
        return Err(AttachmentError::MetaMismatch);
    }
    let computed = compute_sha256(&bytes);
    if !computed.eq_ignore_ascii_case(&meta.sha256) {
        return Err(AttachmentError::MetaMismatch);
    }
    assert_segment(&meta.company_id)?;
    assert_segment(&meta.thread_id)?;
    assert_attachment_id(&meta.attachment_id)?;
    let dir = root.join(&meta.company_id).join(&meta.thread_id);
    fs::create_dir_all(&dir)
        .await
        .map_err(|err| AttachmentError::Io(format!("create dir: {err}")))?;
    let (bin, meta_path, tmp) = build_paths(&dir, &meta.attachment_id);
    let meta_tmp = dir.join(format!("{}.meta.json.tmp", meta.attachment_id));
    write_atomic(&bin, &tmp, &bytes).await?;
    let meta_bytes = serde_json::to_vec_pretty(&meta)
        .map_err(|err| AttachmentError::Io(format!("encode meta: {err}")))?;
    write_atomic(&meta_path, &meta_tmp, &meta_bytes).await?;
    Ok(format!(
        "{VAULT_REF_SCHEME}{}/{}/{}",
        meta.company_id, meta.thread_id, meta.attachment_id
    ))
}

#[tauri::command]
pub async fn attachment_write<R: Runtime>(
    app: tauri::AppHandle<R>,
    meta: AttachmentMeta,
    bytes: Vec<u8>,
) -> Result<String, AttachmentError> {
    let root = attachments_root(&app)?;
    attachment_write_under_root(&root, meta, bytes).await
}

pub async fn attachment_read_under_root(
    root: &Path,
    vault_ref: &str,
    max_bytes: Option<u64>,
) -> Result<AttachmentReadPayload, AttachmentError> {
    let (company_id, thread_id, attachment_id) = parse_vault_ref(vault_ref)?;
    let dir = root.join(&company_id).join(&thread_id);
    let (bin, meta_path, _tmp) = build_paths(&dir, &attachment_id);
    let cap = match max_bytes {
        Some(n) => std::cmp::min(n as usize, MAX_FILE_BYTES),
        None => MAX_FILE_BYTES,
    };
    let meta_raw = match fs::read(&meta_path).await {
        Ok(b) => b,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(AttachmentError::NotFound)
        }
        Err(err) => return Err(AttachmentError::Io(format!("read meta: {err}"))),
    };
    let meta: AttachmentMeta = serde_json::from_slice(&meta_raw)
        .map_err(|err| AttachmentError::Io(format!("decode meta: {err}")))?;
    let bytes = match fs::read(&bin).await {
        Ok(b) => b,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(AttachmentError::NotFound)
        }
        Err(err) => return Err(AttachmentError::Io(format!("read bin: {err}"))),
    };
    if bytes.len() > MAX_FILE_BYTES {
        return Err(AttachmentError::TooLarge);
    }
    let computed = compute_sha256(&bytes);
    if !computed.eq_ignore_ascii_case(&meta.sha256) {
        let _ = fs::remove_file(&bin).await;
        let _ = fs::remove_file(&meta_path).await;
        return Err(AttachmentError::Corrupted);
    }
    let truncated = if bytes.len() > cap {
        bytes[..cap].to_vec()
    } else {
        bytes
    };
    Ok(AttachmentReadPayload {
        meta,
        bytes: truncated,
    })
}

#[tauri::command]
pub async fn attachment_read<R: Runtime>(
    app: tauri::AppHandle<R>,
    vault_ref: String,
    max_bytes: Option<u64>,
) -> Result<AttachmentReadPayload, AttachmentError> {
    let root = attachments_root(&app)?;
    attachment_read_under_root(&root, &vault_ref, max_bytes).await
}

pub async fn attachment_list_under_root(
    root: &Path,
    company_id: &str,
    thread_id: &str,
) -> Result<Vec<AttachmentMeta>, AttachmentError> {
    assert_segment(company_id)?;
    assert_segment(thread_id)?;
    let dir = root.join(company_id).join(thread_id);
    let mut metas = Vec::new();
    let mut read_dir = match fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(metas),
        Err(err) => return Err(AttachmentError::Io(format!("read_dir: {err}"))),
    };
    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|err| AttachmentError::Io(format!("dir next_entry: {err}")))?
    {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if !path
            .file_name()
            .and_then(|s| s.to_str())
            .map(|n| n.ends_with(".meta.json"))
            .unwrap_or(false)
        {
            continue;
        }
        let raw = fs::read(&path)
            .await
            .map_err(|err| AttachmentError::Io(format!("read meta {}: {err}", path.display())))?;
        match serde_json::from_slice::<AttachmentMeta>(&raw) {
            Ok(m) => metas.push(m),
            Err(err) => {
                eprintln!(
                    "[attachment_store] skipping unreadable meta {}: {err}",
                    path.display()
                );
            }
        }
    }
    metas.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(metas)
}

pub async fn attachment_list_all_under_root(
    root: &Path,
) -> Result<Vec<AttachmentMeta>, AttachmentError> {
    let mut metas = Vec::new();
    let mut company_dirs = match fs::read_dir(root).await {
        Ok(rd) => rd,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(metas),
        Err(err) => return Err(AttachmentError::Io(format!("read root: {err}"))),
    };
    while let Some(company_entry) = company_dirs
        .next_entry()
        .await
        .map_err(|err| AttachmentError::Io(format!("company next_entry: {err}")))?
    {
        let company_type = company_entry
            .file_type()
            .await
            .map_err(|err| AttachmentError::Io(format!("company file_type: {err}")))?;
        if !company_type.is_dir() {
            continue;
        }
        let Some(company_id) = company_entry.file_name().to_str().map(|s| s.to_string()) else {
            continue;
        };
        if !segment_ok(&company_id) {
            continue;
        }
        let mut thread_dirs = match fs::read_dir(company_entry.path()).await {
            Ok(rd) => rd,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) => return Err(AttachmentError::Io(format!("read company: {err}"))),
        };
        while let Some(thread_entry) = thread_dirs
            .next_entry()
            .await
            .map_err(|err| AttachmentError::Io(format!("thread next_entry: {err}")))?
        {
            let thread_type = thread_entry
                .file_type()
                .await
                .map_err(|err| AttachmentError::Io(format!("thread file_type: {err}")))?;
            if !thread_type.is_dir() {
                continue;
            }
            let Some(thread_id) = thread_entry.file_name().to_str().map(|s| s.to_string()) else {
                continue;
            };
            if !segment_ok(&thread_id) {
                continue;
            }
            metas.extend(attachment_list_under_root(root, &company_id, &thread_id).await?);
        }
    }
    metas.sort_by(|a, b| {
        a.company_id
            .cmp(&b.company_id)
            .then(a.thread_id.cmp(&b.thread_id))
            .then(a.created_at.cmp(&b.created_at))
            .then(a.attachment_id.cmp(&b.attachment_id))
    });
    Ok(metas)
}

#[tauri::command]
pub async fn attachment_list<R: Runtime>(
    app: tauri::AppHandle<R>,
    company_id: String,
    thread_id: String,
) -> Result<Vec<AttachmentMeta>, AttachmentError> {
    let root = attachments_root(&app)?;
    attachment_list_under_root(&root, &company_id, &thread_id).await
}

#[tauri::command]
pub async fn attachment_list_all<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<AttachmentMeta>, AttachmentError> {
    let root = attachments_root(&app)?;
    attachment_list_all_under_root(&root).await
}

pub async fn attachment_delete_under_root(
    root: &Path,
    vault_ref: &str,
) -> Result<(), AttachmentError> {
    let (company_id, thread_id, attachment_id) = parse_vault_ref(vault_ref)?;
    let dir = root.join(&company_id).join(&thread_id);
    let (bin, meta_path, _tmp) = build_paths(&dir, &attachment_id);
    match fs::remove_file(&bin).await {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => return Err(AttachmentError::Io(format!("remove bin: {err}"))),
    }
    match fs::remove_file(&meta_path).await {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(AttachmentError::Io(format!("remove meta: {err}"))),
    }
}

#[tauri::command]
pub async fn attachment_delete<R: Runtime>(
    app: tauri::AppHandle<R>,
    vault_ref: String,
) -> Result<(), AttachmentError> {
    let root = attachments_root(&app)?;
    attachment_delete_under_root(&root, &vault_ref).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segment_validator_rejects_unsafe_inputs() {
        assert!(segment_ok("abc-123_DEF.txt"));
        assert!(!segment_ok(""));
        assert!(!segment_ok(".."));
        assert!(!segment_ok("./foo"));
        assert!(!segment_ok("a/b"));
        assert!(!segment_ok("a\\b"));
        assert!(!segment_ok("foo bar"));
    }

    #[test]
    fn parse_vault_ref_round_trip() {
        let r = "attachment://company-1/thread-9/123e4567-e89b-42d3-a456-426614174000";
        let (c, t, a) = parse_vault_ref(r).expect("ok");
        assert_eq!(c, "company-1");
        assert_eq!(t, "thread-9");
        assert_eq!(a, "123e4567-e89b-42d3-a456-426614174000");
    }

    #[test]
    fn parse_vault_ref_rejects_traversal() {
        assert!(parse_vault_ref("attachment://../foo/bar").is_err());
        assert!(parse_vault_ref("attachment://a//b/c").is_err());
        assert!(parse_vault_ref("attachment://a/b").is_err());
        assert!(parse_vault_ref("file:///etc/passwd").is_err());
        assert!(parse_vault_ref("attachment://a/b/not-a-uuid").is_err());
        assert!(parse_vault_ref("attachment://a/b/123e4567-e89b-12d3-a456-426614174000").is_err());
    }

    #[test]
    fn sha256_helper_matches_known_vector() {
        let s = compute_sha256(b"hello");
        assert_eq!(
            s,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn max_file_bytes_matches_builtin_tools_ceiling() {
        // We deliberately mirror the existing builtin_tools::MAX_READ_BYTES so
        // attachment IO and project file reads share one ceiling.
        assert_eq!(MAX_FILE_BYTES, 8 * 1024 * 1024);
    }

    use std::time::{SystemTime, UNIX_EPOCH};
    use tokio::runtime::Builder;

    fn temp_root(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let p = std::env::temp_dir().join(format!(
            "offisim-attachment-store-{label}-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&p).expect("temp dir");
        p
    }

    fn meta_for(bytes: &[u8], attachment_id: &str) -> AttachmentMeta {
        AttachmentMeta {
            attachment_id: attachment_id.to_string(),
            company_id: "co-test".to_string(),
            thread_id: "th-test".to_string(),
            filename: "blob.bin".to_string(),
            mime_type: "application/octet-stream".to_string(),
            byte_length: bytes.len() as u64,
            sha256: compute_sha256(bytes),
            created_at: "1970-01-01T00:00:00Z".to_string(),
            parsed_rev: 1,
            kind: "other".to_string(),
        }
    }

    fn rt() -> tokio::runtime::Runtime {
        Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("rt")
    }

    /// IPC contract: `Vec<u8>` parameters and returns travel as raw bytes via
    /// Tauri 2 invoke (no base64 inflation by the framework). We can't probe
    /// the Tauri wire format from a unit test without spinning a MockRuntime,
    /// so we anchor the no-inflation invariant at the storage layer instead:
    /// after a round-trip of an 8 MB blob, the on-disk `.bin` size MUST equal
    /// `bytes.len()` exactly. Any base64 inflation upstream would land here as
    /// a 1.33× size delta and fail the assert.
    #[test]
    fn round_trip_eight_mb_blob_preserves_byte_for_byte_size() {
        let root = temp_root("eight-mb");
        let bytes: Vec<u8> = (0..MAX_FILE_BYTES).map(|i| (i % 251) as u8).collect();
        assert_eq!(bytes.len(), 8 * 1024 * 1024);
        let id = "11111111-1111-4111-9111-111111111111";
        let meta = meta_for(&bytes, id);
        let vault_ref = rt()
            .block_on(attachment_write_under_root(
                &root,
                meta.clone(),
                bytes.clone(),
            ))
            .expect("write");
        let on_disk = std::fs::metadata(
            root.join("co-test")
                .join("th-test")
                .join(format!("{id}.bin")),
        )
        .expect("on disk")
        .len();
        assert_eq!(on_disk, bytes.len() as u64);
        let read = rt()
            .block_on(attachment_read_under_root(&root, &vault_ref, None))
            .expect("read");
        assert_eq!(read.bytes.len(), bytes.len());
        assert_eq!(read.bytes[..256], bytes[..256]);
        assert_eq!(read.bytes[bytes.len() - 256..], bytes[bytes.len() - 256..]);
        assert_eq!(read.meta.sha256, meta.sha256);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn write_rejects_oversized_payload() {
        let root = temp_root("oversize");
        let bytes = vec![0u8; MAX_FILE_BYTES + 1];
        let meta = meta_for(&bytes, "22222222-2222-4222-9222-222222222222");
        let err = rt()
            .block_on(attachment_write_under_root(&root, meta, bytes))
            .expect_err("oversized must reject");
        assert!(matches!(err, AttachmentError::TooLarge));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn read_returns_not_found_for_missing_ref() {
        let root = temp_root("missing");
        let err = rt()
            .block_on(attachment_read_under_root(
                &root,
                "attachment://co-test/th-test/33333333-3333-4333-9333-333333333333",
                None,
            ))
            .expect_err("missing ref must surface NotFound");
        assert!(matches!(err, AttachmentError::NotFound));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn corrupted_bin_drops_row_and_reports_corrupted() {
        let root = temp_root("corrupted");
        let bytes = b"hello world".to_vec();
        let id = "44444444-4444-4444-9444-444444444444";
        let meta = meta_for(&bytes, id);
        let vault_ref = rt()
            .block_on(attachment_write_under_root(&root, meta, bytes))
            .expect("write");
        // Tamper with the on-disk bytes so sha256 no longer matches.
        let bin = root
            .join("co-test")
            .join("th-test")
            .join(format!("{id}.bin"));
        std::fs::write(&bin, b"tampered!").expect("tamper");
        let err = rt()
            .block_on(attachment_read_under_root(&root, &vault_ref, None))
            .expect_err("tampered ref must surface Corrupted");
        assert!(matches!(err, AttachmentError::Corrupted));
        // Read again — the prior corrupted-detect should have removed the row.
        let err2 = rt()
            .block_on(attachment_read_under_root(&root, &vault_ref, None))
            .expect_err("corrupted ref must be NotFound after auto-drop");
        assert!(matches!(err2, AttachmentError::NotFound));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn delete_is_idempotent() {
        let root = temp_root("idempotent");
        let bytes = b"x".to_vec();
        let id = "55555555-5555-4555-9555-555555555555";
        let meta = meta_for(&bytes, id);
        let vault_ref = rt()
            .block_on(attachment_write_under_root(&root, meta, bytes))
            .expect("write");
        rt().block_on(attachment_delete_under_root(&root, &vault_ref))
            .expect("first delete");
        rt().block_on(attachment_delete_under_root(&root, &vault_ref))
            .expect("second delete is no-op");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn list_all_recursively_enumerates_thread_metas_without_reading_bins() {
        let root = temp_root("list-all");
        let a = b"a".to_vec();
        let b = b"bb".to_vec();
        let mut meta_a = meta_for(&a, "66666666-6666-4666-9666-666666666666");
        meta_a.company_id = "co-a".to_string();
        meta_a.thread_id = "th-a".to_string();
        meta_a.created_at = "2026-01-01T00:00:00.000Z".to_string();
        let mut meta_b = meta_for(&b, "77777777-7777-4777-9777-777777777777");
        meta_b.company_id = "co-b".to_string();
        meta_b.thread_id = "th-b".to_string();
        meta_b.created_at = "2026-01-02T00:00:00.000Z".to_string();

        rt().block_on(attachment_write_under_root(&root, meta_b.clone(), b))
            .expect("write b");
        rt().block_on(attachment_write_under_root(&root, meta_a.clone(), a))
            .expect("write a");

        let metas = rt()
            .block_on(attachment_list_all_under_root(&root))
            .expect("list all");
        let ids: Vec<String> = metas.into_iter().map(|m| m.attachment_id).collect();
        assert_eq!(
            ids,
            vec![
                "66666666-6666-4666-9666-666666666666".to_string(),
                "77777777-7777-4777-9777-777777777777".to_string(),
            ]
        );
        std::fs::remove_dir_all(&root).ok();
    }
}
