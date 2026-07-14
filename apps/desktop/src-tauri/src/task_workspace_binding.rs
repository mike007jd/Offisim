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
    pub(crate) source: String,
    pub(crate) confidence: f64,
    pub(crate) reason_code: String,
    pub(crate) issued_at_unix_ms: i64,
    pub(crate) expires_at_unix_ms: i64,
    pub(crate) project_verify_command: Option<String>,
    pub(crate) project_verify_max_attempts: u32,
    pub(crate) project_verify_token_budget: Option<u64>,
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

fn resume_identity_matches(
    expected_root: &str,
    expected_identity: &RootIdentity,
    expected_access: &str,
    current_root: &str,
    current_identity: &RootIdentity,
    current_access: TaskWorkspaceAccess,
) -> bool {
    expected_root == current_root
        && expected_identity == current_identity
        && expected_access == current_access.as_str()
}

fn resume_history_is_recoverable(binding_status: &str, agent_run_status: Option<&str>) -> bool {
    binding_status == "app_restart" && agent_run_status == Some("interrupted")
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
    let history = sqlx::query(
        r#"
        SELECT h.company_id, h.project_id, h.thread_id, h.turn_id,
               h.canonical_root, h.root_identity_json, h.access,
               h.status AS binding_status, ar.status AS agent_run_status
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
    .fetch_optional(&pool)
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
    let current = sqlx::query(
        r#"
        SELECT p.workspace_root
        FROM chat_threads AS t
        JOIN projects AS p ON p.project_id = t.project_id
        WHERE t.thread_id = ?
          AND t.project_id = ?
          AND p.company_id = ?
          AND p.workspace_root IS NOT NULL
          AND trim(p.workspace_root) <> ''
        "#,
    )
    .bind(thread_id)
    .bind(project_id)
    .bind(company_id)
    .fetch_optional(&pool)
    .await
    .map_err(|error| format!("Read current Project workspace: {error}"))?;
    let Some(current) = current else {
        return Ok(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Changed,
            reason: "project_workspace_missing".into(),
        });
    };
    let raw_current_root: String = current
        .try_get("workspace_root")
        .map_err(|error| format!("Decode current workspace_root: {error}"))?;
    let Ok(current_root) =
        crate::local_paths::resolve_project_workspace_root_path(raw_current_root)
    else {
        return Ok(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Changed,
            reason: "project_workspace_changed".into(),
        });
    };
    let Ok(current_identity) = root_identity(&current_root) else {
        return Ok(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Changed,
            reason: "project_workspace_changed".into(),
        });
    };
    let current_root_text = canonical_root_text(&current_root).map_err(host_error_message)?;
    let expected_root: String = history
        .try_get("canonical_root")
        .map_err(|error| format!("Decode resume canonical_root: {error}"))?;
    let expected_identity_json: String = history
        .try_get("root_identity_json")
        .map_err(|error| format!("Decode resume root_identity_json: {error}"))?;
    let Ok(expected_identity) = serde_json::from_str::<RootIdentity>(&expected_identity_json)
    else {
        return Ok(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Changed,
            reason: "workspace_history_identity_invalid".into(),
        });
    };
    let expected_access: String = history
        .try_get("access")
        .map_err(|error| format!("Decode resume access: {error}"))?;
    if resume_identity_matches(
        &expected_root,
        &expected_identity,
        &expected_access,
        &current_root_text,
        &current_identity,
        access,
    ) {
        Ok(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Same,
            reason: "workspace_identity_match".into(),
        })
    } else {
        Ok(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Changed,
            reason: "workspace_identity_changed".into(),
        })
    }
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

