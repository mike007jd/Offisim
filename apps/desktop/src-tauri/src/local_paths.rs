use sqlx::Row;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri::Runtime;
use tokio::process::Command;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeVaultStatus {
    path: String,
    display_path: String,
    employees: u64,
    files: u64,
    size_bytes: u64,
    size: String,
    available: bool,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalExportResult {
    path: String,
    display_path: String,
    file_name: String,
    size_bytes: u64,
    size: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeVaultFileStat {
    mtime_ms: u128,
    size: u64,
}

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

    open_path_in_file_manager(&target).await
}

#[tauri::command]
pub async fn runtime_vault_status<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<RuntimeVaultStatus, String> {
    let dir = runtime_vault_dir(&app)?;
    let stats = collect_vault_stats(&dir);
    Ok(RuntimeVaultStatus {
        display_path: display_path(&dir),
        path: dir.to_string_lossy().to_string(),
        employees: stats.employees,
        files: stats.files,
        size_bytes: stats.size_bytes,
        size: format_bytes(stats.size_bytes),
        available: dir.exists(),
    })
}

#[tauri::command]
pub async fn open_runtime_vault_folder<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let dir = runtime_vault_dir(&app)?;
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Failed to create local vault folder: {err}"))?;
    let canonical = dir
        .canonicalize()
        .map_err(|err| format!("Resolve local vault folder: {err}"))?;
    open_path_in_file_manager(&canonical).await
}

#[tauri::command]
pub async fn runtime_vault_read_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<String, String> {
    let (_root, target) = resolve_runtime_vault_target(&app, &path)?;
    fs::read_to_string(&target).map_err(|err| format!("Failed to read vault file: {err}"))
}

#[tauri::command]
pub async fn runtime_vault_write_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    content: String,
) -> Result<(), String> {
    // resolve_runtime_vault_target now returns a canonical target whose parent
    // has been created+canonicalized inside the vault root, so we no longer
    // need to re-check `ensure_inside(parent)` here.
    let (_root, target) = resolve_runtime_vault_target(&app, &path)?;
    fs::write(&target, content).map_err(|err| format!("Failed to write vault file: {err}"))
}

#[tauri::command]
pub async fn runtime_vault_list_dir<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<Vec<String>, String> {
    let (_root, target) = resolve_runtime_vault_target(&app, &path)?;
    if !target.exists() {
        return Ok(Vec::new());
    }
    let entries =
        fs::read_dir(&target).map_err(|err| format!("Failed to read vault directory: {err}"))?;
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|err| format!("Failed to read vault directory entry: {err}"))?;
        if let Some(name) = entry.file_name().to_str() {
            names.push(name.to_string());
        }
    }
    names.sort();
    Ok(names)
}

#[tauri::command]
pub async fn runtime_vault_stat<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<Option<RuntimeVaultFileStat>, String> {
    let (_root, target) = resolve_runtime_vault_target(&app, &path)?;
    if !target.exists() {
        return Ok(None);
    }
    let metadata =
        fs::metadata(&target).map_err(|err| format!("Failed to stat vault path: {err}"))?;
    let mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    Ok(Some(RuntimeVaultFileStat {
        mtime_ms,
        size: metadata.len(),
    }))
}

#[tauri::command]
pub async fn runtime_vault_remove<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<(), String> {
    let (_root, target) = resolve_runtime_vault_target(&app, &path)?;
    if !target.exists() {
        return Ok(());
    }
    let metadata =
        fs::metadata(&target).map_err(|err| format!("Failed to stat vault path: {err}"))?;
    if metadata.is_dir() {
        fs::remove_dir_all(&target)
            .map_err(|err| format!("Failed to remove vault directory: {err}"))
    } else {
        fs::remove_file(&target).map_err(|err| format!("Failed to remove vault file: {err}"))
    }
}

#[tauri::command]
pub async fn runtime_vault_mkdir<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<(), String> {
    let (_root, target) = resolve_runtime_vault_target(&app, &path)?;
    fs::create_dir_all(&target).map_err(|err| format!("Failed to create vault directory: {err}"))
}

