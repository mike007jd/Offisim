use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use tauri::Runtime;
use tokio::process::Command;

/// Allowed git subcommands (whitelist for safety).
const ALLOWED_SUBCOMMANDS: &[&str] = &[
    "status",
    "add",
    "commit",
    "diff",
    "log",
    "rev-parse",
    "branch",
    "remote",
    "init",
    "clone",
];

/// Blocked flags that could cause destructive operations.
const BLOCKED_FLAGS: &[&str] = &["--no-verify", "--force", "-f", "--hard", "--amend"];
const CLONE_USAGE: &str =
    "git clone is restricted to: clone --depth 1 [--branch ref] <url> <destination>";
const MAX_GIT_OUTPUT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct GitResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

fn is_allowed(args: &[String], root: &Path) -> Result<(), String> {
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

    match subcommand.as_str() {
        "status" => validate_status(args),
        "add" => validate_pathspec_command(args, root, "git add"),
        "commit" => validate_commit(args, root),
        "diff" => validate_diff(args, root),
        "log" => validate_log(args, root),
        "rev-parse" => validate_rev_parse(args),
        "branch" => validate_branch(args),
        "remote" => validate_remote(args),
        "init" => {
            if args.len() == 1 {
                Ok(())
            } else {
                Err("git init does not accept options in Offisim".into())
            }
        }
        "clone" => {
            clone_destination_arg(args)?;
            Ok(())
        }
        _ => Err(format!("Git subcommand '{}' is not allowed", subcommand)),
    }
}

#[tauri::command]
pub async fn git_exec<R: Runtime>(
    app: tauri::AppHandle<R>,
    args: Vec<String>,
    project_id: String,
    cwd: Option<String>,
) -> Result<GitResult, String> {
    let root = project_workspace_root(&app, &project_id).await?;
    is_allowed(&args, &root)?;
    if args.first().map(String::as_str) == Some("clone") {
        prepare_clone_destination(&root, &args)?;
    }
    let cwd_path = match cwd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => resolve_git_cwd(&root, value)?,
        None => root.clone(),
    };

    let output = Command::new("git")
        .args(&args)
        .current_dir(&cwd_path)
        .env_clear()
        .envs(scrubbed_git_env())
        .output()
        .await
        .map_err(|e| format!("Failed to execute git: {}", e))?;

    Ok(GitResult {
        ok: output.status.success(),
        stdout: redacted_git_output(&output.stdout),
        stderr: redacted_git_output(&output.stderr),
    })
}

fn scrubbed_git_env() -> Vec<(String, String)> {
    // Git lane extends the shared base allowlist with SSH_AUTH_SOCK (for
    // ssh-agent-backed remotes) and pins GIT_TERMINAL_PROMPT=0. The base set
    // and the scan mechanism are shared via `crate::redaction`; the git-only
    // extras stay here so the policies are not unified into a superset.
    let mut allow = crate::redaction::BASE_ENV_ALLOWLIST.to_vec();
    allow.push("SSH_AUTH_SOCK");
    let mut env = crate::redaction::scrub_env_to_allowlist(&allow);
    env.push(("GIT_TERMINAL_PROMPT".into(), "0".into()));
    env
}

fn truncate_git_output(bytes: &[u8]) -> String {
    let capped = if bytes.len() > MAX_GIT_OUTPUT_BYTES {
        &bytes[..MAX_GIT_OUTPUT_BYTES]
    } else {
        bytes
    };
    let mut text = String::from_utf8_lossy(capped).to_string();
    if bytes.len() > MAX_GIT_OUTPUT_BYTES {
        text.push_str("\n[OUTPUT TRUNCATED]");
    }
    text
}

fn redacted_git_output(bytes: &[u8]) -> String {
    let text = truncate_git_output(bytes);
    // Git policy (stricter than shell): URL-credential redaction on + the extra
    // `secret` keyword. The scan mechanism lives in `crate::redaction`.
    crate::redaction::redact_secret_tokens(&text, true, &["secret"])
}

fn validate_status(args: &[String]) -> Result<(), String> {
    for arg in args.iter().skip(1) {
        match arg.as_str() {
            "--porcelain"
            | "--porcelain=v1"
            | "--branch"
            | "--short"
            | "-sb"
            | "--untracked-files=all" => {}
            value => return Err(format!("git status option '{}' is not allowed", value)),
        }
    }
    Ok(())
}

