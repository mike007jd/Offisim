use serde::Serialize;
use sqlx::Row;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use tauri::{Manager, Runtime};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

const DEFAULT_MAX_OUTPUT_BYTES: usize = 1024 * 1024;

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
    sqlx::SqlitePool::connect(&db_url)
        .await
        .map_err(|err| format!("open offisim.db: {err}"))
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
    .map_err(|err| format!("list project workspace roots: {err}"))?;
    pool.close().await;

    let mut roots = Vec::new();
    for row in rows {
        let raw: String = row
            .try_get("workspace_root")
            .map_err(|err| format!("decode workspace_root: {err}"))?;
        if let Ok(canonical) = PathBuf::from(raw).canonicalize() {
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

fn ensure_inside_workspace(candidate: &Path, roots: &[PathBuf]) -> Result<(), String> {
    if roots.is_empty() {
        return Err("no project workspace_root is bound for file/shell tools".to_string());
    }
    if roots.iter().any(|root| candidate.starts_with(root)) {
        return Ok(());
    }
    Err(format!(
        "path is outside bound project workspaces: {}",
        candidate.to_string_lossy()
    ))
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
    let canonical = candidate
        .canonicalize()
        .map_err(|err| format!("resolve project file: {err}"))?;
    ensure_inside_workspace(&canonical, &roots)?;
    tokio::fs::read_to_string(&canonical)
        .await
        .map_err(|err| format!("read project file: {err}"))
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
    ensure_inside_workspace(&candidate, &roots)?;
    if let Some(parent) = candidate.parent() {
        ensure_inside_workspace(parent, &roots)?;
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|err| format!("create project file parent: {err}"))?;
        let canonical_parent = parent
            .canonicalize()
            .map_err(|err| format!("resolve project file parent: {err}"))?;
        ensure_inside_workspace(&canonical_parent, &roots)?;
    }
    if candidate.exists() {
        let canonical = candidate
            .canonicalize()
            .map_err(|err| format!("resolve project file: {err}"))?;
        ensure_inside_workspace(&canonical, &roots)?;
    }
    tokio::fs::write(&candidate, content)
        .await
        .map_err(|err| format!("write project file: {err}"))
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
    let cwd_path = PathBuf::from(&cwd)
        .canonicalize()
        .map_err(|err| format!("resolve shell cwd: {err}"))?;
    ensure_inside_workspace(&cwd_path, &roots)?;

    let child = Command::new("bash")
        .arg("-lc")
        .arg(cmd)
        .current_dir(&cwd_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| format!("spawn bash: {err}"))?;

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
            let output = output.map_err(|err| format!("wait for bash: {err}"))?;
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
