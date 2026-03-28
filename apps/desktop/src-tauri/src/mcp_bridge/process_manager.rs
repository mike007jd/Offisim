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
                        })
                    })
                    .collect();
            }
        }

        self.state = ProcessState::Ready;
        Ok(())
    }

    /// Send a tools/call request and wait for response.
    pub async fn call_tool(
        &mut self,
        tool_name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, McpBridgeError> {
        if self.state != ProcessState::Ready {
            return Err(McpBridgeError::ServerNotReady(
                self.config.name.clone(),
                self.state.to_string(),
            ));
        }

        // Register BEFORE write to avoid race condition
        let call_id = self.tracker.next_id();
        let rx = self.tracker.register(call_id);
        let req = JsonRpcMessage::request(
            call_id,
            "tools/call",
            serde_json::json!({
                "name": tool_name,
                "arguments": args,
            }),
        );

        write_message(&mut self.stdin, &req).await?;

        let resp = timeout(Duration::from_secs(30), rx)
            .await
            .map_err(|_| {
                self.consecutive_failures += 1;
                McpBridgeError::CallTimeout(30_000)
            })?
            .map_err(|_| McpBridgeError::ProcessExited(None))?;

        if let Some(err) = &resp.error {
            self.consecutive_failures += 1;
            return Err(McpBridgeError::JsonRpcError {
                code: err.code,
                message: err.message.clone(),
            });
        }

        self.consecutive_failures = 0;
        Ok(resp.result.unwrap_or(serde_json::Value::Null))
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
