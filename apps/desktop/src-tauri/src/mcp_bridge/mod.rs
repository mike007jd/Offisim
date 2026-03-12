pub mod commands;
pub mod error;
pub mod health;
pub mod jsonrpc_framer;
pub mod process_manager;
pub mod types;

use commands::ProcessRegistry;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Wry,
};

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("mcp_bridge")
        .invoke_handler(tauri::generate_handler![
            commands::mcp_spawn,
            commands::mcp_call_tool,
            commands::mcp_kill,
            commands::mcp_list_servers,
            commands::mcp_reconnect,
        ])
        .setup(|app, _api| {
            app.manage(ProcessRegistry::new());
            Ok(())
        })
        .build()
}
