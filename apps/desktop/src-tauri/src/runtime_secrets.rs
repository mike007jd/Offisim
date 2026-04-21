//! Runtime secret storage for desktop.
//!
//! The credential lives in a Rust-only plaintext file inside the app's local
//! data directory (`~/Library/Application Support/com.offisim.desktop/` on
//! macOS). File mode is 0600. This module is the sole writer/reader; the
//! webview can only ask for existence (`runtime_secret_status`) / set / clear
//! through tauri commands — the secret bytes never cross the JS boundary.
//!
//! Why plaintext (not OS Keychain): Claude Code itself ships with a plaintext
//! `~/.claude/.credentials.json` fallback for exactly this reason — Keychain
//! ACL on unsigned macOS builds prompts on every binary hash change, which is
//! hostile to dev. Our threat model is prompt-injection against the webview,
//! not local disk exfiltration; file-level isolation plus mode 0600 matches
//! the industry baseline for BYO-key desktop apps.

use once_cell::sync::OnceCell;
use serde::Serialize;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;

static STORAGE_DIR: OnceCell<PathBuf> = OnceCell::new();
const SECRET_FILE_NAME: &str = "runtime_secret.txt";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSecretStatus {
    has_secret: bool,
}

/// Called once from `lib.rs::setup`; caches the resolved app_local_data_dir
/// so non-command code paths (e.g. `llm_transport::read_secret`) don't need
/// an `AppHandle`.
pub fn init_storage<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("resolve app_local_data_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create storage dir {dir:?}: {e}"))?;
    STORAGE_DIR
        .set(dir)
        .map_err(|_| "storage dir already initialised".to_string())
}

fn secret_path() -> Result<PathBuf, String> {
    STORAGE_DIR
        .get()
        .map(|d| d.join(SECRET_FILE_NAME))
        .ok_or_else(|| "runtime_secrets storage not initialised".to_string())
}

#[cfg(unix)]
fn set_file_mode_600(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = fs::metadata(path)?.permissions();
    perms.set_mode(0o600);
    fs::set_permissions(path, perms)
}

#[cfg(not(unix))]
fn set_file_mode_600(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

pub(crate) fn read_secret_raw() -> Result<Option<String>, String> {
    let path = secret_path()?;
    match fs::read_to_string(&path) {
        Ok(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read secret file: {e}")),
    }
}

#[tauri::command]
pub fn runtime_secret_status() -> Result<RuntimeSecretStatus, String> {
    Ok(RuntimeSecretStatus {
        has_secret: read_secret_raw()?.is_some(),
    })
}

#[tauri::command]
pub fn runtime_secret_set(secret: String) -> Result<(), String> {
    let trimmed = secret.trim();
    if trimmed.is_empty() {
        return Err("Secret cannot be empty".into());
    }
    let path = secret_path()?;
    // Write atomically via a sibling tmp file + rename so a crashed write
    // cannot leave a half-written secret on disk.
    let tmp = path.with_extension("txt.tmp");
    {
        let mut f = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&tmp)
            .map_err(|e| format!("open tmp secret file: {e}"))?;
        f.write_all(trimmed.as_bytes())
            .map_err(|e| format!("write secret: {e}"))?;
        f.sync_all().map_err(|e| format!("fsync secret: {e}"))?;
    }
    set_file_mode_600(&tmp).map_err(|e| format!("chmod 600 tmp: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("rename secret file: {e}"))?;
    set_file_mode_600(&path).map_err(|e| format!("chmod 600 final: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn runtime_secret_clear() -> Result<(), String> {
    let path = secret_path()?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("delete secret file: {e}")),
    }
}
