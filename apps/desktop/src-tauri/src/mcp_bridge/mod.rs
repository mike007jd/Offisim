pub mod commands;
pub mod error;
pub mod health;
pub mod jsonrpc_framer;
pub mod process_manager;
pub mod registry_store;
pub mod types;

use commands::ProcessRegistry;
use registry_store::RegisteredServerStore;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Wry,
};

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("mcp_bridge")
        .invoke_handler(tauri::generate_handler![
            commands::mcp_list_registered_servers,
            commands::mcp_register_server,
            commands::mcp_unregister_server,
            commands::mcp_connect_registered,
            commands::mcp_kill,
            commands::mcp_list_servers,
        ])
        .setup(|app, _api| {
            app.manage(ProcessRegistry::new());
            let store = RegisteredServerStore::load(app)?;
            app.manage(store);
            Ok(())
        })
        .build()
}
