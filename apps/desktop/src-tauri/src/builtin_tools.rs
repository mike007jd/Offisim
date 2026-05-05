use serde::Serialize;
use sqlx::Row;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use tauri::Runtime;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use crate::local_db::get_offisim_pool;

const DEFAULT_MAX_OUTPUT_BYTES: usize = 1024 * 1024;
const MAX_READ_BYTES: u64 = 8 * 1024 * 1024;
const MAX_WRITE_BYTES: usize = 8 * 1024 * 1024;
/// Hard ceiling on `project_read_file_preview` — file-tree previews never
/// pull more than 64 KB across the IPC boundary regardless of caller request.
const MAX_PREVIEW_BYTES: u64 = 65_536;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BashExecuteResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
    timed_out: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFilePreview {
    /// Valid UTF-8, possibly empty if the truncation point fell inside a
    /// multi-byte sequence the boundary walk-back could not recover.
    content: String,
    /// `true` when the on-disk file exceeds the clamped `max_bytes` — UI
    /// surfaces a "preview truncated · {totalSize} bytes total" hint.
    truncated: bool,
    /// Full file size on disk (from `metadata().len()`), so callers can
    /// display the truncation hint without a follow-up stat call.
    total_size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDirEntry {
    name: String,
    path: String,
    is_file: bool,
    is_directory: bool,
    is_symlink: bool,
    size: Option<u64>,
}

async fn workspace_roots<R: Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: Option<&str>,
) -> Result<Vec<PathBuf>, String> {
    let pool = get_offisim_pool(app).map_err(|err| {
        eprintln!("[builtin_tools] {err}");
        "open offisim.db failed".to_string()
    })?;
    let rows = if let Some(project_id) = project_id {
        sqlx::query(
            r#"
            SELECT workspace_root
            FROM projects
            WHERE project_id = ?
              AND workspace_root IS NOT NULL
              AND trim(workspace_root) <> ''
            "#,
        )
        .bind(project_id)
        .fetch_all(&pool)
        .await
    } else {
        sqlx::query(
            r#"
            SELECT workspace_root
            FROM projects
            WHERE workspace_root IS NOT NULL AND trim(workspace_root) <> ''
            "#,
        )
        .fetch_all(&pool)
        .await
    }
    .map_err(|err| {
        eprintln!("[builtin_tools] list project workspace roots failed: {err}");
        "list project workspace roots failed".to_string()
    })?;
    let mut roots = Vec::new();
    for row in rows {
        let raw: String = row
            .try_get("workspace_root")
            .map_err(|err| format!("decode workspace_root: {err}"))?;
        let raw_path = PathBuf::from(raw);
        if is_overbroad_workspace_root(&raw_path) {
            eprintln!(
                "[builtin_tools] ignoring overbroad workspace_root {}",
                raw_path.to_string_lossy()
            );
            continue;
        }
        if let Ok(canonical) = raw_path.canonicalize() {
            if is_overbroad_workspace_root(&canonical) {
                eprintln!(
                    "[builtin_tools] ignoring overbroad workspace_root {}",
                    canonical.to_string_lossy()
                );
                continue;
            }
            if !roots.iter().any(|root| root == &canonical) {
                roots.push(canonical);
            }
        }
    }
    Ok(roots)
}

fn has_parent_dir(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn resolve_candidate(path: &str, cwd: Option<&str>) -> Result<PathBuf, String> {
    let input = PathBuf::from(path);
    let candidate = if input.is_absolute() {
        input
    } else {
        let cwd = cwd.ok_or_else(|| "relative paths require a workspace cwd".to_string())?;
        PathBuf::from(cwd).join(input)
    };
    if has_parent_dir(&candidate) {
        return Err("parent-directory path segments are not allowed".to_string());
    }
    Ok(candidate)
}

fn is_overbroad_workspace_root(path: &Path) -> bool {
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
    // macOS canonicalize maps /tmp -> /private/tmp, /var -> /private/var, etc.,
    // so a 2-component /private/<name> path is the canonical form of a
    // single-component privileged root.
    normals.len() == 2 && normals[0] == std::ffi::OsStr::new("private")
}

fn relativize_for_error(path: &Path, roots: &[PathBuf]) -> String {
    for root in roots {
        if path.starts_with(root) {
            let root_name = root
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| "workspace".to_string());
            let relative = path.strip_prefix(root).unwrap_or_else(|_| Path::new(""));
            if relative.as_os_str().is_empty() {
                return root_name;
            }
            return format!("{root_name}/{}", relative.to_string_lossy());
        }
    }
    "<out-of-bounds>".to_string()
}