fn validate_pathspec_command(args: &[String], root: &Path, label: &str) -> Result<(), String> {
    if args.len() < 2 {
        return Err(format!("{label} requires at least one path"));
    }
    let mut seen_separator = false;
    let mut path_count = 0usize;
    for arg in args.iter().skip(1) {
        if arg == "--" {
            seen_separator = true;
            continue;
        }
        if !seen_separator && arg.starts_with('-') {
            return Err(format!("{label} option '{}' is not allowed", arg));
        }
        validate_git_pathspec(arg, root, label)?;
        path_count += 1;
    }
    if path_count == 0 {
        return Err(format!("{label} requires at least one path"));
    }
    Ok(())
}

fn validate_commit(args: &[String], root: &Path) -> Result<(), String> {
    if args.len() < 3 {
        return Err("git commit is restricted to: commit -m <message> [-- <path>...]".into());
    }
    if !matches!(args[1].as_str(), "-m" | "--message") {
        return Err(format!("git commit option '{}' is not allowed", args[1]));
    }
    reject_option_like_value(&args[2], "git commit message")?;
    if args.len() == 3 {
        return Ok(());
    }
    if args.get(3).map(String::as_str) != Some("--") {
        return Err("git commit pathspecs must follow --".into());
    }
    if args.len() == 4 {
        return Err("git commit pathspec requires at least one path".into());
    }
    for path in args.iter().skip(4) {
        validate_git_pathspec(path, root, "git commit path")?;
    }
    Ok(())
}

fn validate_diff(args: &[String], root: &Path) -> Result<(), String> {
    let mut path_mode = false;
    for arg in args.iter().skip(1) {
        if arg == "--" {
            path_mode = true;
            continue;
        }
        if path_mode {
            validate_git_pathspec(arg, root, "git diff path")?;
            continue;
        }
        match arg.as_str() {
            "--cached" | "--numstat" | "--stat" | "--name-only" | "--name-status" => {}
            value if value.starts_with("--unified=") => {}
            value if value.starts_with('-') => {
                return Err(format!("git diff option '{}' is not allowed", value));
            }
            value => validate_git_pathspec(value, root, "git diff path")?,
        }
    }
    Ok(())
}

fn validate_log(args: &[String], root: &Path) -> Result<(), String> {
    let mut path_mode = false;
    let mut expect_count = false;
    for arg in args.iter().skip(1) {
        if expect_count {
            if arg.parse::<u16>().is_err() {
                return Err("git log -n requires a numeric count".into());
            }
            expect_count = false;
            continue;
        }
        if arg == "--" {
            path_mode = true;
            continue;
        }
        if path_mode {
            validate_git_pathspec(arg, root, "git log path")?;
            continue;
        }
        match arg.as_str() {
            "--oneline" | "--decorate" | "--graph" => {}
            "-n" => expect_count = true,
            value if value.starts_with("--max-count=") => {
                let count = value.trim_start_matches("--max-count=");
                if count.parse::<u16>().is_err() {
                    return Err("git log --max-count requires a numeric count".into());
                }
            }
            value if value.starts_with('-') => {
                return Err(format!("git log option '{}' is not allowed", value));
            }
            value => validate_git_pathspec(value, root, "git log path")?,
        }
    }
    if expect_count {
        return Err("git log -n requires a numeric count".into());
    }
    Ok(())
}

fn validate_rev_parse(args: &[String]) -> Result<(), String> {
    let tail: Vec<&str> = args.iter().skip(1).map(String::as_str).collect();
    match tail.as_slice() {
        ["--is-inside-work-tree"]
        | ["--abbrev-ref", "HEAD"]
        | ["--show-toplevel"]
        | ["--short", "HEAD"]
        | ["HEAD"] => Ok(()),
        _ => Err("git rev-parse arguments are not allowed".into()),
    }
}

fn validate_branch(args: &[String]) -> Result<(), String> {
    let tail: Vec<&str> = args.iter().skip(1).map(String::as_str).collect();
    match tail.as_slice() {
        [] | ["--list"] | ["--show-current"] => Ok(()),
        _ => Err("git branch arguments are not allowed".into()),
    }
}

