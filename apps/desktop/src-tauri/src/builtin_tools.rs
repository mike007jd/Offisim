use serde::Serialize;
use sqlx::Row;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use tauri::{Manager, Runtime};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

const DEFAULT_MAX_OUTPUT_BYTES: usize = 1024 * 1024;
const MAX_READ_BYTES: u64 = 8 * 1024 * 1024;
const MAX_WRITE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BashExecuteResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
    timed_out: bool,
}

async fn open_pool<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<sqlx::SqlitePool, String> {
    let mut db_path = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("resolve app config dir: {err}"))?;
    db_path.push("offisim.db");
    let db_url = format!("sqlite:{}", db_path.to_string_lossy());
    sqlx::SqlitePool::connect(&db_url).await.map_err(|err| {
        eprintln!("[builtin_tools] open offisim.db failed: {err}");
        "open offisim.db failed".to_string()
    })
}

async fn workspace_roots<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Vec<PathBuf>, String> {
    let pool = open_pool(app).await?;
    let rows = sqlx::query(
        r#"
        SELECT workspace_root
        FROM projects
        WHERE workspace_root IS NOT NULL AND trim(workspace_root) <> ''
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|err| {
        eprintln!("[builtin_tools] list project workspace roots failed: {err}");
        "list project workspace roots failed".to_string()
    })?;
    pool.close().await;

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
    const BLOCKED: &[&str] = &[
        "/",
        "/Users",
        "/home",
        "/etc",
        "/var",
        "/tmp",
        "/usr",
        "/opt",
        "/private",
        "/private/tmp",
        "/private/var",
    ];
    if BLOCKED.iter().any(|blocked| path == Path::new(blocked)) {
        return true;
    }
    if let Some(home) = dirs::home_dir().and_then(|home| home.canonicalize().ok()) {
        if path == home || home.parent().is_some_and(|parent| path == parent) {
            return true;
        }
    }
    path.components()
        .filter(|component| matches!(component, Component::Normal(_)))
        .count()
        < 2
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
    let canonical_ancestor = ancestor.canonicalize().map_err(|err| {
        eprintln!(
            "[builtin_tools] resolve write ancestor {} failed: {err}",
            ancestor.to_string_lossy()
        );
        "resolve project file ancestor failed".to_string()
    })?;
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

#[tauri::command]
pub async fn project_read_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    cwd: Option<String>,
) -> Result<String, String> {
    let roots = workspace_roots(&app).await?;
    let candidate = resolve_candidate(&path, cwd.as_deref())?;
    let canonical = candidate.canonicalize().map_err(|err| {
        eprintln!(
            "[builtin_tools] resolve project file {} failed: {err}",
            candidate.to_string_lossy()
        );
        "resolve project file failed".to_string()
    })?;
    ensure_inside_workspace(&canonical, &roots)?;
    let metadata = tokio::fs::metadata(&canonical).await.map_err(|err| {
        eprintln!(
            "[builtin_tools] stat project file {} failed: {err}",
            canonical.to_string_lossy()
        );
        format!(
            "stat project file failed: {}",
            relativize_for_error(&canonical, &roots)
        )
    })?;
    ensure_read_size(metadata.len(), &canonical, &roots)?;
    tokio::fs::read_to_string(&canonical).await.map_err(|err| {
        eprintln!(
            "[builtin_tools] read project file {} failed: {err}",
            canonical.to_string_lossy()
        );
        format!(
            "read project file failed: {} ({:?})",
            relativize_for_error(&canonical, &roots),
            err.kind()
        )
    })
}

#[tauri::command]
pub async fn project_write_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    content: String,
    cwd: Option<String>,
) -> Result<(), String> {
    let roots = workspace_roots(&app).await?;
    let candidate = resolve_candidate(&path, cwd.as_deref())?;
    ensure_write_size(content.len(), &candidate, &roots)?;
    let target = resolve_write_target(&candidate, &roots)?;
    ensure_inside_workspace(&target, &roots)?;
    if let Some(parent) = target.parent() {
        ensure_inside_workspace(parent, &roots)?;
        tokio::fs::create_dir_all(parent).await.map_err(|err| {
            eprintln!(
                "[builtin_tools] create project file parent {} failed: {err}",
                parent.to_string_lossy()
            );
            format!(
                "create project file parent failed: {} ({:?})",
                relativize_for_error(parent, &roots),
                err.kind()
            )
        })?;
        let canonical_parent = parent.canonicalize().map_err(|err| {
            eprintln!(
                "[builtin_tools] resolve project file parent {} failed: {err}",
                parent.to_string_lossy()
            );
            "resolve project file parent failed".to_string()
        })?;
        ensure_inside_workspace(&canonical_parent, &roots)?;
    }
    tokio::fs::write(&target, content).await.map_err(|err| {
        eprintln!(
            "[builtin_tools] write project file {} failed: {err}",
            target.to_string_lossy()
        );
        format!(
            "write project file failed: {} ({:?})",
            relativize_for_error(&target, &roots),
            err.kind()
        )
    })?;
    let canonical = target.canonicalize().map_err(|err| {
        eprintln!(
            "[builtin_tools] resolve written project file {} failed: {err}",
            target.to_string_lossy()
        );
        "resolve written project file failed".to_string()
    })?;
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
) -> Result<BashExecuteResult, String> {
    let roots = workspace_roots(&app).await?;
    let cwd_path = PathBuf::from(&cwd).canonicalize().map_err(|err| {
        eprintln!("[builtin_tools] resolve shell cwd {cwd} failed: {err}");
        "resolve shell cwd failed".to_string()
    })?;
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
        .map_err(|err| {
            eprintln!(
                "[builtin_tools] spawn bash in {} failed: {err}",
                cwd_path.to_string_lossy()
            );
            format!(
                "spawn bash failed: {} ({:?})",
                relativize_for_error(&cwd_path, &roots),
                err.kind()
            )
        })?;

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
            let output = output.map_err(|err| {
                eprintln!(
                    "[builtin_tools] wait for bash in {} failed: {err}",
                    cwd_path.to_string_lossy()
                );
                format!(
                    "wait for bash failed: {} ({:?})",
                    relativize_for_error(&cwd_path, &roots),
                    err.kind()
                )
            })?;
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
}