fn ensure_inside_workspace(candidate: &Path, roots: &[PathBuf]) -> Result<(), String> {
    if roots.is_empty() {
        return Err("no project workspace_root is bound for file/shell tools".to_string());
    }
    if roots.iter().any(|root| candidate.starts_with(root)) {
        return Ok(());
    }
    Err(format!(
        "path is outside bound project workspaces: {}",
        relativize_for_error(candidate, roots)
    ))
}

fn ensure_read_size(size: u64, path: &Path, roots: &[PathBuf]) -> Result<(), String> {
    if size > MAX_READ_BYTES {
        return Err(format!(
            "file too large to read in-process: {} ({}B > {}B)",
            relativize_for_error(path, roots),
            size,
            MAX_READ_BYTES
        ));
    }
    Ok(())
}

fn ensure_write_size(size: usize, path: &Path, roots: &[PathBuf]) -> Result<(), String> {
    if size > MAX_WRITE_BYTES {
        return Err(format!(
            "file too large to write in-process: {} ({}B > {}B)",
            relativize_for_error(path, roots),
            size,
            MAX_WRITE_BYTES
        ));
    }
    Ok(())
}

fn deepest_existing_ancestor(path: &Path) -> Result<PathBuf, String> {
    let mut cursor = path;
    loop {
        if cursor.exists() {
            return Ok(cursor.to_path_buf());
        }
        cursor = cursor
            .parent()
            .ok_or_else(|| "path has no existing ancestor".to_string())?;
    }
}

fn resolve_write_target(candidate: &Path, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let ancestor = deepest_existing_ancestor(candidate)?;
    let canonical_ancestor = ancestor
        .canonicalize()
        .map_err(|err| fs_resolve_error("resolve project file ancestor", &ancestor, err))?;
    ensure_inside_workspace(&canonical_ancestor, roots)?;
    let tail = candidate.strip_prefix(&ancestor).map_err(|err| {
        eprintln!(
            "[builtin_tools] strip write tail {} from {} failed: {err}",
            candidate.to_string_lossy(),
            ancestor.to_string_lossy()
        );
        "resolve project file target failed".to_string()
    })?;
    Ok(canonical_ancestor.join(tail))
}

fn fs_resolve_error<E: std::fmt::Display>(stage: &str, path: &Path, err: E) -> String {
    eprintln!(
        "[builtin_tools] {stage} {} failed: {err}",
        path.to_string_lossy()
    );
    format!("{stage} failed")
}

fn fs_op_error(stage: &str, path: &Path, roots: &[PathBuf], err: std::io::Error) -> String {
    eprintln!(
        "[builtin_tools] {stage} {} failed: {err}",
        path.to_string_lossy()
    );
    format!(
        "{stage} failed: {} ({:?})",
        relativize_for_error(path, roots),
        err.kind()
    )
}

fn truncate_text(bytes: &[u8], max_bytes: usize) -> String {
    let capped = if bytes.len() > max_bytes {
        &bytes[..max_bytes]
    } else {
        bytes
    };
    let mut text = String::from_utf8_lossy(capped).to_string();
    if bytes.len() > max_bytes {
        text.push_str("\n[OUTPUT TRUNCATED]");
    }
    text
}

fn relative_path_for_entry(root: &Path, entry_path: &Path) -> String {
    entry_path
        .strip_prefix(root)
        .unwrap_or(entry_path)
        .to_string_lossy()
        .trim_start_matches(std::path::MAIN_SEPARATOR)
        .to_string()
}

