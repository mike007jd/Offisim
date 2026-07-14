use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use crate::agent_host_runtime::HostError;
use crate::workspace_recovery::{WorkspaceRecoveryReason, WorkspaceRecoverySource};

const BINDING_TTL_MS: i64 = 24 * 60 * 60 * 1_000;
const EVALUATION_LEASE_TTL_MS: i64 = 2 * 60 * 60 * 1_000;
const REVOKED_READ_GRACE_MS: i64 =
    crate::pi_agent_host::PI_RUN_STREAM_TERMINAL_TTL_SECS as i64 * 1_000;
const PROJECT_WORKSPACE_SELECTION_TTL_MS: i64 = 10 * 60 * 1_000;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum TaskWorkspaceAccess {
    Read,
    Write,
    /// Classifier-bounded verification execution. It may create build/cache
    /// outputs, so only an original write grant can derive it. It is distinct
    /// from direct project-file Write and never receives terminal read grace.
    Verify,
}

impl TaskWorkspaceAccess {
    pub(crate) fn from_permission_mode(permission_mode: Option<&str>) -> Self {
        if matches!(permission_mode.map(str::trim), Some("plan")) {
            Self::Read
        } else {
            Self::Write
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Write => "write",
            Self::Verify => "verify",
        }
    }

    fn permits(self, requested: Self) -> bool {
        match requested {
            Self::Read => true,
            Self::Write | Self::Verify => self == Self::Write,
        }
    }

    fn permitted_during_terminal_grace(self) -> bool {
        self == Self::Read
    }
}

#[derive(Clone, Copy)]
pub(crate) struct IssueTaskWorkspaceBinding<'a> {
    pub(crate) company_id: &'a str,
    pub(crate) project_id: &'a str,
    pub(crate) thread_id: &'a str,
    pub(crate) turn_id: &'a str,
    pub(crate) request_id: &'a str,
    pub(crate) access: TaskWorkspaceAccess,
}

/// Renderer-held, ephemeral proof for a binding-scoped command. Only the
/// opaque ref and trusted scope fields participate in authorization; the
/// display projection carried alongside it is deliberately ignored here.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskWorkspaceBindingClaim {
    workspace_ref: String,
    history_id: String,
    company_id: String,
    project_id: String,
    thread_id: String,
    turn_id: String,
    request_id: String,
    access: String,
}

/// Ephemeral Mission evaluator capability. It contains no path and cannot be
/// renewed; the backend registry is the only authority for its root and scope.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskWorkspaceEvaluationLeaseClaim {
    evaluation_lease_ref: String,
    history_id: String,
    company_id: String,
    project_id: String,
    thread_id: String,
    turn_id: String,
    request_id: String,
    mission_id: String,
    attempt_id: String,
    issued_at_unix_ms: i64,
    expires_at_unix_ms: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskWorkspaceResumeCompatibility {
    status: TaskWorkspaceResumeCompatibilityStatus,
    reason: String,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskWorkspaceDeletionScope {
    Conversation,
    Project,
    Company,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskWorkspaceDeletionPreflight {
    allowed: bool,
    active_bindings: i64,
    active_leases: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
enum TaskWorkspaceResumeCompatibilityStatus {
    Same,
    Missing,
    Changed,
}

impl TaskWorkspaceEvaluationLeaseClaim {
    /// Remaining hard lifetime of this opaque capability. This is only a
    /// deadline projection; live authority still requires a registry + Mission
    /// lifecycle recheck through `resolve_task_workspace_evaluation_claim`.
    pub(crate) fn remaining_lifetime_ms(&self) -> Result<u64, String> {
        let now = now_unix_ms().map_err(host_error_message)?;
        let remaining = self.expires_at_unix_ms.saturating_sub(now);
        if remaining <= 0 {
            return Err("Task workspace evaluation lease has expired.".into());
        }
        u64::try_from(remaining)
            .map_err(|_| "Task workspace evaluation lease deadline is invalid.".to_string())
    }
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RootIdentity {
    canonical_root: String,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}

#[derive(Clone)]
pub(crate) struct AuthorizedWorkspaceRoot {
    canonical_root: PathBuf,
    root_identity: RootIdentity,
}

impl AuthorizedWorkspaceRoot {
    #[cfg(test)]
    pub(crate) fn from_live_path(path: PathBuf) -> Result<Self, String> {
        let root_identity = root_identity(&path)?;
        Ok(Self {
            canonical_root: path,
            root_identity,
        })
    }

    pub(crate) fn path(&self) -> &Path {
        &self.canonical_root
    }

    pub(crate) fn into_path(self) -> PathBuf {
        self.canonical_root
    }

    pub(crate) fn verify_live(&self) -> Result<(), String> {
        if root_identity(&self.canonical_root)? == self.root_identity {
            Ok(())
        } else {
            Err("Project folder identity changed after it was selected.".into())
        }
    }

    pub(crate) fn matches_metadata(&self, metadata: &std::fs::Metadata) -> bool {
        if !metadata.is_dir() {
            return false;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            metadata.dev() == self.root_identity.device
                && metadata.ino() == self.root_identity.inode
        }
        #[cfg(not(unix))]
        {
            true
        }
    }
}

#[derive(Clone)]
pub(crate) struct AuthorizedProcessCwd {
    authority: AuthorizedWorkspaceRoot,
    cwd: PathBuf,
    cwd_relative: PathBuf,
    #[cfg(unix)]
    cwd_device: u64,
    #[cfg(unix)]
    cwd_inode: u64,
}

impl AuthorizedProcessCwd {
    pub(crate) fn from_authority(
        authority: &AuthorizedWorkspaceRoot,
        cwd: &Path,
    ) -> Result<Self, String> {
        authority.verify_live()?;
        let canonical_cwd = cwd
            .canonicalize()
            .map_err(|error| format!("Resolve authorized process cwd: {error}"))?;
        let cwd_relative = canonical_cwd
            .strip_prefix(authority.path())
            .map_err(|_| "Process cwd escaped the authorized Project folder".to_string())?
            .to_path_buf();
        let metadata = canonical_cwd
            .metadata()
            .map_err(|error| format!("Inspect authorized process cwd: {error}"))?;
        if !metadata.is_dir() {
            return Err("Authorized process cwd must be a directory".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let scope = Self {
                authority: authority.clone(),
                cwd: canonical_cwd,
                cwd_relative,
                cwd_device: metadata.dev(),
                cwd_inode: metadata.ino(),
            };
            scope.verify_live()?;
            Ok(scope)
        }
        #[cfg(not(unix))]
        {
            let scope = Self {
                authority: authority.clone(),
                cwd: canonical_cwd,
                cwd_relative,
            };
            scope.verify_live()?;
            Ok(scope)
        }
    }

    /// Rebuild a process scope from a durable lease identity rather than from
    /// whatever currently occupies the path. This closes the gap between the
    /// lease-registry read and command binding: a same-path replacement can
    /// never become the newly captured authority.
    #[cfg(unix)]
    pub(crate) fn from_expected(
        authority: &AuthorizedWorkspaceRoot,
        cwd: &Path,
        cwd_device: u64,
        cwd_inode: u64,
    ) -> Result<Self, String> {
        authority.verify_live()?;
        let cwd_relative = cwd
            .strip_prefix(authority.path())
            .map_err(|_| "Process cwd escaped the authorized Project folder".to_string())?
            .to_path_buf();
        let scope = Self {
            authority: authority.clone(),
            cwd: cwd.to_path_buf(),
            cwd_relative,
            cwd_device,
            cwd_inode,
        };
        scope.verify_live()?;
        Ok(scope)
    }

    #[cfg(not(unix))]
    pub(crate) fn from_expected(
        authority: &AuthorizedWorkspaceRoot,
        cwd: &Path,
    ) -> Result<Self, String> {
        Self::from_authority(authority, cwd)
    }

    pub(crate) fn cwd(&self) -> &Path {
        &self.cwd
    }

    /// Narrow file authority to the exact registered process cwd. Child agents
    /// may read or mutate their own durable worktree, never the parent Project
    /// root that happens to contain it.
    pub(crate) fn authorized_cwd_root(&self) -> Result<AuthorizedWorkspaceRoot, String> {
        self.verify_live()?;
        let canonical_root = self
            .cwd
            .to_str()
            .ok_or_else(|| "Authorized process cwd is not valid UTF-8".to_string())?
            .to_string();
        #[cfg(unix)]
        let root_identity = RootIdentity {
            canonical_root,
            device: self.cwd_device,
            inode: self.cwd_inode,
        };
        #[cfg(not(unix))]
        let root_identity = RootIdentity { canonical_root };
        let authority = AuthorizedWorkspaceRoot {
            canonical_root: self.cwd.clone(),
            root_identity,
        };
        authority.verify_live()?;
        Ok(authority)
    }

    pub(crate) fn verify_live(&self) -> Result<(), String> {
        self.authority.verify_live()?;
        let canonical = self
            .cwd
            .canonicalize()
            .map_err(|error| format!("Authorized process cwd identity changed: {error}"))?;
        if canonical != self.cwd {
            return Err("Authorized process cwd identity changed".into());
        }
        let metadata = canonical
            .metadata()
            .map_err(|error| format!("Inspect authorized process cwd identity: {error}"))?;
        if !metadata.is_dir() {
            return Err("Authorized process cwd is no longer a directory".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if metadata.dev() != self.cwd_device || metadata.ino() != self.cwd_inode {
                return Err("Authorized process cwd identity changed".into());
            }
        }
        Ok(())
    }

    pub(crate) fn bind_command(&self, command: &mut tokio::process::Command) -> Result<(), String> {
        self.verify_live()?;
        #[cfg(unix)]
        {
            use std::ffi::CString;
            use std::fs::OpenOptions;
            use std::os::fd::{AsRawFd, FromRawFd};
            use std::os::unix::ffi::OsStrExt;
            use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
            use std::os::unix::process::CommandExt;

            let root = OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
                .open(self.authority.path())
                .map_err(|error| format!("Open authorized process root: {error}"))?;
            let root_metadata = root
                .metadata()
                .map_err(|error| format!("Inspect authorized process root descriptor: {error}"))?;
            if !self.authority.matches_metadata(&root_metadata) {
                return Err("Authorized process root identity changed before spawn".into());
            }
            let mut directory = root
                .try_clone()
                .map_err(|error| format!("Clone authorized process root descriptor: {error}"))?;
            let mut components = Vec::new();
            for component in self.cwd_relative.components() {
                let segment = match component {
                    std::path::Component::CurDir => continue,
                    std::path::Component::Normal(segment) => segment,
                    _ => return Err("Authorized process cwd contains an invalid component".into()),
                };
                let segment = CString::new(segment.as_bytes())
                    .map_err(|_| "Authorized process cwd contains a NUL byte".to_string())?;
                // SAFETY: directory is an open directory descriptor and
                // segment is one NUL-terminated component.
                let next_fd = unsafe {
                    libc::openat(
                        directory.as_raw_fd(),
                        segment.as_ptr(),
                        libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                    )
                };
                if next_fd < 0 {
                    return Err(format!(
                        "Open authorized process cwd component: {}",
                        std::io::Error::last_os_error()
                    ));
                }
                // SAFETY: openat returned a fresh owned descriptor.
                directory = unsafe { std::fs::File::from_raw_fd(next_fd) };
                components.push(segment);
            }
            let cwd_metadata = directory
                .metadata()
                .map_err(|error| format!("Inspect authorized process cwd descriptor: {error}"))?;
            if !cwd_metadata.is_dir()
                || cwd_metadata.dev() != self.cwd_device
                || cwd_metadata.ino() != self.cwd_inode
            {
                return Err("Authorized process cwd identity changed before spawn".into());
            }

            let root_path = CString::new(self.authority.path().as_os_str().as_bytes())
                .map_err(|_| "Authorized process root contains a NUL byte".to_string())?;
            let cwd_path = CString::new(self.cwd.as_os_str().as_bytes())
                .map_err(|_| "Authorized process cwd contains a NUL byte".to_string())?;
            let root_device = root_metadata.dev();
            let root_inode = root_metadata.ino();
            let cwd_device = self.cwd_device;
            let cwd_inode = self.cwd_inode;

            // SAFETY: the child callback uses only async-signal-safe libc calls.
            unsafe {
                command.as_std_mut().pre_exec(move || {
                    let mut root_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
                    if libc::stat(root_path.as_ptr(), root_stat.as_mut_ptr()) != 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    let root_stat = root_stat.assume_init();
                    if root_stat.st_dev as u64 != root_device || root_stat.st_ino != root_inode {
                        return Err(std::io::Error::from_raw_os_error(libc::ESTALE));
                    }
                    let mut cwd_path_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
                    if libc::stat(cwd_path.as_ptr(), cwd_path_stat.as_mut_ptr()) != 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    let cwd_path_stat = cwd_path_stat.assume_init();
                    if cwd_path_stat.st_dev as u64 != cwd_device
                        || cwd_path_stat.st_ino != cwd_inode
                    {
                        return Err(std::io::Error::from_raw_os_error(libc::ESTALE));
                    }
                    let mut walked_fd = libc::dup(root.as_raw_fd());
                    if walked_fd < 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    for segment in &components {
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
                    if walked_stat.st_dev as u64 != cwd_device || walked_stat.st_ino != cwd_inode {
                        libc::close(walked_fd);
                        return Err(std::io::Error::from_raw_os_error(libc::ESTALE));
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
        command.current_dir(&self.cwd);
        Ok(())
    }
}

#[derive(Clone)]
struct ProjectWorkspaceSelection {
    canonical_root: PathBuf,
    root_identity: RootIdentity,
    window_label: String,
    expires_at_unix_ms: i64,
}

#[derive(Default)]
pub(crate) struct ProjectWorkspaceSelectionRegistry {
    selections: Mutex<HashMap<String, ProjectWorkspaceSelection>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorkspaceSelectionClaim {
    selection_ref: String,
    display_path: String,
    expires_at_unix_ms: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreateInput {
    project_id: String,
    company_id: String,
    name: String,
    description: Option<String>,
    status: String,
    workspace_selection_ref: String,
    verify_command: Option<String>,
    verify_max_attempts: u32,
    verify_token_budget: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUpdateInput {
    project_id: String,
    name: String,
    description: Option<String>,
    status: String,
    workspace_selection_ref: Option<String>,
    verify_command: Option<String>,
    verify_max_attempts: u32,
    verify_token_budget: Option<u64>,
}

#[derive(Clone)]
pub(crate) struct TaskWorkspaceBinding {
    pub(crate) binding_ref: String,
    pub(crate) binding_id: String,
    pub(crate) company_id: String,
    pub(crate) project_id: String,
    pub(crate) thread_id: String,
    pub(crate) turn_id: String,
    pub(crate) request_id: String,
    pub(crate) access: TaskWorkspaceAccess,
    pub(crate) canonical_root: PathBuf,
    root_identity: RootIdentity,
    workspace_basename_normalized: String,
    project_name_normalized: String,
    workspace_anchor: String,
    git_origin_digest: Option<String>,
    recovery_witness_binding_id: Option<String>,
    recovery_witness_authority_project_id: Option<String>,
    authority_snapshot_canonical_root: String,
    authority_snapshot_root_identity_json: String,
    authority_snapshot_updated_at_unix_ms: i64,
    pub(crate) source: WorkspaceRecoverySource,
    pub(crate) confidence: f64,
    pub(crate) reason_code: WorkspaceRecoveryReason,
    pub(crate) issued_at_unix_ms: i64,
    pub(crate) expires_at_unix_ms: i64,
    pub(crate) project_verify_command: Option<String>,
    pub(crate) project_verify_max_attempts: u32,
    pub(crate) project_verify_token_budget: Option<u64>,
}

#[derive(Clone, Debug)]
pub(crate) struct TaskWorkspaceUnavailable {
    pub(crate) reason_code: WorkspaceRecoveryReason,
    pub(crate) source: WorkspaceRecoverySource,
    pub(crate) candidate_count: usize,
}

#[derive(Clone)]
pub(crate) enum TaskWorkspaceResolution {
    Bound {
        binding: Box<TaskWorkspaceBinding>,
        resume_session: Option<NativeSessionReference>,
    },
    Unavailable(TaskWorkspaceUnavailable),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NativeSessionReference {
    pub(crate) file: PathBuf,
    pub(crate) id: String,
}

impl TaskWorkspaceBinding {
    pub(crate) fn verify_live_root(&self) -> Result<(), String> {
        if root_identity(&self.canonical_root)? == self.root_identity {
            Ok(())
        } else {
            Err("Task workspace Project folder identity changed after binding issuance.".into())
        }
    }

    pub(crate) fn expected_root_identity_json(&self) -> Result<String, String> {
        serde_json::to_string(&self.root_identity)
            .map_err(|error| format!("Encode task workspace root identity: {error}"))
    }

    pub(crate) fn authorized_root(&self) -> AuthorizedWorkspaceRoot {
        AuthorizedWorkspaceRoot {
            canonical_root: self.canonical_root.clone(),
            root_identity: self.root_identity.clone(),
        }
    }
}

#[derive(Clone)]
struct ActiveBinding {
    binding: TaskWorkspaceBinding,
    revoked_at_unix_ms: Option<i64>,
    read_grace_until_unix_ms: Option<i64>,
    revocation_reason: Option<TaskWorkspaceAuthorityLossReason>,
}

#[derive(Clone)]
struct EvaluationLease {
    claim: TaskWorkspaceEvaluationLeaseClaim,
    canonical_root: PathBuf,
    root_identity: RootIdentity,
    released: bool,
}

struct VerifiedEvaluationScope {
    mission_id: String,
    attempt_id: String,
}

#[derive(Clone, Copy)]
enum EvaluationScopePhase {
    Acquire,
    Use,
}

fn validate_evaluation_lifecycle_status(
    mission_status: &str,
    attempt_status: &str,
    finished: bool,
    phase: EvaluationScopePhase,
) -> Result<(), String> {
    let expected_mission_status = match phase {
        EvaluationScopePhase::Acquire => "running",
        EvaluationScopePhase::Use => "verifying",
    };
    if mission_status == expected_mission_status && attempt_status == "running" && !finished {
        Ok(())
    } else {
        Err("Mission evaluation is no longer active.".into())
    }
}

#[derive(Default)]
pub(crate) struct TaskWorkspaceBindingRegistry {
    active: Mutex<HashMap<String, ActiveBinding>>,
    evaluation_leases: Mutex<HashMap<String, EvaluationLease>>,
}

enum ResolveBindingError {
    Invalid,
    Expired,
    Scope,
    Access,
    Revoked,
    RootChanged,
    Registry(String),
}

impl ResolveBindingError {
    fn into_host_error(self) -> HostError {
        let message = match self {
            Self::Invalid => "Task workspace binding is invalid.",
            Self::Expired => "Task workspace binding has expired.",
            Self::Scope => "Task workspace binding scope does not match this request.",
            Self::Access => "Task workspace binding does not grant the requested access.",
            Self::Revoked => "Task workspace binding has been revoked.",
            Self::RootChanged => "Task workspace root identity changed after binding.",
            Self::Registry(ref message) => message,
        };
        HostError::Request(message.to_string())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TaskWorkspaceAuthorityLossReason {
    Invalid,
    Expired,
    ScopeMismatch,
    AccessDenied,
    Revoked,
    RootIdentityChanged,
    RegistryUnavailable,
}

#[derive(Debug)]
pub(crate) struct TaskWorkspaceAuthorityError {
    reason: TaskWorkspaceAuthorityLossReason,
    message: String,
}

struct RegistryRevocation {
    binding_id: String,
    revoked_at_unix_ms: i64,
    grace_until_unix_ms: i64,
    reason: TaskWorkspaceAuthorityLossReason,
}

impl TaskWorkspaceAuthorityError {
    pub(crate) fn reason(&self) -> TaskWorkspaceAuthorityLossReason {
        self.reason
    }

    pub(crate) fn into_host_error(self) -> HostError {
        HostError::Request(self.message)
    }
}

impl From<ResolveBindingError> for TaskWorkspaceAuthorityError {
    fn from(error: ResolveBindingError) -> Self {
        let reason = match &error {
            ResolveBindingError::Invalid => TaskWorkspaceAuthorityLossReason::Invalid,
            ResolveBindingError::Expired => TaskWorkspaceAuthorityLossReason::Expired,
            ResolveBindingError::Scope => TaskWorkspaceAuthorityLossReason::ScopeMismatch,
            ResolveBindingError::Access => TaskWorkspaceAuthorityLossReason::AccessDenied,
            ResolveBindingError::Revoked => TaskWorkspaceAuthorityLossReason::Revoked,
            ResolveBindingError::RootChanged => {
                TaskWorkspaceAuthorityLossReason::RootIdentityChanged
            }
            ResolveBindingError::Registry(_) => {
                TaskWorkspaceAuthorityLossReason::RegistryUnavailable
            }
        };
        let detail = host_error_message(error.into_host_error());
        Self {
            reason,
            message: format!(
                "Task workspace authority was lost while the run was active: {detail}"
            ),
        }
    }
}

impl ProjectWorkspaceSelectionRegistry {
    fn register(
        &self,
        window_label: &str,
        canonical_root: PathBuf,
        now: i64,
    ) -> Result<ProjectWorkspaceSelectionClaim, String> {
        let root_identity = root_identity(&canonical_root)?;
        let display_path = canonical_root_text(&canonical_root).map_err(host_error_message)?;
        let selection_ref = random_ref();
        let expires_at_unix_ms = now.saturating_add(PROJECT_WORKSPACE_SELECTION_TTL_MS);
        let mut selections = self
            .selections
            .lock()
            .map_err(|_| "Project workspace selection registry is unavailable.".to_string())?;
        selections.retain(|_, selection| selection.expires_at_unix_ms >= now);
        selections.insert(
            selection_ref.clone(),
            ProjectWorkspaceSelection {
                canonical_root,
                root_identity,
                window_label: window_label.to_string(),
                expires_at_unix_ms,
            },
        );
        Ok(ProjectWorkspaceSelectionClaim {
            selection_ref,
            display_path,
            expires_at_unix_ms,
        })
    }

    fn consume(
        &self,
        selection_ref: &str,
        window_label: &str,
        now: i64,
    ) -> Result<ProjectWorkspaceSelection, String> {
        let mut selections = self
            .selections
            .lock()
            .map_err(|_| "Project workspace selection registry is unavailable.".to_string())?;
        let selection = selections.remove(selection_ref).ok_or_else(|| {
            "Project folder selection is invalid, expired, or already used. Choose the folder again."
                .to_string()
        })?;
        if selection.window_label != window_label {
            return Err(
                "Project folder selection belongs to another window. Choose the folder again."
                    .into(),
            );
        }
        if selection.expires_at_unix_ms < now {
            return Err("Project folder selection expired. Choose the folder again.".into());
        }
        let live_identity = root_identity(&selection.canonical_root)?;
        if live_identity != selection.root_identity {
            return Err(
                "The selected Project folder changed before it could be saved. Choose it again."
                    .into(),
            );
        }
        Ok(selection)
    }
}

impl TaskWorkspaceBindingRegistry {
    fn insert(&self, binding: TaskWorkspaceBinding, now: i64) -> Result<(), HostError> {
        let mut active = self.active.lock().map_err(|_| {
            HostError::HostUnavailable("Task workspace registry lock is poisoned.".into())
        })?;
        active.retain(|_, entry| {
            if entry.revoked_at_unix_ms.is_some() {
                entry
                    .read_grace_until_unix_ms
                    .map(|until| until >= now)
                    .unwrap_or(false)
            } else {
                entry
                    .binding
                    .expires_at_unix_ms
                    .saturating_add(REVOKED_READ_GRACE_MS)
                    >= now
            }
        });
        active.insert(
            binding.binding_ref.clone(),
            ActiveBinding {
                binding,
                revoked_at_unix_ms: None,
                read_grace_until_unix_ms: None,
                revocation_reason: None,
            },
        );
        Ok(())
    }

    fn remove_unpublished(&self, binding_ref: &str) -> Result<(), HostError> {
        let mut active = self.active.lock().map_err(|_| {
            HostError::HostUnavailable("Task workspace registry lock is poisoned.".into())
        })?;
        active.remove(binding_ref);
        Ok(())
    }

    fn live_binding_ids(&self, now: i64) -> Result<HashSet<String>, HostError> {
        let active = self.active.lock().map_err(|_| {
            HostError::HostUnavailable("Task workspace registry lock is poisoned.".into())
        })?;
        Ok(active
            .values()
            .filter(|entry| {
                entry.revoked_at_unix_ms.is_none()
                    && entry.binding.expires_at_unix_ms > now
                    && root_identity(&entry.binding.canonical_root)
                        .is_ok_and(|identity| identity == entry.binding.root_identity)
            })
            .map(|entry| entry.binding.binding_id.clone())
            .collect())
    }

    fn resolve_at(
        &self,
        binding_ref: &str,
        scope: &IssueTaskWorkspaceBinding<'_>,
        now: i64,
    ) -> Result<TaskWorkspaceBinding, ResolveBindingError> {
        let active = self.active.lock().map_err(|_| {
            ResolveBindingError::Registry("Task workspace registry lock is poisoned.".into())
        })?;
        let Some(entry) = active.get(binding_ref) else {
            return Err(ResolveBindingError::Invalid);
        };
        if entry.binding.company_id != scope.company_id
            || entry.binding.project_id != scope.project_id
            || entry.binding.thread_id != scope.thread_id
            || entry.binding.turn_id != scope.turn_id
            || entry.binding.request_id != scope.request_id
        {
            return Err(ResolveBindingError::Scope);
        }
        if !entry.binding.access.permits(scope.access) {
            return Err(ResolveBindingError::Access);
        }
        if entry.revoked_at_unix_ms.is_some() {
            if !scope.access.permitted_during_terminal_grace()
                || entry
                    .read_grace_until_unix_ms
                    .map(|until| until < now)
                    .unwrap_or(true)
            {
                return Err(
                    if entry.revocation_reason == Some(TaskWorkspaceAuthorityLossReason::Expired) {
                        ResolveBindingError::Expired
                    } else {
                        ResolveBindingError::Revoked
                    },
                );
            }
        } else if entry.binding.expires_at_unix_ms <= now {
            return Err(ResolveBindingError::Expired);
        }
        if root_identity(&entry.binding.canonical_root)
            .map_err(|_| ResolveBindingError::RootChanged)?
            != entry.binding.root_identity
        {
            return Err(ResolveBindingError::RootChanged);
        }
        Ok(entry.binding.clone())
    }

    fn validate_authority_at(
        &self,
        binding_ref: &str,
        scope: &IssueTaskWorkspaceBinding<'_>,
        now: i64,
    ) -> Result<(), ResolveBindingError> {
        self.resolve_at(binding_ref, scope, now).map(|_| ())
    }

    fn transition_revocation(
        &self,
        binding_ref: &str,
        now: i64,
        reason: TaskWorkspaceAuthorityLossReason,
    ) -> Result<RegistryRevocation, HostError> {
        let mut active = self.active.lock().map_err(|_| {
            HostError::HostUnavailable("Task workspace registry lock is poisoned.".into())
        })?;
        let entry = active.get_mut(binding_ref).ok_or_else(|| {
            HostError::Request("Task workspace binding is no longer active.".into())
        })?;
        if let (Some(revoked_at), Some(grace_until), Some(existing_reason)) = (
            entry.revoked_at_unix_ms,
            entry.read_grace_until_unix_ms,
            entry.revocation_reason,
        ) {
            return Ok(RegistryRevocation {
                binding_id: entry.binding.binding_id.clone(),
                revoked_at_unix_ms: revoked_at,
                grace_until_unix_ms: grace_until,
                reason: existing_reason,
            });
        }
        let grace_until = now.saturating_add(REVOKED_READ_GRACE_MS);
        entry.revoked_at_unix_ms = Some(now);
        entry.read_grace_until_unix_ms = Some(grace_until);
        entry.revocation_reason = Some(reason);
        Ok(RegistryRevocation {
            binding_id: entry.binding.binding_id.clone(),
            revoked_at_unix_ms: now,
            grace_until_unix_ms: grace_until,
            reason,
        })
    }

    fn revoke(&self, binding_ref: &str, now: i64) -> Result<RegistryRevocation, HostError> {
        self.transition_revocation(binding_ref, now, TaskWorkspaceAuthorityLossReason::Revoked)
    }

    fn expire(&self, binding_ref: &str, now: i64) -> Result<RegistryRevocation, HostError> {
        self.transition_revocation(binding_ref, now, TaskWorkspaceAuthorityLossReason::Expired)
    }

    fn replayable_for_request_at(
        &self,
        request_id: &str,
        now: i64,
    ) -> Result<Option<TaskWorkspaceBinding>, HostError> {
        let active = self.active.lock().map_err(|_| {
            HostError::HostUnavailable("Task workspace registry lock is poisoned.".into())
        })?;
        let binding = active
            .values()
            .filter(|entry| {
                entry.binding.request_id == request_id
                    && if entry.revoked_at_unix_ms.is_some() {
                        entry
                            .read_grace_until_unix_ms
                            .map(|until| until >= now)
                            .unwrap_or(false)
                    } else {
                        entry.binding.expires_at_unix_ms > now
                    }
            })
            .max_by_key(|entry| entry.binding.issued_at_unix_ms)
            .map(|entry| entry.binding.clone());
        match binding {
            Some(binding)
                if root_identity(&binding.canonical_root)
                    .map(|identity| identity == binding.root_identity)
                    .unwrap_or(false) =>
            {
                Ok(Some(binding))
            }
            Some(_) => Err(HostError::Request(
                "Task workspace root identity changed after binding.".into(),
            )),
            None => Ok(None),
        }
    }

    fn resolve_evaluation_binding_at(
        &self,
        binding_claim: &TaskWorkspaceBindingClaim,
        now: i64,
    ) -> Result<TaskWorkspaceBinding, String> {
        let scope = IssueTaskWorkspaceBinding {
            company_id: &binding_claim.company_id,
            project_id: &binding_claim.project_id,
            thread_id: &binding_claim.thread_id,
            turn_id: &binding_claim.turn_id,
            request_id: &binding_claim.request_id,
            access: TaskWorkspaceAccess::Read,
        };
        let binding = self
            .resolve_at(&binding_claim.workspace_ref, &scope, now)
            .map_err(|error| host_error_message(error.into_host_error()))?;
        validate_task_workspace_claim(&binding, binding_claim, None)?;
        if binding.access != TaskWorkspaceAccess::Write {
            return Err(
                "Mission evaluation requires an original write-capable workspace binding.".into(),
            );
        }
        Ok(binding)
    }

    fn acquire_evaluation_lease_at(
        &self,
        binding: TaskWorkspaceBinding,
        verified: VerifiedEvaluationScope,
        now: i64,
    ) -> Result<TaskWorkspaceEvaluationLeaseClaim, String> {
        let mut leases = self
            .evaluation_leases
            .lock()
            .map_err(|_| "Task workspace evaluation lease registry is unavailable.".to_string())?;
        if let Some(existing) = leases.values().find(|lease| {
            lease.claim.history_id == binding.binding_id
                && lease.claim.mission_id == verified.mission_id
                && lease.claim.attempt_id == verified.attempt_id
        }) {
            if !existing.released && now < existing.claim.expires_at_unix_ms {
                return Ok(existing.claim.clone());
            }
            return Err(
                "Task workspace evaluation lease already ended and cannot be renewed.".into(),
            );
        }

        let claim = TaskWorkspaceEvaluationLeaseClaim {
            evaluation_lease_ref: random_ref(),
            history_id: binding.binding_id.clone(),
            company_id: binding.company_id.clone(),
            project_id: binding.project_id.clone(),
            thread_id: binding.thread_id.clone(),
            turn_id: binding.turn_id.clone(),
            request_id: binding.request_id.clone(),
            mission_id: verified.mission_id,
            attempt_id: verified.attempt_id,
            issued_at_unix_ms: now,
            expires_at_unix_ms: now.saturating_add(EVALUATION_LEASE_TTL_MS),
        };
        leases.insert(
            claim.evaluation_lease_ref.clone(),
            EvaluationLease {
                claim: claim.clone(),
                canonical_root: binding.canonical_root,
                root_identity: binding.root_identity,
                released: false,
            },
        );
        Ok(claim)
    }

    fn resolve_evaluation_lease_at(
        &self,
        claim: &TaskWorkspaceEvaluationLeaseClaim,
        catalog_project_id: Option<&str>,
        requested_access: TaskWorkspaceAccess,
        now: i64,
    ) -> Result<EvaluationLease, String> {
        if !matches!(
            requested_access,
            TaskWorkspaceAccess::Read | TaskWorkspaceAccess::Verify
        ) {
            return Err(
                "Task workspace evaluation lease never grants direct project write access.".into(),
            );
        }
        let leases = self
            .evaluation_leases
            .lock()
            .map_err(|_| "Task workspace evaluation lease registry is unavailable.".to_string())?;
        let lease = leases
            .get(&claim.evaluation_lease_ref)
            .ok_or_else(|| "Task workspace evaluation lease is invalid.".to_string())?;
        validate_evaluation_lease_claim(lease, claim, catalog_project_id)?;
        if lease.released {
            return Err("Task workspace evaluation lease has been released.".into());
        }
        if now >= lease.claim.expires_at_unix_ms {
            return Err("Task workspace evaluation lease has expired.".into());
        }
        if root_identity(&lease.canonical_root)? != lease.root_identity {
            return Err(
                "Task workspace evaluation root identity changed after lease issue.".into(),
            );
        }
        Ok(lease.clone())
    }

    fn invalidate_evaluation_lease(&self, evaluation_lease_ref: &str) {
        if let Ok(mut leases) = self.evaluation_leases.lock() {
            if let Some(lease) = leases.get_mut(evaluation_lease_ref) {
                lease.released = true;
            }
        }
    }

    fn release_evaluation_lease_at(
        &self,
        claim: &TaskWorkspaceEvaluationLeaseClaim,
        now: i64,
    ) -> Result<(), String> {
        let mut leases = self
            .evaluation_leases
            .lock()
            .map_err(|_| "Task workspace evaluation lease registry is unavailable.".to_string())?;
        let lease = leases
            .get_mut(&claim.evaluation_lease_ref)
            .ok_or_else(|| "Task workspace evaluation lease is invalid.".to_string())?;
        validate_evaluation_lease_claim(lease, claim, None)?;
        if lease.released || now >= lease.claim.expires_at_unix_ms {
            return Ok(());
        }
        lease.released = true;
        Ok(())
    }
}

#[derive(Clone, Copy)]
pub(crate) enum TaskWorkspaceTerminalStatus {
    Completed,
    Failed,
    Aborted,
    Expired,
}

impl TaskWorkspaceTerminalStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Aborted => "aborted",
            Self::Expired => "expired",
        }
    }
}

fn now_unix_ms() -> Result<i64, HostError> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| HostError::HostUnavailable(format!("Read system clock: {err}")))?
        .as_millis();
    i64::try_from(millis)
        .map_err(|_| HostError::HostUnavailable("System clock is out of range.".into()))
}

fn random_ref() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn random_id() -> String {
    let mut bytes = [0_u8; 16];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn canonical_root_text(path: &Path) -> Result<String, HostError> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| HostError::Request("Project workspace path is not valid UTF-8.".into()))
}

fn root_identity(path: &Path) -> Result<RootIdentity, String> {
    let metadata = path
        .metadata()
        .map_err(|err| format!("Inspect project workspace: {err}"))?;
    if !metadata.is_dir() {
        return Err("Project workspace must be an existing directory.".into());
    }
    let canonical_root = path
        .to_str()
        .ok_or_else(|| "Project workspace path is not valid UTF-8.".to_string())?
        .to_string();
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(RootIdentity {
            canonical_root,
            device: metadata.dev(),
            inode: metadata.ino(),
        })
    }
    #[cfg(not(unix))]
    {
        Ok(RootIdentity { canonical_root })
    }
}

pub(crate) async fn resolve_authorized_project_workspace_from_pool(
    pool: &sqlx::SqlitePool,
    project_id: &str,
) -> Result<AuthorizedWorkspaceRoot, String> {
    let row = sqlx::query(
        r#"
        SELECT project.workspace_root, authority.root_identity_json
        FROM projects AS project
        JOIN project_workspace_authority AS authority
          ON authority.project_id = project.project_id
         AND authority.company_id = project.company_id
         AND authority.canonical_root = project.workspace_root
        WHERE project.project_id = ?
          AND trim(project.workspace_root) <> ''
        "#,
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Read Project folder authority: {error}"))?
    .ok_or_else(|| "No authorized Project folder is selected for this Project.".to_string())?;
    let raw_root: String = row
        .try_get("workspace_root")
        .map_err(|error| format!("Decode Project folder: {error}"))?;
    let identity_json: String = row
        .try_get("root_identity_json")
        .map_err(|error| format!("Decode Project folder identity: {error}"))?;
    let expected: RootIdentity = serde_json::from_str(&identity_json)
        .map_err(|_| "Project folder authority is invalid.".to_string())?;
    let canonical_root = crate::local_paths::resolve_project_workspace_root_path(raw_root)?;
    let authority = AuthorizedWorkspaceRoot {
        canonical_root,
        root_identity: expected,
    };
    authority.verify_live()?;
    Ok(authority)
}

pub(crate) async fn resolve_authorized_project_workspace<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: &str,
) -> Result<AuthorizedWorkspaceRoot, String> {
    let pool = crate::local_db::get_offisim_pool(app)?;
    resolve_authorized_project_workspace_from_pool(&pool, project_id).await
}

fn required_scope_text<'a>(value: &'a str, field: &str) -> Result<&'a str, HostError> {
    let value = value.trim();
    if value.is_empty() {
        Err(HostError::Request(format!(
            "{field} is required for task workspace binding."
        )))
    } else {
        Ok(value)
    }
}

fn resume_history_is_recoverable(binding_status: &str, agent_run_status: Option<&str>) -> bool {
    binding_status == "app_restart" && agent_run_status == Some("interrupted")
}

const MAX_RESUME_SESSION_HEADER_BYTES: u64 = 64 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResumePrestartFailureKind {
    SessionMissing,
    SessionInvalid,
    RuntimeIncompatible,
    ContextInvalid,
    Conflict,
    Persistence,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ResettableNativeSessionPrestartCode {
    Missing,
    Invalid,
    RuntimeIncompatible,
    ContextInvalid,
}

impl ResettableNativeSessionPrestartCode {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "native-session-missing" => Some(Self::Missing),
            "native-session-invalid" => Some(Self::Invalid),
            "native-session-runtime-incompatible" => Some(Self::RuntimeIncompatible),
            "native-session-context-invalid" => Some(Self::ContextInvalid),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Missing => "native-session-missing",
            Self::Invalid => "native-session-invalid",
            Self::RuntimeIncompatible => "native-session-runtime-incompatible",
            Self::ContextInvalid => "native-session-context-invalid",
        }
    }
}

impl ResumePrestartFailureKind {
    fn code(self) -> &'static str {
        match self {
            Self::SessionMissing => "resume-prestart-session-missing",
            Self::SessionInvalid => "resume-prestart-session-invalid",
            Self::RuntimeIncompatible => "resume-prestart-runtime-incompatible",
            Self::ContextInvalid => "resume-prestart-context-invalid",
            Self::Conflict => "resume-prestart-conflict",
            Self::Persistence => "resume-prestart-persistence",
        }
    }

    fn compatibility_reason(self) -> &'static str {
        match self {
            Self::SessionMissing => "session_missing",
            Self::SessionInvalid => "session_invalid",
            Self::RuntimeIncompatible => "runtime_incompatible",
            Self::ContextInvalid => "resume_context_invalid",
            Self::Conflict => "resume_conflict",
            Self::Persistence => "resume_persistence_unavailable",
        }
    }

    fn native_session_code(self) -> &'static str {
        match self {
            Self::SessionMissing => ResettableNativeSessionPrestartCode::Missing.as_str(),
            Self::SessionInvalid => ResettableNativeSessionPrestartCode::Invalid.as_str(),
            Self::RuntimeIncompatible => {
                ResettableNativeSessionPrestartCode::RuntimeIncompatible.as_str()
            }
            Self::ContextInvalid => ResettableNativeSessionPrestartCode::ContextInvalid.as_str(),
            Self::Conflict => "native-session-conflict",
            Self::Persistence => "native-session-persistence",
        }
    }
}

#[derive(Debug)]
struct ResumePrestartFailure {
    kind: ResumePrestartFailureKind,
    message: String,
}

impl ResumePrestartFailure {
    fn new(kind: ResumePrestartFailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    fn into_host_error(self) -> HostError {
        HostError::ResumePrestart {
            code: self.kind.code(),
            message: self.message,
        }
    }

    fn into_native_session_host_error(self) -> HostError {
        HostError::NativeSessionPrestart {
            code: self.kind.native_session_code(),
            message: self.message,
        }
    }
}

fn classify_resume_database_failure(error: sqlx::Error, action: &str) -> ResumePrestartFailure {
    if matches!(
        &error,
        sqlx::Error::Database(database_error) if database_error.is_unique_violation()
    ) {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::Conflict,
            "This Conversation already has another running root or this interrupted task was already resumed.",
        )
    } else {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::Persistence,
            format!("{action}: {error}"),
        )
    }
}

struct ResumeRootExpectation<'a> {
    history_id: &'a str,
    original_request_id: &'a str,
    company_id: &'a str,
    project_id: &'a str,
    thread_id: &'a str,
    turn_id: &'a str,
    access: &'a str,
    source: &'a str,
    reason_code: &'a str,
}

struct ValidatedResumeRoot {
    context: serde_json::Value,
    session_file: PathBuf,
    session_id: String,
    stored_session_file: String,
}

fn context_string_matches(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
    expected: &str,
) -> bool {
    object.get(key).and_then(serde_json::Value::as_str) == Some(expected)
}

fn validate_exact_native_session_file(
    expected_session_dir: &Path,
    stored_session_file: Option<&str>,
) -> Result<(PathBuf, String, String), ResumePrestartFailure> {
    let stored_session_file = stored_session_file
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::SessionMissing,
                "The Conversation has no saved native Pi session reference.",
            )
        })?
        .to_string();
    let stored_path = Path::new(&stored_session_file);
    if !stored_path.is_absolute() {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::SessionInvalid,
            "The saved native Pi session reference is invalid.",
        ));
    }
    let stored_metadata = match std::fs::symlink_metadata(stored_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(ResumePrestartFailure::new(
                ResumePrestartFailureKind::SessionMissing,
                "The saved native Pi session no longer exists.",
            ));
        }
        Err(error) => {
            return Err(ResumePrestartFailure::new(
                ResumePrestartFailureKind::SessionInvalid,
                format!("Inspect the saved native Pi session: {error}"),
            ));
        }
    };
    if stored_metadata.file_type().is_symlink() || !stored_metadata.is_file() {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::SessionInvalid,
            "The saved native Pi session is not a regular session file.",
        ));
    }
    let canonical_session_dir = match expected_session_dir.canonicalize() {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(ResumePrestartFailure::new(
                ResumePrestartFailureKind::SessionMissing,
                "The Conversation native Pi session directory no longer exists.",
            ));
        }
        Err(error) => {
            return Err(ResumePrestartFailure::new(
                ResumePrestartFailureKind::SessionInvalid,
                format!("Inspect the Conversation native Pi session directory: {error}"),
            ));
        }
    };
    let canonical_session_file = stored_path.canonicalize().map_err(|error| {
        let kind = if error.kind() == std::io::ErrorKind::NotFound {
            ResumePrestartFailureKind::SessionMissing
        } else {
            ResumePrestartFailureKind::SessionInvalid
        };
        ResumePrestartFailure::new(
            kind,
            format!("Resolve the saved native Pi session: {error}"),
        )
    })?;
    if canonical_session_file.parent() != Some(canonical_session_dir.as_path())
        || canonical_session_file
            .extension()
            .and_then(|value| value.to_str())
            != Some("jsonl")
    {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::SessionInvalid,
            "The saved native Pi session escaped its Conversation session directory.",
        ));
    }
    let file = std::fs::File::open(&canonical_session_file).map_err(|error| {
        let kind = if error.kind() == std::io::ErrorKind::NotFound {
            ResumePrestartFailureKind::SessionMissing
        } else {
            ResumePrestartFailureKind::SessionInvalid
        };
        ResumePrestartFailure::new(kind, format!("Open the saved native Pi session: {error}"))
    })?;
    let mut first_line = String::new();
    let mut limited = std::io::Read::take(
        std::io::BufReader::new(file),
        MAX_RESUME_SESSION_HEADER_BYTES + 1,
    );
    std::io::BufRead::read_line(&mut limited, &mut first_line).map_err(|error| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::SessionInvalid,
            format!("Read the saved native Pi session header: {error}"),
        )
    })?;
    if first_line.len() as u64 > MAX_RESUME_SESSION_HEADER_BYTES {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::SessionInvalid,
            "The saved native Pi session header is invalid.",
        ));
    }
    let header: serde_json::Value = serde_json::from_str(first_line.trim_end()).map_err(|_| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::SessionInvalid,
            "The saved native Pi session header is invalid.",
        )
    })?;
    let session_id = header
        .get("id")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let valid_header = header.get("type").and_then(serde_json::Value::as_str) == Some("session")
        && session_id.is_some()
        && header
            .get("cwd")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|value| !value.trim().is_empty());
    if !valid_header {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::SessionInvalid,
            "The saved native Pi session header is invalid.",
        ));
    }
    Ok((
        canonical_session_file,
        stored_session_file,
        session_id.expect("validated native session id").to_string(),
    ))
}

