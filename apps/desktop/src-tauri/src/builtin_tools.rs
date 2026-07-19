#[cfg(unix)]
use rand::{rngs::OsRng, RngCore};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::OpenOptions;
use std::io::{Read as StdRead, Write};
use std::ops::Deref;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use tauri::Runtime;
use tokio::io::{AsyncRead, AsyncReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::time::{interval, Duration, MissedTickBehavior};
use tokio_util::sync::CancellationToken;

#[cfg(test)]
use crate::local_paths::is_overbroad_workspace_root;
use crate::process_group::{configure_process_group, signal_process_group, ProcessGroupGuard};
use crate::task_workspace_binding::{
    resolve_authorized_project_workspace, resolve_task_workspace_claim_authority,
    resolve_task_workspace_evaluation_claim_authority, AuthorizedProcessCwd,
    AuthorizedWorkspaceRoot, TaskWorkspaceAccess, TaskWorkspaceBindingClaim,
    TaskWorkspaceEvaluationLeaseClaim,
};

const DEFAULT_MAX_OUTPUT_BYTES: usize = 1024 * 1024;
const MAX_READ_BYTES: u64 = 8 * 1024 * 1024;
const MAX_WRITE_BYTES: usize = 8 * 1024 * 1024;
const MAX_EVALUATION_SHELL_TIMEOUT_MS: u32 = 120_000;
const EVALUATION_AUTHORITY_POLL_MS: u64 = 250;
const SHELL_TERMINATION_GRACE_MS: u64 = 120;
const SHELL_PIPE_DRAIN_MS: u64 = 250;
#[cfg(unix)]
const SHELL_LIFETIME_MARKER_FD: libc::c_int = 198;
#[cfg(unix)]
const SHELL_LIFETIME_MARKER_ENV: &str = "OFFISIM_INTERNAL_TASK_LIFETIME";
/// Hard ceiling on `project_read_file_preview` — file-tree previews never
/// pull more than 64 KB across the IPC boundary regardless of caller request.
const MAX_PREVIEW_BYTES: u64 = 65_536;
static PROJECT_FILE_MUTATION_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
const PROJECT_FILE_CONFLICT_SENTINEL: &str = "offisim-internal-project-file-conflict";
const PROJECT_FILE_CANCELLED_SENTINEL: &str = "offisim-internal-project-file-cancelled";

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

#[derive(Debug, PartialEq, Eq)]
enum BashWorkspaceLane {
    Catalog { cwd: PathBuf },
    EvaluationVerification,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ShellCommandPolicy {
    /// Renderer/catalog and deterministic verification calls cross the Rust
    /// classifier at this boundary.
    ClassifierBounded,
    /// Pi's task Bash has already crossed the host permission gate. Rust owns
    /// cwd authority and process lifetime here without silently narrowing Full.
    PiHostGated,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ShellExecutionLane {
    Task,
    Evaluation,
}

#[derive(Clone, Copy)]
enum ShellAuthorityMonitor<'a> {
    Process,
    Evaluation {
        lease: &'a TaskWorkspaceEvaluationLeaseClaim,
        expected_root: &'a Path,
        project_id: &'a str,
    },
}

#[derive(Clone, Copy)]
enum ShellAuthorityPhase {
    BeforeSpawn,
    Running,
    Completion,
}

impl ShellAuthorityPhase {
    fn evaluation_identity_error(self) -> &'static str {
        match self {
            Self::BeforeSpawn => {
                "Task workspace evaluation root changed before verification spawn."
            }
            Self::Running => {
                "Task workspace evaluation root changed while verification was running."
            }
            Self::Completion => {
                "Task workspace evaluation root changed at verification completion."
            }
        }
    }
}

async fn verify_shell_authority<R: Runtime>(
    app: &tauri::AppHandle<R>,
    monitor: ShellAuthorityMonitor<'_>,
    execution: &AuthorizedProcessCwd,
    phase: ShellAuthorityPhase,
) -> Result<(), String> {
    match monitor {
        ShellAuthorityMonitor::Process => execution.verify_live(),
        ShellAuthorityMonitor::Evaluation {
            lease,
            expected_root,
            project_id,
        } => {
            let current_root = resolve_task_workspace_evaluation_claim_authority(
                app,
                lease,
                Some(project_id),
                TaskWorkspaceAccess::Verify,
            )
            .await?;
            if current_root.path() != expected_root
                || current_root.verify_live().is_err()
                || execution.verify_live().is_err()
            {
                return Err(phase.evaluation_identity_error().into());
            }
            Ok(())
        }
    }
}

fn classify_bash_workspace_lane(
    has_evaluation_lease: bool,
    verification_only: bool,
    cwd: Option<&str>,
) -> Result<BashWorkspaceLane, String> {
    match (has_evaluation_lease, verification_only) {
        (true, true) => {
            if cwd.map(str::trim).is_some_and(|value| !value.is_empty()) {
                return Err(
                    "task-workspace verification derives cwd from backend authority; omit cwd"
                        .into(),
                );
            }
            Ok(BashWorkspaceLane::EvaluationVerification)
        }
        (true, false) => {
            Err("evaluationLease is restricted to the explicit verificationOnly bash lane".into())
        }
        (false, true) => Err("verificationOnly requires evaluationLease".into()),
        (false, false) => {
            let cwd = cwd
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "cwd is required for bash_execute".to_string())?;
            Ok(BashWorkspaceLane::Catalog {
                cwd: PathBuf::from(cwd),
            })
        }
    }
}

fn reject_renderer_binding_for_bash(
    has_binding_claim: bool,
    _has_evaluation_lease: bool,
) -> Result<(), String> {
    if has_binding_claim {
        return Err(
            "renderer bash_execute does not accept bindingClaim; deterministic verification requires evaluationLease"
                .into(),
        );
    }
    Ok(())
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
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) is_file: bool,
    pub(crate) is_directory: bool,
    pub(crate) is_symlink: bool,
    pub(crate) size: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectPathMetadata {
    pub(crate) is_file: bool,
    pub(crate) is_directory: bool,
    pub(crate) is_symlink: bool,
    pub(crate) size: Option<u64>,
}

pub(crate) struct ProjectFileRead {
    pub(crate) bytes: Vec<u8>,
    pub(crate) version: String,
    pub(crate) mime_type: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ProjectFileMutationError {
    Conflict,
    Cancelled,
    File(String),
}

pub(crate) struct WorkspaceRoots {
    paths: Vec<PathBuf>,
    authorities: Vec<AuthorizedWorkspaceRoot>,
}

impl WorkspaceRoots {
    pub(crate) fn new(authorities: Vec<AuthorizedWorkspaceRoot>) -> Self {
        let paths = authorities
            .iter()
            .map(|authority| authority.path().to_path_buf())
            .collect();
        Self { paths, authorities }
    }

    fn authority_for(&self, path: &Path) -> Option<&AuthorizedWorkspaceRoot> {
        self.authorities
            .iter()
            .find(|authority| path.starts_with(authority.path()))
    }

    #[cfg(test)]
    pub(crate) fn from_live_paths(paths: &[PathBuf]) -> Result<Self, String> {
        paths
            .iter()
            .cloned()
            .map(AuthorizedWorkspaceRoot::from_live_path)
            .collect::<Result<Vec<_>, _>>()
            .map(Self::new)
    }
}

impl Deref for WorkspaceRoots {
    type Target = [PathBuf];

    fn deref(&self) -> &Self::Target {
        &self.paths
    }
}

pub(crate) async fn workspace_roots<R: Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: Option<&str>,
) -> Result<WorkspaceRoots, String> {
    let project_id = project_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "projectId is required for project workspace access".to_string())?;
    resolve_authorized_project_workspace(app, project_id)
        .await
        .map(|authority| WorkspaceRoots::new(vec![authority]))
}

pub(crate) async fn workspace_roots_for_access<R: Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: Option<&str>,
    binding_claim: Option<&TaskWorkspaceBindingClaim>,
    evaluation_lease: Option<&TaskWorkspaceEvaluationLeaseClaim>,
    requested_access: TaskWorkspaceAccess,
) -> Result<WorkspaceRoots, String> {
    if binding_claim.is_some() && evaluation_lease.is_some() {
        return Err("workspace access accepts bindingClaim or evaluationLease, never both".into());
    }
    if let Some(lease) = evaluation_lease {
        let root = resolve_task_workspace_evaluation_claim_authority(
            app,
            lease,
            project_id,
            requested_access,
        )
        .await?;
        return Ok(WorkspaceRoots::new(vec![root]));
    }
    if let Some(claim) = binding_claim {
        let root = resolve_task_workspace_claim_authority(app, claim, project_id, requested_access)
            .await?;
        return Ok(WorkspaceRoots::new(vec![root]));
    }
    workspace_roots(app, project_id).await
}