fn containing_root<'a>(candidate: &Path, roots: &'a [PathBuf]) -> Option<&'a PathBuf> {
    roots.iter().find(|root| candidate.starts_with(*root))
}

/// UTF-8 boundary safety: convert `bytes` to a String. If the buffer ends
/// mid-codepoint, walk back to the last valid UTF-8 boundary so callers always
/// get a clean string. Returns the empty string if the walk-back yields zero
/// valid bytes (e.g. all-binary preview).
fn utf8_boundary_safe_string(bytes: Vec<u8>) -> String {
    match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(err) => {
            let valid_up_to = err.utf8_error().valid_up_to();
            let mut buf = err.into_bytes();
            buf.truncate(valid_up_to);
            // Safe: valid_up_to is by definition the first index that is NOT
            // valid UTF-8, so everything before it parses cleanly.
            String::from_utf8(buf).unwrap_or_default()
        }
    }
}

#[tauri::command]
pub async fn project_read_file_preview<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    cwd: Option<String>,
    max_bytes: u32,
    project_id: Option<String>,
) -> Result<ProjectFilePreview, String> {
    let roots = workspace_roots(&app, project_id.as_deref()).await?;
    let candidate = resolve_candidate(&path, cwd.as_deref())?;
    let canonical = candidate
        .canonicalize()
        .map_err(|err| fs_resolve_error("resolve project file", &candidate, err))?;
    ensure_inside_workspace(&canonical, &roots)?;

    // Open once and stat via the file handle — saves the redundant `metadata()`
    // syscall the previous draft did before opening.
    let file = tokio::fs::File::open(&canonical)
        .await
        .map_err(|err| fs_op_error("open project file", &canonical, &roots, err))?;
    let total_size = file
        .metadata()
        .await
        .map_err(|err| fs_op_error("stat project file", &canonical, &roots, err))?
        .len();

    // Clamp the request to the hard cap regardless of caller intent — preview
    // IPC must stay bounded so a 50 MB log file never streams across.
    let clamped = (max_bytes as u64).min(MAX_PREVIEW_BYTES);
    let read_bytes = clamped.min(total_size);

    let mut reader = file.take(read_bytes);
    let mut buffer = Vec::with_capacity(read_bytes as usize);
    reader
        .read_to_end(&mut buffer)
        .await
        .map_err(|err| fs_op_error("read project file preview", &canonical, &roots, err))?;

    let content = utf8_boundary_safe_string(buffer);
    let truncated = total_size > clamped;
    Ok(ProjectFilePreview {
        content,
        truncated,
        total_size,
    })
}

#[tauri::command]
pub async fn project_read_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    cwd: Option<String>,
    project_id: Option<String>,
) -> Result<String, String> {
    let roots = workspace_roots(&app, project_id.as_deref()).await?;
    let candidate = resolve_candidate(&path, cwd.as_deref())?;
    let canonical = candidate
        .canonicalize()
        .map_err(|err| fs_resolve_error("resolve project file", &candidate, err))?;
    ensure_inside_workspace(&canonical, &roots)?;
    let metadata = tokio::fs::metadata(&canonical)
        .await
        .map_err(|err| fs_op_error("stat project file", &canonical, &roots, err))?;
    ensure_read_size(metadata.len(), &canonical, &roots)?;
    tokio::fs::read_to_string(&canonical)
        .await
        .map_err(|err| fs_op_error("read project file", &canonical, &roots, err))
}

