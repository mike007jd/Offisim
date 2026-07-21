use std::fs;
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
    #[cfg(unix)]
    {
        use std::io::Read;
        use std::os::unix::fs::MetadataExt;
        let (root, target) = resolve_runtime_vault_lexical(&app, &path)?;
        let anchored = open_vault_parent_anchored(&root, &target, true)?;
        let mut file = open_vault_leaf_anchored(&anchored, false)?
            .ok_or_else(|| "Failed to read vault file: file not found".to_string())?;
        let metadata = file
            .metadata()
            .map_err(|error| format!("Inspect opened vault file: {error}"))?;
        if !metadata.is_file() || metadata.nlink() != 1 {
            return Err("Vault read target must be a single-linked regular file".into());
        }
        let mut content = String::new();
        file.read_to_string(&mut content)
            .map_err(|error| format!("Failed to read vault file: {error}"))?;
        return Ok(content);
    }
    #[cfg(not(unix))]
    {
        let (_root, target) = resolve_runtime_vault_target(&app, &path)?;
        fs::read_to_string(&target).map_err(|err| format!("Failed to read vault file: {err}"))
    }
}

#[tauri::command]
pub async fn runtime_vault_write_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    content: String,
) -> Result<(), String> {
    #[cfg(unix)]
    {
        let (root, target) = resolve_runtime_vault_lexical(&app, &path)?;
        let anchored = open_vault_parent_anchored(&root, &target, true)?;
        return write_vault_file_anchored(&anchored, content.as_bytes());
    }
    #[cfg(not(unix))]
    {
        // resolve_runtime_vault_target now returns a canonical target whose parent
        // has been created+canonicalized inside the vault root, so we no longer
        // need to re-check `ensure_inside(parent)` here.
        let (_root, target) = resolve_runtime_vault_target(&app, &path)?;
        fs::write(&target, content).map_err(|err| format!("Failed to write vault file: {err}"))
    }
}

#[tauri::command]
pub async fn runtime_vault_list_dir<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<Vec<String>, String> {
    #[cfg(unix)]
    {
        let (root, target) = resolve_runtime_vault_lexical(&app, &path)?;
        let directory = if target == root {
            open_vault_root_anchored(&root)?
        } else {
            let anchored = open_vault_parent_anchored(&root, &target, true)?;
            let Some(directory) = open_vault_leaf_anchored(&anchored, true)? else {
                return Ok(Vec::new());
            };
            directory
        };
        return opened_directory_entry_names(&directory).map(|entries| {
            entries
                .into_iter()
                .filter_map(|name| name.into_string().ok())
                .collect()
        });
    }
    #[cfg(not(unix))]
    {
        let (_root, target) = resolve_runtime_vault_target(&app, &path)?;
        if !target.exists() {
            return Ok(Vec::new());
        }
        let entries = fs::read_dir(&target)
            .map_err(|err| format!("Failed to read vault directory: {err}"))?;
        let mut names = Vec::new();
        for entry in entries {
            let entry =
                entry.map_err(|err| format!("Failed to read vault directory entry: {err}"))?;
            if let Some(name) = entry.file_name().to_str() {
                names.push(name.to_string());
            }
        }
        names.sort();
        Ok(names)
    }
}

#[tauri::command]
pub async fn runtime_vault_stat<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<Option<RuntimeVaultFileStat>, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let (root, target) = resolve_runtime_vault_lexical(&app, &path)?;
        let metadata = if target == root {
            open_vault_root_anchored(&root)?.metadata()
        } else {
            let anchored = open_vault_parent_anchored(&root, &target, true)?;
            let Some(file) = open_vault_leaf_anchored(&anchored, false)? else {
                return Ok(None);
            };
            file.metadata()
        }
        .map_err(|error| format!("Failed to stat vault path: {error}"))?;
        if metadata.is_file() && metadata.nlink() != 1 {
            return Err("Vault stat refuses multiply-linked files".into());
        }
        let mtime_ms = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        return Ok(Some(RuntimeVaultFileStat {
            mtime_ms,
            size: metadata.len(),
        }));
    }
    #[cfg(not(unix))]
    {
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
}

