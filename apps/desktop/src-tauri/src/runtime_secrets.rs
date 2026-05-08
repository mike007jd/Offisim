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
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;

static STORAGE_DIR: OnceCell<PathBuf> = OnceCell::new();
static LOCAL_ENV: OnceCell<HashMap<String, String>> = OnceCell::new();
const SECRET_FILE_NAME: &str = "runtime_secret.txt";
const PROVIDER_PROFILES_FILE_NAME: &str = "runtime_provider_profiles.json";
const PROVIDER_PROFILE_AUDIT_FILE_NAME: &str = "runtime_provider_profile_audit.jsonl";
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

fn parse_env_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    let (key, value) = trimmed.split_once('=')?;
    let key = key.trim();
    if key.is_empty() {
        return None;
    }
    let value = value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string();
    Some((key.to_string(), value))
}

fn find_local_env_path() -> Option<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(dir) = env::current_dir() {
        roots.push(dir);
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            roots.push(parent.to_path_buf());
        }
    }
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")));

    for root in roots {
        for ancestor in root.ancestors() {
            let candidate = ancestor.join(".env.local");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn local_env() -> &'static HashMap<String, String> {
    LOCAL_ENV.get_or_init(|| {
        let Some(path) = find_local_env_path() else {
            return HashMap::new();
        };
        let Ok(raw) = fs::read_to_string(path) else {
            return HashMap::new();
        };
        raw.lines().filter_map(parse_env_line).collect()
    })
}

fn env_or_local(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .or_else(|| local_env().get(name).cloned())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(crate) fn read_provider_secret(secret_ref: Option<&str>) -> Result<Option<String>, String> {
    let Some(secret_ref) = secret_ref.map(str::trim).filter(|value| !value.is_empty()) else {
        return read_secret_raw();
    };
    let env_name = match secret_ref {
        "minimax" => "MINIMAX_API_KEY",
        "zai" => "ZAI_API_KEY",
        "openrouter" => "OPENROUTER_API_KEY",
        _ => return read_secret_raw(),
    };
    Ok(env_or_local(env_name))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProviderProfile {
    pub(crate) id: String,
    display_name: String,
    pub(crate) provider: String,
    model: String,
    pub(crate) base_url: String,
    pub(crate) secret_ref: String,
    pub(crate) auth_scheme: String,
    pub(crate) allowed_host: String,
    pub(crate) local_endpoint: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProviderProfileUpsertRequest {
    id: String,
    display_name: String,
    provider: String,
    model: String,
    base_url: String,
    #[serde(default)]
    secret_ref: Option<String>,
    #[serde(default)]
    local_endpoint: Option<bool>,
}

fn provider_profiles_path() -> Result<PathBuf, String> {
    STORAGE_DIR
        .get()
        .map(|d| d.join(PROVIDER_PROFILES_FILE_NAME))
        .ok_or_else(|| "runtime_secrets storage not initialised".to_string())
}

fn provider_profile_audit_path() -> Result<PathBuf, String> {
    STORAGE_DIR
        .get()
        .map(|d| d.join(PROVIDER_PROFILE_AUDIT_FILE_NAME))
        .ok_or_else(|| "runtime_secrets storage not initialised".to_string())
}

fn host_from_base_url(base_url: &str) -> Result<String, String> {
    let parsed =
        url::Url::parse(base_url).map_err(|err| format!("invalid provider baseURL: {err}"))?;
    parsed
        .host_str()
        .map(|host| host.to_ascii_lowercase())
        .ok_or_else(|| "provider baseURL must include a host".to_string())
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}

fn is_local_endpoint_url(base_url: &str) -> bool {
    url::Url::parse(base_url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|host| host.to_ascii_lowercase()))
        .map(|host| is_loopback_host(&host))
        .unwrap_or(false)
}

fn auth_scheme_for(provider: &str, base_url: &str) -> String {
    if provider == "anthropic" {
        if let Ok(parsed) = url::Url::parse(base_url) {
            if parsed
                .host_str()
                .map(|host| host.ends_with("api.anthropic.com"))
                .unwrap_or(false)
            {
                return "x-api-key".into();
            }
        }
    }
    "bearer".into()
}

fn normalize_profile(
    mut profile: RuntimeProviderProfile,
) -> Result<RuntimeProviderProfile, String> {
    let base_url = profile.base_url.trim().trim_end_matches('/').to_string();
    if base_url.is_empty() {
        return Err("provider baseURL cannot be empty".into());
    }
    let allowed_host = host_from_base_url(&base_url)?;
    let parsed =
        url::Url::parse(&base_url).map_err(|err| format!("invalid provider baseURL: {err}"))?;
    let local_endpoint = profile.local_endpoint || is_local_endpoint_url(&base_url);
    if parsed.scheme() != "https" && !(local_endpoint && parsed.scheme() == "http") {
        return Err(
            "provider baseURL must use https unless explicitly marked as a local endpoint".into(),
        );
    }
    if local_endpoint && !is_loopback_host(&allowed_host) {
        return Err("local provider profiles must use localhost or loopback host".into());
    }
    profile.base_url = base_url;
    profile.allowed_host = allowed_host;
    profile.local_endpoint = local_endpoint;
    profile.auth_scheme = auth_scheme_for(&profile.provider, &profile.base_url);
    Ok(profile)
}

fn read_stored_provider_profiles() -> Result<Vec<RuntimeProviderProfile>, String> {
    let path = provider_profiles_path()?;
    match fs::read_to_string(&path) {
        Ok(raw) => {
            let profiles: Vec<RuntimeProviderProfile> = serde_json::from_str(&raw)
                .map_err(|err| format!("parse provider profiles: {err}"))?;
            profiles.into_iter().map(normalize_profile).collect()
        }
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(Vec::new()),
        Err(err) => Err(format!("read provider profiles: {err}")),
    }
}

fn write_stored_provider_profiles(profiles: &[RuntimeProviderProfile]) -> Result<(), String> {
    let path = provider_profiles_path()?;
    let tmp = path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(profiles)
        .map_err(|err| format!("serialize profiles: {err}"))?;
    fs::write(&tmp, raw).map_err(|err| format!("write provider profiles tmp: {err}"))?;
    fs::rename(&tmp, &path).map_err(|err| format!("replace provider profiles: {err}"))
}

fn append_provider_profile_audit(
    profile: &RuntimeProviderProfile,
    action: &str,
) -> Result<(), String> {
    let path = provider_profile_audit_path()?;
    let event = serde_json::json!({
        "action": action,
        "profileId": profile.id,
        "provider": profile.provider,
        "scheme": url::Url::parse(&profile.base_url).ok().map(|url| url.scheme().to_string()),
        "host": profile.allowed_host,
        "pathPrefix": url::Url::parse(&profile.base_url).ok().map(|url| url.path().to_string()),
        "localEndpoint": profile.local_endpoint,
        "createdAt": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0),
    });
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|err| format!("open provider profile audit: {err}"))?;
    writeln!(
        file,
        "{}",
        serde_json::to_string(&event).map_err(|err| format!("serialize profile audit: {err}"))?
    )
    .map_err(|err| format!("write provider profile audit: {err}"))
}

fn profile_from_env(
    id: &str,
    display_name: &str,
    provider: &str,
    model_env: &str,
    base_url_env: &str,
    secret_env: &str,
) -> Option<RuntimeProviderProfile> {
    let model = env_or_local(model_env)?;
    let base_url = env_or_local(base_url_env)?;
    let _secret = env_or_local(secret_env)?;
    normalize_profile(RuntimeProviderProfile {
        id: id.into(),
        display_name: display_name.into(),
        provider: provider.into(),
        model,
        base_url,
        secret_ref: id.into(),
        auth_scheme: String::new(),
        allowed_host: String::new(),
        local_endpoint: false,
    })
    .ok()
}

#[tauri::command]
pub fn runtime_provider_profiles() -> Result<Vec<RuntimeProviderProfile>, String> {
    let mut profiles: Vec<RuntimeProviderProfile> = [
        profile_from_env(
            "minimax",
            "MiniMax",
            "anthropic",
            "MINIMAX_MODEL",
            "MINIMAX_BASE_URL",
            "MINIMAX_API_KEY",
        ),
        profile_from_env(
            "zai",
            "Z.AI",
            "openai-compat",
            "ZAI_MODEL",
            "ZAI_BASE_URL",
            "ZAI_API_KEY",
        ),
        profile_from_env(
            "openrouter",
            "OpenRouter",
            "openai-compat",
            "OPENROUTER_MODEL",
            "OPENROUTER_BASE_URL",
            "OPENROUTER_API_KEY",
        ),
    ]
    .into_iter()
    .flatten()
    .collect();

    for stored in read_stored_provider_profiles()? {
        if let Some(existing) = profiles.iter_mut().find(|profile| profile.id == stored.id) {
            *existing = stored;
        } else {
            profiles.push(stored);
        }
    }
    Ok(profiles)
}

pub(crate) fn resolve_runtime_provider_profile(
    profile_id: &str,
) -> Result<RuntimeProviderProfile, String> {
    runtime_provider_profiles()?
        .into_iter()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| format!("provider profile not found: {profile_id}"))
}

