use sqlx::Row;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::Runtime;
use tokio::process::Command;

#[tauri::command]
pub async fn open_local_path<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
    path: String,
) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is empty".into());
    }

    let root = project_workspace_root(&app, &project_id).await?;
    let target = resolve_relative_target(&root, trimmed)?;
    if !target.exists() {
        return Err("Path does not exist in project workspace".into());
    }
    let target = target
        .canonicalize()
        .map_err(|err| format!("Resolve local path: {err}"))?;
    ensure_inside(&target, &root)?;

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(&target);
        cmd
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(&target);
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("explorer");
        cmd.arg(&target);
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
pub async fn save_deliverable_to_local<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
    file_name: String,
    content: String,
) -> Result<String, String> {
    let root = project_workspace_root(&app, &project_id).await?;
    let deliverables_dir = root.join("deliverables");
    fs::create_dir_all(&deliverables_dir)
        .map_err(|err| format!("Failed to create deliverables directory: {err}"))?;
    let deliverables_dir = deliverables_dir
        .canonicalize()
        .map_err(|err| format!("Resolve deliverables directory: {err}"))?;
    ensure_inside(&deliverables_dir, &root)?;

    let safe_name = sanitize_file_name(&file_name);
    let destination = deliverables_dir.join(safe_name);
    fs::write(&destination, content)
        .map_err(|err| format!("Failed to write deliverable file: {err}"))?;
    let canonical = destination
        .canonicalize()
        .map_err(|err| format!("Resolve saved deliverable: {err}"))?;
    ensure_inside(&canonical, &root)?;
    canonical
        .strip_prefix(&root)
        .map_err(|_| "Saved path is outside project workspace".to_string())
        .map(|relative| relative.to_string_lossy().to_string())
}

async fn project_workspace_root<R: Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: &str,
) -> Result<PathBuf, String> {
    let project_id = project_id.trim();
    if project_id.is_empty() {
        return Err("projectId is required for local path commands".into());
    }
    let pool = crate::local_db::get_offisim_pool(app).map_err(|err| {
        eprintln!("[local_paths] {err}");
        "open offisim.db failed".to_string()
    })?;
    let row = sqlx::query(
        r#"
        SELECT workspace_root
        FROM projects
        WHERE project_id = ?
          AND workspace_root IS NOT NULL
          AND trim(workspace_root) <> ''
        "#,
    )
    .bind(project_id)
    .fetch_optional(&pool)
    .await
    .map_err(|err| {
        eprintln!("[local_paths] project workspace lookup failed: {err}");
        "project workspace lookup failed".to_string()
    })?
    .ok_or_else(|| "No workspace_root is bound for this project".to_string())?;
    let raw: String = row
        .try_get("workspace_root")
        .map_err(|err| format!("decode workspace_root: {err}"))?;
    let root = PathBuf::from(raw)
        .canonicalize()
        .map_err(|err| format!("Resolve project workspace: {err}"))?;
    Ok(root)
}

fn resolve_relative_target(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let input = PathBuf::from(relative);
    if input.is_absolute() {
        return Err("absolute paths are not allowed for project local path commands".into());
    }
    if input
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("parent-directory path segments are not allowed".into());
    }
    Ok(root.join(input))
}

fn ensure_inside(candidate: &Path, root: &Path) -> Result<(), String> {
    if candidate.starts_with(root) {
        Ok(())
    } else {
        Err("path is outside the bound project workspace".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "offisim-local-paths-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    #[test]
    fn local_path_rejects_absolute_and_parent_segments() {
        let root = temp_root();
        assert!(resolve_relative_target(&root, "/tmp/outside").is_err());
        assert!(resolve_relative_target(&root, "../outside").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deliverable_file_name_is_sanitized_under_deliverables_target() {
        assert_eq!(sanitize_file_name("../secret:key.txt"), "_secret_key.txt");
        assert_eq!(sanitize_file_name("..."), "deliverable.txt");
    }
}
