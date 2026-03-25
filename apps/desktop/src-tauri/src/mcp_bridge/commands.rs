use crate::mcp_bridge::error::McpBridgeError;
use crate::mcp_bridge::process_manager::ManagedProcess;
use crate::mcp_bridge::registry_store::{
    McpServerRegistrationInput, McpTransport, RegisteredServerStore,
};
use crate::mcp_bridge::types::*;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

/// IMPORTANT: Uses tokio::sync::Mutex (NOT std::sync::Mutex) because
/// ManagedProcess methods are async and we must not hold a std Mutex across .await.
pub struct ProcessRegistry {
    pub servers: Arc<Mutex<HashMap<String, Arc<Mutex<ManagedProcess>>>>>,
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
            let command = server.command.clone().ok_or_else(|| {
                McpBridgeError::Registry(format!(
                    "Registered server '{}' has no command",
                    server.name
                ))
            })?;
            spawn_managed_process(
                McpProcessConfig {
                    name: server.name,
                    command,
                    args: server.args,
                    env: HashMap::new(),
                },
                process_registry,
            )
            .await
        }
        McpTransport::Sse => Err(McpBridgeError::Registry(
            "SSE servers should connect directly from the web runtime".into(),
        )),
    }
}

#[tauri::command(async)]
pub async fn mcp_call_tool(
    server: String,
    tool: String,
    args: serde_json::Value,
    registry: State<'_, ProcessRegistry>,
) -> Result<serde_json::Value, McpBridgeError> {
    let process = {
        let servers = registry.servers.lock().await;
        servers
            .get(&server)
            .cloned()
            .ok_or_else(|| McpBridgeError::ServerNotFound(server.clone()))?
    };
    let mut process = process.lock().await;
    let result = process.call_tool(&tool, args).await;
    result
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
            consecutive_failures: process.consecutive_failures,
            pid: process.child.id(),
        });
    }
    Ok(statuses)
}

#[tauri::command(async)]
pub async fn mcp_reconnect(
    server: String,
    registry: State<'_, ProcessRegistry>,
) -> Result<McpSpawnResult, McpBridgeError> {
    let process = {
        let mut servers = registry.servers.lock().await;
        servers
            .remove(&server)
            .ok_or_else(|| McpBridgeError::ServerNotFound(server.clone()))?
    };
    let config = process.lock().await.config.clone();
    tokio::spawn(async move {
        process.lock().await.kill().await;
    });

    // Re-spawn
    spawn_managed_process(config, registry).await
}
