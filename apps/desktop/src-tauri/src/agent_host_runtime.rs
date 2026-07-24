use std::collections::HashMap;
use std::ffi::OsString;
use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom, Write};
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) run_options: Option<serde_json::Value>,
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

pub(crate) struct TrustedCodexExecutable {
    #[cfg(any(test, not(unix)))]
    canonical_path: PathBuf,
    #[cfg(unix)]
    file: std::fs::File,
    #[cfg(unix)]
    append_opened_file_arg: bool,
    #[cfg(unix)]
    _materialized_executable: Option<tempfile::TempDir>,
    launcher_path: PathBuf,
    launcher_args: Vec<OsString>,
}

impl TrustedCodexExecutable {
    pub(crate) fn command_path(&self) -> &Path {
        &self.launcher_path
    }

    pub(crate) fn command_prefix_args(&self) -> Vec<OsString> {
        let mut args = self.launcher_args.clone();
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            if self.append_opened_file_arg {
                args.push(OsString::from(format!("/dev/fd/{}", self.file.as_raw_fd())));
            }
        }
        args
    }

    #[cfg(test)]
    fn canonical_path(&self) -> &Path {
        &self.canonical_path
    }
}

#[cfg(unix)]
fn open_executable_without_symlinks(path: &Path) -> Option<std::fs::File> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::PermissionsExt;

    let mut components = path.components().peekable();
    let mut directory = std::fs::File::open("/").ok()?;
    while let Some(component) = components.next() {
        let name = match component {
            std::path::Component::RootDir => continue,
            std::path::Component::Normal(name) => name,
            _ => return None,
        };
        let name = CString::new(name.as_bytes()).ok()?;
        let is_leaf = components.peek().is_none();
        let flags = if is_leaf {
            // Intentionally omit O_CLOEXEC: /dev/fd/<n> must remain readable
            // when a script executable hands control to its shebang interpreter.
            libc::O_RDONLY | libc::O_NOFOLLOW
        } else {
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC
        };
        let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            return None;
        }
        let opened = std::fs::File::from(unsafe { OwnedFd::from_raw_fd(fd) });
        if is_leaf {
            let metadata = opened.metadata().ok()?;
            if !metadata.is_file() || metadata.permissions().mode() & 0o111 == 0 {
                return None;
            }
            return Some(opened);
        }
        directory = opened;
    }
    None
}

fn trusted_codex_candidate(
    candidate: &Path,
    trusted_roots: &[PathBuf],
    forbidden_root: Option<&Path>,
) -> Option<TrustedCodexExecutable> {
    if !candidate.is_absolute() {
        return None;
    }
    let canonical = std::fs::canonicalize(candidate).ok()?;
    let trusted = trusted_roots.iter().any(|root| {
        std::fs::canonicalize(root)
            .ok()
            .is_some_and(|root| canonical.starts_with(root))
    });
    if !trusted {
        return None;
    }
    if forbidden_root
        .and_then(|root| std::fs::canonicalize(root).ok())
        .is_some_and(|root| canonical.starts_with(root))
    {
        return None;
    }
    #[cfg(unix)]
    {
        if let Some(native) =
            trusted_codex_native_executable(&canonical, trusted_roots, forbidden_root)
        {
            return Some(native);
        }
        let file = open_executable_without_symlinks(&canonical)?;
        let (launcher_path, launcher_args) =
            trusted_script_launcher(&canonical, &file, trusted_roots)?;
        Some(TrustedCodexExecutable {
            #[cfg(test)]
            canonical_path: canonical,
            file,
            append_opened_file_arg: true,
            _materialized_executable: None,
            launcher_path,
            launcher_args,
        })
    }
    #[cfg(not(unix))]
    {
        let _ = canonical;
        None
    }
}

#[cfg(unix)]
fn codex_native_layout() -> Option<(&'static str, &'static str)> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some(("codex-darwin-arm64", "aarch64-apple-darwin")),
        ("macos", "x86_64") => Some(("codex-darwin-x64", "x86_64-apple-darwin")),
        ("linux", "aarch64") => Some(("codex-linux-arm64", "aarch64-unknown-linux-musl")),
        ("linux", "x86_64") => Some(("codex-linux-x64", "x86_64-unknown-linux-musl")),
        _ => None,
    }
}