#[tauri::command]
pub async fn runtime_vault_remove<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<(), String> {
    #[cfg(unix)]
    {
        let (root, target) = resolve_runtime_vault_lexical(&app, &path)?;
        if target == root {
            return Err("Refusing to remove the runtime vault root".into());
        }
        let anchored = open_vault_parent_anchored(&root, &target, true)?;
        return remove_vault_target_anchored(&anchored);
    }
    #[cfg(not(unix))]
    {
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
}

#[tauri::command]
pub async fn runtime_vault_mkdir<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<(), String> {
    #[cfg(unix)]
    {
        let (root, target) = resolve_runtime_vault_lexical(&app, &path)?;
        open_vault_directory_anchored(&root, &target, true)?;
        return Ok(());
    }
    #[cfg(not(unix))]
    {
        let (_root, target) = resolve_runtime_vault_target(&app, &path)?;
        fs::create_dir_all(&target)
            .map_err(|err| format!("Failed to create vault directory: {err}"))
    }
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

    let stamp = unix_timestamp()?;
    let nonce = rand::random::<u64>();
    let file_name = format!("offisim-vault-{stamp}-{nonce:016x}.zip");
    let destination = exports_dir.join(&file_name);
    let staging = exports_dir.join(format!(
        ".vault-export-staging-{}-{nonce:016x}",
        std::process::id()
    ));
    snapshot_vault_for_export(&vault_dir, &staging)?;
    let export_result = async {
        if !directory_has_any_file(&staging) {
            fs::write(
                staging.join("VAULT_EMPTY.txt"),
                "No vault markdown files were present.\n",
            )
            .map_err(|err| format!("Failed to write empty vault marker: {err}"))?;
        }
        create_zip_from_directory(&staging, &destination).await
    }
    .await;
    let _ = fs::remove_dir_all(&staging);
    export_result?;
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

#[cfg(unix)]
struct VaultDirectoryStream(*mut libc::DIR);

#[cfg(unix)]
impl Drop for VaultDirectoryStream {
    fn drop(&mut self) {
        unsafe {
            libc::closedir(self.0);
        }
    }
}

#[cfg(unix)]
fn opened_directory_entry_names(directory: &fs::File) -> Result<Vec<std::ffi::OsString>, String> {
    use std::ffi::CStr;
    use std::os::fd::AsRawFd;
    use std::os::unix::ffi::OsStrExt;

    let duplicated = unsafe { libc::fcntl(directory.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
    if duplicated < 0 {
        return Err(format!(
            "Duplicate vault directory handle: {}",
            std::io::Error::last_os_error()
        ));
    }
    let stream = unsafe { libc::fdopendir(duplicated) };
    if stream.is_null() {
        let error = std::io::Error::last_os_error();
        unsafe {
            libc::close(duplicated);
        }
        return Err(format!("Read opened vault directory: {error}"));
    }
    let stream = VaultDirectoryStream(stream);
    unsafe {
        libc::rewinddir(stream.0);
    }
    let mut names = Vec::new();
    loop {
        let entry = unsafe { libc::readdir(stream.0) };
        if entry.is_null() {
            break;
        }
        let bytes = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
        if matches!(bytes, b"." | b"..") {
            continue;
        }
        names.push(std::ffi::OsStr::from_bytes(bytes).to_os_string());
    }
    names.sort();
    Ok(names)
}

#[cfg(unix)]
fn snapshot_opened_vault_directory(source: &fs::File, destination: &Path) -> Result<(), String> {
    use std::ffi::CString;
    use std::io::{Seek, SeekFrom};
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};

    for name in opened_directory_entry_names(source)? {
        let encoded = CString::new(name.as_bytes())
            .map_err(|_| "Vault entry contains a NUL byte".to_string())?;
        let descriptor = unsafe {
            libc::openat(
                source.as_raw_fd(),
                encoded.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
            )
        };
        if descriptor < 0 {
            let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
            let inspected = unsafe {
                libc::fstatat(
                    source.as_raw_fd(),
                    encoded.as_ptr(),
                    stat.as_mut_ptr(),
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            };
            if inspected == 0
                && unsafe { stat.assume_init() }.st_mode & libc::S_IFMT == libc::S_IFLNK
            {
                continue;
            }
            return Err(format!(
                "Open vault export entry without following links: {}",
                std::io::Error::last_os_error()
            ));
        }
        let mut entry = fs::File::from(unsafe { OwnedFd::from_raw_fd(descriptor) });
        let metadata = entry
            .metadata()
            .map_err(|error| format!("Inspect opened vault export entry: {error}"))?;
        let target = destination.join(&name);
        if metadata.is_dir() {
            let mut builder = fs::DirBuilder::new();
            builder.mode(0o700);
            builder
                .create(&target)
                .map_err(|error| format!("Create vault export directory: {error}"))?;
            snapshot_opened_vault_directory(&entry, &target)?;
        } else if metadata.is_file() {
            use std::os::unix::fs::MetadataExt;
            if metadata.nlink() != 1 {
                return Err("Vault export refuses multiply-linked files".into());
            }
            entry
                .seek(SeekFrom::Start(0))
                .map_err(|error| format!("Rewind vault export file: {error}"))?;
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&target)
                .map_err(|error| format!("Create vault export file: {error}"))?;
            std::io::copy(&mut entry, &mut output)
                .map_err(|error| format!("Copy vault export file: {error}"))?;
            output
                .sync_all()
                .map_err(|error| format!("Sync vault export file: {error}"))?;
        } else {
            return Err("Vault export refuses unsupported filesystem entries".into());
        }
    }
    Ok(())
}

#[cfg(unix)]
fn snapshot_vault_for_export(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::unix::fs::DirBuilderExt;

    let source = open_vault_root_anchored(source)?;
    let mut builder = fs::DirBuilder::new();
    builder.mode(0o700);
    builder
        .create(destination)
        .map_err(|error| format!("Create vault export snapshot: {error}"))?;
    if let Err(error) = snapshot_opened_vault_directory(&source, destination) {
        let _ = fs::remove_dir_all(destination);
        return Err(error);
    }
    Ok(())
}

#[cfg(not(unix))]
fn snapshot_vault_for_export(_source: &Path, _destination: &Path) -> Result<(), String> {
    Err("Secure vault export is unavailable on this platform".into())
}

async fn open_path_in_file_manager(target: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(target);
        cmd
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(target);
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("explorer");
        cmd.arg(target);
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

#[cfg(unix)]
fn resolve_runtime_vault_lexical<R: Runtime>(
    app: &tauri::AppHandle<R>,
    relative: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let root = runtime_vault_root(app)?;
    let target = resolve_relative_target(&root, relative.trim())?;
    Ok((root, target))
}

#[cfg(not(unix))]
fn resolve_runtime_vault_target<R: Runtime>(
    app: &tauri::AppHandle<R>,
    relative: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let root = runtime_vault_root(app)?;
    let lexical = resolve_relative_target(&root, relative.trim())?;
    let canonical = canonicalize_or_parent(&root, &lexical)?;
    Ok((root, canonical))
}

// Canonicalize a target so that any symlinks along the path are resolved
// before comparing against the vault root. For not-yet-existing files we
// canonicalize the parent and reattach the basename — a symlinked *parent*
// pointing outside the vault is the realistic attack path.
#[cfg(any(not(unix), test))]
fn canonicalize_or_parent(root: &Path, target: &Path) -> Result<PathBuf, String> {
    if let Ok(real) = fs::canonicalize(target) {
        ensure_inside(&real, root)?;
        return Ok(real);
    }
    let parent = target
        .parent()
        .ok_or_else(|| "vault target has no parent directory".to_string())?;

    #[cfg(unix)]
    create_vault_parent_anchored(root, parent)?;

    #[cfg(not(unix))]
    {
        // Find and validate the nearest existing ancestor before creating anything.
        // Otherwise `create_dir_all` can follow an in-vault symlink and create
        // attacker-chosen directories outside the vault before the containment
        // check gets a chance to reject the target.
        let mut existing_ancestor = parent;
        loop {
            match fs::symlink_metadata(existing_ancestor) {
                Ok(_) => break,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                    existing_ancestor = existing_ancestor.parent().ok_or_else(|| {
                        "vault target has no existing parent directory".to_string()
                    })?;
                }
                Err(err) => return Err(format!("Inspect vault parent directory: {err}")),
            }
        }
        let real_ancestor = fs::canonicalize(existing_ancestor)
            .map_err(|err| format!("Resolve vault parent directory: {err}"))?;
        ensure_inside(&real_ancestor, root)?;

        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create vault parent directory: {err}"))?;
    }
    let real_parent =
        fs::canonicalize(parent).map_err(|err| format!("Resolve vault parent directory: {err}"))?;
    ensure_inside(&real_parent, root)?;
    let basename = target
        .file_name()
        .ok_or_else(|| "vault target has no basename".to_string())?;
    Ok(real_parent.join(basename))
}

#[cfg(unix)]
struct AnchoredVaultParent {
    directory: fs::File,
    leaf: std::ffi::CString,
}

#[cfg(unix)]
fn open_vault_root_anchored(root: &Path) -> Result<fs::File, String> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

    let initial = fs::symlink_metadata(root)
        .map_err(|error| format!("Inspect runtime vault root: {error}"))?;
    if initial.file_type().is_symlink() || !initial.is_dir() {
        return Err("runtime vault root must be a real directory".into());
    }
    let directory = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(root)
        .map_err(|error| format!("Open runtime vault root: {error}"))?;
    let opened = directory
        .metadata()
        .map_err(|error| format!("Inspect opened runtime vault root: {error}"))?;
    let live = fs::symlink_metadata(root)
        .map_err(|error| format!("Recheck runtime vault root: {error}"))?;
    if live.file_type().is_symlink()
        || !live.is_dir()
        || initial.dev() != opened.dev()
        || initial.ino() != opened.ino()
        || live.dev() != opened.dev()
        || live.ino() != opened.ino()
    {
        return Err("runtime vault root changed during access".into());
    }
    Ok(directory)
}

#[cfg(unix)]
fn open_vault_directory_anchored(
    root: &Path,
    target: &Path,
    create: bool,
) -> Result<fs::File, String> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;

    let relative = target
        .strip_prefix(root)
        .map_err(|_| "vault path is outside the runtime vault root".to_string())?;
    let mut directory = open_vault_root_anchored(root)?;

    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err("vault path contains an invalid path component".into());
        };
        let name = CString::new(name.as_bytes())
            .map_err(|_| "vault path contains a NUL byte".to_string())?;
        if create {
            let created = unsafe { libc::mkdirat(directory.as_raw_fd(), name.as_ptr(), 0o700) };
            if created != 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() != std::io::ErrorKind::AlreadyExists {
                    return Err(format!("Create vault directory: {error}"));
                }
            }
        }
        let descriptor = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if descriptor < 0 {
            return Err(format!(
                "Open vault directory without following symbolic links: {}",
                std::io::Error::last_os_error()
            ));
        }
        directory = fs::File::from(unsafe { OwnedFd::from_raw_fd(descriptor) });
    }
    Ok(directory)
}

