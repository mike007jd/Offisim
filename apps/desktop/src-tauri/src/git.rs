use serde::Serialize;
use tokio::process::Command;

/// Allowed git subcommands (whitelist for safety).
const ALLOWED_SUBCOMMANDS: &[&str] = &[
    "status", "add", "commit", "diff", "log", "rev-parse", "init",
];

/// Blocked flags that could cause destructive operations.
const BLOCKED_FLAGS: &[&str] = &[
    "--no-verify",
    "--force",
    "-f",
    "--hard",
    "--amend",
];

#[derive(Debug, Serialize)]
pub struct GitResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

fn is_allowed(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("No git arguments provided".to_string());
    }

    let subcommand = &args[0];
    if !ALLOWED_SUBCOMMANDS.contains(&subcommand.as_str()) {
        return Err(format!(
            "Git subcommand '{}' is not allowed. Allowed: {}",
            subcommand,
            ALLOWED_SUBCOMMANDS.join(", ")
        ));
    }

    for arg in args {
        if BLOCKED_FLAGS.contains(&arg.as_str()) {
            return Err(format!("Git flag '{}' is blocked for safety", arg));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn git_exec(args: Vec<String>, cwd: String) -> Result<GitResult, String> {
    is_allowed(&args)?;

    let output = Command::new("git")
        .args(&args)
        .current_dir(&cwd)
        .output()
        .await
        .map_err(|e| format!("Failed to execute git: {}", e))?;

    Ok(GitResult {
        ok: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}