fn validate_conversation_native_session(
    runtime_context_json: Option<&str>,
    stored_session_file: Option<&str>,
    expected_session_dir: &Path,
) -> Result<(PathBuf, String), ResumePrestartFailure> {
    let context: serde_json::Value = runtime_context_json
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::ContextInvalid,
                "The saved Conversation native session context is missing.",
            )
        })?
        .parse()
        .map_err(|_| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::ContextInvalid,
                "The saved Conversation native session context is invalid.",
            )
        })?;
    let context_object = context.as_object().ok_or_else(|| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::ContextInvalid,
            "The saved Conversation native session context is invalid.",
        )
    })?;
    let compatible_runtime = context_string_matches(context_object, "runtime", "pi-agent")
        && context_object
            .get("wireProtocolVersion")
            .and_then(serde_json::Value::as_u64)
            == Some(u64::from(crate::pi_agent_host::PI_HOST_PROTOCOL_VERSION));
    if !compatible_runtime {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::RuntimeIncompatible,
            "The saved Conversation session belongs to another or incompatible native Agent runtime.",
        ));
    }
    let (session_file, _stored_session_file, session_id) =
        validate_exact_native_session_file(expected_session_dir, stored_session_file)?;
    if !context_string_matches(context_object, "nativeSessionId", &session_id) {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::SessionInvalid,
            "The saved Conversation native session identity no longer matches its session file.",
        ));
    }
    Ok((session_file, session_id))
}

async fn resolve_conversation_native_session_from_pool(
    pool: &sqlx::SqlitePool,
    expected_session_dir: &Path,
    company_id: &str,
    thread_id: &str,
    current_root_run_id: &str,
) -> Result<Option<(PathBuf, String)>, HostError> {
    let interrupted_root: Option<String> = sqlx::query_scalar(
        r#"
        SELECT run_id
        FROM agent_runs
        WHERE company_id = ? AND thread_id = ?
          AND run_id = root_run_id AND parent_run_id IS NULL
          AND run_id <> ? AND status = 'interrupted'
        ORDER BY started_at DESC, run_id DESC
        LIMIT 1
        "#,
    )
    .bind(company_id)
    .bind(thread_id)
    .bind(current_root_run_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| HostError::NativeSessionPrestart {
        code: "native-session-persistence",
        message: format!("Check the Conversation for an interrupted root: {error}"),
    })?;
    if interrupted_root.is_some() {
        return Err(HostError::NativeSessionPrestart {
            code: "native-session-interrupted-root",
            message:
                "Resume or discard the interrupted task before starting another Turn in this Conversation."
                    .into(),
        });
    }
    let row = sqlx::query(
        r#"
        SELECT runtime_context_json, session_file
        FROM agent_runs
        WHERE company_id = ? AND thread_id = ?
          AND run_id = root_run_id AND parent_run_id IS NULL
          AND run_id <> ?
          AND status IN ('completed', 'failed', 'cancelled')
          AND (
            (session_file IS NOT NULL AND trim(session_file) <> '')
            OR CASE
                 WHEN json_valid(runtime_context_json)
                 THEN COALESCE(trim(json_extract(runtime_context_json, '$.nativeSessionId')), '') <> ''
                   OR json_extract(runtime_context_json, '$.nativeSessionReset') = 1
                 ELSE 0
               END
          )
        ORDER BY COALESCE(NULLIF(finished_at, ''), started_at) DESC,
                 started_at DESC,
                 run_id DESC
        LIMIT 1
        "#,
    )
    .bind(company_id)
    .bind(thread_id)
    .bind(current_root_run_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| HostError::NativeSessionPrestart {
        code: "native-session-persistence",
        message: format!("Read the Conversation's durable native session: {error}"),
    })?;
    let Some(row) = row else {
        return Ok(None);
    };
    let runtime_context_json: Option<String> =
        row.try_get("runtime_context_json")
            .map_err(|error| HostError::NativeSessionPrestart {
                code: "native-session-persistence",
                message: format!("Decode the Conversation native session context: {error}"),
            })?;
    let session_file: Option<String> =
        row.try_get("session_file")
            .map_err(|error| HostError::NativeSessionPrestart {
                code: "native-session-persistence",
                message: format!("Decode the Conversation native session reference: {error}"),
            })?;
    if runtime_context_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|context| {
            context
                .get("nativeSessionReset")
                .and_then(serde_json::Value::as_bool)
        })
        == Some(true)
    {
        return Ok(None);
    }
    validate_conversation_native_session(
        runtime_context_json.as_deref(),
        session_file.as_deref(),
        expected_session_dir,
    )
    .map(Some)
    .map_err(ResumePrestartFailure::into_native_session_host_error)
}

