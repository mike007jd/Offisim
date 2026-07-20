use super::*;

/// Grace window between SIGTERM and SIGKILL for git children (original
/// `terminate_git_process_group` value).
const GIT_TERMINATION_GRACE: Duration = Duration::from_millis(500);

pub(super) const MAX_GIT_OUTPUT_BYTES: usize = 1024 * 1024;
/// Wall-clock bound on a single `git` invocation. A hung clone (stalled network,
/// credential prompt despite GIT_TERMINAL_PROMPT=0) is killed instead of blocking
/// the IPC handler forever.
pub(super) const GIT_EXEC_TIMEOUT: Duration = Duration::from_secs(120);
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FilesystemIdentity {
    #[serde(rename = "canonicalRoot")]
    pub(super) canonical_path: String,
    #[cfg(unix)]
    pub(super) device: u64,
    #[cfg(unix)]
    pub(super) inode: u64,
}

pub(super) fn filesystem_identity(path: &Path) -> Result<FilesystemIdentity, String> {
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Resolve filesystem identity: {error}"))?;
    let metadata = canonical
        .metadata()
        .map_err(|error| format!("Inspect filesystem identity: {error}"))?;
    if !metadata.is_dir() {
        return Err("Workspace lease identity must reference a directory".into());
    }
    let canonical_path = canonical
        .to_str()
        .ok_or_else(|| "Workspace lease path is not valid UTF-8".to_string())?
        .to_string();
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(FilesystemIdentity {
            canonical_path,
            device: metadata.dev(),
            inode: metadata.ino(),
        })
    }
    #[cfg(not(unix))]
    {
        Ok(FilesystemIdentity { canonical_path })
    }
}

pub(crate) trait GitRootAuthority {
    fn git_root(&self) -> &Path;
    fn verify_git_root(&self) -> Result<(), String>;
}

impl GitRootAuthority for AuthorizedWorkspaceRoot {
    fn git_root(&self) -> &Path {
        self.path()
    }

    fn verify_git_root(&self) -> Result<(), String> {
        self.verify_live()
    }
}

impl GitRootAuthority for TaskWorkspaceBinding {
    fn git_root(&self) -> &Path {
        &self.canonical_root
    }

    fn verify_git_root(&self) -> Result<(), String> {
        self.verify_live_root()
    }
}

#[cfg(test)]
impl GitRootAuthority for PathBuf {
    fn git_root(&self) -> &Path {
        self
    }

