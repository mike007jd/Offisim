pub mod error;
pub mod health;
pub mod jsonrpc_framer;
pub mod process_manager;
pub mod types;

use process_manager::ManagedProcess;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Wry,
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Temporary placeholder — ProcessRegistry moves to commands.rs in Task 10.
/// Using tokio::sync::Mutex for async safety.
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

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("mcp_bridge")
        .setup(|app, _api| {
            app.manage(ProcessRegistry::new());
            Ok(())
        })
        .build()
}
