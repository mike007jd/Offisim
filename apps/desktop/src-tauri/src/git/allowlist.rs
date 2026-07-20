use super::*;

/// Allowed git subcommands (whitelist for safety).
const ALLOWED_SUBCOMMANDS: &[&str] = &[
    "status",
    "add",
    "commit",
    "diff",
    "log",
    "rev-parse",
    "branch",
    "switch",
    "push",
    "remote",
    "init",
    "clone",
    "worktree",
    "merge",
    "read-tree",
    "write-tree",
    "commit-tree",
    "update-ref",
];

/// Blocked flags that could cause destructive operations.
const BLOCKED_FLAGS: &[&str] = &["--no-verify", "--force", "-f", "--hard", "--amend"];
const CLONE_USAGE: &str =
    "git clone is restricted to: clone --depth 1 [--branch ref] <url> <destination>";
pub(super) fn is_allowed(args: &[String], root: &Path) -> Result<(), String> {
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
        "add" => {
            if is_checkpoint_add(args) {
                Ok(())
            } else {
                validate_pathspec_command(args, root, "git add")
            }
        }
        "commit" => validate_commit(args, root),
        "diff" => validate_diff(args, root),
        "log" => validate_log(args, root),
        "rev-parse" => validate_rev_parse(args),
        "branch" => validate_branch(args),
        "switch" => validate_switch(args),
        "push" => validate_push(args),
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
        "worktree" => validate_worktree(args, root),
        "merge" => validate_merge(args),
        "read-tree" => validate_checkpoint_read_tree(args),
        "write-tree" => validate_checkpoint_write_tree(args),
        "commit-tree" => validate_checkpoint_commit_tree(args),
        "update-ref" => validate_checkpoint_update_ref(args),
        _ => Err(format!("Git subcommand '{}' is not allowed", subcommand)),
    }
}

pub(super) const CHECKPOINT_REF_PREFIX: &str = "refs/offisim/checkpoints/";

pub(super) fn validate_checkpoint_ref(value: &str) -> Result<(), String> {
    validate_git_ref(value, "checkpoint ref")?;
    if !value.starts_with(CHECKPOINT_REF_PREFIX) {
        return Err(format!(
            "checkpoint ref must start with {CHECKPOINT_REF_PREFIX}"
        ));
    }
    Ok(())
}

fn validate_checkpoint_read_tree(args: &[String]) -> Result<(), String> {
    let tail: Vec<&str> = args.iter().skip(1).map(String::as_str).collect();
    match tail.as_slice() {
        [revision] if *revision == "HEAD" || is_full_git_sha(revision) => Ok(()),
        ["--reset", "-u", revision] if is_full_git_sha(revision) => Ok(()),
        _ => Err(
            "git read-tree is restricted to checkpoint tree load/reset with HEAD or a full commit id"
                .into(),
        ),
    }
}

fn validate_checkpoint_write_tree(args: &[String]) -> Result<(), String> {
    if args.len() == 1 {
        Ok(())
    } else {
        Err("git write-tree does not accept arguments in the checkpoint lane".into())
    }
}

fn validate_checkpoint_commit_tree(args: &[String]) -> Result<(), String> {
    if args.len() != 6
        || !is_full_git_sha(&args[1])
        || args.get(2).map(String::as_str) != Some("-p")
        || !is_full_git_sha(&args[3])
        || args.get(4).map(String::as_str) != Some("-m")
    {
        return Err(
            "git commit-tree is restricted to: commit-tree <tree> -p <parent> -m <message>".into(),
        );
    }
    reject_option_like_value(&args[5], "checkpoint commit message")
}

fn validate_checkpoint_update_ref(args: &[String]) -> Result<(), String> {
    let tail: Vec<&str> = args.iter().skip(1).map(String::as_str).collect();
    match tail.as_slice() {
        [reference, object_id] if is_full_git_sha(object_id) => validate_checkpoint_ref(reference),
        [reference, object_id, old_object_id]
            if is_full_git_sha(object_id) && is_full_git_sha(old_object_id) =>
        {
            validate_checkpoint_ref(reference)
        }
        ["-d", reference, old_object_id] if is_full_git_sha(old_object_id) => {
            validate_checkpoint_ref(reference)
        }
        _ => Err(
            "git update-ref is restricted to create/CAS/delete below refs/offisim/checkpoints/"
                .into(),
        ),
    }
}

