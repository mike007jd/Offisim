//! Runtime secret storage for desktop.
//!
//! Credentials live in Rust-only plaintext files inside the app's local
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
const PROVIDER_SECRETS_DIR_NAME: &str = "runtime_provider_secrets";
const PROVIDER_PROFILES_FILE_NAME: &str = "runtime_provider_profiles.json";
const PROVIDER_PROFILE_AUDIT_FILE_NAME: &str = "runtime_provider_profile_audit.jsonl";

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

fn provider_secrets_dir() -> Result<PathBuf, String> {
    STORAGE_DIR
        .get()
        .map(|d| d.join(PROVIDER_SECRETS_DIR_NAME))
        .ok_or_else(|| "runtime_secrets storage not initialised".to_string())
}

fn sanitize_secret_ref(secret_ref: &str) -> Result<String, String> {
    let sanitized = secret_ref
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches(['.', '_'])
        .to_string();
    if sanitized.is_empty() {
        Err("secretRef cannot be empty".into())
    } else {
        Ok(sanitized)
    }
}

fn provider_secret_path(secret_ref: &str) -> Result<PathBuf, String> {
    Ok(provider_secrets_dir()?.join(format!("{}.txt", sanitize_secret_ref(secret_ref)?)))
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
    read_secret_file(&path)
}

fn read_secret_file(path: &Path) -> Result<Option<String>, String> {
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

fn read_keyed_secret(secret_ref: &str) -> Result<Option<String>, String> {
    let path = provider_secret_path(secret_ref)?;
    read_secret_file(&path)
}

fn any_keyed_secret_exists() -> Result<bool, String> {
    let dir = provider_secrets_dir()?;
    match fs::read_dir(&dir) {
        Ok(mut entries) => {
            Ok(entries.any(|entry| entry.map(|entry| entry.path().is_file()).unwrap_or(false)))
        }
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(false),
        Err(err) => Err(format!("read provider secret directory: {err}")),
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
    // E/I3: `env!("CARGO_MANIFEST_DIR")` bakes the original build host's
    // absolute path into the release binary, which both leaks the developer's
    // home directory layout and tries to read a `.env.local` from a path that
    // doesn't exist on the end user's machine. Only consult it on debug
    // builds, where the developer is the user.
    #[cfg(debug_assertions)]
    {
        roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    }

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
        "minimax" => Some("MINIMAX_API_KEY"),
        "zai" => Some("ZAI_API_KEY"),
        _ => None,
    };
    if let Some(env_name) = env_name {
        if let Some(secret) = env_or_local(env_name) {
            return Ok(Some(secret));
        }
    }
    read_keyed_secret(secret_ref)?.map_or_else(read_secret_raw, |secret| Ok(Some(secret)))
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
    #[serde(default)]
    has_credential: bool,
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
    profile.has_credential = read_provider_secret(Some(&profile.secret_ref))
        .ok()
        .flatten()
        .is_some();
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
    secret_ref: Option<&str>,
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
        secret_ref: secret_ref.unwrap_or(id).into(),
        auth_scheme: String::new(),
        allowed_host: String::new(),
        local_endpoint: false,
        has_credential: false,
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
            None,
        ),
        profile_from_env(
            "minimax-openai",
            "MiniMax Codex",
            "openai-compat",
            "MINIMAX_OPENAI_MODEL",
            "MINIMAX_OPENAI_BASE_URL",
            "MINIMAX_API_KEY",
            Some("minimax"),
        ),
        profile_from_env(
            "zai-anthropic",
            "Z.AI Claude Code",
            "anthropic",
            "ZAI_ANTHROPIC_MODEL",
            "ZAI_ANTHROPIC_BASE_URL",
            "ZAI_API_KEY",
            Some("zai"),
        ),
        profile_from_env(
            "zai",
            "Z.AI",
            "openai-compat",
            "ZAI_MODEL",
            "ZAI_BASE_URL",
            "ZAI_API_KEY",
            None,
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
        has_credential: false,
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
        has_secret: read_secret_raw()?.is_some() || any_keyed_secret_exists()?,
    })
}

#[tauri::command]
pub fn runtime_secret_set(secret: String, secret_ref: Option<String>) -> Result<(), String> {
    let trimmed = secret.trim();
    if trimmed.is_empty() {
        return Err("Secret cannot be empty".into());
    }
    let path = match secret_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(secret_ref) => provider_secret_path(secret_ref)?,
        None => secret_path()?,
    };
    write_secret_file(&path, trimmed)
}

fn write_secret_file(path: &Path, secret: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create secret directory: {e}"))?;
    }
    // Write atomically via a sibling tmp file + rename so a crashed write
    // cannot leave a half-written secret on disk.
    let tmp = path.with_extension("txt.tmp");
    {
        // Create the tmp file at mode 0600 BEFORE any secret bytes are written,
        // so the secret is never momentarily readable at the default umask
        // between write and chmod. The post-rename chmod stays as a belt-and-
        // suspenders re-assert.
        let mut opts = fs::OpenOptions::new();
        opts.create(true).truncate(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts
            .open(&tmp)
            .map_err(|e| format!("open tmp secret file: {e}"))?;
        f.write_all(secret.as_bytes())
            .map_err(|e| format!("write secret: {e}"))?;
        f.sync_all().map_err(|e| format!("fsync secret: {e}"))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("rename secret file: {e}"))?;
    set_file_mode_600(path).map_err(|e| format!("chmod 600 final: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn runtime_secret_clear(secret_ref: Option<String>) -> Result<(), String> {
    let path = match secret_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(secret_ref) => provider_secret_path(secret_ref)?,
        None => secret_path()?,
    };
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("delete secret file: {e}")),
    }
}