pub(crate) async fn resolve_conversation_native_session_for_execute<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    company_id: &str,
    thread_id: &str,
    current_root_run_id: &str,
) -> Result<Option<(PathBuf, String)>, HostError> {
    let pool = crate::local_db::get_offisim_pool(app)
        .map_err(|error| HostError::HostUnavailable(format!("Open offisim.db: {error}")))?;
    let session_dir = crate::pi_agent_host::app_pi_session_dir(app, thread_id)?;
    resolve_conversation_native_session_from_pool(
        &pool,
        &session_dir,
        company_id,
        thread_id,
        current_root_run_id,
    )
    .await
}

pub(crate) async fn persist_conversation_native_session_reset<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    company_id: &str,
    thread_id: &str,
    source_failed_root_run_id: &str,
    target_root_run_id: &str,
) -> Result<(), HostError> {
    let pool = crate::local_db::get_offisim_pool(app)
        .map_err(|error| HostError::HostUnavailable(format!("Open offisim.db: {error}")))?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| HostError::NativeSessionPrestart {
            code: "native-session-reset-persistence",
            message: format!("Begin the fresh-session reset transaction: {error}"),
        })?;
    let operation: Result<(), HostError> = async {
        let target_rowid: i64 = sqlx::query_scalar(
            r#"
            SELECT rowid
            FROM agent_runs
            WHERE run_id = ? AND root_run_id = ? AND parent_run_id IS NULL
              AND company_id = ? AND thread_id = ? AND status = 'running'
            "#,
        )
        .bind(target_root_run_id)
        .bind(target_root_run_id)
        .bind(company_id)
        .bind(thread_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| HostError::NativeSessionPrestart {
            code: "native-session-reset-persistence",
            message: format!("Read the Turn requesting Start fresh session: {error}"),
        })?
        .ok_or_else(|| HostError::NativeSessionPrestart {
            code: "native-session-reset-invalid",
            message: "Start fresh session no longer matches the current running Turn.".into(),
        })?;

        let latest_root_run_id: Option<String> = sqlx::query_scalar(
            r#"
            SELECT run_id
            FROM agent_runs
            WHERE company_id = ? AND thread_id = ?
              AND run_id = root_run_id AND parent_run_id IS NULL
            ORDER BY rowid DESC
            LIMIT 1
            "#,
        )
        .bind(company_id)
        .bind(thread_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| HostError::NativeSessionPrestart {
            code: "native-session-reset-persistence",
            message: format!("Check the latest Conversation Turn: {error}"),
        })?;
        if latest_root_run_id.as_deref() != Some(target_root_run_id) {
            return Err(HostError::NativeSessionPrestart {
                code: "native-session-reset-invalid",
                message: "A newer Conversation Turn replaced this Start fresh session action."
                    .into(),
            });
        }

        let row = sqlx::query(
            r#"
            SELECT run_id, status, runtime_context_json, session_file
            FROM agent_runs
            WHERE company_id = ? AND thread_id = ?
              AND run_id = root_run_id AND parent_run_id IS NULL
              AND rowid < ?
            ORDER BY rowid DESC
            LIMIT 1
            "#,
        )
        .bind(company_id)
        .bind(thread_id)
        .bind(target_rowid)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| HostError::NativeSessionPrestart {
            code: "native-session-reset-persistence",
            message: format!("Read the failed Turn authorizing Start fresh session: {error}"),
        })?
        .ok_or_else(|| HostError::NativeSessionPrestart {
            code: "native-session-reset-invalid",
            message:
                "Start fresh session no longer matches the failed Turn that offered it.".into(),
        })?;
        let previous_run_id: String = row.try_get("run_id").map_err(|error| {
            HostError::NativeSessionPrestart {
                code: "native-session-reset-persistence",
                message: format!("Decode the previous Conversation Turn: {error}"),
            }
        })?;
        let previous_status: String = row.try_get("status").map_err(|error| {
            HostError::NativeSessionPrestart {
                code: "native-session-reset-persistence",
                message: format!("Decode the previous Conversation Turn status: {error}"),
            }
        })?;
        if previous_run_id != source_failed_root_run_id || previous_status != "failed" {
            return Err(HostError::NativeSessionPrestart {
                code: "native-session-reset-invalid",
                message: "Start fresh session is valid only for the immediately previous failed Turn."
                    .into(),
            });
        }
        let original_context_json: String = row
            .try_get::<Option<String>, _>("runtime_context_json")
            .map_err(|error| HostError::NativeSessionPrestart {
                code: "native-session-reset-persistence",
                message: format!("Decode the failed Turn native session context: {error}"),
            })?
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| HostError::NativeSessionPrestart {
                code: "native-session-reset-invalid",
                message: "The failed Turn has no durable native-session error context.".into(),
            })?;
        let source_session_file: Option<String> =
            row.try_get("session_file")
                .map_err(|error| HostError::NativeSessionPrestart {
                    code: "native-session-reset-persistence",
                    message: format!("Decode the failed Turn native session reference: {error}"),
                })?;
        if source_session_file
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        {
            return Err(HostError::NativeSessionPrestart {
                code: "native-session-reset-invalid",
                message: "Start fresh session is only valid for a Turn rejected before native session start."
                    .into(),
            });
        }
        let mut context: serde_json::Value =
            serde_json::from_str(&original_context_json).map_err(|_| {
                HostError::NativeSessionPrestart {
                    code: "native-session-reset-invalid",
                    message: "The failed Turn native-session error context is invalid.".into(),
                }
            })?;
        let context_object =
            context
                .as_object_mut()
                .ok_or_else(|| HostError::NativeSessionPrestart {
                    code: "native-session-reset-invalid",
                    message: "The failed Turn native-session error context is invalid.".into(),
                })?;
        let source_code = context_object
            .get("nativeSessionPrestartErrorCode")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .and_then(ResettableNativeSessionPrestartCode::parse)
            .map(|code| code.as_str().to_string())
            .ok_or_else(|| HostError::NativeSessionPrestart {
                code: "native-session-reset-invalid",
                message: "The failed Turn did not record a resettable native-session error.".into(),
            })?;
        context_object.insert("nativeSessionReset".into(), serde_json::Value::Bool(true));
        context_object.insert(
            "nativeSessionResetSourceErrorCode".into(),
            serde_json::Value::String(source_code),
        );
        context_object.insert(
            "nativeSessionResetAtUnixMs".into(),
            serde_json::json!(now_unix_ms()?),
        );
        let reset_context_json = serde_json::to_string(&context).map_err(|error| {
            HostError::NativeSessionPrestart {
                code: "native-session-reset-persistence",
                message: format!("Encode the fresh-session reset marker: {error}"),
            }
        })?;
        let changed = sqlx::query(
            r#"
            UPDATE agent_runs
            SET runtime_context_json = ?
            WHERE run_id = ? AND root_run_id = ? AND parent_run_id IS NULL
              AND company_id = ? AND thread_id = ? AND status = 'failed'
              AND session_file IS NULL AND runtime_context_json = ?
              AND EXISTS (
                SELECT 1 FROM agent_runs AS target
                WHERE target.rowid = ? AND target.run_id = ? AND target.root_run_id = ?
                  AND target.parent_run_id IS NULL AND target.company_id = ?
                  AND target.thread_id = ? AND target.status = 'running'
              )
            "#,
        )
        .bind(&reset_context_json)
        .bind(source_failed_root_run_id)
        .bind(source_failed_root_run_id)
        .bind(company_id)
        .bind(thread_id)
        .bind(&original_context_json)
        .bind(target_rowid)
        .bind(target_root_run_id)
        .bind(target_root_run_id)
        .bind(company_id)
        .bind(thread_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| HostError::NativeSessionPrestart {
            code: "native-session-reset-persistence",
            message: format!("Persist the fresh-session reset marker: {error}"),
        })?
        .rows_affected();
        if changed != 1 {
            return Err(HostError::NativeSessionPrestart {
                code: "native-session-reset-conflict",
                message: "The failed Turn changed before its fresh-session reset could commit."
                    .into(),
            });
        }
        let readback: Option<String> = sqlx::query_scalar(
            "SELECT runtime_context_json FROM agent_runs WHERE run_id = ? AND company_id = ? AND thread_id = ? AND status = 'failed'",
        )
        .bind(source_failed_root_run_id)
        .bind(company_id)
        .bind(thread_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| HostError::NativeSessionPrestart {
            code: "native-session-reset-persistence",
            message: format!("Read back the fresh-session reset marker: {error}"),
        })?;
        if readback.as_deref() != Some(reset_context_json.as_str()) {
            return Err(HostError::NativeSessionPrestart {
                code: "native-session-reset-persistence",
                message: "The fresh-session reset marker durable readback did not match.".into(),
            });
        }
        Ok(())
    }
    .await;
    match operation {
        Ok(()) => tx
            .commit()
            .await
            .map_err(|error| HostError::NativeSessionPrestart {
                code: "native-session-reset-persistence",
                message: format!("Commit the fresh-session reset marker: {error}"),
            }),
        Err(error) => {
            if let Err(rollback_error) = tx.rollback().await {
                eprintln!(
                    "[task-workspace] failed to roll back fresh-session reset: {rollback_error}"
                );
            }
            Err(error)
        }
    }
}

fn validate_resume_root_prestart(
    runtime_context_json: Option<&str>,
    stored_session_file: Option<&str>,
    expected_session_dir: &Path,
    expected: ResumeRootExpectation<'_>,
) -> Result<ValidatedResumeRoot, ResumePrestartFailure> {
    let context: serde_json::Value = runtime_context_json
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::ContextInvalid,
                "The interrupted task's durable runtime context is missing. Start a new task instead.",
            )
        })?
        .parse()
        .map_err(|_| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::ContextInvalid,
                "The interrupted task's durable runtime context is invalid. Start a new task instead.",
            )
        })?;
    let context_object = context.as_object().ok_or_else(|| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::ContextInvalid,
            "The interrupted task's durable runtime context is invalid. Start a new task instead.",
        )
    })?;
    let compatible_runtime = context_string_matches(context_object, "runtime", "pi-agent")
        && context_object
            .get("wireProtocolVersion")
            .and_then(serde_json::Value::as_u64)
            == Some(u64::from(crate::pi_agent_host::PI_HOST_PROTOCOL_VERSION));
    if !compatible_runtime {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::RuntimeIncompatible,
            "This interrupted task belongs to another or incompatible native Agent runtime. Start a new task instead.",
        ));
    }
    let workspace_binding = context_object
        .get("workspaceBinding")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::ContextInvalid,
                "The interrupted task's durable workspace projection is missing. Start a new task instead.",
            )
        })?;
    let saved_workspace_requirement = context_object
        .get("workspaceRequirement")
        .and_then(serde_json::Value::as_str);
    let binding_matches =
        context_string_matches(context_object, "requestId", expected.original_request_id)
            && matches!(
                saved_workspace_requirement,
                Some("optional") | Some("required")
            )
            && context_string_matches(context_object, "workspaceAvailability", "bound")
            && context_string_matches(context_object, "projectId", expected.project_id)
            && context_string_matches(workspace_binding, "historyId", expected.history_id)
            && context_string_matches(workspace_binding, "companyId", expected.company_id)
            && context_string_matches(workspace_binding, "projectId", expected.project_id)
            && context_string_matches(workspace_binding, "threadId", expected.thread_id)
            && context_string_matches(workspace_binding, "turnId", expected.turn_id)
            && context_string_matches(workspace_binding, "requestId", expected.original_request_id)
            && context_string_matches(workspace_binding, "access", expected.access)
            && context_string_matches(workspace_binding, "source", expected.source)
            && context_string_matches(workspace_binding, "reasonCode", expected.reason_code);
    if !binding_matches {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::ContextInvalid,
            "The interrupted task's durable workspace projection no longer matches its saved run. Start a new task instead.",
        ));
    }
    let (session_file, stored_session_file, session_id) =
        validate_exact_native_session_file(expected_session_dir, stored_session_file)?;
    if !context_string_matches(context_object, "nativeSessionId", &session_id) {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::SessionInvalid,
            "The interrupted task's durable native Pi session identity no longer matches its saved session. Start a new task instead.",
        ));
    }
    Ok(ValidatedResumeRoot {
        context,
        session_file,
        session_id,
        stored_session_file,
    })
}

#[allow(clippy::too_many_arguments)] // Resume scope is intentionally explicit and fail-closed.
async fn task_workspace_resume_compatibility_from_pool(
    pool: &sqlx::SqlitePool,
    expected_session_dir: &Path,
    history_id: &str,
    company_id: &str,
    project_id: &str,
    thread_id: &str,
    root_run_id: &str,
    access: TaskWorkspaceAccess,
) -> Result<TaskWorkspaceResumeCompatibility, String> {
    let history = sqlx::query(
        r#"
        SELECT h.company_id, h.project_id, h.thread_id, h.turn_id,
               h.request_id, h.access, h.source, h.reason_code,
               h.status AS binding_status, ar.status AS agent_run_status,
               ar.runtime_context_json, ar.session_file
        FROM task_workspace_binding_history AS h
        LEFT JOIN agent_runs AS ar
          ON ar.run_id = h.turn_id
         AND ar.root_run_id = h.turn_id
         AND ar.company_id = h.company_id
         AND ar.thread_id = h.thread_id
         AND ar.project_id = h.project_id
        WHERE h.binding_id = ?
        "#,
    )
    .bind(history_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Read resume workspace history: {error}"))?;
    let Some(history) = history else {
        return Ok(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Missing,
            reason: "workspace_history_missing".into(),
        });
    };
    let history_company_id: String = history
        .try_get("company_id")
        .map_err(|error| format!("Decode resume company_id: {error}"))?;
    let history_project_id: String = history
        .try_get("project_id")
        .map_err(|error| format!("Decode resume project_id: {error}"))?;
    let history_thread_id: String = history
        .try_get("thread_id")
        .map_err(|error| format!("Decode resume thread_id: {error}"))?;
    let history_turn_id: String = history
        .try_get("turn_id")
        .map_err(|error| format!("Decode resume turn_id: {error}"))?;
    if history_company_id != company_id
        || history_project_id != project_id
        || history_thread_id != thread_id
        || history_turn_id != root_run_id
    {
        return Ok(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Changed,
            reason: "workspace_scope_changed".into(),
        });
    }
    let binding_status: String = history
        .try_get("binding_status")
        .map_err(|error| format!("Decode resume binding status: {error}"))?;
    let agent_run_status: Option<String> = history
        .try_get("agent_run_status")
        .map_err(|error| format!("Decode resume Agent run status: {error}"))?;
    if !resume_history_is_recoverable(&binding_status, agent_run_status.as_deref()) {
        return Ok(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Changed,
            reason: "workspace_history_not_recoverable".into(),
        });
    }
    let original_request_id: String = history
        .try_get("request_id")
        .map_err(|error| format!("Decode resume request_id: {error}"))?;
    let expected_access: String = history
        .try_get("access")
        .map_err(|error| format!("Decode resume access: {error}"))?;
    let source: String = history
        .try_get("source")
        .map_err(|error| format!("Decode resume workspace source: {error}"))?;
    let source = WorkspaceRecoverySource::try_from(source.as_str())
        .map_err(|error| format!("Decode resume workspace source: {error}"))?;
    let reason_code: String = history
        .try_get("reason_code")
        .map_err(|error| format!("Decode resume workspace reason: {error}"))?;
    let reason_code = WorkspaceRecoveryReason::try_from(reason_code.as_str())
        .map_err(|error| format!("Decode resume workspace reason: {error}"))?;
    let runtime_context_json: Option<String> = history
        .try_get("runtime_context_json")
        .map_err(|error| format!("Decode resume runtime context: {error}"))?;
    let session_file: Option<String> = history
        .try_get("session_file")
        .map_err(|error| format!("Decode resume native session: {error}"))?;
    if expected_access != access.as_str() {
        return Ok(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Changed,
            reason: "workspace_scope_changed".into(),
        });
    }
    if let Err(failure) = validate_resume_root_prestart(
        runtime_context_json.as_deref(),
        session_file.as_deref(),
        expected_session_dir,
        ResumeRootExpectation {
            history_id,
            original_request_id: &original_request_id,
            company_id,
            project_id,
            thread_id,
            turn_id: root_run_id,
            access: &expected_access,
            source: source.as_str(),
            reason_code: reason_code.as_str(),
        },
    ) {
        return Ok(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Changed,
            reason: failure.kind.compatibility_reason().into(),
        });
    }

    // The issuance path is the durable authority oracle. In particular, an
    // auto-recovered Conversation/known-root binding may legitimately differ
    // from the stale Project catalog root while retaining its exact filesystem
    // identity, witness and authority snapshot. Discard the resolved path and
    // return only the compatibility enum to the renderer.
    let scope = crate::workspace_recovery::WorkspaceRecoveryScope {
        company_id,
        project_id,
        thread_id,
    };
    match crate::workspace_recovery::resolve_resumed_workspace_root_from_pool(
        pool,
        scope,
        history_id,
        root_run_id,
        access.as_str(),
    )
    .await
    {
        Ok(_) => Ok(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Same,
            reason: "workspace_history_durable_match".into(),
        }),
        Err(crate::workspace_recovery::ResumedWorkspaceRootError::Incompatible(_)) => {
            Ok(TaskWorkspaceResumeCompatibility {
                status: TaskWorkspaceResumeCompatibilityStatus::Changed,
                reason: "workspace_history_incompatible".into(),
            })
        }
        Err(crate::workspace_recovery::ResumedWorkspaceRootError::Operational(error)) => Err(error),
    }
}

/// Read-only preflight for Recovery UI. It intentionally returns only a small
/// compatibility enum; the historical/current canonical paths remain backend
/// data. `agent_runtime_resume` repeats the same identity check while issuing
/// the new capability, so this command is never an authority grant.
#[tauri::command]
pub async fn task_workspace_resume_compatibility<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    history_id: String,
    company_id: String,
    project_id: String,
    thread_id: String,
    root_run_id: String,
    access: String,
) -> Result<TaskWorkspaceResumeCompatibility, String> {
    let history_id = required_scope_text(&history_id, "historyId").map_err(host_error_message)?;
    let company_id = required_scope_text(&company_id, "companyId").map_err(host_error_message)?;
    let project_id = required_scope_text(&project_id, "projectId").map_err(host_error_message)?;
    let thread_id = required_scope_text(&thread_id, "threadId").map_err(host_error_message)?;
    let root_run_id = required_scope_text(&root_run_id, "rootRunId").map_err(host_error_message)?;
    let access = match access.trim() {
        "read" => TaskWorkspaceAccess::Read,
        "write" => TaskWorkspaceAccess::Write,
        _ => return Err("access must be read or write for resume compatibility.".into()),
    };
    let pool = crate::local_db::get_offisim_pool(&app)?;
    let session_dir = crate::pi_agent_host::app_pi_session_dir(&app, thread_id)
        .map_err(|error| format!("Resolve Pi Conversation session directory: {error:?}"))?;
    task_workspace_resume_compatibility_from_pool(
        &pool,
        &session_dir,
        history_id,
        company_id,
        project_id,
        thread_id,
        root_run_id,
        access,
    )
    .await
}

/// Atomically discard an interrupted root run only while no resumed workspace
/// writer has claimed its history. This races safely with the conditional
/// resume INSERT: whichever SQLite write wins makes the other operation fail.
async fn cancel_interrupted_run_from_pool(
    pool: &sqlx::SqlitePool,
    history_id: Option<&str>,
    company_id: &str,
    project_id: &str,
    thread_id: &str,
    root_run_id: &str,
) -> Result<u64, String> {
    sqlx::query(
        r#"
        UPDATE agent_runs
        SET status = 'cancelled',
            finished_at = COALESCE(finished_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        WHERE run_id = ?
          AND root_run_id = ?
          AND company_id = ?
          AND project_id = ?
          AND thread_id = ?
          AND status = 'interrupted'
          AND (
            ? IS NULL
            OR EXISTS (
              SELECT 1
              FROM task_workspace_binding_history AS h
              WHERE h.binding_id = ?
                AND h.company_id = ?
                AND h.project_id = ?
                AND h.thread_id = ?
                AND h.turn_id = ?
                AND h.status = 'app_restart'
            )
          )
          AND NOT EXISTS (
            SELECT 1 FROM task_workspace_binding_history AS writer
            WHERE writer.company_id = ?
              AND writer.project_id = ?
              AND writer.thread_id = ?
              AND writer.turn_id = ?
              AND writer.status = 'active'
          )
          AND NOT EXISTS (
            SELECT 1 FROM task_workspace_binding_history AS resumed
            WHERE resumed.status = 'active'
              AND (
                resumed.turn_id = ?
                OR (? IS NOT NULL AND resumed.resumed_from_binding_id = ?)
              )
          )
          AND NOT EXISTS (
            SELECT 1 FROM task_workspace_lease_history AS lease
            WHERE lease.project_id = ?
              AND lease.created_root_run_id = ?
              AND lease.status = 'active'
          )
          AND NOT EXISTS (
            SELECT 1 FROM agent_runs AS live
            WHERE live.root_run_id = ?
              AND live.status = 'running'
          )
        "#,
    )
    .bind(root_run_id)
    .bind(root_run_id)
    .bind(company_id)
    .bind(project_id)
    .bind(thread_id)
    .bind(history_id)
    .bind(history_id)
    .bind(company_id)
    .bind(project_id)
    .bind(thread_id)
    .bind(root_run_id)
    .bind(company_id)
    .bind(project_id)
    .bind(thread_id)
    .bind(root_run_id)
    .bind(root_run_id)
    .bind(history_id)
    .bind(history_id)
    .bind(project_id)
    .bind(root_run_id)
    .bind(root_run_id)
    .execute(pool)
    .await
    .map(|result| result.rows_affected())
    .map_err(|error| format!("Cancel interrupted Agent run: {error}"))
}

#[tauri::command]
pub async fn task_workspace_interrupted_run_cancel<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    history_id: Option<String>,
    company_id: String,
    project_id: String,
    thread_id: String,
    root_run_id: String,
) -> Result<(), String> {
    let history_id = history_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let company_id = required_scope_text(&company_id, "companyId").map_err(host_error_message)?;
    let project_id = required_scope_text(&project_id, "projectId").map_err(host_error_message)?;
    let thread_id = required_scope_text(&thread_id, "threadId").map_err(host_error_message)?;
    let root_run_id = required_scope_text(&root_run_id, "rootRunId").map_err(host_error_message)?;
    let pool = crate::local_db::get_offisim_pool(&app)?;
    if cancel_interrupted_run_from_pool(
        &pool,
        history_id,
        company_id,
        project_id,
        thread_id,
        root_run_id,
    )
    .await?
        != 1
    {
        return Err(
            "The interrupted run was already resumed, discarded, or is no longer recoverable."
                .into(),
        );
    }
    Ok(())
}