#[cfg(unix)]
fn open_vault_parent_anchored(
    root: &Path,
    target: &Path,
    create_parents: bool,
) -> Result<AnchoredVaultParent, String> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let relative = target
        .strip_prefix(root)
        .map_err(|_| "vault target is outside the runtime vault root".to_string())?;
    let mut components = relative.components().collect::<Vec<_>>();
    let leaf = match components.pop() {
        Some(Component::Normal(name)) => CString::new(name.as_bytes())
            .map_err(|_| "vault target contains a NUL byte".to_string())?,
        _ => return Err("vault target has no file name".into()),
    };
    let parent = components
        .into_iter()
        .fold(root.to_path_buf(), |path, component| path.join(component));
    Ok(AnchoredVaultParent {
        directory: open_vault_directory_anchored(root, &parent, create_parents)?,
        leaf,
    })
}

#[cfg(all(unix, test))]
fn create_vault_parent_anchored(root: &Path, parent: &Path) -> Result<(), String> {
    let directory = open_vault_directory_anchored(root, parent, true)?;

    use std::os::unix::fs::MetadataExt;
    let opened = directory
        .metadata()
        .map_err(|error| format!("Inspect opened vault parent: {error}"))?;
    let live = fs::symlink_metadata(parent)
        .map_err(|error| format!("Inspect live vault parent: {error}"))?;
    if live.file_type().is_symlink()
        || !live.is_dir()
        || live.dev() != opened.dev()
        || live.ino() != opened.ino()
    {
        return Err("vault parent changed while it was created".into());
    }
    Ok(())
}