#[cfg(unix)]
fn materialize_opened_executable(file: &std::fs::File) -> Option<(PathBuf, tempfile::TempDir)> {
    // Codex's ESM launcher cannot run through `/dev/fd`: changing import.meta.url
    // prevents it from resolving the platform package. The native Mach-O also
    // cannot execute directly from that descriptor, so keep the verified inode
    // pinned and materialize its bytes into a private, lifetime-bound directory.
    #[cfg(target_os = "macos")]
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::PermissionsExt;

    let materialized_root = tempfile::Builder::new()
        .prefix("offisim-codex-")
        .tempdir()
        .ok()?;
    let materialized_path = materialized_root.path().join("codex");

    #[cfg(target_os = "macos")]
    {
        let directory = std::fs::File::open(materialized_root.path()).ok()?;
        let name = std::ffi::CString::new("codex").ok()?;
        let result = unsafe {
            libc::fclonefileat(file.as_raw_fd(), directory.as_raw_fd(), name.as_ptr(), 0)
        };
        if result == 0 {
            let mut permissions = std::fs::metadata(&materialized_path).ok()?.permissions();
            permissions.set_mode(0o700);
            std::fs::set_permissions(&materialized_path, permissions).ok()?;
            return Some((materialized_path, materialized_root));
        }
    }

    let fallback_path = materialized_root.path().join("codex-copy");
    let mut source = file.try_clone().ok()?;
    source.seek(SeekFrom::Start(0)).ok()?;
    let mut materialized = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&fallback_path)
        .ok()?;
    std::io::copy(&mut source, &mut materialized).ok()?;
    materialized.flush().ok()?;
    let mut permissions = materialized.metadata().ok()?.permissions();
    permissions.set_mode(0o700);
    materialized.set_permissions(permissions).ok()?;
    materialized.sync_all().ok()?;
    Some((fallback_path, materialized_root))
}

#[cfg(unix)]
fn trusted_codex_native_executable(
    script: &Path,
    trusted_roots: &[PathBuf],
    forbidden_root: Option<&Path>,
) -> Option<TrustedCodexExecutable> {
    if script.file_name()? != "codex.js" {
        return None;
    }
    let package_root = script.parent()?.parent()?;
    let (platform_package, target_triple) = codex_native_layout()?;
    let vendor_tail = PathBuf::from("vendor")
        .join(target_triple)
        .join("bin/codex");
    let direct_vendor = package_root.join(&vendor_tail);
    let resolved_packages = package_root.ancestors().map(|ancestor| {
        ancestor
            .join("node_modules/@openai")
            .join(platform_package)
            .join(&vendor_tail)
    });

    for candidate in std::iter::once(direct_vendor).chain(resolved_packages) {
        let canonical = match std::fs::canonicalize(candidate) {
            Ok(canonical) => canonical,
            Err(_) => continue,
        };
        let trusted = trusted_roots.iter().any(|root| {
            std::fs::canonicalize(root)
                .ok()
                .is_some_and(|root| canonical.starts_with(root))
        });
        if !trusted
            || forbidden_root
                .and_then(|root| std::fs::canonicalize(root).ok())
                .is_some_and(|root| canonical.starts_with(root))
        {
            continue;
        }
        let Some(file) = open_executable_without_symlinks(&canonical) else {
            continue;
        };
        let Some((launcher_path, materialized)) = materialize_opened_executable(&file) else {
            continue;
        };
        return Some(TrustedCodexExecutable {
            #[cfg(test)]
            canonical_path: canonical,
            file,
            append_opened_file_arg: false,
            _materialized_executable: Some(materialized),
            launcher_path,
            launcher_args: Vec::new(),
        });
    }
    None
}

#[cfg(unix)]
fn trusted_launcher_path(candidate: &Path, trusted_roots: &[PathBuf]) -> Option<PathBuf> {
    let canonical = std::fs::canonicalize(candidate).ok()?;
    let inside_root = trusted_roots.iter().any(|root| {
        std::fs::canonicalize(root)
            .ok()
            .is_some_and(|root| canonical.starts_with(root))
    });
    (inside_root && cli_binary_is_executable(&canonical)).then_some(canonical)
}

