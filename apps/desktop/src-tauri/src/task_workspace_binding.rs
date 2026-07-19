use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use crate::agent_host_runtime::HostError;
use crate::workspace_recovery::{WorkspaceRecoveryReason, WorkspaceRecoverySource};

use persistence::{host_error_message, reconcile_stale_active_bindings_from_pool};

#[path = "binding/persistence.rs"]
mod persistence;
#[path = "binding/project_crud.rs"]
mod project_crud;
#[path = "binding/registry.rs"]
mod registry;
#[path = "binding/resume_compat.rs"]
mod resume_compat;

#[allow(unused_imports)]
pub(crate) use persistence::resolve_task_workspace_binding;
pub(crate) use persistence::{
    __cmd__task_workspace_evaluation_lease_acquire, __cmd__task_workspace_evaluation_lease_release,
    mark_orphaned_bindings_revoked, replay_workspace_bound_for_request,
    resolve_task_workspace_claim_authority, resolve_task_workspace_evaluation_claim_authority,
    resolve_task_workspace_for_turn, revoke_task_workspace_binding,
    task_workspace_evaluation_lease_acquire, task_workspace_evaluation_lease_release,
    validate_task_workspace_binding_authority, workspace_bound_event,
};
#[cfg(test)]
pub(crate) use project_crud::test_task_workspace_binding;
pub use project_crud::{
    __cmd__project_create, __cmd__project_demo_workspace_prepare, __cmd__project_update,
    __cmd__project_update_status, __cmd__project_workspace_select, project_create,
    project_demo_workspace_prepare, project_update, project_update_status,
    project_workspace_select,
};
pub use resume_compat::{
    __cmd__task_workspace_resume_compatibility, task_workspace_resume_compatibility,
};
pub(crate) use resume_compat::{
    persist_conversation_native_session_reset, resolve_conversation_native_session_for_execute,
    resolve_conversation_opaque_native_session_for_execute, OpaqueNativeSessionExpectation,
    ResettableNativeSessionPrestartCode,
};

const BINDING_TTL_MS: i64 = 24 * 60 * 60 * 1_000;
const EVALUATION_LEASE_TTL_MS: i64 = 2 * 60 * 60 * 1_000;
const REVOKED_READ_GRACE_MS: i64 =
    crate::pi_agent_host::PI_RUN_STREAM_TERMINAL_TTL_SECS as i64 * 1_000;
const PROJECT_WORKSPACE_SELECTION_TTL_MS: i64 = 10 * 60 * 1_000;
const AGENT_RUNTIME_CONTEXT_ID: &str = "agent-runtime";

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
pub(crate) enum NativeSessionReference {
    FileBacked {
        file: PathBuf,
        id: String,
    },
    Opaque {
        engine_id: String,
        account_id: String,
        billing_mode: String,
        id: String,
    },
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
    crate::time_util::try_now_unix_ms().map_err(HostError::HostUnavailable)
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