#[cfg(unix)]
fn write_vault_file_anchored(anchored: &AnchoredVaultParent, content: &[u8]) -> Result<(), String> {
    use std::io::Write;
    use std::mem::MaybeUninit;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

    let mut existing = MaybeUninit::<libc::stat>::uninit();
    let inspected = unsafe {
        libc::fstatat(
            anchored.directory.as_raw_fd(),
            anchored.leaf.as_ptr(),
            existing.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    let preserved_mode = if inspected == 0 {
        let stat = unsafe { existing.assume_init() };
        (stat.st_mode & libc::S_IFMT == libc::S_IFREG && stat.st_nlink == 1)
            .then_some(stat.st_mode & 0o777)
    } else {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::NotFound {
            None
        } else {
            return Err(format!("Inspect existing vault file: {error}"));
        }
    };

    for _ in 0..16 {
        let temporary = std::ffi::CString::new(format!(
            ".offisim-vault-write-{}-{:016x}",
            std::process::id(),
            rand::random::<u64>()
        ))
        .map_err(|_| "temporary vault filename is invalid".to_string())?;
        let descriptor = unsafe {
            libc::openat(
                anchored.directory.as_raw_fd(),
                temporary.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                preserved_mode.unwrap_or(0o600) as libc::c_uint,
            )
        };
        if descriptor < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                continue;
            }
            return Err(format!("Create temporary vault file: {error}"));
        }
        let mut file = fs::File::from(unsafe { OwnedFd::from_raw_fd(descriptor) });
        if let Err(error) = file.write_all(content).and_then(|()| file.sync_all()) {
            unsafe {
                libc::unlinkat(anchored.directory.as_raw_fd(), temporary.as_ptr(), 0);
            }
            return Err(format!("Write temporary vault file: {error}"));
        }
        if unsafe {
            libc::renameat(
                anchored.directory.as_raw_fd(),
                temporary.as_ptr(),
                anchored.directory.as_raw_fd(),
                anchored.leaf.as_ptr(),
            )
        } != 0
        {
            let error = std::io::Error::last_os_error();
            unsafe {
                libc::unlinkat(anchored.directory.as_raw_fd(), temporary.as_ptr(), 0);
            }
            return Err(format!("Replace vault file: {error}"));
        }
        anchored
            .directory
            .sync_all()
            .map_err(|error| format!("Sync vault file parent: {error}"))?;
        return Ok(());
    }
    Err("Could not allocate a unique temporary vault file".into())
}

