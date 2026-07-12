use serde::Serialize;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tauri::Runtime;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

const MAX_GH_OUTPUT_BYTES: usize = 1024 * 1024;
const GH_EXEC_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Serialize)]
pub struct GhResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

fn is_allowed(args: &[String]) -> Result<(), String> {
    let tail: Vec<&str> = args.iter().map(String::as_str).collect();
    match tail.as_slice() {
        ["auth", "status"]
        | ["pr", "list"]
        | ["pr", "status"]
        | ["pr", "view"]
        | ["pr", "view", "--web"] => Ok(()),
        ["pr", "create", rest @ ..] => validate_pr_create(rest),
        _ => Err("gh arguments are restricted to auth status and approved pr operations".into()),
    }
}

fn validate_pr_create(args: &[&str]) -> Result<(), String> {
    if args.len() < 4 || args[0] != "--title" || args[2] != "--body" {
        return Err(
            "gh pr create is restricted to: pr create --title <title> --body <body> [--base <branch>] [--draft]"
                .into(),
        );
    }
    validate_value(args[1], "PR title", false)?;
    validate_value(args[3], "PR body", true)?;

    let mut index = 4usize;
    let mut seen_base = false;
    let mut seen_draft = false;
    while index < args.len() {
        match args[index] {
            "--base" if !seen_base => {
                let branch = args
                    .get(index + 1)
                    .ok_or_else(|| "gh pr create --base requires a branch".to_string())?;
                validate_branch_name(branch)?;
                seen_base = true;
                index += 2;
            }
            "--draft" if !seen_draft => {
                seen_draft = true;
                index += 1;
            }
            value => return Err(format!("gh pr create option '{value}' is not allowed")),
        }
    }
    Ok(())
}

fn validate_value(value: &str, label: &str, allow_empty: bool) -> Result<(), String> {
    if (!allow_empty && value.trim().is_empty()) || value.starts_with('-') {
        return Err(format!("{label} must be a non-option value"));
    }
    Ok(())
}

fn validate_branch_name(value: &str) -> Result<(), String> {
    validate_value(value, "PR base branch", false)?;
    if value.starts_with('/')
        || value.ends_with('/')
        || value.contains("//")
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '/' | '_' | '-'))
    {
        return Err("PR base branch contains unsupported characters".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn gh_exec<R: Runtime>(
    app: tauri::AppHandle<R>,
    args: Vec<String>,
    project_id: String,
) -> Result<GhResult, String> {
    is_allowed(&args)?;
    let root = crate::local_paths::project_workspace_root_with(
        &app,
        &project_id,
        "projectId is required for gh_exec",
    )
    .await?;
    run_gh_capped(&root, &args).await
}

async fn run_gh_capped(root: &Path, args: &[String]) -> Result<GhResult, String> {
    let mut command = Command::new("gh");
    command
        .args(args)
        .current_dir(root)
        .env_clear()
        .envs(crate::redaction::scrub_env_to_allowlist(
            crate::redaction::BASE_ENV_ALLOWLIST,
        ))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = command
        .spawn()
        .map_err(|err| format!("Failed to execute gh: {err}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "gh stdout pipe unavailable".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "gh stderr pipe unavailable".to_string())?;
    let collect = async {
        let (out, err) = tokio::join!(read_capped(&mut stdout), read_capped(&mut stderr));
        let status = child
            .wait()
            .await
            .map_err(|error| format!("gh wait failed: {error}"))?;
        Ok::<_, String>((out?, err?, status))
    };

    match tokio::time::timeout(GH_EXEC_TIMEOUT, collect).await {
        Ok(result) => {
            let ((out, out_truncated), (err, err_truncated), status) = result?;
            Ok(GhResult {
                ok: status.success(),
                stdout: finalize_output(&out, out_truncated),
                stderr: finalize_output(&err, err_truncated),
            })
        }
        Err(_) => {
            let _ = child.start_kill();
            Err(format!("gh timed out after {}s", GH_EXEC_TIMEOUT.as_secs()))
        }
    }
}

async fn read_capped<R>(reader: &mut R) -> Result<(Vec<u8>, bool), String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut truncated = false;
    loop {
        let count = reader
            .read(&mut chunk)
            .await
            .map_err(|error| format!("gh output read failed: {error}"))?;
        if count == 0 {
            break;
        }
        let room = MAX_GH_OUTPUT_BYTES.saturating_sub(buffer.len());
        if room == 0 {
            truncated = true;
        } else {
            buffer.extend_from_slice(&chunk[..count.min(room)]);
            truncated |= count > room;
        }
    }
    Ok((buffer, truncated))
}

fn finalize_output(bytes: &[u8], truncated: bool) -> String {
    let mut output = String::from_utf8_lossy(bytes).to_string();
    if truncated {
        output.push_str("\n[OUTPUT TRUNCATED]");
    }
    crate::redaction::redact_secret_tokens(&output, true, &["secret"])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    #[test]
    fn accepts_approved_gh_shapes() {
        for values in [
            vec!["auth", "status"],
            vec!["pr", "list"],
            vec!["pr", "status"],
            vec!["pr", "view"],
            vec!["pr", "view", "--web"],
            vec!["pr", "create", "--title", "Ship P5", "--body", "Verified"],
            vec![
                "pr", "create", "--title", "Ship P5", "--body", "", "--base", "main", "--draft",
            ],
        ] {
            is_allowed(&args(&values)).unwrap();
        }
    }

    #[test]
    fn rejects_unapproved_gh_shapes() {
        for values in [
            vec!["auth", "login"],
            vec!["pr", "merge"],
            vec!["pr", "close"],
            vec!["pr", "list", "--json", "url"],
            vec!["pr", "view", "12"],
            vec!["pr", "create", "--fill"],
            vec!["pr", "create", "--title", "", "--body", "body"],
            vec!["pr", "create", "--title", "--web", "--body", "body"],
            vec![
                "pr", "create", "--title", "title", "--body", "body", "--base", "../main",
            ],
            vec![
                "pr", "create", "--title", "title", "--body", "body", "--head", "feature",
            ],
        ] {
            assert!(
                is_allowed(&args(&values)).is_err(),
                "unexpectedly allowed {values:?}"
            );
        }
    }
}