#[tauri::command]
pub fn runtime_provider_profile_upsert(
    req: RuntimeProviderProfileUpsertRequest,
) -> Result<RuntimeProviderProfile, String> {
    let id = req.id.trim();
    if id.is_empty() {
        return Err("provider profile id cannot be empty".into());
    }
    let provider = req.provider.trim();
    if !matches!(provider, "openai" | "anthropic" | "openai-compat") {
        return Err("provider profile provider is unsupported".into());
    }
    let profile = normalize_profile(RuntimeProviderProfile {
        id: id.to_string(),
        display_name: req.display_name.trim().to_string(),
        provider: provider.to_string(),
        model: req.model.trim().to_string(),
        base_url: req.base_url.trim().to_string(),
        secret_ref: req.secret_ref.unwrap_or_else(|| id.to_string()),
        auth_scheme: String::new(),
        allowed_host: String::new(),
        local_endpoint: req.local_endpoint.unwrap_or(false),
    })?;
    if profile.display_name.is_empty() || profile.model.is_empty() {
        return Err("provider profile displayName and model are required".into());
    }

    let mut profiles = read_stored_provider_profiles()?;
    let action = if let Some(existing) = profiles
        .iter_mut()
        .find(|existing| existing.id == profile.id)
    {
        *existing = profile.clone();
        "updated"
    } else {
        profiles.push(profile.clone());
        "created"
    };
    write_stored_provider_profiles(&profiles)?;
    append_provider_profile_audit(&profile, action)?;
    Ok(profile)
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
    fs::metadata(path)
        .map(|meta| meta.is_file() && meta.len() > 2)
        .unwrap_or(false)
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
