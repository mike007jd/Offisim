use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Wry};

const REGISTRY_FILE: &str = "mcp-servers.json";
const USER_CONFIG_SOURCE: &str = "user-config";
const INSTALLED_ASSET_SOURCE: &str = "installed-asset";
const DEVELOPER_RUNTIME_SOURCE: &str = "developer-runtime";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum McpTransport {
    Stdio,
    Sse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredMcpServer {
    pub server_id: String,
    pub name: String,
    pub transport: McpTransport,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub url: Option<String>,
    pub source: Option<String>,
    pub source_package_id: Option<String>,
    pub source_package_version: Option<String>,
    pub source_manifest_hash: Option<String>,
    pub approval_id: Option<String>,
    pub risk_class: Option<String>,
    pub command_fingerprint: Option<String>,
    #[serde(default)]
    pub requested_tools: Vec<String>,
    pub request_surface: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerRegistrationInput {
    pub name: String,
    pub transport: McpTransport,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub url: Option<String>,
    pub source: Option<String>,
    pub source_package_id: Option<String>,
    pub source_package_version: Option<String>,
    pub source_manifest_hash: Option<String>,
    pub approval_id: Option<String>,
    pub risk_class: Option<String>,
    #[serde(default)]
    pub requested_tools: Vec<String>,
    pub request_surface: Option<String>,
}

pub struct RegisteredServerStore {
    file_path: PathBuf,
    servers: Mutex<HashMap<String, RegisteredMcpServer>>,
}

impl RegisteredServerStore {
    pub fn load(app: &AppHandle<Wry>) -> Result<Self, String> {
        let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
        let file_path = app_data_dir.join(REGISTRY_FILE);

        let servers = load_registry_entries(&file_path)?;

        Ok(Self {
            file_path,
            servers: Mutex::new(servers),
        })
    }

    pub fn list(&self) -> Result<Vec<RegisteredMcpServer>, String> {
        let servers = self
            .servers
            .lock()
            .map_err(|_| "failed to lock MCP registry".to_string())?;
        let mut values = servers.values().cloned().collect::<Vec<_>>();
        values.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(values)
    }

    pub fn get(&self, server_id: &str) -> Result<Option<RegisteredMcpServer>, String> {
        let servers = self
            .servers
            .lock()
            .map_err(|_| "failed to lock MCP registry".to_string())?;
        Ok(servers.get(server_id).cloned())
    }

    pub fn register(
        &self,
        input: McpServerRegistrationInput,
    ) -> Result<RegisteredMcpServer, String> {
        self.validate(&input)?;

        let mut servers = self
            .servers
            .lock()
            .map_err(|_| "failed to lock MCP registry".to_string())?;
        if servers.values().any(|existing| existing.name == input.name) {
            return Err(format!("MCP server '{}' already exists", input.name));
        }

        let command = input
            .command
            .as_ref()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        let args = input
            .args
            .into_iter()
            .map(|arg| arg.trim().to_string())
            .filter(|arg| !arg.is_empty())
            .collect::<Vec<_>>();
        let source = input
            .source
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let source_package_id = normalize_optional(input.source_package_id.as_deref());
        let source_package_version = normalize_optional(input.source_package_version.as_deref());
        let source_manifest_hash = normalize_optional(input.source_manifest_hash.as_deref());
        let command_fingerprint = match input.transport {
            McpTransport::Stdio => Some(command_fingerprint(
                command.as_deref().unwrap_or_default(),
                &args,
                source.as_deref().unwrap_or("unknown"),
                source_package_id.as_deref(),
                source_package_version.as_deref(),
                source_manifest_hash.as_deref(),
            )),
            McpTransport::Sse => None,
        };

        let server = RegisteredMcpServer {
            server_id: generate_server_id(&input.name),
            name: input.name.trim().to_string(),
            transport: input.transport,
            command,
            args,
            url: input
                .url
                .as_ref()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
            source,
            source_package_id,
            source_package_version,
            source_manifest_hash,
            approval_id: input
                .approval_id
                .as_ref()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            risk_class: input
                .risk_class
                .as_ref()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .or_else(|| Some("high".into())),
            command_fingerprint,
            requested_tools: input.requested_tools,
            request_surface: normalize_optional(input.request_surface.as_deref()),
        };

        servers.insert(server.server_id.clone(), server.clone());
        self.persist_locked(&servers)?;
        Ok(server)
    }

    pub fn unregister(&self, server_id: &str) -> Result<(), String> {
        let mut servers = self
            .servers
            .lock()
            .map_err(|_| "failed to lock MCP registry".to_string())?;
        servers.remove(server_id);
        self.persist_locked(&servers)
    }

    fn validate(&self, input: &McpServerRegistrationInput) -> Result<(), String> {
        if input.name.trim().is_empty() {
            return Err("Server name is required".into());
        }

        match input.transport {
            McpTransport::Stdio => {
                if input
                    .command
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or_default()
                    .is_empty()
                {
                    return Err("Command is required for stdio MCP servers".into());
                }
                let source = input.source.as_deref().map(str::trim).unwrap_or_default();
                if expected_stdio_request_surface(source).is_none() {
                    return Err("stdio MCP source must be user-config, installed-asset, or developer-runtime".into());
                }
                let surface = input
                    .request_surface
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or_default();
                validate_stdio_request_surface(source, surface, "registration")?;
                if source == INSTALLED_ASSET_SOURCE
                    && (input
                        .source_package_id
                        .as_deref()
                        .map(str::trim)
                        .unwrap_or_default()
                        .is_empty()
                        || input
                            .source_package_version
                            .as_deref()
                            .map(str::trim)
                            .unwrap_or_default()
                            .is_empty()
                        || input
                            .source_manifest_hash
                            .as_deref()
                            .map(str::trim)
                            .unwrap_or_default()
                            .is_empty())
                {
                    return Err("installed-asset stdio MCP registration requires source package id, version, and manifest hash".into());
                }
                if input
                    .approval_id
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or_default()
                    .is_empty()
                {
                    return Err("approvalId is required for stdio MCP registration".into());
                }
            }
            McpTransport::Sse => {
                if input
                    .url
                    .as_deref()
                    .map(str::trim)
                    .unwrap_or_default()
                    .is_empty()
                {
                    return Err("URL is required for SSE MCP servers".into());
                }
            }
        }

        Ok(())
    }

    fn persist_locked(&self, servers: &HashMap<String, RegisteredMcpServer>) -> Result<(), String> {
        let mut values = servers.values().cloned().collect::<Vec<_>>();
        values.sort_by(|a, b| a.name.cmp(&b.name));
        let raw = serde_json::to_string_pretty(&values).map_err(|e| e.to_string())?;
        let tmp_path = self.file_path.with_extension("json.tmp");
        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&tmp_path)
            .map_err(|e| e.to_string())?;
        file.write_all(raw.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&tmp_path, &self.file_path).map_err(|e| e.to_string())?;
        if let Some(parent) = self.file_path.parent() {
            if let Ok(dir) = fs::File::open(parent) {
                let _ = dir.sync_all();
            }
        }
        Ok(())
    }
}

fn normalize_optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub(super) fn expected_stdio_request_surface(source: &str) -> Option<&'static str> {
    match source {
        USER_CONFIG_SOURCE => Some("settings"),
        INSTALLED_ASSET_SOURCE => Some("installed-asset-runtime"),
        DEVELOPER_RUNTIME_SOURCE => Some("developer-runtime"),
        _ => None,
    }
}