fn validate_remote(args: &[String]) -> Result<(), String> {
    let tail: Vec<&str> = args.iter().skip(1).map(String::as_str).collect();
    match tail.as_slice() {
        ["get-url", "origin"] => Ok(()),
        _ => Err("git remote is restricted to: remote get-url origin".into()),
    }
}

async fn project_workspace_root<R: Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: &str,
) -> Result<PathBuf, String> {
    // Identical SQL / missing-row / canonicalize behavior as the shared helper;
    // git only keeps its own empty-id message. (Internal eprintln log prefix is
    // now `[local_paths]`, which is logging-only and not observable behavior.)
    crate::local_paths::project_workspace_root_with(
        app,
        project_id,
        "projectId is required for git_exec",
    )
    .await
}

fn resolve_git_cwd(root: &Path, cwd: &str) -> Result<PathBuf, String> {
    let input = PathBuf::from(cwd);
    if !input.is_absolute()
        && input
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("parent-directory cwd segments are not allowed".into());
    }
    let candidate = if input.is_absolute() {
        input
    } else {
        root.join(input)
    };
    let canonical = candidate
        .canonicalize()
        .map_err(|err| format!("Resolve git cwd: {err}"))?;
    if canonical.starts_with(root) {
        Ok(canonical)
    } else {
        Err("git cwd is outside the bound project workspace".into())
    }
}

fn prepare_clone_destination(root: &Path, args: &[String]) -> Result<PathBuf, String> {
    let destination = clone_destination_arg(args)?;
    let destination = resolve_new_path_under_root(root, destination, "git clone destination")?;
    let parent = destination
        .parent()
        .ok_or_else(|| "git clone destination must have a parent directory".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|err| format!("Create git clone destination parent: {err}"))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|err| format!("Resolve git clone destination parent: {err}"))?;
    if !canonical_parent.starts_with(root) {
        return Err("git clone destination is outside the bound project workspace".into());
    }
    if destination.exists() {
        let canonical_destination = destination
            .canonicalize()
            .map_err(|err| format!("Resolve git clone destination: {err}"))?;
        if !canonical_destination.starts_with(root) {
            return Err("git clone destination is outside the bound project workspace".into());
        }
    }
    Ok(destination)
}

fn clone_destination_arg(args: &[String]) -> Result<&str, String> {
    let mut positionals: Vec<&str> = Vec::new();
    let mut has_depth = false;
    let mut has_branch = false;
    let mut i = 1usize;
    while i < args.len() {
        let arg = args[i].as_str();
        match arg {
            "--depth" => {
                if has_depth {
                    return Err("git clone depth can only be specified once".into());
                }
                let value = args
                    .get(i + 1)
                    .map(String::as_str)
                    .ok_or_else(|| CLONE_USAGE.to_string())?;
                if value != "1" {
                    return Err("git clone depth must be exactly 1".into());
                }
                has_depth = true;
                i += 2;
            }
            "--branch" => {
                if has_branch {
                    return Err("git clone branch can only be specified once".into());
                }
                let value = args
                    .get(i + 1)
                    .map(String::as_str)
                    .ok_or_else(|| CLONE_USAGE.to_string())?;
                reject_option_like_value(value, "git clone branch")?;
                has_branch = true;
                i += 2;
            }
            value if value.starts_with('-') => {
                return Err(format!("git clone option '{}' is not allowed", value));
            }
            value => {
                reject_option_like_value(value, "git clone positional")?;
                positionals.push(value);
                i += 1;
            }
        }
    }
    if !has_depth {
        return Err("git clone must use --depth 1".into());
    }
    if positionals.len() != 2 {
        return Err(CLONE_USAGE.into());
    }
    Ok(positionals[1])
}

fn reject_option_like_value(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.starts_with('-') {
        return Err(format!("{label} must be a non-option value"));
    }
    Ok(())
}

fn validate_git_pathspec(value: &str, root: &Path, label: &str) -> Result<(), String> {
    reject_option_like_value(value, label)?;
    let path = PathBuf::from(value);
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!("{label} cannot contain parent-directory segments"));
    }
    if path.is_absolute() && !path.starts_with(root) {
        return Err(format!("{label} is outside the bound project workspace"));
    }
    Ok(())
}