pub(super) fn is_checkpoint_plumbing(args: &[String]) -> bool {
    is_checkpoint_add(args)
        || matches!(
            args.first().map(String::as_str),
            Some("read-tree" | "write-tree" | "commit-tree" | "update-ref")
        )
}

fn is_checkpoint_add(args: &[String]) -> bool {
    args.iter().map(String::as_str).collect::<Vec<_>>() == ["add", "--all", "--", "."]
}

pub(super) fn validate_binding_git_args(args: &[String]) -> Result<(), String> {
    if args.first().map(String::as_str) != Some("status") {
        return Err("task workspace authority git lane is restricted to read-only status".into());
    }
    validate_status(args)
}

fn validate_status(args: &[String]) -> Result<(), String> {
    let mut porcelain = false;
    let mut nul_terminated = false;
    for arg in args.iter().skip(1) {
        match arg.as_str() {
            "--porcelain" | "--porcelain=v1" => porcelain = true,
            "-z" => nul_terminated = true,
            "--branch" | "--short" | "-sb" | "--untracked-files=all" => {}
            value => return Err(format!("git status option '{}' is not allowed", value)),
        }
    }
    if porcelain != nul_terminated {
        return Err("git status porcelain output requires -z, and -z requires porcelain".into());
    }
    Ok(())
}

fn validate_worktree(args: &[String], root: &Path) -> Result<(), String> {
    match args.get(1).map(String::as_str) {
        Some("add") => {
            if args.len() != 5 || args.get(2).map(String::as_str) != Some("-b") {
                return Err(
                    "git worktree add is restricted to: worktree add -b <branch> <path-under-root>"
                        .into(),
                );
            }
            validate_git_ref(&args[3], "git worktree branch")?;
            resolve_new_path_under_root(root, &args[4], "git worktree path")?;
            Ok(())
        }
        Some("remove") => {
            if args.len() != 3 {
                return Err(
                    "git worktree remove is restricted to: worktree remove <path-under-root>"
                        .into(),
                );
            }
            resolve_new_path_under_root(root, &args[2], "git worktree path")?;
            Ok(())
        }
        Some(other) => Err(format!("git worktree subcommand '{other}' is not allowed")),
        None => Err("git worktree requires a subcommand".into()),
    }
}

fn validate_merge(args: &[String]) -> Result<(), String> {
    if args.len() != 3 || args.get(1).map(String::as_str) != Some("--no-ff") {
        return Err("git merge is restricted to: merge --no-ff <branch>".into());
    }
    validate_git_ref(&args[2], "git merge branch")
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
    let tail: Vec<&str> = args.iter().skip(1).map(String::as_str).collect();
    if let ["--name-only", "-z", base, "HEAD"] = tail.as_slice() {
        if is_full_git_sha(base) {
            return Ok(());
        }
        return Err("git diff base revision must be a full hex commit id".into());
    }
    if let ["--name-only", "-z", base, target] = tail.as_slice() {
        if is_full_git_sha(base) && is_full_git_sha(target) {
            return Ok(());
        }
        return Err("git diff checkpoint revisions must be full hex commit ids".into());
    }
    if tail.len() >= 5
        && tail[0].starts_with("--unified=")
        && is_full_git_sha(tail[1])
        && tail[2] == "HEAD"
        && tail[3] == "--"
    {
        for path in &tail[4..] {
            validate_git_pathspec(path, root, "git diff path")?;
        }
        return Ok(());
    }

    let mut path_mode = false;
    let mut nul_terminated = false;
    let mut machine_path_format = false;
    let mut conflict_filter = false;
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
            "--cached" | "--stat" => {}
            "--numstat" | "--name-only" | "--name-status" => machine_path_format = true,
            "-z" => nul_terminated = true,
            "--diff-filter=U" => conflict_filter = true,
            value if value.starts_with("--unified=") => {}
            value if value.starts_with('-') => {
                return Err(format!("git diff option '{}' is not allowed", value));
            }
            value => {
                return Err(format!(
                    "git diff path '{}' must follow the -- separator",
                    value
                ));
            }
        }
    }
    if machine_path_format && !nul_terminated {
        return Err("git diff machine path output requires -z".into());
    }
    if nul_terminated && !machine_path_format {
        return Err("git diff -z requires numstat, name-only, or name-status output".into());
    }
    if conflict_filter
        && !args
            .iter()
            .any(|arg| matches!(arg.as_str(), "--name-only" | "--name-status"))
    {
        return Err("git diff --diff-filter=U requires name-only or name-status output".into());
    }
    Ok(())
}

