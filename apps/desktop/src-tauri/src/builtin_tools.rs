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

#[path = "builtin/proc_probe.rs"]
mod proc_probe;
#[path = "builtin/sandbox_path.rs"]
mod sandbox_path;
#[path = "builtin/shell.rs"]
mod shell;

#[cfg(not(unix))]
pub(crate) use sandbox_path::open_project_read_target_anchored;
pub(crate) use sandbox_path::{
    ensure_inside_workspace, project_path_metadata_anchored, relativize_for_error,
    resolve_project_candidate, write_project_file_anchored,
};
use sandbox_path::{
    ensure_read_size, ensure_write_size, line_window_size_error, open_project_directory_anchored,
    open_project_parent_anchored, project_target_exists_anchored, push_line_window,
    resolve_write_target, write_project_file_anchored_guarded, LineWindow,
};
pub(crate) use shell::__cmd__bash_execute;
pub(crate) use shell::__tauri_command_name_bash_execute;
pub use shell::bash_execute;
pub(crate) use shell::{execute_trusted_task_bash, execute_trusted_verification};

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
    crate::env_scrub::scrubbed_child_env(&[])
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

#[cfg(test)]
mod builtin_tools_contracts {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    pub(super) struct TestDir {
        pub(super) path: PathBuf,
    }

    impl TestDir {
        pub(super) fn new(label: &str) -> Self {
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
    pub(super) fn symlink_dir(original: &Path, link: &Path) {
        std::os::unix::fs::symlink(original, link).expect("create symlink");
    }

    pub(super) fn authorized_roots(root: &PathBuf) -> WorkspaceRoots {
        WorkspaceRoots::from_live_paths(std::slice::from_ref(root))
            .expect("capture test Project folder identity")
    }

    #[cfg(windows)]
    pub(super) fn symlink_dir(original: &Path, link: &Path) {
        std::os::windows::fs::symlink_dir(original, link).expect("create symlink");
    }
}
