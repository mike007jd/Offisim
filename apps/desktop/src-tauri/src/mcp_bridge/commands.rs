use crate::mcp_bridge::error::McpBridgeError;
use crate::mcp_bridge::process_manager::ManagedProcess;
use crate::mcp_bridge::registry_store::{
    validate_stdio_request_surface, McpServerRegistrationInput, McpTransport, RegisteredServerStore,
};
use crate::mcp_bridge::types::*;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

/// IMPORTANT: Uses tokio::sync::Mutex (NOT std::sync::Mutex) because
/// ManagedProcess methods are async and we must not hold a std Mutex across .await.
pub struct ProcessRegistry {
    pub servers: Arc<Mutex<HashMap<String, Arc<Mutex<ManagedProcess>>>>>,
}

fn audit_event<R: tauri::Runtime>(
    app: &AppHandle<R>,
    event: serde_json::Value,
) -> Result<(), McpBridgeError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| McpBridgeError::Registry(err.to_string()))?;
    fs::create_dir_all(&dir).map_err(|err| McpBridgeError::Registry(err.to_string()))?;
    let path = dir.join("mcp-stdio-audit.jsonl");
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|err| McpBridgeError::Registry(err.to_string()))?;
    writeln!(
        file,
        "{}",
        serde_json::to_string(&event).map_err(|err| McpBridgeError::Registry(err.to_string()))?
    )
    .map_err(|err| McpBridgeError::Registry(err.to_string()))
}