pub(super) fn is_full_git_sha(value: &str) -> bool {
    value.len() == 40 && value.chars().all(|ch| ch.is_ascii_hexdigit())
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
        ["--verify", reference] => validate_checkpoint_ref(reference),
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

fn validate_switch(args: &[String]) -> Result<(), String> {
    let tail: Vec<&str> = args.iter().skip(1).map(String::as_str).collect();
    match tail.as_slice() {
        [branch] => validate_user_branch_name(branch),
        ["-c", branch] => validate_user_branch_name(branch),
        _ => Err("git switch is restricted to: switch <branch> or switch -c <branch>".into()),
    }
}

fn validate_push(args: &[String]) -> Result<(), String> {
    let tail: Vec<&str> = args.iter().skip(1).map(String::as_str).collect();
    match tail.as_slice() {
        ["-u", "origin", branch] => validate_user_branch_name(branch),
        _ => Err("git push is restricted to: push -u origin <current-branch>".into()),
    }
}

pub(super) async fn validate_push_context(
    args: &[String],
    execution: &GitExecutionScope,
) -> Result<(), String> {
    let branch = run_git_probe_scoped(execution, &["branch", "--show-current"]).await?;
    let branch = git_line_record(&branch, "current git branch")?;
    validate_user_branch_name(branch)?;

    let target = args
        .get(3)
        .ok_or_else(|| "git push requires an explicit origin branch".to_string())?;
    if target != branch {
        return Err(format!(
            "git push target '{}' does not match current branch '{}'",
            target, branch
        ));
    }
    Ok(())
}

fn validate_user_branch_name(value: &str) -> Result<(), String> {
    reject_option_like_value(value, "git branch name")?;
    if value.starts_with('/')
        || value.ends_with('/')
        || value.contains("//")
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '/' | '_' | '-'))
    {
        return Err("git branch name may only contain letters, numbers, '/', '_' and '-'".into());
    }
    Ok(())
}

fn validate_remote(args: &[String]) -> Result<(), String> {
    let tail: Vec<&str> = args.iter().skip(1).map(String::as_str).collect();
    match tail.as_slice() {
        ["get-url", "origin"] => Ok(()),
        _ => Err("git remote is restricted to: remote get-url origin".into()),
    }
}

pub(super) fn prepare_clone_destination(root: &Path, args: &[String]) -> Result<PathBuf, String> {
    let destination = clone_destination_arg(args)?;
    let destination = resolve_new_path_under_root(root, destination, "git clone destination")?;
    let parent = destination
        .parent()
        .ok_or_else(|| "git clone destination must have a parent directory".to_string())?;
    create_directory_chain_without_symlinks(root, parent)?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|err| format!("Resolve git clone destination parent: {err}"))?;
    if !canonical_parent.starts_with(root) {
        return Err("git clone destination is outside the bound project workspace".into());
    }
    resolve_new_path_under_root(
        root,
        destination.to_string_lossy().as_ref(),
        "git clone destination",
    )?;
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
    validate_clone_source(positionals[0])?;
    Ok(positionals[1])
}