    fn verify_git_root(&self) -> Result<(), String> {
        if self.is_dir() {
            Ok(())
        } else {
            Err("Fixture Git root is unavailable".into())
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct GitExecutionScope {
    pub(super) root_path: PathBuf,
    pub(super) root_identity: FilesystemIdentity,
    cwd_path: PathBuf,
    cwd_relative: PathBuf,
    cwd_identity: FilesystemIdentity,
}

#[derive(Clone, Copy)]
pub(super) enum GitTargetExpectation<'a> {
    Missing(&'a Path),
    Existing {
        path: &'a Path,
        identity: &'a FilesystemIdentity,
    },
}

impl GitExecutionScope {
    pub(super) fn from_authority<A: GitRootAuthority + ?Sized>(
        authority: &A,
        cwd: &Path,
    ) -> Result<Self, String> {
        authority.verify_git_root()?;
        let root_identity = filesystem_identity(authority.git_root())?;
        let cwd_identity = filesystem_identity(cwd)?;
        let root_canonical = Path::new(&root_identity.canonical_path);
        let cwd_canonical = Path::new(&cwd_identity.canonical_path);
        let cwd_relative = cwd_canonical
            .strip_prefix(root_canonical)
            .map_err(|_| "Git working directory escaped the authorized Project folder".to_string())?
            .to_path_buf();
        let scope = Self {
            root_path: authority.git_root().to_path_buf(),
            root_identity,
            cwd_path: cwd.to_path_buf(),
            cwd_relative,
            cwd_identity,
        };
        authority.verify_git_root()?;
        scope.verify_live()?;
        Ok(scope)
    }

    pub(super) fn from_expected(
        root_path: &Path,
        root_identity: FilesystemIdentity,
        cwd_path: &Path,
        cwd_identity: FilesystemIdentity,
    ) -> Result<Self, String> {
        let root_canonical = Path::new(&root_identity.canonical_path);
        let cwd_canonical = Path::new(&cwd_identity.canonical_path);
        let cwd_relative = cwd_canonical
            .strip_prefix(root_canonical)
            .map_err(|_| "Git working directory escaped the registered Project folder".to_string())?
            .to_path_buf();
        let scope = Self {
            root_path: root_path.to_path_buf(),
            root_identity,
            cwd_path: cwd_path.to_path_buf(),
            cwd_relative,
            cwd_identity,
        };
        scope.verify_live()?;
        Ok(scope)
    }

    pub(super) fn verify_live(&self) -> Result<(), String> {
        let root_identity = filesystem_identity(&self.root_path).map_err(|error| {
            format!("Project folder identity changed before Git execution: {error}")
        })?;
        if root_identity != self.root_identity {
            return Err("Project folder identity changed before Git execution".into());
        }
        let cwd_identity = filesystem_identity(&self.cwd_path).map_err(|error| {
            format!("Git working directory identity changed before execution: {error}")
        })?;
        if cwd_identity != self.cwd_identity {
            return Err("Git working directory identity changed before execution".into());
        }
        Ok(())
    }

    pub(super) fn root_scope(&self) -> Result<Self, String> {
        Self::from_expected(
            &self.root_path,
            self.root_identity.clone(),
            &self.root_path,
            self.root_identity.clone(),
        )
    }

    pub(super) fn with_live_cwd(&self, cwd: &Path) -> Result<Self, String> {
        self.verify_live()?;
        let scope = Self::from_expected(
            &self.root_path,
            self.root_identity.clone(),
            cwd,
            filesystem_identity(cwd)?,
        )?;
        self.verify_live()?;
        Ok(scope)
    }

    pub(super) fn bind_command(&self, command: &mut Command) -> Result<(), String> {
        self.bind_command_with_target(command, None)
    }

    pub(super) fn bind_command_with_target(
        &self,
        command: &mut Command,
        target: Option<GitTargetExpectation<'_>>,
    ) -> Result<(), String> {
        self.verify_live()?;

        #[cfg(unix)]
        {
            use std::ffi::CString;
            use std::fs::{File, OpenOptions};
            use std::os::fd::{AsRawFd, FromRawFd};
            use std::os::unix::ffi::OsStrExt;
            use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
            use std::os::unix::process::CommandExt;

            let root = OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
                .open(&self.root_identity.canonical_path)
                .map_err(|error| format!("Open authorized Project folder: {error}"))?;
            let root_metadata = root
                .metadata()
                .map_err(|error| format!("Inspect authorized Project descriptor: {error}"))?;
            if !root_metadata.is_dir()
                || root_metadata.dev() != self.root_identity.device
                || root_metadata.ino() != self.root_identity.inode
            {
                return Err("Project folder identity changed before Git spawn".into());
            }

            // Resolve cwd relative to the captured root descriptor. Opening the
            // cwd by its absolute path would leave every intermediate component
            // vulnerable to a rename/symlink swap after validation.
            let mut cwd = root
                .try_clone()
                .map_err(|error| format!("Clone authorized Project descriptor: {error}"))?;
            let mut cwd_components = Vec::new();
            for component in self.cwd_relative.components() {
                let segment = match component {
                    Component::CurDir => continue,
                    Component::Normal(segment) => segment,
                    _ => {
                        return Err(
                            "Git working directory contains a non-relative path component".into(),
                        );
                    }
                };
                let segment = CString::new(segment.as_bytes()).map_err(|_| {
                    "Git working directory component contains an embedded NUL byte".to_string()
                })?;
                // SAFETY: cwd is an open directory descriptor and segment is a
                // single NUL-terminated component. O_NOFOLLOW rejects a swapped
                // symlink at every level of the descriptor walk.
                let next_fd = unsafe {
                    libc::openat(
                        cwd.as_raw_fd(),
                        segment.as_ptr(),
                        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                    )
                };
                if next_fd < 0 {
                    return Err(format!(
                        "Open Git working directory component: {}",
                        std::io::Error::last_os_error()
                    ));
                }
                // SAFETY: openat returned a new owned descriptor.
                cwd = unsafe { File::from_raw_fd(next_fd) };
                cwd_components.push(segment);
            }
            let cwd_metadata = cwd
                .metadata()
                .map_err(|error| format!("Inspect Git working directory descriptor: {error}"))?;
            if !cwd_metadata.is_dir()
                || cwd_metadata.dev() != self.cwd_identity.device
                || cwd_metadata.ino() != self.cwd_identity.inode
            {
                return Err("Git working directory identity changed before spawn".into());
            }

            let root_path = CString::new(self.root_identity.canonical_path.as_bytes())
                .map_err(|_| "Project folder path contains an embedded NUL byte".to_string())?;
            let cwd_path =
                CString::new(self.cwd_identity.canonical_path.as_bytes()).map_err(|_| {
                    "Git working directory path contains an embedded NUL byte".to_string()
                })?;
            let expected_root_device = self.root_identity.device;
            let expected_root_inode = self.root_identity.inode;
            let expected_cwd_device = self.cwd_identity.device;
            let expected_cwd_inode = self.cwd_identity.inode;
            let target_guard = match target {
                Some(expectation) => {
                    let path = match expectation {
                        GitTargetExpectation::Missing(path)
                        | GitTargetExpectation::Existing { path, .. } => path,
                    };
                    let parent = path
                        .parent()
                        .ok_or_else(|| "Guarded Git target has no parent directory".to_string())?;
                    let parent_identity = filesystem_identity(parent)?;
                    if parent_identity != self.cwd_identity {
                        return Err("Guarded Git target parent does not match the bound cwd".into());
                    }
                    let basename = path
                        .file_name()
                        .ok_or_else(|| "Guarded Git target has no basename".to_string())?;
                    let basename = CString::new(basename.as_bytes()).map_err(|_| {
                        "Guarded Git target basename contains an embedded NUL byte".to_string()
                    })?;
                    match expectation {
                        GitTargetExpectation::Missing(path) => {
                            match std::fs::symlink_metadata(path) {
                                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                                Ok(_) => {
                                    return Err(
                                        "Guarded Git target appeared before command binding".into(),
                                    );
                                }
                                Err(error) => {
                                    return Err(format!("Inspect missing Git target: {error}"));
                                }
                            }
                            Some((basename, None))
                        }
                        GitTargetExpectation::Existing { path, identity } => {
                            let metadata = std::fs::symlink_metadata(path)
                                .map_err(|error| format!("Inspect guarded Git target: {error}"))?;
                            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                                return Err(
                                    "Guarded Git target must be an ordinary directory".into()
                                );
                            }
                            if filesystem_identity(path)? != *identity
                                || metadata.dev() != identity.device
                                || metadata.ino() != identity.inode
                            {
                                return Err(
                                    "Guarded Git target identity changed before command binding"
                                        .into(),
                                );
                            }
                            Some((basename, Some((identity.device, identity.inode))))
                        }
                    }
                }
                None => None,
            };

            // SAFETY: the child callback uses only async-signal-safe libc calls.
            // The directory File stays captured until the callback fchdir's to
            // the already verified inode; O_CLOEXEC closes it at exec.
            unsafe {
                command.as_std_mut().pre_exec(move || {
                    let mut root_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
                    if libc::stat(root_path.as_ptr(), root_stat.as_mut_ptr()) != 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    let root_stat = root_stat.assume_init();
                    if root_stat.st_dev as u64 != expected_root_device
                        || root_stat.st_ino != expected_root_inode
                    {
                        return Err(std::io::Error::from_raw_os_error(libc::ESTALE));
                    }

                    let mut root_fd_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
                    if libc::fstat(root.as_raw_fd(), root_fd_stat.as_mut_ptr()) != 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    let root_fd_stat = root_fd_stat.assume_init();
                    if root_fd_stat.st_dev as u64 != expected_root_device
                        || root_fd_stat.st_ino != expected_root_inode
                    {
                        return Err(std::io::Error::from_raw_os_error(libc::ESTALE));
                    }

                    let mut cwd_path_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
                    if libc::stat(cwd_path.as_ptr(), cwd_path_stat.as_mut_ptr()) != 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    let cwd_path_stat = cwd_path_stat.assume_init();
                    if cwd_path_stat.st_dev as u64 != expected_cwd_device
                        || cwd_path_stat.st_ino != expected_cwd_inode
                    {
                        return Err(std::io::Error::from_raw_os_error(libc::ESTALE));
                    }

                    let mut cwd_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
                    if libc::fstat(cwd.as_raw_fd(), cwd_stat.as_mut_ptr()) != 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    let cwd_stat = cwd_stat.assume_init();
                    if cwd_stat.st_dev as u64 != expected_cwd_device
                        || cwd_stat.st_ino != expected_cwd_inode
                    {
                        return Err(std::io::Error::from_raw_os_error(libc::ESTALE));
                    }

                    // Re-walk every cwd component from the still-authorized root
                    // descriptor immediately before exec. A symlink to the same
                    // moved inode can satisfy stat(2), so path and fd identity
                    // checks alone are insufficient for containment.
                    let mut walked_fd = libc::dup(root.as_raw_fd());
                    if walked_fd < 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    for segment in &cwd_components {
                        let next_fd = libc::openat(
                            walked_fd,
                            segment.as_ptr(),
                            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                        );
                        if next_fd < 0 {
                            let error = std::io::Error::last_os_error();
                            libc::close(walked_fd);
                            return Err(error);
                        }
                        libc::close(walked_fd);
                        walked_fd = next_fd;
                    }
                    let mut walked_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
                    if libc::fstat(walked_fd, walked_stat.as_mut_ptr()) != 0 {
                        let error = std::io::Error::last_os_error();
                        libc::close(walked_fd);
                        return Err(error);
                    }
                    let walked_stat = walked_stat.assume_init();
                    if walked_stat.st_dev as u64 != expected_cwd_device
                        || walked_stat.st_ino != expected_cwd_inode
                    {
                        libc::close(walked_fd);
                        return Err(std::io::Error::from_raw_os_error(libc::ESTALE));
                    }
                    if let Some((basename, expected_identity)) = &target_guard {
                        let mut target_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
                        let inspected = libc::fstatat(
                            walked_fd,
                            basename.as_ptr(),
                            target_stat.as_mut_ptr(),
                            libc::AT_SYMLINK_NOFOLLOW,
                        );
                        match expected_identity {
                            Some((device, inode)) => {
                                if inspected != 0 {
                                    let error = std::io::Error::last_os_error();
                                    libc::close(walked_fd);
                                    return Err(error);
                                }
                                let target_stat = target_stat.assume_init();
                                if target_stat.st_dev as u64 != *device
                                    || target_stat.st_ino != *inode
                                    || target_stat.st_mode & libc::S_IFMT != libc::S_IFDIR
                                {
                                    libc::close(walked_fd);
                                    return Err(std::io::Error::from_raw_os_error(libc::ESTALE));
                                }
                            }
                            None => {
                                if inspected == 0 {
                                    libc::close(walked_fd);
                                    return Err(std::io::Error::from_raw_os_error(libc::ESTALE));
                                }
                                let error = std::io::Error::last_os_error();
                                if error.raw_os_error() != Some(libc::ENOENT) {
                                    libc::close(walked_fd);
                                    return Err(error);
                                }
                            }
                        }
                    }
                    if libc::fchdir(walked_fd) != 0 {
                        let error = std::io::Error::last_os_error();
                        libc::close(walked_fd);
                        return Err(error);
                    }
                    libc::close(walked_fd);
                    Ok(())
                });
            }
        }

        #[cfg(not(unix))]
        {
            if target.is_some() {
                return Err("Secure Git target guards are unavailable on this platform".into());
            }
            command.current_dir(&self.cwd_path);
        }

        Ok(())
    }
}

#[derive(Debug, Serialize)]
pub struct GitResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum GitStdoutPolicy {
    HumanRedacted,
    MachineExact,
}

pub(super) fn git_target_parent_scope(
    root_execution: &GitExecutionScope,
    target: &Path,
    label: &str,
) -> Result<(GitExecutionScope, String), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("{label} has no parent directory"))?;
    let basename = target
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty() && *value != "." && *value != "..")
        .ok_or_else(|| format!("{label} has no valid basename"))?
        .to_string();
    if basename.starts_with('-') {
        return Err(format!("{label} basename must not start with '-'"));
    }
    let parent_execution = root_execution.with_live_cwd(parent)?;
    Ok((parent_execution, basename))
}

