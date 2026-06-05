mod attachment_store;
mod builtin_tools;
mod claude_agent_host;
mod codex_agent_host;
mod deep_link;
mod git;
mod in_flight;
mod llm_transport;
mod local_db;
mod local_paths;
mod mcp_bridge;
mod resume;
mod runtime_secrets;
mod sessions;
mod shell_classifier;
mod sidecar_stderr;

use std::path::Path;
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

const MAIN_WINDOW_LABEL: &str = "main";
const MAIN_WINDOW_FALLBACK_LABEL: &str = "main-live";

#[derive(Clone, Debug, serde::Serialize)]
struct NativeDroppedFile {
    path: String,
    name: String,
    bytes: u64,
    is_directory: bool,
}

#[derive(Clone, Debug, serde::Serialize)]
struct NativeDropPosition {
    x: f64,
    y: f64,
}

#[derive(Clone, Debug, serde::Serialize)]
struct NativeDroppedFiles {
    files: Vec<NativeDroppedFile>,
    position: NativeDropPosition,
}

fn native_dropped_file(path: &Path) -> NativeDroppedFile {
    let metadata = std::fs::metadata(path).ok();
    let is_directory = metadata.as_ref().is_some_and(|m| m.is_dir());
    let bytes = metadata
        .as_ref()
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .unwrap_or(0);
    NativeDroppedFile {
        path: path.to_string_lossy().to_string(),
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("dropped-file")
            .to_string(),
        bytes,
        is_directory,
    }
}

#[cfg(target_os = "macos")]
fn force_macos_foreground<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> bool {
    use objc2::{msg_send, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy, NSWindow};

    if let Some(mtm) = MainThreadMarker::new() {
        let app = NSApplication::sharedApplication(mtm);
        let _ = app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);
    }

    if let Ok(ns_window) = window.ns_window() {
        let ns_window = ns_window.cast::<NSWindow>();
        unsafe {
            let _: () = msg_send![ns_window, setRestorable: false];
            let ns_window = &*ns_window;
            ns_window.displayIfNeeded();
            ns_window.orderFrontRegardless();
            ns_window.makeMainWindow();
            ns_window.makeKeyAndOrderFront(None);
            return ns_window.isVisible();
        }
    }
    false
}

#[cfg(not(target_os = "macos"))]
fn force_macos_foreground<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) -> bool {
    true
}

fn create_main_window_with_label<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
) -> tauri::Result<tauri::WebviewWindow<R>> {
    tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App("index.html".into()))
        .title("Offisim")
        .inner_size(1280.0, 800.0)
        .min_inner_size(1024.0, 700.0)
        .visible(true)
        .focused(true)
        .center()
        .build()
}

fn create_main_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::WebviewWindow<R>> {
    create_main_window_with_label(app, MAIN_WINDOW_LABEL)
}

fn restore_main_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
) -> bool {
    let _ = app.show();
    let _ = window.unminimize();
    let _ = window.show();
    let native_visible = force_macos_foreground(window);
    let _ = window.set_focus();
    native_visible && window.is_visible().unwrap_or(false)
}