async fn task_workspace_deletion_preflight_from_pool(
    pool: &sqlx::SqlitePool,
    scope: TaskWorkspaceDeletionScope,
    company_id: &str,
    project_id: Option<&str>,
    thread_id: Option<&str>,
) -> Result<TaskWorkspaceDeletionPreflight, String> {
    let (active_bindings, active_leases) = match scope {
        TaskWorkspaceDeletionScope::Company => {
            let exists: i64 =
                sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM companies WHERE company_id = ?)")
                    .bind(company_id)
                    .fetch_one(pool)
                    .await
                    .map_err(|error| format!("Validate Company deletion scope: {error}"))?;
            if exists != 1 {
                return Err("Company deletion scope does not exist".into());
            }
            let active_bindings: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM task_workspace_binding_history WHERE company_id = ? AND status = 'active'",
            )
            .bind(company_id)
            .fetch_one(pool)
            .await
            .map_err(|error| format!("Inspect active Company workspace bindings: {error}"))?;
            let active_leases: i64 = sqlx::query_scalar(
                r#"
                SELECT COUNT(*)
                FROM task_workspace_lease_history AS lease
                JOIN projects AS project ON project.project_id = lease.project_id
                WHERE project.company_id = ? AND lease.status = 'active'
                "#,
            )
            .bind(company_id)
            .fetch_one(pool)
            .await
            .map_err(|error| format!("Inspect retained Company workspace leases: {error}"))?;
            (active_bindings, active_leases)
        }
        TaskWorkspaceDeletionScope::Project => {
            let project_id = project_id
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    "projectId is required for Project deletion preflight".to_string()
                })?;
            let exists: i64 = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM projects WHERE project_id = ? AND company_id = ?)",
            )
            .bind(project_id)
            .bind(company_id)
            .fetch_one(pool)
            .await
            .map_err(|error| format!("Validate Project deletion scope: {error}"))?;
            if exists != 1 {
                return Err("Project deletion scope does not match its Company".into());
            }
            let active_bindings: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM task_workspace_binding_history WHERE project_id = ? AND company_id = ? AND status = 'active'",
            )
            .bind(project_id)
            .bind(company_id)
            .fetch_one(pool)
            .await
            .map_err(|error| format!("Inspect active Project workspace bindings: {error}"))?;
            let active_leases: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM task_workspace_lease_history WHERE project_id = ? AND status = 'active'",
            )
            .bind(project_id)
            .fetch_one(pool)
            .await
            .map_err(|error| format!("Inspect retained Project workspace leases: {error}"))?;
            (active_bindings, active_leases)
        }
        TaskWorkspaceDeletionScope::Conversation => {
            let project_id = project_id
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    "projectId is required for Conversation deletion preflight".to_string()
                })?;
            let thread_id = thread_id
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    "threadId is required for Conversation deletion preflight".to_string()
                })?;
            let exists: i64 = sqlx::query_scalar(
                r#"
                SELECT EXISTS(
                  SELECT 1
                  FROM chat_threads AS thread
                  JOIN projects AS project ON project.project_id = thread.project_id
                  WHERE thread.thread_id = ?
                    AND project.project_id = ?
                    AND project.company_id = ?
                )
                "#,
            )
            .bind(thread_id)
            .bind(project_id)
            .bind(company_id)
            .fetch_one(pool)
            .await
            .map_err(|error| format!("Validate Conversation deletion scope: {error}"))?;
            if exists != 1 {
                return Err(
                    "Conversation deletion scope does not match its Company and Project".into(),
                );
            }
            let active_bindings: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM task_workspace_binding_history WHERE thread_id = ? AND project_id = ? AND company_id = ? AND status = 'active'",
            )
            .bind(thread_id)
            .bind(project_id)
            .bind(company_id)
            .fetch_one(pool)
            .await
            .map_err(|error| format!("Inspect active Conversation workspace bindings: {error}"))?;
            let active_leases: i64 = sqlx::query_scalar(
                r#"
                SELECT COUNT(*)
                FROM task_workspace_lease_history AS lease
                WHERE lease.project_id = ?
                  AND lease.status = 'active'
                  AND EXISTS (
                    SELECT 1
                    FROM task_workspace_binding_history AS binding
                    WHERE binding.thread_id = ?
                      AND binding.company_id = ?
                      AND binding.project_id = ?
                      AND binding.binding_id IN (lease.created_binding_id, lease.active_binding_id)
                  )
                "#,
            )
            .bind(project_id)
            .bind(thread_id)
            .bind(company_id)
            .bind(project_id)
            .fetch_one(pool)
            .await
            .map_err(|error| format!("Inspect retained Conversation workspace leases: {error}"))?;
            (active_bindings, active_leases)
        }
    };
    Ok(TaskWorkspaceDeletionPreflight {
        allowed: active_bindings == 0 && active_leases == 0,
        active_bindings,
        active_leases,
    })
}

#[tauri::command]
pub async fn task_workspace_deletion_preflight<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    scope: TaskWorkspaceDeletionScope,
    company_id: String,
    project_id: Option<String>,
    thread_id: Option<String>,
) -> Result<TaskWorkspaceDeletionPreflight, String> {
    let company_id = required_scope_text(&company_id, "companyId").map_err(host_error_message)?;
    let pool = crate::local_db::get_offisim_pool(&app)?;
    let now = now_unix_ms().map_err(host_error_message)?;
    reconcile_stale_active_bindings_from_pool(
        &pool,
        &app.state::<TaskWorkspaceBindingRegistry>(),
        now,
    )
    .await?;
    task_workspace_deletion_preflight_from_pool(
        &pool,
        scope,
        company_id,
        project_id.as_deref(),
        thread_id.as_deref(),
    )
    .await
}

#[derive(Debug)]
struct RecordedTaskWorkspaceBinding {
    rows: u64,
    resume_session: Option<NativeSessionReference>,
}

#[derive(Clone, Debug)]
struct ResumeBindingExpectation {
    history_id: String,
    session_dir: PathBuf,
}

async fn claim_resumed_root_before_start(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    binding: &TaskWorkspaceBinding,
    expected_resume_history_id: &str,
    expected_session_dir: &Path,
    canonical_root_text: &str,
) -> Result<NativeSessionReference, ResumePrestartFailure> {
    let row = sqlx::query(
        r#"
        SELECT ar.status, ar.runtime_context_json, ar.session_file,
               h.request_id AS original_request_id, h.access AS original_access,
               h.source AS original_source, h.reason_code AS original_reason_code
        FROM task_workspace_binding_history AS h
        JOIN agent_runs AS ar
          ON ar.run_id = h.turn_id
         AND ar.root_run_id = h.turn_id
         AND ar.company_id = h.company_id
         AND ar.project_id = h.project_id
         AND ar.thread_id = h.thread_id
        WHERE h.binding_id = ?
          AND h.company_id = ?
          AND h.project_id = ?
          AND h.thread_id = ?
          AND h.turn_id = ?
          AND h.status = 'app_restart'
        "#,
    )
    .bind(expected_resume_history_id)
    .bind(&binding.company_id)
    .bind(&binding.project_id)
    .bind(&binding.thread_id)
    .bind(&binding.turn_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|error| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::Persistence,
            format!("Read the interrupted root before Resume: {error}"),
        )
    })?
    .ok_or_else(|| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::Conflict,
            "The interrupted task stopped being recoverable before Resume could start.",
        )
    })?;
    let status: String = row.try_get("status").map_err(|error| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::Persistence,
            format!("Decode the interrupted root status before Resume: {error}"),
        )
    })?;
    if status != "interrupted" {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::Conflict,
            "The interrupted task was already resumed or changed before Resume could start.",
        ));
    }
    let runtime_context_json: Option<String> =
        row.try_get("runtime_context_json").map_err(|error| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::Persistence,
                format!("Decode the interrupted root context before Resume: {error}"),
            )
        })?;
    let stored_session_file: Option<String> = row.try_get("session_file").map_err(|error| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::Persistence,
            format!("Decode the interrupted root native session before Resume: {error}"),
        )
    })?;
    let original_request_id: String = row.try_get("original_request_id").map_err(|error| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::Persistence,
            format!("Decode the interrupted root request before Resume: {error}"),
        )
    })?;
    let original_access: String = row.try_get("original_access").map_err(|error| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::Persistence,
            format!("Decode the interrupted root access before Resume: {error}"),
        )
    })?;
    let original_source: String = row.try_get("original_source").map_err(|error| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::Persistence,
            format!("Decode the interrupted root workspace source before Resume: {error}"),
        )
    })?;
    let original_source =
        WorkspaceRecoverySource::try_from(original_source.as_str()).map_err(|error| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::ContextInvalid,
                format!("Decode the interrupted root workspace source before Resume: {error}"),
            )
        })?;
    let original_reason_code: String = row.try_get("original_reason_code").map_err(|error| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::Persistence,
            format!("Decode the interrupted root workspace reason before Resume: {error}"),
        )
    })?;
    let original_reason_code = WorkspaceRecoveryReason::try_from(original_reason_code.as_str())
        .map_err(|error| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::ContextInvalid,
                format!("Decode the interrupted root workspace reason before Resume: {error}"),
            )
        })?;
    if original_access != binding.access.as_str() {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::ContextInvalid,
            "The interrupted task's durable access no longer matches the Resume request.",
        ));
    }
    let mut validated = validate_resume_root_prestart(
        runtime_context_json.as_deref(),
        stored_session_file.as_deref(),
        expected_session_dir,
        ResumeRootExpectation {
            history_id: expected_resume_history_id,
            original_request_id: &original_request_id,
            company_id: &binding.company_id,
            project_id: &binding.project_id,
            thread_id: &binding.thread_id,
            turn_id: &binding.turn_id,
            access: &original_access,
            source: original_source.as_str(),
            reason_code: original_reason_code.as_str(),
        },
    )?;
    let context = validated.context.as_object_mut().ok_or_else(|| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::ContextInvalid,
            "The interrupted task's durable runtime context is invalid.",
        )
    })?;
    context.insert(
        "requestId".into(),
        serde_json::Value::String(binding.request_id.clone()),
    );
    context.insert("streamCursor".into(), serde_json::json!(0));
    context.insert(
        "workspaceBinding".into(),
        serde_json::json!({
            "historyId": binding.binding_id,
            "companyId": binding.company_id,
            "projectId": binding.project_id,
            "threadId": binding.thread_id,
            "turnId": binding.turn_id,
            "requestId": binding.request_id,
            "access": binding.access.as_str(),
            "source": binding.source,
            "confidence": binding.confidence,
            "reasonCode": binding.reason_code,
            "issuedAtUnixMs": binding.issued_at_unix_ms,
            "expiresAtUnixMs": binding.expires_at_unix_ms,
            "displayPath": canonical_root_text,
        }),
    );
    context.insert(
        "workspaceRequirement".into(),
        serde_json::Value::String("required".into()),
    );
    context.insert(
        "workspaceAvailability".into(),
        serde_json::Value::String("bound".into()),
    );
    context.insert(
        "projectId".into(),
        serde_json::Value::String(binding.project_id.clone()),
    );
    let resumed_context_json = serde_json::to_string(&validated.context).map_err(|error| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::Persistence,
            format!("Encode the resumed root context: {error}"),
        )
    })?;
    let changed = sqlx::query(
        r#"
        UPDATE agent_runs
        SET status = 'running', runtime_context_json = ?,
            finished_at = NULL, failure_kind = NULL
        WHERE run_id = ? AND root_run_id = ? AND parent_run_id IS NULL
          AND company_id = ? AND project_id = ? AND thread_id = ?
          AND status = 'interrupted'
          AND runtime_context_json = ? AND session_file = ?
        "#,
    )
    .bind(&resumed_context_json)
    .bind(&binding.turn_id)
    .bind(&binding.turn_id)
    .bind(&binding.company_id)
    .bind(&binding.project_id)
    .bind(&binding.thread_id)
    .bind(runtime_context_json.as_deref())
    .bind(&validated.stored_session_file)
    .execute(&mut **tx)
    .await
    .map_err(|error| {
        classify_resume_database_failure(error, "Persist the resumed root before sidecar start")
    })?
    .rows_affected();
    if changed != 1 {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::Conflict,
            "The interrupted task changed before its resumed root could be committed.",
        ));
    }
    let readback = sqlx::query(
        r#"
        SELECT status, runtime_context_json, session_file
        FROM agent_runs
        WHERE run_id = ? AND root_run_id = ? AND parent_run_id IS NULL
          AND company_id = ? AND project_id = ? AND thread_id = ?
        "#,
    )
    .bind(&binding.turn_id)
    .bind(&binding.turn_id)
    .bind(&binding.company_id)
    .bind(&binding.project_id)
    .bind(&binding.thread_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|error| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::Persistence,
            format!("Read back the resumed root before sidecar start: {error}"),
        )
    })?
    .ok_or_else(|| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::Persistence,
            "The resumed root disappeared before sidecar start.",
        )
    })?;
    let readback_status: String = readback.try_get("status").map_err(|error| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::Persistence,
            format!("Decode resumed root status readback: {error}"),
        )
    })?;
    let readback_context: Option<String> =
        readback.try_get("runtime_context_json").map_err(|error| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::Persistence,
                format!("Decode resumed root context readback: {error}"),
            )
        })?;
    let readback_session_file: Option<String> =
        readback.try_get("session_file").map_err(|error| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::Persistence,
                format!("Decode resumed root native session readback: {error}"),
            )
        })?;
    if readback_status != "running"
        || readback_context.as_deref() != Some(resumed_context_json.as_str())
        || readback_session_file.as_deref() != Some(validated.stored_session_file.as_str())
    {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::Persistence,
            "The resumed root durable readback did not match the committed Resume authority.",
        ));
    }
    Ok(NativeSessionReference {
        file: validated.session_file,
        id: validated.session_id,
    })
}

async fn record_task_workspace_binding_from_pool(
    pool: &sqlx::SqlitePool,
    binding: &TaskWorkspaceBinding,
    canonical_root_text: &str,
    root_identity_json: &str,
    now: i64,
    resume: Option<&ResumeBindingExpectation>,
) -> Result<RecordedTaskWorkspaceBinding, HostError> {
    let expected_resume_history_id = resume.map(|expectation| expectation.history_id.as_str());
    let mut tx = pool.begin().await.map_err(|error| {
        if expected_resume_history_id.is_some() {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::Persistence,
                format!("Begin the durable Resume transaction: {error}"),
            )
            .into_host_error()
        } else {
            HostError::Request(format!("Begin task workspace binding transaction: {error}"))
        }
    })?;
    let operation: Result<RecordedTaskWorkspaceBinding, HostError> = async {
        let rows = sqlx::query(
        r#"
        INSERT INTO task_workspace_binding_history (
          binding_id, company_id, project_id, thread_id, turn_id, request_id,
          access, canonical_root, root_identity_json,
          workspace_basename_normalized, project_name_normalized,
          workspace_anchor, git_origin_digest, recovery_witness_binding_id,
          recovery_witness_authority_project_id,
          authority_snapshot_canonical_root,
          authority_snapshot_root_identity_json,
          authority_snapshot_updated_at_unix_ms,
          source, confidence, reason_code, issued_at_unix_ms, expires_at_unix_ms,
          activated_at_unix_ms, last_used_at_unix_ms, status,
          resumed_from_binding_id
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?
        WHERE (
          ? IS NULL OR EXISTS (
            SELECT 1
            FROM task_workspace_binding_history AS h
            JOIN agent_runs AS ar
              ON ar.run_id = h.turn_id
             AND ar.root_run_id = h.turn_id
             AND ar.company_id = h.company_id
             AND ar.thread_id = h.thread_id
             AND ar.project_id = h.project_id
            WHERE h.binding_id = ?
              AND h.company_id = ?
              AND h.project_id = ?
              AND h.thread_id = ?
              AND h.turn_id = ?
              AND h.status = 'app_restart'
              AND ar.status = 'interrupted'
          )
        )
        AND EXISTS (
          SELECT 1
          FROM chat_threads AS thread
          JOIN projects AS project ON project.project_id = thread.project_id
          JOIN project_workspace_authority AS authority
            ON authority.project_id = project.project_id
           AND authority.company_id = project.company_id
           AND authority.canonical_root = project.workspace_root
          WHERE thread.thread_id = ?
            AND project.project_id = ?
            AND project.company_id = ?
            AND project.workspace_root = ?
            AND authority.canonical_root = ?
            AND authority.root_identity_json = ?
            AND authority.updated_at_unix_ms = ?
        )
        "#,
    )
    .bind(&binding.binding_id)
    .bind(&binding.company_id)
    .bind(&binding.project_id)
    .bind(&binding.thread_id)
    .bind(&binding.turn_id)
    .bind(&binding.request_id)
    .bind(binding.access.as_str())
    .bind(canonical_root_text)
    .bind(root_identity_json)
    .bind(&binding.workspace_basename_normalized)
    .bind(&binding.project_name_normalized)
    .bind(&binding.workspace_anchor)
    .bind(&binding.git_origin_digest)
    .bind(&binding.recovery_witness_binding_id)
    .bind(&binding.recovery_witness_authority_project_id)
    .bind(&binding.authority_snapshot_canonical_root)
    .bind(&binding.authority_snapshot_root_identity_json)
    .bind(binding.authority_snapshot_updated_at_unix_ms)
    .bind(binding.source.as_str())
    .bind(binding.confidence)
    .bind(binding.reason_code.as_str())
    .bind(binding.issued_at_unix_ms)
    .bind(binding.expires_at_unix_ms)
    .bind(now)
    .bind(now)
    .bind(expected_resume_history_id)
    .bind(expected_resume_history_id)
    .bind(expected_resume_history_id)
    .bind(&binding.company_id)
    .bind(&binding.project_id)
    .bind(&binding.thread_id)
    .bind(&binding.turn_id)
    .bind(&binding.thread_id)
    .bind(&binding.project_id)
    .bind(&binding.company_id)
    .bind(&binding.authority_snapshot_canonical_root)
    .bind(&binding.authority_snapshot_canonical_root)
    .bind(&binding.authority_snapshot_root_identity_json)
    .bind(binding.authority_snapshot_updated_at_unix_ms)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            if expected_resume_history_id.is_some() {
                classify_resume_database_failure(
                    error,
                    "Record the replacement Resume workspace history",
                )
                .into_host_error()
            } else {
                HostError::Request(format!("Record task workspace binding: {error}"))
            }
        })?
        .rows_affected();
        if rows != 1 {
            if expected_resume_history_id.is_some() {
                return Err(ResumePrestartFailure::new(
                    ResumePrestartFailureKind::Conflict,
                    "The interrupted task was already resumed or changed before its workspace could be claimed.",
                )
                .into_host_error());
            }
            return Ok(RecordedTaskWorkspaceBinding {
                rows,
                resume_session: None,
            });
        }
        let resume_session =
            if let Some(expectation) = resume {
                let session = claim_resumed_root_before_start(
                    &mut tx,
                    binding,
                    &expectation.history_id,
                    &expectation.session_dir,
                    canonical_root_text,
                )
                .await
                .map_err(ResumePrestartFailure::into_host_error)?;
                Some(session)
            } else {
                None
            };
        Ok(RecordedTaskWorkspaceBinding {
            rows,
            resume_session,
        })
    }
    .await;
    match operation {
        Ok(recorded) => {
            tx.commit().await.map_err(|error| {
                if expected_resume_history_id.is_some() {
                    ResumePrestartFailure::new(
                        ResumePrestartFailureKind::Persistence,
                        format!("Commit the durable Resume transaction: {error}"),
                    )
                    .into_host_error()
                } else {
                    HostError::Request(format!("Commit task workspace binding: {error}"))
                }
            })?;
            Ok(recorded)
        }
        Err(error) => {
            if let Err(rollback_error) = tx.rollback().await {
                eprintln!(
                    "[task-workspace] failed to roll back a rejected binding transaction: {rollback_error}"
                );
            }
            Err(error)
        }
    }
}

async fn publish_task_workspace_binding_from_pool(
    pool: &sqlx::SqlitePool,
    registry: &TaskWorkspaceBindingRegistry,
    binding: &TaskWorkspaceBinding,
    canonical_root_text: &str,
    root_identity_json: &str,
    now: i64,
    resume: Option<&ResumeBindingExpectation>,
) -> Result<RecordedTaskWorkspaceBinding, HostError> {
    // The opaque ref is not observable until this function returns. Publish it
    // to memory first, then atomically claim durable history. A durable failure
    // removes the still-unpublished ref, so neither ordering can leave a usable
    // capability without history or an active history row without a capability.
    registry.insert(binding.clone(), now)?;
    let recorded = record_task_workspace_binding_from_pool(
        pool,
        binding,
        canonical_root_text,
        root_identity_json,
        now,
        resume,
    )
    .await;
    match recorded {
        Ok(recorded) if recorded.rows == 1 => Ok(recorded),
        Ok(recorded) => {
            registry.remove_unpublished(&binding.binding_ref)?;
            Ok(recorded)
        }
        Err(error) => {
            registry.remove_unpublished(&binding.binding_ref)?;
            Err(error)
        }
    }
}

async fn publish_resolved_task_workspace_binding(
    pool: &sqlx::SqlitePool,
    registry: &TaskWorkspaceBindingRegistry,
    scope: IssueTaskWorkspaceBinding<'_>,
    resolved: crate::workspace_recovery::ResolvedWorkspaceRoot,
    resume: Option<&ResumeBindingExpectation>,
) -> Result<Option<(TaskWorkspaceBinding, Option<NativeSessionReference>)>, HostError> {
    if resume.is_some() {
        resolved.verify_live().map_err(HostError::Request)?;
    } else {
        resolved
            .verify_initial_recovery_issuance()
            .map_err(HostError::Request)?;
    }
    let expected_root_identity: RootIdentity = serde_json::from_str(&resolved.root_identity_json)
        .map_err(|error| {
        HostError::Request(format!("Decode resolved workspace identity: {error}"))
    })?;
    let live_root_identity = root_identity(&resolved.canonical_root).map_err(HostError::Request)?;
    if live_root_identity != expected_root_identity {
        return Err(HostError::Request(
            "Recovered Project workspace changed identity before binding issuance.".into(),
        ));
    }
    let canonical_root_text = canonical_root_text(&resolved.canonical_root)?;
    let now = now_unix_ms()?;
    let binding = TaskWorkspaceBinding {
        binding_ref: random_ref(),
        binding_id: random_id(),
        company_id: scope.company_id.to_string(),
        project_id: scope.project_id.to_string(),
        thread_id: scope.thread_id.to_string(),
        turn_id: scope.turn_id.to_string(),
        request_id: scope.request_id.to_string(),
        access: scope.access,
        canonical_root: resolved.canonical_root,
        root_identity: expected_root_identity,
        workspace_basename_normalized: resolved.evidence.basename_normalized,
        project_name_normalized: resolved.evidence.project_name_normalized,
        workspace_anchor: resolved.evidence.anchor,
        git_origin_digest: resolved.evidence.git_origin_digest,
        recovery_witness_binding_id: resolved.recovery_witness_binding_id,
        recovery_witness_authority_project_id: resolved.recovery_witness_authority_project_id,
        authority_snapshot_canonical_root: resolved.authority_snapshot_canonical_root,
        authority_snapshot_root_identity_json: resolved.authority_snapshot_root_identity_json,
        authority_snapshot_updated_at_unix_ms: resolved.authority_snapshot_updated_at_unix_ms,
        source: resolved.source,
        confidence: resolved.confidence,
        reason_code: resolved.reason_code,
        issued_at_unix_ms: now,
        expires_at_unix_ms: now.saturating_add(BINDING_TTL_MS),
        project_verify_command: resolved.settings.verify_command,
        project_verify_max_attempts: resolved.settings.verify_max_attempts,
        project_verify_token_budget: resolved.settings.verify_token_budget,
    };
    let root_identity_json = serde_json::to_string(&binding.root_identity)
        .map_err(|err| HostError::Request(format!("Encode workspace root identity: {err}")))?;
    let recorded = publish_task_workspace_binding_from_pool(
        pool,
        registry,
        &binding,
        &canonical_root_text,
        &root_identity_json,
        now,
        resume,
    )
    .await?;
    Ok((recorded.rows == 1).then_some((binding, recorded.resume_session)))
}

pub(crate) async fn resolve_task_workspace_for_turn<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    scope: IssueTaskWorkspaceBinding<'_>,
    expected_resume_history_id: Option<&str>,
) -> Result<TaskWorkspaceResolution, HostError> {
    let company_id = required_scope_text(scope.company_id, "companyId")?;
    let project_id = required_scope_text(scope.project_id, "projectId")?;
    let thread_id = required_scope_text(scope.thread_id, "threadId")?;
    let turn_id = required_scope_text(scope.turn_id, "rootRunId")?;
    let request_id = required_scope_text(scope.request_id, "requestId")?;
    let scope = IssueTaskWorkspaceBinding {
        company_id,
        project_id,
        thread_id,
        turn_id,
        request_id,
        access: scope.access,
    };
    let expected_resume_history_id = expected_resume_history_id
        .map(|history_id| required_scope_text(history_id, "workspaceBindingHistoryId"))
        .transpose()?;
    let pool = crate::local_db::get_offisim_pool(app)
        .map_err(|err| HostError::HostUnavailable(format!("Open offisim.db: {err}")))?;
    let registry = app.state::<TaskWorkspaceBindingRegistry>();
    let resume = expected_resume_history_id
        .map(|history_id| {
            Ok::<_, HostError>(ResumeBindingExpectation {
                history_id: history_id.to_string(),
                session_dir: crate::pi_agent_host::app_pi_session_dir(app, thread_id)?,
            })
        })
        .transpose()?;
    for authority_attempt in 0..2 {
        let recovery_scope = crate::workspace_recovery::WorkspaceRecoveryScope {
            company_id,
            project_id,
            thread_id,
        };
        let resolved = if let Some(expectation) = resume.as_ref() {
            crate::workspace_recovery::resolve_resumed_workspace_root_from_pool(
                &pool,
                recovery_scope,
                &expectation.history_id,
                turn_id,
                scope.access.as_str(),
            )
            .await
            .map_err(|error| HostError::Request(error.into_message()))?
        } else {
            match crate::workspace_recovery::resolve_workspace_root_from_pool(&pool, recovery_scope)
                .await
                .map_err(HostError::Request)?
            {
                crate::workspace_recovery::WorkspaceRootResolution::Bound(resolved) => *resolved,
                crate::workspace_recovery::WorkspaceRootResolution::Unavailable(unavailable) => {
                    return Ok(TaskWorkspaceResolution::Unavailable(
                        TaskWorkspaceUnavailable {
                            reason_code: unavailable.reason_code,
                            source: WorkspaceRecoverySource::WorkspaceRecovery,
                            candidate_count: unavailable.candidate_count,
                        },
                    ));
                }
            }
        };
        if let Some((binding, resume_session)) = publish_resolved_task_workspace_binding(
            &pool,
            &registry,
            scope,
            resolved,
            resume.as_ref(),
        )
        .await?
        {
            return Ok(TaskWorkspaceResolution::Bound {
                binding: Box::new(binding),
                resume_session,
            });
        }
        if resume.is_some() {
            return Err(HostError::Request(
                "Cannot resume this task: its interrupted run stopped being recoverable before workspace authority could be issued."
                    .into(),
            ));
        }
        if authority_attempt == 1 {
            return Err(HostError::Request(
                "The Project folder changed repeatedly while this task was starting. Retry after the folder selection settles."
                    .into(),
            ));
        }
    }
    unreachable!("bounded authority retry loop always returns")
}