#[cfg(unix)]
fn trusted_node_launcher(script: &Path, trusted_roots: &[PathBuf]) -> Option<PathBuf> {
    for ancestor in script.ancestors() {
        for candidate in [ancestor.join("bin/node"), ancestor.join("node")] {
            if let Some(node) = trusted_launcher_path(&candidate, trusted_roots) {
                return Some(node);
            }
        }
    }
    let home = dirs::home_dir().and_then(|home| home.canonicalize().ok());
    [
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from("/usr/bin/node"),
    ]
    .into_iter()
    .chain(home.into_iter().flat_map(|home| {
        [
            home.join(".local/bin/node"),
            home.join(".bun/bin/node"),
            home.join(".volta/bin/node"),
        ]
    }))
    .find_map(|candidate| trusted_launcher_path(&candidate, trusted_roots))
}

#[cfg(unix)]
fn trusted_script_launcher(
    script: &Path,
    file: &std::fs::File,
    trusted_roots: &[PathBuf],
) -> Option<(PathBuf, Vec<OsString>)> {
    let mut reader = file.try_clone().ok()?;
    reader.seek(SeekFrom::Start(0)).ok()?;
    let mut bytes = [0_u8; 4096];
    let length = reader.read(&mut bytes).ok()?;
    let first_line = std::str::from_utf8(&bytes[..length])
        .ok()?
        .lines()
        .next()?
        .strip_prefix("#!")?
        .trim();
    let mut words = first_line.split_whitespace();
    let interpreter = Path::new(words.next()?);
    let mut arguments = words.map(OsString::from).collect::<Vec<_>>();
    if interpreter == Path::new("/usr/bin/env") {
        if arguments.first().is_some_and(|argument| argument == "-S") {
            arguments.remove(0);
        }
        let command = arguments.first()?.to_string_lossy();
        if command != "node" && command != "nodejs" {
            return None;
        }
        arguments.remove(0);
        return Some((trusted_node_launcher(script, trusted_roots)?, arguments));
    }
    if matches!(
        interpreter.to_str(),
        Some("/bin/sh" | "/bin/bash" | "/bin/zsh")
    ) {
        let interpreter = std::fs::canonicalize(interpreter).ok()?;
        return cli_binary_is_executable(&interpreter).then_some((interpreter, arguments));
    }
    Some((
        trusted_launcher_path(interpreter, trusted_roots)?,
        arguments,
    ))
}

fn codex_launch_root() -> Option<PathBuf> {
    let current = std::env::current_dir().ok()?.canonicalize().ok()?;
    if current.parent().is_none()
        || dirs::home_dir()
            .and_then(|home| home.canonicalize().ok())
            .is_some_and(|home| home == current)
    {
        return None;
    }
    Some(current)
}

fn common_codex_candidates(home: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/codex"),
        PathBuf::from("/usr/local/bin/codex"),
        PathBuf::from("/usr/bin/codex"),
    ];
    if let Some(home) = home {
        candidates.extend([
            home.join(".local/bin/codex"),
            home.join(".bun/bin/codex"),
            home.join(".volta/bin/codex"),
            home.join("Library/pnpm/codex"),
        ]);
    }
    candidates
}

fn trusted_codex_roots(home: Option<&Path>) -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from("/opt/homebrew"),
        PathBuf::from("/usr/local"),
        PathBuf::from("/usr"),
    ];
    if let Some(home) = home {
        roots.extend([
            home.join(".local"),
            home.join(".bun"),
            home.join(".volta"),
            home.join(".nvm"),
            home.join(".fnm"),
            home.join(".asdf"),
            home.join("Library/pnpm"),
            home.join("Library/Application Support/fnm"),
        ]);
    }
    roots
}

fn find_codex_binary() -> Option<TrustedCodexExecutable> {
    let home = dirs::home_dir().and_then(|home| home.canonicalize().ok());
    let launch_root = codex_launch_root();
    let trusted_roots = trusted_codex_roots(home.as_deref());
    if let Some(candidate) = common_codex_candidates(home.as_deref())
        .iter()
        .find_map(|candidate| {
            trusted_codex_candidate(candidate, &trusted_roots, launch_root.as_deref())
        })
    {
        return Some(candidate);
    }

    // Finder-launched macOS apps do not inherit the user's interactive PATH.
    // Ask a fixed system shell from the operator's home so project-local PATH
    // injection, a hostile current directory, and an inherited SHELL cannot
    // choose the executable. Canonical validation below rejects launch-root
    // paths even if an operator profile happens to expose one.
    let home = home?;
    for shell in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
        if !cli_binary_is_executable(Path::new(shell)) {
            continue;
        }
        let mut command = std::process::Command::new(shell);
        command
            .args(["-lic", "command -v codex"])
            .current_dir(&home)
            .env_clear();
        for (key, value) in crate::redaction::scrub_env_to_allowlist(&[
            "HOME", "USER", "LANG", "TERM", "TMPDIR", "LC_ALL", "LC_CTYPE",
        ]) {
            command.env(key, value);
        }
        command.env("HOME", &home).env("SHELL", shell);
        let Ok(output) = command.output() else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        if let Some(candidate) = String::from_utf8_lossy(&output.stdout)
            .lines()
            .rev()
            .map(str::trim)
            .filter(|value| value.starts_with('/'))
            .map(PathBuf::from)
            .find_map(|candidate| {
                trusted_codex_candidate(&candidate, &trusted_roots, launch_root.as_deref())
            })
        {
            return Some(candidate);
        }
    }
    None
}