pub(super) fn validate_stdio_request_surface(
    source: &str,
    actual_surface: &str,
    action: &str,
) -> Result<(), String> {
    if let Some(expected_surface) = expected_stdio_request_surface(source) {
        if actual_surface != expected_surface {
            return Err(format!(
                "{source} stdio MCP {action} must originate from {expected_surface}"
            ));
        }
    }
    Ok(())
}

fn command_fingerprint(
    command: &str,
    args: &[String],
    source: &str,
    source_package_id: Option<&str>,
    source_package_version: Option<&str>,
    source_manifest_hash: Option<&str>,
) -> String {
    let canonical_path = std::fs::canonicalize(command).ok();
    let canonical_command = canonical_path
        .as_ref()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| command.to_string());
    let mut hasher = Sha256::new();
    hasher.update(canonical_command.as_bytes());
    hasher.update(b"\0");
    for arg in args {
        hasher.update(arg.as_bytes());
        hasher.update(b"\0");
    }
    hasher.update(source.as_bytes());
    hasher.update(b"\0");
    hasher.update(source_package_id.unwrap_or_default().as_bytes());
    hasher.update(b"\0");
    hasher.update(source_package_version.unwrap_or_default().as_bytes());
    hasher.update(b"\0");
    hasher.update(source_manifest_hash.unwrap_or_default().as_bytes());
    // For user-config / developer-runtime, also bind the target binary's
    // identity (size + mtime) so a post-approval binary swap at the same path
    // invalidates the fingerprint. installed-asset is already content-pinned by
    // source_manifest_hash. A bare PATH-resolved command name has no canonical
    // path to stat, so the path/args/source binding remains the floor there.
    if matches!(source, "user-config" | "developer-runtime") {
        if let Some(path) = canonical_path.as_ref() {
            if let Ok(meta) = std::fs::metadata(path) {
                hasher.update(b"\0bin\0");
                hasher.update(meta.len().to_le_bytes());
                if let Ok(modified) = meta.modified() {
                    if let Ok(dur) = modified.duration_since(std::time::UNIX_EPOCH) {
                        hasher.update(dur.as_nanos().to_le_bytes());
                    }
                }
            }
        }
    }
    hex::encode(hasher.finalize())
}

