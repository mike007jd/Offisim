use thiserror::Error;

#[derive(Debug, Error)]
pub enum McpBridgeError {
    #[error("Server '{0}' not found")]
    ServerNotFound(String),
    #[error("Server '{0}' is not ready (state: {1})")]
    ServerNotReady(String, String),
    #[error("Failed to spawn process '{0}': {1}")]
    SpawnFailed(String, String),
    #[error("Initialize handshake failed: {0}")]
    InitFailed(String),
    #[error("MCP registry error: {0}")]
    Registry(String),
    #[error("Tool call timed out after {0}ms")]
    CallTimeout(u64),
    #[error("JSON-RPC error: code={code}, message={message}")]
    JsonRpcError { code: i64, message: String },
    #[error("Process exited unexpectedly with code {0:?}")]
    ProcessExited(Option<i32>),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

impl From<McpBridgeError> for tauri::ipc::InvokeError {
    fn from(e: McpBridgeError) -> Self {
        tauri::ipc::InvokeError::from(e.to_string())
    }
}
