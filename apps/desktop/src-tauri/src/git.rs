use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Runtime;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::task_workspace_binding::{
    resolve_task_workspace_claim_authority, resolve_task_workspace_evaluation_claim_authority,
    AuthorizedProcessCwd, AuthorizedWorkspaceRoot, TaskWorkspaceAccess, TaskWorkspaceBinding,
    TaskWorkspaceBindingClaim, TaskWorkspaceEvaluationLeaseClaim,
};

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
];

/// Blocked flags that could cause destructive operations.
const BLOCKED_FLAGS: &[&str] = &["--no-verify", "--force", "-f", "--hard", "--amend"];
const CLONE_USAGE: &str =
    "git clone is restricted to: clone --depth 1 [--branch ref] <url> <destination>";
const MAX_GIT_OUTPUT_BYTES: usize = 1024 * 1024;
/// Wall-clock bound on a single `git` invocation. A hung clone (stalled network,
/// credential prompt despite GIT_TERMINAL_PROMPT=0) is killed instead of blocking
/// the IPC handler forever.
const GIT_EXEC_TIMEOUT: Duration = Duration::from_secs(120);
static WORKSPACE_LEASE_MUTATION_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn lock_workspace_lease_mutation() -> tokio::sync::MutexGuard<'static, ()> {
    WORKSPACE_LEASE_MUTATION_LOCK.lock().await
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct FilesystemIdentity {
    #[serde(rename = "canonicalRoot")]
    canonical_path: String,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}

#[derive(Debug)]
struct RegisteredWorkspaceLease {
    lease_id: String,
    active_binding_id: String,
    child_run_id: String,
    branch: String,
    canonical_worktree: PathBuf,
    worktree_identity: FilesystemIdentity,
    project_identity: FilesystemIdentity,
    created_at_unix_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RegisteredWorkspaceProcessClaim {
    pub(crate) lease_id: String,
    pub(crate) registered_run_id: String,
    pub(crate) workspace_root: PathBuf,
    pub(crate) cwd: PathBuf,
    pub(crate) branch: String,
}

struct NewRegisteredWorkspaceLease<'a> {
    lease_id: &'a str,
    project_id: &'a str,
    binding_id: &'a str,
    root_run_id: &'a str,
    child_run_id: &'a str,
    request_id: &'a str,
    branch: &'a str,
    canonical_worktree: &'a Path,
    worktree_identity_json: &'a str,
    project_identity_json: &'a str,
    created_at_unix_ms: i64,
}

fn git_now_unix_ms() -> Result<i64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Read workspace lease clock: {error}"))?
        .as_millis();
    i64::try_from(millis).map_err(|_| "Workspace lease clock is out of range".to_string())
}