fn reject_renderer_cwd_for_workspace_authority(
    binding_claim: Option<&TaskWorkspaceBindingClaim>,
    evaluation_lease: Option<&TaskWorkspaceEvaluationLeaseClaim>,
    cwd: Option<&str>,
) -> Result<(), String> {
    if binding_claim.is_some() && evaluation_lease.is_some() {
        return Err("workspace access accepts bindingClaim or evaluationLease, never both".into());
    }
    if (binding_claim.is_some() || evaluation_lease.is_some())
        && cwd.map(str::trim).is_some_and(|value| !value.is_empty())
    {
        return Err("task workspace authority derives cwd from backend state; omit cwd".into());
    }
    Ok(())
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

pub(crate) fn resolve_project_candidate(
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

pub(crate) fn relativize_for_error(path: &Path, roots: &[PathBuf]) -> String {
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

pub(crate) fn ensure_inside_workspace(candidate: &Path, roots: &[PathBuf]) -> Result<(), String> {
    if roots.is_empty() {
        return Err("No Project folder is selected for this task.".to_string());
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

struct LineWindow<'a> {
    start_line: u32,
    selected: Vec<String>,
    retained_bytes: u64,
    max_lines: Option<usize>,
    path: &'a Path,
    roots: &'a [PathBuf],
}

fn push_line_window(
    line_no: u32,
    line: &mut Vec<u8>,
    window: &mut LineWindow<'_>,
) -> Result<bool, String> {
    if line_no < window.start_line {
        line.clear();
        return Ok(false);
    }
    window.retained_bytes = window.retained_bytes.saturating_add(line.len() as u64);
    if window.retained_bytes > MAX_READ_BYTES {
        return Err(line_window_size_error("window", window.path, window.roots));
    }
    while line.ends_with(b"\n") || line.ends_with(b"\r") {
        line.pop();
    }
    let bytes = std::mem::take(line);
    let text = String::from_utf8(bytes).map_err(|_| {
        format!(
            "project file line window contains invalid UTF-8: {}",
            relativize_for_error(window.path, window.roots)
        )
    })?;
    window.selected.push(text);
    Ok(window
        .max_lines
        .is_some_and(|limit| window.selected.len() >= limit))
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

#[cfg(unix)]
struct AnchoredProjectParent {
    directory: std::fs::File,
    leaf: std::ffi::CString,
}

#[cfg(unix)]
fn open_authorized_project_root(
    authority: &AuthorizedWorkspaceRoot,
    roots: &WorkspaceRoots,
) -> Result<std::fs::File, String> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;

    let root = authority.path();
    let mut directory = std::fs::File::open("/")
        .map_err(|err| fs_op_error("open filesystem root", Path::new("/"), roots, err))?;
    for component in root.components() {
        let name = match component {
            Component::RootDir => continue,
            Component::Normal(name) => name,
            _ => return Err("bound project workspace contains an invalid path component".into()),
        };
        let name = CString::new(name.as_bytes())
            .map_err(|_| "bound project workspace contains a NUL byte".to_string())?;
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(fs_op_error(
                "open bound project workspace without following symlinks",
                root,
                roots,
                std::io::Error::last_os_error(),
            ));
        }
        // SAFETY: openat returned a fresh owned descriptor on success.
        directory = std::fs::File::from(unsafe { OwnedFd::from_raw_fd(fd) });
    }
    let metadata = directory
        .metadata()
        .map_err(|error| fs_op_error("stat bound Project folder", root, roots, error))?;
    if !authority.matches_metadata(&metadata) {
        return Err("Project folder identity changed after it was selected.".into());
    }
    Ok(directory)
}

#[cfg(unix)]
fn open_project_parent_anchored(
    target: &Path,
    roots: &WorkspaceRoots,
    create_parents: bool,
) -> Result<AnchoredProjectParent, String> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;

    let authority = roots.authority_for(target).ok_or_else(|| {
        format!(
            "path is outside bound project workspaces: {}",
            relativize_for_error(target, roots)
        )
    })?;
    let root = authority.path();
    let relative = target
        .strip_prefix(root)
        .map_err(|_| "resolve project file target failed".to_string())?;
    let mut relative_components = relative.components().collect::<Vec<_>>();
    let leaf = match relative_components.pop() {
        Some(Component::Normal(name)) => name,
        _ => return Err("project file target has no file name".into()),
    };

    // Keep every traversal bound to opened directory objects. Symlink swaps
    // cannot redirect it; a later rename preserves the opened object identity.
    let mut directory = open_authorized_project_root(authority, roots)?;

    for component in relative_components {
        let Component::Normal(name) = component else {
            return Err("project file parent contains an invalid path component".into());
        };
        let name = CString::new(name.as_bytes())
            .map_err(|_| "project file parent contains a NUL byte".to_string())?;
        if create_parents {
            let created = unsafe { libc::mkdirat(directory.as_raw_fd(), name.as_ptr(), 0o755) };
            if created != 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() != std::io::ErrorKind::AlreadyExists {
                    return Err(fs_op_error(
                        "create project file parent",
                        target,
                        roots,
                        error,
                    ));
                }
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
            return Err(fs_op_error(
                "open project file parent without following symlinks",
                target,
                roots,
                std::io::Error::last_os_error(),
            ));
        }
        // SAFETY: openat returned a fresh owned descriptor on success.
        directory = std::fs::File::from(unsafe { OwnedFd::from_raw_fd(fd) });
    }

    Ok(AnchoredProjectParent {
        directory,
        leaf: CString::new(leaf.as_bytes())
            .map_err(|_| "project file name contains a NUL byte".to_string())?,
    })
}

fn verify_project_write_authority(target: &Path, roots: &WorkspaceRoots) -> Result<(), String> {
    roots
        .authority_for(target)
        .ok_or_else(|| "project file target is outside the bound workspace".to_string())?
        .verify_live()
}

#[cfg(unix)]
fn open_project_directory_anchored(
    target: &Path,
    roots: &WorkspaceRoots,
) -> Result<std::fs::File, String> {
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

    let authority = roots.authority_for(target).ok_or_else(|| {
        format!(
            "project directory is outside bound project workspaces: {}",
            relativize_for_error(target, roots)
        )
    })?;
    if target == authority.path() {
        return open_authorized_project_root(authority, roots);
    }
    let anchored = open_project_parent_anchored(target, roots, false)?;
    let fd = unsafe {
        libc::openat(
            anchored.directory.as_raw_fd(),
            anchored.leaf.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(fs_op_error(
            "open project directory without following symlinks",
            target,
            roots,
            std::io::Error::last_os_error(),
        ));
    }
    // SAFETY: openat returned a fresh owned descriptor on success.
    Ok(std::fs::File::from(unsafe { OwnedFd::from_raw_fd(fd) }))
}

#[cfg(unix)]
pub(crate) fn project_path_metadata_anchored(
    target: &Path,
    roots: &WorkspaceRoots,
) -> Result<Option<ProjectPathMetadata>, String> {
    use std::ffi::CString;
    use std::mem::MaybeUninit;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;

    let authority = roots.authority_for(target).ok_or_else(|| {
        format!(
            "path is outside bound project workspaces: {}",
            relativize_for_error(target, roots)
        )
    })?;
    if target == authority.path() {
        open_authorized_project_root(authority, roots)?;
        return Ok(Some(ProjectPathMetadata {
            is_file: false,
            is_directory: true,
            is_symlink: false,
            size: None,
        }));
    }
    let relative = target
        .strip_prefix(authority.path())
        .map_err(|_| "resolve project path failed".to_string())?;
    let mut components = relative.components().collect::<Vec<_>>();
    let leaf = match components.pop() {
        Some(Component::Normal(name)) => CString::new(name.as_bytes())
            .map_err(|_| "project path contains a NUL byte".to_string())?,
        _ => return Err("project path has no valid leaf".into()),
    };
    let mut directory = open_authorized_project_root(authority, roots)?;
    for component in components {
        let Component::Normal(name) = component else {
            return Err("project path contains an invalid component".into());
        };
        let name = CString::new(name.as_bytes())
            .map_err(|_| "project path contains a NUL byte".to_string())?;
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::NotFound {
                return Ok(None);
            }
            return Err(fs_op_error("open project path", target, roots, error));
        }
        // SAFETY: openat returned a fresh owned descriptor on success.
        directory = std::fs::File::from(unsafe { OwnedFd::from_raw_fd(fd) });
    }
    let mut stat = MaybeUninit::<libc::stat>::uninit();
    let result = unsafe {
        libc::fstatat(
            directory.as_raw_fd(),
            leaf.as_ptr(),
            stat.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    if result == 0 {
        // SAFETY: fstatat initialized the stat buffer on success.
        let stat = unsafe { stat.assume_init() };
        let file_kind = stat.st_mode & libc::S_IFMT;
        let is_file = file_kind == libc::S_IFREG;
        return Ok(Some(ProjectPathMetadata {
            is_file,
            is_directory: file_kind == libc::S_IFDIR,
            is_symlink: file_kind == libc::S_IFLNK,
            size: is_file.then_some(stat.st_size.max(0) as u64),
        }));
    }
    let error = std::io::Error::last_os_error();
    if error.kind() == std::io::ErrorKind::NotFound {
        Ok(None)
    } else {
        Err(fs_op_error("inspect project path", target, roots, error))
    }
}

#[cfg(unix)]
fn project_target_exists_anchored(target: &Path, roots: &WorkspaceRoots) -> Result<bool, String> {
    project_path_metadata_anchored(target, roots).map(|metadata| metadata.is_some())
}

#[cfg(not(unix))]
pub(crate) fn project_path_metadata_anchored(
    target: &Path,
    roots: &WorkspaceRoots,
) -> Result<Option<ProjectPathMetadata>, String> {
    let authority = roots.authority_for(target).ok_or_else(|| {
        format!(
            "path is outside bound project workspaces: {}",
            relativize_for_error(target, roots)
        )
    })?;
    authority.verify_live()?;
    if target == authority.path() {
        return Ok(Some(ProjectPathMetadata {
            is_file: false,
            is_directory: true,
            is_symlink: false,
            size: None,
        }));
    }
    let parent = target
        .parent()
        .ok_or_else(|| "project path has no parent".to_string())?;
    let canonical_parent = match parent.canonicalize() {
        Ok(parent) => parent,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(fs_resolve_error(
                "resolve project path parent",
                parent,
                error,
            ))
        }
    };
    ensure_inside_workspace(&canonical_parent, roots)?;
    let leaf = target
        .file_name()
        .ok_or_else(|| "project path has no valid leaf".to_string())?;
    let candidate = canonical_parent.join(leaf);
    let metadata = match std::fs::symlink_metadata(&candidate) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(fs_op_error(
                "inspect project path",
                &candidate,
                roots,
                error,
            ))
        }
    };
    authority.verify_live()?;
    if parent
        .canonicalize()
        .map_err(|error| fs_resolve_error("recheck project path parent", parent, error))?
        != canonical_parent
    {
        return Err("Project path parent identity changed during access.".into());
    }
    let file_type = metadata.file_type();
    Ok(Some(ProjectPathMetadata {
        is_file: file_type.is_file(),
        is_directory: file_type.is_dir(),
        is_symlink: file_type.is_symlink(),
        size: file_type.is_file().then_some(metadata.len()),
    }))
}

#[cfg(unix)]
fn list_open_project_directory_anchored(
    directory: &std::fs::File,
    target: &Path,
    relative_dir: &Path,
    roots: &WorkspaceRoots,
    max_entries: usize,
) -> Result<Vec<ProjectDirEntry>, String> {
    use std::ffi::CStr;
    use std::mem::MaybeUninit;
    use std::os::fd::AsRawFd;
    use std::os::unix::ffi::OsStrExt;

    struct DirectoryStream(*mut libc::DIR);
    impl Drop for DirectoryStream {
        fn drop(&mut self) {
            unsafe {
                libc::closedir(self.0);
            }
        }
    }

    let duplicated = unsafe { libc::dup(directory.as_raw_fd()) };
    if duplicated < 0 {
        return Err(fs_op_error(
            "duplicate project directory descriptor",
            target,
            roots,
            std::io::Error::last_os_error(),
        ));
    }
    let raw_stream = unsafe { libc::fdopendir(duplicated) };
    if raw_stream.is_null() {
        let error = std::io::Error::last_os_error();
        unsafe {
            libc::close(duplicated);
        }
        return Err(fs_op_error(
            "open project directory stream",
            target,
            roots,
            error,
        ));
    }
    let stream = DirectoryStream(raw_stream);
    let mut rows = Vec::new();
    while rows.len() < max_entries {
        #[cfg(target_vendor = "apple")]
        unsafe {
            *libc::__error() = 0;
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        unsafe {
            *libc::__errno_location() = 0;
        }
        let raw_entry = unsafe { libc::readdir(stream.0) };
        if raw_entry.is_null() {
            #[cfg(target_vendor = "apple")]
            {
                let errno = unsafe { *libc::__error() };
                if errno != 0 {
                    return Err(fs_op_error(
                        "read project directory entry",
                        target,
                        roots,
                        std::io::Error::from_raw_os_error(errno),
                    ));
                }
            }
            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                let errno = unsafe { *libc::__errno_location() };
                if errno != 0 {
                    return Err(fs_op_error(
                        "read project directory entry",
                        target,
                        roots,
                        std::io::Error::from_raw_os_error(errno),
                    ));
                }
            }
            break;
        }
        let name_bytes = unsafe { CStr::from_ptr((*raw_entry).d_name.as_ptr()) }.to_bytes();
        if name_bytes == b"." || name_bytes == b".." {
            continue;
        }
        let name = std::ffi::OsStr::from_bytes(name_bytes);
        let mut stat = MaybeUninit::<libc::stat>::uninit();
        let stated = unsafe {
            libc::fstatat(
                directory.as_raw_fd(),
                (*raw_entry).d_name.as_ptr(),
                stat.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        if stated != 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::NotFound {
                continue;
            }
            return Err(fs_op_error(
                "stat project directory entry",
                &target.join(name),
                roots,
                error,
            ));
        }
        // SAFETY: fstatat initialized the stat buffer on success.
        let stat = unsafe { stat.assume_init() };
        let file_kind = stat.st_mode & libc::S_IFMT;
        let is_file = file_kind == libc::S_IFREG;
        let is_directory = file_kind == libc::S_IFDIR;
        let is_symlink = file_kind == libc::S_IFLNK;
        rows.push(ProjectDirEntry {
            name: name.to_string_lossy().to_string(),
            path: relative_dir.join(name).to_string_lossy().to_string(),
            is_file,
            is_directory,
            is_symlink,
            size: is_file.then_some(stat.st_size.max(0) as u64),
        });
    }
    rows.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(rows)
}

#[cfg(unix)]
pub(crate) fn list_project_directory_anchored(
    target: &Path,
    roots: &WorkspaceRoots,
    max_entries: usize,
) -> Result<Vec<ProjectDirEntry>, String> {
    let authority = roots.authority_for(target).ok_or_else(|| {
        format!(
            "project directory is outside bound project workspaces: {}",
            relativize_for_error(target, roots)
        )
    })?;
    let relative_dir = target
        .strip_prefix(authority.path())
        .map_err(|_| "project directory is outside bound project workspaces".to_string())?;
    let directory = open_project_directory_anchored(target, roots)?;
    list_open_project_directory_anchored(&directory, target, relative_dir, roots, max_entries)
}

#[cfg(not(unix))]
pub(crate) fn list_project_directory_anchored(
    target: &Path,
    roots: &WorkspaceRoots,
    max_entries: usize,
) -> Result<Vec<ProjectDirEntry>, String> {
    let authority = roots.authority_for(target).ok_or_else(|| {
        format!(
            "project directory is outside bound project workspaces: {}",
            relativize_for_error(target, roots)
        )
    })?;
    authority.verify_live()?;
    let canonical = target
        .canonicalize()
        .map_err(|error| fs_resolve_error("resolve project directory", target, error))?;
    ensure_inside_workspace(&canonical, roots)?;
    let relative_dir = canonical
        .strip_prefix(authority.path())
        .map_err(|_| "project directory is outside bound project workspaces".to_string())?;
    let mut rows = Vec::new();
    for entry in std::fs::read_dir(&canonical)
        .map_err(|error| fs_op_error("list project directory", &canonical, roots, error))?
    {
        if rows.len() >= max_entries {
            break;
        }
        let entry = entry.map_err(|error| {
            fs_op_error("read project directory entry", &canonical, roots, error)
        })?;
        let metadata = std::fs::symlink_metadata(entry.path()).map_err(|error| {
            fs_op_error("stat project directory entry", &entry.path(), roots, error)
        })?;
        let file_type = metadata.file_type();
        rows.push(ProjectDirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: relative_dir
                .join(entry.file_name())
                .to_string_lossy()
                .to_string(),
            is_file: file_type.is_file(),
            is_directory: file_type.is_dir(),
            is_symlink: file_type.is_symlink(),
            size: file_type.is_file().then_some(metadata.len()),
        });
    }
    rows.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(rows)
}

pub(crate) fn ensure_safe_project_file_metadata(
    metadata: &std::fs::Metadata,
    path: &Path,
    roots: &[PathBuf],
) -> Result<(), String> {
    if !metadata.file_type().is_file() {
        return Err(format!(
            "project file must be a regular file: {}",
            relativize_for_error(path, roots)
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(format!(
                "project file with multiple hard links is outside the workspace trust boundary: {}",
                relativize_for_error(path, roots)
            ));
        }
    }
    Ok(())
}

#[cfg(unix)]
pub(crate) fn open_project_read_target_anchored(
    target: &Path,
    roots: &WorkspaceRoots,
) -> Result<std::fs::File, String> {
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

    let anchored = open_project_parent_anchored(target, roots, false)?;
    let fd = unsafe {
        libc::openat(
            anchored.directory.as_raw_fd(),
            anchored.leaf.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(fs_op_error(
            "open project file",
            target,
            roots,
            std::io::Error::last_os_error(),
        ));
    }
    // SAFETY: openat returned a fresh owned descriptor on success.
    let file = std::fs::File::from(unsafe { OwnedFd::from_raw_fd(fd) });
    let metadata = file
        .metadata()
        .map_err(|error| fs_op_error("stat project file", target, roots, error))?;
    ensure_safe_project_file_metadata(&metadata, target, roots)?;
    Ok(file)
}

#[cfg(unix)]
fn write_project_file_anchored_guarded<F>(
    target: &Path,
    roots: &WorkspaceRoots,
    content: &[u8],
    before_commit: F,
) -> Result<(), String>
where
    F: Fn() -> Result<(), String>,
{
    use std::ffi::CString;
    use std::mem::MaybeUninit;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

    let anchored = open_project_parent_anchored(target, roots, true)?;
    let mut existing_stat = MaybeUninit::<libc::stat>::uninit();
    let existing_stat_result = unsafe {
        libc::fstatat(
            anchored.directory.as_raw_fd(),
            anchored.leaf.as_ptr(),
            existing_stat.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    let preserved_mode = if existing_stat_result == 0 {
        // SAFETY: fstatat initialized the stat buffer on success.
        let stat = unsafe { existing_stat.assume_init() };
        let is_regular = stat.st_mode & libc::S_IFMT == libc::S_IFREG;
        if is_regular && stat.st_nlink == 1 {
            Some(stat.st_mode & 0o777)
        } else {
            // Symlinks and multiply-linked files are replaced with a fresh,
            // non-executable entry; their metadata is not trusted/inherited.
            None
        }
    } else {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::NotFound {
            None
        } else {
            return Err(fs_op_error(
                "inspect existing project file",
                target,
                roots,
                error,
            ));
        }
    };
    for _ in 0..16 {
        let temp_name = CString::new(format!(
            ".offisim-write-{}-{:016x}",
            std::process::id(),
            rand::random::<u64>()
        ))
        .map_err(|_| "temporary project file name is invalid".to_string())?;
        if temp_name.as_bytes() == anchored.leaf.as_bytes() {
            continue;
        }
        let fd = unsafe {
            libc::openat(
                anchored.directory.as_raw_fd(),
                temp_name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o666,
            )
        };
        if fd < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                continue;
            }
            return Err(fs_op_error(
                "create temporary project file",
                target,
                roots,
                error,
            ));
        }
        if let Some(mode) = preserved_mode {
            if unsafe { libc::fchmod(fd, mode) } != 0 {
                let error = std::io::Error::last_os_error();
                unsafe {
                    libc::close(fd);
                    libc::unlinkat(anchored.directory.as_raw_fd(), temp_name.as_ptr(), 0);
                }
                return Err(fs_op_error(
                    "preserve project file permissions",
                    target,
                    roots,
                    error,
                ));
            }
        }
        // SAFETY: openat returned a fresh owned descriptor on success.
        let mut file = std::fs::File::from(unsafe { OwnedFd::from_raw_fd(fd) });
        let write_result = file.write_all(content).and_then(|()| file.sync_all());
        if let Err(error) = write_result {
            unsafe {
                libc::unlinkat(anchored.directory.as_raw_fd(), temp_name.as_ptr(), 0);
            }
            return Err(fs_op_error(
                "write temporary project file",
                target,
                roots,
                error,
            ));
        }
        if let Err(error) = before_commit() {
            unsafe {
                libc::unlinkat(anchored.directory.as_raw_fd(), temp_name.as_ptr(), 0);
            }
            return Err(error);
        }
        if let Err(error) = verify_project_write_authority(target, roots) {
            unsafe {
                libc::unlinkat(anchored.directory.as_raw_fd(), temp_name.as_ptr(), 0);
            }
            return Err(error);
        }
        let renamed = unsafe {
            libc::renameat(
                anchored.directory.as_raw_fd(),
                temp_name.as_ptr(),
                anchored.directory.as_raw_fd(),
                anchored.leaf.as_ptr(),
            )
        };
        if renamed != 0 {
            let error = std::io::Error::last_os_error();
            unsafe {
                libc::unlinkat(anchored.directory.as_raw_fd(), temp_name.as_ptr(), 0);
            }
            return Err(fs_op_error("replace project file", target, roots, error));
        }
        anchored
            .directory
            .sync_all()
            .map_err(|error| fs_op_error("flush project file parent", target, roots, error))?;
        return Ok(());
    }
    Err("Could not allocate a unique temporary project file".into())
}

#[cfg(not(unix))]
pub(crate) fn open_project_read_target_anchored(
    target: &Path,
    roots: &WorkspaceRoots,
) -> Result<std::fs::File, String> {
    let authority = roots.authority_for(target).ok_or_else(|| {
        format!(
            "path is outside bound project workspaces: {}",
            relativize_for_error(target, roots)
        )
    })?;
    authority.verify_live()?;
    let parent = target
        .parent()
        .ok_or_else(|| "project file target has no parent".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| fs_resolve_error("resolve project file parent", parent, error))?;
    ensure_inside_workspace(&canonical_parent, roots)?;
    let leaf = target
        .file_name()
        .ok_or_else(|| "project file target has no file name".to_string())?;
    let candidate = canonical_parent.join(leaf);
    let leaf_metadata = std::fs::symlink_metadata(&candidate)
        .map_err(|error| fs_op_error("inspect project file", &candidate, roots, error))?;
    if leaf_metadata.file_type().is_symlink() {
        return Err("project file target cannot be a symlink".into());
    }
    let file = std::fs::File::open(&candidate)
        .map_err(|err| fs_op_error("open project file", &candidate, roots, err))?;
    let metadata = file
        .metadata()
        .map_err(|err| fs_op_error("stat project file", &candidate, roots, err))?;
    ensure_safe_project_file_metadata(&metadata, &candidate, roots)?;
    authority.verify_live()?;
    if parent
        .canonicalize()
        .map_err(|error| fs_resolve_error("recheck project file parent", parent, error))?
        != canonical_parent
    {
        return Err("Project file parent identity changed during access.".into());
    }
    Ok(file)
}

#[cfg(not(unix))]
fn write_project_file_anchored_guarded<F>(
    target: &Path,
    roots: &WorkspaceRoots,
    content: &[u8],
    before_commit: F,
) -> Result<(), String>
where
    F: Fn() -> Result<(), String>,
{
    let parent = target
        .parent()
        .ok_or_else(|| "project file target has no parent".to_string())?;
    let root = roots
        .iter()
        .find(|root| target.starts_with(root))
        .ok_or_else(|| "project file target is outside the bound workspace".to_string())?;
    let relative = parent
        .strip_prefix(root)
        .map_err(|_| "project file target is outside the bound workspace".to_string())?;
    let mut current = root.clone();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err("project file parent contains an invalid path component".into());
        };
        current.push(name);
        match std::fs::create_dir(&current) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(fs_op_error(
                    "create project file parent",
                    &current,
                    roots,
                    error,
                ))
            }
        }
        let metadata = std::fs::symlink_metadata(&current)
            .map_err(|error| fs_op_error("inspect project file parent", &current, roots, error))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("project file parent cannot traverse a symlink".into());
        }
        let canonical = current
            .canonicalize()
            .map_err(|error| fs_resolve_error("resolve project file parent", &current, error))?;
        ensure_inside_workspace(&canonical, roots)?;
        current = canonical;
    }
    for _ in 0..16 {
        let temporary = current.join(format!(
            ".offisim-write-{}-{:016x}",
            std::process::id(),
            rand::random::<u64>()
        ));
        let mut file = match OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(fs_op_error(
                    "create temporary project file",
                    &temporary,
                    roots,
                    error,
                ))
            }
        };
        if let Err(error) = file.write_all(content).and_then(|()| file.sync_all()) {
            let _ = std::fs::remove_file(&temporary);
            return Err(fs_op_error(
                "write temporary project file",
                &temporary,
                roots,
                error,
            ));
        }
        if let Err(error) = before_commit() {
            let _ = std::fs::remove_file(&temporary);
            return Err(error);
        }
        if let Err(error) = verify_project_write_authority(target, roots) {
            let _ = std::fs::remove_file(&temporary);
            return Err(error);
        }
        match std::fs::remove_file(target) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                let _ = std::fs::remove_file(&temporary);
                return Err(fs_op_error("replace project file", target, roots, error));
            }
        }
        return std::fs::rename(&temporary, target)
            .map_err(|error| fs_op_error("replace project file", target, roots, error));
    }
    Err("Could not allocate a unique temporary project file".into())
}

