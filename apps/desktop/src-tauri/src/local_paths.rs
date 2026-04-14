use std::path::Path;
use tokio::process::Command;

#[tauri::command]
pub async fn open_local_path(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is empty".into());
    }

    let target = Path::new(trimmed);
    if !target.exists() {
        return Err(format!("Path does not exist: {trimmed}"));
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(trimmed);
        cmd
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(trimmed);
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("explorer");
        cmd.arg(trimmed);
        cmd
    };

    let status = command
        .status()
        .await
        .map_err(|err| format!("Failed to launch file manager: {err}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("File manager exited with status {status}"))
    }
}