fn filesystem_identity(path: &Path) -> Result<FilesystemIdentity, String> {
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
struct GitExecutionScope {
    root_path: PathBuf,
    root_identity: FilesystemIdentity,
    cwd_path: PathBuf,
    cwd_relative: PathBuf,
    cwd_identity: FilesystemIdentity,
}

#[derive(Clone, Copy)]
enum GitTargetExpectation<'a> {
    Missing(&'a Path),
    Existing {
        path: &'a Path,
        identity: &'a FilesystemIdentity,
    },
}

impl GitExecutionScope {
    fn from_authority<A: GitRootAuthority + ?Sized>(
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

    fn from_expected(
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

    fn verify_live(&self) -> Result<(), String> {
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

    fn root_scope(&self) -> Result<Self, String> {
        Self::from_expected(
            &self.root_path,
            self.root_identity.clone(),
            &self.root_path,
            self.root_identity.clone(),
        )
    }

    fn with_live_cwd(&self, cwd: &Path) -> Result<Self, String> {
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

    fn bind_command(&self, command: &mut Command) -> Result<(), String> {
        self.bind_command_with_target(command, None)
    }

    fn bind_command_with_target(
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

impl RegisteredWorkspaceLease {
    fn root_scope(&self, canonical_root: &Path) -> Result<GitExecutionScope, String> {
        GitExecutionScope::from_expected(
            canonical_root,
            self.project_identity.clone(),
            canonical_root,
            self.project_identity.clone(),
        )
    }

    fn worktree_scope(&self, canonical_root: &Path) -> Result<GitExecutionScope, String> {
        GitExecutionScope::from_expected(
            canonical_root,
            self.project_identity.clone(),
            &self.canonical_worktree,
            self.worktree_identity.clone(),
        )
    }
}

fn sanitize_workspace_ref(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

fn expected_workspace_lease_branch(run_id: &str, lease_id: &str) -> String {
    format!(
        "offisim/lease/{}-{}",
        sanitize_workspace_ref(run_id),
        sanitize_workspace_ref(lease_id)
    )
}

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

#[derive(Debug, Serialize)]
pub struct GitResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Durable Task Board lifecycle projection. Capability-bearing identity records
/// and binding material deliberately stay behind the Rust boundary.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLeaseLifecycleRow {
    lease_id: String,
    project_id: String,
    thread_id: Option<String>,
    active_root_run_id: Option<String>,
    created_root_run_id: String,
    registered_run_id: String,
    workspace_root: Option<String>,
    cwd: String,
    branch: String,
    created_at: String,
    updated_at: String,
    status: String,
    owner_binding_status: Option<String>,
}

const MAX_WORKSPACE_LEASE_TERMINAL_PROJECTION_ROWS: i64 = 100;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum GitStdoutPolicy {
    HumanRedacted,
    MachineExact,
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
        _ => Err(format!("Git subcommand '{}' is not allowed", subcommand)),
    }
}

fn git_target_parent_scope(
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
    let worktree_add = if args.first().map(String::as_str) == Some("worktree")
        && args.get(1).map(String::as_str) == Some("add")
    {
        let destination = prepare_worktree_parent(&root_execution, &args).await?;
        let branch = args
            .get(3)
            .cloned()
            .ok_or_else(|| "git worktree add requires a branch".to_string())?;
        let (parent_execution, basename) =
            git_target_parent_scope(&root_execution, &destination, "git worktree destination")?;
        args[4] = basename;
        execution = parent_execution;
        guarded_target = Some((destination.clone(), None));
        authority.verify_git_root()?;
        Some((branch, destination))
    } else if args.first().map(String::as_str) == Some("worktree")
        && args.get(1).map(String::as_str) == Some("remove")
    {
        let target_arg = args
            .get(2)
            .ok_or_else(|| "git worktree remove requires a path".to_string())?;
        let target = resolve_new_path_under_root(root, target_arg, "git worktree path")?;
        let (parent_execution, basename) =
            git_target_parent_scope(&root_execution, &target, "git worktree removal target")?;
        let target_identity = match std::fs::symlink_metadata(&target) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
                Some(filesystem_identity(&target)?)
            }
            Ok(_) => return Err("git worktree removal target must be an ordinary directory".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(format!("Inspect git worktree removal target: {error}")),
        };
        args[2] = basename;
        execution = parent_execution;
        guarded_target = Some((target, target_identity));
        None
    } else {
        None
    };

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
    if let Some((branch, destination)) = worktree_add {
        if result.ok {
            if let Err(error) =
                validate_live_git_worktree(&root_execution, &destination, &branch).await
            {
                let rollback =
                    rollback_created_worktree(&root_execution, &destination, &branch).await;
                return Err(match rollback {
                    Ok(()) => format!("Post-create git worktree validation failed: {error}"),
                    Err(rollback_error) => format!(
                        "Post-create git worktree validation failed: {error}; rollback failed: {rollback_error}"
                    ),
                });
            }
        }
    }
    Ok(result)
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

#[tauri::command]
pub async fn git_exec<R: Runtime>(
    app: tauri::AppHandle<R>,
    args: Vec<String>,
    project_id: String,
    cwd: Option<String>,
    binding_claim: Option<TaskWorkspaceBindingClaim>,
    evaluation_lease: Option<TaskWorkspaceEvaluationLeaseClaim>,
) -> Result<GitResult, String> {
    if binding_claim.is_some() && evaluation_lease.is_some() {
        return Err("git_exec accepts bindingClaim or evaluationLease, never both".into());
    }
    if args.first().map(String::as_str) == Some("worktree") {
        return Err(
            "git worktree lifecycle requires a backend-registered workspace lease command".into(),
        );
    }
    let root_authority = if binding_claim.is_some() || evaluation_lease.is_some() {
        validate_binding_git_args(&args)?;
        if cwd.as_deref().is_some_and(|value| !value.is_empty()) {
            return Err(
                "task-workspace git status derives cwd from backend authority; omit cwd".into(),
            );
        }
        if let Some(lease) = evaluation_lease.as_ref() {
            resolve_task_workspace_evaluation_claim_authority(
                &app,
                lease,
                Some(&project_id),
                TaskWorkspaceAccess::Read,
            )
            .await?
        } else {
            let claim = binding_claim
                .as_ref()
                .ok_or_else(|| "task workspace authority is required".to_string())?;
            resolve_task_workspace_claim_authority(
                &app,
                claim,
                Some(&project_id),
                TaskWorkspaceAccess::Read,
            )
            .await?
        }
    } else {
        project_workspace_root(&app, &project_id).await?
    };
    let root = root_authority.git_root();
    let cwd_path = match cwd.as_deref().filter(|value| !value.is_empty()) {
        Some(value) => resolve_git_cwd(root, value)?,
        None => root.to_path_buf(),
    };
    run_git_validated(args, &root_authority, Some(&cwd_path)).await
}

fn validate_binding_git_args(args: &[String]) -> Result<(), String> {
    if args.first().map(String::as_str) != Some("status") {
        return Err("task workspace authority git lane is restricted to read-only status".into());
    }
    validate_status(args)
}

#[tauri::command]
pub async fn workspace_lease_list<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
) -> Result<Vec<WorkspaceLeaseLifecycleRow>, String> {
    if project_id.trim().is_empty() {
        return Err("workspace_lease_list requires a Project id".into());
    }
    let pool = crate::local_db::get_offisim_pool(&app)?;
    workspace_lease_list_from_pool(&pool, &project_id).await
}

#[tauri::command]
pub async fn workspace_lease_discard<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
    lease_id: String,
    path: String,
) -> Result<(), String> {
    close_registered_workspace_lease_for_project(
        &app,
        &project_id,
        &lease_id,
        Path::new(&path),
        "discarded",
    )
    .await
}

#[tauri::command]
pub async fn workspace_lease_release<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
    lease_id: String,
    path: String,
) -> Result<(), String> {
    close_registered_workspace_lease_for_project(
        &app,
        &project_id,
        &lease_id,
        Path::new(&path),
        "released",
    )
    .await
}

#[tauri::command]
pub async fn workspace_lease_changed<R: Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
    lease_id: String,
    path: String,
) -> Result<bool, String> {
    registered_workspace_lease_changed_for_project(&app, &project_id, &lease_id, Path::new(&path))
        .await
}

/// G3: spawn git, stream stdout/stderr each capped at `max_bytes` (so a flood
/// cannot balloon memory before truncation), and bound the whole run by `timeout`
/// with `kill_on_drop` so a hung process is terminated rather than blocking.
fn configure_git_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
}

fn signal_git_process_group(process_group_id: Option<u32>, signal: i32) {
    #[cfg(unix)]
    if let Some(pid) = process_group_id {
        // SAFETY: run_git_capped assigns every child to its own process group.
        unsafe {
            libc::kill(-(pid as i32), signal);
        }
    }
    #[cfg(not(unix))]
    let _ = (process_group_id, signal);
}

struct GitProcessGroupGuard(Option<u32>);

impl GitProcessGroupGuard {
    fn disarm(&mut self) {
        self.0 = None;
    }
}

impl Drop for GitProcessGroupGuard {
    fn drop(&mut self) {
        #[cfg(unix)]
        signal_git_process_group(self.0, libc::SIGKILL);
    }
}

async fn terminate_git_process_group(
    child: &mut tokio::process::Child,
    process_group_id: Option<u32>,
) {
    #[cfg(unix)]
    signal_git_process_group(process_group_id, libc::SIGTERM);
    let reaped = matches!(
        tokio::time::timeout(Duration::from_millis(500), child.wait()).await,
        Ok(Ok(_))
    );
    #[cfg(unix)]
    signal_git_process_group(process_group_id, libc::SIGKILL);
    if !reaped {
        let _ = child.start_kill();
        let _ = child.wait().await;
    }
}

async fn run_git_capped(
    command: Command,
    timeout: Duration,
    max_bytes: usize,
) -> Result<GitResult, String> {
    run_git_capped_with_stdout_policy(command, timeout, max_bytes, GitStdoutPolicy::HumanRedacted)
        .await
}

async fn run_git_capped_machine(
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
    configure_git_process_group(&mut command);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to execute git: {}", e))?;
    let process_group_id = child.id();
    let mut process_group_guard = GitProcessGroupGuard(process_group_id);
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
            terminate_git_process_group(&mut child, process_group_id).await;
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
            terminate_git_process_group(&mut child, process_group_id).await;
            results.map_err(|error| format!("git output drain task failed: {error}"))?
        }
        Err(_) => {
            terminate_git_process_group(&mut child, process_group_id).await;
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

fn scrubbed_git_env() -> Vec<(String, String)> {
    // Git lane extends the shared base allowlist with SSH_AUTH_SOCK (for
    // ssh-agent-backed remotes) and pins GIT_TERMINAL_PROMPT=0. The base set
    // and the scan mechanism are shared via `crate::redaction`; the git-only
    // extras stay here so the policies are not unified into a superset.
    let mut allow = crate::redaction::BASE_ENV_ALLOWLIST.to_vec();
    allow.push("SSH_AUTH_SOCK");
    let mut env = crate::redaction::scrub_env_to_allowlist(&allow);
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
fn create_directory_chain_without_symlinks(root: &Path, target: &Path) -> Result<(), String> {
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
fn create_directory_chain_without_symlinks(root: &Path, target: &Path) -> Result<(), String> {
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

fn git_line_record<'a>(output: &'a str, label: &str) -> Result<&'a str, String> {
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

fn is_full_git_sha(value: &str) -> bool {
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

async fn validate_push_context(
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

async fn run_git_probe_scoped(
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

async fn capture_branch_object_id(
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

async fn delete_branch_if_unchanged(
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
async fn run_git_probe_with_timeout(
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

async fn validate_live_git_worktree(
    execution: &GitExecutionScope,
    worktree: &Path,
    branch: &str,
) -> Result<PathBuf, String> {
    validate_live_git_worktree_with_identity(execution, worktree, branch, None).await
}

async fn validate_live_git_worktree_with_identity(
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

async fn rollback_created_worktree_with_expected_identity(
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

async fn rollback_created_worktree_for_binding(
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

/// Returns `Ok(false)` only while the ordered `run.started` event has not yet
/// become visible in SQLite. Once a row exists, every scope/provenance field is
/// validated strictly; a mismatched row is never treated as eventual
/// consistency and never retried.
async fn validate_workspace_lease_agent_run_from_pool(
    pool: &SqlitePool,
    company_id: &str,
    project_id: &str,
    thread_id: &str,
    root_run_id: &str,
    child_run_id: &str,
) -> Result<bool, String> {
    let row = sqlx::query(
        r#"
        SELECT
          child.company_id AS child_company_id,
          child.project_id AS child_project_id,
          child.thread_id AS child_thread_id,
          child.parent_run_id AS child_parent_run_id,
          child.root_run_id AS child_root_run_id,
          child.status AS child_status,
          root.run_id AS root_run_id,
          root.company_id AS root_company_id,
          root.project_id AS root_project_id,
          root.thread_id AS root_thread_id,
          root.parent_run_id AS root_parent_run_id,
          root.root_run_id AS root_root_run_id,
          root.status AS root_status
        FROM agent_runs child
        LEFT JOIN agent_runs root ON root.run_id = child.root_run_id
        WHERE child.run_id = ?
        "#,
    )
    .bind(child_run_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Validate workspace lease agent run provenance: {error}"))?;
    let Some(row) = row else {
        return Ok(false);
    };

    let child_company_id: String = row
        .try_get("child_company_id")
        .map_err(|error| format!("Decode workspace lease child company: {error}"))?;
    let child_project_id: Option<String> = row
        .try_get("child_project_id")
        .map_err(|error| format!("Decode workspace lease child Project: {error}"))?;
    let child_thread_id: String = row
        .try_get("child_thread_id")
        .map_err(|error| format!("Decode workspace lease child Conversation: {error}"))?;
    let child_parent_run_id: Option<String> = row
        .try_get("child_parent_run_id")
        .map_err(|error| format!("Decode workspace lease child parent: {error}"))?;
    let child_root_run_id: String = row
        .try_get("child_root_run_id")
        .map_err(|error| format!("Decode workspace lease child root: {error}"))?;
    let child_status: String = row
        .try_get("child_status")
        .map_err(|error| format!("Decode workspace lease child status: {error}"))?;
    let durable_root_run_id: Option<String> = row
        .try_get("root_run_id")
        .map_err(|error| format!("Decode workspace lease root id: {error}"))?;
    let root_company_id: Option<String> = row
        .try_get("root_company_id")
        .map_err(|error| format!("Decode workspace lease root company: {error}"))?;
    let root_project_id: Option<String> = row
        .try_get("root_project_id")
        .map_err(|error| format!("Decode workspace lease root Project: {error}"))?;
    let root_thread_id: Option<String> = row
        .try_get("root_thread_id")
        .map_err(|error| format!("Decode workspace lease root Conversation: {error}"))?;
    let root_parent_run_id: Option<String> = row
        .try_get("root_parent_run_id")
        .map_err(|error| format!("Decode workspace lease root parent: {error}"))?;
    let root_root_run_id: Option<String> = row
        .try_get("root_root_run_id")
        .map_err(|error| format!("Decode workspace lease root provenance: {error}"))?;
    let root_status: Option<String> = row
        .try_get("root_status")
        .map_err(|error| format!("Decode workspace lease root status: {error}"))?;

    let exact_scope = child_company_id == company_id
        && child_project_id.as_deref() == Some(project_id)
        && child_thread_id == thread_id
        && child_parent_run_id
            .as_deref()
            .is_some_and(|value| !value.is_empty())
        && child_run_id != root_run_id
        && child_root_run_id == root_run_id
        && child_status == "running"
        && durable_root_run_id.as_deref() == Some(root_run_id)
        && root_company_id.as_deref() == Some(company_id)
        && root_project_id.as_deref() == Some(project_id)
        && root_thread_id.as_deref() == Some(thread_id)
        && root_parent_run_id.is_none()
        && root_root_run_id.as_deref() == Some(root_run_id)
        && root_status.as_deref() == Some("running");
    if !exact_scope {
        return Err(
            "Workspace lease agent run provenance does not match the active task workspace binding"
                .into(),
        );
    }
    Ok(true)
}

async fn wait_for_workspace_lease_agent_run_from_pool(
    pool: &SqlitePool,
    binding: &TaskWorkspaceBinding,
    child_run_id: &str,
) -> Result<(), String> {
    const VISIBILITY_TIMEOUT: Duration = Duration::from_secs(2);
    const VISIBILITY_POLL: Duration = Duration::from_millis(25);
    let deadline = tokio::time::Instant::now() + VISIBILITY_TIMEOUT;
    loop {
        if validate_workspace_lease_agent_run_from_pool(
            pool,
            &binding.company_id,
            &binding.project_id,
            &binding.thread_id,
            &binding.turn_id,
            child_run_id,
        )
        .await?
        {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(
                "Workspace lease child run was not durably visible before registration timeout"
                    .into(),
            );
        }
        tokio::time::sleep(VISIBILITY_POLL).await;
    }
}

pub(crate) async fn register_task_workspace_lease<R: Runtime>(
    app: &tauri::AppHandle<R>,
    binding: &TaskWorkspaceBinding,
    lease_id: &str,
    child_run_id: &str,
    branch: &str,
    path: &Path,
) -> Result<PathBuf, String> {
    let execution = GitExecutionScope::from_authority(binding, &binding.canonical_root)?;
    let requested = validate_new_workspace_lease_request(
        &binding.canonical_root,
        lease_id,
        child_run_id,
        branch,
        path.to_string_lossy().as_ref(),
    )?;
    let prepared = async {
        execution.verify_live()?;
        let canonical_worktree = validate_live_git_worktree(&execution, &requested, branch).await?;
        let worktree_identity = filesystem_identity(&canonical_worktree)?;
        let worktree_identity_json = serde_json::to_string(&worktree_identity)
            .map_err(|error| format!("Encode workspace lease identity: {error}"))?;
        let project_identity_json = binding.expected_root_identity_json()?;
        let canonical_worktree_text = canonical_worktree
            .to_str()
            .ok_or_else(|| "Workspace lease path is not valid UTF-8".to_string())?
            .to_string();
        let now = git_now_unix_ms()?;
        let pool = crate::local_db::get_offisim_pool(app)?;
        wait_for_workspace_lease_agent_run_from_pool(&pool, binding, child_run_id).await?;
        execution.verify_live()?;
        Ok::<_, String>((
            canonical_worktree,
            canonical_worktree_text,
            worktree_identity_json,
            project_identity_json,
            now,
            pool,
        ))
    }
    .await;
    let (
        canonical_worktree,
        canonical_worktree_text,
        worktree_identity_json,
        project_identity_json,
        now,
        pool,
    ) = match prepared {
        Ok(value) => value,
        Err(error) => {
            let rollback = rollback_created_worktree_for_binding(binding, &requested, branch).await;
            return Err(match rollback {
                Ok(()) => error,
                Err(rollback_error) => {
                    format!("{error}; rollback failed: {rollback_error}")
                }
            });
        }
    };
    persist_task_workspace_lease_registration(
        &pool,
        &binding.canonical_root,
        NewRegisteredWorkspaceLease {
            lease_id,
            project_id: &binding.project_id,
            binding_id: &binding.binding_id,
            root_run_id: &binding.turn_id,
            child_run_id,
            request_id: &binding.request_id,
            branch,
            canonical_worktree: &canonical_worktree,
            worktree_identity_json: &worktree_identity_json,
            project_identity_json: &project_identity_json,
            created_at_unix_ms: now,
        },
    )
    .await?;
    execution.verify_live()?;
    Ok(PathBuf::from(canonical_worktree_text))
}

async fn persist_task_workspace_lease_registration(
    pool: &SqlitePool,
    canonical_root: &Path,
    registration: NewRegisteredWorkspaceLease<'_>,
) -> Result<(), String> {
    let canonical_worktree_text = registration
        .canonical_worktree
        .to_str()
        .ok_or_else(|| "Workspace lease path is not valid UTF-8".to_string())?;
    let inserted = sqlx::query(
        r#"
        INSERT INTO task_workspace_lease_history (
          lease_id, project_id, created_binding_id, active_binding_id,
          created_root_run_id, child_run_id, created_request_id, branch,
          canonical_worktree, worktree_identity_json, project_root_identity_json,
          created_at_unix_ms, updated_at_unix_ms, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
        "#,
    )
    .bind(registration.lease_id)
    .bind(registration.project_id)
    .bind(registration.binding_id)
    .bind(registration.binding_id)
    .bind(registration.root_run_id)
    .bind(registration.child_run_id)
    .bind(registration.request_id)
    .bind(registration.branch)
    .bind(canonical_worktree_text)
    .bind(registration.worktree_identity_json)
    .bind(registration.project_identity_json)
    .bind(registration.created_at_unix_ms)
    .bind(registration.created_at_unix_ms)
    .execute(pool)
    .await;
    if let Err(error) = inserted {
        let rollback = rollback_created_worktree_with_expected_identity(
            canonical_root,
            registration.canonical_worktree,
            registration.branch,
            registration.project_identity_json,
        )
        .await;
        return Err(match rollback {
            Ok(()) => format!("Register workspace lease: {error}"),
            Err(rollback_error) => {
                format!("Register workspace lease: {error}; rollback failed: {rollback_error}")
            }
        });
    }
    Ok(())
}

async fn invalidate_registered_workspace_lease(
    pool: &SqlitePool,
    project_id: &str,
    lease_id: &str,
    cause: String,
) -> String {
    let now = match git_now_unix_ms() {
        Ok(now) => now,
        Err(error) => return format!("{cause}; mark workspace lease invalid: {error}"),
    };
    match sqlx::query(
        "UPDATE task_workspace_lease_history SET status = 'invalid', updated_at_unix_ms = ? WHERE lease_id = ? AND project_id = ? AND status = 'active'",
    )
    .bind(now)
    .bind(lease_id)
    .bind(project_id)
    .execute(pool)
    .await
    {
        Ok(result) if result.rows_affected() == 1 => cause,
        Ok(_) => format!(
            "{cause}; mark workspace lease invalid: active registration changed concurrently"
        ),
        Err(error) => format!("{cause}; mark workspace lease invalid: {error}"),
    }
}

async fn load_registered_workspace_lease_from_pool(
    pool: &SqlitePool,
    project_id: &str,
    canonical_root: &Path,
    lease_id: &str,
    expected_path: Option<&Path>,
    expected_branch: Option<&str>,
    expected_binding_id: Option<&str>,
) -> Result<RegisteredWorkspaceLease, String> {
    let row = sqlx::query(
        r#"
        SELECT lease_id, project_id, active_binding_id, child_run_id, branch,
               canonical_worktree, worktree_identity_json,
               project_root_identity_json, created_at_unix_ms, status
        FROM task_workspace_lease_history
        WHERE lease_id = ? AND project_id = ?
        "#,
    )
    .bind(lease_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Read workspace lease registration: {error}"))?
    .ok_or_else(|| "Workspace lease is not registered for this Project".to_string())?;
    let status: String = row
        .try_get("status")
        .map_err(|error| format!("Decode workspace lease status: {error}"))?;
    if status != "active" {
        return Err(format!("Workspace lease is no longer active ({status})"));
    }
    let active_binding_id: String = row
        .try_get("active_binding_id")
        .map_err(|error| format!("Decode workspace lease binding: {error}"))?;
    if expected_binding_id.is_some_and(|expected| active_binding_id != expected) {
        return Err("Workspace lease belongs to a different active task binding".into());
    }
    let branch: String = row
        .try_get("branch")
        .map_err(|error| format!("Decode workspace lease branch: {error}"))?;
    if expected_branch.is_some_and(|expected| expected != branch) {
        return Err("Workspace lease branch does not match its registration".into());
    }
    let canonical_worktree_text: String = row
        .try_get("canonical_worktree")
        .map_err(|error| format!("Decode workspace lease path: {error}"))?;
    let canonical_worktree = PathBuf::from(&canonical_worktree_text);
    if expected_path.is_some_and(|expected| expected != canonical_worktree) {
        return Err("Workspace lease cwd does not match its registration".into());
    }
    let stored_worktree_identity: String = row
        .try_get("worktree_identity_json")
        .map_err(|error| format!("Decode workspace lease identity: {error}"))?;
    let stored_worktree_identity: FilesystemIdentity =
        match serde_json::from_str(&stored_worktree_identity) {
            Ok(identity) => identity,
            Err(error) => {
                return Err(invalidate_registered_workspace_lease(
                    pool,
                    project_id,
                    lease_id,
                    format!("Workspace lease identity record is invalid: {error}"),
                )
                .await);
            }
        };
    let stored_project_identity: String = row
        .try_get("project_root_identity_json")
        .map_err(|error| format!("Decode workspace Project identity: {error}"))?;
    let stored_project_identity: FilesystemIdentity =
        match serde_json::from_str(&stored_project_identity) {
            Ok(identity) => identity,
            Err(error) => {
                return Err(invalidate_registered_workspace_lease(
                    pool,
                    project_id,
                    lease_id,
                    format!("Workspace lease Project identity record is invalid: {error}"),
                )
                .await);
            }
        };
    let actual_worktree_identity = match filesystem_identity(&canonical_worktree) {
        Ok(identity) => identity,
        Err(error) => {
            return Err(invalidate_registered_workspace_lease(
                pool,
                project_id,
                lease_id,
                format!("Workspace lease filesystem is unavailable: {error}"),
            )
            .await);
        }
    };
    let actual_project_identity = match filesystem_identity(canonical_root) {
        Ok(identity) => identity,
        Err(error) => {
            return Err(invalidate_registered_workspace_lease(
                pool,
                project_id,
                lease_id,
                format!("Workspace lease Project filesystem is unavailable: {error}"),
            )
            .await);
        }
    };
    if actual_worktree_identity != stored_worktree_identity
        || actual_project_identity != stored_project_identity
    {
        return Err(invalidate_registered_workspace_lease(
            pool,
            project_id,
            lease_id,
            "Workspace lease filesystem identity changed after registration".into(),
        )
        .await);
    }
    let root_execution = match GitExecutionScope::from_expected(
        canonical_root,
        stored_project_identity.clone(),
        canonical_root,
        stored_project_identity.clone(),
    ) {
        Ok(execution) => execution,
        Err(error) => {
            return Err(invalidate_registered_workspace_lease(
                pool,
                project_id,
                lease_id,
                format!("Workspace lease Project authority is invalid: {error}"),
            )
            .await);
        }
    };
    let canonical_worktree = match validate_live_git_worktree_with_identity(
        &root_execution,
        &canonical_worktree,
        &branch,
        Some(&stored_worktree_identity),
    )
    .await
    {
        Ok(path) => path,
        Err(error) => {
            return Err(invalidate_registered_workspace_lease(
                pool,
                project_id,
                lease_id,
                format!("Workspace lease Git registration is invalid: {error}"),
            )
            .await);
        }
    };
    Ok(RegisteredWorkspaceLease {
        lease_id: row
            .try_get("lease_id")
            .map_err(|error| format!("Decode workspace lease id: {error}"))?,
        active_binding_id,
        child_run_id: row
            .try_get("child_run_id")
            .map_err(|error| format!("Decode workspace lease run id: {error}"))?,
        branch,
        canonical_worktree,
        worktree_identity: stored_worktree_identity,
        project_identity: stored_project_identity,
        created_at_unix_ms: row
            .try_get("created_at_unix_ms")
            .map_err(|error| format!("Decode workspace lease created time: {error}"))?,
    })
}

async fn read_workspace_lease_projection_rows(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<Vec<WorkspaceLeaseLifecycleRow>, String> {
    let rows = sqlx::query(
        r#"
        SELECT lease.lease_id,
               lease.project_id,
               owner.thread_id,
               owner.turn_id AS active_root_run_id,
               lease.created_root_run_id,
               lease.child_run_id AS registered_run_id,
               owner.canonical_root AS workspace_root,
               lease.canonical_worktree AS cwd,
               lease.branch,
               lease.created_at_unix_ms AS created_at,
               lease.updated_at_unix_ms AS updated_at,
               lease.status,
               owner.status AS owner_binding_status
        FROM task_workspace_lease_history AS lease
        LEFT JOIN task_workspace_binding_history AS owner
          ON owner.binding_id = lease.active_binding_id
         AND owner.project_id = lease.project_id
        WHERE lease.project_id = ?
          AND (
            lease.status = 'active'
            OR lease.lease_id IN (
              SELECT recent.lease_id
              FROM task_workspace_lease_history AS recent
              WHERE recent.project_id = ?
                AND recent.status <> 'active'
              ORDER BY recent.updated_at_unix_ms DESC, recent.lease_id ASC
              LIMIT ?
            )
          )
        ORDER BY lease.updated_at_unix_ms DESC, lease.lease_id ASC
        "#,
    )
    .bind(project_id)
    .bind(project_id)
    .bind(MAX_WORKSPACE_LEASE_TERMINAL_PROJECTION_ROWS)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Read workspace lease lifecycle projection: {error}"))?;

    rows.into_iter()
        .map(|row| {
            Ok(WorkspaceLeaseLifecycleRow {
                lease_id: row
                    .try_get("lease_id")
                    .map_err(|error| format!("Decode workspace lease id: {error}"))?,
                project_id: row
                    .try_get("project_id")
                    .map_err(|error| format!("Decode workspace lease Project: {error}"))?,
                thread_id: row
                    .try_get("thread_id")
                    .map_err(|error| format!("Decode workspace lease Conversation: {error}"))?,
                active_root_run_id: row
                    .try_get("active_root_run_id")
                    .map_err(|error| format!("Decode workspace lease active root run: {error}"))?,
                created_root_run_id: row
                    .try_get("created_root_run_id")
                    .map_err(|error| format!("Decode workspace lease created root run: {error}"))?,
                registered_run_id: row
                    .try_get("registered_run_id")
                    .map_err(|error| format!("Decode workspace lease registered run: {error}"))?,
                workspace_root: row
                    .try_get("workspace_root")
                    .map_err(|error| format!("Decode workspace lease root: {error}"))?,
                cwd: row
                    .try_get("cwd")
                    .map_err(|error| format!("Decode workspace lease cwd: {error}"))?,
                branch: row
                    .try_get("branch")
                    .map_err(|error| format!("Decode workspace lease branch: {error}"))?,
                created_at: unix_ms_to_rfc3339(
                    row.try_get("created_at")
                        .map_err(|error| format!("Decode workspace lease created time: {error}"))?,
                ),
                updated_at: unix_ms_to_rfc3339(
                    row.try_get("updated_at")
                        .map_err(|error| format!("Decode workspace lease updated time: {error}"))?,
                ),
                status: row
                    .try_get("status")
                    .map_err(|error| format!("Decode workspace lease status: {error}"))?,
                owner_binding_status: row
                    .try_get("owner_binding_status")
                    .map_err(|error| format!("Decode workspace lease owner status: {error}"))?,
            })
        })
        .collect()
}

async fn workspace_lease_list_from_pool(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<Vec<WorkspaceLeaseLifecycleRow>, String> {
    read_workspace_lease_projection_rows(pool, project_id).await
}

async fn load_registered_workspace_lease<R: Runtime>(
    app: &tauri::AppHandle<R>,
    binding: &TaskWorkspaceBinding,
    lease_id: &str,
    expected_path: Option<&Path>,
    expected_branch: Option<&str>,
    require_current_binding: bool,
) -> Result<RegisteredWorkspaceLease, String> {
    let pool = crate::local_db::get_offisim_pool(app)?;
    load_registered_workspace_lease_from_pool(
        &pool,
        &binding.project_id,
        &binding.canonical_root,
        lease_id,
        expected_path,
        expected_branch,
        require_current_binding.then_some(binding.binding_id.as_str()),
    )
    .await
}

fn civil_from_days(days_since_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year as i32, month as u32, day as u32)
}

fn unix_ms_to_rfc3339(unix_ms: i64) -> String {
    let seconds = unix_ms.div_euclid(1_000);
    let millis = unix_ms.rem_euclid(1_000);
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

fn required_json_string<'a>(value: &'a serde_json::Value, field: &str) -> Result<&'a str, String> {
    value
        .get(field)
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Direct delegation resume lease requires {field}"))
}

pub(crate) async fn authorize_direct_delegation<R: Runtime>(
    app: &tauri::AppHandle<R>,
    binding: &TaskWorkspaceBinding,
    direct_delegation: Option<&serde_json::Value>,
) -> Result<Option<serde_json::Value>, String> {
    let Some(direct_delegation) = direct_delegation else {
        return Ok(None);
    };
    let mut authorized = direct_delegation.clone();
    let Some(resume_lease) = direct_delegation.get("resumeLease") else {
        return Ok(Some(authorized));
    };
    // Adoption and destructive cleanup must be one mutation lane. Otherwise a
    // Project-level Discard can remove a worktree after a new binding adopts it
    // but before cleanup observes the new active_binding_id.
    let _cleanup_guard = lock_workspace_lease_mutation().await;
    if binding.access != TaskWorkspaceAccess::Write {
        return Err("A read-only task binding cannot adopt a writable workspace lease".into());
    }
    if direct_delegation
        .get("access")
        .and_then(serde_json::Value::as_str)
        != Some("write")
    {
        return Err("Only a writable direct delegation can adopt a workspace lease".into());
    }
    let lease_id = required_json_string(resume_lease, "leaseId")?;
    let child_run_id = required_json_string(resume_lease, "runId")?;
    let renderer_root = required_json_string(resume_lease, "workspaceRoot")?;
    let renderer_cwd = required_json_string(resume_lease, "cwd")?;
    let renderer_branch = required_json_string(resume_lease, "branch")?;
    let origin_run_id = required_json_string(direct_delegation, "originRunId")?;
    if origin_run_id != child_run_id {
        return Err("Direct delegation originRunId does not match the registered lease run".into());
    }
    let canonical_root = binding
        .canonical_root
        .canonicalize()
        .map_err(|error| format!("Resolve direct delegation Project workspace: {error}"))?;
    if Path::new(renderer_root) != canonical_root {
        return Err(
            "Direct delegation resume workspaceRoot does not match backend authority".into(),
        );
    }
    let expected_cwd = validate_new_workspace_lease_request(
        &canonical_root,
        lease_id,
        child_run_id,
        renderer_branch,
        renderer_cwd,
    )?;
    let lease = load_registered_workspace_lease(
        app,
        binding,
        lease_id,
        Some(&expected_cwd),
        Some(renderer_branch),
        false,
    )
    .await?;
    if lease.child_run_id != child_run_id
        || lease.branch != renderer_branch
        || lease.lease_id != lease_id
    {
        return Err("Direct delegation resume lease provenance does not match registration".into());
    }

    let pool = crate::local_db::get_offisim_pool(app)?;
    if lease.active_binding_id != binding.binding_id {
        let previous_status: Option<String> = sqlx::query_scalar(
            "SELECT status FROM task_workspace_binding_history WHERE binding_id = ?",
        )
        .bind(&lease.active_binding_id)
        .fetch_optional(&pool)
        .await
        .map_err(|error| format!("Read previous workspace lease binding: {error}"))?;
        match previous_status.as_deref() {
            Some("active") => {
                return Err("Workspace lease is still owned by another active task run".into());
            }
            Some(_) => {}
            None => {
                return Err(
                    "Workspace lease previous binding history is missing; adoption is denied"
                        .into(),
                );
            }
        }
        let updated = sqlx::query(
            "UPDATE task_workspace_lease_history SET active_binding_id = ?, updated_at_unix_ms = ? WHERE lease_id = ? AND active_binding_id = ? AND status = 'active'",
        )
        .bind(&binding.binding_id)
        .bind(git_now_unix_ms()?)
        .bind(&lease.lease_id)
        .bind(&lease.active_binding_id)
        .execute(&pool)
        .await
        .map_err(|error| format!("Adopt workspace lease binding: {error}"))?;
        if updated.rows_affected() != 1 {
            return Err("Workspace lease ownership changed during adoption".into());
        }
    }

    let authorized_resume = serde_json::json!({
        "leaseId": lease.lease_id,
        "runId": lease.child_run_id,
        "workspaceRoot": canonical_root.to_string_lossy(),
        "cwd": lease.canonical_worktree.to_string_lossy(),
        "branch": lease.branch,
        "createdAt": unix_ms_to_rfc3339(lease.created_at_unix_ms),
    });
    authorized
        .as_object_mut()
        .ok_or_else(|| "Direct delegation must be an object".to_string())?
        .insert("resumeLease".into(), authorized_resume);
    Ok(Some(authorized))
}

pub(crate) async fn require_registered_workspace_lease<R: Runtime>(
    app: &tauri::AppHandle<R>,
    binding: &TaskWorkspaceBinding,
    path: &Path,
) -> Result<PathBuf, String> {
    let lease_id = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Workspace lease cwd has no valid lease id".to_string())?;
    let expected = binding
        .canonical_root
        .join(".offisim")
        .join("worktrees")
        .join(lease_id);
    if path != expected {
        return Err("Workspace lease cwd is outside the registered lease jail".into());
    }
    load_registered_workspace_lease(app, binding, lease_id, Some(&expected), None, true)
        .await
        .map(|lease| lease.canonical_worktree)
}

/// Resolve a registered worktree into an exact process authority. The returned
/// scope carries the durable device/inode stored when the lease was created;
/// it never recaptures authority from a same-path replacement.
fn expected_registered_workspace_process_cwd(
    canonical_root: &Path,
    claim: &RegisteredWorkspaceProcessClaim,
) -> Result<PathBuf, String> {
    if claim.workspace_root != canonical_root {
        return Err("Workspace lease Project root does not match the task binding".into());
    }
    let cwd_text = claim
        .cwd
        .to_str()
        .ok_or_else(|| "Workspace lease cwd is not valid UTF-8".to_string())?;
    let expected = validate_new_workspace_lease_request(
        canonical_root,
        &claim.lease_id,
        &claim.registered_run_id,
        &claim.branch,
        cwd_text,
    )?;
    if claim.cwd != expected {
        return Err("Workspace lease cwd does not match its exact registered jail".into());
    }
    Ok(expected)
}

fn validate_registered_workspace_process_claim(
    canonical_root: &Path,
    lease: &RegisteredWorkspaceLease,
    claim: &RegisteredWorkspaceProcessClaim,
) -> Result<PathBuf, String> {
    let expected = expected_registered_workspace_process_cwd(canonical_root, claim)?;
    if lease.lease_id != claim.lease_id
        || lease.child_run_id != claim.registered_run_id
        || lease.branch != claim.branch
        || lease.canonical_worktree != claim.cwd
    {
        return Err(
            "Workspace lease execution claim does not match its active registration".into(),
        );
    }
    Ok(expected)
}

pub(crate) async fn resolve_registered_workspace_process_cwd_exact<R: Runtime>(
    app: &tauri::AppHandle<R>,
    binding: &TaskWorkspaceBinding,
    claim: &RegisteredWorkspaceProcessClaim,
) -> Result<AuthorizedProcessCwd, String> {
    let expected = expected_registered_workspace_process_cwd(&binding.canonical_root, claim)?;
    let lease = load_registered_workspace_lease(
        app,
        binding,
        &claim.lease_id,
        Some(&expected),
        Some(&claim.branch),
        true,
    )
    .await?;
    validate_registered_workspace_process_claim(&binding.canonical_root, &lease, claim)?;
    let authority = binding.authorized_root();
    #[cfg(unix)]
    {
        AuthorizedProcessCwd::from_expected(
            &authority,
            &lease.canonical_worktree,
            lease.worktree_identity.device,
            lease.worktree_identity.inode,
        )
    }
    #[cfg(not(unix))]
    {
        AuthorizedProcessCwd::from_expected(&authority, &lease.canonical_worktree)
    }
}

pub(crate) async fn require_registered_workspace_lease_branch<R: Runtime>(
    app: &tauri::AppHandle<R>,
    binding: &TaskWorkspaceBinding,
    branch: &str,
) -> Result<PathBuf, String> {
    let pool = crate::local_db::get_offisim_pool(app)?;
    let lease_id: String = sqlx::query_scalar(
        "SELECT lease_id FROM task_workspace_lease_history WHERE project_id = ? AND branch = ? AND active_binding_id = ? AND status = 'active'",
    )
    .bind(&binding.project_id)
    .bind(branch)
    .bind(&binding.binding_id)
    .fetch_optional(&pool)
    .await
    .map_err(|error| format!("Read workspace lease branch registration: {error}"))?
    .ok_or_else(|| "Workspace lease branch is not registered to this task binding".to_string())?;
    load_registered_workspace_lease(app, binding, &lease_id, None, Some(branch), true)
        .await
        .map(|lease| lease.canonical_worktree)
}

async fn registered_workspace_lease_has_changes(
    lease: &RegisteredWorkspaceLease,
    root_execution: &GitExecutionScope,
    worktree_execution: &GitExecutionScope,
) -> Result<bool, String> {
    let mut status = Command::new("git");
    status
        .args(["status", "--porcelain=v1", "-z"])
        .env_clear()
        .envs(scrubbed_git_env());
    worktree_execution.bind_command(&mut status)?;
    let status = run_git_capped_machine(status, GIT_EXEC_TIMEOUT, MAX_GIT_OUTPUT_BYTES).await?;
    worktree_execution.verify_live()?;
    if !status.ok {
        return Err(workspace_lease_command_error(
            status,
            "Inspect registered worktree changes",
        ));
    }
    if !status.stdout.is_empty() {
        return Ok(true);
    }

    let mut unmerged = Command::new("git");
    unmerged
        .args(["rev-list", "--count"])
        .arg(&lease.branch)
        .args(["--not", "HEAD"])
        .env_clear()
        .envs(scrubbed_git_env());
    root_execution.bind_command(&mut unmerged)?;
    let unmerged = run_git_capped_machine(unmerged, GIT_EXEC_TIMEOUT, MAX_GIT_OUTPUT_BYTES).await?;
    root_execution.verify_live()?;
    if !unmerged.ok {
        return Err(workspace_lease_command_error(
            unmerged,
            "Inspect registered branch integration",
        ));
    }
    let count = unmerged
        .stdout
        .trim()
        .parse::<u64>()
        .map_err(|error| format!("Decode registered branch integration count: {error}"))?;
    Ok(count > 0)
}

async fn registered_workspace_lease_has_changes_checked(
    pool: &SqlitePool,
    project_id: &str,
    lease: &RegisteredWorkspaceLease,
    root_execution: &GitExecutionScope,
    worktree_execution: &GitExecutionScope,
) -> Result<bool, String> {
    match registered_workspace_lease_has_changes(lease, root_execution, worktree_execution).await {
        Ok(changed) => Ok(changed),
        Err(error) => match root_execution
            .verify_live()
            .and_then(|_| worktree_execution.verify_live())
        {
            Ok(()) => Err(error),
            Err(authority_error) => Err(invalidate_registered_workspace_lease(
                pool,
                project_id,
                &lease.lease_id,
                format!(
                    "Workspace lease authority changed during Git status: {authority_error}; {error}"
                ),
            )
            .await),
        },
    }
}

async fn registered_workspace_lease_scopes(
    pool: &SqlitePool,
    project_id: &str,
    canonical_root: &Path,
    lease: &RegisteredWorkspaceLease,
) -> Result<(GitExecutionScope, GitExecutionScope), String> {
    let scopes = lease.root_scope(canonical_root).and_then(|root| {
        lease
            .worktree_scope(canonical_root)
            .map(|worktree| (root, worktree))
    });
    match scopes {
        Ok(scopes) => Ok(scopes),
        Err(error) => Err(invalidate_registered_workspace_lease(
            pool,
            project_id,
            &lease.lease_id,
            format!("Workspace lease execution authority changed: {error}"),
        )
        .await),
    }
}

async fn registered_workspace_lease_changed_scope<R: Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: &str,
    canonical_root: &Path,
    expected_binding_id: Option<&str>,
    lease_id: &str,
    expected_path: &Path,
) -> Result<bool, String> {
    let pool = crate::local_db::get_offisim_pool(app)?;
    let lease = load_registered_workspace_lease_from_pool(
        &pool,
        project_id,
        canonical_root,
        lease_id,
        Some(expected_path),
        None,
        expected_binding_id,
    )
    .await?;
    let (root_execution, worktree_execution) =
        registered_workspace_lease_scopes(&pool, project_id, canonical_root, &lease).await?;
    registered_workspace_lease_has_changes_checked(
        &pool,
        project_id,
        &lease,
        &root_execution,
        &worktree_execution,
    )
    .await
}

pub(crate) async fn registered_workspace_lease_changed<R: Runtime>(
    app: &tauri::AppHandle<R>,
    binding: &TaskWorkspaceBinding,
    path: &Path,
) -> Result<bool, String> {
    let lease_id = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Workspace lease path has no lease id".to_string())?;
    registered_workspace_lease_changed_scope(
        app,
        &binding.project_id,
        &binding.canonical_root,
        Some(&binding.binding_id),
        lease_id,
        path,
    )
    .await
}

async fn registered_workspace_lease_changed_for_project<R: Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: &str,
    lease_id: &str,
    path: &Path,
) -> Result<bool, String> {
    let _cleanup_guard = lock_workspace_lease_mutation().await;
    let root = match project_workspace_root(app, project_id).await {
        Ok(root) => root,
        Err(error) => {
            let pool = crate::local_db::get_offisim_pool(app)?;
            return Err(invalidate_registered_workspace_lease(
                &pool,
                project_id,
                lease_id,
                format!("Resolve registered workspace lease Project: {error}"),
            )
            .await);
        }
    };
    registered_workspace_lease_changed_scope(app, project_id, root.git_root(), None, lease_id, path)
        .await
}

fn workspace_lease_command_error(result: GitResult, action: &str) -> String {
    let detail = if result.stderr.trim().is_empty() {
        result.stdout.trim()
    } else {
        result.stderr.trim()
    };
    if detail.is_empty() {
        format!("{action} failed")
    } else {
        format!("{action} failed: {detail}")
    }
}

async fn require_project_cleanup_owner_terminal(
    pool: &SqlitePool,
    active_binding_id: &str,
) -> Result<(), String> {
    let owner_status: Option<String> = sqlx::query_scalar(
        "SELECT status FROM task_workspace_binding_history WHERE binding_id = ?",
    )
    .bind(active_binding_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Read workspace lease active binding status: {error}"))?;
    match owner_status.as_deref() {
        Some("completed" | "failed" | "aborted" | "expired" | "app_restart") => Ok(()),
        Some("active") => Err(
            "Workspace lease is still owned by an active task; stop it before Project cleanup"
                .into(),
        ),
        Some(status) => Err(format!(
            "Workspace lease owner has an unsupported lifecycle status ({status})"
        )),
        None => Err(
            "Workspace lease active binding history is missing; Project cleanup is denied".into(),
        ),
    }
}

async fn close_registered_workspace_lease_from_pool(
    pool: &SqlitePool,
    project_id: &str,
    canonical_root: &Path,
    expected_binding_id: Option<&str>,
    lease_id: &str,
    expected_path: &Path,
    status: &str,
) -> Result<(), String> {
    if !matches!(status, "released" | "discarded") {
        return Err("Invalid workspace lease terminal status".into());
    }
    if lease_id.trim().is_empty() || sanitize_workspace_ref(lease_id) != lease_id {
        return Err("Invalid workspace lease id".into());
    }
    let lease = load_registered_workspace_lease_from_pool(
        pool,
        project_id,
        canonical_root,
        lease_id,
        Some(expected_path),
        None,
        expected_binding_id,
    )
    .await?;

    if expected_binding_id.is_none() {
        require_project_cleanup_owner_terminal(pool, &lease.active_binding_id).await?;
    }

    let (root_execution, worktree_execution) =
        registered_workspace_lease_scopes(pool, project_id, canonical_root, &lease).await?;

    if status == "released"
        && registered_workspace_lease_has_changes_checked(
            pool,
            project_id,
            &lease,
            &root_execution,
            &worktree_execution,
        )
        .await?
    {
        return Err(
            "Workspace lease still has dirty or unmerged changes; retain or review it before release"
                .into(),
        );
    }
    let expected_branch_object_id =
        capture_branch_object_id(&root_execution, &lease.branch).await?;

    let mut remove = Command::new("git");
    remove.args(["worktree", "remove"]);
    if status == "discarded" {
        remove.arg("--force");
    }
    let (removal_parent_execution, basename) = git_target_parent_scope(
        &root_execution,
        &lease.canonical_worktree,
        "registered worktree removal target",
    )?;
    remove.arg(basename).env_clear().envs(scrubbed_git_env());
    if let Err(error) = removal_parent_execution
        .bind_command_with_target(
            &mut remove,
            Some(GitTargetExpectation::Existing {
                path: &lease.canonical_worktree,
                identity: &lease.worktree_identity,
            }),
        )
        .and_then(|_| worktree_execution.verify_live())
    {
        return Err(invalidate_registered_workspace_lease(
            pool,
            project_id,
            lease_id,
            format!("Workspace lease changed immediately before removal: {error}"),
        )
        .await);
    }
    let removed = match run_git_capped(remove, GIT_EXEC_TIMEOUT, MAX_GIT_OUTPUT_BYTES).await {
        Ok(result) => result,
        Err(remove_error) => {
            return match load_registered_workspace_lease_from_pool(
                pool,
                project_id,
                canonical_root,
                lease_id,
                Some(expected_path),
                Some(&lease.branch),
                expected_binding_id,
            )
            .await
            {
                Ok(_) => Err(remove_error),
                Err(state_error) => Err(format!(
                    "{remove_error}; registered workspace state after failure: {state_error}"
                )),
            };
        }
    };
    if let Err(error) = removal_parent_execution.verify_live() {
        return Err(invalidate_registered_workspace_lease(
            pool,
            project_id,
            lease_id,
            format!("Workspace lease parent changed during removal: {error}"),
        )
        .await);
    }
    if !removed.ok {
        let remove_error = workspace_lease_command_error(removed, "Remove registered worktree");
        return match load_registered_workspace_lease_from_pool(
            pool,
            project_id,
            canonical_root,
            lease_id,
            Some(expected_path),
            Some(&lease.branch),
            expected_binding_id,
        )
        .await
        {
            Ok(_) => Err(remove_error),
            Err(state_error) => Err(format!(
                "{remove_error}; registered workspace state after failure: {state_error}"
            )),
        };
    }

    let deleted = match delete_branch_if_unchanged(
        &root_execution,
        &lease.branch,
        &expected_branch_object_id,
    )
    .await
    {
        Ok(result) => result,
        Err(error) => {
            return Err(invalidate_registered_workspace_lease(
                pool,
                project_id,
                lease_id,
                format!("Delete registered worktree branch failed: {error}"),
            )
            .await);
        }
    };
    if let Err(error) = root_execution.verify_live() {
        return Err(invalidate_registered_workspace_lease(
            pool,
            project_id,
            lease_id,
            format!("Workspace lease Project changed during branch cleanup: {error}"),
        )
        .await);
    }
    if !deleted.ok {
        return Err(invalidate_registered_workspace_lease(
            pool,
            project_id,
            lease_id,
            workspace_lease_command_error(deleted, "Delete registered worktree branch"),
        )
        .await);
    }

    let updated = match sqlx::query(
        "UPDATE task_workspace_lease_history SET status = ?, updated_at_unix_ms = ? WHERE lease_id = ? AND project_id = ? AND status = 'active' AND active_binding_id = ?",
    )
    .bind(status)
    .bind(git_now_unix_ms()?)
    .bind(lease_id)
    .bind(project_id)
    .bind(&lease.active_binding_id)
    .execute(pool)
    .await
    {
        Ok(updated) => updated,
        Err(error) => {
            return Err(invalidate_registered_workspace_lease(
                pool,
                project_id,
                lease_id,
                format!("Close workspace lease registration after Git cleanup: {error}"),
            )
            .await);
        }
    };
    if updated.rows_affected() != 1 {
        return Err(
            "Workspace lease registration changed concurrently after its Git cleanup".into(),
        );
    }
    Ok(())
}

async fn close_registered_workspace_lease_scope<R: Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: &str,
    canonical_root: &Path,
    expected_binding_id: Option<&str>,
    lease_id: &str,
    expected_path: &Path,
    status: &str,
) -> Result<(), String> {
    let _cleanup_guard = lock_workspace_lease_mutation().await;
    let pool = crate::local_db::get_offisim_pool(app)?;
    close_registered_workspace_lease_from_pool(
        &pool,
        project_id,
        canonical_root,
        expected_binding_id,
        lease_id,
        expected_path,
        status,
    )
    .await
}

pub(crate) async fn close_registered_workspace_lease<R: Runtime>(
    app: &tauri::AppHandle<R>,
    binding: &TaskWorkspaceBinding,
    path: &Path,
    status: &str,
) -> Result<(), String> {
    let lease_id = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Workspace lease path has no lease id".to_string())?;
    close_registered_workspace_lease_scope(
        app,
        &binding.project_id,
        &binding.canonical_root,
        Some(&binding.binding_id),
        lease_id,
        path,
        status,
    )
    .await
}

async fn close_registered_workspace_lease_for_project<R: Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: &str,
    lease_id: &str,
    path: &Path,
    status: &str,
) -> Result<(), String> {
    let root = match project_workspace_root(app, project_id).await {
        Ok(root) => root,
        Err(error) => {
            let pool = crate::local_db::get_offisim_pool(app)?;
            return Err(invalidate_registered_workspace_lease(
                &pool,
                project_id,
                lease_id,
                format!("Resolve registered workspace lease Project: {error}"),
            )
            .await);
        }
    };
    close_registered_workspace_lease_scope(
        app,
        project_id,
        root.git_root(),
        None,
        lease_id,
        path,
        status,
    )
    .await
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

async fn project_workspace_root<R: Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: &str,
) -> Result<AuthorizedWorkspaceRoot, String> {
    let project_id = project_id.trim();
    if project_id.is_empty() {
        return Err("projectId is required for git_exec".into());
    }
    crate::task_workspace_binding::resolve_authorized_project_workspace(app, project_id).await
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

fn validate_git_ref(value: &str, label: &str) -> Result<(), String> {
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

fn resolve_new_path_under_root(root: &Path, input: &str, label: &str) -> Result<PathBuf, String> {
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
    use sqlx::sqlite::SqlitePoolOptions;
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

    fn fixture_git(root: &Path, args: &[&str]) -> std::process::Output {
        std::process::Command::new("git")
            .args(args)
            .current_dir(root)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .expect("run fixture git")
    }

    fn fixture_git_ok(root: &Path, args: &[&str]) {
        let output = fixture_git(root, args);
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn initialize_git_root(root: &Path) {
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

    fn git_root() -> PathBuf {
        let root = temp_root();
        initialize_git_root(&root);
        root.canonicalize().expect("canonical git fixture")
    }

    fn git_execution(root: &Path) -> GitExecutionScope {
        let authority = AuthorizedWorkspaceRoot::from_live_path(root.to_path_buf())
            .expect("capture fixture Git authority");
        GitExecutionScope::from_authority(&authority, root).expect("capture fixture Git scope")
    }

    fn fixture_worktree(root: &Path, lease_id: &str, run_id: &str) -> (PathBuf, String) {
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
    fn registered_workspace_process_claim_requires_every_exact_registration_field() {
        let root = git_root();
        let lease_id = "lease-exact-process";
        let run_id = "run-exact-process";
        let (worktree, branch) = fixture_worktree(&root, lease_id, run_id);
        let lease = RegisteredWorkspaceLease {
            lease_id: lease_id.into(),
            active_binding_id: "binding-1".into(),
            child_run_id: run_id.into(),
            branch: branch.clone(),
            canonical_worktree: worktree.clone(),
            worktree_identity: filesystem_identity(&worktree).expect("worktree identity"),
            project_identity: filesystem_identity(&root).expect("project identity"),
            created_at_unix_ms: 1,
        };
        let exact = RegisteredWorkspaceProcessClaim {
            lease_id: lease_id.into(),
            registered_run_id: run_id.into(),
            workspace_root: root.clone(),
            cwd: worktree.clone(),
            branch: branch.clone(),
        };
        assert_eq!(
            validate_registered_workspace_process_claim(&root, &lease, &exact)
                .expect("exact process claim"),
            worktree
        );

        let mut invalid = Vec::new();
        let mut claim = exact.clone();
        claim.lease_id = "lease-other".into();
        invalid.push(("leaseId", claim));
        let mut claim = exact.clone();
        claim.registered_run_id = "run-other".into();
        invalid.push(("registeredRunId", claim));
        let mut claim = exact.clone();
        claim.workspace_root = root.join("other-root");
        invalid.push(("workspaceRoot", claim));
        let mut claim = exact.clone();
        claim.cwd = root.join(".offisim/worktrees/other-cwd");
        invalid.push(("cwd", claim));
        let mut claim = exact;
        claim.branch = "offisim/lease/other-branch".into();
        invalid.push(("branch", claim));

        for (field, claim) in invalid {
            assert!(
                validate_registered_workspace_process_claim(&root, &lease, &claim).is_err(),
                "{field} drift must fail the exact process claim"
            );
        }
        cleanup_root(root);
    }

    async fn lease_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open fixture sqlite");
        sqlx::query(
            r#"
            CREATE TABLE task_workspace_lease_history (
              lease_id TEXT PRIMARY KEY NOT NULL,
              project_id TEXT NOT NULL,
              created_binding_id TEXT NOT NULL,
              active_binding_id TEXT NOT NULL,
              created_root_run_id TEXT NOT NULL,
              child_run_id TEXT NOT NULL,
              created_request_id TEXT NOT NULL,
              branch TEXT NOT NULL,
              canonical_worktree TEXT NOT NULL UNIQUE,
              worktree_identity_json TEXT NOT NULL,
              project_root_identity_json TEXT NOT NULL,
              created_at_unix_ms INTEGER NOT NULL,
              updated_at_unix_ms INTEGER NOT NULL,
              status TEXT NOT NULL
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create fixture lease table");
        pool
    }

    async fn lease_pool_with_binding_status(status: &str) -> SqlitePool {
        let pool = lease_pool().await;
        sqlx::query(
            "CREATE TABLE task_workspace_binding_history (binding_id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL)",
        )
        .execute(&pool)
        .await
        .expect("create fixture binding history table");
        sqlx::query(
            "INSERT INTO task_workspace_binding_history (binding_id, status) VALUES ('binding-1', ?)",
        )
        .bind(status)
        .execute(&pool)
        .await
        .expect("seed fixture binding history");
        pool
    }

    async fn lease_projection_pool(root: &Path, owner_status: &str) -> SqlitePool {
        let pool = lease_pool().await;
        sqlx::query(
            r#"
            CREATE TABLE task_workspace_binding_history (
              binding_id TEXT PRIMARY KEY NOT NULL,
              project_id TEXT NOT NULL,
              thread_id TEXT NOT NULL,
              turn_id TEXT NOT NULL,
              canonical_root TEXT NOT NULL,
              status TEXT NOT NULL
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create projection binding history table");
        sqlx::query(
            "INSERT INTO task_workspace_binding_history (binding_id, project_id, thread_id, turn_id, canonical_root, status) VALUES ('binding-1', 'project-1', 'thread-1', 'root-1', ?, ?)",
        )
        .bind(root.to_string_lossy().as_ref())
        .bind(owner_status)
        .execute(&pool)
        .await
        .expect("seed projection binding history");
        pool
    }

    async fn agent_run_provenance_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open agent run provenance sqlite");
        sqlx::query(
            r#"
            CREATE TABLE agent_runs (
              run_id TEXT PRIMARY KEY NOT NULL,
              company_id TEXT NOT NULL,
              project_id TEXT,
              thread_id TEXT NOT NULL,
              parent_run_id TEXT,
              root_run_id TEXT NOT NULL,
              status TEXT NOT NULL
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create agent run provenance table");
        sqlx::query(
            "INSERT INTO agent_runs (run_id, company_id, project_id, thread_id, parent_run_id, root_run_id, status) VALUES ('root-1', 'company-1', 'project-1', 'thread-1', NULL, 'root-1', 'running'), ('child-1', 'company-1', 'project-1', 'thread-1', 'root-1', 'root-1', 'running')",
        )
        .execute(&pool)
        .await
        .expect("seed agent run provenance");
        pool
    }

    async fn persist_fixture_lease(
        pool: &SqlitePool,
        root: &Path,
        worktree: &Path,
        lease_id: &str,
        branch: &str,
        worktree_identity_json: Option<&str>,
    ) -> Result<(), String> {
        let worktree_identity = match worktree_identity_json {
            Some(value) => value.to_string(),
            None => serde_json::to_string(&filesystem_identity(worktree)?)
                .map_err(|error| error.to_string())?,
        };
        let project_identity = serde_json::to_string(&filesystem_identity(root)?)
            .map_err(|error| error.to_string())?;
        persist_task_workspace_lease_registration(
            pool,
            root,
            NewRegisteredWorkspaceLease {
                lease_id,
                project_id: "project-1",
                binding_id: "binding-1",
                root_run_id: "root-1",
                child_run_id: "child-1",
                request_id: "request-1",
                branch,
                canonical_worktree: worktree,
                worktree_identity_json: &worktree_identity,
                project_identity_json: &project_identity,
                created_at_unix_ms: 1,
            },
        )
        .await
    }

    async fn fixture_lease_status(pool: &SqlitePool, lease_id: &str) -> String {
        sqlx::query_scalar("SELECT status FROM task_workspace_lease_history WHERE lease_id = ?")
            .bind(lease_id)
            .fetch_one(pool)
            .await
            .expect("read fixture lease status")
    }

    #[tokio::test]
    async fn workspace_lease_projection_uses_durable_lifecycle_and_current_binding() {
        let root = git_root();
        let (worktree, branch) = fixture_worktree(&root, "lease-projection", "run-projection");
        let pool = lease_projection_pool(&root, "active").await;
        persist_fixture_lease(&pool, &root, &worktree, "lease-projection", &branch, None)
            .await
            .expect("persist projection lease");

        sqlx::query(
            "INSERT INTO task_workspace_binding_history (binding_id, project_id, thread_id, turn_id, canonical_root, status) VALUES ('binding-rework', 'project-1', 'thread-rework', 'root-rework', ?, 'active'), ('binding-project-2', 'project-2', 'thread-project-2', 'root-project-2', ?, 'completed')",
        )
        .bind(root.to_string_lossy().as_ref())
        .bind(root.to_string_lossy().as_ref())
        .execute(&pool)
        .await
        .expect("seed rework and isolated Project owners");
        sqlx::query(
            "UPDATE task_workspace_lease_history SET active_binding_id = 'binding-rework', updated_at_unix_ms = 2 WHERE lease_id = 'lease-projection'",
        )
        .execute(&pool)
        .await
        .expect("adopt lease into rework binding");

        for (lease_id, status, updated_at) in [
            ("lease-released", "released", 3_i64),
            ("lease-discarded", "discarded", 4_i64),
            ("lease-invalid", "invalid", 5_i64),
        ] {
            sqlx::query(
                r#"
                INSERT INTO task_workspace_lease_history (
                  lease_id, project_id, created_binding_id, active_binding_id,
                  created_root_run_id, child_run_id, created_request_id, branch,
                  canonical_worktree, worktree_identity_json, project_root_identity_json,
                  created_at_unix_ms, updated_at_unix_ms, status
                )
                SELECT ?, project_id, created_binding_id, active_binding_id,
                       created_root_run_id, child_run_id, created_request_id,
                       branch || '-' || ?, canonical_worktree || '-' || ?,
                       worktree_identity_json, project_root_identity_json,
                       created_at_unix_ms, ?, ?
                FROM task_workspace_lease_history WHERE lease_id = 'lease-projection'
                "#,
            )
            .bind(lease_id)
            .bind(status)
            .bind(status)
            .bind(updated_at)
            .bind(status)
            .execute(&pool)
            .await
            .expect("seed terminal lifecycle row");
        }
        sqlx::query(
            r#"
            INSERT INTO task_workspace_lease_history (
              lease_id, project_id, created_binding_id, active_binding_id,
              created_root_run_id, child_run_id, created_request_id, branch,
              canonical_worktree, worktree_identity_json, project_root_identity_json,
              created_at_unix_ms, updated_at_unix_ms, status
            )
            SELECT 'lease-project-2', 'project-2', 'binding-project-2', 'binding-project-2',
                   'root-project-2', 'child-project-2', 'request-project-2',
                   branch || '-project-2', canonical_worktree || '-project-2',
                   worktree_identity_json, project_root_identity_json, 6, 6, 'discarded'
            FROM task_workspace_lease_history WHERE lease_id = 'lease-projection'
            "#,
        )
        .execute(&pool)
        .await
        .expect("seed second Project lifecycle row");

        let projected = workspace_lease_list_from_pool(&pool, "project-1")
            .await
            .expect("project durable lease projection");
        assert_eq!(
            projected.len(),
            4,
            "one lease row per durable lifecycle record"
        );
        let active = projected
            .iter()
            .find(|row| row.lease_id == "lease-projection")
            .expect("active projection row");
        assert_eq!(active.project_id, "project-1");
        assert_eq!(active.thread_id.as_deref(), Some("thread-rework"));
        assert_eq!(active.active_root_run_id.as_deref(), Some("root-rework"));
        assert_eq!(active.created_root_run_id, "root-1");
        assert_eq!(active.registered_run_id, "child-1");
        assert_eq!(active.workspace_root.as_deref(), root.to_str());
        assert_eq!(active.cwd, worktree.to_string_lossy());
        assert_eq!(active.branch, branch);
        assert_eq!(active.status, "active");
        assert_eq!(active.owner_binding_status.as_deref(), Some("active"));
        assert_eq!(
            projected
                .iter()
                .map(|row| row.status.as_str())
                .collect::<std::collections::BTreeSet<_>>(),
            std::collections::BTreeSet::from(["active", "discarded", "invalid", "released"]),
        );

        let other_project = workspace_lease_list_from_pool(&pool, "project-2")
            .await
            .expect("second Project durable lease projection");
        assert_eq!(
            other_project.len(),
            1,
            "Project scope must not leak lifecycle rows"
        );
        assert_eq!(other_project[0].lease_id, "lease-project-2");
        assert_eq!(
            other_project[0].owner_binding_status.as_deref(),
            Some("completed")
        );

        cleanup_root(root);
    }

    #[tokio::test]
    async fn workspace_lease_projection_is_read_only_for_missing_worktrees() {
        let root = git_root();
        let (worktree, branch) = fixture_worktree(&root, "lease-list-missing", "run-list-missing");
        let pool = lease_projection_pool(&root, "app_restart").await;
        persist_fixture_lease(&pool, &root, &worktree, "lease-list-missing", &branch, None)
            .await
            .expect("persist missing projection lease");
        let projected = workspace_lease_list_from_pool(&pool, "project-1")
            .await
            .expect("missing registration remains a cheap durable projection");
        assert_eq!(projected.len(), 1);
        assert_eq!(projected[0].status, "active");
        assert_eq!(
            projected[0].owner_binding_status.as_deref(),
            Some("app_restart")
        );
        let active_leases: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM task_workspace_lease_history WHERE project_id = 'project-1' AND status = 'active'",
        )
        .fetch_one(&pool)
        .await
        .expect("read deletion preflight active lease count");
        assert_eq!(
            active_leases, 1,
            "read-only Board projection does not mutate lease lifecycle"
        );

        cleanup_root(root);
    }

    #[tokio::test]
    async fn workspace_lease_projection_bounds_terminal_history_but_keeps_every_active_lease() {
        let root = git_root();
        let (worktree, branch) = fixture_worktree(&root, "lease-list-bounded", "run-list-bounded");
        let pool = lease_projection_pool(&root, "active").await;
        persist_fixture_lease(&pool, &root, &worktree, "lease-list-bounded", &branch, None)
            .await
            .expect("persist active projection lease");

        for index in 0..120_i64 {
            let lease_id = format!("lease-terminal-{index:03}");
            sqlx::query(
                r#"
                INSERT INTO task_workspace_lease_history (
                  lease_id, project_id, created_binding_id, active_binding_id,
                  created_root_run_id, child_run_id, created_request_id, branch,
                  canonical_worktree, worktree_identity_json, project_root_identity_json,
                  created_at_unix_ms, updated_at_unix_ms, status
                )
                SELECT ?, project_id, created_binding_id, active_binding_id,
                       created_root_run_id, child_run_id, created_request_id,
                       branch || '-' || ?, canonical_worktree || '-' || ?,
                       worktree_identity_json, project_root_identity_json,
                       created_at_unix_ms, ?, 'released'
                FROM task_workspace_lease_history WHERE lease_id = 'lease-list-bounded'
                "#,
            )
            .bind(&lease_id)
            .bind(&lease_id)
            .bind(&lease_id)
            .bind(index + 10)
            .execute(&pool)
            .await
            .expect("seed terminal projection history");
        }

        let projected = workspace_lease_list_from_pool(&pool, "project-1")
            .await
            .expect("bounded lease projection");
        assert_eq!(
            projected.len(),
            101,
            "all active plus 100 recent terminal rows"
        );
        assert!(
            projected
                .iter()
                .any(|row| row.lease_id == "lease-list-bounded"),
            "active lease is never displaced by terminal history"
        );
        assert!(projected
            .iter()
            .any(|row| row.lease_id == "lease-terminal-119"));
        assert!(
            !projected
                .iter()
                .any(|row| row.lease_id == "lease-terminal-000"),
            "old terminal history falls outside the Board projection"
        );

        cleanup_root(root);
    }

    #[tokio::test]
    async fn workspace_lease_projection_propagates_database_failures() {
        let pool = lease_pool().await;
        let error = workspace_lease_list_from_pool(&pool, "project-1")
            .await
            .expect_err("missing binding table is an operational DB failure");
        assert!(error.contains("Read workspace lease lifecycle projection"));
    }

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

    #[tokio::test]
    async fn registered_lease_missing_path_is_atomically_invalidated() {
        let root = git_root();
        let (worktree, branch) = fixture_worktree(&root, "lease-missing", "run-missing");
        let pool = lease_pool().await;
        persist_fixture_lease(&pool, &root, &worktree, "lease-missing", &branch, None)
            .await
            .expect("persist registered lease");
        let worktree_text = worktree.to_string_lossy().to_string();
        fixture_git_ok(&root, &["worktree", "remove", "--force", &worktree_text]);

        let error = load_registered_workspace_lease_from_pool(
            &pool,
            "project-1",
            &root,
            "lease-missing",
            Some(&worktree),
            Some(&branch),
            Some("binding-1"),
        )
        .await
        .expect_err("missing registered worktree must fail closed");
        assert!(error.contains("filesystem is unavailable"));
        assert_eq!(
            fixture_lease_status(&pool, "lease-missing").await,
            "invalid"
        );

        cleanup_root(root);
    }

    #[tokio::test]
    async fn registered_lease_stale_git_registry_is_atomically_invalidated() {
        let root = git_root();
        let (worktree, branch) = fixture_worktree(&root, "lease-stale", "run-stale");
        let pool = lease_pool().await;
        persist_fixture_lease(&pool, &root, &worktree, "lease-stale", &branch, None)
            .await
            .expect("persist registered lease");
        std::fs::remove_dir_all(root.join(".git/worktrees/lease-stale"))
            .expect("remove git worktree registry entry");

        let error = load_registered_workspace_lease_from_pool(
            &pool,
            "project-1",
            &root,
            "lease-stale",
            Some(&worktree),
            Some(&branch),
            Some("binding-1"),
        )
        .await
        .expect_err("stale git registry must fail closed");
        assert!(error.contains("Git registration is invalid"));
        assert_eq!(fixture_lease_status(&pool, "lease-stale").await, "invalid");

        cleanup_root(root);
    }

    #[tokio::test]
    async fn registered_lease_corrupt_identity_record_is_atomically_invalidated() {
        let root = git_root();
        let (worktree, branch) = fixture_worktree(&root, "lease-corrupt", "run-corrupt");
        let pool = lease_pool().await;
        persist_fixture_lease(
            &pool,
            &root,
            &worktree,
            "lease-corrupt",
            &branch,
            Some("{not-json"),
        )
        .await
        .expect("persist corrupt registered lease fixture");

        let error = load_registered_workspace_lease_from_pool(
            &pool,
            "project-1",
            &root,
            "lease-corrupt",
            Some(&worktree),
            Some(&branch),
            Some("binding-1"),
        )
        .await
        .expect_err("corrupt identity record must fail closed");
        assert!(error.contains("identity record is invalid"));
        assert_eq!(
            fixture_lease_status(&pool, "lease-corrupt").await,
            "invalid"
        );

        cleanup_root(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn registered_lease_removal_rejects_same_path_worktree_replacement() {
        use std::os::unix::fs::symlink;

        let root = git_root();
        let (worktree, branch) = fixture_worktree(&root, "lease-replaced", "run-replaced");
        let pool = lease_pool().await;
        persist_fixture_lease(&pool, &root, &worktree, "lease-replaced", &branch, None)
            .await
            .expect("persist replaced lease fixture");
        let outside = temp_root();
        let sentinel = outside.join("outside-sentinel");
        std::fs::write(&sentinel, "untouched\n").expect("write outside sentinel");
        let moved = worktree.with_extension("registered-old");
        std::fs::rename(&worktree, &moved).expect("move registered worktree");
        symlink(&outside, &worktree).expect("replace registered worktree with outside symlink");

        let error = close_registered_workspace_lease_from_pool(
            &pool,
            "project-1",
            &root,
            Some("binding-1"),
            "lease-replaced",
            &worktree,
            "discarded",
        )
        .await
        .expect_err("replacement worktree must fail closed before Git removal");
        assert!(error.contains("identity changed"), "{error}");
        assert_eq!(
            std::fs::read_to_string(&sentinel).expect("read outside sentinel"),
            "untouched\n"
        );
        assert_eq!(
            fixture_lease_status(&pool, "lease-replaced").await,
            "invalid"
        );
        assert!(fixture_git(
            &root,
            &["show-ref", "--verify", &format!("refs/heads/{branch}")],
        )
        .status
        .success());

        std::fs::remove_file(&worktree).expect("remove replacement worktree symlink");
        std::fs::rename(&moved, &worktree).expect("restore registered worktree for cleanup");
        cleanup_root(root);
        cleanup_root(outside);
    }

    #[tokio::test]
    async fn registration_insert_failure_rolls_back_worktree_and_branch() {
        let root = git_root();
        let pool = lease_pool().await;
        let (first, first_branch) = fixture_worktree(&root, "lease-first", "run-first");
        persist_fixture_lease(&pool, &root, &first, "lease-collision", &first_branch, None)
            .await
            .expect("persist first lease");
        let (second, second_branch) = fixture_worktree(&root, "lease-second", "run-second");
        let second_identity =
            serde_json::to_string(&filesystem_identity(&second).expect("second worktree identity"))
                .expect("encode second identity");
        let project_identity =
            serde_json::to_string(&filesystem_identity(&root).expect("project identity"))
                .expect("encode project identity");

        let error = persist_task_workspace_lease_registration(
            &pool,
            &root,
            NewRegisteredWorkspaceLease {
                lease_id: "lease-collision",
                project_id: "project-1",
                binding_id: "binding-2",
                root_run_id: "root-2",
                child_run_id: "child-2",
                request_id: "request-2",
                branch: &second_branch,
                canonical_worktree: &second,
                worktree_identity_json: &second_identity,
                project_identity_json: &project_identity,
                created_at_unix_ms: 2,
            },
        )
        .await
        .expect_err("duplicate durable registration must roll back Git creation");
        assert!(error.contains("Register workspace lease"));
        assert!(!second.exists(), "failed registration left its worktree");
        let branch_ref = format!("refs/heads/{second_branch}");
        assert!(
            !fixture_git(&root, &["show-ref", "--verify", &branch_ref])
                .status
                .success(),
            "failed registration left its branch"
        );

        cleanup_root(root);
    }

    #[tokio::test]
    async fn workspace_lease_agent_run_requires_exact_live_child_provenance() {
        let pool = agent_run_provenance_pool().await;
        assert!(validate_workspace_lease_agent_run_from_pool(
            &pool,
            "company-1",
            "project-1",
            "thread-1",
            "root-1",
            "child-1",
        )
        .await
        .expect("exact provenance"));
        assert!(!validate_workspace_lease_agent_run_from_pool(
            &pool,
            "company-1",
            "project-1",
            "thread-1",
            "root-1",
            "missing-child",
        )
        .await
        .expect("missing ordered event remains retryable"));

        for (column, invalid_value) in [
            ("project_id", "project-other"),
            ("root_run_id", "root-other"),
            ("status", "completed"),
            ("parent_run_id", ""),
        ] {
            let reset = agent_run_provenance_pool().await;
            sqlx::query(&format!(
                "UPDATE agent_runs SET {column} = ? WHERE run_id = 'child-1'"
            ))
            .bind(invalid_value)
            .execute(&reset)
            .await
            .expect("mutate child provenance fixture");
            let error = validate_workspace_lease_agent_run_from_pool(
                &reset,
                "company-1",
                "project-1",
                "thread-1",
                "root-1",
                "child-1",
            )
            .await
            .expect_err("mismatched child provenance must fail closed");
            assert!(error.contains("does not match"), "{column}: {error}");
        }

        let wrong_root = agent_run_provenance_pool().await;
        sqlx::query("UPDATE agent_runs SET status = 'completed' WHERE run_id = 'root-1'")
            .execute(&wrong_root)
            .await
            .expect("mutate root status fixture");
        let error = validate_workspace_lease_agent_run_from_pool(
            &wrong_root,
            "company-1",
            "project-1",
            "thread-1",
            "root-1",
            "child-1",
        )
        .await
        .expect_err("terminal root provenance must fail closed");
        assert!(error.contains("does not match"));
    }

    #[tokio::test]
    async fn clean_unmerged_commit_counts_as_changed_until_integrated() {
        let root = git_root();
        let (worktree, branch) = fixture_worktree(&root, "lease-commit", "run-commit");
        std::fs::write(worktree.join("child.txt"), "child commit\n")
            .expect("write child commit fixture");
        fixture_git_ok(&worktree, &["add", "child.txt"]);
        fixture_git_ok(&worktree, &["commit", "-m", "child commit"]);
        let lease = RegisteredWorkspaceLease {
            lease_id: "lease-commit".into(),
            active_binding_id: "binding-1".into(),
            child_run_id: "child-1".into(),
            branch: branch.clone(),
            canonical_worktree: worktree.clone(),
            worktree_identity: filesystem_identity(&worktree).expect("worktree identity"),
            project_identity: filesystem_identity(&root).expect("project identity"),
            created_at_unix_ms: 1,
        };
        let root_execution = lease.root_scope(&root).expect("registered root scope");
        let worktree_execution = lease
            .worktree_scope(&root)
            .expect("registered worktree scope");

        assert!(
            registered_workspace_lease_has_changes(&lease, &root_execution, &worktree_execution,)
                .await
                .expect("inspect clean unmerged branch"),
            "a clean but unmerged commit must be retained"
        );
        fixture_git_ok(&root, &["merge", "--no-ff", &branch, "-m", "merge child"]);
        assert!(
            !registered_workspace_lease_has_changes(&lease, &root_execution, &worktree_execution,)
                .await
                .expect("inspect integrated branch"),
            "an integrated clean branch may be released"
        );

        cleanup_root(root);
    }

    #[tokio::test]
    async fn registered_release_cleans_worktree_branch_and_durable_row() {
        let root = git_root();
        let (worktree, branch) = fixture_worktree(&root, "lease-release", "run-release");
        let pool = lease_pool().await;
        persist_fixture_lease(&pool, &root, &worktree, "lease-release", &branch, None)
            .await
            .expect("persist release lease");

        close_registered_workspace_lease_from_pool(
            &pool,
            "project-1",
            &root,
            Some("binding-1"),
            "lease-release",
            &worktree,
            "released",
        )
        .await
        .expect("release registered worktree");
        assert!(!worktree.exists());
        let branch_ref = format!("refs/heads/{branch}");
        assert!(!fixture_git(&root, &["show-ref", "--verify", &branch_ref])
            .status
            .success());
        assert_eq!(
            fixture_lease_status(&pool, "lease-release").await,
            "released"
        );

        cleanup_root(root);
    }

    #[tokio::test]
    async fn registered_discard_force_cleans_branch_and_durable_row() {
        let root = git_root();
        let (worktree, branch) = fixture_worktree(&root, "lease-discard", "run-discard");
        std::fs::write(worktree.join("discard.txt"), "discard me\n")
            .expect("write discard fixture");
        let pool = lease_pool().await;
        persist_fixture_lease(&pool, &root, &worktree, "lease-discard", &branch, None)
            .await
            .expect("persist discard lease");

        close_registered_workspace_lease_from_pool(
            &pool,
            "project-1",
            &root,
            Some("binding-1"),
            "lease-discard",
            &worktree,
            "discarded",
        )
        .await
        .expect("discard registered worktree");
        assert!(!worktree.exists());
        let branch_ref = format!("refs/heads/{branch}");
        assert!(!fixture_git(&root, &["show-ref", "--verify", &branch_ref])
            .status
            .success());
        assert_eq!(
            fixture_lease_status(&pool, "lease-discard").await,
            "discarded"
        );

        cleanup_root(root);
    }

    #[tokio::test]
    async fn project_cleanup_rejects_a_lease_owned_by_an_active_binding() {
        let root = git_root();
        let (worktree, branch) = fixture_worktree(&root, "lease-active", "run-active");
        let pool = lease_pool_with_binding_status("active").await;
        persist_fixture_lease(&pool, &root, &worktree, "lease-active", &branch, None)
            .await
            .expect("persist active-owner lease");

        let error = close_registered_workspace_lease_from_pool(
            &pool,
            "project-1",
            &root,
            None,
            "lease-active",
            &worktree,
            "discarded",
        )
        .await
        .expect_err("Project cleanup must not remove an active task worktree");
        assert!(error.contains("active task"));
        assert!(worktree.exists());
        let branch_ref = format!("refs/heads/{branch}");
        assert!(
            fixture_git(&root, &["show-ref", "--verify", &branch_ref])
                .status
                .success(),
            "active-owner rejection must not delete its branch"
        );
        assert_eq!(fixture_lease_status(&pool, "lease-active").await, "active");

        cleanup_root(root);
    }

    #[tokio::test]
    async fn project_cleanup_accepts_a_lease_owned_by_a_terminal_binding() {
        let root = git_root();
        let (worktree, branch) = fixture_worktree(&root, "lease-terminal", "run-terminal");
        let pool = lease_pool_with_binding_status("completed").await;
        persist_fixture_lease(&pool, &root, &worktree, "lease-terminal", &branch, None)
            .await
            .expect("persist terminal-owner lease");

        close_registered_workspace_lease_from_pool(
            &pool,
            "project-1",
            &root,
            None,
            "lease-terminal",
            &worktree,
            "discarded",
        )
        .await
        .expect("Project cleanup may discard a terminal task worktree");
        assert!(!worktree.exists());
        assert_eq!(
            fixture_lease_status(&pool, "lease-terminal").await,
            "discarded"
        );

        cleanup_root(root);
    }

    #[tokio::test]
    async fn workspace_lease_adoption_and_cleanup_share_one_mutation_lane() {
        let held_by_cleanup = lock_workspace_lease_mutation().await;
        let mut adoption = tokio::spawn(async {
            let _held_by_adoption = lock_workspace_lease_mutation().await;
        });

        assert!(
            tokio::time::timeout(Duration::from_millis(25), &mut adoption)
                .await
                .is_err(),
            "adoption must wait while cleanup owns the workspace lease mutation lane"
        );
        drop(held_by_cleanup);
        tokio::time::timeout(Duration::from_secs(1), adoption)
            .await
            .expect("adoption enters after cleanup exits")
            .expect("adoption task succeeds");
    }

    #[tokio::test]
    async fn registered_release_retains_clean_unmerged_commit() {
        let root = git_root();
        let (worktree, branch) = fixture_worktree(&root, "lease-retain", "run-retain");
        std::fs::write(worktree.join("retain.txt"), "retain me\n").expect("write retain fixture");
        fixture_git_ok(&worktree, &["add", "retain.txt"]);
        fixture_git_ok(&worktree, &["commit", "-m", "retain commit"]);
        let pool = lease_pool().await;
        persist_fixture_lease(&pool, &root, &worktree, "lease-retain", &branch, None)
            .await
            .expect("persist retained lease");

        let error = close_registered_workspace_lease_from_pool(
            &pool,
            "project-1",
            &root,
            Some("binding-1"),
            "lease-retain",
            &worktree,
            "released",
        )
        .await
        .expect_err("clean unmerged branch must not release");
        assert!(error.contains("dirty or unmerged"));
        assert!(worktree.exists());
        let branch_ref = format!("refs/heads/{branch}");
        assert!(fixture_git(&root, &["show-ref", "--verify", &branch_ref])
            .status
            .success());
        assert_eq!(fixture_lease_status(&pool, "lease-retain").await, "active");

        cleanup_root(root);
    }

    #[tokio::test]
    async fn post_create_rollback_removes_worktree_and_branch() {
        let root = git_root();
        let path = root.join(".offisim/worktrees/lease-rollback");
        let branch = expected_workspace_lease_branch("run-rollback", "lease-rollback");
        let args = vec![
            "worktree".into(),
            "add".into(),
            "-b".into(),
            branch.clone(),
            path.to_string_lossy().to_string(),
        ];
        let result = run_git_validated(args, &root, Some(&root))
            .await
            .expect("create validated worktree");
        assert!(result.ok);
        let execution = git_execution(&root);
        rollback_created_worktree(&execution, &path, &branch)
            .await
            .expect("rollback worktree");
        assert!(!path.exists());
        let branch_ref = format!("refs/heads/{branch}");
        assert!(!fixture_git(&root, &["show-ref", "--verify", &branch_ref])
            .status
            .success());

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
