pub mod error;
pub mod jsonrpc_framer;
pub mod process_manager;
pub mod types;

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Wry,
};
use std::collections::HashMap;

/// Temporary placeholder — ProcessRegistry moves to commands.rs in Task 10.
/// Using tokio::sync::Mutex for async safety.
pub struct ProcessRegistry {
    // Will hold ManagedProcess entries in Task 10
    pub servers: tokio::sync::Mutex<HashMap<String, ()>>,
}

impl ProcessRegistry {
    pub fn new() -> Self {
        Self {
            servers: tokio::sync::Mutex::new(HashMap::new()),
        }
    }
}

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("mcp_bridge")
        .setup(|app, _api| {
            app.manage(ProcessRegistry::new());
            Ok(())
        })
        .build()
}
