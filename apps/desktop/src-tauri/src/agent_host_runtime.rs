use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use sqlx::Row;
use tauri::{path::BaseDirectory, AppHandle, Manager};

const TRUSTED_HOST_ENV_WHITELIST: &[&str] = &[
    "PATH",
    "HOME",
    "USER",
    "LANG",
    "TERM",
    "SHELL",
    "TMPDIR",
    "LC_ALL",
    "LC_CTYPE",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "REQUESTS_CA_BUNDLE",
];

const BUNDLED_NODE_RELATIVE_TO_RESOURCES: &str = "node/bin/node";

#[derive(Debug, Clone, Copy)]
pub(crate) struct AgentHostLane {
    pub(crate) name: &'static str,
    pub(crate) execution_lane: &'static str,
    pub(crate) resource_path: &'static str,
    pub(crate) dev_script_name: &'static str,
    pub(crate) aborted_message: &'static str,
}

pub(crate) struct SidecarAudit<'a> {
    pub(crate) request_id: &'a str,
    pub(crate) project_id: Option<&'a str>,
    pub(crate) employee_id: Option<&'a str>,
    pub(crate) provider_profile_id: Option<&'a str>,
    pub(crate) credential_recorded: bool,
}

#[derive(Debug)]
pub(crate) enum HostError {
    Aborted,
    HostUnavailable(String),
    Spawn(String),
    Request(String),
    Protocol(String),
    Upstream {
        code: Option<String>,
        message: String,
    },
}

impl HostError {
    pub(crate) fn into_code_message(self, lane: AgentHostLane) -> (String, String) {
        match self {
            Self::Aborted => ("aborted".into(), lane.aborted_message.into()),
            Self::HostUnavailable(message) => ("host-unavailable".into(), message),
            Self::Spawn(message) => ("spawn".into(), message),
            Self::Request(message) => ("request".into(), message),
            Self::Protocol(message) => ("protocol".into(), message),
            Self::Upstream { code, message } => {
                (code.unwrap_or_else(|| "upstream".into()), message)
            }
        }
    }
}

pub(crate) fn required_text<'a>(
    value: Option<&'a String>,
    field_name: &str,
    lane: AgentHostLane,
) -> Result<&'a str, HostError> {
    value
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            HostError::Request(format!(
                "{field_name} is required for trusted {} lane requests.",
                lane.name
            ))
        })
}

pub(crate) fn dev_workspace_root() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }

    if let Ok(path) = std::env::var("OFFISIM_WORKSPACE_ROOT") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .ok()
        .filter(|candidate| candidate.exists())
}

pub(crate) async fn project_workspace_root<R: tauri::Runtime>(
    app: &AppHandle<R>,
    company_id: Option<&str>,
    project_id: Option<&str>,
    lane: AgentHostLane,
) -> Result<PathBuf, HostError> {
    let company_id = company_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            HostError::Request(format!(
                "companyId is required for trusted {} lane workspace binding.",
                lane.name
            ))
        })?;
    let project_id = project_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            HostError::Request(format!(
                "projectId is required for trusted {} lane workspace binding.",
                lane.name
            ))
        })?;
    let pool = crate::local_db::get_offisim_pool(app)
        .map_err(|err| HostError::HostUnavailable(format!("open offisim.db failed: {err}")))?;
    let row = sqlx::query(
        r#"
        SELECT workspace_root
        FROM projects
        WHERE project_id = ?
          AND company_id = ?
          AND workspace_root IS NOT NULL
          AND trim(workspace_root) <> ''
        "#,
    )
    .bind(project_id)
    .bind(company_id)
    .fetch_optional(&pool)
    .await
    .map_err(|err| HostError::Request(format!("project workspace lookup failed: {err}")))?
    .ok_or_else(|| {
        HostError::Request(format!(
            "No workspace_root is bound for the trusted {} project.",
            lane.name
        ))
    })?;
    let raw: String = row
        .try_get("workspace_root")
        .map_err(|err| HostError::Request(format!("decode workspace_root: {err}")))?;
    resolve_host_workspace_root(raw)
}

fn resolve_host_workspace_root(raw: String) -> Result<PathBuf, HostError> {
    crate::local_paths::resolve_project_workspace_root_path(raw).map_err(HostError::Request)
}

pub(crate) fn default_host_cwd(workspace_root: &Path) -> PathBuf {
    workspace_root.to_path_buf()
}

pub(crate) fn resolved_request_cwd(
    requested: Option<&str>,
    workspace_root: &Path,
    lane: AgentHostLane,
) -> Result<PathBuf, HostError> {
    let root = workspace_root;
    let cwd = if let Some(cwd) = requested.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then_some(trimmed)
    }) {
        PathBuf::from(cwd)
    } else {
        default_host_cwd(root)
    };
    let canonical = cwd
        .canonicalize()
        .map_err(|err| HostError::Request(format!("Resolve trusted {} cwd: {err}", lane.name)))?;
    if !canonical.starts_with(root) {
        return Err(HostError::Request(format!(
            "Trusted {} cwd is outside the bound project workspace.",
            lane.name
        )));
    }
    Ok(canonical)
}