#[tauri::command]
pub async fn export_runtime_vault_zip<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<LocalExportResult, String> {
    let vault_dir = runtime_vault_dir(&app)?;
    fs::create_dir_all(&vault_dir)
        .map_err(|err| format!("Failed to create local vault folder: {err}"))?;
    let vault_dir = vault_dir
        .canonicalize()
        .map_err(|err| format!("Resolve local vault folder: {err}"))?;

    let exports_dir = local_exports_dir(&app)?;
    fs::create_dir_all(&exports_dir)
        .map_err(|err| format!("Failed to create local exports folder: {err}"))?;
    let exports_dir = exports_dir
        .canonicalize()
        .map_err(|err| format!("Resolve local exports folder: {err}"))?;

    let file_name = format!("offisim-vault-{}.zip", unix_timestamp()?);
    let destination = exports_dir.join(&file_name);
    let source_dir = if directory_has_any_file(&vault_dir) {
        vault_dir
    } else {
        let staging = exports_dir.join(format!("vault-empty-{}", unix_timestamp()?));
        fs::create_dir_all(&staging)
            .map_err(|err| format!("Failed to create empty vault staging folder: {err}"))?;
        fs::write(
            staging.join("VAULT_EMPTY.txt"),
            "No vault markdown files were present.\n",
        )
        .map_err(|err| format!("Failed to write empty vault marker: {err}"))?;
        staging
    };

    create_zip_from_directory(&source_dir, &destination).await?;
    if source_dir
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("vault-empty-"))
    {
        let _ = fs::remove_dir_all(&source_dir);
    }
    local_export_result(destination, file_name)
}

#[tauri::command]
pub async fn export_scene_drop_diagnostic<R: Runtime>(
    app: tauri::AppHandle<R>,
    diagnostics_json: String,
) -> Result<LocalExportResult, String> {
    let exports_dir = local_exports_dir(&app)?;
    fs::create_dir_all(&exports_dir)
        .map_err(|err| format!("Failed to create local exports folder: {err}"))?;
    let exports_dir = exports_dir
        .canonicalize()
        .map_err(|err| format!("Resolve local exports folder: {err}"))?;
    let file_name = format!("scene-drop-diagnostic-{}.json", unix_timestamp()?);
    let destination = exports_dir.join(&file_name);
    serde_json::from_str::<serde_json::Value>(&diagnostics_json)
        .map_err(|err| format!("Scene diagnostic payload is not valid JSON: {err}"))?;
    fs::write(&destination, diagnostics_json)
        .map_err(|err| format!("Failed to write scene diagnostic export: {err}"))?;
    local_export_result(destination, file_name)
}

async fn create_zip_from_directory(source_dir: &Path, destination: &Path) -> Result<(), String> {
    let status = Command::new("zip")
        .arg("-qr")
        .arg(destination)
        .arg(".")
        .current_dir(source_dir)
        .status()
        .await
        .map_err(|err| format!("Failed to launch zip: {err}"))?;

    if !status.success() {
        return Err(format!("zip exited with status {status}"));
    }
    if !destination.exists() {
        return Err("zip command completed without creating an export".into());
    }
    Ok(())
}

async fn open_path_in_file_manager(target: &Path) -> Result<(), String> {
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

fn local_exports_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|err| format!("Resolve app local data directory: {err}"))?;
    Ok(base.join("exports"))
}

fn runtime_vault_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|err| format!("Resolve app local data directory: {err}"))?;
    Ok(base.join("vault"))
}

fn runtime_vault_root<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let dir = runtime_vault_dir(app)?;
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Failed to create local vault folder: {err}"))?;
    dir.canonicalize()
        .map_err(|err| format!("Resolve local vault folder: {err}"))
}

fn resolve_runtime_vault_target<R: Runtime>(
    app: &tauri::AppHandle<R>,
    relative: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let root = runtime_vault_root(app)?;
    let lexical = resolve_relative_target(&root, relative.trim())?;
    let canonical = canonicalize_or_parent(&lexical)?;
    ensure_inside(&canonical, &root)?;
    Ok((root, canonical))
}

