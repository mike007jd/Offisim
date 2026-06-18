use serde::Serialize;
use sqlx::Row;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use tauri::{Manager, Runtime};
use tokio::io::{AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use crate::local_db::get_offisim_pool;
use crate::local_paths::is_overbroad_workspace_root;

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
    project_id: String,
    cwd: String,
    network_policy: String,
    approval_id: Option<String>,
}

#[derive(Debug)]
struct ShellAuditInput<'a> {
    command: &'a str,
    cwd: &'a Path,
    project_id: &'a str,
    employee_id: Option<&'a str>,
    approval_id: Option<&'a str>,
    timeout_ms: u32,
    exit_code: i32,
    timed_out: bool,
    network_policy: &'a str,
    stdout: &'a str,
    stderr: &'a str,
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

fn resolve_project_candidate(
    path: &str,
    cwd: Option<&str>,
    roots: &[PathBuf],
) -> Result<PathBuf, String> {
    if Path::new(path).is_absolute() || cwd.is_some() {
        return resolve_candidate(path, cwd);
    }
    let input = Path::new(path);
    if has_parent_dir(input) {
        return Err("parent-directory path segments are not allowed".to_string());
    }
    if roots.len() == 1 {
        return Ok(roots[0].join(input));
    }
    resolve_candidate(path, cwd)
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

fn line_window_size_error(kind: &str, path: &Path, roots: &[PathBuf]) -> String {
    format!(
        "project file line {kind} exceeds {} bytes: {}",
        MAX_READ_BYTES,
        relativize_for_error(path, roots)
    )
}

fn push_line_window(
    line_no: u32,
    start_line: u32,
    line: &mut Vec<u8>,
    selected: &mut Vec<String>,
    retained_bytes: &mut u64,
    max_lines: Option<usize>,
    path: &Path,
    roots: &[PathBuf],
) -> Result<bool, String> {
    if line_no < start_line {
        line.clear();
        return Ok(false);
    }
    *retained_bytes = retained_bytes.saturating_add(line.len() as u64);
    if *retained_bytes > MAX_READ_BYTES {
        return Err(line_window_size_error("window", path, roots));
    }
    while line.ends_with(b"\n") || line.ends_with(b"\r") {
        line.pop();
    }
    let bytes = std::mem::take(line);
    let text = String::from_utf8(bytes).map_err(|_| {
        format!(
            "project file line window contains invalid UTF-8: {}",
            relativize_for_error(path, roots)
        )
    })?;
    selected.push(text);
    Ok(max_lines.is_some_and(|limit| selected.len() >= limit))
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
    if tail.as_os_str().is_empty() {
        return Ok(canonical_ancestor);
    }
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

fn redacted_text(bytes: &[u8], max_bytes: usize) -> String {
    let text = truncate_text(bytes, max_bytes);
    // Shell policy: no URL-credential redaction, no `secret` keyword. The
    // token-scan mechanism lives in `crate::redaction`; the policy stays here.
    crate::redaction::redact_secret_tokens(&text, false, &[])
}

fn append_shell_audit<R: Runtime>(app: &tauri::AppHandle<R>, input: ShellAuditInput<'_>) {
    let Some(dir) = app.path().app_local_data_dir().ok() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("shell-execution-audit.jsonl");
    let event = serde_json::json!({
        "command": input.command,
        "cwd": input.cwd.to_string_lossy(),
        "projectId": input.project_id,
        "employeeId": input.employee_id,
        "approvalId": input.approval_id,
        "timeoutMs": input.timeout_ms,
        "exitCode": input.exit_code,
        "timedOut": input.timed_out,
        "networkPolicy": input.network_policy,
        "stdout": {
            "redactedPreview": input.stdout,
            "redactedChars": input.stdout.len(),
        },
        "stderr": {
            "redactedPreview": input.stderr,
            "redactedChars": input.stderr.len(),
        },
        "credentialBytesRecorded": false,
        "atUnixMs": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default(),
    });
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{event}");
    }
}

fn scrubbed_shell_env() -> Vec<(String, String)> {
    // Shell lane uses exactly the shared minimal base allowlist (no extras).
    crate::redaction::scrub_env_to_allowlist(crate::redaction::BASE_ENV_ALLOWLIST)
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
    let candidate = resolve_project_candidate(&path, cwd.as_deref(), &roots)?;
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
    let candidate = resolve_project_candidate(&path, cwd.as_deref(), &roots)?;
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
pub async fn project_read_file_lines<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    cwd: Option<String>,
    project_id: Option<String>,
    offset: u32,
    limit: Option<u32>,
) -> Result<String, String> {
    let roots = workspace_roots(&app, project_id.as_deref()).await?;
    let candidate = resolve_project_candidate(&path, cwd.as_deref(), &roots)?;
    let canonical = candidate
        .canonicalize()
        .map_err(|err| fs_resolve_error("resolve project file", &candidate, err))?;
    ensure_inside_workspace(&canonical, &roots)?;

    let file = tokio::fs::File::open(&canonical)
        .await
        .map_err(|err| fs_op_error("open project file", &canonical, &roots, err))?;
    let mut reader = BufReader::new(file);
    let start_line = offset.max(1);
    let max_lines = limit.map(|value| value.max(1) as usize);
    let mut line_no = 1_u32;
    let mut selected = Vec::new();
    let mut retained_bytes = 0_u64;

    let mut scanned_bytes = 0_u64;
    let mut line = Vec::new();
    let mut buf = [0_u8; 8192];
    loop {
        let read = reader
            .read(&mut buf)
            .await
            .map_err(|err| fs_op_error("read project file lines", &canonical, &roots, err))?;
        if read == 0 {
            if !line.is_empty()
                && push_line_window(
                    line_no,
                    start_line,
                    &mut line,
                    &mut selected,
                    &mut retained_bytes,
                    max_lines,
                    &canonical,
                    &roots,
                )?
            {
                break;
            }
            break;
        }
        scanned_bytes = scanned_bytes.saturating_add(read as u64);
        if scanned_bytes > MAX_READ_BYTES {
            return Err(line_window_size_error("scan", &canonical, &roots));
        }
        for byte in &buf[..read] {
            line.push(*byte);
            if line.len() as u64 > MAX_READ_BYTES {
                return Err(line_window_size_error("record", &canonical, &roots));
            }
            if *byte == b'\n' {
                if push_line_window(
                    line_no,
                    start_line,
                    &mut line,
                    &mut selected,
                    &mut retained_bytes,
                    max_lines,
                    &canonical,
                    &roots,
                )? {
                    return Ok(format!("{}\n", selected.join("\n")));
                }
                line_no = line_no.saturating_add(1);
            }
        }
    }

    if selected.is_empty() {
        Ok(String::new())
    } else {
        Ok(format!("{}\n", selected.join("\n")))
    }
}

#[tauri::command]
pub async fn project_exists<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    cwd: Option<String>,
    project_id: Option<String>,
) -> Result<bool, String> {
    let roots = workspace_roots(&app, project_id.as_deref()).await?;
    let candidate = resolve_project_candidate(&path, cwd.as_deref(), &roots)?;
    let canonical = match candidate.canonicalize() {
        Ok(path) => path,
        Err(_) => return Ok(false),
    };
    if ensure_inside_workspace(&canonical, &roots).is_err() {
        return Ok(false);
    }
    Ok(tokio::fs::metadata(&canonical).await.is_ok())
}