pub(crate) async fn resolve_task_workspace_binding<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    binding_ref: &str,
    scope: IssueTaskWorkspaceBinding<'_>,
) -> Result<TaskWorkspaceBinding, HostError> {
    let now = now_unix_ms()?;
    let resolved = app
        .state::<TaskWorkspaceBindingRegistry>()
        .resolve_at(binding_ref, &scope, now);
    let binding = match resolved {
        Ok(binding) => binding,
        Err(ResolveBindingError::Expired) => {
            let transition = app
                .state::<TaskWorkspaceBindingRegistry>()
                .expire(binding_ref, now)?;
            let pool = crate::local_db::get_offisim_pool(app).map_err(|err| {
                HostError::HostUnavailable(format!("Open offisim.db after binding expiry: {err}"))
            })?;
            sqlx::query(
                r#"
                UPDATE task_workspace_binding_history
                SET status = 'expired', revoked_at_unix_ms = ?,
                    read_grace_until_unix_ms = ?, last_used_at_unix_ms = ?,
                    release_reason = 'ttl_expired'
                WHERE binding_id = ? AND status IN ('active', 'expired')
                "#,
            )
            .bind(transition.revoked_at_unix_ms)
            .bind(transition.grace_until_unix_ms)
            .bind(transition.revoked_at_unix_ms)
            .bind(transition.binding_id)
            .execute(&pool)
            .await
            .map_err(|err| HostError::Request(format!("Record binding expiry: {err}")))?;
            return Err(ResolveBindingError::Expired.into_host_error());
        }
        Err(error) => return Err(error.into_host_error()),
    };
    let pool = crate::local_db::get_offisim_pool(app)
        .map_err(|err| HostError::HostUnavailable(format!("Open offisim.db: {err}")))?;
    let canonical_root = canonical_root_text(&binding.canonical_root)?;
    let root_identity_json = serde_json::to_string(&binding.root_identity).map_err(|error| {
        HostError::Request(format!("Encode task workspace root identity: {error}"))
    })?;
    let durable = crate::workspace_recovery::durable_binding_is_valid(
        &pool,
        crate::workspace_recovery::DurableBindingEvidence {
            binding_id: &binding.binding_id,
            company_id: &binding.company_id,
            project_id: &binding.project_id,
            thread_id: &binding.thread_id,
            canonical_root: &binding.canonical_root,
            root_identity_json: &root_identity_json,
            source: binding.source,
            reason_code: binding.reason_code,
            basename_normalized: &binding.workspace_basename_normalized,
            anchor: &binding.workspace_anchor,
            git_origin_digest: binding.git_origin_digest.as_deref(),
            recovery_witness_binding_id: binding.recovery_witness_binding_id.as_deref(),
            recovery_witness_authority_project_id: binding
                .recovery_witness_authority_project_id
                .as_deref(),
            authority_snapshot_canonical_root: &binding.authority_snapshot_canonical_root,
            authority_snapshot_root_identity_json: &binding.authority_snapshot_root_identity_json,
            authority_snapshot_updated_at_unix_ms: binding.authority_snapshot_updated_at_unix_ms,
        },
    )
    .await
    .map_err(HostError::Request)?;
    let touched = sqlx::query(
        r#"
        UPDATE task_workspace_binding_history
        SET last_used_at_unix_ms = ?
        WHERE binding_id = ?
          AND company_id = ? AND project_id = ? AND thread_id = ?
          AND turn_id = ? AND request_id = ?
          AND canonical_root = ? AND root_identity_json = ?
          AND source = ? AND reason_code = ?
          AND workspace_basename_normalized = ?
          AND project_name_normalized = ? AND workspace_anchor = ?
          AND git_origin_digest IS ?
          AND recovery_witness_binding_id IS ?
          AND recovery_witness_authority_project_id IS ?
          AND authority_snapshot_canonical_root = ?
          AND authority_snapshot_root_identity_json = ?
          AND authority_snapshot_updated_at_unix_ms = ?
          AND (
            status = 'active'
            OR (? = 'read' AND read_grace_until_unix_ms IS NOT NULL
                AND read_grace_until_unix_ms >= ?)
          )
          AND ? = 1
          AND EXISTS (
            SELECT 1
            FROM chat_threads AS thread
            JOIN projects AS project ON project.project_id = thread.project_id
            WHERE thread.thread_id = task_workspace_binding_history.thread_id
              AND project.project_id = task_workspace_binding_history.project_id
              AND project.company_id = task_workspace_binding_history.company_id
          )
        "#,
    )
    .bind(now)
    .bind(&binding.binding_id)
    .bind(&binding.company_id)
    .bind(&binding.project_id)
    .bind(&binding.thread_id)
    .bind(&binding.turn_id)
    .bind(&binding.request_id)
    .bind(canonical_root)
    .bind(root_identity_json)
    .bind(binding.source.as_str())
    .bind(binding.reason_code.as_str())
    .bind(&binding.workspace_basename_normalized)
    .bind(&binding.project_name_normalized)
    .bind(&binding.workspace_anchor)
    .bind(&binding.git_origin_digest)
    .bind(&binding.recovery_witness_binding_id)
    .bind(&binding.recovery_witness_authority_project_id)
    .bind(&binding.authority_snapshot_canonical_root)
    .bind(&binding.authority_snapshot_root_identity_json)
    .bind(binding.authority_snapshot_updated_at_unix_ms)
    .bind(scope.access.as_str())
    .bind(now)
    .bind(if durable { 1_i64 } else { 0_i64 })
    .execute(&pool)
    .await
    .map_err(|err| HostError::Request(format!("Update task workspace binding history: {err}")))?
    .rows_affected();
    if touched != 1 {
        let closed = sqlx::query(
            r#"
            UPDATE task_workspace_binding_history
            SET status = 'aborted', revoked_at_unix_ms = ?,
                read_grace_until_unix_ms = ?, last_used_at_unix_ms = ?,
                release_reason = 'authority_changed'
            WHERE binding_id = ? AND status = 'active'
            "#,
        )
        .bind(now)
        .bind(now)
        .bind(now)
        .bind(&binding.binding_id)
        .execute(&pool)
        .await;
        app.state::<TaskWorkspaceBindingRegistry>()
            .remove_unpublished(binding_ref)?;
        closed.map_err(|err| {
            HostError::Request(format!(
                "Close task workspace binding after durable authority changed: {err}"
            ))
        })?;
        return Err(HostError::Request(
            "Task workspace binding no longer has a durable Project or Conversation scope.".into(),
        ));
    }
    Ok(binding)
}

/// Revalidate a live run against the in-memory capability registry only.
///
/// This path deliberately avoids SQLite so a short-period watchdog can check
/// expiry, scope, access and root identity without turning every heartbeat into
/// durable I/O. Terminal bookkeeping remains the caller's responsibility.
pub(crate) fn validate_task_workspace_binding_authority<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    binding_ref: &str,
    scope: IssueTaskWorkspaceBinding<'_>,
) -> Result<(), TaskWorkspaceAuthorityError> {
    let now = now_unix_ms().map_err(|error| TaskWorkspaceAuthorityError {
        reason: TaskWorkspaceAuthorityLossReason::RegistryUnavailable,
        message: format!(
            "Task workspace authority could not be revalidated: {}",
            host_error_message(error)
        ),
    })?;
    app.state::<TaskWorkspaceBindingRegistry>()
        .validate_authority_at(binding_ref, &scope, now)
        .map_err(TaskWorkspaceAuthorityError::from)
}

fn host_error_message(error: HostError) -> String {
    match error {
        HostError::Aborted => "Task workspace request was aborted.".into(),
        HostError::HostUnavailable(message)
        | HostError::Spawn(message)
        | HostError::Request(message)
        | HostError::ResumePrestart { message, .. }
        | HostError::NativeSessionPrestart { message, .. }
        | HostError::Protocol(message)
        | HostError::Upstream { message, .. } => message,
    }
}

fn validate_task_workspace_claim(
    binding: &TaskWorkspaceBinding,
    claim: &TaskWorkspaceBindingClaim,
    catalog_project_id: Option<&str>,
) -> Result<(), String> {
    if binding.binding_id != claim.history_id {
        return Err("Task workspace binding history id does not match this capability.".into());
    }
    if binding.access.as_str() != claim.access {
        return Err(
            "Task workspace binding access projection does not match this capability.".into(),
        );
    }
    if let Some(project_id) = catalog_project_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if project_id != binding.project_id {
            return Err("Task workspace binding does not match projectId.".into());
        }
    }
    Ok(())
}

fn validate_evaluation_lease_claim(
    lease: &EvaluationLease,
    claim: &TaskWorkspaceEvaluationLeaseClaim,
    catalog_project_id: Option<&str>,
) -> Result<(), String> {
    let expected = &lease.claim;
    if expected.evaluation_lease_ref != claim.evaluation_lease_ref
        || expected.history_id != claim.history_id
        || expected.company_id != claim.company_id
        || expected.project_id != claim.project_id
        || expected.thread_id != claim.thread_id
        || expected.turn_id != claim.turn_id
        || expected.request_id != claim.request_id
        || expected.mission_id != claim.mission_id
        || expected.attempt_id != claim.attempt_id
        || expected.issued_at_unix_ms != claim.issued_at_unix_ms
        || expected.expires_at_unix_ms != claim.expires_at_unix_ms
    {
        return Err("Task workspace evaluation lease scope does not match this capability.".into());
    }
    if let Some(project_id) = catalog_project_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if project_id != expected.project_id {
            return Err("Task workspace evaluation lease does not match projectId.".into());
        }
    }
    Ok(())
}

pub(crate) async fn resolve_task_workspace_claim_authority<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    claim: &TaskWorkspaceBindingClaim,
    catalog_project_id: Option<&str>,
    requested_access: TaskWorkspaceAccess,
) -> Result<AuthorizedWorkspaceRoot, String> {
    let scope = IssueTaskWorkspaceBinding {
        company_id: &claim.company_id,
        project_id: &claim.project_id,
        thread_id: &claim.thread_id,
        turn_id: &claim.turn_id,
        request_id: &claim.request_id,
        access: requested_access,
    };
    let binding = resolve_task_workspace_binding(app, &claim.workspace_ref, scope)
        .await
        .map_err(host_error_message)?;
    validate_task_workspace_claim(&binding, claim, catalog_project_id)?;
    Ok(AuthorizedWorkspaceRoot {
        canonical_root: binding.canonical_root,
        root_identity: binding.root_identity,
    })
}

#[allow(clippy::too_many_arguments)] // Scope identity is intentionally explicit and non-forgeable.
async fn verify_evaluation_scope<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    company_id: &str,
    project_id: &str,
    thread_id: &str,
    turn_id: &str,
    mission_id: &str,
    attempt_id: &str,
    phase: EvaluationScopePhase,
) -> Result<VerifiedEvaluationScope, String> {
    let pool = crate::local_db::get_offisim_pool(app)?;
    let row = sqlx::query(
        r#"
        SELECT m.mission_id, m.company_id, m.project_id, m.thread_id,
               m.status AS mission_status, m.current_attempt_id,
               a.attempt_id, a.mission_id AS attempt_mission_id,
               a.root_run_id, a.status AS attempt_status, a.finished_at
        FROM mission AS m
        JOIN mission_attempt AS a ON a.attempt_id = ?
        WHERE m.mission_id = ?
        "#,
    )
    .bind(attempt_id)
    .bind(mission_id)
    .fetch_optional(&pool)
    .await
    .map_err(|error| format!("Validate Mission evaluation scope: {error}"))?
    .ok_or_else(|| "Mission evaluation scope does not exist.".to_string())?;

    let actual_mission_id: String = row
        .try_get("mission_id")
        .map_err(|error| format!("Decode Mission evaluation mission_id: {error}"))?;
    let actual_attempt_id: String = row
        .try_get("attempt_id")
        .map_err(|error| format!("Decode Mission evaluation attempt_id: {error}"))?;
    let actual_company_id: String = row
        .try_get("company_id")
        .map_err(|error| format!("Decode Mission evaluation company_id: {error}"))?;
    let actual_project_id: Option<String> = row
        .try_get("project_id")
        .map_err(|error| format!("Decode Mission evaluation project_id: {error}"))?;
    let actual_thread_id: String = row
        .try_get("thread_id")
        .map_err(|error| format!("Decode Mission evaluation thread_id: {error}"))?;
    let current_attempt_id: Option<String> = row
        .try_get("current_attempt_id")
        .map_err(|error| format!("Decode Mission current_attempt_id: {error}"))?;
    let attempt_mission_id: String = row
        .try_get("attempt_mission_id")
        .map_err(|error| format!("Decode Mission attempt mission_id: {error}"))?;
    let root_run_id: Option<String> = row
        .try_get("root_run_id")
        .map_err(|error| format!("Decode Mission attempt root_run_id: {error}"))?;
    let mission_status: String = row
        .try_get("mission_status")
        .map_err(|error| format!("Decode Mission status: {error}"))?;
    let attempt_status: String = row
        .try_get("attempt_status")
        .map_err(|error| format!("Decode Mission attempt status: {error}"))?;
    let finished_at: Option<String> = row
        .try_get("finished_at")
        .map_err(|error| format!("Decode Mission attempt finished_at: {error}"))?;

    if actual_mission_id != mission_id
        || actual_attempt_id != attempt_id
        || attempt_mission_id != actual_mission_id
        || actual_company_id != company_id
        || actual_project_id.as_deref() != Some(project_id)
        || actual_thread_id != thread_id
        || current_attempt_id.as_deref() != Some(attempt_id)
        || root_run_id.as_deref() != Some(turn_id)
    {
        return Err("Mission evaluation scope does not match the task workspace binding.".into());
    }
    validate_evaluation_lifecycle_status(
        &mission_status,
        &attempt_status,
        finished_at.is_some(),
        phase,
    )?;
    Ok(VerifiedEvaluationScope {
        mission_id: actual_mission_id,
        attempt_id: actual_attempt_id,
    })
}

pub(crate) async fn resolve_task_workspace_evaluation_claim_authority<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    claim: &TaskWorkspaceEvaluationLeaseClaim,
    catalog_project_id: Option<&str>,
    requested_access: TaskWorkspaceAccess,
) -> Result<AuthorizedWorkspaceRoot, String> {
    let now = now_unix_ms().map_err(host_error_message)?;
    let registry = app.state::<TaskWorkspaceBindingRegistry>();
    let lease =
        registry.resolve_evaluation_lease_at(claim, catalog_project_id, requested_access, now)?;
    if let Err(error) = verify_evaluation_scope(
        app,
        &lease.claim.company_id,
        &lease.claim.project_id,
        &lease.claim.thread_id,
        &lease.claim.turn_id,
        &lease.claim.mission_id,
        &lease.claim.attempt_id,
        EvaluationScopePhase::Use,
    )
    .await
    {
        registry.invalidate_evaluation_lease(&lease.claim.evaluation_lease_ref);
        return Err(error);
    }
    Ok(AuthorizedWorkspaceRoot {
        canonical_root: lease.canonical_root,
        root_identity: lease.root_identity,
    })
}

#[tauri::command]
pub async fn task_workspace_evaluation_lease_acquire<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    binding_claim: TaskWorkspaceBindingClaim,
    mission_id: String,
    attempt_id: String,
) -> Result<TaskWorkspaceEvaluationLeaseClaim, String> {
    let mission_id = mission_id.trim();
    let attempt_id = attempt_id.trim();
    if mission_id.is_empty() || attempt_id.is_empty() {
        return Err("missionId and attemptId are required for an evaluation lease.".into());
    }
    let now = now_unix_ms().map_err(host_error_message)?;
    let registry = app.state::<TaskWorkspaceBindingRegistry>();
    let binding = registry.resolve_evaluation_binding_at(&binding_claim, now)?;
    let verified = verify_evaluation_scope(
        &app,
        &binding.company_id,
        &binding.project_id,
        &binding.thread_id,
        &binding.turn_id,
        mission_id,
        attempt_id,
        EvaluationScopePhase::Acquire,
    )
    .await?;
    registry.acquire_evaluation_lease_at(binding, verified, now)
}

#[tauri::command]
pub fn task_workspace_evaluation_lease_release<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    evaluation_lease: TaskWorkspaceEvaluationLeaseClaim,
) -> Result<(), String> {
    let now = now_unix_ms().map_err(host_error_message)?;
    app.state::<TaskWorkspaceBindingRegistry>()
        .release_evaluation_lease_at(&evaluation_lease, now)
}

async fn persist_binding_revocation_with_retry(
    pool: &sqlx::SqlitePool,
    transition: &RegistryRevocation,
    status: &str,
    reason_code: &str,
) -> Result<(), HostError> {
    let mut last_error = None;
    for attempt in 0..3_u64 {
        match sqlx::query(
            r#"
            UPDATE task_workspace_binding_history
            SET status = ?, revoked_at_unix_ms = ?, read_grace_until_unix_ms = ?,
                last_used_at_unix_ms = ?, release_reason = ?
            WHERE binding_id = ?
              AND (status = 'active' OR (? = 'expired' AND status = 'expired'))
            "#,
        )
        .bind(status)
        .bind(transition.revoked_at_unix_ms)
        .bind(transition.grace_until_unix_ms)
        .bind(transition.revoked_at_unix_ms)
        .bind(reason_code)
        .bind(&transition.binding_id)
        .bind(status)
        .execute(pool)
        .await
        {
            Ok(result) if result.rows_affected() == 1 => return Ok(()),
            Ok(_) => {
                let current: Option<String> = sqlx::query_scalar(
                    "SELECT status FROM task_workspace_binding_history WHERE binding_id = ?",
                )
                .bind(&transition.binding_id)
                .fetch_optional(pool)
                .await
                .map_err(|error| {
                    HostError::Request(format!("Confirm task workspace binding closure: {error}"))
                })?;
                if current.as_deref() != Some("active") {
                    return Ok(());
                }
                last_error = Some("binding history remained active".to_string());
            }
            Err(error) => last_error = Some(error.to_string()),
        }
        tokio::time::sleep(Duration::from_millis(25 * (attempt + 1))).await;
    }
    Err(HostError::Request(format!(
        "Close task workspace binding history after retries: {}",
        last_error.unwrap_or_else(|| "unknown persistence failure".into())
    )))
}

async fn reconcile_stale_active_bindings_from_pool(
    pool: &sqlx::SqlitePool,
    registry: &TaskWorkspaceBindingRegistry,
    now: i64,
) -> Result<u64, String> {
    let live = registry.live_binding_ids(now).map_err(host_error_message)?;
    let active_rows = sqlx::query(
        "SELECT binding_id FROM task_workspace_binding_history WHERE status = 'active'",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Inspect active task workspace bindings: {error}"))?;
    let mut reconciled = 0_u64;
    for row in active_rows {
        let binding_id: String = row
            .try_get("binding_id")
            .map_err(|error| format!("Decode active workspace binding: {error}"))?;
        if live.contains(&binding_id) {
            continue;
        }
        reconciled += sqlx::query(
            r#"
            UPDATE task_workspace_binding_history
            SET status = 'aborted', revoked_at_unix_ms = ?,
                read_grace_until_unix_ms = ?, last_used_at_unix_ms = ?,
                release_reason = 'registry_not_active'
            WHERE binding_id = ? AND status = 'active'
            "#,
        )
        .bind(now)
        .bind(now)
        .bind(now)
        .bind(binding_id)
        .execute(pool)
        .await
        .map_err(|error| format!("Reconcile stale task workspace binding: {error}"))?
        .rows_affected();
    }
    Ok(reconciled)
}

pub(crate) async fn revoke_task_workspace_binding<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    binding_ref: &str,
    status: TaskWorkspaceTerminalStatus,
    reason_code: &'static str,
) -> Result<(), HostError> {
    let now = now_unix_ms()?;
    let registry = app.state::<TaskWorkspaceBindingRegistry>();
    let transition = if matches!(status, TaskWorkspaceTerminalStatus::Expired) {
        registry.expire(binding_ref, now)?
    } else {
        registry.revoke(binding_ref, now)?
    };
    let (status, reason_code) = if transition.reason == TaskWorkspaceAuthorityLossReason::Expired {
        (TaskWorkspaceTerminalStatus::Expired, "ttl_expired")
    } else {
        (status, reason_code)
    };
    let pool = crate::local_db::get_offisim_pool(app)
        .map_err(|err| HostError::HostUnavailable(format!("Open offisim.db: {err}")))?;
    persist_binding_revocation_with_retry(&pool, &transition, status.as_str(), reason_code).await
}

pub(crate) fn workspace_bound_event(
    binding: &TaskWorkspaceBinding,
) -> Result<crate::pi_agent_host::PiAgentHostEvent, HostError> {
    Ok(crate::pi_agent_host::PiAgentHostEvent::WorkspaceBound {
        workspace_ref: binding.binding_ref.clone(),
        history_id: binding.binding_id.clone(),
        company_id: binding.company_id.clone(),
        project_id: binding.project_id.clone(),
        thread_id: binding.thread_id.clone(),
        turn_id: binding.turn_id.clone(),
        request_id: binding.request_id.clone(),
        access: binding.access.as_str().to_string(),
        source: binding.source.as_str().into(),
        confidence: binding.confidence,
        reason_code: binding.reason_code.as_str().into(),
        issued_at_unix_ms: binding.issued_at_unix_ms,
        expires_at_unix_ms: binding.expires_at_unix_ms,
        display_path: canonical_root_text(&binding.canonical_root)?,
    })
}

pub(crate) fn replay_workspace_bound_for_request<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    request_id: &str,
) -> Result<Option<crate::pi_agent_host::PiAgentHostEvent>, String> {
    let now = now_unix_ms().map_err(|error| format!("Read workspace replay clock: {error:?}"))?;
    app.state::<TaskWorkspaceBindingRegistry>()
        .replayable_for_request_at(request_id, now)
        .map_err(|error| format!("Resolve workspace replay: {error:?}"))?
        .as_ref()
        .map(workspace_bound_event)
        .transpose()
        .map_err(|error| format!("Build workspace replay event: {error:?}"))
}

pub(crate) async fn mark_orphaned_bindings_revoked<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let now = now_unix_ms().map_err(|error| format!("Read binding cleanup clock: {error:?}"))?;
    let pool = crate::local_db::get_offisim_pool(app)?;
    sqlx::query(
        r#"
        UPDATE task_workspace_binding_history
        SET status = 'app_restart', revoked_at_unix_ms = ?,
            read_grace_until_unix_ms = ?, last_used_at_unix_ms = ?,
            release_reason = 'app_restart'
        WHERE status = 'active'
        "#,
    )
    .bind(now)
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await
    .map_err(|err| format!("Close orphaned task workspace bindings: {err}"))?;
    Ok(())
}

