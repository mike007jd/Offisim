mod agent_host_runtime;
mod attachment_store;
mod browser_session;
mod builtin_tools;
mod claude_agent_host;
mod codex_agent_host;
mod codex_pets;
mod computer_driver;
mod deep_link;
mod engine_skill_overlay;
#[cfg(target_os = "macos")]
mod escape_forwarder;
#[cfg(target_os = "macos")]
mod macos_window_activation {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSWindow};
    use objc2_foundation::{ns_string, NSUserDefaults};

    pub fn disable_state_restoration() {
        let defaults = NSUserDefaults::standardUserDefaults();
        defaults.setBool_forKey(false, ns_string!("NSQuitAlwaysKeepsWindows"));
    }

    pub fn raise_webview_window<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
        let Ok(ns_window) = window.ns_window() else {
            return;
        };
        raise_ns_window(ns_window);
    }

    pub fn raise_window<R: tauri::Runtime>(window: &tauri::Window<R>) {
        let Ok(ns_window) = window.ns_window() else {
            return;
        };
        raise_ns_window(ns_window);
    }

    fn raise_ns_window(ns_window: *mut std::ffi::c_void) {
        if ns_window.is_null() {
            return;
        }
        let Some(main_thread) = MainThreadMarker::new() else {
            return;
        };
        unsafe {
            let app = NSApplication::sharedApplication(main_thread);
            // SAFETY: `ns_window` came from Tauri's `ns_window()` for a live window.
            let ns_window = &*ns_window.cast::<NSWindow>();
            ns_window.setRestorable(false);
            ns_window.invalidateRestorableState();
            // `activate` alone can leave Tauri windows occluded until the first
            // real click; this call makes the release app immediately visible
            // to macOS accessibility tools and Computer Use.
            #[allow(deprecated)]
            app.activateIgnoringOtherApps(true);
            ns_window.makeKeyAndOrderFront(None);
            ns_window.orderFrontRegardless();
        }
    }
}
mod gh;
mod git;
mod in_flight;
mod local_db;
mod local_paths;
mod local_secret;
mod mcp_bridge;
mod pi_agent_host;
mod preview;
mod redaction;
mod shell_classifier;
mod sidecar_stderr;
mod stage_audit;
mod task_workspace_binding;
mod terminal_session;
mod workspace_recovery;

use std::path::Path;
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

const MAIN_WINDOW_LABEL: &str = "main";
const MAIN_WINDOW_FALLBACK_LABEL: &str = "main-live";

fn is_main_renderer_label(label: &str) -> bool {
    matches!(label, MAIN_WINDOW_LABEL | MAIN_WINDOW_FALLBACK_LABEL)
}

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

fn create_main_window_with_label<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
) -> tauri::Result<tauri::WebviewWindow<R>> {
    let window =
        tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App("index.html".into()))
            .title("Offisim")
            .inner_size(1440.0, 900.0)
            .min_inner_size(1024.0, 700.0)
            .visible(true)
            .focused(true)
            .center()
            .build()?;
    #[cfg(target_os = "macos")]
    macos_window_activation::raise_webview_window(&window);
    Ok(window)
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
    let _ = window.set_focus();
    #[cfg(target_os = "macos")]
    macos_window_activation::raise_webview_window(window);
    window.is_visible().unwrap_or(false)
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

