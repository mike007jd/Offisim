use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{path::BaseDirectory, AppHandle, Manager};

pub(crate) const TRUSTED_HOST_ENV_WHITELIST: &[&str] = &[
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

macro_rules! agent_host_commands {
    (codex) => {
        #[tauri::command]
        pub async fn codex_agent_execute(
            app: tauri::AppHandle,
            req: super::types::CodexAgentExecuteRequest,
            on_event: tauri::ipc::Channel<super::types::CodexAgentHostEvent>,
        ) -> Result<super::types::CodexAgentHostResponse, String> {
            super::manager::execute_impl(app, req, on_event, false).await
        }

        #[tauri::command]
        pub async fn codex_agent_resume(
            app: tauri::AppHandle,
            req: super::types::CodexAgentExecuteRequest,
            on_event: tauri::ipc::Channel<super::types::CodexAgentHostEvent>,
        ) -> Result<super::types::CodexAgentHostResponse, String> {
            super::manager::execute_impl(app, req, on_event, true).await
        }

        #[tauri::command]
        pub async fn codex_agent_enhance(
            app: tauri::AppHandle,
            req: super::types::CodexAgentEnhanceRequest,
            on_event: tauri::ipc::Channel<super::types::CodexAgentHostEvent>,
        ) -> Result<super::types::CodexAgentHostResponse, String> {
            super::manager::enhance_impl(app, req, on_event).await
        }

        #[tauri::command]
        pub async fn codex_agent_abort(
            app: tauri::AppHandle,
            request_id: String,
        ) -> Result<(), String> {
            super::manager::abort_impl(app, request_id).await
        }

        #[tauri::command]
        pub async fn codex_agent_answer(
            app: tauri::AppHandle,
            request_id: String,
            id: String,
            confirmed: Option<bool>,
            value: Option<String>,
            cancelled: Option<bool>,
        ) -> Result<(), String> {
            super::manager::answer_impl(app, request_id, id, confirmed, value, cancelled).await
        }

        #[tauri::command]
        pub fn codex_agent_stream_snapshot(
            app: tauri::AppHandle,
            request_id: String,
        ) -> Result<Option<super::types::CodexRunStreamSnapshot>, String> {
            super::manager::stream_snapshot_impl(app, request_id)
        }

        #[tauri::command]
        pub fn codex_agent_release_stream(
            app: tauri::AppHandle,
            request_id: String,
        ) -> Result<(), String> {
            super::manager::release_stream_impl(app, request_id)
        }

        #[tauri::command]
        pub fn codex_agent_reattach(
            app: tauri::AppHandle,
            request_id: String,
            after_cursor: Option<u64>,
            on_event: tauri::ipc::Channel<super::types::CodexAgentHostEvent>,
        ) -> Result<super::types::CodexRunStreamSnapshot, String> {
            super::manager::reattach_impl(app, request_id, after_cursor, on_event)
        }

        #[tauri::command]
        pub async fn codex_agent_status(
            app: tauri::AppHandle,
        ) -> Result<super::types::CodexAgentStatusResponse, String> {
            super::manager::status_impl(app, true).await
        }
    };
    (claude) => {
        #[tauri::command]
        pub async fn claude_agent_execute(
            app: tauri::AppHandle,
            req: super::ClaudeAgentExecuteRequest,
            on_event: tauri::ipc::Channel<crate::pi_agent_host::PiAgentHostEvent>,
        ) -> Result<crate::pi_agent_host::PiAgentHostResponse, String> {
            super::execute_impl(app, req, on_event, false).await
        }

        #[tauri::command]
        pub async fn claude_agent_resume(
            app: tauri::AppHandle,
            req: super::ClaudeAgentExecuteRequest,
            on_event: tauri::ipc::Channel<crate::pi_agent_host::PiAgentHostEvent>,
        ) -> Result<crate::pi_agent_host::PiAgentHostResponse, String> {
            super::execute_impl(app, req, on_event, true).await
        }

        #[tauri::command]
        pub async fn claude_agent_enhance(
            app: tauri::AppHandle,
            req: super::ClaudeAgentEnhanceRequest,
            on_event: tauri::ipc::Channel<crate::pi_agent_host::PiAgentHostEvent>,
        ) -> Result<crate::pi_agent_host::PiAgentHostResponse, String> {
            super::enhance_impl(app, req, on_event).await
        }

        #[tauri::command]
        pub fn claude_agent_abort(request_id: String) -> Result<(), String> {
            super::abort_impl(request_id)
        }

        #[tauri::command]
        pub async fn claude_agent_answer(
            request_id: String,
            id: String,
            confirmed: Option<bool>,
            value: Option<String>,
            cancelled: Option<bool>,
        ) -> Result<(), String> {
            crate::pi_agent_host::bridge::ui_response_impl(
                request_id, id, confirmed, value, cancelled,
            )
            .await
        }

        #[tauri::command]
        pub fn claude_agent_stream_snapshot(
            request_id: String,
        ) -> Result<Option<crate::pi_agent_host::PiRunStreamSnapshot>, String> {
            super::stream_snapshot_impl(request_id)
        }

        #[tauri::command]
        pub fn claude_agent_release_stream(request_id: String) -> Result<(), String> {
            super::release_stream_impl(request_id)
        }

        #[tauri::command]
        pub fn claude_agent_reattach(
            app: tauri::AppHandle,
            request_id: String,
            after_cursor: Option<u64>,
            on_event: tauri::ipc::Channel<crate::pi_agent_host::PiAgentHostEvent>,
        ) -> Result<crate::pi_agent_host::PiRunStreamSnapshot, String> {
            super::reattach_impl(app, request_id, after_cursor, on_event)
        }

        #[tauri::command]
        pub async fn claude_agent_status(
            app: tauri::AppHandle,
        ) -> Result<super::ClaudeAgentStatusResponse, String> {
            super::status_impl(app, true).await
        }
    };
}

pub(crate) use agent_host_commands;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentHostCliStatusResponse {
    pub(crate) engine_id: String,
    pub(crate) display_name: String,
    pub(crate) state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) status_reason: Option<String>,
    pub(crate) login_command: String,
    pub(crate) docs_url: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub(crate) source_url: String,
    pub(crate) checked_at: String,
    pub(crate) capabilities: serde_json::Value,
}

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