#[tauri::command]
pub async fn project_list_dir<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    cwd: Option<String>,
    project_id: Option<String>,
) -> Result<Vec<ProjectDirEntry>, String> {
    let roots = workspace_roots(&app, project_id.as_deref()).await?;
    let candidate = resolve_candidate(&path, cwd.as_deref())?;
    let canonical = candidate
        .canonicalize()
        .map_err(|err| fs_resolve_error("resolve project directory", &candidate, err))?;
    ensure_inside_workspace(&canonical, &roots)?;
    let root = containing_root(&canonical, &roots)
        .ok_or_else(|| "project directory is outside bound project workspaces".to_string())?;

    let mut entries = tokio::fs::read_dir(&canonical)
        .await
        .map_err(|err| fs_op_error("list project directory", &canonical, &roots, err))?;
    let mut rows = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|err| fs_op_error("read project directory entry", &canonical, &roots, err))?
    {
        if rows.len() >= 300 {
            break;
        }
        let entry_path = entry.path();
        let file_type = entry
            .file_type()
            .await
            .map_err(|err| fs_op_error("stat project directory entry", &entry_path, &roots, err))?;
        let size = if file_type.is_file() {
            entry.metadata().await.ok().map(|metadata| metadata.len())
        } else {
            None
        };
        rows.push(ProjectDirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: relative_path_for_entry(root, &entry_path),
            is_file: file_type.is_file(),
            is_directory: file_type.is_dir(),
            is_symlink: file_type.is_symlink(),
            size,
        });
    }
    rows.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(rows)
}

#[tauri::command]
pub async fn project_write_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    content: String,
    cwd: Option<String>,
    project_id: Option<String>,
) -> Result<(), String> {
    let roots = workspace_roots(&app, project_id.as_deref()).await?;
    let candidate = resolve_candidate(&path, cwd.as_deref())?;
    ensure_write_size(content.len(), &candidate, &roots)?;
    let target = resolve_write_target(&candidate, &roots)?;
    ensure_inside_workspace(&target, &roots)?;
    if let Some(parent) = target.parent() {
        ensure_inside_workspace(parent, &roots)?;
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|err| fs_op_error("create project file parent", parent, &roots, err))?;
        let canonical_parent = parent
            .canonicalize()
            .map_err(|err| fs_resolve_error("resolve project file parent", parent, err))?;
        ensure_inside_workspace(&canonical_parent, &roots)?;
    }
    tokio::fs::write(&target, content)
        .await
        .map_err(|err| fs_op_error("write project file", &target, &roots, err))?;
    let canonical = target
        .canonicalize()
        .map_err(|err| fs_resolve_error("resolve written project file", &target, err))?;
    if let Err(err) = ensure_inside_workspace(&canonical, &roots) {
        let _ = tokio::fs::remove_file(&target).await;
        return Err(err);
    }
    Ok(())
}

#[tauri::command]
pub async fn bash_execute<R: Runtime>(
    app: tauri::AppHandle<R>,
    cwd: String,
    cmd: String,
    timeout_ms: u32,
    max_output_bytes: Option<u32>,
    project_id: Option<String>,
) -> Result<BashExecuteResult, String> {
    let roots = workspace_roots(&app, project_id.as_deref()).await?;
    let cwd_path = PathBuf::from(&cwd)
        .canonicalize()
        .map_err(|err| fs_resolve_error("resolve shell cwd", Path::new(&cwd), err))?;
    ensure_inside_workspace(&cwd_path, &roots)?;

    let child = Command::new("bash")
        .arg("-c")
        .arg(cmd)
        .current_dir(&cwd_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| fs_op_error("spawn bash in", &cwd_path, &roots, err))?;

    let max_bytes = max_output_bytes
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_MAX_OUTPUT_BYTES);
    let timed = timeout(
        Duration::from_millis(u64::from(timeout_ms.max(1))),
        child.wait_with_output(),
    )
    .await;

    match timed {
        Ok(output) => {
            let output =
                output.map_err(|err| fs_op_error("wait for bash in", &cwd_path, &roots, err))?;
            Ok(BashExecuteResult {
                stdout: truncate_text(&output.stdout, max_bytes),
                stderr: truncate_text(&output.stderr, max_bytes),
                exit_code: output.status.code().unwrap_or(-1),
                timed_out: false,
            })
        }
        Err(_) => Ok(BashExecuteResult {
            stdout: String::new(),
            stderr: "Command timed out".to_string(),
            exit_code: -1,
            timed_out: true,
        }),
    }
}