pub(crate) fn write_project_file_anchored(
    target: &Path,
    roots: &WorkspaceRoots,
    content: &[u8],
) -> Result<(), String> {
    let _mutation_guard = PROJECT_FILE_MUTATION_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    write_project_file_anchored_guarded(target, roots, content, || Ok(()))
}

fn project_file_version(metadata: &std::fs::Metadata, bytes: &[u8]) -> String {
    let digest = hex::encode(Sha256::digest(bytes));
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        format!(
            "v1:{:x}:{:x}:{}:{digest}",
            metadata.dev(),
            metadata.ino(),
            bytes.len()
        )
    }
    #[cfg(not(unix))]
    {
        format!("v1:{}:{digest}", bytes.len())
    }
}

fn read_to_hard_limit(
    reader: &mut impl StdRead,
    initial_size: u64,
    max_bytes: u64,
) -> std::io::Result<(Vec<u8>, bool)> {
    let mut bytes = Vec::with_capacity(initial_size.min(max_bytes) as usize);
    reader
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)?;
    let exceeded = bytes.len() as u64 > max_bytes;
    Ok((bytes, exceeded))
}

pub(crate) fn read_project_file_anchored_bytes(
    target: &Path,
    roots: &WorkspaceRoots,
) -> Result<ProjectFileRead, String> {
    let mut file = open_project_read_target_anchored(target, roots)?;
    let metadata = file
        .metadata()
        .map_err(|error| fs_op_error("stat project file", target, roots, error))?;
    ensure_read_size(metadata.len(), target, roots)?;
    let (bytes, exceeded) = read_to_hard_limit(&mut file, metadata.len(), MAX_READ_BYTES)
        .map_err(|error| fs_op_error("read project file", target, roots, error))?;
    if exceeded {
        ensure_read_size(MAX_READ_BYTES.saturating_add(1), target, roots)?;
    }
    let version = project_file_version(&metadata, &bytes);
    let mime_type = infer::get(&bytes[..bytes.len().min(8192)])
        .map(|kind| kind.mime_type().to_string())
        .filter(|mime| {
            matches!(
                mime.as_str(),
                "image/jpeg" | "image/png" | "image/gif" | "image/webp"
            )
        });
    Ok(ProjectFileRead {
        bytes,
        version,
        mime_type,
    })
}

pub(crate) fn write_project_file_anchored_bytes(
    target: &Path,
    roots: &WorkspaceRoots,
    content: &[u8],
    expected_version: Option<&str>,
    cancellation: Option<&CancellationToken>,
) -> Result<(), ProjectFileMutationError> {
    let _mutation_guard = PROJECT_FILE_MUTATION_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    ensure_write_size(content.len(), target, roots).map_err(ProjectFileMutationError::File)?;
    let result = write_project_file_anchored_guarded(target, roots, content, || {
        if cancellation.is_some_and(CancellationToken::is_cancelled) {
            return Err(PROJECT_FILE_CANCELLED_SENTINEL.into());
        }
        if let Some(expected_version) = expected_version {
            let current = read_project_file_anchored_bytes(target, roots)?;
            if current.version != expected_version {
                return Err(PROJECT_FILE_CONFLICT_SENTINEL.into());
            }
        }
        if cancellation.is_some_and(CancellationToken::is_cancelled) {
            return Err(PROJECT_FILE_CANCELLED_SENTINEL.into());
        }
        Ok(())
    });
    match result {
        Ok(()) => Ok(()),
        Err(error) if error == PROJECT_FILE_CONFLICT_SENTINEL => {
            Err(ProjectFileMutationError::Conflict)
        }
        Err(error) if error == PROJECT_FILE_CANCELLED_SENTINEL => {
            Err(ProjectFileMutationError::Cancelled)
        }
        Err(error) => Err(ProjectFileMutationError::File(error)),
    }
}

pub(crate) fn fs_resolve_error<E: std::fmt::Display>(stage: &str, path: &Path, err: E) -> String {
    eprintln!(
        "[builtin_tools] {stage} {} failed: {err}",
        path.to_string_lossy()
    );
    format!("{stage} failed")
}

pub(crate) fn fs_op_error(
    stage: &str,
    path: &Path,
    roots: &[PathBuf],
    err: std::io::Error,
) -> String {
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
    let _ = app;
    let Ok(dir) = crate::local_paths::offisim_home_dir() else {
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
    // Union allowlist policy (base + SSH_AUTH_SOCK) shared with the git lane.
    crate::env_scrub::scrubbed_child_env()
}

#[cfg(not(unix))]
fn relative_path_for_entry(root: &Path, entry_path: &Path) -> String {
    entry_path
        .strip_prefix(root)
        .unwrap_or(entry_path)
        .to_string_lossy()
        .trim_start_matches(std::path::MAIN_SEPARATOR)
        .to_string()
}

#[cfg(not(unix))]
fn containing_root<'a>(candidate: &Path, roots: &'a [PathBuf]) -> Option<&'a PathBuf> {
    roots.iter().find(|root| candidate.starts_with(*root))
}