pub(crate) async fn run_git_validated<A: GitRootAuthority + ?Sized>(
    mut args: Vec<String>,
    authority: &A,
    cwd: Option<&Path>,
) -> Result<GitResult, String> {
    authority.verify_git_root()?;
    let root = authority.git_root();
    is_allowed(&args, root)?;
    let cwd_path = match cwd {
        Some(value) => resolve_git_cwd(root, value.to_string_lossy().as_ref())?,
        None => root.to_path_buf(),
    };
    let requested_execution = GitExecutionScope::from_authority(authority, &cwd_path)?;
    let root_execution = requested_execution.root_scope()?;
    let mut execution = requested_execution;
    let mut guarded_target: Option<(PathBuf, Option<FilesystemIdentity>)> = None;
    if args.first().map(String::as_str) == Some("clone") {
        let destination = prepare_clone_destination(root, &args)?;
        let (parent_execution, basename) =
            git_target_parent_scope(&root_execution, &destination, "git clone destination")?;
        *args
            .last_mut()
            .ok_or_else(|| "git clone destination is missing".to_string())? = basename;
        execution = parent_execution;
        guarded_target = Some((destination, None));
        authority.verify_git_root()?;
    }
    if args.first().map(String::as_str) == Some("push") {
        validate_push_context(&args, &execution).await?;
    }

    let mut command = Command::new("git");
    command.args(&args).env_clear().envs(scrubbed_git_env());
    let target_expectation = guarded_target
        .as_ref()
        .map(|(path, identity)| match identity {
            Some(identity) => GitTargetExpectation::Existing { path, identity },
            None => GitTargetExpectation::Missing(path),
        });
    execution.bind_command_with_target(&mut command, target_expectation)?;
    let result = if git_stdout_is_machine_protocol(&args) {
        run_git_capped_machine(command, GIT_EXEC_TIMEOUT, MAX_GIT_OUTPUT_BYTES).await?
    } else {
        run_git_capped(command, GIT_EXEC_TIMEOUT, MAX_GIT_OUTPUT_BYTES).await?
    };
    execution.verify_live()?;
    Ok(result)
}

/// G3: spawn git, stream stdout/stderr each capped at `max_bytes` (so a flood
/// cannot balloon memory before truncation), and bound the whole run by `timeout`
/// with `kill_on_drop` so a hung process is terminated rather than blocking.
pub(super) async fn run_git_capped(
    command: Command,
    timeout: Duration,
    max_bytes: usize,
) -> Result<GitResult, String> {
    run_git_capped_with_stdout_policy(command, timeout, max_bytes, GitStdoutPolicy::HumanRedacted)
        .await
}

