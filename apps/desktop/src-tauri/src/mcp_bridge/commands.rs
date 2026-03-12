use crate::mcp_bridge::error::McpBridgeError;
use crate::mcp_bridge::process_manager::ManagedProcess;
use crate::mcp_bridge::types::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::State;

/// IMPORTANT: Uses tokio::sync::Mutex (NOT std::sync::Mutex) because
/// ManagedProcess methods are async and we must not hold a std Mutex across .await.
pub struct ProcessRegistry {
    pub servers: Arc<Mutex<HashMap<String, ManagedProcess>>>,
}

impl ProcessRegistry {
    pub fn new() -> Self {
        Self {
            servers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn servers_arc(&self) -> Arc<Mutex<HashMap<String, ManagedProcess>>> {
        Arc::clone(&self.servers)
    }
}

#[tauri::command(async)]
pub async fn mcp_spawn(
    config: McpProcessConfig,
    registry: State<'_, ProcessRegistry>,
) -> Result<McpSpawnResult, McpBridgeError> {
    let name = config.name.clone();

    // Kill existing if any
    {
        let mut servers = registry.servers.lock().await;
        if let Some(mut old) = servers.remove(&name) {
            tokio::spawn(async move { old.kill().await });
        }
    }

    let mut process = ManagedProcess::spawn(config).await?;
    process.initialize().await?;

    let result = McpSpawnResult {
        server_name: name.clone(),
        tools: process.tools.clone(),
        state: "ready".into(),
    };

    registry.servers.lock().await.insert(name.clone(), process);

    // Start health monitor for this server
    let registry_arc = registry.servers_arc();
    let health_config = crate::mcp_bridge::health::HealthConfig::default();
    tokio::spawn(crate::mcp_bridge::health::health_monitor_loop(
        name, registry_arc, health_config,
    ));

    Ok(result)
}

#[tauri::command(async)]
pub async fn mcp_call_tool(
    server: String,
    tool: String,
    args: serde_json::Value,
    registry: State<'_, ProcessRegistry>,
) -> Result<serde_json::Value, McpBridgeError> {
    // Lock the async Mutex — safe to hold across .await
    let mut servers = registry.servers.lock().await;
    let process = servers.get_mut(&server)
        .ok_or_else(|| McpBridgeError::ServerNotFound(server.clone()))?;
    process.call_tool(&tool, args).await
}

#[tauri::command(async)]
pub async fn mcp_kill(
    server: String,
    registry: State<'_, ProcessRegistry>,
) -> Result<(), McpBridgeError> {
    let mut servers = registry.servers.lock().await;
    if let Some(mut process) = servers.remove(&server) {
        process.kill().await;
    }
    Ok(())
}

#[tauri::command(async)]
pub async fn mcp_list_servers(
    registry: State<'_, ProcessRegistry>,
) -> Result<Vec<McpServerStatus>, McpBridgeError> {
    let servers = registry.servers.lock().await;
    Ok(servers.iter().map(|(name, p)| McpServerStatus {
        name: name.clone(),
        state: p.state.to_string(),
        tool_count: p.tools.len() as u32,
        consecutive_failures: p.consecutive_failures,
        pid: p.child.id(),
    }).collect())
}

#[tauri::command(async)]
pub async fn mcp_reconnect(
    server: String,
    registry: State<'_, ProcessRegistry>,
) -> Result<McpSpawnResult, McpBridgeError> {
    let config = {
        let mut servers = registry.servers.lock().await;
        let process = servers.remove(&server)
            .ok_or_else(|| McpBridgeError::ServerNotFound(server.clone()))?;
        let config = process.config.clone();
        // Kill old process in background
        tokio::spawn(async move {
            let mut p = process;
            p.kill().await;
        });
        config
    };

    // Re-spawn
    mcp_spawn(config, registry).await
}