/// UTF-8 boundary safety: convert `bytes` to a String. If the buffer ends
/// mid-codepoint, walk back to the last valid UTF-8 boundary so callers always
/// get a clean string. Returns the empty string if the walk-back yields zero
/// valid bytes (e.g. all-binary preview).
pub(crate) fn utf8_boundary_safe_string(bytes: Vec<u8>) -> String {
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
    binding_claim: Option<TaskWorkspaceBindingClaim>,
    evaluation_lease: Option<TaskWorkspaceEvaluationLeaseClaim>,
) -> Result<ProjectFilePreview, String> {
    reject_renderer_cwd_for_workspace_authority(
        binding_claim.as_ref(),
        evaluation_lease.as_ref(),
        cwd.as_deref(),
    )?;
    let roots = workspace_roots_for_access(
        &app,
        project_id.as_deref(),
        binding_claim.as_ref(),
        evaluation_lease.as_ref(),
        TaskWorkspaceAccess::Read,
    )
    .await?;
    let candidate = resolve_project_candidate(&path, cwd.as_deref(), &roots)?;
    let canonical = candidate
        .canonicalize()
        .map_err(|err| fs_resolve_error("resolve project file", &candidate, err))?;
    ensure_inside_workspace(&canonical, &roots)?;

    // Open once and stat via the file handle — saves the redundant `metadata()`
    // syscall the previous draft did before opening.
    let file = tokio::fs::File::from_std(open_project_read_target_anchored(&canonical, &roots)?);
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
    binding_claim: Option<TaskWorkspaceBindingClaim>,
    evaluation_lease: Option<TaskWorkspaceEvaluationLeaseClaim>,
) -> Result<String, String> {
    reject_renderer_cwd_for_workspace_authority(
        binding_claim.as_ref(),
        evaluation_lease.as_ref(),
        cwd.as_deref(),
    )?;
    let roots = workspace_roots_for_access(
        &app,
        project_id.as_deref(),
        binding_claim.as_ref(),
        evaluation_lease.as_ref(),
        TaskWorkspaceAccess::Read,
    )
    .await?;
    let candidate = resolve_project_candidate(&path, cwd.as_deref(), &roots)?;
    let canonical = candidate
        .canonicalize()
        .map_err(|err| fs_resolve_error("resolve project file", &candidate, err))?;
    ensure_inside_workspace(&canonical, &roots)?;
    let mut file =
        tokio::fs::File::from_std(open_project_read_target_anchored(&canonical, &roots)?);
    let metadata = file
        .metadata()
        .await
        .map_err(|err| fs_op_error("stat project file", &canonical, &roots, err))?;
    ensure_read_size(metadata.len(), &canonical, &roots)?;
    let mut content = String::new();
    file.read_to_string(&mut content)
        .await
        .map_err(|err| fs_op_error("read project file", &canonical, &roots, err))?;
    Ok(content)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri command arguments mirror the stable renderer wire.
pub async fn project_read_file_lines<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    cwd: Option<String>,
    project_id: Option<String>,
    offset: u32,
    limit: Option<u32>,
    binding_claim: Option<TaskWorkspaceBindingClaim>,
    evaluation_lease: Option<TaskWorkspaceEvaluationLeaseClaim>,
) -> Result<String, String> {
    reject_renderer_cwd_for_workspace_authority(
        binding_claim.as_ref(),
        evaluation_lease.as_ref(),
        cwd.as_deref(),
    )?;
    let roots = workspace_roots_for_access(
        &app,
        project_id.as_deref(),
        binding_claim.as_ref(),
        evaluation_lease.as_ref(),
        TaskWorkspaceAccess::Read,
    )
    .await?;
    let candidate = resolve_project_candidate(&path, cwd.as_deref(), &roots)?;
    let canonical = candidate
        .canonicalize()
        .map_err(|err| fs_resolve_error("resolve project file", &candidate, err))?;
    ensure_inside_workspace(&canonical, &roots)?;

    let file = tokio::fs::File::from_std(open_project_read_target_anchored(&canonical, &roots)?);
    let mut reader = BufReader::new(file);
    let mut line_no = 1_u32;
    let mut window = LineWindow {
        start_line: offset.max(1),
        selected: Vec::new(),
        retained_bytes: 0,
        max_lines: limit.map(|value| value.max(1) as usize),
        path: &canonical,
        roots: &roots,
    };

    let mut scanned_bytes = 0_u64;
    let mut line = Vec::new();
    let mut buf = [0_u8; 8192];
    loop {
        let read = reader
            .read(&mut buf)
            .await
            .map_err(|err| fs_op_error("read project file lines", &canonical, &roots, err))?;
        if read == 0 {
            if !line.is_empty() && push_line_window(line_no, &mut line, &mut window)? {
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
                if push_line_window(line_no, &mut line, &mut window)? {
                    return Ok(format!("{}\n", window.selected.join("\n")));
                }
                line_no = line_no.saturating_add(1);
            }
        }
    }

    if window.selected.is_empty() {
        Ok(String::new())
    } else {
        Ok(format!("{}\n", window.selected.join("\n")))
    }
}

#[tauri::command]
pub async fn project_exists<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    cwd: Option<String>,
    project_id: Option<String>,
    binding_claim: Option<TaskWorkspaceBindingClaim>,
    evaluation_lease: Option<TaskWorkspaceEvaluationLeaseClaim>,
) -> Result<bool, String> {
    reject_renderer_cwd_for_workspace_authority(
        binding_claim.as_ref(),
        evaluation_lease.as_ref(),
        cwd.as_deref(),
    )?;
    let roots = workspace_roots_for_access(
        &app,
        project_id.as_deref(),
        binding_claim.as_ref(),
        evaluation_lease.as_ref(),
        TaskWorkspaceAccess::Read,
    )
    .await?;
    let candidate = resolve_project_candidate(&path, cwd.as_deref(), &roots)?;
    #[cfg(unix)]
    {
        project_target_exists_anchored(&candidate, &roots)
    }
    #[cfg(not(unix))]
    {
        let canonical = match candidate.canonicalize() {
            Ok(path) => path,
            Err(_) => return Ok(false),
        };
        if ensure_inside_workspace(&canonical, &roots).is_err() {
            return Ok(false);
        }
        Ok(tokio::fs::metadata(&canonical).await.is_ok())
    }
}

#[tauri::command]
pub async fn project_list_dir<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    cwd: Option<String>,
    project_id: Option<String>,
    binding_claim: Option<TaskWorkspaceBindingClaim>,
    evaluation_lease: Option<TaskWorkspaceEvaluationLeaseClaim>,
) -> Result<Vec<ProjectDirEntry>, String> {
    reject_renderer_cwd_for_workspace_authority(
        binding_claim.as_ref(),
        evaluation_lease.as_ref(),
        cwd.as_deref(),
    )?;
    let roots = workspace_roots_for_access(
        &app,
        project_id.as_deref(),
        binding_claim.as_ref(),
        evaluation_lease.as_ref(),
        TaskWorkspaceAccess::Read,
    )
    .await?;
    let candidate = resolve_project_candidate(&path, cwd.as_deref(), &roots)?;
    #[cfg(unix)]
    {
        list_project_directory_anchored(&candidate, &roots, 300)
    }
    #[cfg(not(unix))]
    {
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
            let file_type = entry.file_type().await.map_err(|err| {
                fs_op_error("stat project directory entry", &entry_path, &roots, err)
            })?;
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
}

#[tauri::command]
pub async fn project_write_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    content: String,
    cwd: Option<String>,
    project_id: Option<String>,
    binding_claim: Option<TaskWorkspaceBindingClaim>,
    evaluation_lease: Option<TaskWorkspaceEvaluationLeaseClaim>,
) -> Result<(), String> {
    reject_renderer_cwd_for_workspace_authority(
        binding_claim.as_ref(),
        evaluation_lease.as_ref(),
        cwd.as_deref(),
    )?;
    let roots = workspace_roots_for_access(
        &app,
        project_id.as_deref(),
        binding_claim.as_ref(),
        evaluation_lease.as_ref(),
        TaskWorkspaceAccess::Write,
    )
    .await?;
    let candidate = resolve_project_candidate(&path, cwd.as_deref(), &roots)?;
    ensure_write_size(content.len(), &candidate, &roots)?;
    let target = resolve_write_target(&candidate, &roots)?;
    ensure_inside_workspace(&target, &roots)?;
    write_project_file_anchored(&target, &roots, content.as_bytes())
}

