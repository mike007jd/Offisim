use super::*;

pub(crate) fn validate_new_workspace_lease_request(
    root: &Path,
    lease_id: &str,
    run_id: &str,
    branch: &str,
    path: &str,
) -> Result<PathBuf, String> {
    let lease_id = lease_id.trim();
    let run_id = run_id.trim();
    if lease_id.is_empty()
        || run_id.is_empty()
        || sanitize_workspace_ref(lease_id) != lease_id
        || sanitize_workspace_ref(run_id).is_empty()
    {
        return Err("Workspace lease requires valid backend provenance ids".into());
    }
    let expected_branch = expected_workspace_lease_branch(run_id, lease_id);
    if branch != expected_branch {
        return Err("Workspace lease branch does not match its run/lease provenance".into());
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Resolve bound project workspace: {error}"))?;
    let expected = canonical_root
        .join(".offisim")
        .join("worktrees")
        .join(lease_id);
    let requested = resolve_new_path_under_root(&canonical_root, path, "workspace lease path")?;
    if requested != expected {
        return Err("Workspace lease path does not match its backend jail".into());
    }
    Ok(expected)
}

pub(crate) async fn run_task_workspace_worktree_add(
    binding: &TaskWorkspaceBinding,
    branch: &str,
    destination: &Path,
) -> Result<GitResult, String> {
    run_task_workspace_worktree_add_with_timeout(binding, branch, destination, GIT_EXEC_TIMEOUT)
        .await
}

async fn cleanup_failed_task_workspace_worktree_add(
    binding: &TaskWorkspaceBinding,
    branch: &str,
    destination: &Path,
    command_error: String,
) -> String {
    let execution = match GitExecutionScope::from_authority(binding, &binding.canonical_root) {
        Ok(execution) => execution,
        Err(authority_error) => {
            return format!("{command_error}; {authority_error} Destructive rollback was skipped.");
        }
    };
    if let Err(authority_error) = execution.verify_live() {
        return format!("{command_error}; {authority_error} Destructive rollback was skipped.");
    }
    let artifacts =
        match inspect_attempted_worktree_artifacts(&execution, destination, branch).await {
            Ok(artifacts) => artifacts,
            Err(error) => return format!("{command_error}; inspect attempted worktree: {error}"),
        };
    if !artifacts.any() {
        return command_error;
    }
    match rollback_attempted_worktree_artifacts_for_binding(binding, destination, branch).await {
        Ok(()) => format!("{command_error}; verified orphan worktree and branch were rolled back"),
        Err(rollback_error) => format!("{command_error}; {rollback_error}"),
    }
}

async fn run_task_workspace_worktree_add_with_timeout(
    binding: &TaskWorkspaceBinding,
    branch: &str,
    destination: &Path,
    timeout: Duration,
) -> Result<GitResult, String> {
    let execution = GitExecutionScope::from_authority(binding, &binding.canonical_root)?;
    let mut args = vec![
        "worktree".to_string(),
        "add".to_string(),
        "-b".to_string(),
        branch.to_string(),
        destination.to_string_lossy().to_string(),
    ];
    is_allowed(&args, &binding.canonical_root)?;
    let prepared = prepare_worktree_parent(&execution, &args).await?;
    if prepared != destination {
        return Err("Workspace lease destination changed during preparation".into());
    }
    let (parent_execution, basename) =
        git_target_parent_scope(&execution, destination, "workspace lease destination")?;
    args[4] = basename;
    execution.verify_live()?;
    let preexisting = inspect_attempted_worktree_artifacts(&execution, destination, branch).await?;
    if preexisting.any() {
        return Err(
            "Workspace lease branch, path, or Git registration already exists before creation"
                .into(),
        );
    }

    let mut command = Command::new("git");
    command.args(&args).env_clear().envs(scrubbed_git_env());
    parent_execution.bind_command_with_target(
        &mut command,
        Some(GitTargetExpectation::Missing(destination)),
    )?;
    let result = match run_git_capped(command, timeout, MAX_GIT_OUTPUT_BYTES).await {
        Ok(result) => result,
        Err(command_error) => {
            return Err(cleanup_failed_task_workspace_worktree_add(
                binding,
                branch,
                destination,
                command_error,
            )
            .await);
        }
    };
    parent_execution.verify_live().map_err(|error| {
        format!(
            "{error} Worktree creation result was rejected and destructive rollback was skipped."
        )
    })?;

    if !result.ok {
        let command_error = workspace_lease_command_error(result, "Create git worktree");
        return Err(cleanup_failed_task_workspace_worktree_add(
            binding,
            branch,
            destination,
            command_error,
        )
        .await);
    }
    if let Err(error) = validate_live_git_worktree(&execution, destination, branch).await {
        return Err(cleanup_failed_task_workspace_worktree_add(
            binding,
            branch,
            destination,
            format!("Post-create git worktree validation failed: {error}"),
        )
        .await);
    }
    execution.verify_live()?;
    Ok(result)
}

async fn prepare_worktree_parent(
    execution: &GitExecutionScope,
    args: &[String],
) -> Result<PathBuf, String> {
    let root = &execution.root_path;
    execution.verify_live()?;
    let path = args
        .get(4)
        .ok_or_else(|| "git worktree add requires a path".to_string())?;
    let destination = resolve_new_path_under_root(root, path, "git worktree path")?;
    if destination.exists() {
        return Err("git worktree destination must not already exist".into());
    }
    ensure_offisim_excluded(execution).await?;
    if let Some(parent) = destination.parent() {
        create_directory_chain_without_symlinks(root, parent)?;
        let canonical_parent = parent
            .canonicalize()
            .map_err(|err| format!("Resolve git worktree parent: {err}"))?;
        let canonical_root = root
            .canonicalize()
            .map_err(|err| format!("Resolve bound project workspace: {err}"))?;
        if !canonical_parent.starts_with(&canonical_root) {
            return Err("git worktree parent is outside the bound project workspace".into());
        }
        // Re-run the no-symlink traversal after creation to close the gap
        // between the initial validation and create_dir_all.
        resolve_new_path_under_root(root, path, "git worktree path")?;
    }
    execution.verify_live()?;
    Ok(destination)
}

#[cfg(unix)]
pub(super) fn create_directory_chain_without_symlinks(
    root: &Path,
    target: &Path,
) -> Result<(), String> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;

    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Resolve bound project workspace: {error}"))?;
    let relative = target
        .strip_prefix(&canonical_root)
        .map_err(|_| "git worktree parent is outside the bound project workspace".to_string())?;
    let mut directory = std::fs::File::open(&canonical_root)
        .map_err(|error| format!("Open bound project workspace: {error}"))?;
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err("git worktree parent contains an invalid path component".into());
        };
        let name = CString::new(name.as_bytes())
            .map_err(|_| "git worktree parent contains a NUL byte".to_string())?;
        // mkdirat is anchored to an already-open directory descriptor. If an
        // attacker races in a symlink, mkdirat returns EEXIST and the O_NOFOLLOW
        // openat below rejects it before any child is created through it.
        let created = unsafe { libc::mkdirat(directory.as_raw_fd(), name.as_ptr(), 0o755) };
        if created != 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() != std::io::ErrorKind::AlreadyExists {
                return Err(format!("Create git worktree parent: {error}"));
            }
        }
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(format!(
                "Open git worktree parent without following symlinks: {}",
                std::io::Error::last_os_error()
            ));
        }
        // SAFETY: openat returned a fresh owned descriptor on success.
        let owned = unsafe { OwnedFd::from_raw_fd(fd) };
        directory = std::fs::File::from(owned);
    }
    Ok(())
}

