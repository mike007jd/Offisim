use std::fs;
use std::path::{Path, PathBuf};
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

fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "deliverable.txt".into()
    } else {
        trimmed
    }
}

#[tauri::command]
pub fn save_deliverable_to_local(
    root: String,
    file_name: String,
    content: String,
) -> Result<String, String> {
    let trimmed_root = root.trim();
    if trimmed_root.is_empty() {
        return Err("Root path is empty".into());
    }

    let root_path = PathBuf::from(trimmed_root);
    if !root_path.exists() {
        return Err(format!("Root path does not exist: {trimmed_root}"));
    }

    let deliverables_dir = root_path.join("deliverables");
    fs::create_dir_all(&deliverables_dir)
        .map_err(|err| format!("Failed to create deliverables directory: {err}"))?;

    let safe_name = sanitize_file_name(&file_name);
    let destination = deliverables_dir.join(safe_name);
    fs::write(&destination, content)
        .map_err(|err| format!("Failed to write deliverable file: {err}"))?;

    destination
        .to_str()
        .map(|path| path.to_string())
        .ok_or_else(|| "Saved path is not valid UTF-8".into())
}