async fn record_task_workspace_binding_from_pool(
    pool: &sqlx::SqlitePool,
    binding: &TaskWorkspaceBinding,
    canonical_root_text: &str,
    root_identity_json: &str,
    now: i64,
    expected_resume_history_id: Option<&str>,
) -> Result<u64, HostError> {
    sqlx::query(
        r#"
        INSERT INTO task_workspace_binding_history (
          binding_id, company_id, project_id, thread_id, turn_id, request_id,
          access, canonical_root, root_identity_json, source, confidence,
          reason_code, issued_at_unix_ms, expires_at_unix_ms,
          activated_at_unix_ms, last_used_at_unix_ms, status,
          resumed_from_binding_id
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?
        WHERE ? IS NULL OR EXISTS (
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
    .bind(&binding.source)
    .bind(binding.confidence)
    .bind(&binding.reason_code)
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
    .execute(pool)
    .await
    .map(|result| result.rows_affected())
    .map_err(|err| {
        if expected_resume_history_id.is_some() {
            HostError::Request(format!(
                "Cannot resume this task: its interrupted workspace history was already claimed or could not be recorded: {err}"
            ))
        } else {
            HostError::Request(format!("Record task workspace binding: {err}"))
        }
    })
}

async fn publish_task_workspace_binding_from_pool(
    pool: &sqlx::SqlitePool,
    registry: &TaskWorkspaceBindingRegistry,
    binding: &TaskWorkspaceBinding,
    canonical_root_text: &str,
    root_identity_json: &str,
    now: i64,
    expected_resume_history_id: Option<&str>,
) -> Result<u64, HostError> {
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
        expected_resume_history_id,
    )
    .await;
    match recorded {
        Ok(1) => Ok(1),
        Ok(rows) => {
            registry.remove_unpublished(&binding.binding_ref)?;
            Ok(rows)
        }
        Err(error) => {
            registry.remove_unpublished(&binding.binding_ref)?;
            Err(error)
        }
    }
}

pub(crate) async fn issue_task_workspace_binding<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    scope: IssueTaskWorkspaceBinding<'_>,
) -> Result<TaskWorkspaceBinding, HostError> {
    issue_task_workspace_binding_inner(app, scope, None).await
}

pub(crate) async fn issue_resumed_task_workspace_binding<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    scope: IssueTaskWorkspaceBinding<'_>,
    expected_history_id: &str,
) -> Result<TaskWorkspaceBinding, HostError> {
    let expected_history_id =
        required_scope_text(expected_history_id, "workspaceBindingHistoryId")?;
    issue_task_workspace_binding_inner(app, scope, Some(expected_history_id)).await
}