// Canonicalize a target so that any symlinks along the path are resolved
// before comparing against the vault root. For not-yet-existing files we
// canonicalize the parent and reattach the basename — a symlinked *parent*
// pointing outside the vault is the realistic attack path.
fn canonicalize_or_parent(target: &Path) -> Result<PathBuf, String> {
    if let Ok(real) = fs::canonicalize(target) {
        return Ok(real);
    }
    let parent = target
        .parent()
        .ok_or_else(|| "vault target has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|err| format!("Failed to create vault parent directory: {err}"))?;
    let real_parent =
        fs::canonicalize(parent).map_err(|err| format!("Resolve vault parent directory: {err}"))?;
    let basename = target
        .file_name()
        .ok_or_else(|| "vault target has no basename".to_string())?;
    Ok(real_parent.join(basename))
}

fn unix_timestamp() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("System clock before UNIX epoch: {err}"))
        .map(|duration| duration.as_secs())
}

fn local_export_result(
    destination: PathBuf,
    file_name: String,
) -> Result<LocalExportResult, String> {
    let canonical = destination
        .canonicalize()
        .map_err(|err| format!("Resolve exported file: {err}"))?;
    let size_bytes = canonical
        .metadata()
        .map_err(|err| format!("Read exported file metadata: {err}"))?
        .len();
    Ok(LocalExportResult {
        display_path: display_path(&canonical),
        path: canonical.to_string_lossy().to_string(),
        file_name,
        size_bytes,
        size: format_bytes(size_bytes),
    })
}

#[derive(Default)]
struct VaultStats {
    employees: u64,
    files: u64,
    size_bytes: u64,
}

fn collect_vault_stats(root: &Path) -> VaultStats {
    let mut stats = VaultStats::default();
    collect_vault_stats_inner(root, &mut stats);
    stats
}

fn collect_vault_stats_inner(path: &Path, stats: &mut VaultStats) {
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            collect_vault_stats_inner(&path, stats);
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) == Some("md") {
            stats.files += 1;
            stats.size_bytes = stats.size_bytes.saturating_add(metadata.len());
            if path.file_name().and_then(|name| name.to_str()) == Some("employee.md") {
                stats.employees += 1;
            }
        }
    }
}

fn directory_has_any_file(path: &Path) -> bool {
    let Ok(entries) = fs::read_dir(path) else {
        return false;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            return true;
        }
        if path.is_dir() && directory_has_any_file(&path) {
            return true;
        }
    }
    false
}

fn display_path(path: &Path) -> String {
    if let Some(home) = dirs::home_dir() {
        if let Ok(relative) = path.strip_prefix(&home) {
            return format!("~/{}", relative.to_string_lossy());
        }
    }
    path.to_string_lossy().to_string()
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut value = bytes as f64;
    let mut unit = 0usize;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{} {}", bytes, UNITS[unit])
    } else {
        format!("{value:.1} {}", UNITS[unit])
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
    let destination = safe_write_under_root(&deliverables_dir, &safe_name, &content, &root)?;
    destination
        .strip_prefix(&root)
        .map_err(|_| "Saved path is outside project workspace".to_string())
        .map(|relative| relative.to_string_lossy().to_string())
}

fn safe_write_under_root(
    parent: &Path,
    leaf_name: &str,
    content: &str,
    root: &Path,
) -> Result<PathBuf, String> {
    let leaf = PathBuf::from(leaf_name);
    if leaf.is_absolute()
        || leaf
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("deliverable file name is invalid".into());
    }
    let canonical_parent = parent
        .canonicalize()
        .map_err(|err| format!("Resolve deliverables directory: {err}"))?;
    ensure_inside(&canonical_parent, root)?;
    let leaf_target = canonical_parent.join(&leaf);
    let mut opts = OpenOptions::new();
    opts.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = opts
        .open(&leaf_target)
        .map_err(|err| format!("Failed to write deliverable file: {err}"))?;
    file.write_all(content.as_bytes())
        .map_err(|err| format!("Failed to write deliverable file: {err}"))?;
    file.flush()
        .map_err(|err| format!("Failed to flush deliverable file: {err}"))?;
    leaf_target
        .canonicalize()
        .map_err(|err| format!("Resolve saved deliverable: {err}"))
        .and_then(|canonical| {
            ensure_inside(&canonical, root)?;
            Ok(canonical)
        })
}

async fn project_workspace_root<R: Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: &str,
) -> Result<PathBuf, String> {
    project_workspace_root_with(
        app,
        project_id,
        "projectId is required for local path commands",
    )
    .await
}

