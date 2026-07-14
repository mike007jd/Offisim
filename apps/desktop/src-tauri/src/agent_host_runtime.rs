use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

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
    ResumePrestart {
        code: &'static str,
        message: String,
    },
    NativeSessionPrestart {
        code: &'static str,
        message: String,
    },
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
            Self::ResumePrestart { code, message } => (code.into(), message),
            Self::NativeSessionPrestart { code, message } => (code.into(), message),
            Self::Protocol(message) => ("protocol".into(), message),
            Self::Upstream { code, message } => {
                // Native-session codes authorize a destructive continuity reset
                // in the renderer. SDK/provider/sidecar errors are untrusted and
                // may choose arbitrary codes, so the entire internal namespace
                // is reserved to HostError::NativeSessionPrestart.
                let safe_code = code
                    .filter(|value| !value.trim().starts_with("native-session-"))
                    .unwrap_or_else(|| "upstream".into());
                (safe_code, message)
            }
        }
    }
}

#[cfg(test)]
mod host_error_tests {
    use super::*;

    const TEST_LANE: AgentHostLane = AgentHostLane {
        name: "test",
        execution_lane: "test",
        resource_path: "test",
        dev_script_name: "test",
        aborted_message: "aborted",
    };

    #[test]
    fn upstream_cannot_forge_reserved_native_session_codes() {
        for forged in [
            "native-session-missing",
            "native-session-invalid",
            "native-session-runtime-incompatible",
            "native-session-context-invalid",
            "native-session-reset-persistence",
        ] {
            let (code, message) = HostError::Upstream {
                code: Some(forged.into()),
                message: "provider supplied this code".into(),
            }
            .into_code_message(TEST_LANE);
            assert_eq!(code, "upstream");
            assert_eq!(message, "provider supplied this code");
        }
    }

    #[test]
    fn internal_native_session_prestart_code_remains_structured() {
        let (code, message) = HostError::NativeSessionPrestart {
            code: "native-session-missing",
            message: "durable resolver rejected the exact session".into(),
        }
        .into_code_message(TEST_LANE);
        assert_eq!(code, "native-session-missing");
        assert_eq!(message, "durable resolver rejected the exact session");
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
