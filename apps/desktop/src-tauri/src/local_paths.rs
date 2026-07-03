use sqlx::Row;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri::Runtime;
use tokio::process::Command;

pub(crate) const OVERBROAD_WORKSPACE_ROOT_ERROR: &str =
    "workspace_root is too broad; bind a specific project folder";
const OFFISIM_HOME_DIR: &str = ".offisim";
const LEGACY_STORAGE_CHILDREN: &[&str] = &[
    ".DS_Store",
    "offisim.db",
    "offisim.db-wal",
    "offisim.db-shm",
    "offisim.sqlite3",
    "offisim.db.pre-m2-backup",
    "offisim.db.pre-vm002-backup",
    "offisim.db.pre-vm002-backup-wal",
    "offisim.db.pre-vm002-backup-shm",
    "mcp-servers.json",
    "mcp-stdio-audit.jsonl",
    "shell-execution-audit.jsonl",
    "trusted-sidecar-audit.jsonl",
    "secret.key",
    "workspaces",
    "vault",
    "attachments",
    "exports",
    "pi-agent-sessions",
];

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

pub(crate) fn offisim_home_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(OFFISIM_HOME_DIR))
        .ok_or_else(|| "Resolve user home directory".to_string())
}

pub(crate) fn offisim_storage_path(child: impl AsRef<Path>) -> Result<PathBuf, String> {
    let root = offisim_home_dir()?;
    fs::create_dir_all(&root).map_err(|err| format!("Create ~/.offisim directory: {err}"))?;
    Ok(root.join(child))
}

pub(crate) fn offisim_storage_dir(child: impl AsRef<Path>) -> Result<PathBuf, String> {
    let dir = offisim_storage_path(child)?;
    fs::create_dir_all(&dir).map_err(|err| format!("Create Offisim storage directory: {err}"))?;
    Ok(dir)
}

pub(crate) fn offisim_sqlite_url() -> Result<String, String> {
    let db_path = offisim_storage_path("offisim.db")?;
    Ok(format!("sqlite://{}?mode=rwc", db_path.to_string_lossy()))
}

pub(crate) fn purge_legacy_app_storage<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let root = offisim_home_dir()?;
    fs::create_dir_all(&root).map_err(|err| format!("Create ~/.offisim directory: {err}"))?;

    let mut legacy_roots = Vec::new();
    for candidate in [
        app.path().app_config_dir().ok(),
        app.path().app_data_dir().ok(),
        app.path().app_local_data_dir().ok(),
    ]
    .into_iter()
    .flatten()
    {
        if candidate != root && !legacy_roots.iter().any(|known| known == &candidate) {
            legacy_roots.push(candidate);
        }
    }

    for legacy_root in legacy_roots {
        remove_legacy_children(&legacy_root)?;
    }
    Ok(())
}

fn remove_legacy_children(root: &Path) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(root)
        .map_err(|err| format!("Inspect legacy Offisim storage: {err}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Ok(());
    }

    for child in LEGACY_STORAGE_CHILDREN {
        let path = root.join(child);
        if path.exists() {
            remove_legacy_path(&path)?;
        }
    }
    Ok(())
}

fn remove_legacy_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|err| format!("Inspect legacy Offisim storage: {err}"))?;
    if metadata.file_type().is_symlink() || metadata.is_file() {
        fs::remove_file(path).map_err(|err| format!("Remove legacy Offisim storage file: {err}"))
    } else if metadata.is_dir() {
        fs::remove_dir_all(path)
            .map_err(|err| format!("Remove legacy Offisim storage directory: {err}"))
    } else {
        Ok(())
    }
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
pub async fn reveal_local_path<R: Runtime>(
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

    reveal_path_in_file_manager(&target).await
}