/// Single-project workspace-root lookup + canonicalize, shared by the
/// `local_paths` and `git` lanes. (The SDK agent-host lanes keep their own
/// copies because they return `HostError` with distinct error *codes* over IPC,
/// not the `String` this returns.)
///
/// `empty_id_error` lets each caller preserve its exact "projectId is required
/// for <X>" wording — the SQL, missing-row error, and canonicalize error are
/// identical across callers, so only that one message is parameterized.
pub(crate) async fn project_workspace_root_with<R: Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: &str,
    empty_id_error: &str,
) -> Result<PathBuf, String> {
    let project_id = project_id.trim();
    if project_id.is_empty() {
        return Err(empty_id_error.to_string());
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

    use std::sync::atomic::{AtomicU64, Ordering};
    static TEMP_ROOT_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_root() -> PathBuf {
        let id = TEMP_ROOT_COUNTER.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!(
            "offisim-local-paths-{}-{id}",
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

    #[test]
    fn vault_stats_count_markdown_and_employee_files() {
        let root = temp_root();
        let emp_dir = root.join("companies/c1/employees/alex");
        std::fs::create_dir_all(&emp_dir).unwrap();
        std::fs::write(emp_dir.join("employee.md"), "employee").unwrap();
        std::fs::write(emp_dir.join("memory.md"), "memory").unwrap();
        std::fs::write(emp_dir.join("ignore.json"), "{}").unwrap();
        let stats = collect_vault_stats(&root);
        assert_eq!(stats.employees, 1);
        assert_eq!(stats.files, 2);
        assert_eq!(stats.size_bytes, 14);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn byte_format_is_human_readable() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(1024), "1.0 KB");
    }

    #[cfg(unix)]
    #[test]
    fn canonicalize_or_parent_resolves_symlink_to_outside_target() {
        use std::os::unix::fs::symlink;

        let root = temp_root();
        let outside = temp_root();
        let outside_file = outside.join("secret.txt");
        std::fs::write(&outside_file, "leak").unwrap();

        // Inside vault, plant a symlink pointing at the outside file.
        let link_path = root.join("evil.md");
        symlink(&outside_file, &link_path).unwrap();

        let real = canonicalize_or_parent(&link_path).unwrap();
        // Real path resolves to the *outside* canonical file, which should NOT
        // be inside the root.
        assert!(
            ensure_inside(&real, &root).is_err(),
            "symlink target {real:?} should not be considered inside {root:?}"
        );

        std::fs::remove_dir_all(&root).ok();
        std::fs::remove_dir_all(&outside).ok();
    }

    #[cfg(unix)]
    #[test]
    fn canonicalize_or_parent_resolves_symlinked_parent_directory() {
        use std::os::unix::fs::symlink;

        let root = temp_root();
        let outside = temp_root();

        // Plant a symlink directory inside vault pointing to outside dir.
        let link_dir = root.join("attack-dir");
        symlink(&outside, &link_dir).unwrap();

        // Target inside the symlinked dir — file doesn't exist yet, so we go
        // through the canonicalize-parent branch.
        let write_target = link_dir.join("escape.txt");
        let real = canonicalize_or_parent(&write_target).unwrap();
        assert!(
            ensure_inside(&real, &root).is_err(),
            "write through symlinked parent {real:?} should not pass ensure_inside"
        );

        std::fs::remove_dir_all(&root).ok();
        std::fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn canonicalize_or_parent_returns_canonical_for_real_files_inside_root() {
        let root = temp_root();
        let nested = root.join("companies/c1/employees/alex/memory.md");
        std::fs::create_dir_all(nested.parent().unwrap()).unwrap();
        std::fs::write(&nested, "ok").unwrap();
        let real = canonicalize_or_parent(&nested).unwrap();
        ensure_inside(&real, &root).expect("real file in vault must pass");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn canonicalize_or_parent_handles_missing_target() {
        let root = temp_root();
        let new_file = root.join("companies/c1/skills/new/SKILL.md");
        // parent doesn't exist yet; canonicalize_or_parent should mkdir it.
        let real = canonicalize_or_parent(&new_file).unwrap();
        ensure_inside(&real, &root).expect("not-yet-existing file in vault must pass");
        std::fs::remove_dir_all(&root).ok();
    }
}
