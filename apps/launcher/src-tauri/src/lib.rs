mod error;
mod network;
mod port_checker;
mod process_manager;

use process_manager::{LaunchMode, LauncherState, LauncherStatus, LogLine};
use tauri::Manager;

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

#[tauri::command(async)]
async fn launch_mode(
    mode: LaunchMode,
    state: tauri::State<'_, LauncherState>,
    app: tauri::AppHandle,
) -> Result<(), error::LauncherError> {
    state.launch_mode(mode, &app).await
}

#[tauri::command(async)]
async fn stop_mode(
    state: tauri::State<'_, LauncherState>,
    app: tauri::AppHandle,
) -> Result<(), error::LauncherError> {
    state.stop_frontend(&app).await
}

#[tauri::command(async)]
async fn stop_all(
    state: tauri::State<'_, LauncherState>,
    app: tauri::AppHandle,
) -> Result<(), error::LauncherError> {
    state.stop_all(&app).await
}

#[tauri::command(async)]
async fn restart_platform(
    state: tauri::State<'_, LauncherState>,
    app: tauri::AppHandle,
) -> Result<(), error::LauncherError> {
    state.restart_platform(&app).await
}

#[tauri::command(async)]
async fn get_status(
    state: tauri::State<'_, LauncherState>,
) -> Result<LauncherStatus, error::LauncherError> {
    Ok(state.get_status().await)
}

#[tauri::command(async)]
async fn get_logs(
    process: String,
    state: tauri::State<'_, LauncherState>,
) -> Result<Vec<LogLine>, error::LauncherError> {
    Ok(state.get_logs(&process).await)
}

// ---------------------------------------------------------------------------
// App entry
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Derive repo root: launcher lives at <repo>/apps/launcher/src-tauri
    // So repo root is 3 levels up from the executable's manifest dir.
    // In dev mode, use CARGO_MANIFEST_DIR; in production, resolve from exe path.
    let repo_root = resolve_repo_root();

    tauri::Builder::default()
        .setup(move |app| {
            app.manage(LauncherState::new(repo_root));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launch_mode,
            stop_mode,
            stop_all,
            restart_platform,
            get_status,
            get_logs,
        ])
        .on_window_event(|window, event| {
            // Clean up all processes when the launcher window closes
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle().clone();
                let state = app.state::<LauncherState>();
                let state_clone = state.inner().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = state_clone.stop_all_owned().await;
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Offisim Launcher");
}

fn resolve_repo_root() -> String {
    // In dev: CARGO_MANIFEST_DIR = <repo>/apps/launcher/src-tauri
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        if let Some(repo) = std::path::Path::new(&manifest_dir)
            .parent()  // apps/launcher
            .and_then(|p| p.parent())  // apps
            .and_then(|p| p.parent())  // repo root
        {
            return repo.to_string_lossy().to_string();
        }
    }

    // Fallback: try to find repo root from executable location
    if let Ok(exe) = std::env::current_exe() {
        let mut path = exe.as_path();
        // Walk up until we find package.json + pnpm-workspace.yaml
        for _ in 0..10 {
            if let Some(parent) = path.parent() {
                if parent.join("pnpm-workspace.yaml").exists() {
                    return parent.to_string_lossy().to_string();
                }
                path = parent;
            }
        }
    }

    // Last resort: current directory
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string())
}