pub(crate) fn sidecar_script_path<R: tauri::Runtime>(
    app: &AppHandle<R>,
    workspace_root: Option<&PathBuf>,
    lane: AgentHostLane,
) -> Result<PathBuf, HostError> {
    let bundled_path = app
        .path()
        .resolve(lane.resource_path, BaseDirectory::Resource)
        .ok();
    if let Some(path) = bundled_path.as_ref().filter(|path| path.exists()) {
        return Ok(path.clone());
    }

    if let Some(workspace_root) = workspace_root {
        let dev_path = workspace_root.join(lane.dev_script_name);
        if dev_path.exists() {
            return Ok(dev_path);
        }
    }

    let bundled_hint = bundled_path
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "<unresolved resource path>".into());
    Err(HostError::HostUnavailable(format!(
        "Trusted {} lane host script not found in bundled resources ({bundled_hint}).",
        lane.name
    )))
}

pub(crate) fn base_env(
    env_whitelist: &[&str],
    workspace_root: Option<&PathBuf>,
) -> HashMap<String, String> {
    let mut env = HashMap::new();
    for key in env_whitelist {
        if let Ok(value) = std::env::var(key) {
            env.insert((*key).to_string(), value);
        }
    }

    if let Some(workspace_root) = workspace_root {
        env.insert(
            "OFFISIM_WORKSPACE_ROOT".into(),
            workspace_root.to_string_lossy().to_string(),
        );
    }

    env
}

pub(crate) fn trusted_host_env(
    workspace_root: Option<&PathBuf>,
    extra_allowlist: &[&str],
    executable_env_name: &str,
) -> HashMap<String, String> {
    let mut allowlist = TRUSTED_HOST_ENV_WHITELIST.to_vec();
    allowlist.extend_from_slice(extra_allowlist);
    let mut env = base_env(&allowlist, workspace_root);

    if let Ok(path) = std::env::var(executable_env_name) {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            env.insert(executable_env_name.into(), trimmed.to_string());
        }
    }

    env
}

pub(crate) fn append_sidecar_audit<R: tauri::Runtime>(
    app: &AppHandle<R>,
    lane: AgentHostLane,
    audit: SidecarAudit<'_>,
    cwd: &Path,
    status: &str,
) {
    let _ = app;
    let Ok(dir) = crate::local_paths::offisim_home_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("trusted-sidecar-audit.jsonl");
    let event = serde_json::json!({
        "status": status,
        "requestId": audit.request_id,
        "projectId": audit.project_id,
        "employeeId": audit.employee_id,
        "cwd": cwd.to_string_lossy(),
        "providerProfileId": audit.provider_profile_id,
        "executionLane": lane.execution_lane,
        "credentialBytesRecorded": audit.credential_recorded,
        "atUnixMs": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default(),
    });
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{event}");
    }
}

fn executable_path(candidate: PathBuf) -> Option<PathBuf> {
    candidate.is_file().then_some(candidate)
}

fn node_binary_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

fn path_node_executable() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(node_binary_name()))
        .find_map(executable_path)
}

fn common_node_executable() -> Option<PathBuf> {
    [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ]
    .into_iter()
    .map(PathBuf::from)
    .find_map(executable_path)
}

fn bundled_node_executable(script_path: &Path) -> Option<PathBuf> {
    script_path
        .parent()
        .map(|resources_dir| resources_dir.join(BUNDLED_NODE_RELATIVE_TO_RESOURCES))
        .and_then(executable_path)
}

pub(crate) fn resolve_node_executable(script_path: &Path) -> PathBuf {
    if let Some(path) = std::env::var_os("OFFISIM_NODE_EXECUTABLE")
        .map(PathBuf::from)
        .and_then(executable_path)
    {
        return path;
    }
    if let Some(path) = bundled_node_executable(script_path) {
        return path;
    }
    if let Some(path) = path_node_executable() {
        return path;
    }
    common_node_executable().unwrap_or_else(|| PathBuf::from(node_binary_name()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn host_workspace_root_rejects_overbroad_raw_path() {
        let err = resolve_host_workspace_root("/tmp".to_string()).unwrap_err();
        match err {
            HostError::Request(message) => {
                assert_eq!(message, crate::local_paths::OVERBROAD_WORKSPACE_ROOT_ERROR);
            }
            other => panic!("expected request error, got {other:?}"),
        }
    }

    #[test]
    fn bundled_node_is_resolved_next_to_bundled_pi_host() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("offisim-node-runtime-{suffix}"));
        let node = root.join(BUNDLED_NODE_RELATIVE_TO_RESOURCES);
        std::fs::create_dir_all(node.parent().expect("node parent")).expect("create node dir");
        std::fs::write(&node, b"node").expect("write node marker");

        let script = root.join("pi-agent-host.mjs");
        assert_eq!(bundled_node_executable(&script), Some(node));

        let _ = std::fs::remove_dir_all(root);
    }
}