fn resolve_new_path_under_root(root: &Path, input: &str, label: &str) -> Result<PathBuf, String> {
    let input_path = PathBuf::from(input);
    if input_path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!("{label} cannot contain parent-directory segments"));
    }
    let candidate = if input_path.is_absolute() {
        input_path
    } else {
        root.join(input_path)
    };
    if candidate.starts_with(root) {
        Ok(candidate)
    } else {
        Err(format!("{label} is outside the bound project workspace"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP_ROOT_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "offisim-git-cwd-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            TEMP_ROOT_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(root.join("sub")).unwrap();
        root.canonicalize().unwrap()
    }

    fn cleanup_root(root: PathBuf) {
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_git_cwd_accepts_relative_inside_root() {
        let root = temp_root();
        let cwd = resolve_git_cwd(&root, "sub").unwrap();
        assert!(cwd.starts_with(&root));
        cleanup_root(root);
    }

    #[test]
    fn resolve_git_cwd_rejects_parent_segments() {
        let root = temp_root();
        let err = resolve_git_cwd(&root, "../outside").unwrap_err();
        assert!(err.contains("parent-directory"));
        cleanup_root(root);
    }

    #[test]
    fn resolve_git_cwd_rejects_absolute_outside_root() {
        let root = temp_root();
        let err = resolve_git_cwd(&root, std::env::temp_dir().to_str().unwrap()).unwrap_err();
        assert!(err.contains("outside"));
        cleanup_root(root);
    }

    #[test]
    fn is_allowed_accepts_workbench_status_diff_remote_commit() {
        let root = temp_root();
        let cases = vec![
            vec![
                "status",
                "--porcelain=v1",
                "--branch",
                "--untracked-files=all",
            ],
            vec!["diff", "--numstat"],
            vec!["diff", "--cached", "--", "src/main.ts"],
            vec!["remote", "get-url", "origin"],
            vec!["rev-parse", "--abbrev-ref", "HEAD"],
            vec!["add", "--", "src/main.ts"],
            vec!["commit", "-m", "workbench commit"],
            vec!["commit", "-m", "selected commit", "--", "src/main.ts"],
        ];
        for args in cases {
            let owned = args.into_iter().map(String::from).collect::<Vec<_>>();
            is_allowed(&owned, &root).unwrap();
        }
        cleanup_root(root);
    }

    #[test]
    fn is_allowed_rejects_destructive_or_remote_mutation_git() {
        let root = temp_root();
        let cases = vec![
            vec!["push", "origin", "main"],
            vec!["reset", "--hard"],
            vec!["commit", "--amend"],
            vec!["add", "-A"],
            vec!["remote", "add", "origin", "https://example.test/repo.git"],
            vec!["diff", "--ext-diff"],
        ];
        for args in cases {
            let owned = args.into_iter().map(String::from).collect::<Vec<_>>();
            assert!(is_allowed(&owned, &root).is_err());
        }
        cleanup_root(root);
    }

    #[test]
    fn prepare_clone_destination_creates_project_tmp_parent() {
        let root = temp_root();
        let dest = root.join(".offisim/tmp/offisim-skill-test");
        let args = vec![
            "clone".to_string(),
            "--depth".to_string(),
            "1".to_string(),
            "https://example.test/repo.git".to_string(),
            dest.to_string_lossy().to_string(),
        ];
        let prepared = prepare_clone_destination(&root, &args).unwrap();
        assert_eq!(prepared, dest);
        assert!(root.join(".offisim/tmp").is_dir());
        cleanup_root(root);
    }

    #[test]
    fn prepare_clone_destination_rejects_parent_segments() {
        let root = temp_root();
        let args = vec![
            "clone".to_string(),
            "--depth".to_string(),
            "1".to_string(),
            "https://example.test/repo.git".to_string(),
            ".offisim/tmp/../escape".to_string(),
        ];
        let err = prepare_clone_destination(&root, &args).unwrap_err();
        assert!(err.contains("parent-directory"));
        cleanup_root(root);
    }

    #[test]
    fn prepare_clone_destination_rejects_absolute_outside_root() {
        let root = temp_root();
        let args = vec![
            "clone".to_string(),
            "--depth".to_string(),
            "1".to_string(),
            "https://example.test/repo.git".to_string(),
            std::env::temp_dir()
                .join("outside-clone")
                .to_string_lossy()
                .to_string(),
        ];
        let err = prepare_clone_destination(&root, &args).unwrap_err();
        assert!(err.contains("outside"));
        cleanup_root(root);
    }

    #[test]
    fn prepare_clone_destination_rejects_missing_destination() {
        let root = temp_root();
        let args = vec![
            "clone".to_string(),
            "--depth".to_string(),
            "1".to_string(),
            "https://example.test/repo.git".to_string(),
        ];
        let err = prepare_clone_destination(&root, &args).unwrap_err();
        assert!(err.contains("restricted to"));
        cleanup_root(root);
    }

    #[test]
    fn prepare_clone_destination_accepts_skill_install_branch_shape() {
        let root = temp_root();
        let dest = root.join(".offisim/tmp/offisim-skill-test");
        let args = vec![
            "clone".to_string(),
            "--depth".to_string(),
            "1".to_string(),
            "--branch".to_string(),
            "main".to_string(),
            "https://example.test/repo.git".to_string(),
            dest.to_string_lossy().to_string(),
        ];
        let prepared = prepare_clone_destination(&root, &args).unwrap();
        assert_eq!(prepared, dest);
        cleanup_root(root);
    }

    #[test]
    fn prepare_clone_destination_rejects_separate_git_dir() {
        let root = temp_root();
        let args = vec![
            "clone".to_string(),
            "--depth".to_string(),
            "1".to_string(),
            "--separate-git-dir".to_string(),
            "/tmp/outside-git-dir".to_string(),
            "https://example.test/repo.git".to_string(),
            root.join(".offisim/tmp/repo").to_string_lossy().to_string(),
        ];
        let err = prepare_clone_destination(&root, &args).unwrap_err();
        assert!(err.contains("--separate-git-dir"));
        cleanup_root(root);
    }

    #[test]
    fn prepare_clone_destination_rejects_config_flag() {
        let root = temp_root();
        let args = vec![
            "clone".to_string(),
            "--depth".to_string(),
            "1".to_string(),
            "-c".to_string(),
            "core.sshCommand=touch /tmp/offisim-escape".to_string(),
            "https://example.test/repo.git".to_string(),
            root.join(".offisim/tmp/repo").to_string_lossy().to_string(),
        ];
        let err = prepare_clone_destination(&root, &args).unwrap_err();
        assert!(err.contains("-c"));
        cleanup_root(root);
    }

    #[test]
    fn prepare_clone_destination_rejects_reference() {
        let root = temp_root();
        let args = vec![
            "clone".to_string(),
            "--depth".to_string(),
            "1".to_string(),
            "--reference".to_string(),
            "/tmp/local-reference".to_string(),
            "https://example.test/repo.git".to_string(),
            root.join(".offisim/tmp/repo").to_string_lossy().to_string(),
        ];
        let err = prepare_clone_destination(&root, &args).unwrap_err();
        assert!(err.contains("--reference"));
        cleanup_root(root);
    }

    #[test]
    fn scrubbed_git_env_excludes_provider_secrets() {
        std::env::set_var("OPENAI_API_KEY", "sk-test-secret");
        std::env::set_var("ANTHROPIC_API_KEY", "sk-test-secret");
        let env = scrubbed_git_env();
        let keys = env.into_iter().map(|(key, _)| key).collect::<Vec<_>>();
        assert!(!keys.contains(&"OPENAI_API_KEY".to_string()));
        assert!(!keys.contains(&"ANTHROPIC_API_KEY".to_string()));
        assert!(keys.contains(&"GIT_TERMINAL_PROMPT".to_string()));
    }

    #[test]
    fn redacted_git_output_removes_url_credentials_and_secret_tokens() {
        let output = redacted_git_output(
            b"remote https://ghp_abcdefghijklmnopqrstuvwxyz123456@github.com/acme/repo.git\nsk-abcdefghijklmnopqrstuvwxyz123456\n",
        );
        assert!(!output.contains("ghp_abcdefghijklmnopqrstuvwxyz123456"));
        assert!(!output.contains("sk-abcdefghijklmnopqrstuvwxyz123456"));
        assert!(output.contains("https://[REDACTED]@github.com/acme/repo.git"));
    }

    #[test]
    fn redacted_git_output_truncates_large_output() {
        let bytes = vec![b'a'; MAX_GIT_OUTPUT_BYTES + 1];
        let output = redacted_git_output(&bytes);
        assert!(output.ends_with("[OUTPUT TRUNCATED]"));
    }
}