/// G2: restrict the clone SOURCE to safe remote forms. Without this, a source like
/// `file:///etc/...`, an absolute/relative local path, or a `git://` URL would be
/// handed to the local `git` binary and copied into the sandbox. Only `https://`,
/// `ssh://`, and scp-like `[user@]host:path` remotes are allowed; everything else
/// (local paths, `file://`, `http://`, `git://`, …) is rejected.
fn validate_clone_source(source: &str) -> Result<(), String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("git clone source must not be empty".into());
    }
    if let Some(scheme_end) = trimmed.find("://") {
        // A proper `scheme://authority/...` URL — IPv6 authorities like
        // `ssh://[::1]/repo` are fine here because we only inspect the scheme.
        let scheme = trimmed[..scheme_end].to_ascii_lowercase();
        return if scheme == "https" || scheme == "ssh" {
            Ok(())
        } else {
            Err(format!(
                "git clone source scheme '{scheme}://' is not allowed; use an https:// or ssh:// remote"
            ))
        };
    }
    // No `scheme://` → the only allowed form is scp-like ssh `[user@]host:path`.
    // Reject git's remote-helper transport syntax `transport::address` FIRST
    // (e.g. `ext::sh -c …` runs an arbitrary shell command, `fd::N` reads a file
    // descriptor) — the `::` separator never appears in a real https/ssh/scp
    // remote without a `scheme://`, so it is a reliable transport-helper marker.
    if trimmed.contains("::") {
        return Err(format!(
            "git clone source '{trimmed}' uses a disallowed remote-helper transport"
        ));
    }
    // scp-like `[user@]host:path`: a host (with optional `user@`), then a path.
    // The host must look like a hostname/IP (only [A-Za-z0-9._-]); this rejects
    // bare local paths (`/etc/passwd`, `./repo`, `../x`), which either have no
    // `:` or a path-shaped "host" segment.
    if let Some(colon) = trimmed.find(':') {
        let host_segment = &trimmed[..colon];
        let path = &trimmed[colon + 1..];
        let host = host_segment.rsplit('@').next().unwrap_or(host_segment);
        let host_ok = !host.is_empty()
            && host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
        if host_ok && !path.is_empty() {
            return Ok(());
        }
    }
    Err(format!(
        "git clone source '{trimmed}' is not an allowed remote; use https:// , ssh:// , or scp-like host:path (local paths, file://, and remote-helper transports are not allowed)"
    ))
}

fn reject_option_like_value(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.starts_with('-') {
        return Err(format!("{label} must be a non-option value"));
    }
    Ok(())
}

pub(super) fn validate_git_ref(value: &str, label: &str) -> Result<(), String> {
    reject_option_like_value(value, label)?;
    if value.contains("..")
        || value.contains('\\')
        || value.ends_with('/')
        || value.ends_with(".lock")
        || value.contains("@{")
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(format!("{label} is not a safe git ref"));
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '/' | '.' | '_' | '-'))
    {
        return Err(format!("{label} contains unsupported characters"));
    }
    Ok(())
}

fn validate_git_pathspec(value: &str, _root: &Path, label: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{label} cannot be empty"));
    }
    let path = PathBuf::from(value);
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!("{label} cannot contain parent-directory segments"));
    }
    if path.is_absolute() {
        return Err(format!(
            "{label} must be relative to the bound Project folder"
        ));
    }
    Ok(())
}