/// Provision (and return the canonical path of) a per-company default workspace
/// directory under the app's local data dir. This is the capability-first
/// fallback that guarantees the agent's file/shell tools always have a real,
/// sandbox-jailable working directory even before the user binds a project to a
/// real repo folder — mirroring how Codex / Claude Code default to a working
/// directory rather than refusing to run tools. The returned path is a deep
/// user-owned path (`~/.offisim/workspaces/<companyId>`), so it has
/// well over two path components and is never treated as an overbroad root by
/// the builtin-tool sandbox.
#[tauri::command]
pub async fn ensure_company_workspace<R: Runtime>(
    app: tauri::AppHandle<R>,
    company_id: String,
) -> Result<String, String> {
    let company_id = company_id.trim();
    if company_id.is_empty() {
        return Err("companyId is required".into());
    }
    let dir = company_workspace_dir(&app, company_id)?;
    fs::create_dir_all(&dir).map_err(|err| format!("Failed to create company workspace: {err}"))?;
    dir.canonicalize()
        .map_err(|err| format!("Resolve company workspace: {err}"))
        .map(|canonical| canonical.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn delete_company_workspace<R: Runtime>(
    app: tauri::AppHandle<R>,
    company_id: String,
) -> Result<(), String> {
    let company_id = company_id.trim();
    if company_id.is_empty() {
        return Err("companyId is required".into());
    }

    let parent = company_workspace_parent(&app)?;
    if !parent.exists() {
        return Ok(());
    }
    let canonical_parent = parent
        .canonicalize()
        .map_err(|err| format!("Resolve company workspaces directory: {err}"))?;
    let dir = company_workspace_dir(&app, company_id)?;
    if !dir.exists() {
        return Ok(());
    }

    let metadata = fs::symlink_metadata(&dir)
        .map_err(|err| format!("Inspect company workspace before delete: {err}"))?;
    if metadata.file_type().is_symlink() {
        return Err("company workspace is a symlink; refusing to delete".into());
    }
    let canonical_dir = dir
        .canonicalize()
        .map_err(|err| format!("Resolve company workspace before delete: {err}"))?;
    if canonical_dir == canonical_parent || !canonical_dir.starts_with(&canonical_parent) {
        return Err("company workspace is outside app data; refusing to delete".into());
    }

    if metadata.is_dir() {
        fs::remove_dir_all(&dir).map_err(|err| format!("Delete company workspace: {err}"))?;
    } else {
        fs::remove_file(&dir).map_err(|err| format!("Delete company workspace file: {err}"))?;
    }
    Ok(())
}

fn company_workspace_parent<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let _ = app;
    offisim_storage_dir("workspaces")
}

fn company_workspace_dir<R: Runtime>(
    app: &tauri::AppHandle<R>,
    company_id: &str,
) -> Result<PathBuf, String> {
    Ok(company_workspace_parent(app)?.join(sanitize_workspace_component(company_id)))
}

/// Reduce a company id to a safe single path component (alphanumerics, `-`, `_`).
/// Company ids are UUIDs in practice, but this fails safe against any future id
/// shape so a workspace dir can never escape the `workspaces/` parent.
fn sanitize_workspace_component(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "company".into()
    } else {
        trimmed
    }
}

pub(crate) fn is_overbroad_workspace_root(path: &Path) -> bool {
    if let Some(home) = dirs::home_dir().and_then(|home| home.canonicalize().ok()) {
        if path == home || home.parent().is_some_and(|parent| path == parent) {
            return true;
        }
    }
    let normals: Vec<_> = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(name) => Some(name),
            _ => None,
        })
        .collect();
    if normals.len() < 2 {
        return true;
    }
    // macOS canonicalize maps single-component privileged roots to /private/*
    // aliases. Only those aliases are overbroad; /private/my-project can still
    // be a concrete workspace.
    normals.len() == 2
        && normals[0] == std::ffi::OsStr::new("private")
        && matches!(normals[1].to_str(), Some("tmp" | "var" | "etc"))
}