pub(super) async fn run_git_capped_machine(
    command: Command,
    timeout: Duration,
    max_bytes: usize,
) -> Result<GitResult, String> {
    run_git_capped_with_stdout_policy(command, timeout, max_bytes, GitStdoutPolicy::MachineExact)
        .await
}

async fn run_git_capped_with_stdout_policy(
    mut command: Command,
    timeout: Duration,
    max_bytes: usize,
    stdout_policy: GitStdoutPolicy,
) -> Result<GitResult, String> {
    configure_process_group(&mut command);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to execute git: {}", e))?;
    let process_group_id = child.id();
    let mut process_group_guard = ProcessGroupGuard::new(process_group_id);
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "git stdout pipe unavailable".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "git stderr pipe unavailable".to_string())?;

    let stdout_task = tokio::spawn(async move { read_capped(&mut stdout, max_bytes).await });
    let stderr_task = tokio::spawn(async move { read_capped(&mut stderr, max_bytes).await });

    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(result) => result.map_err(|e| format!("git wait failed: {e}"))?,
        Err(_) => {
            terminate_process_group(&mut child, process_group_id, GIT_TERMINATION_GRACE).await;
            process_group_guard.disarm();
            stdout_task.abort();
            stderr_task.abort();
            return Err(format!("git timed out after {}s", timeout.as_secs()));
        }
    };

    // A Git hook can let the group leader exit while a background descendant
    // inherits stdout/stderr. EOF is therefore not a completion signal. Give
    // ordinary buffered output one short drain window, then terminate the whole
    // process group and finish the readers against the now-closed pipes.
    let mut drain_task = tokio::spawn(async move { tokio::join!(stdout_task, stderr_task) });
    let drained = tokio::time::timeout(Duration::from_millis(100), &mut drain_task).await;
    let (out_join, err_join) = match drained {
        Ok(results) => {
            terminate_process_group(&mut child, process_group_id, GIT_TERMINATION_GRACE).await;
            results.map_err(|error| format!("git output drain task failed: {error}"))?
        }
        Err(_) => {
            terminate_process_group(&mut child, process_group_id, GIT_TERMINATION_GRACE).await;
            match tokio::time::timeout(Duration::from_secs(1), &mut drain_task).await {
                Ok(result) => {
                    result.map_err(|error| format!("git output drain task failed: {error}"))?
                }
                Err(_) => {
                    drain_task.abort();
                    let _ = drain_task.await;
                    return Err(
                        "git output pipes did not close after process-group termination".into(),
                    );
                }
            }
        }
    };
    process_group_guard.disarm();
    let (out_bytes, out_trunc) = out_join
        .map_err(|error| format!("git stdout reader task failed: {error}"))?
        .map_err(|error| format!("git stdout read failed: {error}"))?;
    let (err_bytes, err_trunc) = err_join
        .map_err(|error| format!("git stderr reader task failed: {error}"))?
        .map_err(|error| format!("git stderr read failed: {error}"))?;
    if stdout_policy == GitStdoutPolicy::MachineExact && out_trunc {
        return Err("Git machine protocol output exceeded its byte limit".into());
    }
    let stdout = match (stdout_policy, status.success()) {
        (GitStdoutPolicy::MachineExact, true) => finalize_git_machine_output(&out_bytes, false)?,
        _ => finalize_git_output(&out_bytes, out_trunc),
    };
    Ok(GitResult {
        ok: status.success(),
        stdout,
        stderr: finalize_git_output(&err_bytes, err_trunc),
    })
}

/// Dedicated bounded stdin lane for `git apply`. The public Git runner keeps
/// stdin closed, so patch bytes can never leak into its broader command surface.
pub(super) async fn run_git_patch_capped(
    mut command: Command,
    patch: Vec<u8>,
    stdout_policy: GitStdoutPolicy,
) -> Result<GitResult, String> {
    configure_process_group(&mut command);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to execute workspace lease patch command: {error}"))?;
    let process_group_id = child.id();
    let mut process_group_guard = ProcessGroupGuard::new(process_group_id);
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "git apply stdin pipe unavailable".to_string())?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "git apply stdout pipe unavailable".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "git apply stderr pipe unavailable".to_string())?;

    let stdin_task = tokio::spawn(async move {
        stdin.write_all(&patch).await?;
        stdin.shutdown().await
    });
    let stdout_task =
        tokio::spawn(async move { read_capped(&mut stdout, MAX_GIT_OUTPUT_BYTES).await });
    let stderr_task =
        tokio::spawn(async move { read_capped(&mut stderr, MAX_GIT_OUTPUT_BYTES).await });

    let status = match tokio::time::timeout(WORKSPACE_LEASE_PATCH_TIMEOUT, child.wait()).await {
        Ok(result) => result.map_err(|error| format!("git apply wait failed: {error}"))?,
        Err(_) => {
            stdin_task.abort();
            stdout_task.abort();
            stderr_task.abort();
            terminate_process_group(&mut child, process_group_id, GIT_TERMINATION_GRACE).await;
            process_group_guard.disarm();
            return Err(format!(
                "git apply timed out after {}s",
                WORKSPACE_LEASE_PATCH_TIMEOUT.as_secs()
            ));
        }
    };

    let stdin_result = stdin_task
        .await
        .map_err(|error| format!("git apply stdin task failed: {error}"))?;
    if status.success() {
        stdin_result.map_err(|error| format!("Write git apply patch: {error}"))?;
    }

    let mut drain_task = tokio::spawn(async move { tokio::join!(stdout_task, stderr_task) });
    let drained = tokio::time::timeout(Duration::from_millis(100), &mut drain_task).await;
    let (out_join, err_join) = match drained {
        Ok(results) => {
            terminate_process_group(&mut child, process_group_id, GIT_TERMINATION_GRACE).await;
            results.map_err(|error| format!("git apply output drain task failed: {error}"))?
        }
        Err(_) => {
            terminate_process_group(&mut child, process_group_id, GIT_TERMINATION_GRACE).await;
            match tokio::time::timeout(Duration::from_secs(1), &mut drain_task).await {
                Ok(result) => result
                    .map_err(|error| format!("git apply output drain task failed: {error}"))?,
                Err(_) => {
                    drain_task.abort();
                    let _ = drain_task.await;
                    return Err(
                        "git apply output pipes did not close after process-group termination"
                            .into(),
                    );
                }
            }
        }
    };
    process_group_guard.disarm();
    let (out_bytes, out_truncated) = out_join
        .map_err(|error| format!("git apply stdout reader task failed: {error}"))?
        .map_err(|error| format!("git apply stdout read failed: {error}"))?;
    let (err_bytes, err_truncated) = err_join
        .map_err(|error| format!("git apply stderr reader task failed: {error}"))?
        .map_err(|error| format!("git apply stderr read failed: {error}"))?;
    if stdout_policy == GitStdoutPolicy::MachineExact && out_truncated {
        return Err("Git apply machine output exceeded its byte limit".into());
    }
    let stdout = match (stdout_policy, status.success()) {
        (GitStdoutPolicy::MachineExact, true) => finalize_git_machine_output(&out_bytes, false)?,
        _ => finalize_git_output(&out_bytes, out_truncated),
    };
    Ok(GitResult {
        ok: status.success(),
        stdout,
        stderr: finalize_git_output(&err_bytes, err_truncated),
    })
}