fn validate_project_metadata(
    name: &str,
    status: &str,
    verify_max_attempts: u32,
    verify_token_budget: Option<u64>,
) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Project name is required.".into());
    }
    if !matches!(
        status,
        "planning" | "active" | "paused" | "completed" | "archived"
    ) {
        return Err("Project status is invalid.".into());
    }
    if !(1..=20).contains(&verify_max_attempts) {
        return Err("Verify attempts must be between 1 and 20.".into());
    }
    if verify_token_budget == Some(0) {
        return Err("Verify token budget must be positive.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn project_workspace_select<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    selections: tauri::State<'_, ProjectWorkspaceSelectionRegistry>,
    title: Option<String>,
) -> Result<Option<ProjectWorkspaceSelectionClaim>, String> {
    let title = title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Select Project folder")
        .chars()
        .take(160)
        .collect::<String>();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .dialog()
        .file()
        .set_title(title)
        .pick_folder(move |selected| {
            let _ = sender.send(selected);
        });
    let Some(selected) = receiver
        .await
        .map_err(|_| "Project folder picker closed unexpectedly.".to_string())?
    else {
        return Ok(None);
    };
    let selected = selected
        .into_path()
        .map_err(|_| "The selected Project folder is not a local filesystem path.".to_string())?;
    let canonical = crate::local_paths::resolve_project_workspace_root_path(selected)?;
    if !canonical.is_dir() {
        return Err("Project workspace must be an existing directory.".into());
    }
    let now = now_unix_ms().map_err(host_error_message)?;
    selections
        .register(window.label(), canonical, now)
        .map(Some)
}

#[tauri::command]
pub async fn project_create<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    input: ProjectCreateInput,
) -> Result<(), String> {
    let project_id = input.project_id.trim();
    let company_id = input.company_id.trim();
    if project_id.is_empty() || company_id.is_empty() {
        return Err("Project and Company identity are required.".into());
    }
    validate_project_metadata(
        &input.name,
        &input.status,
        input.verify_max_attempts,
        input.verify_token_budget,
    )?;
    let now = now_unix_ms().map_err(host_error_message)?;
    let selection = app.state::<ProjectWorkspaceSelectionRegistry>().consume(
        input.workspace_selection_ref.trim(),
        window.label(),
        now,
    )?;
    let canonical_root =
        canonical_root_text(&selection.canonical_root).map_err(host_error_message)?;
    let identity_json = serde_json::to_string(&selection.root_identity)
        .map_err(|error| format!("Encode Project workspace identity: {error}"))?;
    let pool = crate::local_db::get_offisim_pool(&app)?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("Begin Project creation: {error}"))?;
    sqlx::query(
        r#"
        INSERT INTO projects (
          project_id, company_id, name, description, status, workspace_root,
          verify_command, verify_max_attempts, verify_token_budget, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        "#,
    )
    .bind(project_id)
    .bind(company_id)
    .bind(input.name.trim())
    .bind(
        input
            .description
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    )
    .bind(input.status)
    .bind(&canonical_root)
    .bind(
        input
            .verify_command
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    )
    .bind(i64::from(input.verify_max_attempts))
    .bind(
        input
            .verify_token_budget
            .and_then(|value| i64::try_from(value).ok()),
    )
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("Create Project: {error}"))?;
    sqlx::query(
        r#"
        INSERT INTO project_workspace_authority (
          project_id, company_id, canonical_root, root_identity_json,
          selected_at_unix_ms, updated_at_unix_ms
        ) VALUES (?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(project_id)
    .bind(company_id)
    .bind(canonical_root)
    .bind(identity_json)
    .bind(now)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("Register Project workspace authority: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("Commit Project creation: {error}"))?;
    Ok(())
}

struct ProjectWorkspaceUpdatePlan {
    next_root: String,
    selected_identity_json: Option<String>,
    authority_changed: bool,
}

fn plan_project_workspace_update(
    selection: Option<&ProjectWorkspaceSelection>,
    current_root: String,
    current_authorized_root: &str,
    current_identity_json: &str,
) -> Result<ProjectWorkspaceUpdatePlan, String> {
    let next_root = selection
        .map(|value| canonical_root_text(&value.canonical_root).map_err(host_error_message))
        .transpose()?
        .unwrap_or(current_root);
    let selected_identity_json = selection
        .map(|value| {
            serde_json::to_string(&value.root_identity)
                .map_err(|error| format!("Encode Project workspace identity: {error}"))
        })
        .transpose()?;
    // Authority `updated_at_unix_ms` is part of every active binding's CAS
    // snapshot. Re-selecting the exact same filesystem object is not a renewal.
    let authority_changed = selected_identity_json
        .as_deref()
        .is_some_and(|identity_json| {
            next_root != current_authorized_root || identity_json != current_identity_json
        });
    Ok(ProjectWorkspaceUpdatePlan {
        next_root,
        selected_identity_json,
        authority_changed,
    })
}

async fn guard_project_workspace_authority_change(
    connection: &mut sqlx::SqliteConnection,
    project_id: &str,
    plan: &ProjectWorkspaceUpdatePlan,
) -> Result<(), String> {
    if !plan.authority_changed {
        return Ok(());
    }
    let active: i64 = sqlx::query_scalar(
        r#"
        SELECT CASE WHEN
          EXISTS (SELECT 1 FROM task_workspace_binding_history WHERE project_id = ? AND status = 'active')
          OR EXISTS (SELECT 1 FROM task_workspace_lease_history WHERE project_id = ? AND status = 'active')
        THEN 1 ELSE 0 END
        "#,
    )
    .bind(project_id)
    .bind(project_id)
    .fetch_one(connection)
    .await
    .map_err(|error| format!("Inspect active Project work: {error}"))?;
    if active != 0 {
        return Err(
            "Stop active tasks and review, release, or discard retained worktrees before changing this Project folder."
                .into(),
        );
    }
    Ok(())
}

async fn persist_project_workspace_authority_change(
    connection: &mut sqlx::SqliteConnection,
    project_id: &str,
    company_id: &str,
    plan: &ProjectWorkspaceUpdatePlan,
    now: i64,
) -> Result<(), String> {
    if !plan.authority_changed {
        return Ok(());
    }
    let identity_json = plan.selected_identity_json.as_deref().ok_or_else(|| {
        "Selected Project workspace identity was not available for persistence.".to_string()
    })?;
    sqlx::query(
        r#"
        UPDATE project_workspace_authority
        SET canonical_root = ?, root_identity_json = ?,
            selected_at_unix_ms = ?, updated_at_unix_ms = ?
        WHERE project_id = ? AND company_id = ?
        "#,
    )
    .bind(&plan.next_root)
    .bind(identity_json)
    .bind(now)
    .bind(now)
    .bind(project_id)
    .bind(company_id)
    .execute(connection)
    .await
    .map_err(|error| {
        let detail = error.to_string();
        if detail.contains("review, release, or discard") {
            "Stop active tasks and review, release, or discard retained worktrees before changing this Project folder."
                .to_string()
        } else {
            format!("Update Project workspace authority: {error}")
        }
    })?;
    Ok(())
}

#[tauri::command]
pub async fn project_update<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    input: ProjectUpdateInput,
) -> Result<(), String> {
    let project_id = input.project_id.trim();
    if project_id.is_empty() {
        return Err("Project identity is required.".into());
    }
    validate_project_metadata(
        &input.name,
        &input.status,
        input.verify_max_attempts,
        input.verify_token_budget,
    )?;
    let now = now_unix_ms().map_err(host_error_message)?;
    let selection = match input
        .workspace_selection_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(selection_ref) => Some(app.state::<ProjectWorkspaceSelectionRegistry>().consume(
            selection_ref,
            window.label(),
            now,
        )?),
        None => None,
    };
    let pool = crate::local_db::get_offisim_pool(&app)?;
    reconcile_stale_active_bindings_from_pool(
        &pool,
        &app.state::<TaskWorkspaceBindingRegistry>(),
        now,
    )
    .await?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("Begin Project update: {error}"))?;
    let current = sqlx::query(
        r#"
        SELECT project.company_id, project.workspace_root,
               authority.canonical_root, authority.root_identity_json
        FROM projects AS project
        JOIN project_workspace_authority AS authority
          ON authority.project_id = project.project_id
         AND authority.company_id = project.company_id
         AND authority.canonical_root = project.workspace_root
        WHERE project.project_id = ?
        "#,
    )
    .bind(project_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| format!("Read Project workspace authority: {error}"))?
    .ok_or_else(|| {
        "Project workspace authority is missing or does not match the Project catalog.".to_string()
    })?;
    let company_id: String = current
        .try_get("company_id")
        .map_err(|error| format!("Decode Project Company: {error}"))?;
    let current_root: String = current
        .try_get("workspace_root")
        .map_err(|error| format!("Decode Project folder: {error}"))?;
    let current_authorized_root: String = current
        .try_get("canonical_root")
        .map_err(|error| format!("Decode authorized Project folder: {error}"))?;
    let current_identity_json: String = current
        .try_get("root_identity_json")
        .map_err(|error| format!("Decode Project folder identity: {error}"))?;
    let workspace_update = plan_project_workspace_update(
        selection.as_ref(),
        current_root,
        &current_authorized_root,
        &current_identity_json,
    )?;
    guard_project_workspace_authority_change(&mut tx, project_id, &workspace_update).await?;
    sqlx::query(
        r#"
        UPDATE projects
        SET name = ?, description = ?, status = ?, workspace_root = ?,
            verify_command = ?, verify_max_attempts = ?, verify_token_budget = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE project_id = ?
        "#,
    )
    .bind(input.name.trim())
    .bind(input.description.as_deref().map(str::trim).filter(|value| !value.is_empty()))
    .bind(input.status)
    .bind(&workspace_update.next_root)
    .bind(input.verify_command.as_deref().map(str::trim).filter(|value| !value.is_empty()))
    .bind(i64::from(input.verify_max_attempts))
    .bind(input.verify_token_budget.and_then(|value| i64::try_from(value).ok()))
    .bind(project_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| {
        let detail = error.to_string();
        if detail.contains("review, release, or discard") {
            "Stop active tasks and review, release, or discard retained worktrees before changing this Project folder."
                .to_string()
        } else {
            format!("Update Project: {error}")
        }
    })?;
    persist_project_workspace_authority_change(
        &mut tx,
        project_id,
        &company_id,
        &workspace_update,
        now,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|error| format!("Commit Project update: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn project_update_status<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
    status: String,
) -> Result<(), String> {
    if !matches!(
        status.as_str(),
        "planning" | "active" | "paused" | "completed" | "archived"
    ) {
        return Err("Project status is invalid.".into());
    }
    let pool = crate::local_db::get_offisim_pool(&app)?;
    let changed = sqlx::query(
        "UPDATE projects SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ?",
    )
    .bind(status)
    .bind(project_id.trim())
    .execute(&pool)
    .await
    .map_err(|error| format!("Update Project status: {error}"))?
    .rows_affected();
    if changed == 1 {
        Ok(())
    } else {
        Err("Project was not found.".into())
    }
}

#[cfg(test)]
pub(crate) fn test_task_workspace_binding(
    canonical_root: &Path,
    project_id: &str,
    verify_command: Option<String>,
    verify_max_attempts: u32,
    verify_token_budget: Option<u64>,
) -> TaskWorkspaceBinding {
    let canonical_root_text = canonical_root.to_string_lossy().to_string();
    let evidence = crate::workspace_recovery::capture_workspace_evidence(canonical_root, "Project")
        .unwrap_or(crate::workspace_recovery::WorkspaceEvidence {
            basename_normalized: String::new(),
            project_name_normalized: "project".into(),
            anchor: String::new(),
            git_origin_digest: None,
        });
    let root_identity = root_identity(canonical_root).unwrap_or(RootIdentity {
        canonical_root: canonical_root_text.clone(),
        #[cfg(unix)]
        device: 0,
        #[cfg(unix)]
        inode: 0,
    });
    let authority_snapshot_root_identity_json =
        serde_json::to_string(&root_identity).unwrap_or_else(|_| "{}".into());
    TaskWorkspaceBinding {
        binding_ref: random_ref(),
        binding_id: random_id(),
        company_id: "company-1".into(),
        project_id: project_id.into(),
        thread_id: "thread-1".into(),
        turn_id: "root-run-1".into(),
        request_id: "request-1".into(),
        access: TaskWorkspaceAccess::Write,
        canonical_root: canonical_root.to_path_buf(),
        root_identity,
        workspace_basename_normalized: evidence.basename_normalized,
        project_name_normalized: evidence.project_name_normalized,
        workspace_anchor: evidence.anchor,
        git_origin_digest: evidence.git_origin_digest,
        recovery_witness_binding_id: None,
        recovery_witness_authority_project_id: None,
        authority_snapshot_canonical_root: canonical_root_text,
        authority_snapshot_root_identity_json,
        authority_snapshot_updated_at_unix_ms: 1_000,
        source: WorkspaceRecoverySource::ProjectCatalog,
        confidence: 1.0,
        reason_code: WorkspaceRecoveryReason::CurrentProjectFolder,
        issued_at_unix_ms: 1_000,
        expires_at_unix_ms: 10_000,
        project_verify_command: verify_command,
        project_verify_max_attempts: verify_max_attempts,
        project_verify_token_budget: verify_token_budget,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[test]
    fn resettable_native_session_codes_round_trip_through_typed_policy() {
        for value in [
            "native-session-missing",
            "native-session-invalid",
            "native-session-runtime-incompatible",
            "native-session-context-invalid",
        ] {
            assert_eq!(
                ResettableNativeSessionPrestartCode::parse(value).map(|code| code.as_str()),
                Some(value)
            );
        }

        for value in [
            "native-session-conflict",
            "native-session-persistence",
            "future-native-session-code",
        ] {
            assert_eq!(ResettableNativeSessionPrestartCode::parse(value), None);
        }
    }

    fn write_test_native_session(session_dir: &Path, session_id: &str, cwd: &Path) -> PathBuf {
        std::fs::create_dir_all(session_dir).expect("create native session fixture directory");
        let session_file = session_dir.join(format!("{session_id}.jsonl"));
        std::fs::write(
            &session_file,
            format!(
                "{{\"type\":\"session\",\"version\":3,\"id\":{},\"timestamp\":\"2026-07-14T00:00:00.000Z\",\"cwd\":{}}}\n",
                serde_json::to_string(session_id).expect("encode fixture session id"),
                serde_json::to_string(&cwd.to_string_lossy()).expect("encode session cwd")
            ),
        )
        .expect("write native session fixture");
        session_file
    }

    async fn resume_race_pool(
        binding_status: &str,
        agent_status: &str,
        root: &Path,
    ) -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open resume race db");
        sqlx::query(
            r#"
            CREATE TABLE task_workspace_binding_history (
              binding_id TEXT PRIMARY KEY NOT NULL,
              company_id TEXT NOT NULL,
              project_id TEXT NOT NULL,
              thread_id TEXT NOT NULL,
              turn_id TEXT NOT NULL,
              request_id TEXT NOT NULL UNIQUE,
              access TEXT NOT NULL,
              canonical_root TEXT NOT NULL,
              root_identity_json TEXT NOT NULL,
              workspace_basename_normalized TEXT,
              project_name_normalized TEXT,
              workspace_anchor TEXT,
              git_origin_digest TEXT,
              recovery_witness_binding_id TEXT,
              recovery_witness_authority_project_id TEXT,
              authority_snapshot_canonical_root TEXT NOT NULL,
              authority_snapshot_root_identity_json TEXT NOT NULL,
              authority_snapshot_updated_at_unix_ms INTEGER NOT NULL,
              source TEXT NOT NULL,
              confidence REAL NOT NULL,
              reason_code TEXT NOT NULL,
              issued_at_unix_ms INTEGER NOT NULL,
              expires_at_unix_ms INTEGER NOT NULL,
              activated_at_unix_ms INTEGER NOT NULL,
              last_used_at_unix_ms INTEGER NOT NULL,
              status TEXT NOT NULL,
              resumed_from_binding_id TEXT
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create resume binding history schema");
        for statement in [
            "CREATE TABLE projects (project_id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, name TEXT NOT NULL, workspace_root TEXT NOT NULL, verify_command TEXT, verify_max_attempts INTEGER NOT NULL DEFAULT 3, verify_token_budget INTEGER)",
            "CREATE TABLE chat_threads (thread_id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL)",
            "CREATE TABLE project_workspace_authority (project_id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, canonical_root TEXT NOT NULL, root_identity_json TEXT NOT NULL, updated_at_unix_ms INTEGER NOT NULL)",
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("create authority CAS fixture schema");
        }
        let root_text = canonical_root_text(root).expect("resume fixture root text");
        let identity_json =
            serde_json::to_string(&root_identity(root).expect("resume fixture root identity"))
                .expect("resume fixture identity json");
        sqlx::query(
            "INSERT INTO projects (project_id, company_id, name, workspace_root) VALUES ('project-1', 'company-1', 'Project', ?)",
        )
            .bind(&root_text)
            .execute(&pool)
            .await
            .expect("insert resume fixture Project");
        sqlx::query("INSERT INTO chat_threads VALUES ('thread-1', 'project-1')")
            .execute(&pool)
            .await
            .expect("insert resume fixture Conversation");
        sqlx::query(
            "INSERT INTO project_workspace_authority VALUES ('project-1', 'company-1', ?, ?, 1000)",
        )
        .bind(&root_text)
        .bind(&identity_json)
        .execute(&pool)
        .await
        .expect("insert resume fixture authority");
        sqlx::query(
            "CREATE UNIQUE INDEX idx_task_workspace_binding_resume_once ON task_workspace_binding_history(resumed_from_binding_id) WHERE resumed_from_binding_id IS NOT NULL",
        )
        .execute(&pool)
        .await
        .expect("create resume uniqueness index");
        sqlx::query(
            r#"
            CREATE TABLE agent_runs (
              run_id TEXT PRIMARY KEY NOT NULL,
              root_run_id TEXT NOT NULL,
              parent_run_id TEXT,
              company_id TEXT NOT NULL,
              project_id TEXT,
              thread_id TEXT NOT NULL,
              status TEXT NOT NULL,
              failure_kind TEXT,
              runtime_context_json TEXT,
              session_file TEXT,
              finished_at TEXT
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create resume Agent run schema");
        sqlx::query(
            r#"
            CREATE TABLE task_workspace_lease_history (
              lease_id TEXT PRIMARY KEY NOT NULL,
              project_id TEXT NOT NULL,
              created_root_run_id TEXT NOT NULL,
              canonical_worktree TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create resume workspace lease schema");
        sqlx::query(
            r#"
            INSERT INTO task_workspace_binding_history (
              binding_id, company_id, project_id, thread_id, turn_id, request_id,
              access, canonical_root, root_identity_json, source, confidence,
              reason_code, issued_at_unix_ms, expires_at_unix_ms,
              activated_at_unix_ms, last_used_at_unix_ms, status,
              authority_snapshot_canonical_root,
              authority_snapshot_root_identity_json,
              authority_snapshot_updated_at_unix_ms,
              resumed_from_binding_id
            ) VALUES (
              'history-1', 'company-1', 'project-1', 'thread-1', 'turn-1',
              'original-request', 'write', ?, ?, 'project_catalog',
              1.0, 'current_project_folder', 1, 2, 1, 1, ?, ?, ?, 1000, NULL
            )
            "#,
        )
        .bind(&root_text)
        .bind(&identity_json)
        .bind(binding_status)
        .bind(&root_text)
        .bind(&identity_json)
        .execute(&pool)
        .await
        .expect("insert original binding history");
        let session_file = write_test_native_session(root, "session-a", root);
        let runtime_context = serde_json::json!({
            "requestId": "original-request",
            "streamCursor": 7,
            "workspaceBinding": {
                "historyId": "history-1",
                "companyId": "company-1",
                "projectId": "project-1",
                "threadId": "thread-1",
                "turnId": "turn-1",
                "requestId": "original-request",
                "access": "write",
                "source": "project_catalog",
                "confidence": 1.0,
                "reasonCode": "current_project_folder",
                "issuedAtUnixMs": 1,
                "expiresAtUnixMs": 2,
                "displayPath": root_text,
            },
            "workspaceRequirement": "optional",
            "workspaceAvailability": "bound",
            "runtime": "pi-agent",
            "piSdkVersion": "0.79.8",
            "wireProtocolVersion": crate::pi_agent_host::PI_HOST_PROTOCOL_VERSION,
            "nativeSessionId": "session-a",
            "projectId": "project-1",
        });
        sqlx::query(
            "INSERT INTO agent_runs (run_id, root_run_id, parent_run_id, company_id, project_id, thread_id, status, runtime_context_json, session_file) VALUES ('turn-1', 'turn-1', NULL, 'company-1', 'project-1', 'thread-1', ?, ?, ?)",
        )
        .bind(agent_status)
        .bind(runtime_context.to_string())
        .bind(session_file.to_string_lossy().to_string())
        .execute(&pool)
        .await
        .expect("insert interrupted Agent run");
        pool
    }

    async fn deletion_preflight_pool() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open deletion preflight db");
        for statement in [
            "CREATE TABLE companies (company_id TEXT PRIMARY KEY NOT NULL)",
            "CREATE TABLE projects (project_id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL)",
            "CREATE TABLE chat_threads (thread_id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL)",
            "CREATE TABLE task_workspace_binding_history (binding_id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, project_id TEXT NOT NULL, thread_id TEXT NOT NULL, status TEXT NOT NULL)",
            "CREATE TABLE task_workspace_lease_history (lease_id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, created_binding_id TEXT NOT NULL, active_binding_id TEXT NOT NULL, status TEXT NOT NULL)",
            "INSERT INTO companies (company_id) VALUES ('company-1')",
            "INSERT INTO projects (project_id, company_id) VALUES ('project-1', 'company-1')",
            "INSERT INTO chat_threads (thread_id, project_id) VALUES ('thread-1', 'project-1')",
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("build deletion preflight fixture");
        }
        pool
    }

    fn fixture_binding(root: &Path, access: TaskWorkspaceAccess) -> TaskWorkspaceBinding {
        let evidence =
            crate::workspace_recovery::capture_workspace_evidence(root, "Project").unwrap();
        let root_identity = root_identity(root).expect("fixture root identity");
        let authority_snapshot_root_identity_json =
            serde_json::to_string(&root_identity).expect("fixture identity json");
        TaskWorkspaceBinding {
            binding_ref: random_ref(),
            binding_id: random_id(),
            company_id: "company-1".into(),
            project_id: "project-1".into(),
            thread_id: "thread-1".into(),
            turn_id: "turn-1".into(),
            request_id: "request-1".into(),
            access,
            canonical_root: root.to_path_buf(),
            root_identity,
            workspace_basename_normalized: evidence.basename_normalized,
            project_name_normalized: evidence.project_name_normalized,
            workspace_anchor: evidence.anchor,
            git_origin_digest: evidence.git_origin_digest,
            recovery_witness_binding_id: None,
            recovery_witness_authority_project_id: None,
            authority_snapshot_canonical_root: root.to_string_lossy().into_owned(),
            authority_snapshot_root_identity_json,
            authority_snapshot_updated_at_unix_ms: 1_000,
            source: WorkspaceRecoverySource::ProjectCatalog,
            confidence: 1.0,
            reason_code: WorkspaceRecoveryReason::CurrentProjectFolder,
            issued_at_unix_ms: 1_000,
            expires_at_unix_ms: 100_000_000,
            project_verify_command: Some("pnpm typecheck".into()),
            project_verify_max_attempts: 3,
            project_verify_token_budget: Some(12_000),
        }
    }

    fn scope<'a>(access: TaskWorkspaceAccess) -> IssueTaskWorkspaceBinding<'a> {
        IssueTaskWorkspaceBinding {
            company_id: "company-1",
            project_id: "project-1",
            thread_id: "thread-1",
            turn_id: "turn-1",
            request_id: "request-1",
            access,
        }
    }

    fn claim(binding: &TaskWorkspaceBinding) -> TaskWorkspaceBindingClaim {
        TaskWorkspaceBindingClaim {
            workspace_ref: binding.binding_ref.clone(),
            history_id: binding.binding_id.clone(),
            company_id: binding.company_id.clone(),
            project_id: binding.project_id.clone(),
            thread_id: binding.thread_id.clone(),
            turn_id: binding.turn_id.clone(),
            request_id: binding.request_id.clone(),
            access: binding.access.as_str().into(),
        }
    }

    #[test]
    fn opaque_refs_are_256_bit_urlsafe_capabilities() {
        let first = random_ref();
        let second = random_ref();
        assert_ne!(first, second);
        assert_eq!(
            URL_SAFE_NO_PAD
                .decode(first)
                .expect("decode binding ref")
                .len(),
            32
        );
    }

    #[test]
    fn registry_enforces_scope_access_expiry_and_revoked_read_grace() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let root = root.canonicalize().expect("canonical fixture root");
        let registry = TaskWorkspaceBindingRegistry::default();
        let binding = fixture_binding(&root, TaskWorkspaceAccess::Write);
        registry
            .insert(binding.clone(), 1_000)
            .expect("insert binding");

        assert!(registry
            .resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Write),
                2_000
            )
            .is_ok());
        let wrong_scope = IssueTaskWorkspaceBinding {
            project_id: "project-2",
            ..scope(TaskWorkspaceAccess::Read)
        };
        assert!(matches!(
            registry.resolve_at(&binding.binding_ref, &wrong_scope, 2_000),
            Err(ResolveBindingError::Scope)
        ));
        let revocation = registry
            .revoke(&binding.binding_ref, 3_000)
            .expect("revoke binding");
        let grace_until = revocation.grace_until_unix_ms;
        assert!(registry
            .resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                3_001
            )
            .is_ok());
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Write),
                3_001
            ),
            Err(ResolveBindingError::Revoked)
        ));
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                grace_until + 1
            ),
            Err(ResolveBindingError::Revoked)
        ));

        let mut expired = fixture_binding(&root, TaskWorkspaceAccess::Read);
        expired.expires_at_unix_ms = 10_000;
        registry
            .insert(expired.clone(), 1_000)
            .expect("insert expired");
        assert!(matches!(
            registry.resolve_at(
                &expired.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                10_000
            ),
            Err(ResolveBindingError::Expired)
        ));
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn revoked_read_grace_covers_terminal_stream_replay_window() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let root = root.canonicalize().expect("canonical fixture root");
        let registry = TaskWorkspaceBindingRegistry::default();
        let binding = fixture_binding(&root, TaskWorkspaceAccess::Write);
        registry
            .insert(binding.clone(), 1_000)
            .expect("insert binding");

        let revoked_at = 3_000;
        let revocation = registry
            .revoke(&binding.binding_ref, revoked_at)
            .expect("revoke binding");
        let grace_until = revocation.grace_until_unix_ms;
        assert_eq!(grace_until - revoked_at, REVOKED_READ_GRACE_MS);
        assert_eq!(
            REVOKED_READ_GRACE_MS,
            crate::pi_agent_host::PI_RUN_STREAM_TERMINAL_TTL_SECS as i64 * 1_000
        );
        assert!(registry
            .resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                revoked_at + 6 * 60 * 1_000
            )
            .is_ok());
        assert!(registry
            .resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                grace_until
            )
            .is_ok());
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                grace_until + 1
            ),
            Err(ResolveBindingError::Revoked)
        ));
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn binding_expiry_transition_is_idempotent_and_preserves_read_grace() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let root = root.canonicalize().expect("canonical fixture root");
        let registry = TaskWorkspaceBindingRegistry::default();
        let mut binding = fixture_binding(&root, TaskWorkspaceAccess::Write);
        binding.expires_at_unix_ms = 5_000;
        registry
            .insert(binding.clone(), 1_000)
            .expect("insert binding");

        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Verify),
                5_000
            ),
            Err(ResolveBindingError::Expired)
        ));
        let first = registry
            .expire(&binding.binding_ref, 5_000)
            .expect("transition expiry");
        let repeated = registry
            .expire(&binding.binding_ref, 9_000)
            .expect("repeat expiry transition");
        assert_eq!(first.revoked_at_unix_ms, repeated.revoked_at_unix_ms);
        assert_eq!(first.grace_until_unix_ms, repeated.grace_until_unix_ms);
        assert_eq!(
            first.grace_until_unix_ms,
            first.revoked_at_unix_ms + REVOKED_READ_GRACE_MS
        );
        assert!(registry
            .resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                first.grace_until_unix_ms
            )
            .is_ok());
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Verify),
                first.grace_until_unix_ms
            ),
            Err(ResolveBindingError::Expired)
        ));
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                first.grace_until_unix_ms + 1
            ),
            Err(ResolveBindingError::Expired)
        ));
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn read_binding_never_authorizes_write() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let root = root.canonicalize().expect("canonical fixture root");
        let registry = TaskWorkspaceBindingRegistry::default();
        let binding = fixture_binding(&root, TaskWorkspaceAccess::Read);
        registry
            .insert(binding.clone(), 1_000)
            .expect("insert binding");
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Write),
                2_000
            ),
            Err(ResolveBindingError::Access)
        ));
        assert!(registry
            .resolve_evaluation_binding_at(&claim(&binding), 2_000)
            .is_err());
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn read_binding_never_authorizes_verification() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let root = root.canonicalize().expect("canonical fixture root");
        let registry = TaskWorkspaceBindingRegistry::default();
        let binding = fixture_binding(&root, TaskWorkspaceAccess::Read);
        registry
            .insert(binding.clone(), 1_000)
            .expect("insert binding");
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Verify),
                2_000
            ),
            Err(ResolveBindingError::Access)
        ));
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn revoked_write_binding_allows_only_read_for_full_terminal_grace() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let root = root.canonicalize().expect("canonical fixture root");
        let registry = TaskWorkspaceBindingRegistry::default();
        let mut binding = fixture_binding(&root, TaskWorkspaceAccess::Write);
        binding.expires_at_unix_ms = 10_000;
        registry
            .insert(binding.clone(), 1_000)
            .expect("insert binding");

        let terminal_at = binding.expires_at_unix_ms - 1;
        let revocation = registry
            .revoke(&binding.binding_ref, terminal_at)
            .expect("revoke binding immediately before original expiry");
        let grace_until = revocation.grace_until_unix_ms;
        assert_eq!(grace_until, terminal_at + REVOKED_READ_GRACE_MS);

        // A later insert runs registry retention after the original expiry.
        // The terminal binding must remain live until its independent grace end.
        let mut unrelated = fixture_binding(&root, TaskWorkspaceAccess::Read);
        unrelated.request_id = "request-2".into();
        registry
            .insert(unrelated, binding.expires_at_unix_ms + 1)
            .expect("retain terminal binding past original expiry");

        assert!(registry
            .resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                grace_until
            )
            .is_ok());
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Verify),
                binding.expires_at_unix_ms
            ),
            Err(ResolveBindingError::Revoked)
        ));
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Write),
                binding.expires_at_unix_ms
            ),
            Err(ResolveBindingError::Revoked)
        ));
        assert!(registry
            .replayable_for_request_at(&binding.request_id, grace_until)
            .expect("replay terminal binding")
            .is_some());
        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Verify),
                grace_until + 1
            ),
            Err(ResolveBindingError::Revoked)
        ));
        assert!(registry
            .replayable_for_request_at(&binding.request_id, grace_until + 1)
            .expect("expire terminal replay grace")
            .is_none());
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn evaluation_lease_is_bounded_nonrenewable_and_never_direct_write() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let root = root.canonicalize().expect("canonical fixture root");
        let registry = TaskWorkspaceBindingRegistry::default();
        let binding = fixture_binding(&root, TaskWorkspaceAccess::Write);
        let binding_claim = claim(&binding);
        registry
            .insert(binding.clone(), 1_000)
            .expect("insert binding");
        registry
            .revoke(&binding.binding_ref, 2_000)
            .expect("terminalize source binding");

        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Verify),
                2_001
            ),
            Err(ResolveBindingError::Revoked)
        ));
        let source = registry
            .resolve_evaluation_binding_at(&binding_claim, 2_001)
            .expect("terminal read grace may prove the original write grant");
        let lease = registry
            .acquire_evaluation_lease_at(
                source,
                VerifiedEvaluationScope {
                    mission_id: "mission-1".into(),
                    attempt_id: "attempt-1".into(),
                },
                2_001,
            )
            .expect("acquire evaluation lease");

        for operation in [TaskWorkspaceAccess::Read, TaskWorkspaceAccess::Verify] {
            assert!(registry
                .resolve_evaluation_lease_at(&lease, Some("project-1"), operation, 2_002)
                .is_ok());
        }
        assert!(registry
            .resolve_evaluation_lease_at(
                &lease,
                Some("project-1"),
                TaskWorkspaceAccess::Write,
                2_002
            )
            .is_err());

        let mut forged_attempt = lease.clone();
        forged_attempt.attempt_id = "attempt-2".into();
        assert!(registry
            .resolve_evaluation_lease_at(
                &forged_attempt,
                Some("project-1"),
                TaskWorkspaceAccess::Read,
                2_002
            )
            .is_err());

        registry
            .release_evaluation_lease_at(&lease, 2_003)
            .expect("release evaluation lease");
        registry
            .release_evaluation_lease_at(&lease, 2_004)
            .expect("repeat release is idempotent");
        assert!(registry
            .resolve_evaluation_lease_at(
                &lease,
                Some("project-1"),
                TaskWorkspaceAccess::Verify,
                2_004
            )
            .is_err());
        assert!(registry
            .acquire_evaluation_lease_at(
                binding,
                VerifiedEvaluationScope {
                    mission_id: "mission-1".into(),
                    attempt_id: "attempt-1".into(),
                },
                2_005,
            )
            .is_err());
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[test]
    fn evaluation_lifecycle_separates_running_acquire_from_verifying_use() {
        assert!(validate_evaluation_lifecycle_status(
            "running",
            "running",
            false,
            EvaluationScopePhase::Acquire,
        )
        .is_ok());
        assert!(validate_evaluation_lifecycle_status(
            "verifying",
            "running",
            false,
            EvaluationScopePhase::Use,
        )
        .is_ok());
        assert!(validate_evaluation_lifecycle_status(
            "running",
            "running",
            false,
            EvaluationScopePhase::Use,
        )
        .is_err());
        assert!(validate_evaluation_lifecycle_status(
            "completed",
            "pass",
            true,
            EvaluationScopePhase::Use,
        )
        .is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn authorized_process_cwd_rejects_root_replacement_after_command_binding() {
        let fixture = std::env::temp_dir().join(format!("offisim-process-root-{}", random_id()));
        let root = fixture.join("root");
        let original = fixture.join("original");
        std::fs::create_dir_all(&root).expect("create process root fixture");
        let root = root.canonicalize().expect("canonical process root");
        let authority = AuthorizedWorkspaceRoot::from_live_path(root.clone())
            .expect("capture process root authority");
        let execution = AuthorizedProcessCwd::from_authority(&authority, &root)
            .expect("capture process cwd authority");
        let mut command = tokio::process::Command::new("/bin/sh");
        command.args(["-c", "printf replacement > replacement-sentinel"]);
        execution
            .bind_command(&mut command)
            .expect("bind process command before replacement");

        std::fs::rename(&root, &original).expect("move original process root");
        std::fs::create_dir(&root).expect("create same-path replacement root");
        let result = command.output().await;

        assert!(
            result.is_err(),
            "root replacement must fail the child pre-exec"
        );
        assert!(
            !root.join("replacement-sentinel").exists(),
            "replacement root must remain untouched"
        );
        assert!(
            !original.join("replacement-sentinel").exists(),
            "failed spawn must not write through the captured descriptor"
        );
        std::fs::remove_dir_all(fixture).expect("remove process root fixture");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn authorized_process_cwd_rejects_moved_nested_cwd_symlink_backfill() {
        let fixture = std::env::temp_dir().join(format!("offisim-process-nested-{}", random_id()));
        let root = fixture.join("root");
        let nested = root.join("nested");
        let moved = fixture.join("moved-nested");
        std::fs::create_dir_all(&nested).expect("create nested process cwd fixture");
        let root = root.canonicalize().expect("canonical process root");
        let nested = nested.canonicalize().expect("canonical nested process cwd");
        let authority = AuthorizedWorkspaceRoot::from_live_path(root.clone())
            .expect("capture nested root authority");
        let execution = AuthorizedProcessCwd::from_authority(&authority, &nested)
            .expect("capture nested cwd authority");
        let mut command = tokio::process::Command::new("/bin/sh");
        command.args(["-c", "printf escaped > outside-sentinel"]);
        execution
            .bind_command(&mut command)
            .expect("bind nested process command before replacement");

        std::fs::rename(&nested, &moved).expect("move nested cwd outside the root");
        std::os::unix::fs::symlink(&moved, &nested)
            .expect("backfill nested cwd with same-inode symlink");
        let result = command.output().await;

        assert!(
            result.is_err(),
            "same-inode symlink backfill must fail the descriptor rewalk"
        );
        assert!(
            !moved.join("outside-sentinel").exists(),
            "moved cwd outside the root must remain untouched"
        );
        std::fs::remove_file(&nested).expect("remove nested cwd symlink");
        std::fs::remove_dir_all(fixture).expect("remove nested process fixture");
    }

    #[cfg(unix)]
    #[test]
    fn authorized_process_cwd_from_expected_rejects_a_preexisting_replacement() {
        use std::os::unix::fs::MetadataExt;

        let fixture =
            std::env::temp_dir().join(format!("offisim-process-expected-{}", random_id()));
        let root = fixture.join("root");
        let cwd = root.join("worktree");
        let original = fixture.join("original-worktree");
        std::fs::create_dir_all(&cwd).expect("create expected process cwd fixture");
        let root = root
            .canonicalize()
            .expect("canonical expected process root");
        let cwd = cwd.canonicalize().expect("canonical expected process cwd");
        let authority = AuthorizedWorkspaceRoot::from_live_path(root)
            .expect("capture expected process root authority");
        let durable = cwd.metadata().expect("inspect durable process cwd");

        std::fs::rename(&cwd, &original).expect("move durable process cwd");
        std::fs::create_dir(&cwd).expect("create same-path process cwd replacement");
        let result =
            AuthorizedProcessCwd::from_expected(&authority, &cwd, durable.dev(), durable.ino());

        assert!(
            result.is_err(),
            "durable identity construction must reject an already replaced cwd"
        );
        std::fs::remove_dir_all(fixture).expect("remove expected process fixture");
    }

    #[test]
    fn live_authority_recheck_rejects_expiry_scope_and_root_replacement() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let root = root.canonicalize().expect("canonical fixture root");
        let registry = TaskWorkspaceBindingRegistry::default();
        let mut binding = fixture_binding(&root, TaskWorkspaceAccess::Write);
        binding.expires_at_unix_ms = 5_000;
        registry
            .insert(binding.clone(), 1_000)
            .expect("insert binding");

        assert!(registry
            .validate_authority_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Write),
                4_999
            )
            .is_ok());
        let wrong_scope = IssueTaskWorkspaceBinding {
            project_id: "project-2",
            ..scope(TaskWorkspaceAccess::Write)
        };
        assert!(matches!(
            registry.validate_authority_at(&binding.binding_ref, &wrong_scope, 4_999),
            Err(ResolveBindingError::Scope)
        ));
        assert!(matches!(
            registry.validate_authority_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Write),
                5_000
            ),
            Err(ResolveBindingError::Expired)
        ));

        binding.expires_at_unix_ms = 10_000;
        registry
            .insert(binding.clone(), 1_000)
            .expect("replace with live binding");
        std::fs::remove_dir(&root).expect("remove original fixture root");
        std::fs::create_dir(&root).expect("replace fixture root");
        assert!(matches!(
            registry.validate_authority_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Write),
                5_001
            ),
            Err(ResolveBindingError::RootChanged)
        ));
        std::fs::remove_dir(root).expect("remove replacement fixture root");
    }

    #[test]
    fn claim_projection_cannot_forge_history_access_or_catalog_project() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let root = root.canonicalize().expect("canonical fixture root");
        let binding = fixture_binding(&root, TaskWorkspaceAccess::Write);
        let valid = claim(&binding);
        assert!(validate_task_workspace_claim(&binding, &valid, Some("project-1")).is_ok());

        let mut forged_history = valid.clone();
        forged_history.history_id = "different-history".into();
        assert!(
            validate_task_workspace_claim(&binding, &forged_history, Some("project-1")).is_err()
        );

        let mut forged_access = valid.clone();
        forged_access.access = "read".into();
        assert!(
            validate_task_workspace_claim(&binding, &forged_access, Some("project-1")).is_err()
        );
        assert!(validate_task_workspace_claim(&binding, &valid, Some("project-2")).is_err());
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn resume_compatibility_accepts_durable_recovered_history_without_returning_root() {
        use std::os::unix::fs::MetadataExt;

        let write_origin = |root: &Path, origin: &str| {
            if !root.join(".git/HEAD").is_file() {
                let status = std::process::Command::new("git")
                    .arg("init")
                    .arg("--quiet")
                    .arg(root)
                    .env("GIT_CONFIG_NOSYSTEM", "1")
                    .env("GIT_CONFIG_GLOBAL", "/dev/null")
                    .status()
                    .expect("initialize recovery Git fixture");
                assert!(status.success(), "initialize recovery Git fixture");
            }
            let status = std::process::Command::new("git")
                .arg("-C")
                .arg(root)
                .args(["config", "--replace-all", "remote.origin.url", origin])
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .status()
                .expect("write recovery Git origin");
            assert!(status.success(), "write recovery Git origin");
        };
        let fixture = std::env::temp_dir().join(format!("offisim-resume-compat-{}", random_id()));
        let original = fixture.join("old-name");
        std::fs::create_dir_all(&original).expect("create original Project root");
        write_origin(&original, "ssh://git@example.com/org/repo.git");
        let original = original.canonicalize().expect("canonical original root");
        let original_text = canonical_root_text(&original).expect("original root text");
        let authority_identity =
            serde_json::to_string(&root_identity(&original).expect("original root identity"))
                .expect("encode original root identity");
        let original_metadata = original.metadata().expect("inspect original root identity");
        let original_recovery_identity = serde_json::json!({
            "canonicalRoot": &original_text,
            "device": original_metadata.dev(),
            "inode": original_metadata.ino(),
        })
        .to_string();
        let original_evidence =
            crate::workspace_recovery::capture_workspace_evidence(&original, "Project")
                .expect("capture original evidence");
        let pool = resume_race_pool("app_restart", "interrupted", &original).await;
        let session_dir = fixture.join("sessions");
        let session_file = write_test_native_session(&session_dir, "session-a", &original);
        sqlx::query("UPDATE agent_runs SET session_file = ? WHERE run_id = 'turn-1'")
            .bind(session_file.to_string_lossy().to_string())
            .execute(&pool)
            .await
            .expect("move resume compatibility native session outside stale Project root");
        sqlx::query(
            r#"
            INSERT INTO task_workspace_binding_history (
              binding_id, company_id, project_id, thread_id, turn_id, request_id,
              access, canonical_root, root_identity_json,
              workspace_basename_normalized, project_name_normalized,
              workspace_anchor, git_origin_digest,
              recovery_witness_binding_id, recovery_witness_authority_project_id,
              authority_snapshot_canonical_root,
              authority_snapshot_root_identity_json,
              authority_snapshot_updated_at_unix_ms,
              source, confidence, reason_code, issued_at_unix_ms,
              expires_at_unix_ms, activated_at_unix_ms, last_used_at_unix_ms,
              status, resumed_from_binding_id
            ) VALUES (
              'witness-1', 'company-1', 'project-1', 'thread-1', 'witness-turn',
              'witness-request', 'write', ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 1000,
              'project_catalog', 1.0, 'current_project_folder', 0, 1, 0, 0,
              'completed', NULL
            )
            "#,
        )
        .bind(&original_text)
        .bind(&original_recovery_identity)
        .bind(&original_evidence.basename_normalized)
        .bind(&original_evidence.project_name_normalized)
        .bind(&original_evidence.anchor)
        .bind(&original_evidence.git_origin_digest)
        .bind(&original_text)
        .bind(&authority_identity)
        .execute(&pool)
        .await
        .expect("insert successful recovery witness");

        std::fs::remove_dir_all(&original).expect("remove stale Project catalog root");
        let recovered = fixture.join("Project");
        std::fs::create_dir_all(&recovered).expect("create repository-matched recovery root");
        write_origin(&recovered, "git@example.com:org/repo.git");
        let recovered = recovered.canonicalize().expect("canonical recovered root");
        let recovered_text = canonical_root_text(&recovered).expect("recovered root text");
        let recovered_metadata = recovered
            .metadata()
            .expect("inspect recovered root identity");
        let recovered_identity = serde_json::json!({
            "canonicalRoot": &recovered_text,
            "device": recovered_metadata.dev(),
            "inode": recovered_metadata.ino(),
        })
        .to_string();
        let recovered_evidence =
            crate::workspace_recovery::capture_workspace_evidence(&recovered, "Project")
                .expect("capture recovered evidence");

        let resolution = crate::workspace_recovery::resolve_workspace_root_from_pool(
            &pool,
            crate::workspace_recovery::WorkspaceRecoveryScope {
                company_id: "company-1",
                project_id: "project-1",
                thread_id: "thread-1",
            },
        )
        .await
        .expect("resolve first repository recovery");
        let crate::workspace_recovery::WorkspaceRootResolution::Bound(resolved) = resolution else {
            panic!("repository-matched recovery should resolve before issuance");
        };
        assert_eq!(
            resolved.reason_code,
            WorkspaceRecoveryReason::UniqueNameRepoIdentityMatch
        );
        write_origin(&recovered, "git@example.com:other/repository.git");
        let registry = TaskWorkspaceBindingRegistry::default();
        match publish_resolved_task_workspace_binding(
            &pool,
            &registry,
            IssueTaskWorkspaceBinding {
                company_id: "company-1",
                project_id: "project-1",
                thread_id: "thread-1",
                turn_id: "fresh-turn",
                request_id: "fresh-request",
                access: TaskWorkspaceAccess::Write,
            },
            *resolved,
            None,
        )
        .await
        {
            Err(HostError::Request(message)) => assert_eq!(
                message,
                "Recovered Project repository identity changed before binding issuance."
            ),
            Err(error) => panic!("unexpected repository recheck error: {error:?}"),
            Ok(_) => panic!("changed repository identity must not publish a capability"),
        }
        let rejected_publish_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM task_workspace_binding_history WHERE request_id = 'fresh-request'",
        )
        .fetch_one(&pool)
        .await
        .expect("inspect rejected repository capability publication");
        assert_eq!(rejected_publish_count, 0);
        write_origin(&recovered, "git@example.com:org/repo.git");

        sqlx::query(
            r#"
            UPDATE task_workspace_binding_history
            SET canonical_root = ?, root_identity_json = ?,
                workspace_basename_normalized = ?, project_name_normalized = ?,
                workspace_anchor = ?, git_origin_digest = ?,
                recovery_witness_binding_id = 'witness-1',
                source = 'known_root_recovery', confidence = 0.95,
                reason_code = 'unique_name_repo_identity_match'
            WHERE binding_id = 'history-1'
            "#,
        )
        .bind(&recovered_text)
        .bind(&recovered_identity)
        .bind(&recovered_evidence.basename_normalized)
        .bind(&recovered_evidence.project_name_normalized)
        .bind(&recovered_evidence.anchor)
        .bind(&recovered_evidence.git_origin_digest)
        .execute(&pool)
        .await
        .expect("project interrupted history onto recovered root");
        let runtime_context_json: String = sqlx::query_scalar(
            "SELECT runtime_context_json FROM agent_runs WHERE run_id = 'turn-1'",
        )
        .fetch_one(&pool)
        .await
        .expect("read recovered resume runtime context");
        let mut runtime_context: serde_json::Value = serde_json::from_str(&runtime_context_json)
            .expect("decode recovered resume runtime context");
        runtime_context["workspaceBinding"]["source"] = serde_json::json!("known_root_recovery");
        runtime_context["workspaceBinding"]["reasonCode"] =
            serde_json::json!("unique_name_repo_identity_match");
        sqlx::query(
            "UPDATE agent_runs SET runtime_context_json = ?, session_file = ? WHERE run_id = 'turn-1'",
        )
        .bind(runtime_context.to_string())
        .bind(session_file.to_string_lossy().to_string())
        .execute(&pool)
        .await
        .expect("project recovered resume runtime context");

        write_origin(&recovered, "git@example.com:other/repository.git");

        sqlx::query(
            "ALTER TABLE task_workspace_lease_history RENAME TO task_workspace_lease_history_unavailable",
        )
        .execute(&pool)
        .await
        .expect("simulate transient durable-authority storage failure");
        let transient_failure = match task_workspace_resume_compatibility_from_pool(
            &pool,
            &session_dir,
            "history-1",
            "company-1",
            "project-1",
            "thread-1",
            "turn-1",
            TaskWorkspaceAccess::Write,
        )
        .await
        {
            Ok(_) => panic!("transient storage failure must not be cached as incompatible"),
            Err(error) => error,
        };
        assert!(transient_failure.contains("Check recovered workspace ownership"));
        sqlx::query(
            "ALTER TABLE task_workspace_lease_history_unavailable RENAME TO task_workspace_lease_history",
        )
        .execute(&pool)
        .await
        .expect("restore durable-authority storage for retry");

        let resumed = crate::workspace_recovery::resolve_resumed_workspace_root_from_pool(
            &pool,
            crate::workspace_recovery::WorkspaceRecoveryScope {
                company_id: "company-1",
                project_id: "project-1",
                thread_id: "thread-1",
            },
            "history-1",
            "turn-1",
            "write",
        )
        .await
        .unwrap_or_else(|error| {
            panic!(
                "signed repository recovery must remain resumable after remote change: {}",
                error.into_message()
            )
        });
        resumed
            .verify_live()
            .expect("resume issuance depends on durable root identity, not the later remote");

        let compatibility = task_workspace_resume_compatibility_from_pool(
            &pool,
            &session_dir,
            "history-1",
            "company-1",
            "project-1",
            "thread-1",
            "turn-1",
            TaskWorkspaceAccess::Write,
        )
        .await
        .expect("preflight recovered workspace history");
        let projection =
            serde_json::to_value(compatibility).expect("serialize compatibility projection");
        assert_eq!(projection["status"], "same");
        assert_eq!(projection["reason"], "workspace_history_durable_match");
        assert!(projection.get("root").is_none());
        assert!(projection.get("workspaceRoot").is_none());
        let projection_text = projection.to_string();
        assert!(!projection_text.contains(&original_text));
        assert!(!projection_text.contains(&recovered_text));

        let wrong_access = task_workspace_resume_compatibility_from_pool(
            &pool,
            &session_dir,
            "history-1",
            "company-1",
            "project-1",
            "thread-1",
            "turn-1",
            TaskWorkspaceAccess::Read,
        )
        .await
        .expect("preflight mismatched access");
        let wrong_access = serde_json::to_value(wrong_access).expect("serialize access mismatch");
        assert_eq!(wrong_access["status"], "changed");
        assert_eq!(wrong_access["reason"], "workspace_scope_changed");

        std::fs::remove_dir_all(fixture).expect("remove resume compatibility fixture");
    }

    #[test]
    fn active_workspace_history_cannot_be_resumed_or_preflighted() {
        assert!(resume_history_is_recoverable(
            "app_restart",
            Some("interrupted")
        ));
        assert!(!resume_history_is_recoverable(
            "active",
            Some("interrupted")
        ));
        assert!(!resume_history_is_recoverable(
            "completed",
            Some("interrupted")
        ));
        assert!(!resume_history_is_recoverable(
            "app_restart",
            Some("running")
        ));
        assert!(!resume_history_is_recoverable("app_restart", None));
    }

    #[tokio::test]
    async fn resume_and_discard_are_atomic_and_mutually_exclusive() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create resume race fixture root");
        let root = root.canonicalize().expect("canonical resume race root");
        let mut resumed_binding = fixture_binding(&root, TaskWorkspaceAccess::Write);
        resumed_binding.binding_id = "resumed-binding".into();
        resumed_binding.request_id = "resumed-request".into();
        resumed_binding.source = WorkspaceRecoverySource::ResumeHistory;
        resumed_binding.reason_code = WorkspaceRecoveryReason::ResumeHistoryIdentityMatch;
        let root_text = canonical_root_text(&root).expect("resume root text");
        let identity_json =
            serde_json::to_string(&resumed_binding.root_identity).expect("encode resume identity");
        let resume_expectation = ResumeBindingExpectation {
            history_id: "history-1".into(),
            session_dir: root.clone(),
        };

        let resume_first = resume_race_pool("app_restart", "interrupted", &root).await;
        assert_eq!(
            record_task_workspace_binding_from_pool(
                &resume_first,
                &resumed_binding,
                &root_text,
                &identity_json,
                2_000,
                Some(&resume_expectation),
            )
            .await
            .expect("resume wins race")
            .rows,
            1
        );
        assert_eq!(
            cancel_interrupted_run_from_pool(
                &resume_first,
                Some("history-1"),
                "company-1",
                "project-1",
                "thread-1",
                "turn-1",
            )
            .await
            .expect("discard loses after resume"),
            0
        );

        let discard_first = resume_race_pool("app_restart", "interrupted", &root).await;
        assert_eq!(
            cancel_interrupted_run_from_pool(
                &discard_first,
                Some("history-1"),
                "company-1",
                "project-1",
                "thread-1",
                "turn-1",
            )
            .await
            .expect("discard wins race"),
            1
        );
        let mut late_binding = resumed_binding.clone();
        late_binding.binding_id = "late-resume-binding".into();
        late_binding.request_id = "late-resume-request".into();
        let late_resume_error = record_task_workspace_binding_from_pool(
            &discard_first,
            &late_binding,
            &root_text,
            &identity_json,
            2_001,
            Some(&resume_expectation),
        )
        .await
        .expect_err("late resume condition is evaluated atomically");
        assert!(matches!(
            late_resume_error,
            HostError::ResumePrestart {
                code: "resume-prestart-conflict",
                ..
            }
        ));

        let active_history = resume_race_pool("active", "interrupted", &root).await;
        let mut active_binding = resumed_binding;
        active_binding.binding_id = "active-history-resume".into();
        active_binding.request_id = "active-history-request".into();
        let active_history_error = record_task_workspace_binding_from_pool(
            &active_history,
            &active_binding,
            &root_text,
            &identity_json,
            2_002,
            Some(&resume_expectation),
        )
        .await
        .expect_err("active history is rejected by conditional insert");
        assert!(matches!(
            active_history_error,
            HostError::ResumePrestart {
                code: "resume-prestart-conflict",
                ..
            }
        ));

        std::fs::remove_dir_all(root).expect("remove resume race fixture root");
    }

    #[tokio::test]
    async fn same_workspace_reselection_preserves_active_authority_snapshot() {
        let fixture =
            std::env::temp_dir().join(format!("offisim-workspace-reselection-{}", random_id()));
        let root_a = fixture.join("project-a");
        let root_b = fixture.join("project-b");
        std::fs::create_dir_all(&root_a).expect("create original Project folder");
        std::fs::create_dir_all(&root_b).expect("create changed Project folder");
        let root_a = root_a
            .canonicalize()
            .expect("canonical original Project folder");
        let root_b = root_b
            .canonicalize()
            .expect("canonical changed Project folder");
        let root_a_text = canonical_root_text(&root_a).expect("original Project root text");
        let root_a_identity = root_identity(&root_a).expect("original Project identity");
        let root_a_identity_json =
            serde_json::to_string(&root_a_identity).expect("encode original Project identity");

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open Project reselection db");
        sqlx::raw_sql(include_str!("../../../../packages/db-local/src/schema.sql"))
            .execute(&pool)
            .await
            .expect("apply Project reselection schema");
        for statement in [
            "INSERT INTO companies (company_id, name, created_at, updated_at) VALUES ('company-1', 'Company', 'now', 'now')",
            "INSERT INTO projects (project_id, company_id, name, status, workspace_root, verify_max_attempts, created_at, updated_at) VALUES ('project-1', 'company-1', 'Project', 'active', ?, 3, 'now', 'now')",
            "INSERT INTO project_workspace_authority (project_id, company_id, canonical_root, root_identity_json, selected_at_unix_ms, updated_at_unix_ms) VALUES ('project-1', 'company-1', ?, ?, 1000, 1000)",
            "INSERT INTO chat_threads (thread_id, project_id, title, created_at, updated_at) VALUES ('thread-1', 'project-1', 'Thread', 'now', 'now')",
        ] {
            let mut query = sqlx::query(statement);
            if statement.contains("projects (") {
                query = query.bind(&root_a_text);
            } else if statement.contains("project_workspace_authority") {
                query = query.bind(&root_a_text).bind(&root_a_identity_json);
            }
            query
                .execute(&pool)
                .await
                .expect("seed Project reselection fixture");
        }

        let registry = TaskWorkspaceBindingRegistry::default();
        let binding = fixture_binding(&root_a, TaskWorkspaceAccess::Write);
        assert_eq!(
            publish_task_workspace_binding_from_pool(
                &pool,
                &registry,
                &binding,
                &root_a_text,
                &root_a_identity_json,
                1_500,
                None,
            )
            .await
            .expect("publish active Project binding")
            .rows,
            1
        );

        let same_selection = ProjectWorkspaceSelection {
            canonical_root: root_a.clone(),
            root_identity: root_a_identity.clone(),
            window_label: "main".into(),
            expires_at_unix_ms: 10_000,
        };
        let same_plan = plan_project_workspace_update(
            Some(&same_selection),
            root_a_text.clone(),
            &root_a_text,
            &root_a_identity_json,
        )
        .expect("plan same-folder reselection");
        assert!(!same_plan.authority_changed);
        let mut same_tx = pool.begin().await.expect("begin same-folder reselection");
        guard_project_workspace_authority_change(&mut same_tx, "project-1", &same_plan)
            .await
            .expect("same authority bypasses active-work guard");
        persist_project_workspace_authority_change(
            &mut same_tx,
            "project-1",
            "company-1",
            &same_plan,
            2_000,
        )
        .await
        .expect("same authority is a persistence no-op");
        same_tx
            .commit()
            .await
            .expect("commit same-folder reselection");

        let authority_timestamp: i64 = sqlx::query_scalar(
            "SELECT updated_at_unix_ms FROM project_workspace_authority WHERE project_id = 'project-1'",
        )
        .fetch_one(&pool)
        .await
        .expect("read unchanged authority timestamp");
        assert_eq!(authority_timestamp, 1_000);
        let live_snapshot_count: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM task_workspace_binding_history AS history
            JOIN project_workspace_authority AS authority
              ON authority.project_id = history.project_id
             AND authority.canonical_root = history.authority_snapshot_canonical_root
             AND authority.root_identity_json = history.authority_snapshot_root_identity_json
             AND authority.updated_at_unix_ms = history.authority_snapshot_updated_at_unix_ms
            WHERE history.binding_id = ? AND history.status = 'active'
            "#,
        )
        .bind(&binding.binding_id)
        .fetch_one(&pool)
        .await
        .expect("verify active binding authority snapshot");
        assert_eq!(live_snapshot_count, 1);
        assert!(
            registry
                .validate_authority_at(
                    &binding.binding_ref,
                    &scope(TaskWorkspaceAccess::Write),
                    2_001,
                )
                .is_ok(),
            "same-folder reselection preserves the live capability"
        );

        let changed_root_selection = ProjectWorkspaceSelection {
            canonical_root: root_b.clone(),
            root_identity: root_identity(&root_b).expect("changed Project identity"),
            window_label: "main".into(),
            expires_at_unix_ms: 10_000,
        };
        let changed_root_plan = plan_project_workspace_update(
            Some(&changed_root_selection),
            root_a_text.clone(),
            &root_a_text,
            &root_a_identity_json,
        )
        .expect("plan changed-folder selection");
        assert!(changed_root_plan.authority_changed);
        let mut changed_root_tx = pool.begin().await.expect("begin changed-folder selection");
        let changed_root_error = guard_project_workspace_authority_change(
            &mut changed_root_tx,
            "project-1",
            &changed_root_plan,
        )
        .await
        .expect_err("active task blocks a real folder change");
        assert!(changed_root_error.contains("Stop active tasks"));
        changed_root_tx
            .rollback()
            .await
            .expect("rollback changed-folder selection");

        let mut replaced_identity = root_a_identity;
        #[cfg(unix)]
        {
            replaced_identity.inode = replaced_identity.inode.saturating_add(1);
        }
        #[cfg(not(unix))]
        {
            replaced_identity.canonical_root.push_str("-replaced");
        }
        let changed_identity_selection = ProjectWorkspaceSelection {
            canonical_root: root_a.clone(),
            root_identity: replaced_identity,
            window_label: "main".into(),
            expires_at_unix_ms: 10_000,
        };
        let changed_identity_plan = plan_project_workspace_update(
            Some(&changed_identity_selection),
            root_a_text,
            &binding.authority_snapshot_canonical_root,
            &root_a_identity_json,
        )
        .expect("plan changed-identity selection");
        assert!(changed_identity_plan.authority_changed);
        let mut changed_identity_tx = pool.begin().await.expect("begin changed identity");
        let changed_identity_error = guard_project_workspace_authority_change(
            &mut changed_identity_tx,
            "project-1",
            &changed_identity_plan,
        )
        .await
        .expect_err("active task blocks a real identity change");
        assert!(changed_identity_error.contains("Stop active tasks"));
        changed_identity_tx
            .rollback()
            .await
            .expect("rollback changed identity");

        pool.close().await;
        std::fs::remove_dir_all(fixture).expect("remove Project reselection fixture");
    }

    #[tokio::test]
    async fn authority_snapshot_cas_rejects_reselection_after_resolver_barrier() {
        let fixture = std::env::temp_dir().join(format!("offisim-binding-cas-{}", random_id()));
        let root_a = fixture.join("project-a");
        let root_b = fixture.join("project-b");
        std::fs::create_dir_all(&root_a).expect("create authority A");
        std::fs::create_dir_all(&root_b).expect("create authority B");
        let root_a = root_a.canonicalize().expect("canonical authority A");
        let root_b = root_b.canonicalize().expect("canonical authority B");

        let pool = resume_race_pool("completed", "completed", &root_a).await;
        let mut stale = fixture_binding(&root_a, TaskWorkspaceAccess::Write);
        stale.binding_id = "stale-authority-binding".into();
        stale.request_id = "stale-authority-request".into();
        let stale_root_text = canonical_root_text(&root_a).expect("authority A text");
        let stale_identity_json =
            serde_json::to_string(&stale.root_identity).expect("authority A identity");

        let root_b_text = canonical_root_text(&root_b).expect("authority B text");
        let root_b_identity = root_identity(&root_b).expect("authority B identity");
        let root_b_identity_json =
            serde_json::to_string(&root_b_identity).expect("authority B identity json");
        let mut reselection = pool.begin().await.expect("begin authority reselection");
        sqlx::query("UPDATE projects SET workspace_root = ? WHERE project_id = 'project-1'")
            .bind(&root_b_text)
            .execute(&mut *reselection)
            .await
            .expect("move Project catalog to B");
        sqlx::query(
            "UPDATE project_workspace_authority SET canonical_root = ?, root_identity_json = ?, updated_at_unix_ms = 2000 WHERE project_id = 'project-1'",
        )
        .bind(&root_b_text)
        .bind(&root_b_identity_json)
        .execute(&mut *reselection)
        .await
        .expect("move protected authority to B");
        reselection
            .commit()
            .await
            .expect("commit authority reselection");

        assert_eq!(
            record_task_workspace_binding_from_pool(
                &pool,
                &stale,
                &stale_root_text,
                &stale_identity_json,
                2_000,
                None,
            )
            .await
            .expect("stale authority CAS is a zero-row retry signal")
            .rows,
            0
        );
        let stale_rows: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM task_workspace_binding_history WHERE binding_id = ?",
        )
        .bind(&stale.binding_id)
        .fetch_one(&pool)
        .await
        .expect("count stale authority history");
        assert_eq!(
            stale_rows, 0,
            "stale resolver must leave no durable history"
        );

        let mut current = fixture_binding(&root_b, TaskWorkspaceAccess::Write);
        current.binding_id = "current-authority-binding".into();
        current.request_id = "current-authority-request".into();
        current.authority_snapshot_updated_at_unix_ms = 2_000;
        assert_eq!(
            record_task_workspace_binding_from_pool(
                &pool,
                &current,
                &root_b_text,
                &root_b_identity_json,
                2_001,
                None,
            )
            .await
            .expect("fresh resolver snapshot records")
            .rows,
            1
        );

        std::fs::remove_dir_all(fixture).expect("remove authority CAS fixture");
    }

    #[tokio::test]
    async fn unpublished_registry_binding_is_compensated_for_normal_and_resume_db_failures() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create publish compensation root");
        let root = root
            .canonicalize()
            .expect("canonical publish compensation root");
        let root_text = canonical_root_text(&root).expect("publish compensation root text");

        let normal_pool = resume_race_pool("app_restart", "interrupted", &root).await;
        let normal_registry = TaskWorkspaceBindingRegistry::default();
        let mut normal = fixture_binding(&root, TaskWorkspaceAccess::Write);
        normal.binding_id = "normal-collision-binding".into();
        normal.request_id = "original-request".into();
        let identity_json =
            serde_json::to_string(&normal.root_identity).expect("encode normal identity");
        assert!(publish_task_workspace_binding_from_pool(
            &normal_pool,
            &normal_registry,
            &normal,
            &root_text,
            &identity_json,
            2_000,
            None,
        )
        .await
        .is_err());
        assert!(
            !normal_registry
                .active
                .lock()
                .expect("normal registry lock")
                .contains_key(&normal.binding_ref),
            "normal DB failure left an unpublished in-memory capability"
        );
        let ghost_rows: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM task_workspace_binding_history WHERE binding_id = ?",
        )
        .bind(&normal.binding_id)
        .fetch_one(&normal_pool)
        .await
        .expect("count normal ghost history");
        assert_eq!(ghost_rows, 0);

        let poisoned_pool = resume_race_pool("app_restart", "interrupted", &root).await;
        let poisoned_registry = TaskWorkspaceBindingRegistry::default();
        let poison_result = std::panic::catch_unwind(|| {
            let _guard = poisoned_registry.active.lock().expect("lock before poison");
            panic!("poison registry fixture");
        });
        assert!(poison_result.is_err());
        let mut never_recorded = fixture_binding(&root, TaskWorkspaceAccess::Write);
        never_recorded.binding_id = "registry-insert-failed".into();
        never_recorded.request_id = "registry-insert-request".into();
        let never_recorded_identity = serde_json::to_string(&never_recorded.root_identity)
            .expect("encode failed-registry identity");
        assert!(publish_task_workspace_binding_from_pool(
            &poisoned_pool,
            &poisoned_registry,
            &never_recorded,
            &root_text,
            &never_recorded_identity,
            2_000,
            None,
        )
        .await
        .is_err());
        let never_recorded_rows: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM task_workspace_binding_history WHERE binding_id = ?",
        )
        .bind(&never_recorded.binding_id)
        .fetch_one(&poisoned_pool)
        .await
        .expect("count history after registry insertion failure");
        assert_eq!(
            never_recorded_rows, 0,
            "registry failure must precede DB INSERT"
        );

        let resume_pool = resume_race_pool("active", "interrupted", &root).await;
        let resume_registry = TaskWorkspaceBindingRegistry::default();
        let mut resumed = fixture_binding(&root, TaskWorkspaceAccess::Write);
        resumed.binding_id = "resume-condition-lost".into();
        resumed.request_id = "resume-condition-request".into();
        resumed.source = WorkspaceRecoverySource::ResumeHistory;
        resumed.reason_code = WorkspaceRecoveryReason::ResumeHistoryIdentityMatch;
        let resumed_identity_json =
            serde_json::to_string(&resumed.root_identity).expect("encode resume identity");
        let resume_expectation = ResumeBindingExpectation {
            history_id: "history-1".into(),
            session_dir: root.clone(),
        };
        let resume_condition_error = publish_task_workspace_binding_from_pool(
            &resume_pool,
            &resume_registry,
            &resumed,
            &root_text,
            &resumed_identity_json,
            2_001,
            Some(&resume_expectation),
        )
        .await
        .expect_err("lost resume condition is a stable prestart conflict");
        assert!(matches!(
            resume_condition_error,
            HostError::ResumePrestart {
                code: "resume-prestart-conflict",
                ..
            }
        ));
        assert!(
            !resume_registry
                .active
                .lock()
                .expect("resume registry lock")
                .contains_key(&resumed.binding_ref),
            "resume row-zero left an unpublished in-memory capability"
        );
        let resume_ghost_rows: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM task_workspace_binding_history WHERE binding_id = ?",
        )
        .bind(&resumed.binding_id)
        .fetch_one(&resume_pool)
        .await
        .expect("count resume ghost history");
        assert_eq!(resume_ghost_rows, 0);

        std::fs::remove_dir_all(root).expect("remove publish compensation root");
    }

    #[tokio::test]
    async fn interrupted_discard_without_projection_is_safe_but_fail_closed_for_live_writers() {
        let fixture =
            std::env::temp_dir().join(format!("offisim-interrupted-discard-{}", random_id()));
        std::fs::create_dir_all(&fixture).expect("create interrupted discard fixture root");
        let authority_root = fixture
            .canonicalize()
            .expect("canonical interrupted discard fixture root");
        let history_exists = resume_race_pool("app_restart", "interrupted", &authority_root).await;
        assert_eq!(
            cancel_interrupted_run_from_pool(
                &history_exists,
                None,
                "company-1",
                "project-1",
                "thread-1",
                "turn-1",
            )
            .await
            .expect("backend discovers matching recovery history"),
            1
        );

        let history_missing = resume_race_pool("app_restart", "interrupted", &authority_root).await;
        sqlx::query("DELETE FROM task_workspace_binding_history")
            .execute(&history_missing)
            .await
            .expect("remove corrupt/missing projection history fixture");
        assert_eq!(
            cancel_interrupted_run_from_pool(
                &history_missing,
                None,
                "company-1",
                "project-1",
                "thread-1",
                "turn-1",
            )
            .await
            .expect("missing history is safe when no writer exists"),
            1
        );

        let wrong_supplied_history =
            resume_race_pool("app_restart", "interrupted", &authority_root).await;
        assert_eq!(
            cancel_interrupted_run_from_pool(
                &wrong_supplied_history,
                Some("forged-history"),
                "company-1",
                "project-1",
                "thread-1",
                "turn-1",
            )
            .await
            .expect("supplied history is checked strictly"),
            0
        );

        let active_binding = resume_race_pool("active", "interrupted", &authority_root).await;
        assert_eq!(
            cancel_interrupted_run_from_pool(
                &active_binding,
                None,
                "company-1",
                "project-1",
                "thread-1",
                "turn-1",
            )
            .await
            .expect("active writer is checked atomically"),
            0
        );

        let active_lease = resume_race_pool("app_restart", "interrupted", &authority_root).await;
        sqlx::query(
            "INSERT INTO task_workspace_lease_history (lease_id, project_id, created_root_run_id, status) VALUES ('lease-1', 'project-1', 'turn-1', 'active')",
        )
        .execute(&active_lease)
        .await
        .expect("seed retained workspace lease");
        assert_eq!(
            cancel_interrupted_run_from_pool(
                &active_lease,
                None,
                "company-1",
                "project-1",
                "thread-1",
                "turn-1",
            )
            .await
            .expect("retained lease is checked atomically"),
            0
        );

        let running_again = resume_race_pool("app_restart", "running", &authority_root).await;
        assert_eq!(
            cancel_interrupted_run_from_pool(
                &running_again,
                None,
                "company-1",
                "project-1",
                "thread-1",
                "turn-1",
            )
            .await
            .expect("running root is not discarded"),
            0
        );

        std::fs::remove_dir_all(fixture).expect("remove interrupted discard fixture root");
    }

    #[tokio::test]
    async fn deletion_preflight_reports_active_bindings_and_retained_leases_by_exact_scope() {
        let pool = deletion_preflight_pool().await;
        let empty = task_workspace_deletion_preflight_from_pool(
            &pool,
            TaskWorkspaceDeletionScope::Conversation,
            "company-1",
            Some("project-1"),
            Some("thread-1"),
        )
        .await
        .expect("empty exact Conversation scope");
        assert!(empty.allowed);
        assert_eq!(empty.active_bindings, 0);
        assert_eq!(empty.active_leases, 0);

        sqlx::query(
            "INSERT INTO task_workspace_binding_history (binding_id, company_id, project_id, thread_id, status) VALUES ('binding-1', 'company-1', 'project-1', 'thread-1', 'active')",
        )
        .execute(&pool)
        .await
        .expect("seed active binding");
        let active = task_workspace_deletion_preflight_from_pool(
            &pool,
            TaskWorkspaceDeletionScope::Project,
            "company-1",
            Some("project-1"),
            None,
        )
        .await
        .expect("active Project scope");
        assert!(!active.allowed);
        assert_eq!(active.active_bindings, 1);
        assert_eq!(active.active_leases, 0);

        sqlx::query(
            "UPDATE task_workspace_binding_history SET status = 'completed' WHERE binding_id = 'binding-1'",
        )
        .execute(&pool)
        .await
        .expect("finish binding");
        sqlx::query(
            "INSERT INTO task_workspace_lease_history (lease_id, project_id, created_binding_id, active_binding_id, status) VALUES ('lease-1', 'project-1', 'binding-1', 'binding-1', 'active')",
        )
        .execute(&pool)
        .await
        .expect("seed retained lease");
        for scope in [
            TaskWorkspaceDeletionScope::Conversation,
            TaskWorkspaceDeletionScope::Project,
            TaskWorkspaceDeletionScope::Company,
        ] {
            let retained = task_workspace_deletion_preflight_from_pool(
                &pool,
                scope,
                "company-1",
                Some("project-1"),
                Some("thread-1"),
            )
            .await
            .expect("retained lease scope");
            assert!(!retained.allowed);
            assert_eq!(retained.active_bindings, 0);
            assert_eq!(retained.active_leases, 1);
        }

        assert!(task_workspace_deletion_preflight_from_pool(
            &pool,
            TaskWorkspaceDeletionScope::Conversation,
            "company-1",
            Some("project-other"),
            Some("thread-1"),
        )
        .await
        .is_err());
    }

    #[test]
    fn registry_rejects_replaced_root_identity() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let root = root.canonicalize().expect("canonical fixture root");
        let registry = TaskWorkspaceBindingRegistry::default();
        let binding = fixture_binding(&root, TaskWorkspaceAccess::Write);
        registry
            .insert(binding.clone(), 1_000)
            .expect("insert binding");
        std::fs::remove_dir(&root).expect("remove original fixture root");
        std::fs::create_dir(&root).expect("replace fixture root");

        assert!(matches!(
            registry.resolve_at(
                &binding.binding_ref,
                &scope(TaskWorkspaceAccess::Read),
                2_000
            ),
            Err(ResolveBindingError::RootChanged)
        ));
        std::fs::remove_dir(root).expect("remove replacement fixture root");
    }

    #[test]
    fn native_selection_claim_is_window_bound_one_shot_and_expiring() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create fixture root");
        let canonical = crate::local_paths::resolve_project_workspace_root_path(&root)
            .expect("canonicalize specific workspace");
        let registry = ProjectWorkspaceSelectionRegistry::default();
        let wrong_window = registry
            .register("main", canonical.clone(), 1_000)
            .expect("register selected folder");
        assert!(registry
            .consume(&wrong_window.selection_ref, "secondary", 2_000)
            .is_err());
        assert!(registry
            .consume(&wrong_window.selection_ref, "main", 2_000)
            .is_err());

        let one_shot = registry
            .register("main", canonical.clone(), 1_000)
            .expect("register one-shot folder");
        registry
            .consume(&one_shot.selection_ref, "main", 2_000)
            .expect("consume once");
        assert!(registry
            .consume(&one_shot.selection_ref, "main", 2_000)
            .is_err());

        let expired = registry
            .register("main", canonical, 1_000)
            .expect("register expiring folder");
        assert!(registry
            .consume(
                &expired.selection_ref,
                "main",
                1_000 + PROJECT_WORKSPACE_SELECTION_TTL_MS + 1,
            )
            .is_err());
        assert!(crate::local_paths::resolve_project_workspace_root_path("/tmp").is_err());
        assert!(
            crate::local_paths::resolve_project_workspace_root_path(root.join("missing")).is_err()
        );
        std::fs::remove_dir_all(root).expect("remove fixture root");
    }
}