pub(crate) fn codex_binary_path() -> Result<TrustedCodexExecutable, String> {
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
            run_options: Some(crate::codex_agent_host::codex_run_options()),
        };
    };

    let mut version_command = tokio::process::Command::new(binary.command_path());
    version_command
        .args(binary.command_prefix_args())
        .arg("--version");
    let version_output = version_command.output().await;
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
            run_options: Some(crate::codex_agent_host::codex_run_options()),
        };
    }

    let mut login_command = tokio::process::Command::new(binary.command_path());
    login_command
        .args(binary.command_prefix_args())
        .args(["login", "status"]);
    let login_status = login_command.output().await;
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
        run_options: Some(crate::codex_agent_host::codex_run_options()),
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

    fn unique_temp_root(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("offisim-{label}-{suffix}"))
    }

    fn write_executable(path: &Path) {
        std::fs::create_dir_all(path.parent().expect("executable parent"))
            .expect("create executable parent");
        std::fs::write(path, b"#!/bin/sh\nexit 0\n").expect("write executable");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(path)
                .expect("executable metadata")
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(path, permissions).expect("mark executable");
        }
    }

    #[test]
    fn trusted_codex_candidate_rejects_relative_and_launch_root_paths() {
        let launch_root = unique_temp_root("codex-launch-root");
        let workspace_codex = launch_root.join("bin/codex");
        write_executable(&workspace_codex);
        let trusted_roots = vec![launch_root.clone()];

        assert!(trusted_codex_candidate(
            Path::new("bin/codex"),
            &trusted_roots,
            Some(&launch_root)
        )
        .is_none());
        assert!(
            trusted_codex_candidate(&workspace_codex, &trusted_roots, Some(&launch_root)).is_none()
        );

        let _ = std::fs::remove_dir_all(launch_root);
    }

    #[test]
    fn trusted_codex_candidate_returns_canonical_external_executable() {
        let launch_root = unique_temp_root("codex-launch-root");
        let install_root = unique_temp_root("codex-install-root");
        let installed_codex = install_root.join("bin/codex");
        std::fs::create_dir_all(&launch_root).expect("create launch root");
        write_executable(&installed_codex);

        let trusted = trusted_codex_candidate(
            &installed_codex,
            std::slice::from_ref(&install_root),
            Some(&launch_root),
        )
        .expect("trusted executable");
        assert_eq!(
            trusted.canonical_path(),
            std::fs::canonicalize(&installed_codex).unwrap()
        );

        let _ = std::fs::remove_dir_all(launch_root);
        let _ = std::fs::remove_dir_all(install_root);
    }

    #[cfg(unix)]
    #[test]
    fn trusted_codex_candidate_executes_the_opened_inode_after_path_replacement() {
        let install_root = unique_temp_root("codex-stable-install-root");
        let installed_codex = install_root.join("bin/codex");
        let displaced_codex = install_root.join("bin/codex-original");
        write_executable(&installed_codex);
        std::fs::write(&installed_codex, b"#!/bin/sh\nprintf verified\n")
            .expect("write verified executable");
        let trusted =
            trusted_codex_candidate(&installed_codex, std::slice::from_ref(&install_root), None)
                .expect("trusted executable");

        std::fs::rename(&installed_codex, &displaced_codex).expect("displace executable");
        write_executable(&installed_codex);
        let output = std::process::Command::new(trusted.command_path())
            .args(trusted.command_prefix_args())
            .output()
            .expect("execute opened inode");

        assert!(output.status.success());
        assert_eq!(output.stdout, b"verified");
        let _ = std::fs::remove_dir_all(install_root);
    }

    #[cfg(unix)]
    #[test]
    fn trusted_codex_node_wrapper_materializes_the_pinned_native_binary() {
        let Some((platform_package, target_triple)) = codex_native_layout() else {
            return;
        };
        let install_root = unique_temp_root("codex-native-install-root");
        let package_root = install_root.join("lib/node_modules/@openai/codex");
        let installed_codex = package_root.join("bin/codex.js");
        let native_codex = package_root
            .join("node_modules/@openai")
            .join(platform_package)
            .join("vendor")
            .join(target_triple)
            .join("bin/codex");
        write_executable(&installed_codex);
        write_executable(&native_codex);
        std::fs::write(&native_codex, b"#!/bin/sh\nprintf pinned-native\n")
            .expect("write native executable");

        let trusted =
            trusted_codex_candidate(&installed_codex, std::slice::from_ref(&install_root), None)
                .expect("trusted native executable");
        assert_eq!(
            trusted.canonical_path(),
            std::fs::canonicalize(&native_codex).unwrap()
        );
        assert!(trusted.command_prefix_args().is_empty());
        assert_ne!(trusted.command_path(), native_codex);

        let displaced_native = native_codex.with_extension("original");
        std::fs::rename(&native_codex, &displaced_native).expect("displace native executable");
        write_executable(&native_codex);
        let output = std::process::Command::new(trusted.command_path())
            .output()
            .expect("execute materialized native binary");
        assert!(output.status.success());
        assert_eq!(output.stdout, b"pinned-native");
        let _ = std::fs::remove_dir_all(install_root);
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
            run_options: Some(json!({
                "models": [{
                    "id": "gpt-5.6-sol",
                    "displayName": "GPT-5.6 Sol",
                    "reasoningEfforts": ["minimal", "low", "medium", "high", "xhigh"],
                    "speedModes": ["standard", "fast"]
                }],
                "sourceUrl": "https://learn.chatgpt.com/docs/config-file/config-reference",
                "checkedAt": "2026-07-24"
            })),
        };
        let codex_json = serde_json::to_value(codex).expect("serialize Codex CLI status");
        assert_eq!(codex_json["engineId"], "codex");
        assert!(codex_json.get("sourceUrl").is_none());
        assert_eq!(codex_json["runOptions"]["models"][0]["id"], "gpt-5.6-sol");

        let claude: AgentHostCliStatusResponse = serde_json::from_value(json!({
            "engineId": "claude",
            "displayName": "Claude",
            "state": "ready",
            "version": "2.1.211 (Claude Code)",
            "loginCommand": "claude auth login",
            "docsUrl": "https://code.claude.com/docs/en/authentication",
            "sourceUrl": "https://code.claude.com/docs/en/cli-usage",
            "checkedAt": "2026-07-19T00:00:00.000Z",
            "capabilities": {"stop": true},
            "runOptions": {
                "models": [{
                    "id": "sonnet",
                    "displayName": "Sonnet (claude-sonnet-5)",
                    "reasoningEfforts": ["low", "medium", "high", "xhigh", "max"],
                    "speedModes": ["standard"]
                }],
                "sourceUrl": "https://code.claude.com/docs/en/cli-reference",
                "checkedAt": "2026-07-24"
            }
        }))
        .expect("deserialize Claude sidecar status");
        assert_eq!(
            claude.source_url,
            "https://code.claude.com/docs/en/cli-usage"
        );
        assert_eq!(
            claude.run_options.as_ref().expect("Claude run options")["models"][0]["id"],
            "sonnet"
        );
        let round_trip = serde_json::to_value(claude).expect("serialize Claude sidecar status");
        assert_eq!(
            round_trip["runOptions"]["sourceUrl"],
            "https://code.claude.com/docs/en/cli-reference"
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

        let without_run_options = json!({
            "engineId": "claude",
            "displayName": "Claude",
            "state": "ready",
            "loginCommand": "claude auth login",
            "docsUrl": "https://code.claude.com/docs/en/authentication",
            "sourceUrl": "https://code.claude.com/docs/en/cli-usage",
            "checkedAt": "2026-07-19T00:00:00.000Z",
            "capabilities": {"stop": true}
        });
        let parsed_without_run_options =
            serde_json::from_value::<AgentHostCliStatusResponse>(without_run_options)
                .expect("older sidecar status remains accepted");
        assert!(parsed_without_run_options.run_options.is_none());

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