/// Read `reader` to EOF, capturing at most `max_bytes`. Excess is drained and
/// discarded (so the child never blocks on a full pipe) and flagged as truncated.
async fn read_capped<R>(reader: &mut R, max_bytes: usize) -> std::io::Result<(Vec<u8>, bool)>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];
    let mut truncated = false;
    loop {
        let n = reader.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        if buf.len() >= max_bytes {
            truncated = true;
            continue;
        }
        let room = max_bytes - buf.len();
        if n <= room {
            buf.extend_from_slice(&chunk[..n]);
        } else {
            buf.extend_from_slice(&chunk[..room]);
            truncated = true;
        }
    }
    Ok((buf, truncated))
}

pub(super) fn scrubbed_git_env() -> Vec<(String, String)> {
    let mut env = crate::env_scrub::scrubbed_child_env(&["SSH_AUTH_SOCK"]);
    env.push(("GIT_TERMINAL_PROMPT".into(), "0".into()));
    env.push(("GIT_LITERAL_PATHSPECS".into(), "1".into()));
    env
}

/// Build the final stream text: lossy-decode the (already byte-capped) buffer,
/// append the truncation marker when the stream overflowed, then redact. Git
/// policy is stricter than shell: URL-credential redaction on + the extra
/// `secret` keyword. The scan mechanism lives in `crate::redaction`.
fn finalize_git_output(buf: &[u8], truncated: bool) -> String {
    let mut text = String::from_utf8_lossy(buf).to_string();
    if truncated {
        text.push_str("\n[OUTPUT TRUNCATED]");
    }
    crate::redaction::redact_secret_tokens(&text, true, &["secret"])
}

fn finalize_git_machine_output(buf: &[u8], truncated: bool) -> Result<String, String> {
    if truncated {
        return Err("Git machine protocol output exceeded its byte limit".into());
    }
    String::from_utf8(buf.to_vec())
        .map_err(|_| "Git machine protocol output is not valid UTF-8".to_string())
}

fn git_stdout_is_machine_protocol(args: &[String]) -> bool {
    match args.first().map(String::as_str) {
        Some("rev-parse") => true,
        Some("branch") => args.get(1).map(String::as_str) == Some("--show-current"),
        Some("status") => args
            .iter()
            .skip(1)
            .any(|arg| matches!(arg.as_str(), "--porcelain" | "--porcelain=v1")),
        Some("diff") => args
            .iter()
            .take_while(|arg| arg.as_str() != "--")
            .any(|arg| matches!(arg.as_str(), "--numstat" | "--name-only" | "--name-status")),
        _ => false,
    }
}

#[cfg(test)]
pub(in crate::git) mod tests {
    use super::*;
    pub(in crate::git) use std::sync::atomic::{AtomicU64, Ordering};

    pub(in crate::git) static TEMP_ROOT_COUNTER: AtomicU64 = AtomicU64::new(0);