fn ensure_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let window = match app.get_webview_window(MAIN_WINDOW_LABEL) {
        Some(window) => window,
        None => create_main_window(app)?,
    };
    if restore_main_window(app, &window) {
        return Ok(());
    }
    let fallback = match app.get_webview_window(MAIN_WINDOW_FALLBACK_LABEL) {
        Some(window) => window,
        None => create_main_window_with_label(app, MAIN_WINDOW_FALLBACK_LABEL)?,
    };
    restore_main_window(app, &fallback);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance MUST be registered first — the handler short-circuits
        // subsequent launches before any DB/plugin init runs. Without it a
        // second `cargo tauri dev` / binary launch hits the SQLite write lock
        // held by the running instance (tauri-plugin-sql opens offisim.db in
        // the shared appDataDir) and the second window hangs with a black
        // webview. The callback focuses the existing window instead.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let app_for_main_thread = app.clone();
            let _ = app.run_on_main_thread(move || {
                let _ = app_for_main_thread.set_activation_policy(tauri::ActivationPolicy::Regular);
                let _ = ensure_main_window(&app_for_main_thread);
            });
        }))
        .invoke_handler(tauri::generate_handler![
            runtime_secrets::runtime_secret_status,
            runtime_secrets::runtime_secret_set,
            runtime_secrets::runtime_secret_clear,
            runtime_secrets::runtime_provider_profiles,
            runtime_secrets::runtime_provider_profile_upsert,
            local_db::local_db_execute_transaction,
            builtin_tools::project_read_file,
            builtin_tools::project_read_file_preview,
            builtin_tools::project_list_dir,
            builtin_tools::project_write_file,
            builtin_tools::bash_execute,
            claude_agent_host::claude_agent_execute,
            claude_agent_host::claude_agent_abort,
            codex_agent_host::codex_agent_execute,
            codex_agent_host::codex_agent_abort,
            llm_transport::llm_fetch,
            llm_transport::llm_fetch_abort,
            git::git_exec,
            local_paths::open_local_path,
            local_paths::runtime_vault_status,
            local_paths::open_runtime_vault_folder,
            local_paths::runtime_vault_read_file,
            local_paths::runtime_vault_write_file,
            local_paths::runtime_vault_list_dir,
            local_paths::runtime_vault_stat,
            local_paths::runtime_vault_remove,
            local_paths::runtime_vault_mkdir,
            local_paths::export_runtime_vault_zip,
            local_paths::export_scene_drop_diagnostic,
            local_paths::save_deliverable_to_local,
            resume::resume_conversation,
            sessions::get_session,
            sessions::set_session_mode,
            mcp_bridge::commands::mcp_list_registered_servers,
            mcp_bridge::commands::mcp_register_server,
            mcp_bridge::commands::mcp_unregister_server,
            mcp_bridge::commands::mcp_connect_registered,
            mcp_bridge::commands::mcp_call_tool,
            mcp_bridge::commands::mcp_kill,
            mcp_bridge::commands::mcp_list_servers,
            mcp_bridge::commands::mcp_reconnect,
            attachment_store::attachment_write,
            attachment_store::attachment_read,
            attachment_store::attachment_list,
            attachment_store::attachment_list_all,
            attachment_store::attachment_delete,
        ])
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_cors_fetch::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(mcp_bridge::init())
        .on_webview_event(|webview, event| {
            if let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop { paths, position }) =
                event
            {
                if let Some(scope) = webview.try_fs_scope() {
                    for path in paths {
                        let _ = if path.is_file() {
                            scope.allow_file(path)
                        } else {
                            scope.allow_directory(path, false)
                        };
                    }
                }
                let payload = NativeDroppedFiles {
                    files: paths.iter().map(|path| native_dropped_file(path)).collect(),
                    position: NativeDropPosition {
                        x: position.x as f64,
                        y: position.y as f64,
                    },
                };
                let _ = webview.emit("offisim-native-file-drop", payload);
            }
        })
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let window = webview.window();
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .setup(|app| {
            tauri::async_runtime::block_on(local_db::init_offisim_db_state(app.handle()))
                .map_err(|e| format!("local_db init: {e}"))?;

            // Resolve the plaintext secret-file location once so non-command
            // callers (llm_transport) can read without an AppHandle.
            app.set_activation_policy(tauri::ActivationPolicy::Regular);
            runtime_secrets::init_storage(app.handle())
                .map_err(|e| format!("runtime_secrets init: {e}"))?;

            // macOS state restoration can relaunch the process without an
            // accessibility-visible main window after a previous close. Bring
            // the configured window back explicitly so release desktop live
            // verification and normal relaunches land on the usable app.
            {
                ensure_main_window(app.handle()).map_err(|e| format!("main window init: {e}"))?;
            }

            // Open devtools on launch. Gated only by the OFFISIM_DESKTOP_DEVTOOLS
            // env var at startup so live verify from release .app bundles can
            // flip it on (Computer Use only attaches to .app bundles, not to
            // `target/debug/offisim-desktop` bare binaries). Debug builds keep
            // the previous always-on behaviour.
            {
                use tauri::Manager;
                let force_devtools = std::env::var("OFFISIM_DESKTOP_DEVTOOLS")
                    .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                    .unwrap_or(false);
                if cfg!(debug_assertions) || force_devtools {
                    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                        window.open_devtools();
                    } else if let Some(window) = app.get_webview_window(MAIN_WINDOW_FALLBACK_LABEL)
                    {
                        window.open_devtools();
                    }
                }
            }

            // Register deep link scheme on platforms that need runtime registration
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            // Listen for incoming deep link URLs
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    deep_link::handle_deep_link_urls(&handle, event.urls().to_vec());
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            tauri::RunEvent::Ready | tauri::RunEvent::Resumed => {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
                let _ = ensure_main_window(app);
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } if !has_visible_windows => {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
                let _ = ensure_main_window(app);
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn capability(json: &str) -> Value {
        serde_json::from_str(json).expect("capability json parses")
    }

    fn assert_privileged_capability_is_main_window_only(capability: &Value) {
        let windows = capability
            .get("windows")
            .and_then(Value::as_array)
            .expect("windows array");
        assert_eq!(
            windows,
            &vec![
                Value::String(MAIN_WINDOW_LABEL.into()),
                Value::String(MAIN_WINDOW_FALLBACK_LABEL.into()),
            ]
        );
        assert!(capability.get("remote").is_none());
        assert!(capability.get("webviews").is_none());
    }

    #[test]
    fn agent_bridge_capability_does_not_expose_privileged_ipc_to_other_webviews() {
        let capability = capability(include_str!("../capabilities/agent-bridges.json"));
        assert_privileged_capability_is_main_window_only(&capability);
        let permissions = capability
            .get("permissions")
            .and_then(Value::as_array)
            .expect("permissions array");
        assert_eq!(permissions, &vec![Value::String("agent-bridges".into())]);
    }

    #[test]
    fn fs_shell_capability_does_not_expose_project_tools_to_other_webviews() {
        let capability = capability(include_str!("../capabilities/fs-shell.json"));
        assert_privileged_capability_is_main_window_only(&capability);
        let permissions = capability
            .get("permissions")
            .and_then(Value::as_array)
            .expect("permissions array");
        assert_eq!(permissions, &vec![Value::String("fs-shell".into())]);
    }
}