#[cfg(not(unix))]
pub(super) fn create_directory_chain_without_symlinks(
    root: &Path,
    target: &Path,
) -> Result<(), String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Resolve bound project workspace: {error}"))?;
    let relative = target
        .strip_prefix(&canonical_root)
        .map_err(|_| "git worktree parent is outside the bound project workspace".to_string())?;
    let mut current = canonical_root.clone();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err("git worktree parent contains an invalid path component".into());
        };
        current.push(name);
        match std::fs::create_dir(&current) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(format!("Create git worktree parent: {error}")),
        }
        let metadata = std::fs::symlink_metadata(&current)
            .map_err(|error| format!("Inspect git worktree parent: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("git worktree parent cannot traverse a symlink".into());
        }
        let canonical = current
            .canonicalize()
            .map_err(|error| format!("Resolve git worktree parent: {error}"))?;
        if !canonical.starts_with(&canonical_root) {
            return Err("git worktree parent is outside the bound project workspace".into());
        }
        current = canonical;
    }
    Ok(())
}

pub(super) fn git_line_record<'a>(output: &'a str, label: &str) -> Result<&'a str, String> {
    output
        .strip_suffix('\n')
        .filter(|value| !value.is_empty() && !value.contains('\0'))
        .ok_or_else(|| format!("{label} returned an invalid machine record"))
}

async fn resolve_git_exclude_paths(
    execution: &GitExecutionScope,
) -> Result<(PathBuf, PathBuf), String> {
    let root = &execution.root_path;
    let common_output = run_git_probe_scoped(execution, &["rev-parse", "--git-common-dir"]).await?;
    let common_record = git_line_record(&common_output, "git common directory")?;
    let common_candidate = if Path::new(common_record).is_absolute() {
        PathBuf::from(common_record)
    } else {
        root.join(common_record)
    };
    let common_dir = common_candidate
        .canonicalize()
        .map_err(|error| format!("Resolve git common directory: {error}"))?;
    let common_metadata = std::fs::symlink_metadata(&common_dir)
        .map_err(|error| format!("Inspect git common directory: {error}"))?;
    if !common_metadata.is_dir() || common_metadata.file_type().is_symlink() {
        return Err("Git common directory must be an ordinary directory".into());
    }

    let exclude_output =
        run_git_probe_scoped(execution, &["rev-parse", "--git-path", "info/exclude"]).await?;
    let exclude_record = git_line_record(&exclude_output, "git exclude path")?;
    let exclude_path = if Path::new(exclude_record).is_absolute() {
        PathBuf::from(exclude_record)
    } else {
        root.join(exclude_record)
    };
    if exclude_path.file_name().and_then(|value| value.to_str()) != Some("exclude") {
        return Err("Git exclude path did not resolve to info/exclude".into());
    }
    let reported_info = exclude_path
        .parent()
        .ok_or_else(|| "Git exclude path has no parent directory".to_string())?
        .canonicalize()
        .map_err(|error| format!("Resolve reported git info directory: {error}"))?;
    let expected_info = common_dir
        .join("info")
        .canonicalize()
        .map_err(|error| format!("Resolve git common info directory: {error}"))?;
    if reported_info != expected_info || !expected_info.starts_with(&common_dir) {
        return Err("Git exclude path escaped its common admin directory".into());
    }
    Ok((common_dir, exclude_path))
}