#[cfg(unix)]
fn open_vault_leaf_anchored(
    anchored: &AnchoredVaultParent,
    directory: bool,
) -> Result<Option<fs::File>, String> {
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

    let mut flags = libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK;
    if directory {
        flags |= libc::O_DIRECTORY;
    }
    let descriptor = unsafe {
        libc::openat(
            anchored.directory.as_raw_fd(),
            anchored.leaf.as_ptr(),
            flags,
        )
    };
    if descriptor < 0 {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::NotFound {
            return Ok(None);
        }
        return Err(format!(
            "Open vault target without following symbolic links: {error}"
        ));
    }
    Ok(Some(fs::File::from(unsafe {
        OwnedFd::from_raw_fd(descriptor)
    })))
}

#[cfg(unix)]
fn remove_opened_vault_directory(directory: &fs::File) -> Result<(), String> {
    use std::ffi::CString;
    use std::mem::MaybeUninit;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::MetadataExt;

    for name in opened_directory_entry_names(directory)? {
        let encoded = CString::new(name.as_bytes())
            .map_err(|_| "Vault entry contains a NUL byte".to_string())?;
        let descriptor = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                encoded.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
            )
        };
        if descriptor < 0 {
            let error = std::io::Error::last_os_error();
            let mut stat = MaybeUninit::<libc::stat>::uninit();
            let inspected = unsafe {
                libc::fstatat(
                    directory.as_raw_fd(),
                    encoded.as_ptr(),
                    stat.as_mut_ptr(),
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            };
            if inspected == 0
                && unsafe { stat.assume_init() }.st_mode & libc::S_IFMT == libc::S_IFLNK
            {
                if unsafe { libc::unlinkat(directory.as_raw_fd(), encoded.as_ptr(), 0) } != 0 {
                    return Err(format!(
                        "Remove vault symbolic link: {}",
                        std::io::Error::last_os_error()
                    ));
                }
                continue;
            }
            if error.kind() == std::io::ErrorKind::NotFound {
                continue;
            }
            return Err(format!("Open vault entry for removal: {error}"));
        }
        let entry = fs::File::from(unsafe { OwnedFd::from_raw_fd(descriptor) });
        let opened = entry
            .metadata()
            .map_err(|error| format!("Inspect opened vault removal entry: {error}"))?;
        if opened.is_dir() {
            remove_opened_vault_directory(&entry)?;
            let mut live = MaybeUninit::<libc::stat>::uninit();
            if unsafe {
                libc::fstatat(
                    directory.as_raw_fd(),
                    encoded.as_ptr(),
                    live.as_mut_ptr(),
                    libc::AT_SYMLINK_NOFOLLOW,
                )
            } != 0
            {
                return Err(format!(
                    "Recheck vault directory before removal: {}",
                    std::io::Error::last_os_error()
                ));
            }
            let live = unsafe { live.assume_init() };
            if live.st_mode & libc::S_IFMT != libc::S_IFDIR
                || live.st_dev as u64 != opened.dev()
                || live.st_ino != opened.ino()
            {
                return Err("Vault directory changed during removal".into());
            }
            if unsafe {
                libc::unlinkat(directory.as_raw_fd(), encoded.as_ptr(), libc::AT_REMOVEDIR)
            } != 0
            {
                return Err(format!(
                    "Remove vault directory: {}",
                    std::io::Error::last_os_error()
                ));
            }
        } else if opened.is_file() {
            if unsafe { libc::unlinkat(directory.as_raw_fd(), encoded.as_ptr(), 0) } != 0 {
                return Err(format!(
                    "Remove vault file: {}",
                    std::io::Error::last_os_error()
                ));
            }
        } else {
            return Err("Vault removal refuses unsupported filesystem entries".into());
        }
    }
    Ok(())
}

