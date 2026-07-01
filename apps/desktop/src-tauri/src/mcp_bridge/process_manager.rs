use crate::mcp_bridge::error::McpBridgeError;
use crate::mcp_bridge::jsonrpc_framer::{drain_stderr, read_loop, write_message, RequestTracker};
use crate::mcp_bridge::types::*;
use std::collections::HashMap;
use tokio::io::BufWriter;
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration};

/// Safe environment variable whitelist inherited from parent process.
const ENV_WHITELIST: &[&str] = &[
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
];

/// Interpreters an `installed-asset` MCP server may launch as a bare,
/// PATH-resolved command. Anything else from the installed-asset source must be
/// an absolute path that canonicalizes inside the cwd jail (app-owned root), so
/// a compromised renderer cannot register+connect e.g. `/bin/sh -c 'curl … |sh'`
/// or `bash` as an "installed asset" and obtain arbitrary code execution.
const INSTALLED_ASSET_INTERPRETER_ALLOWLIST: &[&str] = &[
    "node", "npx", "python", "python3", "deno", "bun", "uv", "uvx",
];

/// Fail-closed validation of the command an stdio MCP server will spawn.
///
/// `user-config` / `developer-runtime` sources carry deliberate user/developer
/// intent (settings or dev surface) and are left to the user's discretion. The
/// `installed-asset` source is reachable from the installed-asset runtime
/// surface, so it is constrained to an interpreter allowlist or a vault-jailed
/// absolute path.
fn validate_spawn_command(config: &McpProcessConfig) -> Result<(), McpBridgeError> {
    if config.source.as_deref() != Some("installed-asset") {
        return Ok(());
    }

    let command = config.command.trim();
    if command.is_empty() {
        return Err(McpBridgeError::SpawnFailed(
            config.command.clone(),
            "installed-asset MCP command is empty".into(),
        ));
    }

    let is_path = command.contains('/') || command.contains('\\');
    if !is_path {
        if INSTALLED_ASSET_INTERPRETER_ALLOWLIST.contains(&command) {
            return Ok(());
        }
        return Err(McpBridgeError::SpawnFailed(
            config.command.clone(),
            "installed-asset MCP command must be an allowed interpreter \
             (node/npx/python/python3/deno/bun/uv/uvx) or an absolute path inside the vault jail"
                .into(),
        ));
    }

    let path = std::path::Path::new(command);
    if !path.is_absolute() {
        return Err(McpBridgeError::SpawnFailed(
            config.command.clone(),
            "installed-asset MCP command path must be absolute".into(),
        ));
    }
    let jail = config.cwd.as_ref().ok_or_else(|| {
        McpBridgeError::SpawnFailed(
            config.command.clone(),
            "installed-asset MCP command requires a cwd jail".into(),
        )
    })?;
    let canon_cmd = std::fs::canonicalize(path).map_err(|err| {
        McpBridgeError::SpawnFailed(
            config.command.clone(),
            format!("cannot resolve installed-asset command path: {err}"),
        )
    })?;
    let canon_jail = std::fs::canonicalize(jail).unwrap_or_else(|_| jail.clone());
    if !canon_cmd.starts_with(&canon_jail) {
        return Err(McpBridgeError::SpawnFailed(
            config.command.clone(),
            "installed-asset MCP command path escapes the vault jail".into(),
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ProcessState {
    Starting,
    Ready,
    Unhealthy,
    Dead,
}

impl std::fmt::Display for ProcessState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Starting => write!(f, "starting"),
            Self::Ready => write!(f, "ready"),
            Self::Unhealthy => write!(f, "unhealthy"),
            Self::Dead => write!(f, "dead"),
        }
    }
}

pub struct ManagedProcess {
    pub child: Child,
    pub stdin: BufWriter<tokio::process::ChildStdin>,
    pub tracker: RequestTracker,
    pub config: McpProcessConfig,
    pub state: ProcessState,
    pub tools: Vec<McpToolInfo>,
    pub consecutive_failures: u32,
}

impl ManagedProcess {
    /// Spawn the child process, set up stdin/stdout framing, perform MCP initialize handshake.
    pub async fn spawn(config: McpProcessConfig) -> Result<Self, McpBridgeError> {
        // SECURITY: registering + connecting an stdio MCP server === controlled
        // local code execution. The renderer is part of the TCB on this path,
        // so we fail closed on the command itself before spawning.
        validate_spawn_command(&config)?;

        // Build env: whitelist from parent + config overrides
        let mut env: HashMap<String, String> = HashMap::new();
        for key in ENV_WHITELIST {
            if let Ok(val) = std::env::var(key) {
                env.insert(key.to_string(), val);
            }
        }
        for (k, v) in &config.env {
            env.insert(k.clone(), v.clone());
        }

        let mut cmd = Command::new(&config.command);
        cmd.args(&config.args)
            .env_clear()
            .envs(&env)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        // cwd jail: resolve relative command/arg paths inside an app-owned
        // directory instead of the process's ambient cwd. The connect command
        // sets this; aligns with git_exec / bash_execute which both pin cwd.
        if let Some(cwd) = &config.cwd {
            cmd.current_dir(cwd);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| McpBridgeError::SpawnFailed(config.command.clone(), e.to_string()))?;

        let child_stdin = child
            .stdin
            .take()
            .ok_or_else(|| McpBridgeError::SpawnFailed(config.name.clone(), "no stdin".into()))?;
        let child_stdout = child
            .stdout
            .take()
            .ok_or_else(|| McpBridgeError::SpawnFailed(config.name.clone(), "no stdout".into()))?;
        let child_stderr = child
            .stderr
            .take()
            .ok_or_else(|| McpBridgeError::SpawnFailed(config.name.clone(), "no stderr".into()))?;

        let stdin = BufWriter::new(child_stdin);
        let tracker = RequestTracker::new();

        // Start read loop in background task
        let tracker_clone = tracker.clone_inner();
        tokio::spawn(async move {
            // Read loop parses NDJSON and sends to channel
            let (raw_tx, mut raw_rx) = mpsc::channel(64);
            tokio::spawn(read_loop(child_stdout, raw_tx));

            while let Some(msg) = raw_rx.recv().await {
                // Try to resolve as response to pending request
                if !tracker_clone.try_resolve(&msg) {
                    eprintln!("[mcp_bridge] dropped unsolicited JSON-RPC message");
                }
            }
        });
        tokio::spawn(drain_stderr(child_stderr));

        Ok(Self {
            child,
            stdin,
            tracker,
            config,
            state: ProcessState::Starting,
            tools: Vec::new(),
            consecutive_failures: 0,
        })
    }

    /// Perform MCP initialize handshake + tools/list.
    pub async fn initialize(&mut self) -> Result<(), McpBridgeError> {
        // 1. Send initialize request
        // IMPORTANT: register BEFORE write_message to avoid race condition
        let init_id = self.tracker.next_id();
        let rx = self.tracker.register(init_id);
        let init_req = JsonRpcMessage::request(
            init_id,
            "initialize",
            serde_json::json!({
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {
                    "name": "offisim-desktop",
                    "version": "0.1.0"
                }
            }),
        );
        write_message(&mut self.stdin, &init_req)
            .await
            .map_err(|e| McpBridgeError::InitFailed(e.to_string()))?;

        // 2. Wait for initialize response (10s timeout)
        let init_resp = timeout(Duration::from_secs(10), rx)
            .await
            .map_err(|_| McpBridgeError::InitFailed("initialize timed out after 10s".into()))?
            .map_err(|_| McpBridgeError::InitFailed("channel closed".into()))?;

        if let Some(err) = &init_resp.error {
            return Err(McpBridgeError::JsonRpcError {
                code: err.code,
                message: err.message.clone(),
            });
        }

        // 3. Send notifications/initialized
        let init_notif = JsonRpcMessage::notification("notifications/initialized");
        write_message(&mut self.stdin, &init_notif)
            .await
            .map_err(|e| McpBridgeError::InitFailed(e.to_string()))?;

        // 4. List tools — register BEFORE write
        let tools_id = self.tracker.next_id();
        let tools_rx = self.tracker.register(tools_id);
        let tools_req = JsonRpcMessage::request(tools_id, "tools/list", serde_json::json!({}));
        write_message(&mut self.stdin, &tools_req)
            .await
            .map_err(|e| McpBridgeError::InitFailed(e.to_string()))?;

        let tools_resp = timeout(Duration::from_secs(10), tools_rx)
            .await
            .map_err(|_| McpBridgeError::InitFailed("tools/list timed out".into()))?
            .map_err(|_| McpBridgeError::InitFailed("channel closed".into()))?;

        if let Some(result) = &tools_resp.result {
            if let Some(tools_arr) = result.get("tools").and_then(|t| t.as_array()) {
                self.tools = tools_arr
                    .iter()
                    .filter_map(|t| {
                        Some(McpToolInfo {
                            name: t.get("name")?.as_str()?.to_string(),
                            description: t
                                .get("description")
                                .and_then(|d| d.as_str())
                                .unwrap_or("")
                                .to_string(),
                            input_schema: t
                                .get("inputSchema")
                                .cloned()
                                .unwrap_or(serde_json::Value::Object(Default::default())),
                            // Behavior hints (readOnly/destructive/…). Absent or
                            // malformed annotations → None (advisory only).
                            annotations: t.get("annotations").and_then(|a| {
                                serde_json::from_value::<McpToolAnnotations>(a.clone()).ok()
                            }),
                        })
                    })
                    .collect();
            }
        }

        self.state = ProcessState::Ready;
        Ok(())
    }

    /// Invoke an MCP tool by name (`tools/call`). Returns the tool's content +
    /// `isError` flag. A transport / protocol failure (process gone, timeout,
    /// JSON-RPC error) surfaces as an `McpBridgeError`; a tool-level failure
    /// comes back as a normal result with `is_error = true`.
    pub async fn call_tool(
        &mut self,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<McpToolCallResult, McpBridgeError> {
        if self.state != ProcessState::Ready {
            return Err(McpBridgeError::ServerNotReady(
                self.config.name.clone(),
                self.state.to_string(),
            ));
        }
        // Register BEFORE write to avoid a response-before-register race (same
        // ordering as initialize / tools/list).
        let call_id = self.tracker.next_id();
        let rx = self.tracker.register(call_id);
        let req = JsonRpcMessage::request(
            call_id,
            "tools/call",
            serde_json::json!({ "name": tool_name, "arguments": arguments }),
        );
        write_message(&mut self.stdin, &req).await?;
        let resp = timeout(Duration::from_secs(60), rx)
            .await
            .map_err(|_| McpBridgeError::CallTimeout(60_000))?
            .map_err(|_| McpBridgeError::ProcessExited(None))?;
        if let Some(err) = &resp.error {
            return Err(McpBridgeError::JsonRpcError {
                code: err.code,
                message: err.message.clone(),
            });
        }
        Ok(parse_tool_call_result(resp.result.as_ref()))
    }

    /// Graceful shutdown: SIGTERM → 5s wait → SIGKILL.
    pub async fn kill(&mut self) {
        if let Some(pid) = self.child.id() {
            // Try SIGTERM first (Unix only; on Windows, kill() is best-effort)
            #[cfg(unix)]
            {
                let _ = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
            }
            #[cfg(not(unix))]
            {
                let _ = self.child.kill().await;
            }
        }

        // Wait up to 5s for process to exit gracefully
        match timeout(Duration::from_secs(5), self.child.wait()).await {
            Ok(_) => {}
            Err(_) => {
                // Force kill (SIGKILL on Unix, TerminateProcess on Windows)
                let _ = self.child.kill().await;
                let _ = self.child.wait().await;
            }
        }
        self.state = ProcessState::Dead;
    }
}

/// Pure parse of a `tools/call` JSON-RPC `result` into an McpToolCallResult.
/// Missing `content` → empty array; missing/non-bool `isError` → false; a `None`
/// result (no result object) → empty, non-error.
pub fn parse_tool_call_result(result: Option<&serde_json::Value>) -> McpToolCallResult {
    let Some(result) = result else {
        return McpToolCallResult {
            content: serde_json::Value::Array(vec![]),
            is_error: false,
        };
    };
    McpToolCallResult {
        content: result
            .get("content")
            .cloned()
            .unwrap_or_else(|| serde_json::Value::Array(vec![])),
        is_error: result
            .get("isError")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn cfg(source: &str, command: &str, cwd: Option<PathBuf>) -> McpProcessConfig {
        McpProcessConfig {
            name: "test".into(),
            command: command.into(),
            args: vec![],
            env: HashMap::new(),
            source: Some(source.into()),
            cwd,
        }
    }

    #[test]
    fn installed_asset_allows_known_interpreters() {
        for interp in INSTALLED_ASSET_INTERPRETER_ALLOWLIST {
            assert!(validate_spawn_command(&cfg("installed-asset", interp, None)).is_ok());
        }
    }

    #[test]
    fn installed_asset_rejects_arbitrary_bare_command() {
        assert!(validate_spawn_command(&cfg("installed-asset", "bash", None)).is_err());
        assert!(validate_spawn_command(&cfg("installed-asset", "sh", None)).is_err());
        assert!(validate_spawn_command(&cfg("installed-asset", "curl", None)).is_err());
    }

    #[test]
    fn installed_asset_rejects_relative_path_command() {
        assert!(validate_spawn_command(&cfg("installed-asset", "./evil.sh", None)).is_err());
    }

    #[test]
    fn installed_asset_rejects_absolute_path_outside_jail() {
        let jail = std::env::temp_dir().join("offisim-mcp-jail-test");
        assert!(validate_spawn_command(&cfg("installed-asset", "/bin/sh", Some(jail))).is_err());
    }

    #[test]
    fn user_config_and_developer_runtime_bypass_allowlist() {
        // These carry deliberate user/developer intent and are not constrained.
        assert!(validate_spawn_command(&cfg("user-config", "/bin/sh", None)).is_ok());
        assert!(validate_spawn_command(&cfg("developer-runtime", "anything", None)).is_ok());
        assert!(validate_spawn_command(&cfg("", "anything", None)).is_ok());
    }

    #[test]
    fn parse_tool_call_result_extracts_content_and_is_error() {
        let ok = serde_json::json!({
            "content": [{ "type": "text", "text": "hello" }],
            "isError": false
        });
        let parsed = parse_tool_call_result(Some(&ok));
        assert_eq!(parsed.is_error, false);
        assert_eq!(parsed.content[0]["text"], "hello");

        let err = serde_json::json!({
            "content": [{ "type": "text", "text": "boom" }],
            "isError": true
        });
        assert!(
            parse_tool_call_result(Some(&err)).is_error,
            "isError:true surfaces"
        );
    }

    #[test]
    fn parse_tool_call_result_defaults_missing_fields() {
        // Missing content → empty array; missing isError → false.
        let bare = serde_json::json!({});
        let parsed = parse_tool_call_result(Some(&bare));
        assert_eq!(parsed.content, serde_json::Value::Array(vec![]));
        assert_eq!(parsed.is_error, false);
        // No result object at all → empty, non-error (never a false PASS).
        let none = parse_tool_call_result(None);
        assert_eq!(none.content, serde_json::Value::Array(vec![]));
        assert_eq!(none.is_error, false);
    }

    #[test]
    fn tool_annotations_deserialize_camel_case_hints() {
        // tools/list carries camelCase hints; absent ones stay None.
        let value = serde_json::json!({
            "readOnlyHint": true,
            "destructiveHint": false
        });
        let ann: McpToolAnnotations = serde_json::from_value(value).unwrap();
        assert_eq!(ann.read_only_hint, Some(true));
        assert_eq!(ann.destructive_hint, Some(false));
        assert_eq!(ann.idempotent_hint, None);
        // An empty annotations object → all-None (no field is fabricated).
        let empty: McpToolAnnotations = serde_json::from_value(serde_json::json!({})).unwrap();
        assert_eq!(empty.read_only_hint, None);
    }
}