fn schedule_ensure_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let scheduler = app.clone();
    let app_for_main_thread = app.clone();
    let _ = scheduler.run_on_main_thread(move || {
        let _ = app_for_main_thread.set_activation_policy(tauri::ActivationPolicy::Regular);
        if let Err(err) = ensure_main_window(&app_for_main_thread) {
            eprintln!("Offisim main window restore failed: {err}");
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    macos_window_activation::disable_state_restoration();

    tauri::Builder::default()
        // Single-instance MUST be registered first — the handler short-circuits
        // subsequent launches before any DB/plugin init runs. Without it a
        // second `cargo tauri dev` / binary launch hits the SQLite write lock
        // held by the running instance and the second window hangs with a black
        // webview. The callback focuses the existing window instead.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            schedule_ensure_main_window(app);
        }))
        .register_asynchronous_uri_scheme_protocol("offisim-media", |ctx, request, responder| {
            preview::serve_media(ctx.app_handle().clone(), request, responder);
        })
        .invoke_handler(tauri::generate_handler![
            local_db::local_db_execute,
            local_db::local_db_select,
            local_db::local_db_execute_transaction,
            local_db::global_search,
            builtin_tools::project_read_file,
            builtin_tools::project_read_file_lines,
            builtin_tools::project_read_file_preview,
            preview::project_preview_meta,
            preview::project_read_file_bytes,
            builtin_tools::project_exists,
            builtin_tools::project_list_dir,
            builtin_tools::project_write_file,
            builtin_tools::bash_execute,
            terminal_session::terminal_session_create,
            terminal_session::terminal_session_write,
            terminal_session::terminal_session_resize,
            terminal_session::terminal_session_snapshot,
            terminal_session::terminal_session_list_scoped,
            terminal_session::terminal_session_close,
            browser_session::browser_session_create,
            browser_session::browser_session_navigate,
            browser_session::browser_session_back,
            browser_session::browser_session_forward,
            browser_session::browser_session_reload,
            browser_session::browser_session_set_bounds,
            browser_session::browser_session_set_visible,
            browser_session::browser_session_snapshot,
            browser_session::browser_session_list_scoped,
            browser_session::browser_session_close,
            codex_pets::codex_pets_list,
            codex_pets::codex_pet_load,
            codex_agent_host::commands::codex_agent_execute,
            codex_agent_host::commands::codex_agent_resume,
            codex_agent_host::commands::codex_agent_enhance,
            codex_agent_host::commands::codex_agent_abort,
            codex_agent_host::commands::codex_agent_answer,
            codex_agent_host::commands::codex_agent_stream_snapshot,
            codex_agent_host::commands::codex_agent_release_stream,
            codex_agent_host::commands::codex_agent_reattach,
            codex_agent_host::commands::codex_agent_status,
            claude_agent_host::commands::claude_agent_execute,
            claude_agent_host::commands::claude_agent_resume,
            claude_agent_host::commands::claude_agent_enhance,
            claude_agent_host::commands::claude_agent_abort,
            claude_agent_host::commands::claude_agent_answer,
            claude_agent_host::commands::claude_agent_stream_snapshot,
            claude_agent_host::commands::claude_agent_release_stream,
            claude_agent_host::commands::claude_agent_reattach,
            claude_agent_host::commands::claude_agent_status,
            pi_agent_host::pi_agent_open_config_folder,
            pi_agent_host::pi_agent_status,
            pi_agent_host::pi_agent_save_provider,
            pi_agent_host::agent_runtime_execute,
            pi_agent_host::agent_runtime_enhance,
            pi_agent_host::agent_runtime_collaborate,
            pi_agent_host::agent_runtime_resume,
            pi_agent_host::agent_runtime_abort,
            pi_agent_host::agent_runtime_control,
            pi_agent_host::agent_runtime_confirm_execution,
            pi_agent_host::agent_runtime_answer,
            pi_agent_host::agent_runtime_stream_snapshot,
            pi_agent_host::agent_runtime_release_stream,
            pi_agent_host::agent_runtime_reattach,
            pi_agent_host::agent_runtime_status,
            computer_driver::computer_driver_status,
            git::git_exec,
            gh::gh_exec,
            git::workspace_lease_list,
            git::workspace_lease_changed,
            git::workspace_lease_apply_patch,
            git::workspace_lease_release,
            git::workspace_lease_discard,
            git::workspace_checkpoint_timeline,
            git::workspace_checkpoint_rollback,
            local_paths::open_local_path,
            local_paths::reveal_local_path,
            local_paths::delete_company_workspace,
            local_paths::runtime_vault_status,
            local_paths::open_runtime_vault_folder,
            local_paths::runtime_vault_read_file,
            local_paths::runtime_vault_write_file,
            local_paths::runtime_vault_list_dir,
            local_paths::runtime_vault_stat,
            local_paths::runtime_vault_remove,
            local_paths::runtime_vault_mkdir,
            local_paths::export_runtime_vault_zip,
            local_paths::export_computer_run_trace,
            local_paths::export_scene_drop_diagnostic,
            local_paths::save_deliverable_to_local,
            task_workspace_binding::project_workspace_select,
            task_workspace_binding::project_create,
            task_workspace_binding::project_update,
            task_workspace_binding::project_update_status,
            task_workspace_binding::task_workspace_resume_compatibility,
            task_workspace_binding::task_workspace_interrupted_run_cancel,
            task_workspace_binding::task_workspace_deletion_preflight,
            task_workspace_binding::task_workspace_evaluation_lease_acquire,
            task_workspace_binding::task_workspace_evaluation_lease_release,
            mcp_bridge::commands::mcp_list_registered_servers,
            mcp_bridge::commands::mcp_register_server,
            mcp_bridge::commands::mcp_unregister_server,
            mcp_bridge::commands::mcp_connect_registered,
            mcp_bridge::commands::mcp_call_tool,
            mcp_bridge::commands::mcp_kill,
            mcp_bridge::commands::mcp_list_servers,
            attachment_store::attachment_write,
            attachment_store::attachment_read,
            attachment_store::attachment_list,
            attachment_store::attachment_list_all,
            attachment_store::attachment_delete,
            attachment_store::attachment_delete_company,
            local_secret::secret_encrypt,
            local_secret::secret_decrypt,
        ])
        .plugin(tauri_plugin_cors_fetch::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(mcp_bridge::init())
        .manage(terminal_session::TerminalSessionRegistry::default())
        .manage(browser_session::BrowserSessionRegistry::default())
        .manage(task_workspace_binding::ProjectWorkspaceSelectionRegistry::default())
        .manage(task_workspace_binding::TaskWorkspaceBindingRegistry::default())
        .manage(codex_agent_host::CodexAgentHostState::default())
        .on_webview_event(|webview, event| {
            if !is_main_renderer_label(webview.label()) {
                return;
            }
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
                        x: position.x,
                        y: position.y,
                    },
                };
                let _ = webview.emit("offisim-native-file-drop", payload);
            }
        })
        .on_page_load(|webview, payload| {
            if !is_main_renderer_label(webview.label()) {
                return;
            }
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let window = webview.window();
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                #[cfg(target_os = "macos")]
                macos_window_activation::raise_window(&window);
            }
        })
        .setup(|app| {
            tauri::async_runtime::block_on(local_db::init_offisim_db_state(app.handle()))
                .map_err(|e| format!("local_db init: {e}"))?;
            tauri::async_runtime::block_on(task_workspace_binding::mark_orphaned_bindings_revoked(
                app.handle(),
            ))
            .map_err(|e| format!("task workspace binding cleanup: {e}"))?;

            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            // macOS state restoration can relaunch the process without an
            // accessibility-visible main window after a previous close. Bring
            // the configured window back explicitly so release desktop live
            // verification and normal relaunches land on the usable app.
            {
                ensure_main_window(app.handle()).map_err(|e| format!("main window init: {e}"))?;
            }

            // Forward bare Escape past wry's swallowed keyDown (must run on
            // the main thread; Tauri's setup hook already does).
            #[cfg(target_os = "macos")]
            escape_forwarder::install(app.handle().clone());

            // Open devtools on launch. Only compiled into debug builds or
            // live-verify builds made with `--features devtools`; the ship
            // release channel has no devtools at all (`open_devtools` does not
            // exist without the cargo feature). Within a devtools-capable
            // build, release behaviour is still gated on the
            // OFFISIM_DESKTOP_DEVTOOLS env var at startup.
            #[cfg(any(debug_assertions, feature = "devtools"))]
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
            tauri::RunEvent::Exit => {
                app.state::<browser_session::BrowserSessionRegistry>()
                    .close_all(app);
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

    fn assert_privileged_capability_is_main_webview_only(capability: &Value) {
        let webviews = capability
            .get("webviews")
            .and_then(Value::as_array)
            .expect("webviews array");
        assert_eq!(
            webviews,
            &vec![
                Value::String(MAIN_WINDOW_LABEL.into()),
                Value::String(MAIN_WINDOW_FALLBACK_LABEL.into()),
            ]
        );
        assert!(capability.get("remote").is_none());
        assert!(capability.get("windows").is_none());
        assert!(!webviews.iter().any(|label| {
            label
                .as_str()
                .is_some_and(|value| value == "browser-*" || value.starts_with("browser-"))
        }));
    }

    #[test]
    fn agent_bridge_capability_does_not_expose_privileged_ipc_to_other_webviews() {
        let capability = capability(include_str!("../capabilities/agent-bridges.json"));
        assert_privileged_capability_is_main_webview_only(&capability);
        let permissions = capability
            .get("permissions")
            .and_then(Value::as_array)
            .expect("permissions array");
        assert_eq!(permissions, &vec![Value::String("agent-bridges".into())]);
    }

    #[test]
    fn fs_shell_capability_does_not_expose_project_tools_to_other_webviews() {
        let capability = capability(include_str!("../capabilities/fs-shell.json"));
        assert_privileged_capability_is_main_webview_only(&capability);
        let permissions = capability
            .get("permissions")
            .and_then(Value::as_array)
            .expect("permissions array");
        assert_eq!(permissions, &vec![Value::String("fs-shell".into())]);
    }

    #[test]
    fn github_capability_is_main_window_only() {
        let capability = capability(include_str!("../capabilities/github.json"));
        assert_privileged_capability_is_main_webview_only(&capability);
        let permissions = capability
            .get("permissions")
            .and_then(Value::as_array)
            .expect("permissions array");
        assert_eq!(permissions, &vec![Value::String("github".into())]);
    }

    #[test]
    fn codex_pets_capability_is_main_window_only() {
        let capability = capability(include_str!("../capabilities/codex-pets.json"));
        assert_privileged_capability_is_main_webview_only(&capability);
        let permissions = capability
            .get("permissions")
            .and_then(Value::as_array)
            .expect("permissions array");
        assert_eq!(permissions, &vec![Value::String("codex-pets".into())]);
    }

    #[test]
    fn remote_browser_children_are_not_main_renderers() {
        assert!(is_main_renderer_label(MAIN_WINDOW_LABEL));
        assert!(is_main_renderer_label(MAIN_WINDOW_FALLBACK_LABEL));
        assert!(!is_main_renderer_label("browser-session-1"));
        assert!(!is_main_renderer_label("external"));
    }

    #[test]
    fn default_capability_is_main_webview_only() {
        let capability = capability(include_str!("../capabilities/default.json"));
        assert_privileged_capability_is_main_webview_only(&capability);
    }
}