async fn issue_task_workspace_binding_inner<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    scope: IssueTaskWorkspaceBinding<'_>,
    expected_resume_history_id: Option<&str>,
) -> Result<TaskWorkspaceBinding, HostError> {
    let company_id = required_scope_text(scope.company_id, "companyId")?;
    let project_id = required_scope_text(scope.project_id, "projectId")?;
    let thread_id = required_scope_text(scope.thread_id, "threadId")?;
    let turn_id = required_scope_text(scope.turn_id, "rootRunId")?;
    let request_id = required_scope_text(scope.request_id, "requestId")?;
    let pool = crate::local_db::get_offisim_pool(app)
        .map_err(|err| HostError::HostUnavailable(format!("Open offisim.db: {err}")))?;
    let row = sqlx::query(
        r#"
        SELECT p.project_id,
               p.company_id,
               p.workspace_root,
               authority.root_identity_json AS authority_root_identity_json,
               p.verify_command,
               p.verify_max_attempts,
               p.verify_token_budget
        FROM chat_threads AS t
        JOIN projects AS p ON p.project_id = t.project_id
        JOIN project_workspace_authority AS authority
          ON authority.project_id = p.project_id
         AND authority.company_id = p.company_id
         AND authority.canonical_root = p.workspace_root
        WHERE t.thread_id = ?
          AND t.project_id = ?
          AND p.company_id = ?
          AND p.workspace_root IS NOT NULL
          AND trim(p.workspace_root) <> ''
        "#,
    )
    .bind(thread_id)
    .bind(project_id)
    .bind(company_id)
    .fetch_optional(&pool)
    .await
    .map_err(|err| HostError::Request(format!("Project workspace lookup failed: {err}")))?
    .ok_or_else(|| {
        HostError::Request(
            "No project workspace matches the trusted company/project/thread scope.".into(),
        )
    })?;

    let raw_root: String = row
        .try_get("workspace_root")
        .map_err(|err| HostError::Request(format!("Decode workspace_root: {err}")))?;
    let canonical_root = crate::local_paths::resolve_project_workspace_root_path(raw_root)
        .map_err(HostError::Request)?;
    let root_identity = root_identity(&canonical_root).map_err(HostError::Request)?;
    let authority_identity_json: String = row
        .try_get("authority_root_identity_json")
        .map_err(|err| HostError::Request(format!("Decode Project workspace authority: {err}")))?;
    let authority_identity: RootIdentity = serde_json::from_str(&authority_identity_json)
        .map_err(|_| HostError::Request("Project workspace authority is invalid.".into()))?;
    if root_identity != authority_identity {
        return Err(HostError::Request(
            "Project workspace identity changed after the folder was selected. Choose the Project folder again."
                .into(),
        ));
    }
    let canonical_root_text = canonical_root_text(&canonical_root)?;
    if let Some(expected_history_id) = expected_resume_history_id {
        let history = sqlx::query(
            r#"
            SELECT h.canonical_root, h.root_identity_json, h.access,
                   h.status AS binding_status, ar.status AS agent_run_status
            FROM task_workspace_binding_history AS h
            LEFT JOIN agent_runs AS ar
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
            "#,
        )
        .bind(expected_history_id)
        .bind(company_id)
        .bind(project_id)
        .bind(thread_id)
        .bind(turn_id)
        .fetch_optional(&pool)
        .await
        .map_err(|err| HostError::Request(format!("Read resume workspace identity: {err}")))?
        .ok_or_else(|| {
            HostError::Request(
                "Cannot resume this task: its original workspace binding history is missing or incompatible."
                    .into(),
            )
        })?;
        let expected_root: String = history
            .try_get("canonical_root")
            .map_err(|err| HostError::Request(format!("Decode resume canonical_root: {err}")))?;
        let expected_identity_json: String =
            history.try_get("root_identity_json").map_err(|err| {
                HostError::Request(format!("Decode resume root_identity_json: {err}"))
            })?;
        let expected_identity: RootIdentity = serde_json::from_str(&expected_identity_json)
            .map_err(|err| HostError::Request(format!("Decode resume root identity: {err}")))?;
        let expected_access: String = history
            .try_get("access")
            .map_err(|err| HostError::Request(format!("Decode resume access: {err}")))?;
        let binding_status: String = history
            .try_get("binding_status")
            .map_err(|err| HostError::Request(format!("Decode resume binding status: {err}")))?;
        let agent_run_status: Option<String> = history
            .try_get("agent_run_status")
            .map_err(|err| HostError::Request(format!("Decode resume Agent run status: {err}")))?;
        if !resume_history_is_recoverable(&binding_status, agent_run_status.as_deref()) {
            return Err(HostError::Request(
                "Cannot resume this task: its previous workspace binding is not an interrupted, recoverable run."
                    .into(),
            ));
        }
        if !resume_identity_matches(
            &expected_root,
            &expected_identity,
            &expected_access,
            &canonical_root_text,
            &root_identity,
            scope.access,
        ) {
            return Err(HostError::Request(
                "Cannot resume this task: the Project folder no longer matches the original workspace identity. Restart from the objective instead."
                    .into(),
            ));
        }
    }
    let now = now_unix_ms()?;
    let binding = TaskWorkspaceBinding {
        binding_ref: random_ref(),
        binding_id: random_id(),
        company_id: company_id.to_string(),
        project_id: project_id.to_string(),
        thread_id: thread_id.to_string(),
        turn_id: turn_id.to_string(),
        request_id: request_id.to_string(),
        access: scope.access,
        canonical_root,
        root_identity,
        source: if expected_resume_history_id.is_some() {
            "resume_history".into()
        } else {
            "project_catalog".into()
        },
        confidence: 1.0,
        reason_code: if expected_resume_history_id.is_some() {
            "resume_history_identity_match".into()
        } else {
            "current_project_folder".into()
        },
        issued_at_unix_ms: now,
        expires_at_unix_ms: now.saturating_add(BINDING_TTL_MS),
        project_verify_command: row
            .try_get("verify_command")
            .map_err(|err| HostError::Request(format!("Decode project verify_command: {err}")))?,
        project_verify_max_attempts: row
            .try_get::<i64, _>("verify_max_attempts")
            .map_err(|err| {
                HostError::Request(format!("Decode project verify_max_attempts: {err}"))
            })?
            .try_into()
            .map_err(|_| HostError::Request("Project verify_max_attempts is invalid.".into()))?,
        project_verify_token_budget: row
            .try_get::<Option<i64>, _>("verify_token_budget")
            .map_err(|err| {
                HostError::Request(format!("Decode project verify_token_budget: {err}"))
            })?
            .map(u64::try_from)
            .transpose()
            .map_err(|_| HostError::Request("Project verify_token_budget is invalid.".into()))?,
    };
    let root_identity_json = serde_json::to_string(&binding.root_identity)
        .map_err(|err| HostError::Request(format!("Encode workspace root identity: {err}")))?;
    let registry = app.state::<TaskWorkspaceBindingRegistry>();
    if publish_task_workspace_binding_from_pool(
        &pool,
        &registry,
        &binding,
        &canonical_root_text,
        &root_identity_json,
        now,
        expected_resume_history_id,
    )
    .await?
        != 1
    {
        return Err(HostError::Request(
            "Cannot resume this task: its interrupted run stopped being recoverable before workspace authority could be issued."
                .into(),
        ));
    }

    Ok(binding)
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
    let touched = sqlx::query(
        r#"
        UPDATE task_workspace_binding_history
        SET last_used_at_unix_ms = ?
        WHERE binding_id = ?
          AND company_id = ? AND project_id = ? AND thread_id = ?
          AND turn_id = ? AND request_id = ?
          AND canonical_root = ? AND root_identity_json = ?
          AND (
            status = 'active'
            OR (? = 'read' AND read_grace_until_unix_ms IS NOT NULL
                AND read_grace_until_unix_ms >= ?)
          )
          AND EXISTS (
            SELECT 1
            FROM chat_threads AS thread
            JOIN projects AS project ON project.project_id = thread.project_id
            JOIN project_workspace_authority AS authority
              ON authority.project_id = project.project_id
             AND authority.company_id = project.company_id
             AND authority.canonical_root = project.workspace_root
            WHERE thread.thread_id = task_workspace_binding_history.thread_id
              AND project.project_id = task_workspace_binding_history.project_id
              AND project.company_id = task_workspace_binding_history.company_id
              AND authority.canonical_root = task_workspace_binding_history.canonical_root
              AND authority.root_identity_json = task_workspace_binding_history.root_identity_json
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
    .bind(scope.access.as_str())
    .bind(now)
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
        source: binding.source.clone(),
        confidence: binding.confidence,
        reason_code: binding.reason_code.clone(),
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
    let current_identity_json: String = current
        .try_get("root_identity_json")
        .map_err(|error| format!("Decode Project folder identity: {error}"))?;
    let next_root = selection
        .as_ref()
        .map(|value| canonical_root_text(&value.canonical_root).map_err(host_error_message))
        .transpose()?
        .unwrap_or(current_root);
    let selected_identity_json = selection
        .as_ref()
        .map(|value| {
            serde_json::to_string(&value.root_identity)
                .map_err(|error| format!("Encode Project workspace identity: {error}"))
        })
        .transpose()?;
    if selection.is_some()
        && (next_root
            != current
                .try_get::<String, _>("canonical_root")
                .map_err(|error| format!("Decode authorized Project folder: {error}"))?
            || selected_identity_json.as_deref() != Some(current_identity_json.as_str()))
    {
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
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| format!("Inspect active Project work: {error}"))?;
        if active != 0 {
            return Err(
                "Stop active tasks and review, release, or discard retained worktrees before changing this Project folder."
                    .into(),
            );
        }
    }
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
    .bind(&next_root)
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
    if selection.is_some() {
        let identity_json = selected_identity_json.ok_or_else(|| {
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
        .bind(next_root)
        .bind(identity_json)
        .bind(now)
        .bind(now)
        .bind(project_id)
        .bind(company_id)
        .execute(&mut *tx)
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
    }
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
        root_identity: root_identity(canonical_root).unwrap_or(RootIdentity {
            canonical_root: canonical_root_text,
            #[cfg(unix)]
            device: 0,
            #[cfg(unix)]
            inode: 0,
        }),
        source: "project_catalog".into(),
        confidence: 1.0,
        reason_code: "current_project_folder".into(),
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

    async fn resume_race_pool(binding_status: &str, agent_status: &str) -> sqlx::SqlitePool {
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
              company_id TEXT NOT NULL,
              project_id TEXT,
              thread_id TEXT NOT NULL,
              status TEXT NOT NULL,
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
              resumed_from_binding_id
            ) VALUES (
              'history-1', 'company-1', 'project-1', 'thread-1', 'turn-1',
              'original-request', 'write', '/fixture', '{}', 'project_catalog',
              1.0, 'current_project_folder', 1, 2, 1, 1, ?, NULL
            )
            "#,
        )
        .bind(binding_status)
        .execute(&pool)
        .await
        .expect("insert original binding history");
        sqlx::query(
            "INSERT INTO agent_runs (run_id, root_run_id, company_id, project_id, thread_id, status) VALUES ('turn-1', 'turn-1', 'company-1', 'project-1', 'thread-1', ?)",
        )
        .bind(agent_status)
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
            root_identity: root_identity(root).expect("fixture root identity"),
            source: "project_catalog".into(),
            confidence: 1.0,
            reason_code: "current_project_folder".into(),
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

    #[test]
    fn resume_compatibility_compares_scope_identity_and_access_without_returning_root() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        let changed = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create original root");
        std::fs::create_dir_all(&changed).expect("create changed root");
        let root = root.canonicalize().expect("canonical original root");
        let changed = changed.canonicalize().expect("canonical changed root");
        let root_text = canonical_root_text(&root).expect("original root text");
        let changed_text = canonical_root_text(&changed).expect("changed root text");
        let identity = root_identity(&root).expect("original identity");
        let changed_identity = root_identity(&changed).expect("changed identity");

        assert!(resume_identity_matches(
            &root_text,
            &identity,
            "write",
            &root_text,
            &identity,
            TaskWorkspaceAccess::Write,
        ));
        assert!(!resume_identity_matches(
            &root_text,
            &identity,
            "write",
            &changed_text,
            &changed_identity,
            TaskWorkspaceAccess::Write,
        ));
        assert!(!resume_identity_matches(
            &root_text,
            &identity,
            "write",
            &root_text,
            &identity,
            TaskWorkspaceAccess::Read,
        ));

        let projection = serde_json::to_value(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Same,
            reason: "workspace_identity_match".into(),
        })
        .expect("serialize compatibility projection");
        assert_eq!(projection["status"], "same");
        assert_eq!(projection["reason"], "workspace_identity_match");
        assert!(projection.get("root").is_none());
        assert!(projection.get("workspaceRoot").is_none());

        std::fs::remove_dir_all(root).expect("remove original root");
        std::fs::remove_dir_all(changed).expect("remove changed root");
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
        resumed_binding.source = "resume_history".into();
        resumed_binding.reason_code = "resume_history_identity_match".into();
        let root_text = canonical_root_text(&root).expect("resume root text");
        let identity_json =
            serde_json::to_string(&resumed_binding.root_identity).expect("encode resume identity");

        let resume_first = resume_race_pool("app_restart", "interrupted").await;
        assert_eq!(
            record_task_workspace_binding_from_pool(
                &resume_first,
                &resumed_binding,
                &root_text,
                &identity_json,
                2_000,
                Some("history-1"),
            )
            .await
            .expect("resume wins race"),
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

        let discard_first = resume_race_pool("app_restart", "interrupted").await;
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
        assert_eq!(
            record_task_workspace_binding_from_pool(
                &discard_first,
                &late_binding,
                &root_text,
                &identity_json,
                2_001,
                Some("history-1"),
            )
            .await
            .expect("late resume condition is evaluated atomically"),
            0
        );

        let active_history = resume_race_pool("active", "interrupted").await;
        let mut active_binding = resumed_binding;
        active_binding.binding_id = "active-history-resume".into();
        active_binding.request_id = "active-history-request".into();
        assert_eq!(
            record_task_workspace_binding_from_pool(
                &active_history,
                &active_binding,
                &root_text,
                &identity_json,
                2_002,
                Some("history-1"),
            )
            .await
            .expect("active history is rejected by conditional insert"),
            0
        );

        std::fs::remove_dir_all(root).expect("remove resume race fixture root");
    }

    #[tokio::test]
    async fn unpublished_registry_binding_is_compensated_for_normal_and_resume_db_failures() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create publish compensation root");
        let root = root
            .canonicalize()
            .expect("canonical publish compensation root");
        let root_text = canonical_root_text(&root).expect("publish compensation root text");

        let normal_pool = resume_race_pool("app_restart", "interrupted").await;
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

        let poisoned_pool = resume_race_pool("app_restart", "interrupted").await;
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

        let resume_pool = resume_race_pool("active", "interrupted").await;
        let resume_registry = TaskWorkspaceBindingRegistry::default();
        let mut resumed = fixture_binding(&root, TaskWorkspaceAccess::Write);
        resumed.binding_id = "resume-condition-lost".into();
        resumed.request_id = "resume-condition-request".into();
        resumed.source = "resume_history".into();
        resumed.reason_code = "resume_history_identity_match".into();
        let resumed_identity_json =
            serde_json::to_string(&resumed.root_identity).expect("encode resume identity");
        assert_eq!(
            publish_task_workspace_binding_from_pool(
                &resume_pool,
                &resume_registry,
                &resumed,
                &root_text,
                &resumed_identity_json,
                2_001,
                Some("history-1"),
            )
            .await
            .expect("lost resume condition is not a DB error"),
            0
        );
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
        let history_exists = resume_race_pool("app_restart", "interrupted").await;
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

        let history_missing = resume_race_pool("app_restart", "interrupted").await;
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

        let wrong_supplied_history = resume_race_pool("app_restart", "interrupted").await;
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

        let active_binding = resume_race_pool("active", "interrupted").await;
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

        let active_lease = resume_race_pool("app_restart", "interrupted").await;
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

        let running_again = resume_race_pool("app_restart", "running").await;
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