#[cfg(unix)]
fn remove_vault_target_anchored(anchored: &AnchoredVaultParent) -> Result<(), String> {
    use std::mem::MaybeUninit;
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::MetadataExt;

    let mut initial = MaybeUninit::<libc::stat>::uninit();
    if unsafe {
        libc::fstatat(
            anchored.directory.as_raw_fd(),
            anchored.leaf.as_ptr(),
            initial.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } != 0
    {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::NotFound {
            return Ok(());
        }
        return Err(format!("Inspect vault removal target: {error}"));
    }
    if unsafe { initial.assume_init() }.st_mode & libc::S_IFMT == libc::S_IFLNK {
        if unsafe { libc::unlinkat(anchored.directory.as_raw_fd(), anchored.leaf.as_ptr(), 0) } != 0
        {
            return Err(format!(
                "Remove vault symbolic link: {}",
                std::io::Error::last_os_error()
            ));
        }
        return anchored
            .directory
            .sync_all()
            .map_err(|error| format!("Sync vault removal parent: {error}"));
    }
    let Some(entry) = open_vault_leaf_anchored(anchored, false)? else {
        return Ok(());
    };
    let opened = entry
        .metadata()
        .map_err(|error| format!("Inspect opened vault removal target: {error}"))?;
    if opened.is_dir() {
        remove_opened_vault_directory(&entry)?;
        let mut live = MaybeUninit::<libc::stat>::uninit();
        if unsafe {
            libc::fstatat(
                anchored.directory.as_raw_fd(),
                anchored.leaf.as_ptr(),
                live.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } != 0
        {
            return Err(format!(
                "Recheck vault target before removal: {}",
                std::io::Error::last_os_error()
            ));
        }
        let live = unsafe { live.assume_init() };
        if live.st_mode & libc::S_IFMT != libc::S_IFDIR
            || live.st_dev as u64 != opened.dev()
            || live.st_ino != opened.ino()
        {
            return Err("Vault target changed during removal".into());
        }
        if unsafe {
            libc::unlinkat(
                anchored.directory.as_raw_fd(),
                anchored.leaf.as_ptr(),
                libc::AT_REMOVEDIR,
            )
        } != 0
        {
            return Err(format!(
                "Remove vault directory: {}",
                std::io::Error::last_os_error()
            ));
        }
    } else if opened.is_file() {
        if unsafe { libc::unlinkat(anchored.directory.as_raw_fd(), anchored.leaf.as_ptr(), 0) } != 0
        {
            return Err(format!(
                "Remove vault file: {}",
                std::io::Error::last_os_error()
            ));
        }
    } else {
        return Err("Vault removal refuses unsupported filesystem targets".into());
    }
    anchored
        .directory
        .sync_all()
        .map_err(|error| format!("Sync vault removal parent: {error}"))
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
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
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
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_file() {
            return true;
        }
        if metadata.is_dir() && directory_has_any_file(&path) {
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
    let authority =
        crate::task_workspace_binding::resolve_authorized_project_workspace(&app, &project_id)
            .await?;
    let root = authority.path().to_path_buf();
    let roots = crate::builtin_tools::WorkspaceRoots::new(vec![authority]);
    let safe_name = sanitize_file_name(&file_name);
    let relative = PathBuf::from("deliverables").join(&safe_name);
    let destination = root.join(&relative);
    crate::builtin_tools::write_project_file_anchored(&destination, &roots, content.as_bytes())?;
    Ok(relative.to_string_lossy().to_string())
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
    crate::task_workspace_binding::resolve_authorized_project_workspace(app, project_id)
        .await
        .map(crate::task_workspace_binding::AuthorizedWorkspaceRoot::into_path)
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

    #[cfg(unix)]
    #[test]
    fn vault_stats_and_file_probe_do_not_follow_symlinks() {
        use std::os::unix::fs::symlink;

        let root = temp_root();
        let outside = temp_root();
        std::fs::write(root.join("inside.md"), "inside").unwrap();
        std::fs::write(outside.join("employee.md"), "outside employee").unwrap();
        symlink(&outside, root.join("outside-dir")).unwrap();
        symlink(outside.join("employee.md"), root.join("outside-file.md")).unwrap();

        let stats = collect_vault_stats(&root);
        assert_eq!(stats.employees, 0);
        assert_eq!(stats.files, 1);
        assert_eq!(stats.size_bytes, 6);

        let links_only = root.join("links-only");
        std::fs::create_dir(&links_only).unwrap();
        symlink(outside.join("employee.md"), links_only.join("outside.md")).unwrap();
        assert!(!directory_has_any_file(&links_only));

        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(outside).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn vault_export_archive_excludes_external_symlink_targets() {
        use std::os::unix::fs::symlink;

        let base = temp_root();
        let vault = base.join("vault");
        let outside = base.join("outside");
        let staging = base.join("staging");
        let archive = base.join("vault.zip");
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(vault.join("inside.md"), "inside").unwrap();
        std::fs::write(outside.join("secret.md"), "must not export").unwrap();
        symlink(&outside, vault.join("outside-dir")).unwrap();
        symlink(outside.join("secret.md"), vault.join("outside-file.md")).unwrap();

        snapshot_vault_for_export(&vault, &staging).expect("snapshot vault without symlinks");
        create_zip_from_directory(&staging, &archive)
            .await
            .expect("create real vault archive");
        let listing = std::process::Command::new("unzip")
            .args(["-Z1"])
            .arg(&archive)
            .output()
            .expect("list archive");
        assert!(listing.status.success());
        let listing = String::from_utf8(listing.stdout).unwrap();
        assert!(listing.lines().any(|entry| entry == "inside.md"));
        assert!(!listing.contains("outside-dir"), "{listing}");
        assert!(!listing.contains("outside-file.md"), "{listing}");
        assert!(!listing.contains("secret.md"), "{listing}");

        std::fs::remove_dir_all(base).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn anchored_vault_write_uses_opened_parent_after_path_replacement() {
        use std::os::unix::fs::symlink;

        let base = temp_root();
        let root = base.join("vault");
        let live_parent = root.join("companies/c1");
        let opened_parent = root.join("companies/c1-opened");
        let outside = base.join("outside");
        std::fs::create_dir_all(&live_parent).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let target = live_parent.join("employee.md");
        let anchored = open_vault_parent_anchored(&root, &target, true).unwrap();

        std::fs::rename(&live_parent, &opened_parent).unwrap();
        symlink(&outside, &live_parent).unwrap();
        write_vault_file_anchored(&anchored, b"verified parent").unwrap();

        assert_eq!(
            std::fs::read_to_string(opened_parent.join("employee.md")).unwrap(),
            "verified parent"
        );
        assert!(!outside.join("employee.md").exists());
        std::fs::remove_dir_all(base).unwrap();
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

        let error = canonicalize_or_parent(&root, &link_path)
            .expect_err("outside symlink target must be rejected during resolution");
        assert!(error.contains("outside"), "{error}");

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

        // Include missing descendants so the regression proves resolution does
        // not create anything outside before rejecting containment.
        let write_target = link_dir.join("created-outside/escape.txt");
        canonicalize_or_parent(&root, &write_target)
            .expect_err("write through symlinked parent must be rejected");
        assert!(
            !outside.join("created-outside").exists(),
            "containment rejection must happen before any outside directory is created"
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
        let real = canonicalize_or_parent(&root, &nested).unwrap();
        ensure_inside(&real, &root).expect("real file in vault must pass");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn canonicalize_or_parent_handles_missing_target() {
        let root = temp_root();
        let new_file = root.join("companies/c1/skills/new/SKILL.md");
        // parent doesn't exist yet; canonicalize_or_parent should mkdir it.
        let real = canonicalize_or_parent(&root, &new_file).unwrap();
        ensure_inside(&real, &root).expect("not-yet-existing file in vault must pass");
        std::fs::remove_dir_all(&root).ok();
    }
}