#[tauri::command]
pub async fn project_list_dir<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    cwd: Option<String>,
    project_id: Option<String>,
) -> Result<Vec<ProjectDirEntry>, String> {
    let roots = workspace_roots(&app, project_id.as_deref()).await?;
    let candidate = resolve_project_candidate(&path, cwd.as_deref(), &roots)?;
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
    let candidate = resolve_project_candidate(&path, cwd.as_deref(), &roots)?;
    ensure_write_size(content.len(), &candidate, &roots)?;
    let target = resolve_write_target(&candidate, &roots)?;
    ensure_inside_workspace(&target, &roots)?;
    // The leaf file name we will open. Anchoring the open under the freshly
    // canonicalized parent (below) — rather than `target` directly — means the
    // path components above the leaf cannot have been swapped after validation.
    let leaf = target
        .file_name()
        .ok_or_else(|| "project file target has no file name".to_string())?
        .to_os_string();
    let parent = target
        .parent()
        .ok_or_else(|| "project file target has no parent".to_string())?;
    ensure_inside_workspace(parent, &roots)?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|err| fs_op_error("create project file parent", parent, &roots, err))?;
    // Re-assert the boundary on the canonicalized parent IMMEDIATELY before the
    // open below. This closes the canonicalize-then-write window for the parent
    // chain; the leaf component is guarded separately by O_NOFOLLOW so a symlink
    // swapped in at the final path segment is rejected rather than followed out
    // of the workspace.
    let canonical_parent = parent
        .canonicalize()
        .map_err(|err| fs_resolve_error("resolve project file parent", parent, err))?;
    ensure_inside_workspace(&canonical_parent, &roots)?;
    let leaf_target = canonical_parent.join(&leaf);

    let mut opts = OpenOptions::new();
    opts.create(true).truncate(true).write(true);
    // O_NOFOLLOW rejects (ELOOP) an *existing* symlink at the final component
    // instead of following it; new-file creation is unaffected. This removes the
    // leaf-symlink escape that the post-write canonicalize check could only
    // detect after the out-of-bounds target had already been opened/truncated.
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = opts
        .open(&leaf_target)
        .map_err(|err| fs_op_error("write project file", &leaf_target, &roots, err))?;
    file.write_all(content.as_bytes())
        .map_err(|err| fs_op_error("write project file", &leaf_target, &roots, err))?;
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn bash_execute<R: Runtime>(
    app: tauri::AppHandle<R>,
    cwd: String,
    cmd: String,
    timeout_ms: u32,
    max_output_bytes: Option<u32>,
    project_id: Option<String>,
    approval_id: Option<String>,
    employee_id: Option<String>,
    network_policy: Option<String>,
) -> Result<BashExecuteResult, String> {
    let project_id = project_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "projectId is required for bash_execute".to_string())?
        .to_string();
    let roots = workspace_roots(&app, Some(&project_id)).await?;
    let cwd_path = PathBuf::from(&cwd)
        .canonicalize()
        .map_err(|err| fs_resolve_error("resolve shell cwd", Path::new(&cwd), err))?;
    ensure_inside_workspace(&cwd_path, &roots)?;
    let network_policy = network_policy.unwrap_or_else(|| "approval-gated-disclosed".into());

    if let crate::shell_classifier::Decision::Deny(reason) = crate::shell_classifier::classify(&cmd)
    {
        return Err(format!("bash_execute rejected: {reason}"));
    }

    let child = Command::new("bash")
        .arg("-c")
        .arg(&cmd)
        .current_dir(&cwd_path)
        .env_clear()
        .envs(scrubbed_shell_env())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| fs_op_error("spawn bash in", &cwd_path, &roots, err))?;

    let max_bytes = max_output_bytes
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_MAX_OUTPUT_BYTES);
    // E/I2: on timeout, `tokio::time::timeout` cancels the inner future,
    // which drops `child.wait_with_output()`, which in turn drops the tokio
    // `Child`. We configured `kill_on_drop(true)` above, so SIGKILL is sent
    // to the spawned process during that drop. The process is not orphaned;
    // we explicitly do NOT need a separate `child.kill().await` here because
    // `wait_with_output()` has taken ownership of the child by this point.
    let timed = timeout(
        Duration::from_millis(u64::from(timeout_ms.max(1))),
        child.wait_with_output(),
    )
    .await;

    match timed {
        Ok(output) => {
            let output =
                output.map_err(|err| fs_op_error("wait for bash in", &cwd_path, &roots, err))?;
            let stdout = redacted_text(&output.stdout, max_bytes);
            let stderr = redacted_text(&output.stderr, max_bytes);
            let exit_code = output.status.code().unwrap_or(-1);
            append_shell_audit(
                &app,
                ShellAuditInput {
                    command: &cmd,
                    cwd: &cwd_path,
                    project_id: &project_id,
                    employee_id: employee_id.as_deref(),
                    approval_id: approval_id.as_deref(),
                    timeout_ms,
                    exit_code,
                    timed_out: false,
                    network_policy: &network_policy,
                    stdout: &stdout,
                    stderr: &stderr,
                },
            );
            Ok(BashExecuteResult {
                stdout,
                stderr,
                exit_code,
                timed_out: false,
                project_id,
                cwd: cwd_path.to_string_lossy().to_string(),
                network_policy,
                approval_id,
            })
        }
        Err(_) => {
            let stdout = String::new();
            let stderr = "Command timed out".to_string();
            append_shell_audit(
                &app,
                ShellAuditInput {
                    command: &cmd,
                    cwd: &cwd_path,
                    project_id: &project_id,
                    employee_id: employee_id.as_deref(),
                    approval_id: approval_id.as_deref(),
                    timeout_ms,
                    exit_code: -1,
                    timed_out: true,
                    network_policy: &network_policy,
                    stdout: &stdout,
                    stderr: &stderr,
                },
            );
            Ok(BashExecuteResult {
                stdout,
                stderr,
                exit_code: -1,
                timed_out: true,
                project_id,
                cwd: cwd_path.to_string_lossy().to_string(),
                network_policy,
                approval_id,
            })
        }
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
        let target = resolve_write_target(
            &workspace.path.join("nested/file.txt"),
            std::slice::from_ref(&root),
        )
        .expect("target resolves");
        assert!(target.starts_with(root));
        assert!(target.ends_with("nested/file.txt"));
    }

    #[test]
    fn overwrites_existing_root_file_through_resolved_write_target() {
        let workspace = TestDir::new("overwrite-root");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let existing = root.join("generate_pdf.py");
        fs::write(&existing, "old").expect("seed existing root file");
        let root_str = root.to_string_lossy().to_string();
        let candidate =
            resolve_candidate("generate_pdf.py", Some(&root_str)).expect("relative candidate");
        let target = resolve_write_target(&candidate, &[root]).expect("target resolves");

        fs::write(&target, "new").expect("overwrite existing root file");

        assert_eq!(
            fs::read_to_string(&existing).expect("read overwritten file"),
            "new"
        );
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

    #[test]
    fn shell_output_redaction_removes_secret_like_tokens() {
        let output = redacted_text(
            b"ok sk-test_abcdefghijklmnopqrstuvwxyz offisim_token_abcdefghijklmnopqrstuvwxyz",
            1024,
        );

        assert!(output.contains("[REDACTED]"));
        assert!(!output.contains("sk-test_abcdefghijklmnopqrstuvwxyz"));
        assert!(!output.contains("offisim_token_abcdefghijklmnopqrstuvwxyz"));
    }

    #[test]
    fn shell_env_scrub_uses_minimal_allowlist() {
        let env = scrubbed_shell_env();
        let keys: std::collections::HashSet<_> = env.iter().map(|(key, _)| key.as_str()).collect();

        assert!(!keys.contains("OPENAI_API_KEY"));
        assert!(!keys.contains("ANTHROPIC_API_KEY"));
        assert!(!keys.contains("COOKIE"));
        assert!(keys.iter().all(|key| matches!(
            *key,
            "PATH" | "HOME" | "USER" | "LANG" | "TERM" | "TMPDIR" | "LC_ALL" | "LC_CTYPE"
        )));
    }
}