impl ProcessRegistry {
    pub fn new() -> Self {
        Self {
            servers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn servers_arc(&self) -> Arc<Mutex<HashMap<String, Arc<Mutex<ManagedProcess>>>>> {
        Arc::clone(&self.servers)
    }
}

async fn spawn_managed_process(
    config: McpProcessConfig,
    registry: State<'_, ProcessRegistry>,
) -> Result<McpSpawnResult, McpBridgeError> {
    let name = config.name.clone();

    // Kill existing if any
    {
        let mut servers = registry.servers.lock().await;
        if let Some(old) = servers.remove(&name) {
            tokio::spawn(async move {
                old.lock().await.kill().await;
            });
        }
    }

    let mut process = ManagedProcess::spawn(config).await?;
    process.initialize().await?;

    let result = McpSpawnResult {
        server_name: name.clone(),
        tools: process.tools.clone(),
        state: "ready".into(),
    };

    registry
        .servers
        .lock()
        .await
        .insert(name.clone(), Arc::new(Mutex::new(process)));

    // Start health monitor for this server
    let registry_arc = registry.servers_arc();
    let health_config = crate::mcp_bridge::health::HealthConfig::default();
    tokio::spawn(crate::mcp_bridge::health::health_monitor_loop(
        name,
        registry_arc,
        health_config,
    ));

    Ok(result)
}

#[tauri::command]
pub fn mcp_list_registered_servers(
    registry: State<'_, RegisteredServerStore>,
) -> Result<Vec<RegisteredMcpServerSummary>, McpBridgeError> {
    Ok(registry
        .list()
        .map_err(McpBridgeError::Registry)?
        .into_iter()
        .map(|server| RegisteredMcpServerSummary {
            server_id: server.server_id,
            name: server.name,
            transport: server.transport,
            command: server.command,
            args: server.args,
            url: server.url,
            source: server.source,
            source_package_id: server.source_package_id,
            source_package_version: server.source_package_version,
            source_manifest_hash: server.source_manifest_hash,
            request_surface: server.request_surface,
            approval_id: server.approval_id,
            risk_class: server.risk_class,
            command_fingerprint: server.command_fingerprint,
            requested_tools: server.requested_tools,
        })
        .collect())
}

#[tauri::command]
pub fn mcp_register_server(
    input: McpServerRegistrationInput,
    registry: State<'_, RegisteredServerStore>,
) -> Result<RegisteredMcpServerSummary, McpBridgeError> {
    let server = registry.register(input).map_err(McpBridgeError::Registry)?;
    Ok(RegisteredMcpServerSummary {
        server_id: server.server_id,
        name: server.name,
        transport: server.transport,
        command: server.command,
        args: server.args,
        url: server.url,
        source: server.source,
        source_package_id: server.source_package_id,
        source_package_version: server.source_package_version,
        source_manifest_hash: server.source_manifest_hash,
        request_surface: server.request_surface,
        approval_id: server.approval_id,
        risk_class: server.risk_class,
        command_fingerprint: server.command_fingerprint,
        requested_tools: server.requested_tools,
    })
}

#[tauri::command]
pub fn mcp_unregister_server(
    server_id: String,
    registry: State<'_, RegisteredServerStore>,
) -> Result<(), McpBridgeError> {
    registry
        .unregister(&server_id)
        .map_err(McpBridgeError::Registry)
}

#[tauri::command(async)]
pub async fn mcp_connect_registered(
    app: AppHandle,
    request: McpConnectRequest,
    process_registry: State<'_, ProcessRegistry>,
    registered_registry: State<'_, RegisteredServerStore>,
) -> Result<McpSpawnResult, McpBridgeError> {
    let server = registered_registry
        .get(&request.server_id)
        .map_err(McpBridgeError::Registry)?
        .ok_or_else(|| {
            McpBridgeError::Registry(format!(
                "Registered server '{}' not found",
                request.server_id
            ))
        })?;

    match server.transport {
        McpTransport::Stdio => {
            let source = server.source.as_deref().unwrap_or_default();
            validate_stdio_request_surface(source, &request.request_surface, "startup")
                .map_err(McpBridgeError::Registry)?;
            if source == "installed-asset"
                && (server.source_package_id != request.source_package_id
                    || server.source_package_version != request.source_package_version
                    || server.source_manifest_hash != request.source_manifest_hash)
            {
                return Err(McpBridgeError::Registry(
                    "MCP stdio startup source package metadata did not match registration".into(),
                ));
            }
            if server.approval_id.as_deref() != Some(request.approval_id.as_str()) {
                return Err(McpBridgeError::Registry(
                    "MCP stdio approval id did not match registration".into(),
                ));
            }
            if server.command_fingerprint.as_deref() != Some(request.command_fingerprint.as_str()) {
                return Err(McpBridgeError::Registry(
                    "MCP stdio command fingerprint did not match registration".into(),
                ));
            }
            let command = server.command.clone().ok_or_else(|| {
                McpBridgeError::Registry(format!(
                    "Registered server '{}' has no command",
                    server.name
                ))
            })?;
            // cwd jail = app-owned local data root. Relative command/arg paths
            // resolve here, and installed-asset absolute command paths must
            // canonicalize inside it (enforced in ManagedProcess::spawn).
            let jail_dir = app
                .path()
                .app_local_data_dir()
                .map_err(|err| McpBridgeError::Registry(err.to_string()))?;
            fs::create_dir_all(&jail_dir)
                .map_err(|err| McpBridgeError::Registry(err.to_string()))?;
            let result = spawn_managed_process(
                McpProcessConfig {
                    name: server.name.clone(),
                    command,
                    args: server.args.clone(),
                    env: HashMap::new(),
                    source: server.source.clone(),
                    cwd: Some(jail_dir),
                },
                process_registry,
            )
            .await?;
            audit_event(
                &app,
                serde_json::json!({
                    "event": "mcp_stdio_started",
                    "serverId": server.server_id,
                    "serverName": server.name,
                    "source": server.source,
                    "sourcePackageId": server.source_package_id,
                    "sourcePackageVersion": server.source_package_version,
                    "sourceManifestHash": server.source_manifest_hash,
                    "approvalId": request.approval_id,
                    "commandFingerprint": request.command_fingerprint,
                    "projectId": request.project_id,
                    "riskClass": server.risk_class,
                    "toolCount": result.tools.len(),
                }),
            )?;
            Ok(result)
        }
        McpTransport::Sse => Err(McpBridgeError::Registry(
            "SSE servers should connect directly from the desktop WebView client".into(),
        )),
    }
}

#[tauri::command(async)]
pub async fn mcp_kill(
    server: String,
    registry: State<'_, ProcessRegistry>,
) -> Result<(), McpBridgeError> {
    let mut servers = registry.servers.lock().await;
    if let Some(process) = servers.remove(&server) {
        drop(servers);
        process.lock().await.kill().await;
    }
    Ok(())
}

/// Look up a connected MCP process by name and invoke a tool. Shared by the
/// `mcp_call_tool` command and the Pi host's in-process mcpCall interception
/// (pi_agent_host.rs). Drops the map lock BEFORE locking the process — async
/// ManagedProcess methods must never hold the map lock across an await (mirrors
/// mcp_kill). Transport / protocol failures surface as errors; a tool-level
/// failure returns with `is_error`.
pub async fn invoke_mcp_tool(
    registry: &ProcessRegistry,
    server: &str,
    tool: &str,
    arguments: serde_json::Value,
) -> Result<McpToolCallResult, McpBridgeError> {
    let process = {
        let servers = registry.servers.lock().await;
        servers
            .get(server)
            .map(Arc::clone)
            .ok_or_else(|| McpBridgeError::ServerNotFound(server.to_string()))?
    };
    // Bind the guard's result to a local so the MutexGuard temporary is dropped
    // before `process` at the end of the function (avoids E0597).
    let result = process.lock().await.call_tool(tool, arguments).await;
    result
}

/// Invoke a tool on a connected MCP server, addressed by its running-process
/// name (the ProcessRegistry map key = `config.name`). Transport / protocol
/// failures surface as errors; a tool-level failure returns with `is_error`.
#[tauri::command(async)]
pub async fn mcp_call_tool(
    app: AppHandle,
    server: String,
    tool: String,
    arguments: Option<serde_json::Value>,
    registry: State<'_, ProcessRegistry>,
) -> Result<McpToolCallResult, McpBridgeError> {
    let started = std::time::Instant::now();
    let args = arguments.unwrap_or_else(|| serde_json::json!({}));
    let result = invoke_mcp_tool(&registry, &server, &tool, args).await;
    let latency_ms = started.elapsed().as_millis() as u64;
    // File-based audit (the SQLite mcp_audit_log is the renderer's job — renderer
    // is the only DB writer). Audit success and failure; a failed audit write
    // never fails the call.
    let _ = audit_event(
        &app,
        serde_json::json!({
            "event": "mcp_tool_called",
            "serverName": server,
            "tool": tool,
            "ok": result.is_ok(),
            "isError": result.as_ref().map(|r| r.is_error).unwrap_or(false),
            "latencyMs": latency_ms,
            "error": result.as_ref().err().map(|e| e.to_string()),
        }),
    );
    result
}

#[tauri::command(async)]
pub async fn mcp_list_servers(
    registry: State<'_, ProcessRegistry>,
) -> Result<Vec<McpServerStatus>, McpBridgeError> {
    let server_entries = {
        let servers = registry.servers.lock().await;
        servers
            .iter()
            .map(|(name, process)| (name.clone(), Arc::clone(process)))
            .collect::<Vec<_>>()
    };

    let mut statuses = Vec::with_capacity(server_entries.len());
    for (name, process) in server_entries {
        let process = process.lock().await;
        statuses.push(McpServerStatus {
            name,
            state: process.state.to_string(),
            tool_count: process.tools.len() as u32,
            tools: process.tools.clone(),
            consecutive_failures: process.consecutive_failures,
            pid: process.child.id(),
        });
    }
    Ok(statuses)
}