fn cli_binary_is_executable(candidate: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(candidate) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn find_codex_binary() -> Option<PathBuf> {
    if let Some(candidate) = std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|directory| directory.join("codex"))
            .find(|candidate| cli_binary_is_executable(candidate))
    }) {
        return std::fs::canonicalize(&candidate).ok().or(Some(candidate));
    }

    // Finder-launched macOS apps do not inherit the user's interactive PATH.
    // Ask the user's configured shell for the command path without evaluating
    // any renderer-provided text, then still require a real executable file.
    let shell = std::env::var_os("SHELL")?;
    let output = std::process::Command::new(shell)
        .args(["-lic", "command -v codex"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .map(str::trim)
        .filter(|value| value.starts_with('/'))
        .map(PathBuf::from)
        .find(|candidate| cli_binary_is_executable(candidate))
        .and_then(|candidate| std::fs::canonicalize(&candidate).ok().or(Some(candidate)))
}

pub(crate) fn codex_binary_path() -> Result<PathBuf, String> {
    find_codex_binary().ok_or_else(|| "Codex CLI is not installed or is not on PATH.".into())
}

fn first_nonempty_line(bytes: &[u8]) -> Option<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

pub(crate) async fn inspect_codex_cli(
    checked_at: String,
    capabilities: serde_json::Value,
) -> AgentHostCliStatusResponse {
    let Some(binary) = find_codex_binary() else {
        return AgentHostCliStatusResponse {
            engine_id: "codex".into(),
            display_name: "Codex CLI".into(),
            state: "not-installed".into(),
            version: None,
            status_reason: Some("Install Codex CLI to run Codex tasks.".into()),
            login_command: "codex login".into(),
            docs_url: "https://developers.openai.com/codex/auth".into(),
            source_url: String::new(),
            checked_at,
            capabilities,
        };
    };

    let version_output = tokio::process::Command::new(&binary)
        .arg("--version")
        .output()
        .await;
    let version = match version_output {
        Ok(output) if output.status.success() => first_nonempty_line(&output.stdout),
        _ => None,
    };
    if version.is_none() {
        return AgentHostCliStatusResponse {
            engine_id: "codex".into(),
            display_name: "Codex CLI".into(),
            state: "unavailable".into(),
            version: None,
            status_reason: Some("Codex CLI is installed but could not report its version.".into()),
            login_command: "codex login".into(),
            docs_url: "https://developers.openai.com/codex/auth".into(),
            source_url: String::new(),
            checked_at,
            capabilities,
        };
    }

    let login_status = tokio::process::Command::new(&binary)
        .args(["login", "status"])
        .output()
        .await;
    let (state, status_reason) = match login_status {
        Ok(output) if output.status.success() => ("ready", None),
        Ok(_) => (
            "not-signed-in",
            Some("Sign in with `codex login`; credentials remain managed by Codex CLI.".into()),
        ),
        Err(_) => (
            "unavailable",
            Some("Codex CLI login status could not be checked.".into()),
        ),
    };
    AgentHostCliStatusResponse {
        engine_id: "codex".into(),
        display_name: "Codex CLI".into(),
        state: state.into(),
        version,
        status_reason,
        login_command: "codex login".into(),
        docs_url: "https://developers.openai.com/codex/auth".into(),
        source_url: String::new(),
        checked_at,
        capabilities,
    }
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
    use serde_json::json;
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

    #[test]
    fn cli_status_contract_preserves_engine_specific_source_projection() {
        let codex = AgentHostCliStatusResponse {
            engine_id: "codex".into(),
            display_name: "Codex CLI".into(),
            state: "ready".into(),
            version: Some("codex-cli 0.144.4".into()),
            status_reason: None,
            login_command: "codex login".into(),
            docs_url: "https://developers.openai.com/codex/auth".into(),
            source_url: String::new(),
            checked_at: "2026-07-19T00:00:00Z".into(),
            capabilities: json!({"stop": true}),
        };
        let codex_json = serde_json::to_value(codex).expect("serialize Codex CLI status");
        assert_eq!(codex_json["engineId"], "codex");
        assert!(codex_json.get("sourceUrl").is_none());

        let claude: AgentHostCliStatusResponse = serde_json::from_value(json!({
            "engineId": "claude",
            "displayName": "Claude",
            "state": "ready",
            "version": "2.1.211 (Claude Code)",
            "loginCommand": "claude auth login",
            "docsUrl": "https://code.claude.com/docs/en/authentication",
            "sourceUrl": "https://code.claude.com/docs/en/cli-usage",
            "checkedAt": "2026-07-19T00:00:00.000Z",
            "capabilities": {"stop": true}
        }))
        .expect("deserialize Claude sidecar status");
        assert_eq!(
            claude.source_url,
            "https://code.claude.com/docs/en/cli-usage"
        );
    }

    #[test]
    fn cli_status_contract_keeps_claude_source_required_and_rejects_unknown_fields() {
        let without_source = json!({
            "engineId": "claude",
            "displayName": "Claude",
            "state": "ready",
            "loginCommand": "claude auth login",
            "docsUrl": "https://code.claude.com/docs/en/authentication",
            "checkedAt": "2026-07-19T00:00:00.000Z",
            "capabilities": {"stop": true}
        });
        assert!(serde_json::from_value::<AgentHostCliStatusResponse>(without_source).is_err());

        let with_unknown = json!({
            "engineId": "claude",
            "displayName": "Claude",
            "state": "ready",
            "loginCommand": "claude auth login",
            "docsUrl": "https://code.claude.com/docs/en/authentication",
            "sourceUrl": "https://code.claude.com/docs/en/cli-usage",
            "checkedAt": "2026-07-19T00:00:00.000Z",
            "capabilities": {"stop": true},
            "accounts": []
        });
        assert!(serde_json::from_value::<AgentHostCliStatusResponse>(with_unknown).is_err());
    }
}