#[allow(clippy::too_many_arguments)]
async fn execute_shell_in_workspace<R: Runtime>(
    app: &tauri::AppHandle<R>,
    roots: &WorkspaceRoots,
    cwd_path: &Path,
    cmd: &str,
    timeout_ms: u32,
    max_output_bytes: Option<u32>,
    project_id: &str,
    approval_id: Option<&str>,
    employee_id: Option<&str>,
    network_policy: &str,
    shell_path: Option<&str>,
    prepared_execution: Option<AuthorizedProcessCwd>,
    command_policy: ShellCommandPolicy,
    cancellation: Option<&CancellationToken>,
    authority_monitor: ShellAuthorityMonitor<'_>,
    lane: ShellExecutionLane,
) -> Result<BashExecuteResult, String> {
    if command_policy == ShellCommandPolicy::ClassifierBounded {
        ensure_shell_command_allowed(cmd)?;
    }
    let execution = match prepared_execution {
        Some(execution) => {
            if execution.cwd() != cwd_path {
                return Err("Prepared shell authority does not match its requested cwd".into());
            }
            execution.verify_live()?;
            execution
        }
        None => {
            let authority = roots
                .authority_for(cwd_path)
                .ok_or_else(|| "Shell cwd has no matching Project authority".to_string())?;
            AuthorizedProcessCwd::from_authority(authority, cwd_path)?
        }
    };
    verify_shell_authority(
        app,
        authority_monitor,
        &execution,
        ShellAuthorityPhase::BeforeSpawn,
    )
    .await?;

    let (
        spawn_operation,
        stdout_label,
        stderr_label,
        capture_stdout_error,
        capture_stderr_error,
        cleanup_error_prefix,
        io_error_prefix,
        wait_operation,
    ) = match lane {
        ShellExecutionLane::Task => (
            "spawn bash in",
            "task Bash stdout",
            "task Bash stderr",
            "Capture task Bash stdout failed.",
            "Capture task Bash stderr failed.",
            "Task Bash lifetime cleanup failed",
            "Task Bash I/O failed",
            "wait for bash in",
        ),
        ShellExecutionLane::Evaluation => (
            "spawn evaluation bash in",
            "evaluation stdout",
            "evaluation stderr",
            "Capture evaluation bash stdout failed.",
            "Capture evaluation bash stderr failed.",
            "Evaluation shell lifetime cleanup failed",
            "Evaluation shell I/O failed",
            "wait for evaluation bash in",
        ),
    };

    let mut command = Command::new(shell_path.unwrap_or("bash"));
    command
        .arg("-c")
        .arg(cmd)
        .env_clear()
        .envs(scrubbed_shell_env())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut lifetime_marker = ShellLifetimeMarker::new()?;
    configure_process_group(&mut command);
    execution.bind_command(&mut command)?;
    lifetime_marker.bind_command(&mut command)?;
    let mut child = command
        .spawn()
        .map_err(|err| fs_op_error(spawn_operation, cwd_path, roots, err))?;
    let process_group_id = child.id();
    let mut process_group_guard = ProcessGroupGuard::new(process_group_id);
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| capture_stdout_error.to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| capture_stderr_error.to_string())?;

    let max_bytes = bounded_evaluation_output_bytes(max_output_bytes);
    let mut stdout_reader = tokio::spawn(read_bounded_pipe(stdout, max_bytes));
    let mut stderr_reader = tokio::spawn(read_bounded_pipe(stderr, max_bytes));
    let deadline = tokio::time::sleep(Duration::from_millis(u64::from(timeout_ms.max(1))));
    tokio::pin!(deadline);
    let cancellation_wait = async {
        match cancellation {
            Some(token) => token.cancelled().await,
            None => std::future::pending::<()>().await,
        }
    };
    tokio::pin!(cancellation_wait);
    let mut authority_poll = interval(Duration::from_millis(EVALUATION_AUTHORITY_POLL_MS));
    authority_poll.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut stdout_output = None;
    let mut stderr_output = None;
    let mut end = loop {
        tokio::select! {
            status = child.wait() => {
                signal_evaluation_process_group(process_group_id);
                break BoundedShellEnd::Completed(status);
            },
            output = &mut stdout_reader, if stdout_output.is_none() => {
                match output {
                    Ok(Ok(output)) if output.truncated => {
                        stdout_output = Some(output.bytes);
                        break BoundedShellEnd::OutputLimit;
                    }
                    Ok(Ok(output)) => stdout_output = Some(output.bytes),
                    Ok(Err(error)) => break BoundedShellEnd::IoFailed(
                        format!("Read {stdout_label}: {error}"),
                    ),
                    Err(error) => break BoundedShellEnd::IoFailed(
                        format!("Join {stdout_label} reader: {error}"),
                    ),
                }
            },
            output = &mut stderr_reader, if stderr_output.is_none() => {
                match output {
                    Ok(Ok(output)) if output.truncated => {
                        stderr_output = Some(output.bytes);
                        break BoundedShellEnd::OutputLimit;
                    }
                    Ok(Ok(output)) => stderr_output = Some(output.bytes),
                    Ok(Err(error)) => break BoundedShellEnd::IoFailed(
                        format!("Read {stderr_label}: {error}"),
                    ),
                    Err(error) => break BoundedShellEnd::IoFailed(
                        format!("Join {stderr_label} reader: {error}"),
                    ),
                }
            },
            _ = &mut deadline => break BoundedShellEnd::TimedOut,
            _ = &mut cancellation_wait => break BoundedShellEnd::Cancelled,
            _ = authority_poll.tick() => {
                if let Err(error) = verify_shell_authority(
                    app,
                    authority_monitor,
                    &execution,
                    ShellAuthorityPhase::Running,
                ).await {
                    break BoundedShellEnd::AuthorityLost(error);
                }
            },
        }
    };

    terminate_evaluation_process_group(&mut child, process_group_id).await;
    if let Err(error) = lifetime_marker.terminate_holders().await {
        stdout_reader.abort();
        stderr_reader.abort();
        return Err(format!("{cleanup_error_prefix}: {error}"));
    }
    process_group_guard.disarm();
    let needs_final_authority_check = match lane {
        ShellExecutionLane::Task => !matches!(
            end,
            BoundedShellEnd::Cancelled
                | BoundedShellEnd::OutputLimit
                | BoundedShellEnd::IoFailed(_)
        ),
        ShellExecutionLane::Evaluation => matches!(end, BoundedShellEnd::Completed(_)),
    };
    if needs_final_authority_check {
        if let Err(error) = verify_shell_authority(
            app,
            authority_monitor,
            &execution,
            ShellAuthorityPhase::Completion,
        )
        .await
        {
            end = BoundedShellEnd::AuthorityLost(error);
        }
    }
    if let BoundedShellEnd::IoFailed(error) = &end {
        stdout_reader.abort();
        stderr_reader.abort();
        return Err(format!("{io_error_prefix}: {error}"));
    }
    let stdout = match stdout_output {
        Some(bytes) => bytes,
        None => match finish_bounded_pipe_reader(&mut stdout_reader, stdout_label).await {
            Ok(output) => {
                if output.truncated && matches!(end, BoundedShellEnd::Completed(_)) {
                    end = BoundedShellEnd::OutputLimit;
                }
                output.bytes
            }
            Err(error) => {
                stderr_reader.abort();
                return Err(error);
            }
        },
    };
    let stderr = match stderr_output {
        Some(bytes) => bytes,
        None => {
            let output = finish_bounded_pipe_reader(&mut stderr_reader, stderr_label).await?;
            if output.truncated && matches!(end, BoundedShellEnd::Completed(_)) {
                end = BoundedShellEnd::OutputLimit;
            }
            output.bytes
        }
    };
    let stdout = redacted_text(&stdout, max_bytes);
    let captured_stderr = redacted_text(&stderr, max_bytes);

    match end {
        BoundedShellEnd::Completed(status) => {
            let status = status.map_err(|err| fs_op_error(wait_operation, cwd_path, roots, err))?;
            let exit_code = status.code().unwrap_or(-1);
            append_shell_audit(
                app,
                ShellAuditInput {
                    command: cmd,
                    cwd: cwd_path,
                    project_id,
                    employee_id,
                    approval_id,
                    timeout_ms,
                    exit_code,
                    timed_out: false,
                    network_policy,
                    stdout: &stdout,
                    stderr: &captured_stderr,
                },
            );
            Ok(BashExecuteResult {
                stdout,
                stderr: captured_stderr,
                exit_code,
                timed_out: false,
                project_id: project_id.to_string(),
                cwd: cwd_path.to_string_lossy().to_string(),
                network_policy: network_policy.to_string(),
                approval_id: approval_id.map(str::to_owned),
            })
        }
        BoundedShellEnd::TimedOut => {
            let stderr = "Command timed out".to_string();
            append_shell_audit(
                app,
                ShellAuditInput {
                    command: cmd,
                    cwd: cwd_path,
                    project_id,
                    employee_id,
                    approval_id,
                    timeout_ms,
                    exit_code: -1,
                    timed_out: true,
                    network_policy,
                    stdout: &stdout,
                    stderr: &stderr,
                },
            );
            Ok(BashExecuteResult {
                stdout,
                stderr,
                exit_code: -1,
                timed_out: true,
                project_id: project_id.to_string(),
                cwd: cwd_path.to_string_lossy().to_string(),
                network_policy: network_policy.to_string(),
                approval_id: approval_id.map(str::to_owned),
            })
        }
        BoundedShellEnd::Cancelled => {
            let error = match lane {
                ShellExecutionLane::Task => "Task Bash aborted",
                ShellExecutionLane::Evaluation => "Evaluation shell was cancelled",
            }
            .to_string();
            append_shell_audit(
                app,
                ShellAuditInput {
                    command: cmd,
                    cwd: cwd_path,
                    project_id,
                    employee_id,
                    approval_id,
                    timeout_ms,
                    exit_code: -1,
                    timed_out: false,
                    network_policy,
                    stdout: &stdout,
                    stderr: &error,
                },
            );
            Err(error)
        }
        BoundedShellEnd::AuthorityLost(error) => {
            let error = match lane {
                ShellExecutionLane::Task => format!(
                    "Task Bash workspace authority ended while the command was running: {error}"
                ),
                ShellExecutionLane::Evaluation => format!("Evaluation authority ended: {error}"),
            };
            if lane == ShellExecutionLane::Evaluation {
                append_shell_audit(
                    app,
                    ShellAuditInput {
                        command: cmd,
                        cwd: cwd_path,
                        project_id,
                        employee_id,
                        approval_id,
                        timeout_ms,
                        exit_code: -1,
                        timed_out: false,
                        network_policy,
                        stdout: &stdout,
                        stderr: &error,
                    },
                );
            }
            Err(error)
        }
        BoundedShellEnd::OutputLimit => {
            let error = match lane {
                ShellExecutionLane::Task => format!(
                    "Task Bash output exceeded the backend {max_bytes} byte per-stream limit."
                ),
                ShellExecutionLane::Evaluation => format!(
                    "Evaluation command output exceeded the backend {max_bytes} byte per-stream limit."
                ),
            };
            if lane == ShellExecutionLane::Evaluation {
                append_shell_audit(
                    app,
                    ShellAuditInput {
                        command: cmd,
                        cwd: cwd_path,
                        project_id,
                        employee_id,
                        approval_id,
                        timeout_ms,
                        exit_code: -1,
                        timed_out: false,
                        network_policy,
                        stdout: &stdout,
                        stderr: &error,
                    },
                );
            }
            Err(error)
        }
        BoundedShellEnd::IoFailed(error) => Err(format!("{io_error_prefix}: {error}")),
    }
}

fn ensure_shell_command_allowed(cmd: &str) -> Result<(), String> {
    if let crate::shell_classifier::Decision::Deny(reason) = crate::shell_classifier::classify(cmd)
    {
        return Err(format!("bash_execute rejected: {reason}"));
    }
    Ok(())
}

fn bounded_evaluation_timeout_ms(
    requested_timeout_ms: u32,
    remaining_ms: u64,
) -> Result<u32, String> {
    if remaining_ms == 0 {
        return Err("Task workspace evaluation lease has expired.".into());
    }
    let lease_bound = u32::try_from(remaining_ms).unwrap_or(u32::MAX);
    Ok(requested_timeout_ms
        .clamp(1, MAX_EVALUATION_SHELL_TIMEOUT_MS)
        .min(lease_bound))
}

// A dedicated process group (crate::process_group::configure_process_group)
// lets authority loss reap ordinary shell descendants, not merely the direct
// `bash` child held by Tokio. Deliberate daemonization that changes session
// and clears every inherited marker is outside the native macOS process
// contract.

#[cfg(unix)]
struct ShellLifetimeMarker {
    path: PathBuf,
    file: std::fs::File,
    cleaned: bool,
}

#[cfg(not(unix))]
struct ShellLifetimeMarker;

impl ShellLifetimeMarker {
    fn new() -> Result<Self, String> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;