#[cfg(unix)]
fn append_offisim_exclude_anchored(common_dir: &Path) -> Result<(), String> {
    use std::ffi::CString;
    use std::io::{Read, Seek, SeekFrom, Write};
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::MetadataExt;

    let expected_common = std::fs::symlink_metadata(common_dir)
        .map_err(|error| format!("Inspect git common directory identity: {error}"))?;
    let common_path = CString::new(common_dir.as_os_str().as_bytes())
        .map_err(|_| "Git common directory contains a NUL byte".to_string())?;
    let common_fd = unsafe {
        libc::open(
            common_path.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if common_fd < 0 {
        return Err(format!(
            "Open git common directory without following symlinks: {}",
            std::io::Error::last_os_error()
        ));
    }
    let common = std::fs::File::from(unsafe { OwnedFd::from_raw_fd(common_fd) });
    let opened_common = common
        .metadata()
        .map_err(|error| format!("Inspect opened git common directory: {error}"))?;
    if opened_common.dev() != expected_common.dev() || opened_common.ino() != expected_common.ino()
    {
        return Err("Git common directory identity changed before exclude update".into());
    }

    let info_name = CString::new("info").expect("static git info component");
    let info_fd = unsafe {
        libc::openat(
            common.as_raw_fd(),
            info_name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if info_fd < 0 {
        return Err(format!(
            "Open git info directory without following symlinks: {}",
            std::io::Error::last_os_error()
        ));
    }
    let info = std::fs::File::from(unsafe { OwnedFd::from_raw_fd(info_fd) });
    let info_metadata = info
        .metadata()
        .map_err(|error| format!("Inspect opened git info directory: {error}"))?;
    if !info_metadata.is_dir() {
        return Err("Git info path is not a directory".into());
    }

    let exclude_name = CString::new("exclude").expect("static git exclude component");
    let open_exclude = || -> Result<std::fs::File, String> {
        let fd = unsafe {
            libc::openat(
                info.as_raw_fd(),
                exclude_name.as_ptr(),
                libc::O_RDWR | libc::O_APPEND | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(format!(
                "Open git exclude without following symlinks: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(std::fs::File::from(unsafe { OwnedFd::from_raw_fd(fd) }))
    };

    let mut exclude = open_exclude()?;
    let opened_exclude = exclude
        .metadata()
        .map_err(|error| format!("Inspect opened git exclude: {error}"))?;
    if !opened_exclude.is_file() || opened_exclude.nlink() != 1 {
        return Err("Git exclude must be an ordinary, non-hardlinked file".into());
    }
    if unsafe { libc::flock(exclude.as_raw_fd(), libc::LOCK_EX) } != 0 {
        return Err(format!(
            "Lock git exclude for update: {}",
            std::io::Error::last_os_error()
        ));
    }

    let before_write = open_exclude()?;
    let before_metadata = before_write
        .metadata()
        .map_err(|error| format!("Reinspect git exclude before update: {error}"))?;
    if before_metadata.dev() != opened_exclude.dev()
        || before_metadata.ino() != opened_exclude.ino()
        || before_metadata.nlink() != 1
    {
        return Err("Git exclude identity changed before update".into());
    }

    exclude
        .seek(SeekFrom::Start(0))
        .map_err(|error| format!("Seek git exclude: {error}"))?;
    let mut existing = Vec::new();
    exclude
        .read_to_end(&mut existing)
        .map_err(|error| format!("Read git exclude: {error}"))?;
    let existing_text =
        std::str::from_utf8(&existing).map_err(|_| "Git exclude is not valid UTF-8".to_string())?;
    if !existing_text.lines().any(|line| line == ".offisim/") {
        if !existing.is_empty() && !existing.ends_with(b"\n") {
            exclude
                .write_all(b"\n")
                .map_err(|error| format!("Terminate existing git exclude line: {error}"))?;
        }
        exclude
            .write_all(b".offisim/\n")
            .map_err(|error| format!("Write Offisim git exclude: {error}"))?;
        exclude
            .sync_all()
            .map_err(|error| format!("Sync Offisim git exclude: {error}"))?;
    }

    let after_write = open_exclude()?;
    let after_metadata = after_write
        .metadata()
        .map_err(|error| format!("Reinspect git exclude after update: {error}"))?;
    if after_metadata.dev() != opened_exclude.dev()
        || after_metadata.ino() != opened_exclude.ino()
        || after_metadata.nlink() != 1
    {
        return Err("Git exclude identity changed during update".into());
    }
    drop(before_write);
    drop(after_write);
    drop(info);
    drop(common);
    Ok(())
}

#[cfg(not(unix))]
fn append_offisim_exclude_anchored(_common_dir: &Path) -> Result<(), String> {
    Err("Secure Git exclude updates are unavailable on this platform".into())
}

async fn ensure_offisim_excluded(execution: &GitExecutionScope) -> Result<(), String> {
    execution.verify_live()?;
    let (common_dir, _reported_exclude) = resolve_git_exclude_paths(execution).await?;
    append_offisim_exclude_anchored(&common_dir)?;
    execution.verify_live()
}

pub(super) async fn run_git_probe_scoped(
    execution: &GitExecutionScope,
    args: &[&str],
) -> Result<String, String> {
    let mut command = Command::new("git");
    command.args(args).env_clear().envs(scrubbed_git_env());
    execution.bind_command(&mut command)?;
    let result = run_git_capped_machine(command, GIT_EXEC_TIMEOUT, MAX_GIT_OUTPUT_BYTES).await?;
    execution.verify_live()?;
    if result.ok {
        return Ok(result.stdout);
    }
    if !result.stderr.trim().is_empty() {
        Err(result.stderr)
    } else if !result.stdout.trim().is_empty() {
        Err(result.stdout)
    } else {
        Err("Git machine probe failed without diagnostic output".into())
    }
}

pub(super) async fn capture_branch_object_id(
    execution: &GitExecutionScope,
    branch: &str,
) -> Result<String, String> {
    validate_git_ref(branch, "Git branch provenance")?;
    let branch_ref = format!("refs/heads/{branch}");
    let output = run_git_probe_scoped(execution, &["rev-parse", "--verify", &branch_ref]).await?;
    let object_id = git_line_record(&output, "Git branch object id")?;
    if !matches!(object_id.len(), 40 | 64)
        || !object_id
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("Git branch object id is not an exact hash".into());
    }
    Ok(object_id.to_string())
}

pub(super) async fn delete_branch_if_unchanged(
    execution: &GitExecutionScope,
    branch: &str,
    expected_object_id: &str,
) -> Result<GitResult, String> {
    validate_git_ref(branch, "Git branch cleanup")?;
    if !matches!(expected_object_id.len(), 40 | 64)
        || !expected_object_id
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("Git branch cleanup requires an exact expected object id".into());
    }
    let branch_ref = format!("refs/heads/{branch}");
    let mut command = Command::new("git");
    command
        .args(["update-ref", "-d", &branch_ref, expected_object_id])
        .env_clear()
        .envs(scrubbed_git_env());
    execution.bind_command(&mut command)?;
    let result = run_git_capped(command, GIT_EXEC_TIMEOUT, MAX_GIT_OUTPUT_BYTES).await?;
    execution.verify_live()?;
    Ok(result)
}

#[cfg(test)]
pub(super) async fn run_git_probe_with_timeout(
    cwd: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    let mut command = Command::new("git");
    command
        .args(args)
        .current_dir(cwd)
        .env_clear()
        .envs(scrubbed_git_env());
    let result = run_git_capped_machine(command, timeout, MAX_GIT_OUTPUT_BYTES).await?;
    if result.ok {
        return Ok(result.stdout);
    }
    if !result.stderr.trim().is_empty() {
        Err(result.stderr)
    } else if !result.stdout.trim().is_empty() {
        Err(result.stdout)
    } else {
        Err("Git machine probe failed without diagnostic output".into())
    }
}

fn worktree_porcelain_has_entry(output: &str, path: &Path, branch: &str) -> bool {
    let expected_path = path.to_string_lossy();
    let expected_branch = format!("refs/heads/{branch}");
    output.split("\0\0").any(|block| {
        let mut actual_path = None;
        let mut actual_branch = None;
        for field in block.split('\0') {
            if let Some(value) = field.strip_prefix("worktree ") {
                actual_path = Some(value);
            } else if let Some(value) = field.strip_prefix("branch ") {
                actual_branch = Some(value);
            }
        }
        actual_path == Some(expected_path.as_ref())
            && actual_branch == Some(expected_branch.as_str())
    })
}

struct AttemptedWorktreeArtifacts {
    branch: bool,
    path: bool,
    registry: bool,
}

impl AttemptedWorktreeArtifacts {
    fn any(&self) -> bool {
        self.branch || self.path || self.registry
    }
}

async fn inspect_attempted_worktree_artifacts(
    execution: &GitExecutionScope,
    worktree: &Path,
    branch: &str,
) -> Result<AttemptedWorktreeArtifacts, String> {
    let root_execution = execution.root_scope()?;
    let branch_ref = format!("refs/heads/{branch}");
    let mut branch_probe = Command::new("git");
    branch_probe
        .args(["show-ref", "--verify", &branch_ref])
        .env_clear()
        .envs(scrubbed_git_env());
    root_execution.bind_command(&mut branch_probe)?;
    let branch_exists =
        run_git_capped_machine(branch_probe, GIT_EXEC_TIMEOUT, MAX_GIT_OUTPUT_BYTES)
            .await?
            .ok;
    root_execution.verify_live()?;
    let listed =
        run_git_probe_scoped(&root_execution, &["worktree", "list", "--porcelain", "-z"]).await?;
    root_execution.verify_live()?;
    Ok(AttemptedWorktreeArtifacts {
        branch: branch_exists,
        path: std::fs::symlink_metadata(worktree).is_ok(),
        registry: worktree_porcelain_has_entry(&listed, worktree, branch),
    })
}

pub(super) async fn validate_live_git_worktree(
    execution: &GitExecutionScope,
    worktree: &Path,
    branch: &str,
) -> Result<PathBuf, String> {
    validate_live_git_worktree_with_identity(execution, worktree, branch, None).await
}

pub(super) async fn validate_live_git_worktree_with_identity(
    execution: &GitExecutionScope,
    worktree: &Path,
    branch: &str,
    expected_worktree_identity: Option<&FilesystemIdentity>,
) -> Result<PathBuf, String> {
    validate_git_ref(branch, "registered worktree branch")?;
    let root_execution = execution.root_scope()?;
    let canonical_root = PathBuf::from(&root_execution.root_identity.canonical_path);
    let inspected = resolve_new_path_under_root(
        &canonical_root,
        worktree.to_string_lossy().as_ref(),
        "registered git worktree",
    )?;
    let canonical_worktree = inspected
        .canonicalize()
        .map_err(|error| format!("Resolve registered git worktree: {error}"))?;
    if !canonical_worktree.starts_with(&canonical_root) {
        return Err("registered git worktree is outside the bound project workspace".into());
    }
    if std::fs::symlink_metadata(&canonical_worktree)
        .map_err(|error| format!("Inspect registered git worktree: {error}"))?
        .file_type()
        .is_symlink()
    {
        return Err("registered git worktree cannot be a symlink".into());
    }
    let worktree_execution = match expected_worktree_identity {
        Some(identity) => GitExecutionScope::from_expected(
            &root_execution.root_path,
            root_execution.root_identity.clone(),
            &canonical_worktree,
            identity.clone(),
        )?,
        None => root_execution.with_live_cwd(&canonical_worktree)?,
    };
    let prefix = run_git_probe_scoped(&worktree_execution, &["rev-parse", "--show-prefix"]).await?;
    if prefix != "\n" {
        return Err("git worktree toplevel does not match its registered path".into());
    }
    let actual_branch =
        run_git_probe_scoped(&worktree_execution, &["branch", "--show-current"]).await?;
    let actual_branch = actual_branch
        .strip_suffix('\n')
        .filter(|value| !value.contains('\n') && !value.contains('\r'))
        .ok_or_else(|| "git worktree branch probe returned an invalid record".to_string())?;
    if actual_branch != branch {
        return Err(format!(
            "git worktree branch '{}' does not match registered branch '{}'",
            actual_branch.trim(),
            branch
        ));
    }
    let listed =
        run_git_probe_scoped(&root_execution, &["worktree", "list", "--porcelain", "-z"]).await?;
    if !worktree_porcelain_has_entry(&listed, &canonical_worktree, branch) {
        return Err("git worktree is missing from the repository worktree registry".into());
    }
    Ok(canonical_worktree)
}

async fn rollback_created_worktree(
    execution: &GitExecutionScope,
    worktree: &Path,
    branch: &str,
) -> Result<(), String> {
    let root_execution = execution.root_scope()?;
    let artifacts = inspect_attempted_worktree_artifacts(&root_execution, worktree, branch).await?;
    if !artifacts.registry || !artifacts.branch {
        return Err(
            "Worktree rollback lacks exact path+branch Git registry provenance; artifacts were left untouched"
                .into(),
        );
    }
    let target_identity = if artifacts.path {
        validate_live_git_worktree(&root_execution, worktree, branch)
            .await
            .map_err(|error| {
                format!(
                    "Worktree rollback found an unverified same-path replacement directory; it was left untouched: {error}"
                )
            })?;
        Some(filesystem_identity(worktree)?)
    } else {
        None
    };
    let expected_branch_object_id = capture_branch_object_id(&root_execution, branch).await?;
    let (parent_execution, basename) =
        git_target_parent_scope(&root_execution, worktree, "git worktree rollback target")?;
    let mut remove = Command::new("git");
    remove
        .args(["worktree", "remove", "--force"])
        .arg(basename)
        .env_clear()
        .envs(scrubbed_git_env());
    let target_expectation = match target_identity.as_ref() {
        Some(identity) => GitTargetExpectation::Existing {
            path: worktree,
            identity,
        },
        None => GitTargetExpectation::Missing(worktree),
    };
    parent_execution.bind_command_with_target(&mut remove, Some(target_expectation))?;
    let removed = run_git_capped(remove, GIT_EXEC_TIMEOUT, MAX_GIT_OUTPUT_BYTES).await?;
    parent_execution.verify_live()?;
    if !removed.ok {
        return Err(if removed.stderr.trim().is_empty() {
            removed.stdout
        } else {
            removed.stderr
        });
    }
    let deleted =
        delete_branch_if_unchanged(&root_execution, branch, &expected_branch_object_id).await?;
    if deleted.ok {
        Ok(())
    } else if deleted.stderr.trim().is_empty() {
        Err(deleted.stdout)
    } else {
        Err(deleted.stderr)
    }
}

fn verify_expected_project_identity(root: &Path, expected_json: &str) -> Result<(), String> {
    let actual = serde_json::to_string(&filesystem_identity(root)?)
        .map_err(|error| format!("Encode current Project workspace identity: {error}"))?;
    if actual == expected_json {
        Ok(())
    } else {
        Err("Project folder identity changed; destructive worktree rollback was skipped".into())
    }
}

pub(super) async fn rollback_created_worktree_with_expected_identity(
    root: &Path,
    worktree: &Path,
    branch: &str,
    expected_project_identity_json: &str,
) -> Result<(), String> {
    let expected_identity: FilesystemIdentity =
        serde_json::from_str(expected_project_identity_json)
            .map_err(|error| format!("Decode expected Project identity: {error}"))?;
    let execution =
        GitExecutionScope::from_expected(root, expected_identity.clone(), root, expected_identity)?;
    verify_expected_project_identity(root, expected_project_identity_json)?;
    validate_live_git_worktree(&execution, worktree, branch)
        .await
        .map_err(|error| format!("Refuse unverified worktree rollback: {error}"))?;
    verify_expected_project_identity(root, expected_project_identity_json)?;
    rollback_created_worktree(&execution, worktree, branch).await
}

pub(super) async fn rollback_created_worktree_for_binding(
    binding: &TaskWorkspaceBinding,
    worktree: &Path,
    branch: &str,
) -> Result<(), String> {
    rollback_created_worktree_with_expected_identity(
        &binding.canonical_root,
        worktree,
        branch,
        &binding.expected_root_identity_json()?,
    )
    .await
}

async fn rollback_attempted_worktree_artifacts_for_binding(
    binding: &TaskWorkspaceBinding,
    worktree: &Path,
    branch: &str,
) -> Result<(), String> {
    let execution = GitExecutionScope::from_authority(binding, &binding.canonical_root)?;
    validate_git_ref(branch, "attempted worktree branch")?;
    let lease_root = binding.canonical_root.join(".offisim").join("worktrees");
    if worktree.parent() != Some(lease_root.as_path())
        || worktree
            .file_name()
            .and_then(|value| value.to_str())
            .is_none()
    {
        return Err("Attempted worktree cleanup path is outside its backend lease jail".into());
    }
    let artifacts = inspect_attempted_worktree_artifacts(&execution, worktree, branch).await?;
    if !artifacts.any() {
        return Ok(());
    }
    rollback_created_worktree(&execution, worktree, branch).await?;
    execution.verify_live()?;
    let remaining = inspect_attempted_worktree_artifacts(&execution, worktree, branch).await?;
    if remaining.any() {
        return Err("Attempted worktree cleanup left a path, registry entry, or branch".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::exec::tests::*;

    #[tokio::test]
    async fn branch_cleanup_compare_and_swap_preserves_replaced_ref() {
        let root = git_root();
        let branch = "offisim/lease/ref-cas";
        fixture_git_ok(&root, &["branch", branch]);
        let execution = git_execution(&root);
        let expected = capture_branch_object_id(&execution, branch)
            .await
            .expect("capture original branch object id");

        std::fs::write(root.join("replacement.txt"), "replacement commit\n")
            .expect("write replacement commit");
        fixture_git_ok(&root, &["add", "replacement.txt"]);
        fixture_git_ok(&root, &["commit", "-m", "replacement commit"]);
        fixture_git_ok(&root, &["branch", "-f", branch, "HEAD"]);
        let replacement = capture_branch_object_id(&execution, branch)
            .await
            .expect("capture replacement branch object id");
        assert_ne!(replacement, expected);

        let deleted = delete_branch_if_unchanged(&execution, branch, &expected)
            .await
            .expect("run branch compare-and-swap cleanup");
        assert!(!deleted.ok, "changed branch ref must not be deleted");
        assert_eq!(
            capture_branch_object_id(&execution, branch)
                .await
                .expect("replacement branch remains"),
            replacement
        );

        cleanup_root(root);
    }

    #[tokio::test]
    async fn task_worktree_add_rejects_a_same_path_project_root_replacement_before_git() {
        let root = git_root();
        let binding = crate::task_workspace_binding::test_task_workspace_binding(
            &root,
            "project-1",
            None,
            1,
            None,
        );
        let moved = root.with_extension("authorized-old");
        std::fs::rename(&root, &moved).expect("move authorized Project root");
        initialize_git_root(&root);
        let lease_id = "lease-root-replaced";
        let branch = expected_workspace_lease_branch("run-root-replaced", lease_id);
        let destination = root.join(".offisim/worktrees").join(lease_id);

        let error = run_task_workspace_worktree_add(&binding, &branch, &destination)
            .await
            .expect_err("replacement Project root must not receive a worktree");
        assert!(error.contains("identity changed"), "{error}");
        assert!(!destination.exists());
        assert!(!fixture_git(
            &root,
            &["show-ref", "--verify", &format!("refs/heads/{branch}")],
        )
        .status
        .success());

        cleanup_root(root);
        cleanup_root(moved);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn timed_out_post_checkout_rolls_back_unregistered_worktree_and_branch() {
        use std::os::unix::fs::PermissionsExt;

        let root = git_root();
        let binding = crate::task_workspace_binding::test_task_workspace_binding(
            &root,
            "project-1",
            None,
            1,
            None,
        );
        let hook = root.join(".git/hooks/post-checkout");
        std::fs::write(&hook, "#!/bin/sh\nsleep 10\n").expect("write hanging post-checkout hook");
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755))
            .expect("mark post-checkout hook executable");
        let lease_id = "lease-hook-timeout";
        let branch = expected_workspace_lease_branch("run-hook-timeout", lease_id);
        let destination = root.join(".offisim/worktrees").join(lease_id);

        let error = run_task_workspace_worktree_add_with_timeout(
            &binding,
            &branch,
            &destination,
            Duration::from_secs(2),
        )
        .await
        .expect_err("hanging post-checkout must fail and compensate");
        assert!(error.contains("timed out"), "{error}");
        assert!(error.contains("rolled back"), "{error}");
        assert!(!destination.exists());
        assert!(
            !fixture_git(
                &root,
                &["show-ref", "--verify", &format!("refs/heads/{branch}")],
            )
            .status
            .success(),
            "timeout compensation must remove the unregistered branch"
        );

        cleanup_root(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn late_nonzero_post_checkout_rolls_back_unregistered_worktree_and_branch() {
        use std::os::unix::fs::PermissionsExt;

        let root = git_root();
        let binding = crate::task_workspace_binding::test_task_workspace_binding(
            &root,
            "project-1",
            None,
            1,
            None,
        );
        let hook = root.join(".git/hooks/post-checkout");
        std::fs::write(&hook, "#!/bin/sh\nexit 17\n").expect("write failing post-checkout hook");
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755))
            .expect("mark post-checkout hook executable");
        let lease_id = "lease-hook-nonzero";
        let branch = expected_workspace_lease_branch("run-hook-nonzero", lease_id);
        let destination = root.join(".offisim/worktrees").join(lease_id);

        let error = run_task_workspace_worktree_add_with_timeout(
            &binding,
            &branch,
            &destination,
            Duration::from_secs(5),
        )
        .await
        .expect_err("late nonzero worktree add must compensate");
        assert!(error.contains("Create git worktree failed"), "{error}");
        assert!(error.contains("rolled back"), "{error}");
        assert!(!destination.exists());
        assert!(
            !fixture_git(
                &root,
                &["show-ref", "--verify", &format!("refs/heads/{branch}")],
            )
            .status
            .success(),
            "late nonzero compensation must remove the unregistered branch"
        );

        cleanup_root(root);
    }

    #[tokio::test]
    async fn failed_add_cleanup_preserves_unproven_branch_but_removes_exact_stale_registry() {
        let root = git_root();
        let binding = crate::task_workspace_binding::test_task_workspace_binding(
            &root,
            "project-1",
            None,
            1,
            None,
        );

        let branch_only_lease = "lease-branch-only";
        let branch_only = expected_workspace_lease_branch("run-branch-only", branch_only_lease);
        let branch_only_path = root.join(".offisim/worktrees").join(branch_only_lease);
        fixture_git_ok(&root, &["branch", &branch_only]);
        let branch_only_error = cleanup_failed_task_workspace_worktree_add(
            &binding,
            &branch_only,
            &branch_only_path,
            "synthetic late failure".into(),
        )
        .await;
        assert!(
            branch_only_error.contains("lacks exact"),
            "{branch_only_error}"
        );
        assert!(fixture_git(
            &root,
            &["show-ref", "--verify", &format!("refs/heads/{branch_only}"),],
        )
        .status
        .success());

        let stale_lease = "lease-stale-attempt";
        let (stale_path, stale_branch) = fixture_worktree(&root, stale_lease, "run-stale-attempt");
        std::fs::remove_dir_all(&stale_path).expect("remove attempted worktree path");
        let stale_error = cleanup_failed_task_workspace_worktree_add(
            &binding,
            &stale_branch,
            &stale_path,
            "synthetic stale registration failure".into(),
        )
        .await;
        assert!(stale_error.contains("rolled back"), "{stale_error}");
        let execution = git_execution(&root);
        let remaining =
            inspect_attempted_worktree_artifacts(&execution, &stale_path, &stale_branch)
                .await
                .expect("inspect compensated stale artifacts");
        assert!(!remaining.any());

        cleanup_root(root);
    }

    #[tokio::test]
    async fn failed_add_cleanup_preserves_unproven_same_path_directory() {
        let root = git_root();
        let binding = crate::task_workspace_binding::test_task_workspace_binding(
            &root,
            "project-1",
            None,
            1,
            None,
        );
        let lease_id = "lease-path-only";
        let branch = expected_workspace_lease_branch("run-path-only", lease_id);
        let path = root.join(".offisim/worktrees").join(lease_id);
        std::fs::create_dir_all(&path).expect("create same-path replacement directory");
        let sentinel = path.join("user-sentinel");
        std::fs::write(&sentinel, "preserve me\n").expect("write same-path sentinel");

        let error = cleanup_failed_task_workspace_worktree_add(
            &binding,
            &branch,
            &path,
            "synthetic add failure".into(),
        )
        .await;
        assert!(error.contains("lacks exact"), "{error}");
        assert_eq!(
            std::fs::read_to_string(&sentinel).expect("read preserved sentinel"),
            "preserve me\n"
        );

        cleanup_root(root);
    }

    #[tokio::test]
    async fn failed_add_cleanup_preserves_unverified_target_and_unrelated_registry() {
        let root = git_root();
        let binding = crate::task_workspace_binding::test_task_workspace_binding(
            &root,
            "project-1",
            None,
            1,
            None,
        );
        let (target_path, target_branch) =
            fixture_worktree(&root, "lease-target-stale", "run-target-stale");
        let (unrelated_path, unrelated_branch) =
            fixture_worktree(&root, "lease-unrelated-stale", "run-unrelated-stale");
        let unrelated_git_file =
            std::fs::read_to_string(unrelated_path.join(".git")).expect("read worktree gitfile");
        let unrelated_admin = PathBuf::from(
            unrelated_git_file
                .strip_prefix("gitdir: ")
                .expect("gitfile prefix")
                .trim_end(),
        );

        std::fs::remove_file(target_path.join(".git"))
            .expect("corrupt target worktree so the first exact remove fails");
        std::fs::remove_dir_all(&unrelated_path).expect("make unrelated registry stale");
        assert!(unrelated_admin.is_dir());

        let error = cleanup_failed_task_workspace_worktree_add(
            &binding,
            &target_branch,
            &target_path,
            "synthetic target failure".into(),
        )
        .await;
        assert!(error.contains("same-path replacement"), "{error}");
        let execution = git_execution(&root);
        let target = inspect_attempted_worktree_artifacts(&execution, &target_path, &target_branch)
            .await
            .expect("inspect target cleanup");
        assert!(target.path && target.registry && target.branch);

        let unrelated =
            inspect_attempted_worktree_artifacts(&execution, &unrelated_path, &unrelated_branch)
                .await
                .expect("inspect unrelated stale worktree");
        assert!(unrelated.registry, "unrelated registry entry must remain");
        assert!(unrelated.branch, "unrelated branch must remain");
        assert!(!unrelated.path, "unrelated path is intentionally offline");
        assert!(
            unrelated_admin.is_dir(),
            "unrelated worktree admin metadata must remain"
        );

        cleanup_root(root);
    }

    #[tokio::test]
    async fn live_worktree_validation_preserves_weird_secret_project_paths() {
        let root = std::env::temp_dir().join(format!(
            "offisim project\nsecret_token_api_key_abcdefghijklmnopqrstuvwxyz-{}-{}",
            std::process::id(),
            TEMP_ROOT_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        initialize_git_root(&root);
        let root = root.canonicalize().expect("canonical weird git root");
        let (worktree, branch) = fixture_worktree(&root, "lease-weird-root", "run-weird-root");

        let execution = git_execution(&root);
        let validated = validate_live_git_worktree(&execution, &worktree, &branch)
            .await
            .expect("validate worktree through exact NUL machine probes");
        assert_eq!(validated, worktree);
        let artifacts = inspect_attempted_worktree_artifacts(&execution, &worktree, &branch)
            .await
            .expect("inspect exact weird-path registry");
        assert!(artifacts.path && artifacts.registry && artifacts.branch);

        cleanup_root(root);
    }

    #[tokio::test]
    async fn git_exclude_update_preserves_unterminated_rule_and_is_idempotent() {
        let root = git_root();
        let exclude = root.join(".git/info/exclude");
        std::fs::write(&exclude, "existing-rule").expect("write unterminated exclude rule");

        let execution = git_execution(&root);
        ensure_offisim_excluded(&execution)
            .await
            .expect("append anchored Offisim exclude");
        assert_eq!(
            std::fs::read_to_string(&exclude).expect("read updated exclude"),
            "existing-rule\n.offisim/\n"
        );
        ensure_offisim_excluded(&execution)
            .await
            .expect("repeat anchored Offisim exclude");
        assert_eq!(
            std::fs::read_to_string(&exclude).expect("read idempotent exclude"),
            "existing-rule\n.offisim/\n"
        );

        cleanup_root(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn git_exclude_update_rejects_external_symlink_without_touching_target() {
        use std::os::unix::fs::symlink;

        let root = git_root();
        let outside = temp_root();
        let target = outside.join("external-sensitive-file");
        std::fs::write(&target, "external sentinel\n").expect("write external sentinel");
        let exclude = root.join(".git/info/exclude");
        std::fs::remove_file(&exclude).expect("remove fixture exclude");
        symlink(&target, &exclude).expect("link exclude to external target");

        let execution = git_execution(&root);
        let error = ensure_offisim_excluded(&execution)
            .await
            .expect_err("exclude symlink must fail closed");
        assert!(error.contains("without following symlinks"), "{error}");
        assert_eq!(
            std::fs::read_to_string(&target).expect("read external sentinel"),
            "external sentinel\n"
        );

        cleanup_root(root);
        cleanup_root(outside);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn git_exclude_update_rejects_external_hardlink_without_touching_target() {
        let root = git_root();
        let outside = temp_root();
        let target = outside.join("external-sensitive-file");
        std::fs::write(&target, "external sentinel\n").expect("write external sentinel");
        let exclude = root.join(".git/info/exclude");
        std::fs::remove_file(&exclude).expect("remove fixture exclude");
        std::fs::hard_link(&target, &exclude).expect("hardlink exclude to external target");

        let execution = git_execution(&root);
        let error = ensure_offisim_excluded(&execution)
            .await
            .expect_err("exclude hardlink must fail closed");
        assert!(error.contains("non-hardlinked"), "{error}");
        assert_eq!(
            std::fs::read_to_string(&target).expect("read external sentinel"),
            "external sentinel\n"
        );

        cleanup_root(root);
        cleanup_root(outside);
    }

    #[tokio::test]
    async fn linked_project_worktree_add_excludes_nested_offisim_state() {
        let root = git_root();
        let (project, _project_branch) =
            fixture_worktree(&root, "linked-project", "run-linked-project");
        let binding = crate::task_workspace_binding::test_task_workspace_binding(
            &project,
            "project-linked",
            None,
            1,
            None,
        );
        let lease_id = "lease-linked-nested";
        let branch = expected_workspace_lease_branch("run-linked-nested", lease_id);
        let destination = project.join(".offisim/worktrees").join(lease_id);

        let result = run_task_workspace_worktree_add(&binding, &branch, &destination)
            .await
            .expect("create nested worktree from linked Project root");
        assert!(result.ok, "{}", result.stderr);
        let status = run_git_validated(
            vec!["status".into(), "--porcelain=v1".into(), "-z".into()],
            &project,
            None,
        )
        .await
        .expect("inspect linked Project status");
        assert!(status.ok, "{}", status.stderr);
        assert!(
            !status.stdout.contains(".offisim"),
            "nested lease state polluted linked Project status: {:?}",
            status.stdout
        );
        let common_exclude = root.join(".git/info/exclude");
        assert!(std::fs::read_to_string(common_exclude)
            .expect("read linked common exclude")
            .lines()
            .any(|line| line == ".offisim/"));

        rollback_created_worktree_for_binding(&binding, &destination, &branch)
            .await
            .expect("clean nested linked worktree fixture");
        cleanup_root(root);
    }

    #[tokio::test]
    async fn guarded_rollback_never_mutates_a_same_path_replacement_repository() {
        let root = git_root();
        let expected_identity = serde_json::to_string(
            &filesystem_identity(&root).expect("capture authorized Project identity"),
        )
        .expect("encode authorized Project identity");
        let moved = root.with_extension("authorized-old");
        std::fs::rename(&root, &moved).expect("move authorized Project root");
        initialize_git_root(&root);
        let (replacement_worktree, branch) =
            fixture_worktree(&root, "lease-replacement", "run-replacement");

        let error = rollback_created_worktree_with_expected_identity(
            &root,
            &replacement_worktree,
            &branch,
            &expected_identity,
        )
        .await
        .expect_err("rollback must not operate on the replacement repository");
        assert!(error.contains("identity changed"), "{error}");
        assert!(replacement_worktree.exists());
        assert!(fixture_git(
            &root,
            &["show-ref", "--verify", &format!("refs/heads/{branch}")],
        )
        .status
        .success());

        cleanup_root(root);
        cleanup_root(moved);
    }
}