fn load_registry_entries(file_path: &Path) -> Result<HashMap<String, RegisteredMcpServer>, String> {
    if !file_path.exists() {
        return Ok(HashMap::new());
    }

    let raw = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    match serde_json::from_str::<Vec<RegisteredMcpServer>>(&raw) {
        Ok(entries) => Ok(entries
            .into_iter()
            .map(|server| (server.server_id.clone(), server))
            .collect()),
        Err(err) => {
            let backup_path = malformed_registry_backup_path(file_path);
            eprintln!(
                "[mcp_bridge] ignoring malformed MCP registry at {}: {}; preserving copy at {}",
                file_path.display(),
                err,
                backup_path.display()
            );
            if let Err(rename_err) = fs::rename(file_path, &backup_path) {
                eprintln!(
                    "[mcp_bridge] failed to preserve malformed MCP registry {}: {}",
                    file_path.display(),
                    rename_err
                );
            }
            Ok(HashMap::new())
        }
    }
}

fn malformed_registry_backup_path(file_path: &Path) -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let file_name = file_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(REGISTRY_FILE);
    file_path.with_file_name(format!("{file_name}.bad.{stamp}"))
}

fn generate_server_id(name: &str) -> String {
    let slug = name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let suffix = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(8)
        .map(char::from)
        .collect::<String>()
        .to_ascii_lowercase();
    if slug.is_empty() {
        format!("mcp-{suffix}")
    } else {
        format!("mcp-{slug}-{suffix}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store() -> RegisteredServerStore {
        RegisteredServerStore {
            file_path: PathBuf::from("test-mcp-servers.json"),
            servers: Mutex::new(HashMap::new()),
        }
    }

    fn stdio_input(source: &str, surface: &str) -> McpServerRegistrationInput {
        McpServerRegistrationInput {
            name: "Test".into(),
            transport: McpTransport::Stdio,
            command: Some("node".into()),
            args: vec!["server.mjs".into()],
            url: None,
            source: Some(source.into()),
            source_package_id: None,
            source_package_version: None,
            source_manifest_hash: None,
            approval_id: Some("approval-1".into()),
            risk_class: Some("high".into()),
            requested_tools: Vec::new(),
            request_surface: Some(surface.into()),
        }
    }

    #[test]
    fn command_args_change_invalidates_fingerprint() {
        let first = command_fingerprint(
            "node",
            &[String::from("server-a.mjs")],
            "user-config",
            None,
            None,
            None,
        );
        let second = command_fingerprint(
            "node",
            &[String::from("server-b.mjs")],
            "user-config",
            None,
            None,
            None,
        );

        assert_ne!(first, second);
    }

    #[test]
    fn package_version_or_manifest_change_invalidates_fingerprint() {
        let first = command_fingerprint(
            "node",
            &[String::from("server.mjs")],
            "installed-asset",
            Some("pkg.customer-research"),
            Some("1.0.0"),
            Some("manifest-a"),
        );
        let version_changed = command_fingerprint(
            "node",
            &[String::from("server.mjs")],
            "installed-asset",
            Some("pkg.customer-research"),
            Some("1.0.1"),
            Some("manifest-a"),
        );
        let manifest_changed = command_fingerprint(
            "node",
            &[String::from("server.mjs")],
            "installed-asset",
            Some("pkg.customer-research"),
            Some("1.0.0"),
            Some("manifest-b"),
        );

        assert_ne!(first, version_changed);
        assert_ne!(first, manifest_changed);
    }

    #[test]
    fn user_config_stdio_must_originate_from_settings() {
        let store = test_store();
        assert!(store
            .validate(&stdio_input("user-config", "settings"))
            .is_ok());
        assert!(store
            .validate(&stdio_input("user-config", "marketplace-detail"))
            .is_err());
    }

    #[test]
    fn installed_asset_stdio_requires_source_package_metadata() {
        let store = test_store();
        let mut input = stdio_input("installed-asset", "installed-asset-runtime");
        assert!(store.validate(&input).is_err());

        input.source_package_id = Some("pkg.customer-research".into());
        input.source_package_version = Some("1.0.0".into());
        input.source_manifest_hash = Some("manifest-a".into());
        assert!(store.validate(&input).is_ok());
    }
}