    pub(in crate::git) fn temp_root() -> PathBuf {
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

    pub(in crate::git) fn cleanup_root(root: PathBuf) {
        let _ = std::fs::remove_dir_all(root);
    }

    pub(in crate::git) fn fixture_git(root: &Path, args: &[&str]) -> std::process::Output {
        std::process::Command::new("git")
            .args(args)
            .current_dir(root)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .expect("run fixture git")
    }

    pub(in crate::git) fn fixture_git_ok(root: &Path, args: &[&str]) {
        let output = fixture_git(root, args);
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    pub(in crate::git) fn initialize_git_root(root: &Path) {
        std::fs::create_dir_all(root).expect("create git fixture root");
        fixture_git_ok(root, &["init"]);
        fixture_git_ok(
            root,
            &["config", "user.email", "offisim-tests@example.test"],
        );
        fixture_git_ok(root, &["config", "user.name", "Offisim Tests"]);
        std::fs::write(root.join("README.md"), "fixture\n").expect("write fixture file");
        fixture_git_ok(root, &["add", "README.md"]);
        fixture_git_ok(root, &["commit", "-m", "fixture"]);
    }

    pub(in crate::git) fn git_root() -> PathBuf {
        let root = temp_root();
        initialize_git_root(&root);
        root.canonicalize().expect("canonical git fixture")
    }

    pub(in crate::git) fn git_execution(root: &Path) -> GitExecutionScope {
        let authority = AuthorizedWorkspaceRoot::from_live_path(root.to_path_buf())
            .expect("capture fixture Git authority");
        GitExecutionScope::from_authority(&authority, root).expect("capture fixture Git scope")
    }

    pub(in crate::git) fn fixture_worktree(
        root: &Path,
        lease_id: &str,
        run_id: &str,
    ) -> (PathBuf, String) {
        let path = root.join(".offisim").join("worktrees").join(lease_id);
        std::fs::create_dir_all(path.parent().expect("worktree parent"))
            .expect("create worktree parent");
        let branch = expected_workspace_lease_branch(run_id, lease_id);
        let path_text = path.to_string_lossy().to_string();
        fixture_git_ok(root, &["worktree", "add", "-b", &branch, &path_text]);
        (
            path.canonicalize().expect("canonical fixture worktree"),
            branch,
        )
    }

    #[test]
    fn git_target_parent_scope_rejects_option_like_basename() {
        let root = git_root();
        let execution = git_execution(&root);
        let error = git_target_parent_scope(
            &execution,
            &root.join("-option-like-target"),
            "fixture target",
        )
        .expect_err("option-like basenames must never enter a git argument vector");
        assert!(error.contains("must not start with '-'"), "{error}");
        cleanup_root(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn git_spawn_rejects_project_root_replacement_after_descriptor_capture() {
        use std::os::unix::fs::symlink;

        let root = git_root();
        let outside = git_root();
        std::fs::write(outside.join("escape.txt"), "outside sentinel\n")
            .expect("write outside sentinel");
        let execution = git_execution(&root);
        let mut command = Command::new("git");
        command
            .args(["add", "--", "escape.txt"])
            .env_clear()
            .envs(scrubbed_git_env());
        execution
            .bind_command(&mut command)
            .expect("capture authorized root descriptor");

        let moved = root.with_extension("captured-root");
        std::fs::rename(&root, &moved).expect("move captured Project root");
        symlink(&outside, &root).expect("replace Project root with outside symlink");

        let error = run_git_capped(command, Duration::from_secs(5), MAX_GIT_OUTPUT_BYTES)
            .await
            .expect_err("pre-exec root identity check must reject replacement");
        assert!(error.contains("Failed to execute git"), "{error}");
        assert!(fixture_git(&outside, &["diff", "--cached", "--name-only"])
            .stdout
            .is_empty());

        std::fs::remove_file(&root).expect("remove replacement root symlink");
        cleanup_root(moved);
        cleanup_root(outside);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn git_spawn_rejects_cwd_move_and_same_inode_symlink_after_descriptor_capture() {
        use std::os::unix::fs::symlink;

        let root = git_root();
        let parent = root.join(".offisim/worktrees");
        std::fs::create_dir_all(&parent).expect("create descriptor-bound target parent");
        let authority = AuthorizedWorkspaceRoot::from_live_path(root.clone())
            .expect("capture Project authority");
        let execution = GitExecutionScope::from_authority(&authority, &parent)
            .expect("capture target parent scope");
        let mut command = Command::new("git");
        command
            .args(["init", "should-not-exist"])
            .env_clear()
            .envs(scrubbed_git_env());
        execution
            .bind_command(&mut command)
            .expect("bind target parent before replacement");

        let outside = std::env::temp_dir().join(format!(
            "offisim-moved-parent-{}-{}",
            std::process::id(),
            TEMP_ROOT_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::rename(&parent, &outside).expect("move captured parent outside Project");
        symlink(&outside, &parent).expect("replace parent with same-inode symlink");

        let error = run_git_capped(command, Duration::from_secs(5), MAX_GIT_OUTPUT_BYTES)
            .await
            .expect_err("pre-exec descriptor walk must reject same-inode symlink escape");
        assert!(error.contains("Failed to execute git"), "{error}");
        assert!(!outside.join("should-not-exist").exists());

        std::fs::remove_file(&parent).expect("remove replacement parent symlink");
        std::fs::rename(&outside, &parent).expect("restore captured parent for cleanup");
        cleanup_root(root);
    }

    #[cfg(unix)]
    #[test]
    fn git_bind_rejects_intermediate_symlink_swap_before_descriptor_walk() {
        use std::os::unix::fs::symlink;

        let root = git_root();
        let nested = root.join("one/two");
        std::fs::create_dir_all(&nested).expect("create nested Git cwd");
        let authority = AuthorizedWorkspaceRoot::from_live_path(root.clone())
            .expect("capture Project authority");
        let execution = GitExecutionScope::from_authority(&authority, &nested)
            .expect("capture nested Git scope");
        let moved = root.join("one-old");
        std::fs::rename(root.join("one"), &moved).expect("move intermediate directory");
        let outside = temp_root();
        symlink(&outside, root.join("one")).expect("replace intermediate with outside symlink");

        let mut command = Command::new("git");
        command.arg("status");
        let error = execution
            .bind_command(&mut command)
            .expect_err("intermediate symlink replacement must fail before spawn");
        assert!(error.contains("identity changed"), "{error}");

        std::fs::remove_file(root.join("one")).expect("remove intermediate symlink");
        std::fs::rename(moved, root.join("one")).expect("restore intermediate directory");
        cleanup_root(root);
        cleanup_root(outside);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn guarded_target_rejects_existing_and_missing_basename_replacements_at_spawn() {
        let root = git_root();
        let parent = root.join(".offisim/worktrees");
        std::fs::create_dir_all(&parent).expect("create guarded target parent");
        let authority = AuthorizedWorkspaceRoot::from_live_path(root.clone())
            .expect("capture guarded target authority");
        let execution = GitExecutionScope::from_authority(&authority, &parent)
            .expect("capture guarded target parent scope");

        let existing = parent.join("existing-target");
        std::fs::create_dir(&existing).expect("create original guarded target");
        let existing_identity = filesystem_identity(&existing).expect("capture target identity");
        let mut existing_remove = Command::new("/bin/sh");
        existing_remove.args(["-c", "rm -rf -- existing-target"]);
        execution
            .bind_command_with_target(
                &mut existing_remove,
                Some(GitTargetExpectation::Existing {
                    path: &existing,
                    identity: &existing_identity,
                }),
            )
            .expect("bind existing guarded target");
        let moved = parent.join("existing-target-old");
        std::fs::rename(&existing, &moved).expect("move original guarded target");
        std::fs::create_dir(&existing).expect("create same-path replacement target");
        let existing_sentinel = existing.join("user-sentinel");
        std::fs::write(&existing_sentinel, "keep\n").expect("write replacement sentinel");
        let error = run_git_capped(
            existing_remove,
            Duration::from_secs(5),
            MAX_GIT_OUTPUT_BYTES,
        )
        .await
        .expect_err("changed existing target inode must block spawn");
        assert!(error.contains("Failed to execute git"), "{error}");
        assert!(existing_sentinel.is_file());

        let missing = parent.join("missing-target");
        let mut missing_remove = Command::new("/bin/sh");
        missing_remove.args(["-c", "rm -rf -- missing-target"]);
        execution
            .bind_command_with_target(
                &mut missing_remove,
                Some(GitTargetExpectation::Missing(&missing)),
            )
            .expect("bind missing guarded target");
        std::fs::create_dir(&missing).expect("create late same-path target");
        let missing_sentinel = missing.join("user-sentinel");
        std::fs::write(&missing_sentinel, "keep\n").expect("write late target sentinel");
        let error = run_git_capped(missing_remove, Duration::from_secs(5), MAX_GIT_OUTPUT_BYTES)
            .await
            .expect_err("late target appearance must block spawn");
        assert!(error.contains("Failed to execute git"), "{error}");
        assert!(missing_sentinel.is_file());

        cleanup_root(root);
    }

    #[test]
    fn scrubbed_git_env_excludes_provider_secrets() {
        std::env::set_var("OPENAI_API_KEY", "sk-test-secret");
        std::env::set_var("ANTHROPIC_API_KEY", "sk-test-secret");
        std::env::set_var("SSH_AUTH_SOCK", "/tmp/offisim-test-agent.sock");
        let env = scrubbed_git_env();
        let keys = env.into_iter().map(|(key, _)| key).collect::<Vec<_>>();
        assert!(!keys.contains(&"OPENAI_API_KEY".to_string()));
        assert!(!keys.contains(&"ANTHROPIC_API_KEY".to_string()));
        assert!(keys.contains(&"SSH_AUTH_SOCK".to_string()));
        assert!(keys.contains(&"GIT_TERMINAL_PROMPT".to_string()));
    }

    #[test]
    fn finalize_git_output_removes_url_credentials_and_secret_tokens() {
        let output = finalize_git_output(
            b"remote https://ghp_abcdefghijklmnopqrstuvwxyz123456@github.com/acme/repo.git\nsk-abcdefghijklmnopqrstuvwxyz123456\n",
            false,
        );
        assert!(!output.contains("ghp_abcdefghijklmnopqrstuvwxyz123456"));
        assert!(!output.contains("sk-abcdefghijklmnopqrstuvwxyz123456"));
        assert!(output.contains("https://[REDACTED]@github.com/acme/repo.git"));
    }

    #[test]
    fn finalize_git_output_appends_truncation_marker() {
        assert!(finalize_git_output(b"partial output", true).ends_with("[OUTPUT TRUNCATED]"));
        assert!(!finalize_git_output(b"complete output", false).contains("[OUTPUT TRUNCATED]"));
    }

    #[test]
    fn machine_output_is_exact_and_truncation_fails_closed() {
        let exact = b"?? line\nbreak-offisim_secret_token_abcdefghijklmnopqrstuvwxyz.txt\0";
        assert_eq!(
            finalize_git_machine_output(exact, false).expect("exact machine output"),
            String::from_utf8(exact.to_vec()).expect("fixture utf8")
        );
        let error = finalize_git_machine_output(exact, true)
            .expect_err("truncated machine protocol must not return partial paths");
        assert!(error.contains("byte limit"), "{error}");
    }

    #[tokio::test]
    async fn machine_git_roundtrip_preserves_weird_paths_and_literal_pathspecs() {
        let root = git_root();
        let spaced = "file with space.txt";
        let secret = "line\nbreak-offisim_secret_token_abcdefghijklmnopqrstuvwxyz.txt";
        let whitespace = " leading-and-trailing \n";
        let whitespace_only = " ";
        let magic = ":(glob)*";
        let other = "other.txt";
        for (path, content) in [
            (spaced, "space content\n"),
            (secret, "secret-shaped filename content\n"),
            (whitespace, "whitespace filename content\n"),
            (whitespace_only, "whitespace-only filename content\n"),
            (magic, "literal magic path\n"),
            (other, "must remain untouched\n"),
        ] {
            std::fs::write(root.join(path), content).expect("write weird-path fixture");
        }

        let status = run_git_validated(
            vec!["status".into(), "--porcelain=v1".into(), "-z".into()],
            &root,
            None,
        )
        .await
        .expect("run exact status");
        assert!(status.ok);
        assert!(!status.stdout.contains("[REDACTED]"));
        let status_records = status.stdout.split('\0').collect::<Vec<_>>();
        for path in [spaced, secret, whitespace, whitespace_only, magic, other] {
            assert!(
                status_records.contains(&format!("?? {path}").as_str()),
                "status lost exact path {path:?}: {:?}",
                status.stdout
            );
        }

        let staged_magic =
            run_git_validated(vec!["add".into(), "--".into(), magic.into()], &root, None)
                .await
                .expect("stage literal Git-magic filename");
        assert!(staged_magic.ok, "{}", staged_magic.stderr);
        let staged_names = run_git_validated(
            vec![
                "diff".into(),
                "--cached".into(),
                "--name-only".into(),
                "-z".into(),
            ],
            &root,
            None,
        )
        .await
        .expect("list staged literal filename");
        assert_eq!(staged_names.stdout, format!("{magic}\0"));

        let committed_magic = run_git_validated(
            vec![
                "commit".into(),
                "-m".into(),
                "commit literal magic filename".into(),
                "--".into(),
                magic.into(),
            ],
            &root,
            None,
        )
        .await
        .expect("commit literal Git-magic filename");
        assert!(committed_magic.ok, "{}", committed_magic.stderr);

        let staged_weird = run_git_validated(
            vec![
                "add".into(),
                "--".into(),
                spaced.into(),
                secret.into(),
                whitespace.into(),
                whitespace_only.into(),
            ],
            &root,
            None,
        )
        .await
        .expect("stage exact spaced and newline paths");
        assert!(staged_weird.ok, "{}", staged_weird.stderr);
        let numstat = run_git_validated(
            vec![
                "diff".into(),
                "--cached".into(),
                "--numstat".into(),
                "-z".into(),
            ],
            &root,
            None,
        )
        .await
        .expect("read exact NUL numstat");
        assert!(numstat.ok);
        assert!(numstat.stdout.contains(spaced));
        assert!(numstat.stdout.contains(secret));
        assert!(numstat.stdout.contains(whitespace));
        assert!(numstat.stdout.contains("\t \0"));
        assert!(!numstat.stdout.contains(other));
        assert!(!numstat.stdout.contains("[REDACTED]"));

        let human_diff = run_git_validated(
            vec![
                "diff".into(),
                "--cached".into(),
                "--unified=3".into(),
                "--".into(),
                secret.into(),
            ],
            &root,
            None,
        )
        .await
        .expect("read redacted human diff");
        assert!(human_diff.ok);
        assert!(!human_diff.stdout.contains(secret));
        assert!(human_diff.stdout.contains("[REDACTED]"));

        let whitespace_diff = run_git_validated(
            vec![
                "diff".into(),
                "--cached".into(),
                "--unified=3".into(),
                "--".into(),
                whitespace.into(),
            ],
            &root,
            None,
        )
        .await
        .expect("diff exact leading/trailing whitespace path");
        assert!(whitespace_diff.ok, "{}", whitespace_diff.stderr);
        assert!(whitespace_diff
            .stdout
            .contains("whitespace filename content"));

        cleanup_root(root);
    }

    #[tokio::test]
    async fn merge_conflict_paths_come_from_exact_nul_machine_query() {
        let root = git_root();
        let path = "line\nbreak-offisim_secret_token_abcdefghijklmnopqrstuvwxyz.txt";
        let base_branch_output = fixture_git(&root, &["branch", "--show-current"]);
        assert!(base_branch_output.status.success());
        let base_branch = String::from_utf8(base_branch_output.stdout)
            .expect("base branch utf8")
            .trim_end()
            .to_string();
        std::fs::write(root.join(path), "base\n").expect("write conflict base");
        fixture_git_ok(&root, &["add", "--", path]);
        fixture_git_ok(&root, &["commit", "-m", "conflict base"]);
        fixture_git_ok(&root, &["switch", "-c", "feature-conflict"]);
        std::fs::write(root.join(path), "feature\n").expect("write feature conflict");
        fixture_git_ok(&root, &["add", "--", path]);
        fixture_git_ok(&root, &["commit", "-m", "feature conflict"]);
        fixture_git_ok(&root, &["switch", &base_branch]);
        std::fs::write(root.join(path), "main\n").expect("write main conflict");
        fixture_git_ok(&root, &["add", "--", path]);
        fixture_git_ok(&root, &["commit", "-m", "main conflict"]);

        let merge = run_git_validated(
            vec!["merge".into(), "--no-ff".into(), "feature-conflict".into()],
            &root,
            None,
        )
        .await
        .expect("run conflicting human merge");
        assert!(!merge.ok, "merge fixture must conflict");
        assert!(
            !format!("{}{}", merge.stdout, merge.stderr).contains(path),
            "human merge diagnostics must remain redacted"
        );

        let conflicts = run_git_validated(
            vec![
                "diff".into(),
                "--name-only".into(),
                "--diff-filter=U".into(),
                "-z".into(),
            ],
            &root,
            None,
        )
        .await
        .expect("query exact conflict paths");
        assert!(conflicts.ok, "{}", conflicts.stderr);
        assert_eq!(conflicts.stdout, format!("{path}\0"));

        cleanup_root(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn bounded_machine_probe_times_out_on_fifo_git_head() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;

        let root = git_root();
        let head = root.join(".git/HEAD");
        std::fs::remove_file(&head).expect("remove fixture HEAD");
        let head_name = CString::new(head.as_os_str().as_bytes()).expect("HEAD path CString");
        let created = unsafe { libc::mkfifo(head_name.as_ptr(), 0o600) };
        assert_eq!(
            created,
            0,
            "create HEAD FIFO: {}",
            std::io::Error::last_os_error()
        );

        let started = std::time::Instant::now();
        let error = run_git_probe_with_timeout(
            &root,
            &["branch", "--show-current"],
            Duration::from_millis(300),
        )
        .await
        .expect_err("FIFO-backed git probe must time out");
        assert!(error.contains("timed out"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(5));

        cleanup_root(root);
    }

    // --- G2: clone source allowlist ---

    #[tokio::test]
    async fn read_capped_caps_and_flags_truncation() {
        let mut source: &[u8] = b"abcdefghij";
        let (buf, truncated) = read_capped(&mut source, 4).await.unwrap();
        assert_eq!(buf, b"abcd");
        assert!(truncated);

        let mut small: &[u8] = b"hi";
        let (buf, truncated) = read_capped(&mut small, 4).await.unwrap();
        assert_eq!(buf, b"hi");
        assert!(!truncated);
    }

    #[tokio::test]
    async fn run_git_capped_returns_output_for_quick_command() {
        let mut command = Command::new("sh");
        command.arg("-c").arg("printf hello");
        let result = run_git_capped(command, Duration::from_secs(10), MAX_GIT_OUTPUT_BYTES)
            .await
            .unwrap();
        assert!(result.ok);
        assert_eq!(result.stdout, "hello");
    }

    #[tokio::test]
    async fn run_git_capped_truncates_large_output() {
        let mut command = Command::new("sh");
        command.arg("-c").arg("yes aaaaaaaa | head -c 50000");
        let result = run_git_capped(command, Duration::from_secs(10), 1024)
            .await
            .unwrap();
        assert!(result.stdout.ends_with("[OUTPUT TRUNCATED]"));
        assert!(result.stdout.len() < 2048);
    }

    #[tokio::test]
    async fn run_git_capped_machine_rejects_truncated_protocol() {
        let mut command = Command::new("sh");
        command.arg("-c").arg("yes path | head -c 50000");
        let error = run_git_capped_machine(command, Duration::from_secs(10), 1024)
            .await
            .expect_err("machine protocol truncation must fail closed");
        assert!(error.contains("byte limit"), "{error}");
    }

    #[tokio::test]
    async fn run_git_capped_times_out_on_hung_process() {
        let mut command = Command::new("sh");
        command.arg("-c").arg("sleep 30");
        let started = std::time::Instant::now();
        let err = run_git_capped(command, Duration::from_millis(300), MAX_GIT_OUTPUT_BYTES)
            .await
            .unwrap_err();
        assert!(err.contains("timed out"));
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "timeout did not fire promptly"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn run_git_capped_reaps_background_hook_descendants() {
        use std::os::unix::fs::PermissionsExt;

        let root = git_root();
        let marker = root.join("hook-descendant-marker");
        let hook = root.join(".git/hooks/pre-commit");
        let marker_text = marker.to_string_lossy();
        std::fs::write(
            &hook,
            format!(
                "#!/bin/sh\n(sleep 2; printf leaked > '{}') &\nexit 0\n",
                marker_text.replace('\'', "'\\''")
            ),
        )
        .expect("write background hook");
        let mut permissions = std::fs::metadata(&hook)
            .expect("hook metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&hook, permissions).expect("make hook executable");
        std::fs::write(root.join("change.txt"), "change\n").expect("write staged change");
        fixture_git_ok(&root, &["add", "change.txt"]);

        let mut command = Command::new("git");
        command
            .args(["commit", "-m", "hook descendant fixture"])
            .current_dir(&root)
            .env_clear()
            .envs(scrubbed_git_env());
        let started = std::time::Instant::now();
        let result = run_git_capped(command, Duration::from_secs(10), MAX_GIT_OUTPUT_BYTES)
            .await
            .expect("run git with background hook");
        assert!(result.ok, "git commit failed: {}", result.stderr);
        assert!(
            started.elapsed() < Duration::from_millis(1_500),
            "Git result waited for inherited-pipe background child: {:?}",
            started.elapsed()
        );
        tokio::time::sleep(Duration::from_millis(2_200)).await;
        assert!(
            !marker.exists(),
            "background hook survived the dedicated Git process group"
        );

        cleanup_root(root);
    }
}
