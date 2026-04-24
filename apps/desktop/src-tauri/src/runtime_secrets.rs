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
use std::env;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;

static STORAGE_DIR: OnceCell<PathBuf> = OnceCell::new();
const SECRET_FILE_NAME: &str = "runtime_secret.txt";
const NO_STORED_SECRET_MESSAGE: &str = "No provider credential stored on this device.";
const NO_CLAUDE_LOCAL_AUTH_MESSAGE: &str =
    "No verified Claude local-auth source was found under CLAUDE_CONFIG_DIR or ~/.claude.";
const NO_CODEX_EXECUTABLE_MESSAGE: &str =
    "No Codex executable was found on PATH or in Codex.app. Install `@openai/codex`, install Codex.app, or set OFFISIM_CODEX_EXECUTABLE.";
const NO_CODEX_LOCAL_AUTH_MESSAGE: &str =
    "No verified Codex local-auth source was found under CODEX_HOME/auth.json or ~/.codex/auth.json.";
const NO_TRUSTED_HOST_RESOLVER_MESSAGE: &str =
    "No trusted-host resolver is registered for this product/access mode.";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSecretStatus {
    has_secret: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedHostProductStatus {
    available: bool,
    resolver_kind: String,
    message: Option<String>,
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

fn home_dir() -> Option<PathBuf> {
    env::var("HOME")
        .ok()
        .map(PathBuf::from)
        .filter(|path| path.exists())
}

fn env_dir(name: &str) -> Option<PathBuf> {
    env::var(name).ok().map(PathBuf::from)
}

fn claude_local_auth_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(config_dir) = env_dir("CLAUDE_CONFIG_DIR") {
        candidates.push(config_dir.join(".credentials.json"));
        candidates.push(config_dir.join("oauth.json"));
    }
    if let Some(home) = home_dir() {
        candidates.push(home.join(".claude/.credentials.json"));
        candidates.push(home.join(".claude.json"));
    }
    candidates
}

fn has_non_empty_file(path: &Path) -> bool {
    fs::metadata(path).map(|meta| meta.is_file() && meta.len() > 2).unwrap_or(false)
}

fn codex_auth_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(codex_home) = env_dir("CODEX_HOME") {
        candidates.push(codex_home.join("auth.json"));
    }
    if let Some(home) = home_dir() {
        candidates.push(home.join(".codex/auth.json"));
    }
    candidates
}

fn has_non_empty_json_string(value: Option<&serde_json::Value>) -> bool {
    value
        .and_then(|value| value.as_str())
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn has_codex_local_auth_file(path: &Path) -> bool {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return false,
    };
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(parsed) => parsed,
        Err(_) => return false,
    };

    has_non_empty_json_string(parsed.get("OPENAI_API_KEY"))
        || has_non_empty_json_string(parsed.pointer("/tokens/access_token"))
        || has_non_empty_json_string(parsed.pointer("/tokens/refresh_token"))
        || has_non_empty_json_string(parsed.pointer("/tokens/id_token"))
}

fn has_command_available(command: &str) -> bool {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return false;
    }

    let path = PathBuf::from(trimmed);
    if path.is_absolute() || trimmed.contains(std::path::MAIN_SEPARATOR) {
        return fs::metadata(&path)
            .map(|meta| meta.is_file())
            .unwrap_or(false);
    }

    env::var_os("PATH")
        .map(|paths| {
            env::split_paths(&paths).any(|dir| {
                fs::metadata(dir.join(trimmed))
                    .map(|meta| meta.is_file())
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn codex_executable_candidates() -> Vec<String> {
    let mut candidates = Vec::new();

    if let Ok(explicit) = env::var("OFFISIM_CODEX_EXECUTABLE") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            candidates.push(trimmed.to_string());
        }
    }

    candidates.push("codex".into());

    if cfg!(target_os = "macos") {
        candidates.push("/Applications/Codex.app/Contents/Resources/codex".into());
        if let Some(home) = home_dir() {
            candidates.push(
                home.join("Applications/Codex.app/Contents/Resources/codex")
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }

    candidates
}

fn has_codex_executable_available() -> bool {
    codex_executable_candidates()
        .iter()
        .any(|candidate| has_command_available(candidate))
}

fn trusted_host_status(
    resolver_kind: &str,
    available: bool,
    unavailable_message: &str,
) -> TrustedHostProductStatus {
    TrustedHostProductStatus {
        available,
        resolver_kind: resolver_kind.into(),
        message: (!available).then(|| unavailable_message.into()),
    }
}

fn api_key_secret_status() -> Result<TrustedHostProductStatus, String> {
    Ok(trusted_host_status(
        "api-key-secret",
        read_secret_raw()?.is_some(),
        NO_STORED_SECRET_MESSAGE,
    ))
}

fn has_claude_local_auth_available() -> bool {
    claude_local_auth_paths()
        .iter()
        .any(|path| has_non_empty_file(path))
}

fn claude_local_auth_status() -> TrustedHostProductStatus {
    trusted_host_status(
        "claude-local-auth",
        has_claude_local_auth_available(),
        NO_CLAUDE_LOCAL_AUTH_MESSAGE,
    )
}

fn has_codex_local_auth_available() -> bool {
    codex_auth_paths()
        .iter()
        .any(|path| has_codex_local_auth_file(path))
}

fn codex_local_auth_status() -> TrustedHostProductStatus {
    if !has_codex_executable_available() {
        return trusted_host_status("codex-local-auth", false, NO_CODEX_EXECUTABLE_MESSAGE);
    }

    trusted_host_status(
        "codex-local-auth",
        has_codex_local_auth_available(),
        NO_CODEX_LOCAL_AUTH_MESSAGE,
    )
}

#[tauri::command]
pub fn trusted_host_product_status(
    product_id: String,
    access_mode: String,
) -> Result<TrustedHostProductStatus, String> {
    let product_id = product_id.trim();
    let access_mode = access_mode.trim();

    if access_mode == "api-key" {
        return api_key_secret_status();
    }

    if product_id == "claude" && (access_mode == "local-auth" || access_mode == "subscription") {
        return Ok(claude_local_auth_status());
    }

    if product_id == "codex" && access_mode == "local-auth" {
        return Ok(codex_local_auth_status());
    }

    Ok(trusted_host_status(
        "none",
        false,
        NO_TRUSTED_HOST_RESOLVER_MESSAGE,
    ))
}