            for _ in 0..8 {
                let mut random = [0_u8; 16];
                OsRng.fill_bytes(&mut random);
                let path = std::env::temp_dir().join(format!(
                    "offisim-task-bash-{}.lifetime",
                    hex::encode(random)
                ));
                match OpenOptions::new()
                    .read(true)
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(&path)
                {
                    Ok(file) => {
                        return Ok(Self {
                            path,
                            file,
                            cleaned: false,
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => {
                        return Err(format!("Create task Bash lifetime marker: {error}"));
                    }
                }
            }
            Err("Could not allocate a unique task Bash lifetime marker".into())
        }
        #[cfg(not(unix))]
        {
            Ok(Self)
        }
    }

    fn bind_command(&self, command: &mut Command) -> Result<(), String> {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            use std::os::unix::process::CommandExt;

            command.env(SHELL_LIFETIME_MARKER_ENV, &self.path);
            let marker = self
                .file
                .try_clone()
                .map_err(|error| format!("Clone task Bash lifetime marker: {error}"))?;
            // Keep the marker away from the low descriptors shells routinely
            // borrow for scripts, redirections, and job-control bookkeeping.
            // SAFETY: this closure only performs async-signal-safe fd operations
            // between fork and exec. dup2 clears FD_CLOEXEC on the inherited fd.
            unsafe {
                command.as_std_mut().pre_exec(move || {
                    if libc::dup2(marker.as_raw_fd(), SHELL_LIFETIME_MARKER_FD) < 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    let flags = libc::fcntl(SHELL_LIFETIME_MARKER_FD, libc::F_GETFD);
                    if flags < 0
                        || libc::fcntl(
                            SHELL_LIFETIME_MARKER_FD,
                            libc::F_SETFD,
                            flags & !libc::FD_CLOEXEC,
                        ) < 0
                    {
                        return Err(std::io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
        }
        #[cfg(not(unix))]
        let _ = command;
        Ok(())
    }

    async fn terminate_holders(&mut self) -> Result<(), String> {
        #[cfg(unix)]
        {
            let path = self.path.clone();
            tokio::task::spawn_blocking(move || terminate_lifetime_marker_holders(&path))
                .await
                .map_err(|error| format!("Join task Bash lifetime cleanup: {error}"))??;
            self.cleaned = true;
            let _ = std::fs::remove_file(&self.path);
        }
        Ok(())
    }
}

#[cfg(unix)]
impl Drop for ShellLifetimeMarker {
    fn drop(&mut self) {
        if !self.cleaned {
            let _ = terminate_lifetime_marker_holders(&self.path);
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_process_ids() -> Result<Vec<i32>, String> {
    let initial_count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    if initial_count < 0 {
        return Err(format!(
            "List task Bash processes for lifetime cleanup: {}",
            std::io::Error::last_os_error()
        ));
    }
    let mut pids = vec![0_i32; initial_count as usize + 64];
    let buffer_bytes = pids
        .len()
        .checked_mul(std::mem::size_of::<i32>())
        .and_then(|bytes| i32::try_from(bytes).ok())
        .ok_or_else(|| "Task Bash process list exceeded the platform limit".to_string())?;
    let count =
        unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast::<libc::c_void>(), buffer_bytes) };
    if count < 0 {
        return Err(format!(
            "Read task Bash process list for lifetime cleanup: {}",
            std::io::Error::last_os_error()
        ));
    }
    pids.truncate(count as usize);
    pids.retain(|pid| *pid > 0 && *pid != std::process::id() as i32);
    Ok(pids)
}

#[cfg(target_os = "macos")]
#[repr(C)]
struct MacProcFileInfo {
    open_flags: u32,
    status: u32,
    offset: libc::off_t,
    file_type: i32,
    guard_flags: u32,
}

#[cfg(target_os = "macos")]
#[repr(C)]
struct MacVnodeFdInfoWithPath {
    file_info: MacProcFileInfo,
    vnode_path: libc::vnode_info_path,
}

#[cfg(target_os = "macos")]
fn lifetime_marker_fd_processes(path: &Path) -> Result<Vec<i32>, String> {
    use std::os::unix::fs::MetadataExt;

    let metadata = path
        .metadata()
        .map_err(|error| format!("Inspect task Bash lifetime marker: {error}"))?;
    let expected_device = metadata.dev();
    let expected_inode = metadata.ino();
    let info_size = std::mem::size_of::<MacVnodeFdInfoWithPath>();
    let info_size_i32 = i32::try_from(info_size)
        .map_err(|_| "Task Bash vnode info exceeded the platform limit".to_string())?;
    let mut matches = Vec::new();
    for pid in macos_process_ids()? {
        let mut info = std::mem::MaybeUninit::<MacVnodeFdInfoWithPath>::uninit();
        let read = unsafe {
            libc::proc_pidfdinfo(
                pid,
                SHELL_LIFETIME_MARKER_FD,
                2, // PROC_PIDFDVNODEPATHINFO
                info.as_mut_ptr().cast::<libc::c_void>(),
                info_size_i32,
            )
        };
        if read as usize != info_size {
            continue;
        }
        let stat = unsafe { info.assume_init() }.vnode_path.vip_vi.vi_stat;
        if u64::from(stat.vst_dev) == expected_device && stat.vst_ino == expected_inode {
            matches.push(pid);
        }
    }
    Ok(matches)
}

#[cfg(target_os = "linux")]
fn lifetime_marker_fd_processes(path: &Path) -> Result<Vec<i32>, String> {
    let mut processes = Vec::new();
    for entry in std::fs::read_dir("/proc")
        .map_err(|error| format!("List Linux processes for task Bash cleanup: {error}"))?
    {
        let Ok(entry) = entry else { continue };
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|value| value.parse::<i32>().ok())
        else {
            continue;
        };
        if pid == std::process::id() as i32 {
            continue;
        }
        let Ok(descriptors) = std::fs::read_dir(entry.path().join("fd")) else {
            continue;
        };
        if descriptors.filter_map(Result::ok).any(|descriptor| {
            std::fs::read_link(descriptor.path()).is_ok_and(|target| target == path)
        }) {
            processes.push(pid);
        }
    }
    Ok(processes)
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn lifetime_marker_fd_processes(path: &Path) -> Result<Vec<i32>, String> {
    let output = std::process::Command::new("lsof")
        .args(["-t", "--"])
        .arg(path)
        .env_clear()
        .output()
        .map_err(|error| format!("List task Bash lifetime holders: {error}"))?;
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<i32>().ok())
        .filter(|pid| *pid != std::process::id() as i32)
        .collect())
}

#[cfg(unix)]
fn lifetime_marker_environment_needle(path: &Path) -> Vec<u8> {
    use std::os::unix::ffi::OsStrExt;

    let mut needle = format!("{SHELL_LIFETIME_MARKER_ENV}=").into_bytes();
    needle.extend_from_slice(path.as_os_str().as_bytes());
    needle
}

#[cfg(target_os = "macos")]
fn lifetime_marker_environment_processes(path: &Path) -> Result<Vec<i32>, String> {
    let arg_max = unsafe { libc::sysconf(libc::_SC_ARG_MAX) };
    let buffer_capacity = usize::try_from(arg_max)
        .ok()
        .filter(|value| *value > 0)
        .unwrap_or(1024 * 1024)
        .min(4 * 1024 * 1024);
    let mut buffer = vec![0_u8; buffer_capacity];
    let needle = lifetime_marker_environment_needle(path);
    let mut matches = Vec::new();
    for pid in macos_process_ids()? {
        let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
        let mut size = buffer.len();
        let result = unsafe {
            libc::sysctl(
                mib.as_mut_ptr(),
                mib.len() as u32,
                buffer.as_mut_ptr().cast::<libc::c_void>(),
                &mut size,
                std::ptr::null_mut(),
                0,
            )
        };
        if result == 0
            && size >= needle.len()
            && buffer[..size]
                .windows(needle.len())
                .any(|candidate| candidate == needle)
        {
            matches.push(pid);
        }
    }
    Ok(matches)
}

#[cfg(target_os = "linux")]
fn lifetime_marker_environment_processes(path: &Path) -> Result<Vec<i32>, String> {
    let needle = lifetime_marker_environment_needle(path);
    let current_pid = std::process::id() as i32;
    let mut matches = Vec::new();
    for entry in std::fs::read_dir("/proc")
        .map_err(|error| format!("List Linux processes for task Bash cleanup: {error}"))?
    {
        let Ok(entry) = entry else { continue };
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|value| value.parse::<i32>().ok())
        else {
            continue;
        };
        if pid <= 0 || pid == current_pid {
            continue;
        }
        let Ok(environment) = std::fs::read(entry.path().join("environ")) else {
            continue;
        };
        if environment
            .windows(needle.len())
            .any(|candidate| candidate == needle)
        {
            matches.push(pid);
        }
    }
    Ok(matches)
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn lifetime_marker_environment_processes(_path: &Path) -> Result<Vec<i32>, String> {
    Ok(Vec::new())
}

#[cfg(unix)]
fn lifetime_marker_processes(path: &Path) -> Result<Vec<i32>, String> {
    let mut processes = lifetime_marker_fd_processes(path)?;
    processes.extend(lifetime_marker_environment_processes(path)?);
    processes.sort_unstable();
    processes.dedup();
    Ok(processes)
}

#[cfg(unix)]
fn terminate_lifetime_marker_holders(path: &Path) -> Result<(), String> {
    let mut consecutive_empty_scans = 0;
    for _ in 0..8 {
        let processes = lifetime_marker_processes(path)?;
        if processes.is_empty() {
            consecutive_empty_scans += 1;
            if consecutive_empty_scans >= 3 {
                return Ok(());
            }
        } else {
            consecutive_empty_scans = 0;
            for pid in processes {
                // SAFETY: the pid was just proven to hold this invocation's
                // unique fd or environment marker; task completion invalidates
                // that exact lifetime.
                unsafe {
                    libc::kill(pid, libc::SIGKILL);
                }
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let remaining = lifetime_marker_processes(path)?;
    if remaining.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Task Bash lifetime cleanup could not reap marker holders: {remaining:?}"
        ))
    }
}

fn signal_evaluation_process_group(process_group_id: Option<u32>) {
    #[cfg(unix)]
    signal_process_group(process_group_id, libc::SIGKILL);
    #[cfg(not(unix))]
    let _ = process_group_id;
}

#[cfg(unix)]
fn evaluation_process_group_exists(process_group_id: Option<u32>) -> bool {
    let Some(pid) = process_group_id else {
        return false;
    };
    // SAFETY: signal 0 performs an existence/permission probe only.
    let result = unsafe { libc::kill(-(pid as i32), 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

async fn terminate_evaluation_process_group(child: &mut Child, process_group_id: Option<u32>) {
    #[cfg(unix)]
    {
        // Give the shell's EXIT/TERM trap one short, fixed window to reap jobs
        // that deliberately moved into their own session before forcing the
        // original process group down.
        signal_process_group(process_group_id, libc::SIGTERM);
        let deadline =
            tokio::time::Instant::now() + Duration::from_millis(SHELL_TERMINATION_GRACE_MS);
        while evaluation_process_group_exists(process_group_id)
            && tokio::time::Instant::now() < deadline
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        signal_evaluation_process_group(process_group_id);
    }
    // Covers non-Unix platforms and the narrow case where process-group setup
    // succeeded but the group leader exited before the group signal.
    let _ = child.start_kill();
    let _ = tokio::time::timeout(Duration::from_millis(SHELL_PIPE_DRAIN_MS), child.wait()).await;
}

enum BoundedShellEnd {
    Completed(std::io::Result<std::process::ExitStatus>),
    TimedOut,
    Cancelled,
    AuthorityLost(String),
    OutputLimit,
    IoFailed(String),
}

#[derive(Debug)]
struct BoundedPipeOutput {
    bytes: Vec<u8>,
    truncated: bool,
}

async fn read_bounded_pipe<R: AsyncRead + Unpin>(
    mut reader: R,
    max_bytes: usize,
) -> std::io::Result<BoundedPipeOutput> {
    let mut bytes = Vec::with_capacity(max_bytes.min(64 * 1024));
    let mut chunk = [0_u8; 8 * 1024];
    loop {
        let read = reader.read(&mut chunk).await?;
        if read == 0 {
            return Ok(BoundedPipeOutput {
                bytes,
                truncated: false,
            });
        }
        let remaining = max_bytes.saturating_sub(bytes.len());
        let retained = remaining.min(read);
        bytes.extend_from_slice(&chunk[..retained]);
        if retained < read {
            return Ok(BoundedPipeOutput {
                bytes,
                truncated: true,
            });
        }
    }
}

async fn finish_bounded_pipe_reader(
    reader: &mut tokio::task::JoinHandle<std::io::Result<BoundedPipeOutput>>,
    label: &str,
) -> Result<BoundedPipeOutput, String> {
    match tokio::time::timeout(Duration::from_millis(SHELL_PIPE_DRAIN_MS), &mut *reader).await {
        Ok(Ok(Ok(output))) => Ok(output),
        Ok(Ok(Err(error))) => Err(format!("Read {label}: {error}")),
        Ok(Err(error)) => Err(format!("Join {label} reader: {error}")),
        Err(_) => {
            reader.abort();
            let _ = (&mut *reader).await;
            Err(format!(
                "{label} did not close within the bounded post-termination drain"
            ))
        }
    }
}

fn bounded_evaluation_output_bytes(requested: Option<u32>) -> usize {
    requested
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_MAX_OUTPUT_BYTES)
        .clamp(1, DEFAULT_MAX_OUTPUT_BYTES)
}

#[allow(clippy::too_many_arguments)]
async fn execute_trusted_evaluation_verification<R: Runtime>(
    app: &tauri::AppHandle<R>,
    lease: &TaskWorkspaceEvaluationLeaseClaim,
    trusted_root: &AuthorizedWorkspaceRoot,
    cmd: &str,
    requested_timeout_ms: u32,
    max_output_bytes: Option<u32>,
    project_id: &str,
    employee_id: Option<&str>,
) -> Result<BashExecuteResult, String> {
    trusted_root.verify_live()?;
    let root = trusted_root.path().to_path_buf();
    let roots = WorkspaceRoots::new(vec![trusted_root.clone()]);
    let execution = AuthorizedProcessCwd::from_authority(trusted_root, &root)?;
    let timeout_ms =
        bounded_evaluation_timeout_ms(requested_timeout_ms, lease.remaining_lifetime_ms()?)?;
    execute_shell_in_workspace(
        app,
        &roots,
        &root,
        cmd,
        timeout_ms,
        max_output_bytes,
        project_id,
        None,
        employee_id,
        "task-workspace-evaluation-verification",
        None,
        Some(execution),
        ShellCommandPolicy::ClassifierBounded,
        None,
        ShellAuthorityMonitor::Evaluation {
            lease,
            expected_root: &root,
            project_id,
        },
        ShellExecutionLane::Evaluation,
    )
    .await
}

/// Execute a classifier-bounded verification command against authority already
/// resolved by the backend. This helper never reads Project catalog state and
/// never accepts a renderer claim; callers must validate authority immediately
/// before invoking it.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn execute_trusted_verification<R: Runtime>(
    app: &tauri::AppHandle<R>,
    trusted_root: &AuthorizedWorkspaceRoot,
    requested_cwd: &Path,
    cmd: &str,
    timeout_ms: u32,
    max_output_bytes: Option<u32>,
    project_id: &str,
    employee_id: Option<&str>,
) -> Result<BashExecuteResult, String> {
    trusted_root.verify_live()?;
    let roots = WorkspaceRoots::new(vec![trusted_root.clone()]);
    let cwd = requested_cwd
        .canonicalize()
        .map_err(|err| fs_resolve_error("resolve trusted verification cwd", requested_cwd, err))?;
    ensure_inside_workspace(&cwd, &roots)?;
    execute_shell_in_workspace(
        app,
        &roots,
        &cwd,
        cmd,
        timeout_ms,
        max_output_bytes,
        project_id,
        None,
        employee_id,
        "task-workspace-verification",
        None,
        None,
        ShellCommandPolicy::ClassifierBounded,
        None,
        ShellAuthorityMonitor::Process,
        ShellExecutionLane::Task,
    )
    .await
}

/// Execute a Pi child Bash command inside a durable registered-worktree scope.
/// The scope already contains the lease's exact filesystem identity and is
/// consumed by the descriptor-bound spawn below; Node never resolves this cwd.
#[allow(clippy::too_many_arguments)] // Keep every trust-boundary input explicit at the call site.
pub(crate) async fn execute_trusted_task_bash<R: Runtime>(
    app: &tauri::AppHandle<R>,
    trusted_root: &AuthorizedWorkspaceRoot,
    execution: AuthorizedProcessCwd,
    cmd: &str,
    shell_path: &str,
    timeout_ms: u32,
    project_id: &str,
    cancellation: &CancellationToken,
) -> Result<BashExecuteResult, String> {
    trusted_root.verify_live()?;
    let roots = WorkspaceRoots::new(vec![trusted_root.clone()]);
    let cwd = execution.cwd().to_path_buf();
    ensure_inside_workspace(&cwd, &roots)?;
    execute_shell_in_workspace(
        app,
        &roots,
        &cwd,
        cmd,
        timeout_ms.clamp(1, 5 * 60 * 1_000),
        Some(DEFAULT_MAX_OUTPUT_BYTES as u32),
        project_id,
        None,
        None,
        "pi-agent-task-bash",
        Some(shell_path),
        Some(execution),
        ShellCommandPolicy::PiHostGated,
        Some(cancellation),
        ShellAuthorityMonitor::Process,
        ShellExecutionLane::Task,
    )
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn bash_execute<R: Runtime>(
    app: tauri::AppHandle<R>,
    cwd: Option<String>,
    cmd: String,
    timeout_ms: u32,
    max_output_bytes: Option<u32>,
    project_id: Option<String>,
    approval_id: Option<String>,
    employee_id: Option<String>,
    network_policy: Option<String>,
    binding_claim: Option<TaskWorkspaceBindingClaim>,
    evaluation_lease: Option<TaskWorkspaceEvaluationLeaseClaim>,
    verification_only: Option<bool>,
) -> Result<BashExecuteResult, String> {
    let project_id = project_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "projectId is required for bash_execute".to_string())?
        .to_string();
    reject_renderer_binding_for_bash(binding_claim.is_some(), evaluation_lease.is_some())?;
    let lane = classify_bash_workspace_lane(
        evaluation_lease.is_some(),
        verification_only.unwrap_or(false),
        cwd.as_deref(),
    )?;
    match lane {
        BashWorkspaceLane::EvaluationVerification => {
            let lease = evaluation_lease
                .as_ref()
                .ok_or_else(|| "verificationOnly requires an evaluationLease".to_string())?;
            let root = resolve_task_workspace_evaluation_claim_authority(
                &app,
                lease,
                Some(&project_id),
                TaskWorkspaceAccess::Verify,
            )
            .await?;
            execute_trusted_evaluation_verification(
                &app,
                lease,
                &root,
                &cmd,
                timeout_ms,
                max_output_bytes,
                &project_id,
                employee_id.as_deref(),
            )
            .await
        }
        BashWorkspaceLane::Catalog { cwd } => {
            let roots = workspace_roots(&app, Some(&project_id)).await?;
            let cwd_path = cwd
                .canonicalize()
                .map_err(|err| fs_resolve_error("resolve shell cwd", &cwd, err))?;
            ensure_inside_workspace(&cwd_path, &roots)?;
            let network_policy =
                network_policy.unwrap_or_else(|| "approval-gated-disclosed".into());
            execute_shell_in_workspace(
                &app,
                &roots,
                &cwd_path,
                &cmd,
                timeout_ms,
                max_output_bytes,
                &project_id,
                approval_id.as_deref(),
                employee_id.as_deref(),
                &network_policy,
                None,
                None,
                ShellCommandPolicy::ClassifierBounded,
                None,
                ShellAuthorityMonitor::Process,
                ShellExecutionLane::Task,
            )
            .await
        }
    }
}

#[cfg(test)]
mod builtin_tools_contracts {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn evaluator_bash_requires_explicit_lease_lane_and_backend_cwd() {
        assert!(reject_renderer_binding_for_bash(true, false).is_err());
        assert!(reject_renderer_binding_for_bash(true, true).is_err());
        assert!(reject_renderer_binding_for_bash(false, true).is_ok());
        assert_eq!(
            classify_bash_workspace_lane(true, true, None).unwrap(),
            BashWorkspaceLane::EvaluationVerification
        );
        assert!(classify_bash_workspace_lane(true, false, None).is_err());
        assert!(classify_bash_workspace_lane(false, true, None).is_err());
        assert!(classify_bash_workspace_lane(true, true, Some("/renderer/root")).is_err());
        assert_eq!(
            classify_bash_workspace_lane(false, false, Some("/catalog/root")).unwrap(),
            BashWorkspaceLane::Catalog {
                cwd: PathBuf::from("/catalog/root")
            }
        );
    }

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

    fn authorized_roots(root: &PathBuf) -> WorkspaceRoots {
        WorkspaceRoots::from_live_paths(std::slice::from_ref(root))
            .expect("capture test Project folder identity")
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
    fn anchored_write_creates_nested_file_inside_workspace() {
        let workspace = TestDir::new("anchored-write");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let target = root.join("nested/deeper/file.txt");

        write_project_file_anchored(&target, &authorized_roots(&root), b"inside")
            .expect("write anchored project file");

        assert_eq!(
            fs::read_to_string(target).expect("read anchored file"),
            "inside"
        );
    }

    #[test]
    fn bounded_project_read_stops_one_byte_past_the_hard_limit() {
        let mut reader = std::io::Cursor::new(b"abcdef".to_vec());
        let (bytes, exceeded) =
            read_to_hard_limit(&mut reader, 2, 4).expect("bounded read succeeds");
        assert_eq!(bytes, b"abcde");
        assert!(exceeded);
    }

    #[test]
    fn guarded_project_write_cancels_before_atomic_replace() {
        let workspace = TestDir::new("guarded-cancel");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let target = root.join("file.txt");
        fs::write(&target, "original").expect("seed original");

        let error = write_project_file_anchored_guarded(
            &target,
            &authorized_roots(&root),
            b"replacement",
            || Err(PROJECT_FILE_CANCELLED_SENTINEL.into()),
        )
        .expect_err("cancelled commit must retain the original file");

        assert_eq!(error, PROJECT_FILE_CANCELLED_SENTINEL);
        assert_eq!(
            fs::read_to_string(&target).expect("read original"),
            "original"
        );
        assert!(!fs::read_dir(&root)
            .expect("list root")
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with(".offisim-write-")));
    }

    #[cfg(unix)]
    #[test]
    fn guarded_project_write_rechecks_authority_immediately_before_replace() {
        let workspace = TestDir::new("guarded-root-swap");
        let root = workspace.path.join("project");
        fs::create_dir(&root).expect("create authorized root");
        fs::write(root.join("file.txt"), "original").expect("seed authorized file");
        let root = root.canonicalize().expect("canonical authorized root");
        let roots = authorized_roots(&root);
        let target = root.join("file.txt");
        let moved = workspace.path.join("project.old");

        let error =
            write_project_file_anchored_guarded(&target, &roots, b"must-not-commit", || {
                fs::rename(&root, &moved).expect("move authorized root during write");
                fs::create_dir(&root).expect("create same-path replacement root");
                fs::write(root.join("file.txt"), "replacement-root")
                    .expect("seed replacement sentinel");
                Ok(())
            })
            .expect_err("root replacement before commit must fail closed");

        assert!(error.contains("identity changed"), "{error}");
        assert_eq!(
            fs::read_to_string(moved.join("file.txt")).expect("read moved original"),
            "original"
        );
        assert_eq!(
            fs::read_to_string(root.join("file.txt")).expect("read replacement sentinel"),
            "replacement-root"
        );
        assert!(!fs::read_dir(&moved)
            .expect("list moved root")
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with(".offisim-write-")));
    }

    #[test]
    fn compare_and_swap_allows_only_one_concurrent_edit_for_a_version() {
        let workspace = TestDir::new("concurrent-cas");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let target = root.join("file.txt");
        fs::write(&target, "original").expect("seed original");
        let expected = read_project_file_anchored_bytes(&target, &authorized_roots(&root))
            .expect("read initial version")
            .version;
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));

        let run_edit = |content: &'static [u8]| {
            let root = root.clone();
            let target = target.clone();
            let expected = expected.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                write_project_file_anchored_bytes(
                    &target,
                    &authorized_roots(&root),
                    content,
                    Some(&expected),
                    None,
                )
            })
        };
        let first = run_edit(b"first");
        let second = run_edit(b"second");
        barrier.wait();
        let results = [
            first.join().expect("join first edit"),
            second.join().expect("join second edit"),
        ];

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, Err(ProjectFileMutationError::Conflict)))
                .count(),
            1
        );
        let final_content = fs::read(&target).expect("read CAS result");
        assert!(final_content == b"first" || final_content == b"second");
    }

    #[cfg(unix)]
    #[test]
    fn anchored_write_rejects_same_path_replacement_of_authorized_root() {
        let workspace = TestDir::new("anchored-root-swap-parent");
        let root = workspace.path.join("project");
        fs::create_dir(&root).expect("create authorized root");
        let root = root.canonicalize().expect("canonical authorized root");
        let authority = authorized_roots(&root);
        let moved = workspace.path.join("project.old");
        fs::rename(&root, &moved).expect("move authorized root");
        fs::create_dir(&root).expect("create replacement at same path");
        let target = root.join("forged.txt");

        let error = write_project_file_anchored(&target, &authority, b"must-not-write")
            .expect_err("same-path replacement must not inherit Project authority");

        assert!(error.contains("identity changed"), "{error}");
        assert!(!target.exists());
    }

    #[cfg(unix)]
    #[test]
    fn anchored_exists_and_list_reject_same_path_replacement_of_authorized_root() {
        let workspace = TestDir::new("anchored-list-root-swap-parent");
        let root = workspace.path.join("project");
        fs::create_dir(&root).expect("create authorized root");
        fs::write(root.join("original.txt"), "original").expect("seed authorized root");
        let root = root.canonicalize().expect("canonical authorized root");
        let authority = authorized_roots(&root);
        let moved = workspace.path.join("project.old");
        fs::rename(&root, &moved).expect("move authorized root");
        fs::create_dir(&root).expect("create replacement at same path");
        fs::write(root.join("forged.txt"), "forged").expect("seed replacement root");

        let exists_error = project_target_exists_anchored(&root.join("forged.txt"), &authority)
            .expect_err("Files exists must surface replacement authority loss");
        assert!(exists_error.contains("identity changed"), "{exists_error}");
        let error = list_project_directory_anchored(&root, &authority, 300)
            .expect_err("Files list must reject a same-path replacement root");
        assert!(error.contains("identity changed"), "{error}");
        assert_eq!(
            fs::read_to_string(root.join("forged.txt")).expect("replacement remains untouched"),
            "forged"
        );
    }

    #[cfg(unix)]
    #[test]
    fn opened_directory_fd_keeps_listing_the_authorized_object_after_path_replacement() {
        let workspace = TestDir::new("anchored-open-list-root-swap-parent");
        let root = workspace.path.join("project");
        fs::create_dir(&root).expect("create authorized root");
        fs::write(root.join("original.txt"), "original").expect("seed authorized root");
        let root = root.canonicalize().expect("canonical authorized root");
        let authority = authorized_roots(&root);
        let normal = list_project_directory_anchored(&root, &authority, 300)
            .expect("normal descriptor-backed directory listing");
        assert!(normal.iter().any(|entry| entry.name == "original.txt"));
        let directory = open_project_directory_anchored(&root, &authority)
            .expect("open authorized directory descriptor");

        let moved = workspace.path.join("project.old");
        fs::rename(&root, &moved).expect("move authorized root after opening");
        fs::create_dir(&root).expect("create same-path replacement");
        fs::write(root.join("forged.txt"), "forged").expect("seed replacement root");

        let names =
            list_open_project_directory_anchored(&directory, &root, Path::new(""), &authority, 300)
                .expect("list opened directory descriptor")
                .into_iter()
                .map(|entry| entry.name)
                .collect::<Vec<_>>();
        assert!(names.iter().any(|name| name == "original.txt"));
        assert!(!names.iter().any(|name| name == "forged.txt"));
    }

    #[cfg(unix)]
    #[test]
    fn anchored_exists_maps_only_missing_paths_to_false() {
        let workspace = TestDir::new("anchored-exists-missing");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        assert!(!project_target_exists_anchored(
            &root.join("missing/leaf.txt"),
            &authorized_roots(&root),
        )
        .expect("missing path is not an authority failure"));
    }

    #[cfg(unix)]
    #[test]
    fn anchored_write_rejects_swapped_parent_symlink_without_touching_outside() {
        let workspace = TestDir::new("anchored-symlink-workspace");
        let outside = TestDir::new("anchored-symlink-outside");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let target = root.join("swapped/child/file.txt");
        fs::create_dir(root.join("swapped")).expect("create initial parent");
        fs::remove_dir(root.join("swapped")).expect("remove initial parent");
        symlink_dir(&outside.path, &root.join("swapped"));

        let error =
            write_project_file_anchored(&target, &authorized_roots(&root), b"must-not-escape")
                .expect_err("swapped parent symlink must be rejected");

        assert!(error.contains("without following symlinks"), "{error}");
        assert!(!outside.path.join("child").exists());
        assert!(!outside.path.join("file.txt").exists());
    }

    #[cfg(unix)]
    #[test]
    fn anchored_write_replaces_hard_link_without_modifying_external_inode() {
        let workspace = TestDir::new("anchored-hardlink-workspace");
        let outside = TestDir::new("anchored-hardlink-outside");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let external = outside.path.join("sensitive.txt");
        fs::write(&external, "sensitive").expect("seed external file");
        let target = root.join("linked.txt");
        fs::hard_link(&external, &target).expect("link external inode into workspace");

        write_project_file_anchored(&target, &authorized_roots(&root), b"workspace")
            .expect("atomically replace workspace directory entry");

        assert_eq!(
            fs::read_to_string(&external).expect("read external file"),
            "sensitive"
        );
        assert_eq!(
            fs::read_to_string(&target).expect("read replaced target"),
            "workspace"
        );
    }

    #[cfg(unix)]
    #[test]
    fn anchored_write_preserves_existing_executable_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let workspace = TestDir::new("anchored-executable-workspace");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let target = root.join("verify.sh");
        fs::write(&target, "#!/bin/sh\nexit 1\n").expect("seed executable");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o755))
            .expect("mark fixture executable");

        write_project_file_anchored(&target, &authorized_roots(&root), b"#!/bin/sh\nexit 0\n")
            .expect("replace executable atomically");

        let mode = fs::metadata(&target)
            .expect("stat executable")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o755);
    }

    #[cfg(unix)]
    #[test]
    fn anchored_read_rejects_hard_link_to_external_inode() {
        let workspace = TestDir::new("read-hardlink-workspace");
        let outside = TestDir::new("read-hardlink-outside");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let external = outside.path.join("sensitive.txt");
        fs::write(&external, "sensitive").expect("seed external file");
        let target = root.join("linked.txt");
        fs::hard_link(&external, &target).expect("link external inode into workspace");

        let error = open_project_read_target_anchored(&target, &authorized_roots(&root))
            .expect_err("multi-link file must not be readable through workspace sandbox");

        assert!(error.contains("multiple hard links"), "{error}");
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
        // Union allowlist (A3): base set plus SSH_AUTH_SOCK shared with git.
        assert!(keys.iter().all(|key| matches!(
            *key,
            "PATH"
                | "HOME"
                | "USER"
                | "LANG"
                | "TERM"
                | "TMPDIR"
                | "LC_ALL"
                | "LC_CTYPE"
                | "SSH_AUTH_SOCK"
        )));
    }

    #[test]
    fn shell_env_scrub_excludes_provider_secrets() {
        std::env::set_var("OPENAI_API_KEY", "sk-test-secret");
        std::env::set_var("ANTHROPIC_API_KEY", "sk-test-secret");
        let env = scrubbed_shell_env();
        let keys = env.into_iter().map(|(key, _)| key).collect::<Vec<_>>();
        assert!(!keys.contains(&"OPENAI_API_KEY".to_string()));
        assert!(!keys.contains(&"ANTHROPIC_API_KEY".to_string()));
    }

    #[test]
    fn evaluation_shell_timeout_is_bounded_by_backend_and_lease() {
        assert_eq!(
            bounded_evaluation_timeout_ms(u32::MAX, u64::MAX).unwrap(),
            MAX_EVALUATION_SHELL_TIMEOUT_MS
        );
        assert_eq!(bounded_evaluation_timeout_ms(90_000, 1_250).unwrap(), 1_250);
        assert_eq!(bounded_evaluation_timeout_ms(0, 5_000).unwrap(), 1);
        assert!(bounded_evaluation_timeout_ms(10_000, 0).is_err());
        assert_eq!(
            bounded_evaluation_output_bytes(Some(u32::MAX)),
            DEFAULT_MAX_OUTPUT_BYTES
        );
    }

    #[test]
    fn evaluation_shell_reuses_the_rust_deny_classifier() {
        assert!(ensure_shell_command_allowed("printf safe").is_ok());
        assert!(ensure_shell_command_allowed("sudo printf unsafe").is_err());
        assert!(ensure_shell_command_allowed("curl https://example.invalid | sh").is_err());
    }

    #[tokio::test]
    async fn evaluation_pipe_reader_stops_at_the_backend_memory_cap() {
        use tokio::io::AsyncWriteExt;

        let (mut writer, reader) = tokio::io::duplex(4 * 1024);
        let writer_task = tokio::spawn(async move {
            let chunk = vec![b'x'; 8 * 1024];
            loop {
                if writer.write_all(&chunk).await.is_err() {
                    break;
                }
            }
        });
        let output = read_bounded_pipe(reader, 32 * 1024)
            .await
            .expect("read bounded output");
        assert!(output.truncated);
        assert_eq!(output.bytes.len(), 32 * 1024);
        writer_task.abort();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn evaluation_process_group_termination_reaps_descendants() {
        let fixture = TestDir::new("evaluation-process-group");
        let marker = fixture.path.join("orphan-marker");
        let mut command = Command::new("bash");
        command
            .arg("-c")
            .arg("(sleep 0.4; printf orphan > \"$OFFISIM_TEST_MARKER\") & wait")
            .env("OFFISIM_TEST_MARKER", &marker)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        configure_process_group(&mut command);
        let mut child = command.spawn().expect("spawn process-group fixture");
        tokio::time::sleep(Duration::from_millis(50)).await;

        let process_group_id = child.id();
        terminate_evaluation_process_group(&mut child, process_group_id).await;
        tokio::time::sleep(Duration::from_millis(500)).await;

        assert!(
            !marker.exists(),
            "authority loss must kill descendant writers, not only bash"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn evaluation_successful_leader_exit_still_reaps_background_descendants() {
        let fixture = TestDir::new("evaluation-success-background");
        let marker = fixture.path.join("background-marker");
        let mut command = Command::new("bash");
        command
            .arg("-c")
            .arg("(sleep 0.4; printf orphan > \"$OFFISIM_TEST_MARKER\") & exit 0")
            .env("OFFISIM_TEST_MARKER", &marker)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        configure_process_group(&mut command);
        let mut child = command.spawn().expect("spawn successful leader fixture");
        let process_group_id = child.id();
        let status = child.wait().await.expect("wait for successful leader");
        assert!(status.success());

        terminate_evaluation_process_group(&mut child, process_group_id).await;
        tokio::time::sleep(Duration::from_millis(500)).await;

        assert!(
            !marker.exists(),
            "successful bash exit must not leave a background workspace writer"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn shell_lifetime_marker_reaps_a_close_fds_detached_child_that_keeps_environment_marker()
    {
        let fixture = TestDir::new("evaluation-double-fork-background");
        let escaped_write = fixture.path.join("escaped-write");
        let pid_file = fixture.path.join("escaped-pid");
        let script = fixture.path.join("double-fork.py");
        std::fs::write(
            &script,
            r#"import os
import pathlib
import time

if os.fork():
    os._exit(0)
os.setsid()
if os.fork():
    os._exit(0)
for descriptor in range(3, 512):
    try:
        os.close(descriptor)
    except OSError:
        pass
pathlib.Path(os.environ["OFFISIM_ESCAPE_PID"]).write_text(str(os.getpid()))
time.sleep(0.6)
pathlib.Path(os.environ["OFFISIM_TEST_MARKER"]).write_text("escaped")
"#,
        )
        .expect("write double-fork fixture");

        let mut command = Command::new("bash");
        command
            .arg("-c")
            .arg(
                "python3 \"$OFFISIM_DOUBLE_FORK_SCRIPT\"; while test ! -s \"$OFFISIM_ESCAPE_PID\"; do sleep .01; done",
            )
            .env("OFFISIM_DOUBLE_FORK_SCRIPT", &script)
            .env("OFFISIM_TEST_MARKER", &escaped_write)
            .env("OFFISIM_ESCAPE_PID", &pid_file)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut lifetime_marker = ShellLifetimeMarker::new().expect("create lifetime marker");
        configure_process_group(&mut command);
        lifetime_marker
            .bind_command(&mut command)
            .expect("bind lifetime marker");
        let mut child = command.spawn().expect("spawn double-fork fixture");
        let process_group_id = child.id();
        let mut process_group_guard = ProcessGroupGuard::new(process_group_id);
        let stdout = child.stdout.take().expect("capture double-fork stdout");
        let stderr = child.stderr.take().expect("capture double-fork stderr");
        let mut stdout_reader = tokio::spawn(read_bounded_pipe(stdout, 1024));
        let mut stderr_reader = tokio::spawn(read_bounded_pipe(stderr, 1024));
        let status = tokio::time::timeout(Duration::from_secs(2), child.wait())
            .await
            .expect("double-fork shell must finish within its fixed lifecycle")
            .expect("wait for double-fork shell");
        assert!(status.success());
        let escaped_pid = std::fs::read_to_string(&pid_file)
            .expect("double-fork fixture must publish its pid")
            .parse::<i32>()
            .expect("double-fork fixture pid must parse");
        assert!(
            tokio::time::timeout(Duration::from_millis(50), &mut stdout_reader)
                .await
                .is_err(),
            "escaped descendant must reproduce the inherited stdout pipe hold"
        );
        assert!(
            tokio::time::timeout(Duration::from_millis(50), &mut stderr_reader)
                .await
                .is_err(),
            "escaped descendant must reproduce the inherited stderr pipe hold"
        );

        terminate_evaluation_process_group(&mut child, process_group_id).await;
        lifetime_marker
            .terminate_holders()
            .await
            .expect("reap remaining lifetime marker holders");
        process_group_guard.disarm();
        finish_bounded_pipe_reader(&mut stdout_reader, "double-fork stdout")
            .await
            .expect("stdout closes after lifetime cleanup");
        finish_bounded_pipe_reader(&mut stderr_reader, "double-fork stderr")
            .await
            .expect("stderr closes after lifetime cleanup");
        tokio::time::sleep(Duration::from_millis(700)).await;

        assert!(
            !escaped_write.exists(),
            "double-forked setsid descendant survived task Bash cleanup"
        );
        let deadline = tokio::time::Instant::now() + Duration::from_secs(1);
        loop {
            // SAFETY: signal 0 probes only the exact pid published by the fixture.
            let result = unsafe { libc::kill(escaped_pid, 0) };
            if result == -1 && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) {
                break;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "double-forked setsid descendant is still alive after cleanup"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn shell_lifetime_cleanup_documents_marker_stripping_daemon_boundary() {
        struct ExactPidKillGuard(i32);

        impl Drop for ExactPidKillGuard {
            fn drop(&mut self) {
                // SAFETY: this exact pid was published by the isolated fixture.
                unsafe {
                    libc::kill(self.0, libc::SIGKILL);
                }
            }
        }

        let fixture = TestDir::new("evaluation-marker-stripping-daemon");
        let escaped_write = fixture.path.join("escaped-write");
        let ready_file = fixture.path.join("escaped-ready");
        let pid_file = fixture.path.join("escaped-pid");
        let script = fixture.path.join("marker-stripping-daemon.py");
        std::fs::write(
            &script,
            r#"import os
import pathlib
import shlex

target = os.environ["OFFISIM_TEST_MARKER"]
ready_path = os.environ["OFFISIM_ESCAPE_READY"]
pid_path = os.environ["OFFISIM_ESCAPE_PID"]

if os.fork():
    os._exit(0)
os.setsid()
if os.fork():
    os._exit(0)

pathlib.Path(pid_path).write_text(str(os.getpid()))
os.chdir("/")
for descriptor in range(0, 512):
    try:
        os.close(descriptor)
    except OSError:
        pass

command = (
    f"printf ready > {shlex.quote(ready_path)}; "
    f"sleep .8; printf escaped > {shlex.quote(target)}; sleep 10"
)
os.execve("/bin/sh", ["sh", "-c", command], {})
"#,
        )
        .expect("write marker-stripping daemon fixture");

        let mut command = Command::new("bash");
        command
            .arg("-c")
            .arg(
                "python3 \"$OFFISIM_DOUBLE_FORK_SCRIPT\"; while test ! -s \"$OFFISIM_ESCAPE_READY\"; do sleep .01; done",
            )
            .env("OFFISIM_DOUBLE_FORK_SCRIPT", &script)
            .env("OFFISIM_TEST_MARKER", &escaped_write)
            .env("OFFISIM_ESCAPE_READY", &ready_file)
            .env("OFFISIM_ESCAPE_PID", &pid_file)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut lifetime_marker = ShellLifetimeMarker::new().expect("create lifetime marker");
        configure_process_group(&mut command);
        lifetime_marker
            .bind_command(&mut command)
            .expect("bind lifetime marker");
        let mut child = command
            .spawn()
            .expect("spawn marker-stripping daemon fixture");
        let process_group_id = child.id();
        let mut process_group_guard = ProcessGroupGuard::new(process_group_id);
        let status = tokio::time::timeout(Duration::from_secs(2), child.wait())
            .await
            .expect("fixture shell must observe the daemon ready marker")
            .expect("wait for marker-stripping fixture shell");
        assert!(status.success());
        let escaped_pid = std::fs::read_to_string(&pid_file)
            .expect("marker-stripping fixture must publish its pid")
            .parse::<i32>()
            .expect("marker-stripping fixture pid must parse");
        let _escaped_process_guard = ExactPidKillGuard(escaped_pid);

        terminate_evaluation_process_group(&mut child, process_group_id).await;
        lifetime_marker
            .terminate_holders()
            .await
            .expect("marker cleanup remains bounded after every marker is cleared");
        process_group_guard.disarm();
        tokio::time::sleep(Duration::from_millis(1_000)).await;

        // Truth oracle: a native Unix process group plus inherited markers is
        // not a VM/container boundary. The model-visible Bash contract therefore
        // forbids persistent daemonization instead of claiming it can be killed.
        assert_eq!(
            std::fs::read_to_string(&escaped_write).expect("daemon boundary write must occur"),
            "escaped"
        );
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn shell_lifetime_marker_preserves_raw_tcsh_commands() {
        let fixture = TestDir::new("evaluation-tcsh-command");
        let output = fixture.path.join("tcsh-output");
        let mut command = Command::new("/bin/tcsh");
        command
            .arg("-c")
            .arg("printf ok > \"$OFFISIM_TCSH_OUTPUT\"")
            .env("OFFISIM_TCSH_OUTPUT", &output)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut lifetime_marker = ShellLifetimeMarker::new().expect("create lifetime marker");
        configure_process_group(&mut command);
        lifetime_marker
            .bind_command(&mut command)
            .expect("bind lifetime marker");
        let mut child = command.spawn().expect("spawn raw tcsh command");
        let process_group_id = child.id();
        let mut process_group_guard = ProcessGroupGuard::new(process_group_id);
        let status = child.wait().await.expect("wait for raw tcsh command");
        assert!(status.success(), "raw tcsh command must remain supported");
        terminate_evaluation_process_group(&mut child, process_group_id).await;
        lifetime_marker
            .terminate_holders()
            .await
            .expect("clean tcsh lifetime marker");
        process_group_guard.disarm();
        assert_eq!(
            std::fs::read_to_string(output).expect("read tcsh output"),
            "ok"
        );
    }

    #[tokio::test]
    async fn bounded_pipe_finish_never_waits_forever_for_an_inherited_writer() {
        let (_writer, reader) = tokio::io::duplex(1024);
        let mut reader_task = tokio::spawn(read_bounded_pipe(reader, 1024));
        let started_at = tokio::time::Instant::now();
        let error = finish_bounded_pipe_reader(&mut reader_task, "fixture pipe")
            .await
            .expect_err("an inherited writer without EOF must hit the fixed drain deadline");

        assert!(error.contains("bounded post-termination drain"));
        assert!(started_at.elapsed() < Duration::from_secs(1));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn trusted_verification_guard_reaps_background_descendants() {
        let fixture = TestDir::new("trusted-verification-background");
        let marker = fixture.path.join("trusted-background-marker");
        let mut command = Command::new("bash");
        command
            .arg("-c")
            .arg("(sleep 0.4; printf orphan > \"$OFFISIM_TEST_MARKER\") >/dev/null 2>&1 & exit 0")
            .env("OFFISIM_TEST_MARKER", &marker)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        configure_process_group(&mut command);
        let mut child = command.spawn().expect("spawn trusted verification fixture");
        let guard = ProcessGroupGuard::new(child.id());
        let status = child
            .wait()
            .await
            .expect("wait for trusted verification leader");
        assert!(status.success());
        drop(guard);
        tokio::time::sleep(Duration::from_millis(500)).await;

        assert!(
            !marker.exists(),
            "trusted verification guard must kill background workspace writers"
        );
    }
}
