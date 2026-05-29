use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::registry_store::McpTransport;

#[derive(Debug, Clone, Deserialize)]
pub struct McpProcessConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub approval_id: Option<String>,
    pub command_fingerprint: Option<String>,
    pub project_id: Option<String>,
    pub source: Option<String>,
    pub source_package_id: Option<String>,
    pub source_package_version: Option<String>,
    pub source_manifest_hash: Option<String>,
    /// Jailed working directory for the spawned child. Set by the connect
    /// command to an app-owned location so relative command/arg paths resolve
    /// inside a controlled directory instead of the process's ambient cwd.
    #[serde(default)]
    pub cwd: Option<std::path::PathBuf>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectRequest {
    pub server_id: String,
    pub approval_id: String,
    pub command_fingerprint: String,
    pub project_id: Option<String>,
    pub request_surface: String,
    pub source_package_id: Option<String>,
    pub source_package_version: Option<String>,
    pub source_manifest_hash: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallRequest {
    pub server: String,
    pub tool: String,
    pub args: serde_json::Value,
    pub approval_id: String,
    pub command_fingerprint: String,
    pub project_id: Option<String>,
    pub source_package_id: Option<String>,
    pub source_package_version: Option<String>,
    pub source_manifest_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredMcpServerSummary {
    pub server_id: String,
    pub name: String,
    pub transport: McpTransport,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub url: Option<String>,
    pub source: Option<String>,
    pub source_package_id: Option<String>,
    pub source_package_version: Option<String>,
    pub source_manifest_hash: Option<String>,
    pub request_surface: Option<String>,
    pub approval_id: Option<String>,
    pub risk_class: Option<String>,
    pub command_fingerprint: Option<String>,
    pub requested_tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpSpawnResult {
    pub server_name: String,
    pub tools: Vec<McpToolInfo>,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolInfo {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpServerStatus {
    pub name: String,
    pub state: String,
    pub tool_count: u32,
    pub consecutive_failures: u32,
    pub pid: Option<u32>,
}

/// JSON-RPC 2.0 message (request, response, or notification).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcMessage {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl JsonRpcMessage {
    pub fn request(id: i64, method: &str, params: serde_json::Value) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id: Some(serde_json::Value::Number(id.into())),
            method: Some(method.into()),
            params: Some(params),
            result: None,
            error: None,
        }
    }

    pub fn notification(method: &str) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id: None,
            method: Some(method.into()),
            params: None,
            result: None,
            error: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registered_summary_serializes_request_surface() {
        let summary = RegisteredMcpServerSummary {
            server_id: "server-installed-asset".into(),
            name: "Installed Asset MCP".into(),
            transport: McpTransport::Stdio,
            command: Some("node".into()),
            args: vec!["server.mjs".into()],
            url: None,
            source: Some("installed-asset".into()),
            source_package_id: Some("pkg.customer-research".into()),
            source_package_version: Some("1.0.0".into()),
            source_manifest_hash: Some("manifest-a".into()),
            request_surface: Some("installed-asset-runtime".into()),
            approval_id: Some("approval-1".into()),
            risk_class: Some("high".into()),
            command_fingerprint: Some("fingerprint-a".into()),
            requested_tools: vec!["search".into()],
        };

        let value = serde_json::to_value(summary).unwrap();
        assert_eq!(value["requestSurface"], "installed-asset-runtime");
    }
}