pub(crate) fn resolve_project_workspace_root_path(
    raw_path: impl Into<PathBuf>,
) -> Result<PathBuf, String> {
    let raw_path = raw_path.into();
    if is_overbroad_workspace_root(&raw_path) {
        return Err(OVERBROAD_WORKSPACE_ROOT_ERROR.to_string());
    }
    let root = raw_path
        .canonicalize()
        .map_err(|err| format!("Resolve project workspace: {err}"))?;
    if is_overbroad_workspace_root(&root) {
        return Err(OVERBROAD_WORKSPACE_ROOT_ERROR.to_string());
    }
    Ok(root)
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
pub async fn export_computer_run_trace<R: Runtime>(
    app: tauri::AppHandle<R>,
    thread_id: String,
    run_id: String,
    trace_json: String,
) -> Result<LocalExportResult, String> {
    let exports_dir = local_exports_dir(&app)?;
    fs::create_dir_all(&exports_dir)
        .map_err(|err| format!("Failed to create local exports folder: {err}"))?;
    let exports_dir = exports_dir
        .canonicalize()
        .map_err(|err| format!("Resolve local exports folder: {err}"))?;
    let stamp = unix_timestamp()?;
    let file_name = computer_trace_file_name(&run_id, stamp);
    let destination = exports_dir.join(&file_name);
    let staging = exports_dir.join(format!(
        "computer-run-trace-{}-{stamp}",
        sanitize_file_name(&run_id).trim_end_matches(".txt")
    ));
    write_computer_trace_staging(&staging, &thread_id, &run_id, &trace_json, stamp)?;
    create_zip_from_directory(&staging, &destination).await?;
    let _ = fs::remove_dir_all(&staging);
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

fn computer_trace_file_name(run_id: &str, stamp: u64) -> String {
    let safe = sanitize_file_name(run_id);
    let safe = safe.trim_end_matches(".txt").trim();
    let safe = if safe.is_empty() { "run" } else { safe };
    format!("computer-run-{safe}-{stamp}.zip")
}

fn write_computer_trace_staging(
    staging: &Path,
    thread_id: &str,
    run_id: &str,
    trace_json: &str,
    exported_at: u64,
) -> Result<(), String> {
    let trace = serde_json::from_str::<serde_json::Value>(trace_json)
        .map_err(|err| format!("Computer trace payload is not valid JSON: {err}"))?;
    fs::create_dir_all(staging)
        .map_err(|err| format!("Failed to create computer trace staging folder: {err}"))?;
    let envelope = serde_json::json!({
        "threadId": thread_id,
        "runId": run_id,
        "exportedAtUnix": exported_at,
        "trace": trace,
    });
    let body = serde_json::to_string_pretty(&envelope)
        .map_err(|err| format!("Failed to serialize computer trace export: {err}"))?;
    fs::write(staging.join("trace.json"), body)
        .map_err(|err| format!("Failed to write computer trace export: {err}"))
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

async fn reveal_path_in_file_manager(target: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg("-R").arg(target);
        cmd
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(target.parent().unwrap_or(target));
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("explorer");
        cmd.arg(format!("/select,{}", target.to_string_lossy()));
        cmd
    };

    let status = command
        .status()
        .await
        .map_err(|err| format!("Failed to reveal local path: {err}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("File manager exited with status {status}"))
    }
}

fn local_exports_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let _ = app;
    offisim_storage_dir("exports")
}

fn runtime_vault_dir<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let _ = app;
    offisim_storage_dir("vault")
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
    resolve_project_workspace_root_path(raw)
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
    fn workspace_root_guard_rejects_overbroad_roots() {
        assert!(is_overbroad_workspace_root(Path::new("/")));
        assert!(is_overbroad_workspace_root(Path::new("/Users")));
        assert!(is_overbroad_workspace_root(Path::new("/tmp")));
        assert!(is_overbroad_workspace_root(Path::new("/private/tmp")));
        assert!(is_overbroad_workspace_root(Path::new("/private/var")));
        assert!(is_overbroad_workspace_root(Path::new("/private/etc")));
        assert!(!is_overbroad_workspace_root(Path::new(
            "/private/offisim-project"
        )));
        if let Some(home) = dirs::home_dir().and_then(|home| home.canonicalize().ok()) {
            assert!(is_overbroad_workspace_root(&home));
            if let Some(parent) = home.parent() {
                assert!(is_overbroad_workspace_root(parent));
            }
        }
    }

    #[test]
    fn workspace_root_resolver_rejects_raw_and_canonical_overbroad_roots() {
        assert_eq!(
            resolve_project_workspace_root_path(PathBuf::from("/tmp")).unwrap_err(),
            OVERBROAD_WORKSPACE_ROOT_ERROR
        );
        assert_eq!(
            resolve_project_workspace_root_path(PathBuf::from("/private/tmp")).unwrap_err(),
            OVERBROAD_WORKSPACE_ROOT_ERROR
        );
    }

    #[test]
    fn workspace_root_resolver_accepts_specific_project_folder() {
        let root = temp_root();
        let project = root.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let resolved = resolve_project_workspace_root_path(&project).unwrap();
        assert_eq!(resolved, project.canonicalize().unwrap());
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

    #[test]
    fn computer_trace_file_name_sanitizes_run_id() {
        assert_eq!(
            computer_trace_file_name("attempt:../abc", 42),
            "computer-run-attempt_.._abc-42.zip"
        );
    }

    #[test]
    fn computer_trace_staging_writes_trace_json() {
        let root = temp_root();
        let staging = root.join("trace");
        write_computer_trace_staging(
            &staging,
            "thread-1",
            "run-1",
            r#"{"entries":[{"action":"click"}]}"#,
            42,
        )
        .unwrap();
        let raw = std::fs::read_to_string(staging.join("trace.json")).unwrap();
        let value: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(value["threadId"], "thread-1");
        assert_eq!(value["runId"], "run-1");
        assert_eq!(value["trace"]["entries"][0]["action"], "click");
        std::fs::remove_dir_all(root).unwrap();
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