#[cfg(test)]
mod builtin_tools_contracts {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "offisim-builtin-tools-{label}-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[cfg(unix)]
    fn symlink_dir(original: &Path, link: &Path) {
        std::os::unix::fs::symlink(original, link).expect("create symlink");
    }

    #[cfg(windows)]
    fn symlink_dir(original: &Path, link: &Path) {
        std::os::windows::fs::symlink_dir(original, link).expect("create symlink");
    }

    #[test]
    fn rejects_symlink_escape_before_write_target_resolution() {
        let workspace = TestDir::new("workspace");
        let outside = TestDir::new("outside");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let link = workspace.path.join("link");
        symlink_dir(&outside.path, &link);

        let err = resolve_write_target(&link.join("escape.txt"), &[root])
            .expect_err("symlink write target must be rejected");

        assert!(err.contains("path is outside bound project workspaces"));
        assert!(err.contains("<out-of-bounds>"));
    }

    #[test]
    fn rejects_overbroad_workspace_root() {
        assert!(is_overbroad_workspace_root(Path::new("/")));
        assert!(is_overbroad_workspace_root(Path::new("/Users")));
        assert!(is_overbroad_workspace_root(Path::new("/tmp")));
        assert!(is_overbroad_workspace_root(Path::new("/private/tmp")));
    }

    #[test]
    fn redacts_out_of_bounds_paths() {
        let workspace = TestDir::new("redact");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let rendered = relativize_for_error(Path::new("/Users/example/.ssh/id_rsa"), &[root]);
        assert_eq!(rendered, "<out-of-bounds>");
    }

    #[test]
    fn resolves_nonexistent_tail_under_canonical_root() {
        let workspace = TestDir::new("tail");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let target = resolve_write_target(&workspace.path.join("nested/file.txt"), &[root.clone()])
            .expect("target resolves");
        assert!(target.starts_with(root));
        assert!(target.ends_with("nested/file.txt"));
    }

    #[test]
    fn rejects_oversize_read_with_redacted_path() {
        let workspace = TestDir::new("oversize-read");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let file = root.join("large.txt");
        let err = ensure_read_size(MAX_READ_BYTES + 1, &file, &[root])
            .expect_err("oversize read must be rejected");

        assert!(err.contains("file too large to read in-process"));
        assert!(err.contains("large.txt"));
        assert!(!err.contains("/Users/"));
    }

    #[test]
    fn rejects_oversize_write_with_redacted_path() {
        let workspace = TestDir::new("oversize-write");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let file = root.join("large.txt");
        let err = ensure_write_size(MAX_WRITE_BYTES + 1, &file, &[root])
            .expect_err("oversize write must be rejected");

        assert!(err.contains("file too large to write in-process"));
        assert!(err.contains("large.txt"));
        assert!(!err.contains("/Users/"));
    }

    #[test]
    fn utf8_boundary_walk_back_drops_partial_codepoint() {
        // "héllo" — UTF-8: 0x68 0xC3 0xA9 0x6C 0x6C 0x6F (6 bytes total).
        // Truncating at 2 bytes (h + first byte of é) must walk back to 1 byte.
        let bytes = vec![0x68, 0xC3];
        let recovered = utf8_boundary_safe_string(bytes);
        assert_eq!(recovered, "h", "walk-back should drop partial é prefix");
    }

    #[test]
    fn utf8_boundary_walk_back_returns_empty_for_first_byte_partial() {
        // Just the leading byte of a multi-byte codepoint — no valid prefix.
        let bytes = vec![0xC3];
        let recovered = utf8_boundary_safe_string(bytes);
        assert_eq!(
            recovered, "",
            "walk-back must return empty when no valid bytes precede partial"
        );
    }

    #[test]
    fn utf8_boundary_passes_through_valid_utf8() {
        let bytes = "hello".as_bytes().to_vec();
        let recovered = utf8_boundary_safe_string(bytes);
        assert_eq!(recovered, "hello");
    }
}