pub(super) fn resolve_new_path_under_root(
    root: &Path,
    input: &str,
    label: &str,
) -> Result<PathBuf, String> {
    let input_path = PathBuf::from(input);
    if input_path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!("{label} cannot contain parent-directory segments"));
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Resolve bound project workspace: {error}"))?;
    let relative = if input_path.is_absolute() {
        input_path
            .strip_prefix(root)
            .or_else(|_| input_path.strip_prefix(&canonical_root))
            .map_err(|_| format!("{label} is outside the bound project workspace"))?
            .to_path_buf()
    } else {
        input_path
    };
    let mut candidate = canonical_root.clone();
    for component in relative.components() {
        match component {
            Component::CurDir => continue,
            Component::Normal(value) => candidate.push(value),
            _ => return Err(format!("{label} contains an invalid path component")),
        }
        match std::fs::symlink_metadata(&candidate) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(format!(
                        "{label} cannot traverse symlink component {}",
                        candidate.to_string_lossy()
                    ));
                }
                let canonical = candidate
                    .canonicalize()
                    .map_err(|error| format!("Resolve {label}: {error}"))?;
                if !canonical.starts_with(&canonical_root) {
                    return Err(format!("{label} is outside the bound project workspace"));
                }
                candidate = canonical;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Inspect {label}: {error}")),
        }
    }
    Ok(candidate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::exec::tests::*;

    #[test]
    fn binding_git_lane_only_accepts_read_only_status() {
        assert!(validate_binding_git_args(&[
            "status".into(),
            "--porcelain=v1".into(),
            "-z".into(),
        ])
        .is_ok());
        assert!(validate_binding_git_args(&["diff".into(), "--numstat".into()]).is_err());
        assert!(validate_binding_git_args(&["status".into(), "--ignored".into()]).is_err());
    }

    #[test]
    fn resolve_git_cwd_accepts_relative_inside_root() {
        let root = temp_root();
        let cwd = resolve_git_cwd(&root, "sub").unwrap();
        assert!(cwd.starts_with(&root));
        cleanup_root(root);
    }

    #[test]
    fn resolve_git_cwd_preserves_leading_and_trailing_whitespace() {
        let root = temp_root();
        let exact = " child cwd \n";
        let expected = root.join(exact);
        std::fs::create_dir(&expected).expect("create exact whitespace cwd");
        assert_eq!(
            resolve_git_cwd(&root, exact).expect("resolve exact whitespace cwd"),
            expected.canonicalize().expect("canonical exact cwd")
        );
        let whitespace_only = root.join(" ");
        std::fs::create_dir(&whitespace_only).expect("create whitespace-only cwd");
        assert_eq!(
            resolve_git_cwd(&root, " ").expect("resolve whitespace-only cwd"),
            whitespace_only
                .canonicalize()
                .expect("canonical whitespace-only cwd")
        );
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

    #[cfg(unix)]
    #[test]
    fn new_worktree_path_rejects_existing_symlink_component_escape() {
        use std::os::unix::fs::symlink;

        let root = temp_root();
        let outside = std::env::temp_dir().join(format!(
            "offisim-git-outside-{}-{}",
            std::process::id(),
            TEMP_ROOT_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&outside).expect("create outside fixture");
        symlink(&outside, root.join(".offisim")).expect("create escaping symlink");

        let destination = root.join(".offisim/worktrees/lease-symlink");
        let error = resolve_new_path_under_root(
            &root,
            destination.to_string_lossy().as_ref(),
            "git worktree path",
        )
        .expect_err("symlink component must be rejected before parent creation");
        assert!(error.contains("symlink component"));
        assert!(!outside.join("worktrees").exists());

        cleanup_root(root);
        cleanup_root(outside);
    }

    #[cfg(unix)]
    #[test]
    fn clone_parent_rejects_existing_symlink_component_escape() {
        use std::os::unix::fs::symlink;

        let root = temp_root();
        let outside = std::env::temp_dir().join(format!(
            "offisim-clone-outside-{}-{}",
            std::process::id(),
            TEMP_ROOT_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&outside).expect("create clone outside fixture");
        symlink(&outside, root.join(".offisim")).expect("create clone escaping symlink");
        let destination = root.join(".offisim/tmp/repo");
        let args = vec![
            "clone".to_string(),
            "--depth".to_string(),
            "1".to_string(),
            "https://example.test/repo.git".to_string(),
            destination.to_string_lossy().to_string(),
        ];

        let error = prepare_clone_destination(&root, &args)
            .expect_err("clone symlink component must be rejected");
        assert!(error.contains("symlink component"));
        assert!(!outside.join("tmp").exists());

        cleanup_root(root);
        cleanup_root(outside);
    }

    #[test]
    fn status_allowlist_accepts_machine_safe_nul_porcelain() {
        let root = temp_root();
        let args = vec![
            "status".to_string(),
            "--porcelain=v1".to_string(),
            "-z".to_string(),
        ];
        assert!(is_allowed(&args, &root).is_ok());
        cleanup_root(root);
    }

    #[test]
    fn checkpoint_allowlist_accepts_only_exact_plumbing_shapes_and_ref_prefix() {
        let root = temp_root();
        let sha = "0123456789abcdef0123456789abcdef01234567";
        let tree = "89abcdef0123456789abcdef0123456789abcdef";
        let reference = "refs/offisim/checkpoints/lease-0001/3";
        let accepted = [
            vec!["add", "--all", "--", "."],
            vec!["read-tree", "HEAD"],
            vec!["read-tree", "--reset", "-u", sha],
            vec!["write-tree"],
            vec!["commit-tree", tree, "-p", sha, "-m", "Offisim checkpoint"],
            vec!["update-ref", reference, sha],
            vec!["update-ref", reference, sha, tree],
            vec!["update-ref", "-d", reference, sha],
            vec!["rev-parse", "--verify", reference],
        ];
        for args in accepted {
            let owned = args.into_iter().map(String::from).collect::<Vec<_>>();
            is_allowed(&owned, &root).unwrap();
        }
        cleanup_root(root);
    }

    #[test]
    fn checkpoint_allowlist_rejects_branch_refs_and_unsafe_plumbing_shapes() {
        let root = temp_root();
        let sha = "0123456789abcdef0123456789abcdef01234567";
        let rejected = [
            vec!["add", "--all"],
            vec!["read-tree", "--reset", "-u", "HEAD"],
            vec!["read-tree", "main"],
            vec!["write-tree", "--missing-ok"],
            vec!["commit-tree", sha, "-m", "missing parent"],
            vec!["update-ref", "refs/heads/main", sha],
            vec!["update-ref", "refs/offisim/checkpoints/../main", sha],
            vec!["update-ref", "refs/offisim/checkpoints/lease/1", "HEAD"],
            vec!["rev-parse", "--verify", "refs/heads/main"],
        ];
        for args in rejected {
            let owned = args.into_iter().map(String::from).collect::<Vec<_>>();
            assert!(is_allowed(&owned, &root).is_err(), "accepted {owned:?}");
        }
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
                "-z",
            ],
            vec!["diff", "--numstat", "-z"],
            vec![
                "diff",
                "--name-only",
                "-z",
                "0123456789abcdef0123456789abcdef01234567",
                "HEAD",
            ],
            vec!["diff", "--cached", "--", "src/main.ts"],
            vec![
                "diff",
                "--unified=3",
                "0123456789abcdef0123456789abcdef01234567",
                "HEAD",
                "--",
                "src/main.ts",
            ],
            vec!["remote", "get-url", "origin"],
            vec!["rev-parse", "--abbrev-ref", "HEAD"],
            vec!["add", "--", "src/main.ts"],
            vec!["commit", "-m", "workbench commit"],
            vec!["commit", "-m", "selected commit", "--", "src/main.ts"],
            vec!["switch", "feature/p5_git-loop"],
            vec!["switch", "-c", "feature/p5_git-loop"],
            vec!["push", "-u", "origin", "feature/p5_git-loop"],
        ];
        for args in cases {
            let owned = args.into_iter().map(String::from).collect::<Vec<_>>();
            is_allowed(&owned, &root).unwrap();
        }
        cleanup_root(root);
    }

    #[test]
    fn pathspec_commands_reject_absolute_paths_even_inside_project() {
        let root = temp_root();
        let absolute = root.join("src/main.ts").to_string_lossy().to_string();
        let cases = vec![
            vec!["add".to_string(), "--".to_string(), absolute.clone()],
            vec![
                "commit".to_string(),
                "-m".to_string(),
                "exact path".to_string(),
                "--".to_string(),
                absolute.clone(),
            ],
            vec!["diff".to_string(), "--".to_string(), absolute.clone()],
            vec!["log".to_string(), "--".to_string(), absolute],
        ];
        for args in cases {
            let error = is_allowed(&args, &root)
                .expect_err("absolute pathspec must not escape descriptor-bound cwd semantics");
            assert!(error.contains("must be relative"), "{error}");
        }
        cleanup_root(root);
    }

    #[test]
    fn is_allowed_rejects_destructive_or_remote_mutation_git() {
        let root = temp_root();
        let cases = vec![
            vec!["push"],
            vec!["push", "origin", "main"],
            vec!["push", "--force"],
            vec!["push", "--delete", "origin", "main"],
            vec!["push", "-u", "upstream", "main"],
            vec!["push", "-u", "origin", "--force"],
            vec!["push", "origin", "main:release"],
            vec!["switch"],
            vec!["switch", "-c", "--orphan"],
            vec!["switch", "feature.with-dot"],
            vec!["switch", "feature//empty"],
            vec!["reset", "--hard"],
            vec!["commit", "--amend"],
            vec!["add", "-A"],
            vec!["remote", "add", "origin", "https://example.test/repo.git"],
            vec!["diff", "--ext-diff"],
            vec!["diff", "--name-only", "0123456", "HEAD"],
            vec!["diff", "--name-only", "master", "HEAD"],
            vec!["diff", "--name-only", "HEAD~1", "HEAD"],
            vec!["diff", "--unified=3", "main", "HEAD", "--", "src/main.ts"],
            vec![
                "diff",
                "--name-only",
                "0123456789abcdef0123456789abcdef01234567..HEAD",
                "HEAD",
            ],
        ];
        for args in cases {
            let owned = args.into_iter().map(String::from).collect::<Vec<_>>();
            assert!(is_allowed(&owned, &root).is_err());
        }
        cleanup_root(root);
    }

    #[test]
    fn is_allowed_accepts_f2_worktree_and_merge_shapes() {
        let root = temp_root();
        let worktree = root.join(".offisim/worktrees/lease-0001");
        let cases = vec![
            vec![
                "worktree".to_string(),
                "add".to_string(),
                "-b".to_string(),
                "offisim/lease/run-x-lease-0001".to_string(),
                worktree.to_string_lossy().to_string(),
            ],
            vec![
                "worktree".to_string(),
                "remove".to_string(),
                worktree.to_string_lossy().to_string(),
            ],
            vec![
                "merge".to_string(),
                "--no-ff".to_string(),
                "offisim/lease/run-x-lease-0001".to_string(),
            ],
        ];
        for args in cases {
            is_allowed(&args, &root).unwrap();
        }
        cleanup_root(root);
    }

    #[test]
    fn is_allowed_rejects_f2_worktree_and_merge_escape_shapes() {
        let root = temp_root();
        let cases = vec![
            vec!["worktree", "prune"],
            vec!["worktree", "remove", "--force", "x"],
            vec!["worktree", "add", "-b", "branch", "/etc/x"],
            vec!["worktree", "add", "-b", "../escape", ".offisim/worktrees/x"],
            vec!["merge", "--no-ff", "../escape"],
            vec!["merge", "--squash", "offisim/lease/x"],
            vec!["rebase", "main"],
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
    fn validate_clone_source_accepts_remote_forms() {
        for source in [
            "https://github.com/acme/repo.git",
            "https://user:tok@example.test/acme/repo.git",
            "ssh://git@github.com/acme/repo.git",
            "git@github.com:acme/repo.git",
        ] {
            validate_clone_source(source).unwrap_or_else(|err| panic!("{source} rejected: {err}"));
        }
    }

    #[test]
    fn validate_clone_source_rejects_local_and_disallowed_schemes() {
        for source in [
            "file:///etc/passwd",
            "file://localhost/etc/passwd",
            "http://example.test/repo.git",
            "git://example.test/repo.git",
            "ftp://example.test/repo.git",
            "/etc/passwd",
            "./local-repo",
            "../escape/repo",
            "~/repo",
            "",
        ] {
            assert!(
                validate_clone_source(source).is_err(),
                "{source} should be rejected as a clone source"
            );
        }
    }

    #[test]
    fn validate_clone_source_rejects_remote_helper_transports() {
        // git remote-helper transports run arbitrary commands / read fds — these
        // must never pass the source allowlist.
        for source in [
            "ext::sh -c 'cp /etc/passwd /tmp/x'",
            "ext::cat /etc/passwd",
            "fd::17",
            "transport::address",
            "ext::ssh git@host /repo",
        ] {
            assert!(
                validate_clone_source(source).is_err(),
                "{source} (remote-helper transport) should be rejected"
            );
        }
    }

    #[test]
    fn validate_clone_source_rejects_path_shaped_scp_hosts() {
        // A "host:path" whose host segment is not hostname-shaped is a local path
        // in disguise, not an scp remote.
        for source in ["/etc:passwd", "./x:y", " :repo", "a/b:c"] {
            assert!(
                validate_clone_source(source).is_err(),
                "{source} (path-shaped host) should be rejected"
            );
        }
    }

    #[test]
    fn clone_destination_arg_rejects_file_url_source() {
        let args = vec![
            "clone".to_string(),
            "--depth".to_string(),
            "1".to_string(),
            "file:///etc/passwd".to_string(),
            ".offisim/tmp/repo".to_string(),
        ];
        let err = clone_destination_arg(&args).unwrap_err();
        assert!(err.contains("not an allowed remote") || err.contains("scheme"));
    }

    // --- G3: streaming cap + timeout ---
}
