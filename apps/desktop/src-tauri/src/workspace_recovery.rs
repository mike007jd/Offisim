use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use unicode_normalization::UnicodeNormalization;
use url::Url;

const MAX_WITNESSES: i64 = 64;
const MAX_KNOWN_ANCHOR_ROWS: usize = 256;
const MAX_SCANNED_DIRECTORY_ENTRIES: usize = 1_024;
const MAX_GIT_CONFIG_OUTPUT_BYTES: usize = 1_048_576;
const GIT_CONFIG_SINGLE_PROBE_TIMEOUT: Duration = Duration::from_millis(500);
const GIT_CONFIG_SCAN_BUDGET: Duration = Duration::from_secs(1);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WorkspaceRecoverySource {
    ProjectCatalog,
    ConversationHistory,
    KnownRootRecovery,
    ResumeHistory,
    WorkspaceRecovery,
}

impl WorkspaceRecoverySource {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::ProjectCatalog => "project_catalog",
            Self::ConversationHistory => "conversation_history",
            Self::KnownRootRecovery => "known_root_recovery",
            Self::ResumeHistory => "resume_history",
            Self::WorkspaceRecovery => "workspace_recovery",
        }
    }
}

impl TryFrom<&str> for WorkspaceRecoverySource {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "project_catalog" => Ok(Self::ProjectCatalog),
            "conversation_history" => Ok(Self::ConversationHistory),
            "known_root_recovery" => Ok(Self::KnownRootRecovery),
            "resume_history" => Ok(Self::ResumeHistory),
            "workspace_recovery" => Ok(Self::WorkspaceRecovery),
            _ => Err(format!("Unsupported workspace recovery source: {value}")),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WorkspaceRecoveryReason {
    CurrentProjectFolder,
    RecentSuccessfulWorkspace,
    RenamedSameFilesystemObject,
    UniqueNameRepoIdentityMatch,
    ResumeHistoryIdentityMatch,
    None,
    Ambiguous,
}

impl WorkspaceRecoveryReason {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::CurrentProjectFolder => "current_project_folder",
            Self::RecentSuccessfulWorkspace => "recent_successful_workspace",
            Self::RenamedSameFilesystemObject => "renamed_same_filesystem_object",
            Self::UniqueNameRepoIdentityMatch => "unique_name_repo_identity_match",
            Self::ResumeHistoryIdentityMatch => "resume_history_identity_match",
            Self::None => "none",
            Self::Ambiguous => "ambiguous",
        }
    }
}

impl TryFrom<&str> for WorkspaceRecoveryReason {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "current_project_folder" => Ok(Self::CurrentProjectFolder),
            "recent_successful_workspace" => Ok(Self::RecentSuccessfulWorkspace),
            "renamed_same_filesystem_object" => Ok(Self::RenamedSameFilesystemObject),
            "unique_name_repo_identity_match" => Ok(Self::UniqueNameRepoIdentityMatch),
            "resume_history_identity_match" => Ok(Self::ResumeHistoryIdentityMatch),
            "none" => Ok(Self::None),
            "ambiguous" => Ok(Self::Ambiguous),
            _ => Err(format!("Unsupported workspace recovery reason: {value}")),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WorkspaceBoundProvenance {
    CurrentProjectFolder,
    RecentSuccessfulWorkspace,
    RenamedSameFilesystemObject,
    UniqueNameRepoIdentityMatch,
    ResumeHistoryIdentityMatch,
}

impl WorkspaceBoundProvenance {
    pub(crate) const fn source(self) -> WorkspaceRecoverySource {
        match self {
            Self::CurrentProjectFolder => WorkspaceRecoverySource::ProjectCatalog,
            Self::RecentSuccessfulWorkspace => WorkspaceRecoverySource::ConversationHistory,
            Self::RenamedSameFilesystemObject | Self::UniqueNameRepoIdentityMatch => {
                WorkspaceRecoverySource::KnownRootRecovery
            }
            Self::ResumeHistoryIdentityMatch => WorkspaceRecoverySource::ResumeHistory,
        }
    }

    pub(crate) const fn reason(self) -> WorkspaceRecoveryReason {
        match self {
            Self::CurrentProjectFolder => WorkspaceRecoveryReason::CurrentProjectFolder,
            Self::RecentSuccessfulWorkspace => WorkspaceRecoveryReason::RecentSuccessfulWorkspace,
            Self::RenamedSameFilesystemObject => {
                WorkspaceRecoveryReason::RenamedSameFilesystemObject
            }
            Self::UniqueNameRepoIdentityMatch => {
                WorkspaceRecoveryReason::UniqueNameRepoIdentityMatch
            }
            Self::ResumeHistoryIdentityMatch => WorkspaceRecoveryReason::ResumeHistoryIdentityMatch,
        }
    }

    const fn from_wire(
        source: WorkspaceRecoverySource,
        reason: WorkspaceRecoveryReason,
    ) -> Option<Self> {
        match (source, reason) {
            (
                WorkspaceRecoverySource::ProjectCatalog,
                WorkspaceRecoveryReason::CurrentProjectFolder,
            ) => Some(Self::CurrentProjectFolder),
            (
                WorkspaceRecoverySource::ConversationHistory,
                WorkspaceRecoveryReason::RecentSuccessfulWorkspace,
            ) => Some(Self::RecentSuccessfulWorkspace),
            (
                WorkspaceRecoverySource::KnownRootRecovery,
                WorkspaceRecoveryReason::RenamedSameFilesystemObject,
            ) => Some(Self::RenamedSameFilesystemObject),
            (
                WorkspaceRecoverySource::KnownRootRecovery,
                WorkspaceRecoveryReason::UniqueNameRepoIdentityMatch,
            ) => Some(Self::UniqueNameRepoIdentityMatch),
            (
                WorkspaceRecoverySource::ResumeHistory,
                WorkspaceRecoveryReason::ResumeHistoryIdentityMatch,
            ) => Some(Self::ResumeHistoryIdentityMatch),
            _ => None,
        }
    }

    fn known_root(reason: WorkspaceRecoveryReason) -> Result<Self, String> {
        match reason {
            WorkspaceRecoveryReason::RenamedSameFilesystemObject => {
                Ok(Self::RenamedSameFilesystemObject)
            }
            WorkspaceRecoveryReason::UniqueNameRepoIdentityMatch => {
                Ok(Self::UniqueNameRepoIdentityMatch)
            }
            _ => Err("Workspace recovery produced an invalid bound provenance.".into()),
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct WorkspaceRecoveryScope<'a> {
    pub(crate) company_id: &'a str,
    pub(crate) project_id: &'a str,
    pub(crate) thread_id: &'a str,
}

#[derive(Clone, Debug)]
pub(crate) struct WorkspaceExecutionSettings {
    pub(crate) verify_command: Option<String>,
    pub(crate) verify_max_attempts: u32,
    pub(crate) verify_token_budget: Option<u64>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct WorkspaceEvidence {
    pub(crate) basename_normalized: String,
    pub(crate) project_name_normalized: String,
    pub(crate) anchor: String,
    pub(crate) git_origin_digest: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct ResolvedWorkspaceRoot {
    pub(crate) canonical_root: PathBuf,
    pub(crate) root_identity_json: String,
    pub(crate) provenance: WorkspaceBoundProvenance,
    pub(crate) confidence: f64,
    pub(crate) recovery_witness_binding_id: Option<String>,
    pub(crate) recovery_witness_authority_project_id: Option<String>,
    pub(crate) authority_snapshot_canonical_root: String,
    pub(crate) authority_snapshot_root_identity_json: String,
    pub(crate) authority_snapshot_updated_at_unix_ms: i64,
    pub(crate) evidence: WorkspaceEvidence,
    pub(crate) settings: WorkspaceExecutionSettings,
}

impl ResolvedWorkspaceRoot {
    pub(crate) const fn source(&self) -> WorkspaceRecoverySource {
        self.provenance.source()
    }

    pub(crate) const fn reason_code(&self) -> WorkspaceRecoveryReason {
        self.provenance.reason()
    }

    pub(crate) fn verify_live(&self) -> Result<(), String> {
        let expected: StoredRootIdentity = serde_json::from_str(&self.root_identity_json)
            .map_err(|_| "Resolved workspace identity is invalid.".to_string())?;
        if live_identity(&self.canonical_root)? != expected {
            return Err(
                "Recovered Project workspace changed identity before binding issuance.".into(),
            );
        }
        Ok(())
    }

    pub(crate) fn verify_initial_recovery_issuance(&self) -> Result<(), String> {
        self.verify_live()?;
        if self.provenance != WorkspaceBoundProvenance::UniqueNameRepoIdentityMatch {
            return Ok(());
        }
        let expected_digest = self.evidence.git_origin_digest.as_deref().ok_or_else(|| {
            "Recovered Project repository identity evidence is missing before binding issuance."
                .to_string()
        })?;
        match probe_git_origin_digest(&self.canonical_root) {
            GitOriginProbe::Digest(live_digest) if live_digest == expected_digest => Ok(()),
            GitOriginProbe::Digest(_) | GitOriginProbe::Absent => Err(
                "Recovered Project repository identity changed before binding issuance.".into(),
            ),
            GitOriginProbe::Incomplete => Err(
                "Recovered Project repository identity could not be verified before binding issuance."
                    .into(),
            ),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WorkspaceRootUnavailable {
    pub(crate) reason_code: WorkspaceRecoveryReason,
    pub(crate) candidate_count: usize,
}

#[derive(Clone, Debug)]
pub(crate) enum WorkspaceRootResolution {
    Bound(Box<ResolvedWorkspaceRoot>),
    Unavailable(WorkspaceRootUnavailable),
}

#[derive(Debug)]
pub(crate) enum ResumedWorkspaceRootError {
    Incompatible(String),
    Operational(String),
}

impl ResumedWorkspaceRootError {
    pub(crate) fn into_message(self) -> String {
        match self {
            Self::Incompatible(message) | Self::Operational(message) => message,
        }
    }
}

impl From<String> for ResumedWorkspaceRootError {
    fn from(message: String) -> Self {
        Self::Operational(message)
    }
}

#[derive(Clone, Debug)]
pub(crate) struct DurableBindingEvidence<'a> {
    pub(crate) binding_id: &'a str,
    pub(crate) company_id: &'a str,
    pub(crate) project_id: &'a str,
    pub(crate) thread_id: &'a str,
    pub(crate) canonical_root: &'a Path,
    pub(crate) root_identity_json: &'a str,
    pub(crate) source: WorkspaceRecoverySource,
    pub(crate) reason_code: WorkspaceRecoveryReason,
    pub(crate) basename_normalized: &'a str,
    pub(crate) anchor: &'a str,
    pub(crate) git_origin_digest: Option<&'a str>,
    pub(crate) recovery_witness_binding_id: Option<&'a str>,
    pub(crate) recovery_witness_authority_project_id: Option<&'a str>,
    pub(crate) authority_snapshot_canonical_root: &'a str,
    pub(crate) authority_snapshot_root_identity_json: &'a str,
    pub(crate) authority_snapshot_updated_at_unix_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct StoredRootIdentity {
    canonical_root: String,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}

#[derive(Clone, Debug)]
struct ProjectWorkspaceRecord {
    project_name: String,
    catalog_root: String,
    authority_identity_json: String,
    authority_updated_at_unix_ms: i64,
    settings: WorkspaceExecutionSettings,
}

#[derive(Clone, Debug)]
struct WorkspaceWitness {
    authority: WitnessAuthority,
    canonical_root: String,
    root_identity: StoredRootIdentity,
    basename_normalized: String,
    project_name_normalized: String,
    git_origin_digest: Option<String>,
}

struct SuccessfulWitnesses {
    entries: Vec<WorkspaceWitness>,
    latest: Option<WorkspaceWitness>,
    complete: bool,
}

#[derive(Clone, Debug)]
enum WitnessAuthority {
    Binding(String),
    ProjectAuthority(String),
}

#[derive(Clone, Debug)]
struct ScannedCandidate {
    canonical_root: PathBuf,
    identity: StoredRootIdentity,
    basename_normalized: String,
    anchor: String,
    git_origin_digest: Option<String>,
    origin_probe_complete: bool,
}

struct KnownAnchors {
    paths: Vec<PathBuf>,
    complete: bool,
}

struct CandidateScan {
    candidates: Vec<ScannedCandidate>,
    complete: bool,
}

trait CandidateScanner: Sync {
    fn direct_children(&self, anchors: &[PathBuf], excluded: Option<&Path>) -> CandidateScan;
}

struct FilesystemCandidateScanner;

impl CandidateScanner for FilesystemCandidateScanner {
    fn direct_children(&self, anchors: &[PathBuf], excluded: Option<&Path>) -> CandidateScan {
        let mut candidates = Vec::new();
        let mut seen = HashSet::new();
        let mut remaining_entries = MAX_SCANNED_DIRECTORY_ENTRIES;
        let mut complete = true;
        for (anchor_index, anchor) in anchors.iter().enumerate() {
            if remaining_entries == 0 {
                complete = false;
                break;
            }
            if crate::local_paths::is_overbroad_workspace_root(anchor) {
                continue;
            }
            let anchor_metadata = match fs::symlink_metadata(anchor) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => {
                    complete = false;
                    continue;
                }
            };
            if !anchor_metadata.is_dir() || anchor_metadata.file_type().is_symlink() {
                continue;
            }
            match anchor.canonicalize() {
                Ok(canonical) if canonical.as_path() == anchor.as_path() => {}
                Ok(_) => continue,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => {
                    complete = false;
                    continue;
                }
            }
            let Ok(mut entries) = fs::read_dir(anchor) else {
                complete = false;
                continue;
            };
            loop {
                if remaining_entries == 0 {
                    if entries.next().is_some() || anchor_index + 1 < anchors.len() {
                        complete = false;
                    }
                    break;
                }
                let Some(entry) = entries.next() else {
                    break;
                };
                remaining_entries -= 1;
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(_) => {
                        complete = false;
                        continue;
                    }
                };
                let path = entry.path();
                if excluded.is_some_and(|excluded| excluded == path) {
                    continue;
                }
                let metadata = match fs::symlink_metadata(&path) {
                    Ok(metadata) => metadata,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(_) => {
                        complete = false;
                        continue;
                    }
                };
                if !metadata.is_dir() || metadata.file_type().is_symlink() {
                    continue;
                }
                let canonical_root =
                    match crate::local_paths::resolve_project_workspace_root_path(&path) {
                        Ok(root) => root,
                        Err(_) => {
                            complete = false;
                            continue;
                        }
                    };
                if canonical_root.parent() != Some(anchor.as_path())
                    || excluded.is_some_and(|excluded| excluded == canonical_root)
                    || !seen.insert(canonical_root.clone())
                {
                    continue;
                }
                let identity = match live_identity(&canonical_root) {
                    Ok(identity) => identity,
                    Err(_) => {
                        complete = false;
                        continue;
                    }
                };
                let basename_normalized = normalized_basename(&canonical_root);
                candidates.push(ScannedCandidate {
                    git_origin_digest: None,
                    origin_probe_complete: true,
                    canonical_root,
                    identity,
                    basename_normalized,
                    anchor: path_text(anchor).unwrap_or_default(),
                });
            }
        }
        CandidateScan {
            candidates,
            complete,
        }
    }
}

pub(crate) fn capture_workspace_evidence(
    canonical_root: &Path,
    project_name: &str,
) -> Result<WorkspaceEvidence, String> {
    let anchor = canonical_root
        .parent()
        .filter(|parent| !crate::local_paths::is_overbroad_workspace_root(parent))
        .and_then(|parent| path_text(parent).ok())
        .unwrap_or_default();
    Ok(WorkspaceEvidence {
        basename_normalized: normalized_basename(canonical_root),
        project_name_normalized: normalize_name(project_name),
        anchor,
        git_origin_digest: git_origin_digest(canonical_root),
    })
}

pub(crate) async fn resolve_workspace_root_from_pool(
    pool: &sqlx::SqlitePool,
    scope: WorkspaceRecoveryScope<'_>,
) -> Result<WorkspaceRootResolution, String> {
    resolve_workspace_root_from_pool_with_scanner(pool, scope, &FilesystemCandidateScanner).await
}

pub(crate) async fn resolve_resumed_workspace_root_from_pool(
    pool: &sqlx::SqlitePool,
    scope: WorkspaceRecoveryScope<'_>,
    history_id: &str,
    turn_id: &str,
    access: &str,
) -> Result<ResolvedWorkspaceRoot, ResumedWorkspaceRootError> {
    let row = sqlx::query(
        r#"
        SELECT history.binding_id, history.canonical_root, history.root_identity_json,
               history.workspace_basename_normalized, history.project_name_normalized,
               history.workspace_anchor, history.git_origin_digest,
               history.recovery_witness_binding_id,
               history.recovery_witness_authority_project_id,
               history.source, history.confidence, history.reason_code,
               history.authority_snapshot_canonical_root,
               history.authority_snapshot_root_identity_json,
               history.authority_snapshot_updated_at_unix_ms,
               project.verify_command, project.verify_max_attempts,
               project.verify_token_budget
        FROM task_workspace_binding_history AS history
        JOIN agent_runs AS run
          ON run.run_id = history.turn_id AND run.root_run_id = history.turn_id
         AND run.company_id = history.company_id AND run.project_id = history.project_id
         AND run.thread_id = history.thread_id
        JOIN chat_threads AS thread ON thread.thread_id = history.thread_id
        JOIN projects AS project ON project.project_id = thread.project_id
        JOIN project_workspace_authority AS authority
          ON authority.project_id = project.project_id
         AND authority.company_id = project.company_id
         AND authority.canonical_root = project.workspace_root
        WHERE history.binding_id = ? AND history.company_id = ?
          AND history.project_id = ? AND history.thread_id = ?
          AND history.turn_id = ?
          AND history.access = ? AND history.status = 'app_restart'
          AND run.status = 'interrupted'
          AND project.company_id = history.company_id
          AND history.authority_snapshot_canonical_root = project.workspace_root
          AND history.authority_snapshot_canonical_root = authority.canonical_root
          AND history.authority_snapshot_root_identity_json = authority.root_identity_json
          AND history.authority_snapshot_updated_at_unix_ms = authority.updated_at_unix_ms
        "#,
    )
    .bind(history_id)
    .bind(scope.company_id)
    .bind(scope.project_id)
    .bind(scope.thread_id)
    .bind(turn_id)
    .bind(access)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Read interrupted workspace binding: {error}"))?
    .ok_or_else(|| {
        ResumedWorkspaceRootError::Incompatible(
            "Cannot resume this task: its interrupted workspace binding is missing or incompatible."
                .to_string(),
        )
    })?;
    let root_text: String = row
        .try_get("canonical_root")
        .map_err(|error| format!("Decode interrupted workspace root: {error}"))?;
    let root_identity_json: String = row
        .try_get("root_identity_json")
        .map_err(|error| format!("Decode interrupted workspace identity: {error}"))?;
    let expected_identity: StoredRootIdentity =
        serde_json::from_str(&root_identity_json).map_err(|_| {
            ResumedWorkspaceRootError::Incompatible(
                "Cannot resume this task: its interrupted workspace identity is invalid."
                    .to_string(),
            )
        })?;
    let canonical_root = resumed_live_matching_root(Path::new(&root_text), &expected_identity)?;
    let original_source: String = row
        .try_get("source")
        .map_err(|error| format!("Decode interrupted workspace source: {error}"))?;
    let original_source =
        WorkspaceRecoverySource::try_from(original_source.as_str()).map_err(|_| {
            ResumedWorkspaceRootError::Incompatible(
                "Cannot resume this task: its interrupted workspace source is unsupported.".into(),
            )
        })?;
    let original_reason: String = row
        .try_get("reason_code")
        .map_err(|error| format!("Decode interrupted workspace reason: {error}"))?;
    let original_reason =
        WorkspaceRecoveryReason::try_from(original_reason.as_str()).map_err(|_| {
            ResumedWorkspaceRootError::Incompatible(
                "Cannot resume this task: its interrupted workspace reason is unsupported.".into(),
            )
        })?;
    let original_provenance = WorkspaceBoundProvenance::from_wire(original_source, original_reason)
        .ok_or_else(|| {
            ResumedWorkspaceRootError::Incompatible(
                "Cannot resume this task: its interrupted workspace source and reason do not form a valid provenance pair."
                    .into(),
            )
        })?;
    let recovery_witness_binding_id: Option<String> = row
        .try_get("recovery_witness_binding_id")
        .map_err(|error| format!("Decode interrupted binding witness: {error}"))?;
    let recovery_witness_authority_project_id: Option<String> = row
        .try_get("recovery_witness_authority_project_id")
        .map_err(|error| format!("Decode interrupted authority witness: {error}"))?;
    let (provenance, recovery_witness_binding_id, recovery_witness_authority_project_id) = if matches!(
        original_provenance,
        WorkspaceBoundProvenance::CurrentProjectFolder
            | WorkspaceBoundProvenance::ResumeHistoryIdentityMatch
    ) {
        (
            WorkspaceBoundProvenance::ResumeHistoryIdentityMatch,
            None,
            None,
        )
    } else {
        (
            original_provenance,
            recovery_witness_binding_id,
            recovery_witness_authority_project_id,
        )
    };
    let verify_max_attempts: i64 = row.try_get("verify_max_attempts").map_err(|error| {
        ResumedWorkspaceRootError::Incompatible(format!(
            "Cannot resume this task: its Project verification attempts are invalid: {error}"
        ))
    })?;
    if !(1..=20).contains(&verify_max_attempts) {
        return Err(ResumedWorkspaceRootError::Incompatible(
            "Cannot resume this task: its Project verification attempts are invalid.".into(),
        ));
    }
    let verify_token_budget: Option<i64> = row.try_get("verify_token_budget").map_err(|error| {
        ResumedWorkspaceRootError::Incompatible(format!(
            "Cannot resume this task: its Project verification token budget is invalid: {error}"
        ))
    })?;
    if verify_token_budget.is_some_and(|budget| budget <= 0) {
        return Err(ResumedWorkspaceRootError::Incompatible(
            "Cannot resume this task: its Project verification token budget is invalid.".into(),
        ));
    }
    let resolved = ResolvedWorkspaceRoot {
        canonical_root,
        root_identity_json,
        provenance,
        confidence: row
            .try_get("confidence")
            .map_err(|error| format!("Decode interrupted workspace confidence: {error}"))?,
        recovery_witness_binding_id,
        recovery_witness_authority_project_id,
        authority_snapshot_canonical_root: row
            .try_get("authority_snapshot_canonical_root")
            .map_err(|error| format!("Decode interrupted authority snapshot root: {error}"))?,
        authority_snapshot_root_identity_json: row
            .try_get("authority_snapshot_root_identity_json")
            .map_err(|error| format!("Decode interrupted authority snapshot identity: {error}"))?,
        authority_snapshot_updated_at_unix_ms: row
            .try_get("authority_snapshot_updated_at_unix_ms")
            .map_err(|error| format!("Decode interrupted authority snapshot version: {error}"))?,
        evidence: WorkspaceEvidence {
            basename_normalized: row
                .try_get("workspace_basename_normalized")
                .map_err(|error| format!("Decode interrupted workspace basename: {error}"))?,
            project_name_normalized: row
                .try_get("project_name_normalized")
                .map_err(|error| format!("Decode interrupted Project name: {error}"))?,
            anchor: row
                .try_get("workspace_anchor")
                .map_err(|error| format!("Decode interrupted workspace anchor: {error}"))?,
            git_origin_digest: row
                .try_get("git_origin_digest")
                .map_err(|error| format!("Decode interrupted repository identity: {error}"))?,
        },
        settings: WorkspaceExecutionSettings {
            verify_command: row
                .try_get("verify_command")
                .map_err(|error| format!("Decode resumed verify command: {error}"))?,
            verify_max_attempts: verify_max_attempts.try_into().map_err(|_| {
                ResumedWorkspaceRootError::Incompatible(
                    "Cannot resume this task: its Project verification attempts are invalid."
                        .into(),
                )
            })?,
            verify_token_budget: verify_token_budget.map(u64::try_from).transpose().map_err(
                |_| {
                    ResumedWorkspaceRootError::Incompatible(
                        "Cannot resume this task: its Project verification token budget is invalid."
                            .into(),
                    )
                },
            )?,
        },
    };
    let valid = durable_binding_is_valid(
        pool,
        DurableBindingEvidence {
            binding_id: history_id,
            company_id: scope.company_id,
            project_id: scope.project_id,
            thread_id: scope.thread_id,
            canonical_root: &resolved.canonical_root,
            root_identity_json: &resolved.root_identity_json,
            source: resolved.source(),
            reason_code: resolved.reason_code(),
            basename_normalized: &resolved.evidence.basename_normalized,
            anchor: &resolved.evidence.anchor,
            git_origin_digest: resolved.evidence.git_origin_digest.as_deref(),
            recovery_witness_binding_id: resolved.recovery_witness_binding_id.as_deref(),
            recovery_witness_authority_project_id: resolved
                .recovery_witness_authority_project_id
                .as_deref(),
            authority_snapshot_canonical_root: &resolved.authority_snapshot_canonical_root,
            authority_snapshot_root_identity_json: &resolved.authority_snapshot_root_identity_json,
            authority_snapshot_updated_at_unix_ms: resolved.authority_snapshot_updated_at_unix_ms,
        },
    )
    .await?;
    if !valid {
        return Err(ResumedWorkspaceRootError::Incompatible(
            "Cannot resume this task: its recovered workspace authority is no longer valid.".into(),
        ));
    }
    Ok(resolved)
}

async fn resolve_workspace_root_from_pool_with_scanner(
    pool: &sqlx::SqlitePool,
    scope: WorkspaceRecoveryScope<'_>,
    scanner: &dyn CandidateScanner,
) -> Result<WorkspaceRootResolution, String> {
    let project = load_project_workspace(pool, &scope).await?;
    let expected_identity: StoredRootIdentity =
        serde_json::from_str(&project.authority_identity_json)
            .map_err(|_| "Project workspace authority identity is invalid.".to_string())?;
    let catalog_path = PathBuf::from(&project.catalog_root);
    if let Some(canonical_root) = live_matching_root(&catalog_path, &expected_identity)? {
        let evidence = capture_workspace_evidence(&canonical_root, &project.project_name)?;
        return Ok(WorkspaceRootResolution::Bound(Box::new(
            ResolvedWorkspaceRoot {
                canonical_root,
                root_identity_json: project.authority_identity_json.clone(),
                provenance: WorkspaceBoundProvenance::CurrentProjectFolder,
                confidence: 1.0,
                recovery_witness_binding_id: None,
                recovery_witness_authority_project_id: None,
                authority_snapshot_canonical_root: project.catalog_root.clone(),
                authority_snapshot_root_identity_json: project.authority_identity_json.clone(),
                authority_snapshot_updated_at_unix_ms: project.authority_updated_at_unix_ms,
                evidence,
                settings: project.settings,
            },
        )));
    }

    let successful_witnesses = load_successful_witnesses(pool, &scope, &project).await?;
    if let Some(latest) = successful_witnesses.latest.as_ref() {
        let path = PathBuf::from(&latest.canonical_root);
        if let Some(canonical_root) = live_matching_root(&path, &latest.root_identity)? {
            if recovered_root_is_occupied(pool, scope.project_id, &canonical_root, None).await? {
                return Ok(WorkspaceRootResolution::Unavailable(
                    WorkspaceRootUnavailable {
                        reason_code: WorkspaceRecoveryReason::Ambiguous,
                        candidate_count: 1,
                    },
                ));
            }
            let evidence = capture_workspace_evidence(&canonical_root, &project.project_name)?;
            let root_identity_json = serde_json::to_string(&latest.root_identity)
                .map_err(|error| format!("Encode recent workspace identity: {error}"))?;
            let (recovery_witness_binding_id, recovery_witness_authority_project_id) =
                witness_authority_fields(&latest.authority);
            return Ok(WorkspaceRootResolution::Bound(Box::new(
                ResolvedWorkspaceRoot {
                    canonical_root,
                    root_identity_json,
                    provenance: WorkspaceBoundProvenance::RecentSuccessfulWorkspace,
                    confidence: 1.0,
                    recovery_witness_binding_id,
                    recovery_witness_authority_project_id,
                    authority_snapshot_canonical_root: project.catalog_root.clone(),
                    authority_snapshot_root_identity_json: project.authority_identity_json.clone(),
                    authority_snapshot_updated_at_unix_ms: project.authority_updated_at_unix_ms,
                    evidence,
                    settings: project.settings,
                },
            )));
        }
    }
    let witnesses_complete = successful_witnesses.complete;
    let mut witnesses = successful_witnesses.entries;
    witnesses.push(authority_witness(
        scope.project_id,
        &project.project_name,
        &project.catalog_root,
        expected_identity,
    ));

    let anchors = load_known_anchors(pool, scope.company_id, &project.catalog_root).await?;
    if anchors.paths.is_empty() {
        return Ok(WorkspaceRootResolution::Unavailable(
            WorkspaceRootUnavailable {
                reason_code: if anchors.complete {
                    WorkspaceRecoveryReason::None
                } else {
                    WorkspaceRecoveryReason::Ambiguous
                },
                candidate_count: 0,
            },
        ));
    }
    let excluded = if catalog_path.exists() {
        Some(catalog_path.as_path())
    } else {
        None
    };
    let mut scan = scanner.direct_children(&anchors.paths, excluded);
    populate_relevant_repository_probes(&mut scan.candidates, &witnesses);
    let matches = match_recovery_candidates(&scan.candidates, &witnesses);
    let repository_probes_complete =
        relevant_repository_probes_are_complete(&scan.candidates, &witnesses);
    let authoritative_object_match = matches!(
        &matches,
        RecoveryMatch::Unique {
            witness: WorkspaceWitness {
                authority: WitnessAuthority::ProjectAuthority(project_id),
                ..
            },
            reason_code: WorkspaceRecoveryReason::RenamedSameFilesystemObject,
            ..
        } if project_id == scope.project_id
    );
    let selected_tier_needs_repository_probe = matches!(
        &matches,
        RecoveryMatch::Unique {
            reason_code: WorkspaceRecoveryReason::UniqueNameRepoIdentityMatch,
            ..
        } | RecoveryMatch::None
    );
    if !authoritative_object_match
        && (!witnesses_complete
            || !anchors.complete
            || !scan.complete
            || (selected_tier_needs_repository_probe && !repository_probes_complete))
    {
        let observed_match_count = match &matches {
            RecoveryMatch::Unique { .. } => 1,
            RecoveryMatch::Ambiguous(count) => *count,
            RecoveryMatch::None => 0,
        };
        return Ok(WorkspaceRootResolution::Unavailable(
            WorkspaceRootUnavailable {
                reason_code: WorkspaceRecoveryReason::Ambiguous,
                candidate_count: observed_match_count,
            },
        ));
    }
    match matches {
        RecoveryMatch::Unique {
            candidate,
            witness,
            confidence,
            reason_code,
        } => {
            if recovered_root_is_occupied(pool, scope.project_id, &candidate.canonical_root, None)
                .await?
            {
                return Ok(WorkspaceRootResolution::Unavailable(
                    WorkspaceRootUnavailable {
                        reason_code: WorkspaceRecoveryReason::Ambiguous,
                        candidate_count: 1,
                    },
                ));
            }
            Ok(WorkspaceRootResolution::Bound(Box::new(
                ResolvedWorkspaceRoot {
                    canonical_root: candidate.canonical_root.clone(),
                    root_identity_json: serde_json::to_string(&candidate.identity)
                        .map_err(|error| format!("Encode recovered workspace identity: {error}"))?,
                    provenance: WorkspaceBoundProvenance::known_root(reason_code)?,
                    confidence,
                    recovery_witness_binding_id: witness_authority_fields(&witness.authority).0,
                    recovery_witness_authority_project_id: witness_authority_fields(
                        &witness.authority,
                    )
                    .1,
                    authority_snapshot_canonical_root: project.catalog_root.clone(),
                    authority_snapshot_root_identity_json: project.authority_identity_json.clone(),
                    authority_snapshot_updated_at_unix_ms: project.authority_updated_at_unix_ms,
                    evidence: WorkspaceEvidence {
                        basename_normalized: candidate.basename_normalized.clone(),
                        project_name_normalized: normalize_name(&project.project_name),
                        anchor: candidate.anchor.clone(),
                        git_origin_digest: candidate.git_origin_digest.clone(),
                    },
                    settings: project.settings,
                },
            )))
        }
        RecoveryMatch::Ambiguous(count) => Ok(WorkspaceRootResolution::Unavailable(
            WorkspaceRootUnavailable {
                reason_code: WorkspaceRecoveryReason::Ambiguous,
                candidate_count: count,
            },
        )),
        RecoveryMatch::None => Ok(WorkspaceRootResolution::Unavailable(
            WorkspaceRootUnavailable {
                reason_code: WorkspaceRecoveryReason::None,
                candidate_count: 0,
            },
        )),
    }
}

pub(crate) async fn durable_binding_is_valid(
    pool: &sqlx::SqlitePool,
    binding: DurableBindingEvidence<'_>,
) -> Result<bool, String> {
    let Some(provenance) = WorkspaceBoundProvenance::from_wire(binding.source, binding.reason_code)
    else {
        return Ok(false);
    };
    let expected_identity: StoredRootIdentity =
        match serde_json::from_str(binding.root_identity_json) {
            Ok(identity) => identity,
            Err(_) => return Ok(false),
        };
    if live_matching_root(binding.canonical_root, &expected_identity)?.is_none() {
        return Ok(false);
    }
    if matches!(
        provenance,
        WorkspaceBoundProvenance::RecentSuccessfulWorkspace
            | WorkspaceBoundProvenance::RenamedSameFilesystemObject
            | WorkspaceBoundProvenance::UniqueNameRepoIdentityMatch
    ) && recovered_root_is_occupied(
        pool,
        binding.project_id,
        binding.canonical_root,
        Some(binding.binding_id),
    )
    .await?
    {
        return Ok(false);
    }
    let current_authority = sqlx::query(
        r#"
        SELECT project.workspace_root, authority.root_identity_json,
               authority.updated_at_unix_ms
        FROM chat_threads AS thread
        JOIN projects AS project ON project.project_id = thread.project_id
        JOIN project_workspace_authority AS authority
          ON authority.project_id = project.project_id
         AND authority.company_id = project.company_id
         AND authority.canonical_root = project.workspace_root
        WHERE thread.thread_id = ? AND project.project_id = ? AND project.company_id = ?
        "#,
    )
    .bind(binding.thread_id)
    .bind(binding.project_id)
    .bind(binding.company_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Validate task workspace scope: {error}"))?;
    let Some(current_authority) = current_authority else {
        return Ok(false);
    };
    let catalog_root: String = current_authority
        .try_get("workspace_root")
        .map_err(|error| format!("Decode current Project workspace: {error}"))?;
    let authority_identity_json: String = current_authority
        .try_get("root_identity_json")
        .map_err(|error| format!("Decode current Project authority identity: {error}"))?;
    let authority_updated_at_unix_ms: i64 = current_authority
        .try_get("updated_at_unix_ms")
        .map_err(|error| format!("Decode current Project authority version: {error}"))?;
    if binding.authority_snapshot_canonical_root != catalog_root
        || binding.authority_snapshot_root_identity_json != authority_identity_json
        || binding.authority_snapshot_updated_at_unix_ms != authority_updated_at_unix_ms
    {
        return Ok(false);
    }
    let current_anchor = binding
        .canonical_root
        .parent()
        .filter(|parent| !crate::local_paths::is_overbroad_workspace_root(parent))
        .and_then(|parent| path_text(parent).ok())
        .unwrap_or_default();
    if normalized_basename(binding.canonical_root) != binding.basename_normalized
        || current_anchor != binding.anchor
    {
        return Ok(false);
    }

    match provenance {
        WorkspaceBoundProvenance::CurrentProjectFolder
        | WorkspaceBoundProvenance::ResumeHistoryIdentityMatch => {
            let valid: i64 = sqlx::query_scalar(
                r#"
                SELECT EXISTS (
                  SELECT 1
                  FROM projects AS project
                  JOIN project_workspace_authority AS authority
                    ON authority.project_id = project.project_id
                   AND authority.company_id = project.company_id
                   AND authority.canonical_root = project.workspace_root
                  WHERE project.project_id = ? AND project.company_id = ?
                    AND authority.canonical_root = ? AND authority.root_identity_json = ?
                )
                "#,
            )
            .bind(binding.project_id)
            .bind(binding.company_id)
            .bind(path_text(binding.canonical_root)?)
            .bind(binding.root_identity_json)
            .fetch_one(pool)
            .await
            .map_err(|error| format!("Validate Project workspace authority: {error}"))?;
            Ok(valid == 1
                && binding.recovery_witness_binding_id.is_none()
                && binding.recovery_witness_authority_project_id.is_none())
        }
        WorkspaceBoundProvenance::RecentSuccessfulWorkspace
        | WorkspaceBoundProvenance::RenamedSameFilesystemObject
        | WorkspaceBoundProvenance::UniqueNameRepoIdentityMatch => {
            let binding_witness = binding.recovery_witness_binding_id;
            let authority_witness = binding.recovery_witness_authority_project_id;
            if binding_witness.is_some() == authority_witness.is_some() {
                return Ok(false);
            }
            if binding_witness == Some(binding.binding_id) {
                return Ok(false);
            }
            let witness = if let Some(witness_id) = binding_witness {
                load_witness_by_id(pool, witness_id, &binding).await?
            } else {
                load_authority_witness(
                    pool,
                    binding.company_id,
                    binding.project_id,
                    authority_witness.expect("exclusive witness"),
                    binding.authority_snapshot_canonical_root,
                    binding.authority_snapshot_root_identity_json,
                    binding.authority_snapshot_updated_at_unix_ms,
                )
                .await?
            };
            let Some(witness) = witness else {
                return Ok(false);
            };
            if provenance == WorkspaceBoundProvenance::RecentSuccessfulWorkspace {
                return Ok(binding_witness.is_some()
                    && witness.canonical_root == path_text(binding.canonical_root)?
                    && witness.root_identity == expected_identity);
            }
            match provenance {
                WorkspaceBoundProvenance::RenamedSameFilesystemObject => Ok(
                    same_filesystem_object(&witness.root_identity, &expected_identity),
                ),
                WorkspaceBoundProvenance::UniqueNameRepoIdentityMatch => Ok(binding_witness
                    .is_some()
                    && !binding.basename_normalized.is_empty()
                    && binding.git_origin_digest.is_some()
                    && binding.git_origin_digest == witness.git_origin_digest.as_deref()
                    && (binding.basename_normalized == witness.basename_normalized
                        || binding.basename_normalized == witness.project_name_normalized)),
                WorkspaceBoundProvenance::CurrentProjectFolder
                | WorkspaceBoundProvenance::RecentSuccessfulWorkspace
                | WorkspaceBoundProvenance::ResumeHistoryIdentityMatch => Ok(false),
            }
        }
    }
}

async fn load_project_workspace(
    pool: &sqlx::SqlitePool,
    scope: &WorkspaceRecoveryScope<'_>,
) -> Result<ProjectWorkspaceRecord, String> {
    let row = sqlx::query(
        r#"
        SELECT project.name, project.workspace_root, project.verify_command,
               project.verify_max_attempts, project.verify_token_budget,
               authority.root_identity_json, authority.updated_at_unix_ms
        FROM chat_threads AS thread
        JOIN projects AS project ON project.project_id = thread.project_id
        JOIN project_workspace_authority AS authority
          ON authority.project_id = project.project_id
         AND authority.company_id = project.company_id
         AND authority.canonical_root = project.workspace_root
        WHERE thread.thread_id = ? AND project.project_id = ? AND project.company_id = ?
        "#,
    )
    .bind(scope.thread_id)
    .bind(scope.project_id)
    .bind(scope.company_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Read Project workspace recovery scope: {error}"))?
    .ok_or_else(|| {
        "No Project workspace authority matches the trusted Company, Project, and Conversation scope."
            .to_string()
    })?;
    let verify_max_attempts: i64 = row
        .try_get("verify_max_attempts")
        .map_err(|error| format!("Decode Project verification attempts: {error}"))?;
    Ok(ProjectWorkspaceRecord {
        project_name: row
            .try_get("name")
            .map_err(|error| format!("Decode Project name: {error}"))?,
        catalog_root: row
            .try_get("workspace_root")
            .map_err(|error| format!("Decode Project workspace: {error}"))?,
        authority_identity_json: row
            .try_get("root_identity_json")
            .map_err(|error| format!("Decode Project workspace identity: {error}"))?,
        authority_updated_at_unix_ms: row
            .try_get("updated_at_unix_ms")
            .map_err(|error| format!("Decode Project workspace authority version: {error}"))?,
        settings: WorkspaceExecutionSettings {
            verify_command: row
                .try_get("verify_command")
                .map_err(|error| format!("Decode Project verify command: {error}"))?,
            verify_max_attempts: verify_max_attempts
                .try_into()
                .map_err(|_| "Project verify_max_attempts is invalid.".to_string())?,
            verify_token_budget: row
                .try_get::<Option<i64>, _>("verify_token_budget")
                .map_err(|error| format!("Decode Project verify token budget: {error}"))?
                .map(u64::try_from)
                .transpose()
                .map_err(|_| "Project verify_token_budget is invalid.".to_string())?,
        },
    })
}

async fn recovered_root_is_occupied(
    pool: &sqlx::SqlitePool,
    project_id: &str,
    canonical_root: &Path,
    excluded_binding_id: Option<&str>,
) -> Result<bool, String> {
    let occupied: i64 = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
          SELECT 1
          FROM project_workspace_authority AS authority
          WHERE authority.project_id <> ?
            AND authority.canonical_root = ?
          UNION ALL
          SELECT 1
          FROM task_workspace_binding_history AS binding
          WHERE binding.status = 'active'
            AND binding.canonical_root = ?
            AND binding.binding_id <> COALESCE(?, '')
            AND binding.project_id <> ?
          UNION ALL
          SELECT 1
          FROM task_workspace_lease_history AS lease
          WHERE lease.status = 'active'
            AND lease.canonical_worktree = ?
        )
        "#,
    )
    .bind(project_id)
    .bind(path_text(canonical_root)?)
    .bind(path_text(canonical_root)?)
    .bind(excluded_binding_id)
    .bind(project_id)
    .bind(path_text(canonical_root)?)
    .fetch_one(pool)
    .await
    .map_err(|error| format!("Check recovered workspace ownership: {error}"))?;
    Ok(occupied == 1)
}

fn authority_witness(
    project_id: &str,
    project_name: &str,
    canonical_root: &str,
    root_identity: StoredRootIdentity,
) -> WorkspaceWitness {
    let root = Path::new(canonical_root);
    WorkspaceWitness {
        authority: WitnessAuthority::ProjectAuthority(project_id.to_string()),
        canonical_root: canonical_root.to_string(),
        root_identity,
        basename_normalized: normalized_basename(root),
        project_name_normalized: normalize_name(project_name),
        git_origin_digest: None,
    }
}

fn witness_authority_fields(authority: &WitnessAuthority) -> (Option<String>, Option<String>) {
    match authority {
        WitnessAuthority::Binding(binding_id) => (Some(binding_id.clone()), None),
        WitnessAuthority::ProjectAuthority(project_id) => (None, Some(project_id.clone())),
    }
}

async fn load_known_anchors(
    pool: &sqlx::SqlitePool,
    company_id: &str,
    catalog_root: &str,
) -> Result<KnownAnchors, String> {
    let rows = sqlx::query(
        r#"
        SELECT canonical_root FROM (
          SELECT authority.canonical_root AS canonical_root
          FROM project_workspace_authority AS authority
          WHERE authority.company_id = ?
          UNION
          SELECT history.canonical_root AS canonical_root
          FROM task_workspace_binding_history AS history
          JOIN projects AS project
            ON project.project_id = history.project_id
           AND project.company_id = history.company_id
          JOIN project_workspace_authority AS authority
            ON authority.project_id = project.project_id
           AND authority.company_id = project.company_id
           AND authority.canonical_root = project.workspace_root
          WHERE history.company_id = ? AND history.status = 'completed'
            AND history.authority_snapshot_canonical_root = project.workspace_root
            AND history.authority_snapshot_canonical_root = authority.canonical_root
            AND history.authority_snapshot_root_identity_json = authority.root_identity_json
            AND history.authority_snapshot_updated_at_unix_ms = authority.updated_at_unix_ms
        )
        ORDER BY canonical_root
        LIMIT ?
        "#,
    )
    .bind(company_id)
    .bind(company_id)
    .bind((MAX_KNOWN_ANCHOR_ROWS + 1) as i64)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Read known workspace recovery anchors: {error}"))?;
    let mut complete = rows.len() <= MAX_KNOWN_ANCHOR_ROWS;
    let mut roots = Vec::with_capacity(rows.len().min(MAX_KNOWN_ANCHOR_ROWS) + 1);
    roots.push(catalog_root.to_string());
    for row in rows.into_iter().take(MAX_KNOWN_ANCHOR_ROWS) {
        match row.try_get::<String, _>("canonical_root") {
            Ok(root) => roots.push(root),
            Err(_) => complete = false,
        }
    }
    let mut seen = HashSet::new();
    let mut paths = Vec::new();
    for (index, root) in roots.into_iter().enumerate() {
        let root = PathBuf::from(root);
        let Some(anchor) = root.parent().map(Path::to_path_buf) else {
            if index == 0 {
                complete = false;
            }
            continue;
        };
        if crate::local_paths::is_overbroad_workspace_root(&anchor) {
            if index == 0 {
                complete = false;
            }
            continue;
        }
        if seen.insert(anchor.clone()) {
            paths.push(anchor);
        }
    }
    Ok(KnownAnchors { paths, complete })
}

async fn load_successful_witnesses(
    pool: &sqlx::SqlitePool,
    scope: &WorkspaceRecoveryScope<'_>,
    project: &ProjectWorkspaceRecord,
) -> Result<SuccessfulWitnesses, String> {
    let rows = sqlx::query(
        r#"
        SELECT binding_id, canonical_root, root_identity_json,
               workspace_basename_normalized, project_name_normalized,
               workspace_anchor, git_origin_digest
        FROM task_workspace_binding_history
        WHERE company_id = ? AND project_id = ? AND thread_id = ?
          AND status = 'completed'
          AND authority_snapshot_canonical_root = ?
          AND authority_snapshot_root_identity_json = ?
          AND authority_snapshot_updated_at_unix_ms = ?
        ORDER BY issued_at_unix_ms DESC, binding_id DESC
        LIMIT ?
        "#,
    )
    .bind(scope.company_id)
    .bind(scope.project_id)
    .bind(scope.thread_id)
    .bind(&project.catalog_root)
    .bind(&project.authority_identity_json)
    .bind(project.authority_updated_at_unix_ms)
    .bind(MAX_WITNESSES + 1)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Read successful Conversation workspace history: {error}"))?;
    let mut complete = rows.len() <= MAX_WITNESSES as usize;
    let mut entries = Vec::with_capacity(rows.len().min(MAX_WITNESSES as usize));
    let mut latest = None;
    for (index, row) in rows.into_iter().enumerate() {
        let decoded = decode_witness(row)?;
        if index == 0 {
            latest = decoded.clone();
        }
        if decoded.is_none() {
            complete = false;
        }
        if index < MAX_WITNESSES as usize {
            entries.extend(decoded);
        }
    }
    Ok(SuccessfulWitnesses {
        entries,
        latest,
        complete,
    })
}

async fn load_witness_by_id(
    pool: &sqlx::SqlitePool,
    binding_id: &str,
    binding: &DurableBindingEvidence<'_>,
) -> Result<Option<WorkspaceWitness>, String> {
    let row = sqlx::query(
        r#"
        SELECT binding_id, canonical_root, root_identity_json,
               workspace_basename_normalized, project_name_normalized,
               workspace_anchor, git_origin_digest
        FROM task_workspace_binding_history
        WHERE binding_id = ? AND company_id = ? AND project_id = ? AND thread_id = ?
          AND status = 'completed'
          AND authority_snapshot_canonical_root = ?
          AND authority_snapshot_root_identity_json = ?
          AND authority_snapshot_updated_at_unix_ms = ?
        "#,
    )
    .bind(binding_id)
    .bind(binding.company_id)
    .bind(binding.project_id)
    .bind(binding.thread_id)
    .bind(binding.authority_snapshot_canonical_root)
    .bind(binding.authority_snapshot_root_identity_json)
    .bind(binding.authority_snapshot_updated_at_unix_ms)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Read workspace recovery witness: {error}"))?;
    match row {
        Some(row) => decode_witness(row),
        None => Ok(None),
    }
}

async fn load_authority_witness(
    pool: &sqlx::SqlitePool,
    company_id: &str,
    project_id: &str,
    authority_project_id: &str,
    authority_snapshot_canonical_root: &str,
    authority_snapshot_root_identity_json: &str,
    authority_snapshot_updated_at_unix_ms: i64,
) -> Result<Option<WorkspaceWitness>, String> {
    if project_id != authority_project_id {
        return Ok(None);
    }
    let row = sqlx::query(
        r#"
        SELECT project.name, authority.canonical_root, authority.root_identity_json
        FROM project_workspace_authority AS authority
        JOIN projects AS project ON project.project_id = authority.project_id
        WHERE authority.project_id = ? AND authority.company_id = ?
          AND project.project_id = ? AND project.company_id = ?
          AND project.workspace_root = ?
          AND authority.canonical_root = ?
          AND authority.root_identity_json = ?
          AND authority.updated_at_unix_ms = ?
        "#,
    )
    .bind(authority_project_id)
    .bind(company_id)
    .bind(project_id)
    .bind(company_id)
    .bind(authority_snapshot_canonical_root)
    .bind(authority_snapshot_canonical_root)
    .bind(authority_snapshot_root_identity_json)
    .bind(authority_snapshot_updated_at_unix_ms)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Read Project workspace recovery witness: {error}"))?;
    let Some(row) = row else {
        return Ok(None);
    };
    let canonical_root: String = row
        .try_get("canonical_root")
        .map_err(|error| format!("Decode Project workspace witness root: {error}"))?;
    let identity_json: String = row
        .try_get("root_identity_json")
        .map_err(|error| format!("Decode Project workspace witness identity: {error}"))?;
    let root_identity = serde_json::from_str(&identity_json)
        .map_err(|_| "Project workspace witness identity is invalid.".to_string())?;
    let project_name: String = row
        .try_get("name")
        .map_err(|error| format!("Decode Project workspace witness name: {error}"))?;
    Ok(Some(authority_witness(
        authority_project_id,
        &project_name,
        &canonical_root,
        root_identity,
    )))
}

fn decode_witness(row: sqlx::sqlite::SqliteRow) -> Result<Option<WorkspaceWitness>, String> {
    let identity_json: String = row
        .try_get("root_identity_json")
        .map_err(|error| format!("Decode workspace witness identity: {error}"))?;
    let root_identity = match serde_json::from_str(&identity_json) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    Ok(Some(WorkspaceWitness {
        authority: WitnessAuthority::Binding(
            row.try_get("binding_id")
                .map_err(|error| format!("Decode workspace witness id: {error}"))?,
        ),
        canonical_root: row
            .try_get("canonical_root")
            .map_err(|error| format!("Decode workspace witness root: {error}"))?,
        root_identity,
        basename_normalized: row
            .try_get("workspace_basename_normalized")
            .map_err(|error| format!("Decode workspace witness basename: {error}"))?,
        project_name_normalized: row
            .try_get("project_name_normalized")
            .map_err(|error| format!("Decode workspace witness Project name: {error}"))?,
        git_origin_digest: row
            .try_get("git_origin_digest")
            .map_err(|error| format!("Decode workspace witness repository identity: {error}"))?,
    }))
}

enum RecoveryMatch<'a> {
    Unique {
        candidate: &'a ScannedCandidate,
        witness: &'a WorkspaceWitness,
        confidence: f64,
        reason_code: WorkspaceRecoveryReason,
    },
    Ambiguous(usize),
    None,
}

fn match_recovery_candidates<'a>(
    candidates: &'a [ScannedCandidate],
    witnesses: &'a [WorkspaceWitness],
) -> RecoveryMatch<'a> {
    let authoritative_object_matches = candidates
        .iter()
        .flat_map(|candidate| {
            witnesses.iter().filter_map(move |witness| {
                if matches!(witness.authority, WitnessAuthority::ProjectAuthority(_))
                    && same_filesystem_object(&candidate.identity, &witness.root_identity)
                {
                    Some((candidate, witness))
                } else {
                    None
                }
            })
        })
        .collect::<Vec<_>>();
    if authoritative_object_matches.len() == 1 {
        let (candidate, witness) = authoritative_object_matches[0];
        return RecoveryMatch::Unique {
            candidate,
            witness,
            confidence: 0.99,
            reason_code: WorkspaceRecoveryReason::RenamedSameFilesystemObject,
        };
    }
    if authoritative_object_matches.len() > 1 {
        return RecoveryMatch::Ambiguous(authoritative_object_matches.len());
    }

    let mut object_matches: HashMap<&Path, (&ScannedCandidate, &WorkspaceWitness)> = HashMap::new();
    for candidate in candidates {
        for witness in witnesses {
            if same_filesystem_object(&candidate.identity, &witness.root_identity) {
                object_matches
                    .entry(candidate.canonical_root.as_path())
                    .or_insert((candidate, witness));
            }
        }
    }
    if object_matches.len() == 1 {
        let (candidate, witness) = object_matches.into_values().next().expect("one match");
        return RecoveryMatch::Unique {
            candidate,
            witness,
            confidence: 0.99,
            reason_code: WorkspaceRecoveryReason::RenamedSameFilesystemObject,
        };
    }
    if object_matches.len() > 1 {
        return RecoveryMatch::Ambiguous(object_matches.len());
    }

    let mut repository_matches: HashMap<&Path, (&ScannedCandidate, &WorkspaceWitness)> =
        HashMap::new();
    for candidate in candidates {
        let Some(candidate_digest) = candidate.git_origin_digest.as_deref() else {
            continue;
        };
        for witness in witnesses {
            if witness.git_origin_digest.as_deref() == Some(candidate_digest)
                && candidate_name_matches_witness(candidate, witness)
            {
                repository_matches
                    .entry(candidate.canonical_root.as_path())
                    .or_insert((candidate, witness));
            }
        }
    }
    if repository_matches.len() == 1 {
        let (candidate, witness) = repository_matches.into_values().next().expect("one match");
        RecoveryMatch::Unique {
            candidate,
            witness,
            confidence: 0.95,
            reason_code: WorkspaceRecoveryReason::UniqueNameRepoIdentityMatch,
        }
    } else if repository_matches.len() > 1 {
        RecoveryMatch::Ambiguous(repository_matches.len())
    } else {
        RecoveryMatch::None
    }
}

fn candidate_name_matches_witness(
    candidate: &ScannedCandidate,
    witness: &WorkspaceWitness,
) -> bool {
    !candidate.basename_normalized.is_empty()
        && (candidate.basename_normalized == witness.basename_normalized
            || candidate.basename_normalized == witness.project_name_normalized)
}

fn relevant_repository_probes_are_complete(
    candidates: &[ScannedCandidate],
    witnesses: &[WorkspaceWitness],
) -> bool {
    candidates.iter().all(|candidate| {
        candidate.origin_probe_complete
            || !witnesses
                .iter()
                .any(|witness| candidate_name_matches_witness(candidate, witness))
    })
}

fn populate_relevant_repository_probes(
    candidates: &mut [ScannedCandidate],
    witnesses: &[WorkspaceWitness],
) {
    let deadline = Instant::now() + GIT_CONFIG_SCAN_BUDGET;
    for candidate in candidates {
        if !witnesses
            .iter()
            .any(|witness| candidate_name_matches_witness(candidate, witness))
        {
            continue;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            candidate.origin_probe_complete = false;
            continue;
        }
        match probe_git_origin_digest_with_timeout(
            &candidate.canonical_root,
            remaining.min(GIT_CONFIG_SINGLE_PROBE_TIMEOUT),
        ) {
            GitOriginProbe::Absent => {}
            GitOriginProbe::Digest(digest) => candidate.git_origin_digest = Some(digest),
            GitOriginProbe::Incomplete => candidate.origin_probe_complete = false,
        }
    }
}

fn live_matching_root(
    path: &Path,
    expected: &StoredRootIdentity,
) -> Result<Option<PathBuf>, String> {
    live_matching_root_with(
        path,
        expected,
        |candidate| fs::symlink_metadata(candidate),
        |candidate| candidate.canonicalize(),
    )
}

fn resumed_live_matching_root(
    path: &Path,
    expected: &StoredRootIdentity,
) -> Result<PathBuf, ResumedWorkspaceRootError> {
    resumed_live_matching_root_with(
        path,
        expected,
        |candidate| fs::symlink_metadata(candidate),
        |candidate| candidate.canonicalize(),
    )
}

fn resumed_live_matching_root_with(
    path: &Path,
    expected: &StoredRootIdentity,
    read_metadata: impl FnOnce(&Path) -> io::Result<fs::Metadata>,
    canonicalize: impl FnOnce(&Path) -> io::Result<PathBuf>,
) -> Result<PathBuf, ResumedWorkspaceRootError> {
    live_matching_root_with(path, expected, read_metadata, canonicalize)
        .map_err(ResumedWorkspaceRootError::Operational)?
        .ok_or_else(|| {
            ResumedWorkspaceRootError::Incompatible(
                "Cannot resume this task: its exact recovered workspace no longer exists or changed identity."
                    .to_string(),
            )
        })
}

fn live_matching_root_with(
    path: &Path,
    expected: &StoredRootIdentity,
    read_metadata: impl FnOnce(&Path) -> io::Result<fs::Metadata>,
    canonicalize: impl FnOnce(&Path) -> io::Result<PathBuf>,
) -> Result<Option<PathBuf>, String> {
    let metadata = match read_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Inspect resumed workspace identity: {error}")),
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Ok(None);
    }
    if crate::local_paths::is_overbroad_workspace_root(path) {
        return Ok(None);
    }
    let canonical_root = match canonicalize(path) {
        Ok(canonical_root) => canonical_root,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Resolve resumed workspace identity: {error}")),
    };
    if canonical_root != path || crate::local_paths::is_overbroad_workspace_root(&canonical_root) {
        return Ok(None);
    }
    #[cfg(unix)]
    let live_identity = {
        use std::os::unix::fs::MetadataExt;
        StoredRootIdentity {
            canonical_root: path_text(path)?,
            device: metadata.dev(),
            inode: metadata.ino(),
        }
    };
    #[cfg(not(unix))]
    let live_identity = StoredRootIdentity {
        canonical_root: path_text(path)?,
    };
    Ok((live_identity == *expected).then_some(canonical_root))
}

fn live_identity(path: &Path) -> Result<StoredRootIdentity, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Inspect workspace identity: {error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Workspace recovery candidate must be a real directory.".into());
    }
    let canonical_root = path
        .canonicalize()
        .map_err(|error| format!("Resolve workspace identity: {error}"))?;
    if canonical_root != path {
        return Err("Workspace recovery candidate contains a redirected path.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(StoredRootIdentity {
            canonical_root: path_text(path)?,
            device: metadata.dev(),
            inode: metadata.ino(),
        })
    }
    #[cfg(not(unix))]
    {
        Ok(StoredRootIdentity {
            canonical_root: path_text(path)?,
        })
    }
}

fn same_filesystem_object(left: &StoredRootIdentity, right: &StoredRootIdentity) -> bool {
    #[cfg(unix)]
    {
        left.device == right.device && left.inode == right.inode
    }
    #[cfg(not(unix))]
    {
        left == right
    }
}

fn normalized_basename(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(normalize_name)
        .unwrap_or_default()
}

fn normalize_name(value: &str) -> String {
    let mut result = String::new();
    let mut separator = false;
    for character in value.nfkc().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() {
            if separator && !result.is_empty() {
                result.push('-');
            }
            separator = false;
            result.push(character);
        } else {
            separator = true;
        }
    }
    result
}

fn path_text(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "Workspace recovery path is not valid UTF-8.".to_string())
}

enum GitOriginProbe {
    Absent,
    Digest(String),
    Incomplete,
}

fn git_origin_digest(root: &Path) -> Option<String> {
    match probe_git_origin_digest(root) {
        GitOriginProbe::Digest(digest) => Some(digest),
        GitOriginProbe::Absent | GitOriginProbe::Incomplete => None,
    }
}

fn probe_git_origin_digest(root: &Path) -> GitOriginProbe {
    probe_git_origin_digest_with_timeout(root, GIT_CONFIG_SINGLE_PROBE_TIMEOUT)
}

fn probe_git_origin_digest_with_timeout(root: &Path, timeout: Duration) -> GitOriginProbe {
    let raw_values = match read_effective_local_origins(root, timeout) {
        Ok(Some(values)) => values,
        Ok(None) => return GitOriginProbe::Absent,
        Err(()) => return GitOriginProbe::Incomplete,
    };
    let mut identity: Option<String> = None;
    let mut local = false;
    for raw in raw_values {
        if let Some(candidate) = sanitized_origin_identity(&raw) {
            if local
                || identity
                    .as_ref()
                    .is_some_and(|existing| existing != &candidate)
            {
                return GitOriginProbe::Incomplete;
            }
            identity = Some(candidate);
        } else if origin_is_clearly_local(&raw) {
            if identity.is_some() {
                return GitOriginProbe::Incomplete;
            }
            local = true;
        } else {
            return GitOriginProbe::Incomplete;
        }
    }
    let Some(identity) = identity else {
        return GitOriginProbe::Absent;
    };
    let mut hasher = Sha256::new();
    hasher.update(b"offisim-git-origin-v1\0");
    hasher.update(identity.as_bytes());
    GitOriginProbe::Digest(format!("sha256:{}", hex::encode(hasher.finalize())))
}

fn read_effective_local_origins(root: &Path, timeout: Duration) -> Result<Option<Vec<String>>, ()> {
    if !root.join(".git").exists() {
        return Ok(None);
    }
    let command = effective_git_origin_command(root);
    let (status, stdout) = run_bounded_command(command, timeout)?;
    if status.success() {
        let raw = String::from_utf8(stdout).map_err(|_| ())?;
        let values = raw
            .lines()
            .map(str::trim)
            .map(str::to_owned)
            .collect::<Vec<_>>();
        if values.is_empty() || values.iter().any(|value| value.is_empty()) {
            return Err(());
        }
        return Ok(Some(values));
    }
    if matches!(status.code(), Some(1 | 2)) {
        Ok(None)
    } else {
        Err(())
    }
}

fn effective_git_origin_command(root: &Path) -> Command {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(root)
        // Delegate includes, worktree config, multi-value semantics, and
        // `url.<base>.insteadOf` rewriting to Git itself. Reimplementing any of
        // those rules would make a recovery signature disagree with the
        // repository Git will actually contact.
        .args(["remote", "get-url", "--all", "origin"])
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_COUNT", "0")
        .env_remove("GIT_CONFIG")
        .env_remove("GIT_CONFIG_PARAMETERS")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_COMMON_DIR")
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    command
}

fn run_bounded_command(
    mut command: Command,
    timeout: Duration,
) -> Result<(ExitStatus, Vec<u8>), ()> {
    let mut child = command.spawn().map_err(|_| ())?;
    let mut stdout = child.stdout.take().ok_or(())?;
    let output_reader = thread::spawn(move || {
        let mut output = Vec::new();
        stdout
            .by_ref()
            .take((MAX_GIT_CONFIG_OUTPUT_BYTES + 1) as u64)
            .read_to_end(&mut output)
            .map(|_| output)
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait().map_err(|_| ())? {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = output_reader.join();
                return Err(());
            }
            None => thread::sleep(Duration::from_millis(5)),
        }
    };
    let output = output_reader.join().map_err(|_| ())?.map_err(|_| ())?;
    if output.len() > MAX_GIT_CONFIG_OUTPUT_BYTES {
        return Err(());
    }
    Ok((status, output))
}

fn origin_is_clearly_local(raw: &str) -> bool {
    let value = raw.trim();
    value.starts_with('/')
        || value.starts_with("./")
        || value.starts_with("../")
        || value.starts_with("~/")
        || value.to_ascii_lowercase().starts_with("file://")
        || (!value.contains(':') && (value.contains('/') || value.contains('\\')))
}

fn sanitized_origin_identity(raw: &str) -> Option<String> {
    if let Ok(url) = Url::parse(raw) {
        if !matches!(
            url.scheme(),
            "http"
                | "https"
                | "ssh"
                | "git"
                | "ftp"
                | "ftps"
                | "git+ssh"
                | "ssh+git"
                | "git+http"
                | "git+https"
        ) {
            return None;
        }
        let host = url.host_str()?.trim_end_matches('.').to_ascii_lowercase();
        let scheme = url.scheme();
        let default_port = match scheme {
            "http" | "git+http" => Some(80),
            "https" | "git+https" => Some(443),
            "ssh" | "git+ssh" | "ssh+git" => Some(22),
            "git" => Some(9418),
            "ftp" => Some(21),
            "ftps" => Some(990),
            _ => None,
        };
        let authority = match url.port() {
            Some(port) if Some(port) == default_port => host,
            Some(port) => format!("{scheme}@{host}:{port}"),
            None => host,
        };
        let path = normalize_repo_path(url.path());
        if authority.is_empty() || path.is_empty() {
            return None;
        }
        return Some(format!("{authority}/{path}"));
    }
    let (authority, path) = raw.split_once(':')?;
    if authority.contains('/') || authority.contains('\\') {
        return None;
    }
    let host = authority
        .rsplit_once('@')
        .map(|(_, host)| host)
        .unwrap_or(authority)
        .trim_end_matches('.')
        .to_ascii_lowercase();
    let path = normalize_repo_path(path);
    if host.is_empty() || path.is_empty() {
        None
    } else {
        Some(format!("{host}/{path}"))
    }
}

fn normalize_repo_path(path: &str) -> String {
    path.trim()
        .trim_matches('/')
        .trim_end_matches(".git")
        .trim_end_matches('/')
        .to_string()
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;

    struct TempTree(PathBuf);

    impl TempTree {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "offisim-workspace-recovery-{label}-{}-{}",
                std::process::id(),
                rand::random::<u64>()
            ));
            fs::create_dir_all(&path).expect("create recovery fixture");
            Self(path.canonicalize().expect("canonical recovery fixture"))
        }

        fn child(&self, name: &str) -> PathBuf {
            let path = self.0.join(name);
            fs::create_dir_all(&path).expect("create workspace child");
            path.canonicalize().expect("canonical workspace child")
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    struct CountingScanner {
        calls: AtomicUsize,
        delegate: FilesystemCandidateScanner,
    }

    impl CountingScanner {
        fn new() -> Self {
            Self {
                calls: AtomicUsize::new(0),
                delegate: FilesystemCandidateScanner,
            }
        }
    }

    impl CandidateScanner for CountingScanner {
        fn direct_children(&self, anchors: &[PathBuf], excluded: Option<&Path>) -> CandidateScan {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.delegate.direct_children(anchors, excluded)
        }
    }

    struct SwappingScanner {
        candidate: PathBuf,
        delegate: FilesystemCandidateScanner,
    }

    impl CandidateScanner for SwappingScanner {
        fn direct_children(&self, anchors: &[PathBuf], excluded: Option<&Path>) -> CandidateScan {
            let candidates = self.delegate.direct_children(anchors, excluded);
            if candidates
                .candidates
                .iter()
                .any(|candidate| candidate.canonical_root == self.candidate)
            {
                fs::remove_dir_all(&self.candidate).expect("remove scanned candidate");
                fs::create_dir_all(&self.candidate).expect("replace scanned candidate");
            }
            candidates
        }
    }

    struct IncompleteScanner {
        delegate: FilesystemCandidateScanner,
    }

    impl CandidateScanner for IncompleteScanner {
        fn direct_children(&self, anchors: &[PathBuf], excluded: Option<&Path>) -> CandidateScan {
            let mut scan = self.delegate.direct_children(anchors, excluded);
            scan.complete = false;
            scan
        }
    }

    async fn fixture_pool(root: &Path, project_name: &str) -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open fixture db");
        sqlx::raw_sql(
            r#"
            CREATE TABLE projects (
              project_id TEXT PRIMARY KEY, company_id TEXT NOT NULL, name TEXT NOT NULL,
              workspace_root TEXT NOT NULL, verify_command TEXT,
              verify_max_attempts INTEGER NOT NULL, verify_token_budget INTEGER
            );
            CREATE TABLE chat_threads (thread_id TEXT PRIMARY KEY, project_id TEXT NOT NULL);
            CREATE TABLE project_workspace_authority (
              project_id TEXT PRIMARY KEY, company_id TEXT NOT NULL,
              canonical_root TEXT NOT NULL, root_identity_json TEXT NOT NULL,
              selected_at_unix_ms INTEGER NOT NULL, updated_at_unix_ms INTEGER NOT NULL
            );
            CREATE TABLE task_workspace_binding_history (
              binding_id TEXT PRIMARY KEY, company_id TEXT NOT NULL, project_id TEXT NOT NULL,
              thread_id TEXT NOT NULL, turn_id TEXT NOT NULL DEFAULT 'turn-1',
              access TEXT NOT NULL DEFAULT 'write', canonical_root TEXT NOT NULL,
              root_identity_json TEXT NOT NULL, workspace_basename_normalized TEXT NOT NULL,
              project_name_normalized TEXT NOT NULL, workspace_anchor TEXT NOT NULL,
              git_origin_digest TEXT, recovery_witness_binding_id TEXT,
              recovery_witness_authority_project_id TEXT,
              authority_snapshot_canonical_root TEXT NOT NULL,
              authority_snapshot_root_identity_json TEXT NOT NULL,
              authority_snapshot_updated_at_unix_ms INTEGER NOT NULL,
              source TEXT NOT NULL DEFAULT 'project_catalog', confidence REAL NOT NULL DEFAULT 1.0,
              reason_code TEXT NOT NULL DEFAULT 'current_project_folder',
              issued_at_unix_ms INTEGER NOT NULL, status TEXT NOT NULL
            );
            CREATE TABLE task_workspace_lease_history (
              lease_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
              canonical_worktree TEXT NOT NULL, status TEXT NOT NULL
            );
            CREATE TABLE agent_runs (
              run_id TEXT PRIMARY KEY, root_run_id TEXT NOT NULL, company_id TEXT NOT NULL,
              project_id TEXT, thread_id TEXT NOT NULL, status TEXT NOT NULL
            );
            "#,
        )
        .execute(&pool)
        .await
        .expect("create fixture schema");
        let root_text = path_text(root).expect("root text");
        let identity = serde_json::to_string(&live_identity(root).expect("root identity"))
            .expect("identity json");
        sqlx::query("INSERT INTO projects VALUES ('project-1', 'company-1', ?, ?, NULL, 3, NULL)")
            .bind(project_name)
            .bind(&root_text)
            .execute(&pool)
            .await
            .expect("insert project");
        sqlx::query("INSERT INTO chat_threads VALUES ('thread-1', 'project-1')")
            .execute(&pool)
            .await
            .expect("insert thread");
        sqlx::query(
            "INSERT INTO project_workspace_authority VALUES ('project-1', 'company-1', ?, ?, 1, 1)",
        )
        .bind(root_text)
        .bind(identity)
        .execute(&pool)
        .await
        .expect("insert authority");
        pool
    }

    async fn insert_witness(
        pool: &sqlx::SqlitePool,
        binding_id: &str,
        root: &Path,
        project_name: &str,
        issued_at: i64,
    ) {
        let evidence = capture_workspace_evidence(root, project_name).expect("capture evidence");
        let identity = serde_json::to_string(&live_identity(root).expect("witness identity"))
            .expect("identity json");
        let authority = sqlx::query(
            "SELECT canonical_root, root_identity_json, updated_at_unix_ms FROM project_workspace_authority WHERE project_id = 'project-1'",
        )
        .fetch_one(pool)
        .await
        .expect("read witness authority snapshot");
        sqlx::query(
            r#"
            INSERT INTO task_workspace_binding_history (
              binding_id, company_id, project_id, thread_id, canonical_root,
              root_identity_json, workspace_basename_normalized,
              project_name_normalized, workspace_anchor, git_origin_digest,
              authority_snapshot_canonical_root,
              authority_snapshot_root_identity_json,
              authority_snapshot_updated_at_unix_ms,
              issued_at_unix_ms, status
            ) VALUES (?, 'company-1', 'project-1', 'thread-1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')
            "#,
        )
        .bind(binding_id)
        .bind(path_text(root).expect("witness root"))
        .bind(identity)
        .bind(evidence.basename_normalized)
        .bind(evidence.project_name_normalized)
        .bind(evidence.anchor)
        .bind(evidence.git_origin_digest)
        .bind(
            authority
                .try_get::<String, _>("canonical_root")
                .expect("authority snapshot root"),
        )
        .bind(
            authority
                .try_get::<String, _>("root_identity_json")
                .expect("authority snapshot identity"),
        )
        .bind(
            authority
                .try_get::<i64, _>("updated_at_unix_ms")
                .expect("authority snapshot version"),
        )
        .bind(issued_at)
        .execute(pool)
        .await
        .expect("insert witness");
    }

    async fn insert_interrupted_catalog_binding(
        pool: &sqlx::SqlitePool,
        root: &Path,
        root_identity_json: &str,
    ) {
        let evidence =
            capture_workspace_evidence(root, "Project").expect("capture resume evidence");
        let authority = load_project_workspace(pool, &scope())
            .await
            .expect("load resume authority snapshot");
        sqlx::query(
            r#"
            INSERT INTO task_workspace_binding_history (
              binding_id, company_id, project_id, thread_id, turn_id, access,
              canonical_root, root_identity_json, workspace_basename_normalized,
              project_name_normalized, workspace_anchor, git_origin_digest,
              authority_snapshot_canonical_root,
              authority_snapshot_root_identity_json,
              authority_snapshot_updated_at_unix_ms,
              source, confidence, reason_code, issued_at_unix_ms, status
            ) VALUES (
              'interrupted-1', 'company-1', 'project-1', 'thread-1', 'turn-1', 'write',
              ?, ?, ?, ?, ?, ?, ?, ?, ?, 'project_catalog', 1.0,
              'current_project_folder', 20, 'app_restart'
            )
            "#,
        )
        .bind(path_text(root).expect("resume root text"))
        .bind(root_identity_json)
        .bind(evidence.basename_normalized)
        .bind(evidence.project_name_normalized)
        .bind(evidence.anchor)
        .bind(evidence.git_origin_digest)
        .bind(authority.catalog_root)
        .bind(authority.authority_identity_json)
        .bind(authority.authority_updated_at_unix_ms)
        .execute(pool)
        .await
        .expect("insert interrupted catalog binding");
        sqlx::query(
            "INSERT INTO agent_runs VALUES ('turn-1', 'turn-1', 'company-1', 'project-1', 'thread-1', 'interrupted')",
        )
        .execute(pool)
        .await
        .expect("insert interrupted root run");
    }

    async fn insert_other_project_authority(
        pool: &sqlx::SqlitePool,
        project_id: &str,
        company_id: &str,
        root: &Path,
    ) {
        let root_text = path_text(root).expect("other Project root text");
        let identity = serde_json::to_string(&live_identity(root).expect("other Project identity"))
            .expect("other Project identity json");
        sqlx::query("INSERT INTO projects VALUES (?, ?, 'Other', ?, NULL, 3, NULL)")
            .bind(project_id)
            .bind(company_id)
            .bind(&root_text)
            .execute(pool)
            .await
            .expect("insert other Project");
        sqlx::query("INSERT INTO project_workspace_authority VALUES (?, ?, ?, ?, 1, 1)")
            .bind(project_id)
            .bind(company_id)
            .bind(root_text)
            .bind(identity)
            .execute(pool)
            .await
            .expect("insert other Project authority");
    }

    fn write_origin(root: &Path, url: &str) {
        init_git(root);
        let status = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["config", "--replace-all", "remote.origin.url", url])
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .status()
            .expect("write git origin");
        assert!(status.success(), "git config should write origin");
    }

    fn init_git(root: &Path) {
        if root.join(".git/HEAD").is_file() {
            return;
        }
        let status = Command::new("git")
            .arg("init")
            .arg("--quiet")
            .arg(root)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .status()
            .expect("initialize git fixture");
        assert!(
            status.success(),
            "git init should create fixture repository"
        );
    }

    fn scope() -> WorkspaceRecoveryScope<'static> {
        WorkspaceRecoveryScope {
            company_id: "company-1",
            project_id: "project-1",
            thread_id: "thread-1",
        }
    }

    #[tokio::test]
    async fn current_catalog_match_performs_zero_searches() {
        let tree = TempTree::new("current");
        let root = tree.child("project");
        let pool = fixture_pool(&root, "Project").await;
        let scanner = CountingScanner::new();
        let resolution = resolve_workspace_root_from_pool_with_scanner(&pool, scope(), &scanner)
            .await
            .expect("resolve current root");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Bound(ref root) if root.reason_code() == WorkspaceRecoveryReason::CurrentProjectFolder)
        );
        assert_eq!(scanner.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn home_parent_and_emoji_basename_do_not_block_current_binding() {
        let Some(home) = dirs::home_dir().and_then(|home| home.canonicalize().ok()) else {
            return;
        };
        let random = rand::random::<u64>();
        let emoji_name: String = (0..64)
            .map(|bit| {
                if random & (1_u64 << bit) == 0 {
                    '🧪'
                } else {
                    '🧭'
                }
            })
            .collect();
        let root = home.join(emoji_name);
        fs::create_dir(&root).expect("create direct home workspace");
        let root = root.canonicalize().expect("canonical home workspace");
        let evidence = capture_workspace_evidence(&root, "🧪").expect("capture emoji evidence");
        assert!(evidence.anchor.is_empty());
        assert!(evidence.basename_normalized.is_empty());
        let pool = fixture_pool(&root, "🧪").await;
        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve direct home workspace");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Bound(ref root) if root.reason_code() == WorkspaceRecoveryReason::CurrentProjectFolder)
        );
        fs::remove_dir_all(&root).expect("remove direct home workspace");
    }

    #[tokio::test]
    async fn latest_successful_live_workspace_wins_without_search() {
        let tree = TempTree::new("recent");
        let catalog = tree.child("catalog");
        let recent = tree.child("recent");
        let pool = fixture_pool(&catalog, "Recent").await;
        insert_witness(&pool, "witness-1", &recent, "Recent", 10).await;
        fs::remove_dir_all(&catalog).expect("remove catalog root");
        let scanner = CountingScanner::new();
        let resolution = resolve_workspace_root_from_pool_with_scanner(&pool, scope(), &scanner)
            .await
            .expect("resolve recent root");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Bound(ref root) if root.reason_code() == WorkspaceRecoveryReason::RecentSuccessfulWorkspace && root.canonical_root == recent)
        );
        assert_eq!(scanner.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn same_project_active_conversation_does_not_block_recent_workspace() {
        let tree = TempTree::new("same-project-active");
        let catalog = tree.child("catalog");
        let recent = tree.child("recent");
        let pool = fixture_pool(&catalog, "Recent").await;
        insert_witness(&pool, "witness-1", &recent, "Recent", 10).await;
        sqlx::query("INSERT INTO chat_threads VALUES ('thread-2', 'project-1')")
            .execute(&pool)
            .await
            .expect("insert second Conversation");
        let evidence = capture_workspace_evidence(&recent, "Recent").expect("recent evidence");
        let identity = serde_json::to_string(&live_identity(&recent).expect("recent identity"))
            .expect("recent identity json");
        let authority = load_project_workspace(&pool, &scope())
            .await
            .expect("load authority snapshot");
        sqlx::query(
            r#"
            INSERT INTO task_workspace_binding_history (
              binding_id, company_id, project_id, thread_id, canonical_root,
              root_identity_json, workspace_basename_normalized,
              project_name_normalized, workspace_anchor, git_origin_digest,
              authority_snapshot_canonical_root,
              authority_snapshot_root_identity_json,
              authority_snapshot_updated_at_unix_ms,
              issued_at_unix_ms, status
            ) VALUES ('active-other-thread', 'company-1', 'project-1', 'thread-2',
              ?, ?, ?, ?, ?, ?, ?, ?, ?, 20, 'active')
            "#,
        )
        .bind(path_text(&recent).expect("recent path"))
        .bind(identity)
        .bind(evidence.basename_normalized)
        .bind(evidence.project_name_normalized)
        .bind(evidence.anchor)
        .bind(evidence.git_origin_digest)
        .bind(authority.catalog_root)
        .bind(authority.authority_identity_json)
        .bind(authority.authority_updated_at_unix_ms)
        .execute(&pool)
        .await
        .expect("insert same-Project active binding");
        fs::remove_dir_all(&catalog).expect("remove catalog root");

        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve shared Project workspace");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Bound(ref root)
                if root.reason_code() == WorkspaceRecoveryReason::RecentSuccessfulWorkspace
                    && root.canonical_root == recent),
            "Project-level workspace sharing must not become Conversation-exclusive"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn renamed_same_object_recovers_at_high_confidence() {
        let tree = TempTree::new("renamed");
        let catalog = tree.child("old-name");
        let pool = fixture_pool(&catalog, "Project").await;
        insert_witness(&pool, "witness-1", &catalog, "Project", 10).await;
        let renamed = tree.0.join("new-name");
        fs::rename(&catalog, &renamed).expect("rename workspace");
        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve renamed root");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Bound(ref root) if root.reason_code() == WorkspaceRecoveryReason::RenamedSameFilesystemObject && root.confidence == 0.99 && root.canonical_root == renamed)
        );
    }

    #[tokio::test]
    async fn unique_project_name_and_sanitized_origin_recovers() {
        let tree = TempTree::new("repo");
        let catalog = tree.child("original");
        write_origin(
            &catalog,
            "https://secret-token@example.com/Org/Repo.git?credential=bad",
        );
        let pool = fixture_pool(&catalog, "Recovered Project").await;
        insert_witness(&pool, "witness-1", &catalog, "Recovered Project", 10).await;
        fs::remove_dir_all(&catalog).expect("remove original");
        let recovered = tree.child("recovered-project");
        write_origin(&recovered, "git@example.com:Org/Repo.git");
        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve repository root");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Bound(ref root) if root.reason_code() == WorkspaceRecoveryReason::UniqueNameRepoIdentityMatch && root.confidence == 0.95 && root.canonical_root == recovered)
        );
        let digest = git_origin_digest(&recovered).expect("origin digest");
        assert!(!digest.contains("secret-token"));
        assert!(!digest.contains("example.com"));
    }

    #[tokio::test]
    async fn repository_match_rejects_effective_origin_change_before_binding_issuance() {
        let tree = TempTree::new("repo-origin-toctou");
        let catalog = tree.child("original");
        write_origin(&catalog, "ssh://git@example.com/org/repo.git");
        let pool = fixture_pool(&catalog, "Recovered Project").await;
        insert_witness(&pool, "witness-1", &catalog, "Recovered Project", 10).await;
        fs::remove_dir_all(&catalog).expect("remove original Project root");

        let recovered = tree.child("recovered-project");
        write_origin(&recovered, "git@example.com:org/repo.git");
        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve repository-matched root");
        let WorkspaceRootResolution::Bound(resolved) = resolution else {
            panic!("repository-matched root should bind");
        };
        assert_eq!(
            resolved.reason_code(),
            WorkspaceRecoveryReason::UniqueNameRepoIdentityMatch
        );

        write_origin(&recovered, "git@example.com:other/repository.git");
        let current_identity = live_identity(&recovered).expect("inspect unchanged root identity");
        let selected_identity: StoredRootIdentity =
            serde_json::from_str(&resolved.root_identity_json).expect("decode selected identity");
        assert_eq!(current_identity, selected_identity);
        assert_eq!(
            resolved.verify_initial_recovery_issuance().expect_err(
                "same-inode origin replacement must fail the capability publication recheck"
            ),
            "Recovered Project repository identity changed before binding issuance."
        );
    }

    #[tokio::test]
    async fn foreign_company_project_authority_root_is_never_recovered() {
        let tree = TempTree::new("foreign-company-root");
        let catalog = tree.child("original");
        write_origin(&catalog, "ssh://git@example.com/org/repo.git");
        let pool = fixture_pool(&catalog, "Recovered Project").await;
        insert_witness(&pool, "witness-1", &catalog, "Recovered Project", 10).await;
        fs::remove_dir_all(&catalog).expect("remove original Project root");

        let occupied = tree.child("recovered-project");
        write_origin(&occupied, "git@example.com:org/repo.git");
        insert_other_project_authority(&pool, "project-foreign", "company-foreign", &occupied)
            .await;
        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve beside foreign authority");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Unavailable(ref unavailable)
                if unavailable.reason_code == WorkspaceRecoveryReason::Ambiguous && unavailable.candidate_count == 1),
            "machine-local root ownership must remain global across Companies"
        );
    }

    #[tokio::test]
    async fn active_worktree_lease_root_is_never_recovered_as_a_project_workspace() {
        let tree = TempTree::new("active-lease-root");
        let catalog = tree.child("original");
        write_origin(&catalog, "ssh://git@example.com/org/repo.git");
        let pool = fixture_pool(&catalog, "Recovered Project").await;
        insert_witness(&pool, "witness-1", &catalog, "Recovered Project", 10).await;
        fs::remove_dir_all(&catalog).expect("remove original Project root");

        let occupied = tree.child("recovered-project");
        write_origin(&occupied, "git@example.com:org/repo.git");
        sqlx::query(
            "INSERT INTO task_workspace_lease_history VALUES ('lease-active', 'project-1', ?, 'active')",
        )
        .bind(path_text(&occupied).expect("leased worktree path"))
        .execute(&pool)
        .await
        .expect("insert active worktree lease");

        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve beside active lease");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Unavailable(ref unavailable)
                if unavailable.reason_code == WorkspaceRecoveryReason::Ambiguous && unavailable.candidate_count == 1),
            "an active worktree lease must globally reserve its canonical path"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn authoritative_inode_rename_beats_history_cap_and_broken_origin() {
        let tree = TempTree::new("authority-inode-tier");
        let catalog = tree.child("old-name");
        write_origin(&catalog, "ssh://git@example.com/org/repo.git");
        let pool = fixture_pool(&catalog, "Project").await;
        for issued_at in 0..=MAX_WITNESSES {
            insert_witness(
                &pool,
                &format!("witness-{issued_at}"),
                &catalog,
                "Project",
                issued_at,
            )
            .await;
        }
        let renamed = tree.0.join("Project");
        fs::rename(&catalog, &renamed).expect("rename authoritative inode");
        let mut config =
            fs::read_to_string(renamed.join(".git/config")).expect("read renamed git config");
        config.push_str("\n[broken\n");
        fs::write(renamed.join(".git/config"), config).expect("corrupt relevant git config");

        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve authoritative inode despite lower-tier gaps");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Bound(ref root)
                if root.reason_code() == WorkspaceRecoveryReason::RenamedSameFilesystemObject
                    && root.canonical_root == renamed),
            "current Project authority inode is stronger than capped history or repo metadata"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn emoji_inode_rename_beats_a_competing_name_and_repo_clone() {
        let tree = TempTree::new("emoji-inode-tier");
        let catalog = tree.child("🧪");
        write_origin(&catalog, "ssh://git@example.com/org/repo.git");
        let pool = fixture_pool(&catalog, "Recovered Project").await;
        insert_witness(&pool, "witness-1", &catalog, "Recovered Project", 10).await;
        let renamed = tree.0.join("🧭");
        fs::rename(&catalog, &renamed).expect("rename emoji workspace");
        let competing = tree.child("recovered-project");
        write_origin(&competing, "git@example.com:org/repo.git");

        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve emoji inode");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Bound(ref root)
                if root.reason_code() == WorkspaceRecoveryReason::RenamedSameFilesystemObject
                    && root.canonical_root == renamed),
            "an empty normalized basename must never erase exact inode evidence"
        );
    }

    #[tokio::test]
    async fn unique_repository_match_can_move_to_another_known_company_anchor() {
        let original_tree = TempTree::new("cross-anchor-original");
        let destination_tree = TempTree::new("cross-anchor-destination");
        let catalog = original_tree.child("original");
        write_origin(&catalog, "ssh://git@example.com/Org/Repo.git");
        let pool = fixture_pool(&catalog, "Recovered Project").await;
        insert_witness(&pool, "witness-1", &catalog, "Recovered Project", 10).await;

        let other_project = destination_tree.child("other-project");
        let other_identity =
            serde_json::to_string(&live_identity(&other_project).expect("other identity"))
                .expect("other identity json");
        sqlx::query(
            "INSERT INTO projects VALUES ('project-2', 'company-1', 'Other', ?, NULL, 3, NULL)",
        )
        .bind(path_text(&other_project).expect("other project path"))
        .execute(&pool)
        .await
        .expect("insert other Project");
        sqlx::query(
            "INSERT INTO project_workspace_authority VALUES ('project-2', 'company-1', ?, ?, 1, 1)",
        )
        .bind(path_text(&other_project).expect("other authority path"))
        .bind(other_identity)
        .execute(&pool)
        .await
        .expect("insert other authority");

        fs::remove_dir_all(&catalog).expect("remove original workspace");
        let recovered = destination_tree.child("recovered-project");
        write_origin(&recovered, "git@example.com:Org/Repo.git");
        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve across known anchor");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Bound(ref root) if root.reason_code() == WorkspaceRecoveryReason::UniqueNameRepoIdentityMatch && root.canonical_root == recovered)
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn candidate_inode_swap_after_scan_fails_signing_recheck() {
        let tree = TempTree::new("inode-swap");
        let catalog = tree.child("old-name");
        let pool = fixture_pool(&catalog, "Project").await;
        insert_witness(&pool, "witness-1", &catalog, "Project", 10).await;
        let candidate = tree.0.join("new-name");
        fs::rename(&catalog, &candidate).expect("rename candidate");
        let scanner = SwappingScanner {
            candidate: candidate.clone(),
            delegate: FilesystemCandidateScanner,
        };
        let resolution = resolve_workspace_root_from_pool_with_scanner(&pool, scope(), &scanner)
            .await
            .expect("resolve swapped candidate");
        let WorkspaceRootResolution::Bound(resolved) = resolution else {
            panic!("candidate should have matched before swap");
        };
        assert!(resolved.verify_live().is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn injected_truncated_scan_never_signs_an_observed_unique_match() {
        let tree = TempTree::new("truncated-scan");
        let catalog = tree.child("old-name");
        write_origin(&catalog, "git@example.com:org/project.git");
        let pool = fixture_pool(&catalog, "Project").await;
        insert_witness(&pool, "witness-1", &catalog, "Project", 10).await;
        fs::remove_dir_all(&catalog).expect("remove authoritative object");
        let candidate = tree.0.join("Project");
        write_origin(&candidate, "git@example.com:org/project.git");
        let scanner = IncompleteScanner {
            delegate: FilesystemCandidateScanner,
        };
        let resolution = resolve_workspace_root_from_pool_with_scanner(&pool, scope(), &scanner)
            .await
            .expect("resolve incomplete scan");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Unavailable(ref unavailable)
                if unavailable.reason_code == WorkspaceRecoveryReason::Ambiguous && unavailable.candidate_count == 1),
            "an incomplete scan must report only the observed match and never sign uniqueness"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn truncated_successful_witness_query_never_signs_an_observed_unique_match() {
        let tree_a = TempTree::new("truncated-witness-a");
        let tree_b = TempTree::new("truncated-witness-b");
        let catalog = tree_a.child("old-a");
        let old_b = tree_b.child("old-b");
        write_origin(&catalog, "git@example.com:org/project.git");
        write_origin(&old_b, "git@example.com:org/project.git");
        let pool = fixture_pool(&catalog, "Project").await;
        insert_witness(&pool, "witness-oldest", &old_b, "Project", 0).await;
        for index in 0..MAX_WITNESSES {
            insert_witness(
                &pool,
                &format!("witness-a-{index:03}"),
                &catalog,
                "Project",
                index + 1,
            )
            .await;
        }
        let recovered_a = tree_a.0.join("Project");
        write_origin(&recovered_a, "git@example.com:org/project.git");
        fs::remove_dir_all(&catalog).expect("remove authoritative object");
        fs::rename(&old_b, tree_b.0.join("Project")).expect("move truncated witness root");

        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve truncated successful witnesses");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Unavailable(ref unavailable)
                if unavailable.reason_code == WorkspaceRecoveryReason::Ambiguous && unavailable.candidate_count > 0),
            "a truncated witness set must never sign the only observed match"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn invalid_successful_witness_never_signs_an_observed_unique_match() {
        let tree = TempTree::new("invalid-witness");
        let catalog = tree.child("old-name");
        write_origin(&catalog, "git@example.com:org/project.git");
        let pool = fixture_pool(&catalog, "Project").await;
        insert_witness(&pool, "witness-valid", &catalog, "Project", 10).await;
        insert_witness(&pool, "witness-corrupt", &catalog, "Project", 20).await;
        sqlx::query(
            "UPDATE task_workspace_binding_history SET root_identity_json = '{' WHERE binding_id = 'witness-corrupt'",
        )
        .execute(&pool)
        .await
        .expect("corrupt newest witness identity");
        fs::remove_dir_all(&catalog).expect("remove authoritative object");
        let candidate = tree.0.join("Project");
        write_origin(&candidate, "git@example.com:org/project.git");

        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve invalid successful witness");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Unavailable(ref unavailable)
                if unavailable.reason_code == WorkspaceRecoveryReason::Ambiguous && unavailable.candidate_count == 1),
            "an undecodable witness must never be silently omitted from uniqueness proof"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn truncated_known_anchor_query_never_signs_an_observed_unique_match() {
        let tree = TempTree::new("truncated-anchors");
        let catalog = tree.child("old-name");
        write_origin(&catalog, "git@example.com:org/project.git");
        let pool = fixture_pool(&catalog, "Project").await;
        insert_witness(&pool, "witness-1", &catalog, "Project", 10).await;
        for index in 0..=MAX_KNOWN_ANCHOR_ROWS {
            let project_id = format!("anchor-project-{index:03}");
            let root = format!("/fixture/anchor-{index:03}/project");
            sqlx::query("INSERT INTO projects VALUES (?, 'company-1', 'Anchor', ?, NULL, 3, NULL)")
                .bind(&project_id)
                .bind(&root)
                .execute(&pool)
                .await
                .expect("insert bounded anchor Project");
            sqlx::query(
                "INSERT INTO project_workspace_authority VALUES (?, 'company-1', ?, '{}', 1, 1)",
            )
            .bind(&project_id)
            .bind(&root)
            .execute(&pool)
            .await
            .expect("insert bounded anchor authority");
        }
        fs::remove_dir_all(&catalog).expect("remove authoritative object");
        let candidate = tree.0.join("Project");
        write_origin(&candidate, "git@example.com:org/project.git");
        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve truncated known anchors");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Unavailable(ref unavailable)
                if unavailable.reason_code == WorkspaceRecoveryReason::Ambiguous && unavailable.candidate_count == 1),
            "LIMIT truncation must fail closed even when the scanned subset has one match"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn interrupted_recovered_binding_resumes_with_original_provenance() {
        let tree = TempTree::new("recovered-resume");
        let original = tree.child("old-name");
        let pool = fixture_pool(&original, "Project").await;
        insert_witness(&pool, "witness-1", &original, "Project", 10).await;
        let recovered = tree.0.join("new-name");
        fs::rename(&original, &recovered).expect("rename recovered workspace");
        let evidence = capture_workspace_evidence(&recovered, "Project").expect("resume evidence");
        let identity =
            serde_json::to_string(&live_identity(&recovered).expect("recovered resume identity"))
                .expect("resume identity json");
        let authority = load_project_workspace(&pool, &scope())
            .await
            .expect("load resume authority snapshot");
        sqlx::query(
            r#"
            INSERT INTO task_workspace_binding_history (
              binding_id, company_id, project_id, thread_id, turn_id, access,
              canonical_root, root_identity_json, workspace_basename_normalized,
              project_name_normalized, workspace_anchor, git_origin_digest,
              recovery_witness_binding_id, authority_snapshot_canonical_root,
              authority_snapshot_root_identity_json,
              authority_snapshot_updated_at_unix_ms,
              source, confidence, reason_code,
              issued_at_unix_ms, status
            ) VALUES (
              'interrupted-1', 'company-1', 'project-1', 'thread-1', 'turn-1', 'write',
              ?, ?, ?, ?, ?, ?, 'witness-1', ?, ?, ?, 'known_root_recovery', 0.99,
              'renamed_same_filesystem_object', 20, 'app_restart'
            )
            "#,
        )
        .bind(path_text(&recovered).expect("recovered path"))
        .bind(identity)
        .bind(evidence.basename_normalized)
        .bind(evidence.project_name_normalized)
        .bind(evidence.anchor)
        .bind(evidence.git_origin_digest)
        .bind(authority.catalog_root)
        .bind(authority.authority_identity_json)
        .bind(authority.authority_updated_at_unix_ms)
        .execute(&pool)
        .await
        .expect("insert interrupted recovered binding");
        sqlx::query(
            "INSERT INTO agent_runs VALUES ('turn-1', 'turn-1', 'company-1', 'project-1', 'thread-1', 'interrupted')",
        )
        .execute(&pool)
        .await
        .expect("insert interrupted root run");
        let resolved = resolve_resumed_workspace_root_from_pool(
            &pool,
            scope(),
            "interrupted-1",
            "turn-1",
            "write",
        )
        .await
        .expect("resolve recovered resume");
        assert_eq!(
            resolved.source(),
            WorkspaceRecoverySource::KnownRootRecovery
        );
        assert_eq!(
            resolved.recovery_witness_binding_id.as_deref(),
            Some("witness-1")
        );
        resolved.verify_live().expect("resume root remains live");
    }

    #[tokio::test]
    async fn malformed_interrupted_identity_is_incompatible_not_operational() {
        let tree = TempTree::new("resume-malformed-identity");
        let root = tree.child("project");
        let pool = fixture_pool(&root, "Project").await;
        insert_interrupted_catalog_binding(&pool, &root, "{not-json").await;

        let error = resolve_resumed_workspace_root_from_pool(
            &pool,
            scope(),
            "interrupted-1",
            "turn-1",
            "write",
        )
        .await
        .expect_err("malformed durable identity must reject Resume");
        assert!(matches!(
            error,
            ResumedWorkspaceRootError::Incompatible(ref message)
                if message.contains("interrupted workspace identity is invalid")
        ));
    }

    #[tokio::test]
    async fn unknown_durable_workspace_protocol_values_reject_resume_at_db_boundary() {
        for (column, value, expected_message) in [
            ("source", "future_source", "workspace source is unsupported"),
            (
                "reason_code",
                "future_reason",
                "workspace reason is unsupported",
            ),
        ] {
            let tree = TempTree::new(column);
            let root = tree.child("project");
            let pool = fixture_pool(&root, "Project").await;
            let identity =
                serde_json::to_string(&live_identity(&root).expect("resume root identity"))
                    .expect("resume identity json");
            insert_interrupted_catalog_binding(&pool, &root, &identity).await;
            sqlx::query(&format!(
                "UPDATE task_workspace_binding_history SET {column} = ? WHERE binding_id = 'interrupted-1'"
            ))
            .bind(value)
            .execute(&pool)
            .await
            .expect("corrupt durable workspace protocol value");

            let error = resolve_resumed_workspace_root_from_pool(
                &pool,
                scope(),
                "interrupted-1",
                "turn-1",
                "write",
            )
            .await
            .expect_err("unknown durable workspace protocol value must reject Resume");
            assert!(matches!(
                error,
                ResumedWorkspaceRootError::Incompatible(ref message)
                    if message.contains(expected_message)
            ));
        }
    }

    #[test]
    fn bound_workspace_provenance_accepts_only_exact_source_reason_pairs() {
        let sources = [
            WorkspaceRecoverySource::ProjectCatalog,
            WorkspaceRecoverySource::ConversationHistory,
            WorkspaceRecoverySource::KnownRootRecovery,
            WorkspaceRecoverySource::ResumeHistory,
            WorkspaceRecoverySource::WorkspaceRecovery,
        ];
        let reasons = [
            WorkspaceRecoveryReason::CurrentProjectFolder,
            WorkspaceRecoveryReason::RecentSuccessfulWorkspace,
            WorkspaceRecoveryReason::RenamedSameFilesystemObject,
            WorkspaceRecoveryReason::UniqueNameRepoIdentityMatch,
            WorkspaceRecoveryReason::ResumeHistoryIdentityMatch,
            WorkspaceRecoveryReason::None,
            WorkspaceRecoveryReason::Ambiguous,
        ];
        let expected = [
            (
                WorkspaceRecoverySource::ProjectCatalog,
                WorkspaceRecoveryReason::CurrentProjectFolder,
            ),
            (
                WorkspaceRecoverySource::ConversationHistory,
                WorkspaceRecoveryReason::RecentSuccessfulWorkspace,
            ),
            (
                WorkspaceRecoverySource::KnownRootRecovery,
                WorkspaceRecoveryReason::RenamedSameFilesystemObject,
            ),
            (
                WorkspaceRecoverySource::KnownRootRecovery,
                WorkspaceRecoveryReason::UniqueNameRepoIdentityMatch,
            ),
            (
                WorkspaceRecoverySource::ResumeHistory,
                WorkspaceRecoveryReason::ResumeHistoryIdentityMatch,
            ),
        ];

        for source in sources {
            for reason in reasons {
                assert_eq!(
                    WorkspaceBoundProvenance::from_wire(source, reason).is_some(),
                    expected.contains(&(source, reason)),
                    "unexpected bound provenance decision for {source:?}/{reason:?}"
                );
            }
        }
    }

    #[tokio::test]
    async fn known_protocol_values_in_an_invalid_pair_reject_resume() {
        let tree = TempTree::new("resume-invalid-provenance-pair");
        let root = tree.child("project");
        let pool = fixture_pool(&root, "Project").await;
        let identity = serde_json::to_string(&live_identity(&root).expect("resume root identity"))
            .expect("resume identity json");
        insert_interrupted_catalog_binding(&pool, &root, &identity).await;
        sqlx::query(
            "UPDATE task_workspace_binding_history SET reason_code = 'recent_successful_workspace' WHERE binding_id = 'interrupted-1'",
        )
        .execute(&pool)
        .await
        .expect("corrupt durable provenance pair");

        let error = resolve_resumed_workspace_root_from_pool(
            &pool,
            scope(),
            "interrupted-1",
            "turn-1",
            "write",
        )
        .await
        .expect_err("known source/reason values in an invalid pair must reject Resume");
        assert!(matches!(
            error,
            ResumedWorkspaceRootError::Incompatible(ref message)
                if message.contains("do not form a valid provenance pair")
        ));
    }

    #[tokio::test]
    async fn durable_validator_rejects_an_invalid_source_reason_pair() {
        let tree = TempTree::new("durable-invalid-provenance-pair");
        let root = tree.child("project");
        let pool = fixture_pool(&root, "Project").await;
        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve current root");
        let WorkspaceRootResolution::Bound(resolved) = resolution else {
            panic!("current Project root should bind");
        };

        let valid = durable_binding_is_valid(
            &pool,
            DurableBindingEvidence {
                binding_id: "invalid-pair",
                company_id: "company-1",
                project_id: "project-1",
                thread_id: "thread-1",
                canonical_root: &resolved.canonical_root,
                root_identity_json: &resolved.root_identity_json,
                source: WorkspaceRecoverySource::ProjectCatalog,
                reason_code: WorkspaceRecoveryReason::RecentSuccessfulWorkspace,
                basename_normalized: &resolved.evidence.basename_normalized,
                anchor: &resolved.evidence.anchor,
                git_origin_digest: resolved.evidence.git_origin_digest.as_deref(),
                recovery_witness_binding_id: None,
                recovery_witness_authority_project_id: None,
                authority_snapshot_canonical_root: &resolved.authority_snapshot_canonical_root,
                authority_snapshot_root_identity_json: &resolved
                    .authority_snapshot_root_identity_json,
                authority_snapshot_updated_at_unix_ms: resolved
                    .authority_snapshot_updated_at_unix_ms,
            },
        )
        .await
        .expect("validate intentionally mismatched durable provenance");
        assert!(!valid);
    }

    #[test]
    fn workspace_recovery_protocol_enums_serialize_exact_wire_values() {
        assert_eq!(
            serde_json::to_string(&WorkspaceRecoverySource::KnownRootRecovery)
                .expect("serialize workspace source"),
            r#""known_root_recovery""#
        );
        assert_eq!(
            serde_json::to_string(&WorkspaceRecoveryReason::UniqueNameRepoIdentityMatch)
                .expect("serialize workspace reason"),
            r#""unique_name_repo_identity_match""#
        );
        assert!(serde_json::from_str::<WorkspaceRecoverySource>(r#""future_source""#).is_err());
        assert!(serde_json::from_str::<WorkspaceRecoveryReason>(r#""future_reason""#).is_err());
    }

    #[tokio::test]
    async fn invalid_interrupted_verify_values_are_incompatible_not_operational() {
        for (column, value, expected_message) in [
            (
                "verify_max_attempts",
                0_i64,
                "verification attempts are invalid",
            ),
            (
                "verify_token_budget",
                0_i64,
                "verification token budget is invalid",
            ),
        ] {
            let tree = TempTree::new(column);
            let root = tree.child("project");
            let pool = fixture_pool(&root, "Project").await;
            let identity =
                serde_json::to_string(&live_identity(&root).expect("resume root identity"))
                    .expect("resume identity json");
            insert_interrupted_catalog_binding(&pool, &root, &identity).await;
            sqlx::query(&format!("UPDATE projects SET {column} = ?"))
                .bind(value)
                .execute(&pool)
                .await
                .expect("corrupt durable Project verification setting");

            let error = resolve_resumed_workspace_root_from_pool(
                &pool,
                scope(),
                "interrupted-1",
                "turn-1",
                "write",
            )
            .await
            .expect_err("invalid durable verification setting must reject Resume");
            assert!(matches!(
                error,
                ResumedWorkspaceRootError::Incompatible(ref message)
                    if message.contains(expected_message)
            ));
        }
    }

    #[test]
    fn resumed_live_match_preserves_filesystem_error_taxonomy() {
        let tree = TempTree::new("resume-live-taxonomy");
        let root = tree.child("project");
        let expected = live_identity(&root).expect("live root identity");

        for (kind, fixture_message) in [
            (io::ErrorKind::PermissionDenied, "fixture permission denied"),
            (io::ErrorKind::Interrupted, "fixture transient interruption"),
        ] {
            let operational_error = resumed_live_matching_root_with(
                &root,
                &expected,
                |_| Err(io::Error::new(kind, fixture_message)),
                |_| unreachable!("canonicalize must not run after metadata failure"),
            )
            .expect_err("filesystem failure must stay operational");
            assert!(matches!(
                operational_error,
                ResumedWorkspaceRootError::Operational(ref message)
                    if message.contains(fixture_message)
            ));
        }

        let missing = tree.0.join("missing");
        let missing_error = resumed_live_matching_root(&missing, &expected)
            .expect_err("missing exact workspace must be incompatible");
        assert!(matches!(
            missing_error,
            ResumedWorkspaceRootError::Incompatible(_)
        ));

        let file = tree.0.join("not-a-directory");
        fs::write(&file, b"fixture").expect("write non-directory fixture");
        assert!(matches!(
            resumed_live_matching_root(&file, &expected),
            Err(ResumedWorkspaceRootError::Incompatible(_))
        ));

        let replacement = tree.child("replacement");
        assert!(matches!(
            resumed_live_matching_root(&replacement, &expected),
            Err(ResumedWorkspaceRootError::Incompatible(_))
        ));

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;

            let redirected = tree.0.join("redirected");
            symlink(&root, &redirected).expect("create redirected workspace fixture");
            assert!(matches!(
                resumed_live_matching_root(&redirected, &expected),
                Err(ResumedWorkspaceRootError::Incompatible(_))
            ));

            let real_parent = tree.child("real-parent");
            let nested_root = real_parent.join("nested");
            fs::create_dir_all(&nested_root).expect("create nested workspace fixture");
            let redirected_parent = tree.0.join("redirected-parent");
            symlink(&real_parent, &redirected_parent).expect("create redirected parent fixture");
            let redirected_nested = redirected_parent.join("nested");
            let nested_expected = live_identity(&nested_root).expect("nested live identity");
            assert!(matches!(
                resumed_live_matching_root(&redirected_nested, &nested_expected),
                Err(ResumedWorkspaceRootError::Incompatible(_))
            ));
        }
    }

    #[tokio::test]
    async fn remote_change_does_not_revoke_live_root_identity() {
        let tree = TempTree::new("remote-change");
        let root = tree.child("project");
        write_origin(&root, "ssh://git@example.com/Org/Repo.git");
        let pool = fixture_pool(&root, "Project").await;
        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve current root");
        let WorkspaceRootResolution::Bound(resolved) = resolution else {
            panic!("current root should bind");
        };
        write_origin(&root, "ssh://git@example.com/Other/Repo.git");
        resolved
            .verify_live()
            .expect("non-repository-match roots do not depend on Git origin identity");
        let valid = durable_binding_is_valid(
            &pool,
            DurableBindingEvidence {
                binding_id: "live-binding",
                company_id: "company-1",
                project_id: "project-1",
                thread_id: "thread-1",
                canonical_root: &resolved.canonical_root,
                root_identity_json: &resolved.root_identity_json,
                source: resolved.source(),
                reason_code: resolved.reason_code(),
                basename_normalized: &resolved.evidence.basename_normalized,
                anchor: &resolved.evidence.anchor,
                git_origin_digest: resolved.evidence.git_origin_digest.as_deref(),
                recovery_witness_binding_id: None,
                recovery_witness_authority_project_id: None,
                authority_snapshot_canonical_root: &resolved.authority_snapshot_canonical_root,
                authority_snapshot_root_identity_json: &resolved
                    .authority_snapshot_root_identity_json,
                authority_snapshot_updated_at_unix_ms: resolved
                    .authority_snapshot_updated_at_unix_ms,
            },
        )
        .await
        .expect("validate current binding after remote change");
        assert!(valid);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn recovered_binding_keeps_full_worktree_lease_authority_without_catalog_mutation() {
        let tree = TempTree::new("lease-authority");
        let original = tree.child("old-name");
        let original_identity =
            serde_json::to_string(&live_identity(&original).expect("original identity"))
                .expect("original identity json");
        let original_evidence =
            capture_workspace_evidence(&original, "Project").expect("original evidence");
        let recovered = tree.0.join("new-name");
        fs::rename(&original, &recovered).expect("rename lease workspace");
        let recovered_identity =
            serde_json::to_string(&live_identity(&recovered).expect("recovered identity"))
                .expect("recovered identity json");
        let recovered_evidence =
            capture_workspace_evidence(&recovered, "Project").expect("recovered evidence");

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open full schema db");
        sqlx::raw_sql(include_str!("../../../../packages/db-local/src/schema.sql"))
            .execute(&pool)
            .await
            .expect("apply full schema");
        sqlx::query(
            "INSERT INTO companies (company_id, name, status, created_at, updated_at) VALUES ('company-1', 'Company', 'active', 'now', 'now')",
        )
        .execute(&pool)
        .await
        .expect("insert company");
        sqlx::query(
            r#"
            INSERT INTO projects (
              project_id, company_id, name, status, workspace_root,
              verify_max_attempts, created_at, updated_at
            ) VALUES ('project-1', 'company-1', 'Project', 'active', ?, 3, 'now', 'now')
            "#,
        )
        .bind(path_text(&original).expect("original catalog path"))
        .execute(&pool)
        .await
        .expect("insert Project catalog");
        sqlx::query(
            "INSERT INTO project_workspace_authority VALUES ('project-1', 'company-1', ?, ?, 1, 1)",
        )
        .bind(path_text(&original).expect("original authority path"))
        .bind(&original_identity)
        .execute(&pool)
        .await
        .expect("insert Project authority");
        sqlx::query(
            "INSERT INTO chat_threads (thread_id, project_id, created_at, updated_at) VALUES ('thread-1', 'project-1', 'now', 'now')",
        )
        .execute(&pool)
        .await
        .expect("insert Conversation");

        let insert_recovered_sql = r#"
            INSERT INTO task_workspace_binding_history (
              binding_id, company_id, project_id, thread_id, turn_id, request_id,
              access, canonical_root, root_identity_json,
              workspace_basename_normalized, project_name_normalized,
              workspace_anchor, git_origin_digest, recovery_witness_binding_id,
              recovery_witness_authority_project_id,
              authority_snapshot_canonical_root,
              authority_snapshot_root_identity_json,
              authority_snapshot_updated_at_unix_ms,
              source, confidence, reason_code,
              issued_at_unix_ms, expires_at_unix_ms, activated_at_unix_ms,
              last_used_at_unix_ms, status
            ) VALUES (
              ?, 'company-1', 'project-1', 'thread-1', 'root-run', ?, 'write',
              ?, ?, ?, ?, ?, ?, 'witness-1', NULL, ?, ?, 1,
              'known_root_recovery', 0.99, 'renamed_same_filesystem_object',
              2, 999999, 2, 2, 'active'
            )
            "#;
        sqlx::query(
            r#"
            INSERT INTO task_workspace_binding_history (
              binding_id, company_id, project_id, thread_id, turn_id, request_id,
              access, canonical_root, root_identity_json,
              workspace_basename_normalized, project_name_normalized,
              workspace_anchor, git_origin_digest,
              authority_snapshot_canonical_root,
              authority_snapshot_root_identity_json,
              authority_snapshot_updated_at_unix_ms,
              source, confidence, reason_code,
              issued_at_unix_ms, expires_at_unix_ms, activated_at_unix_ms,
              last_used_at_unix_ms, status
            ) VALUES (
              'witness-1', 'company-1', 'project-1', 'thread-1', 'old-run',
              'old-request', 'write', ?, ?, ?, ?, ?, ?, ?, ?, 1, 'project_catalog', 1.0,
              'current_project_folder', 1, 2, 1, 1, 'completed'
            )
            "#,
        )
        .bind(path_text(&original).expect("witness path"))
        .bind(&original_identity)
        .bind(&original_evidence.basename_normalized)
        .bind(&original_evidence.project_name_normalized)
        .bind(&original_evidence.anchor)
        .bind(&original_evidence.git_origin_digest)
        .bind(path_text(&original).expect("witness authority snapshot root"))
        .bind(&original_identity)
        .execute(&pool)
        .await
        .expect("insert completed witness");
        for (binding_id, request_id) in [("recovered-1", "request-1"), ("recovered-2", "request-2")]
        {
            sqlx::query(insert_recovered_sql)
                .bind(binding_id)
                .bind(request_id)
                .bind(path_text(&recovered).expect("recovered binding path"))
                .bind(&recovered_identity)
                .bind(&recovered_evidence.basename_normalized)
                .bind(&recovered_evidence.project_name_normalized)
                .bind(&recovered_evidence.anchor)
                .bind(&recovered_evidence.git_origin_digest)
                .bind(path_text(&original).expect("recovered authority snapshot root"))
                .bind(&original_identity)
                .execute(&pool)
                .await
                .expect("insert recovered binding");
        }
        sqlx::query(
            r#"
            INSERT INTO agent_runs (
              run_id, thread_id, company_id, project_id, parent_run_id,
              root_run_id, status, started_at
            ) VALUES
              ('root-run', 'thread-1', 'company-1', 'project-1', NULL, 'root-run', 'running', 'now'),
              ('child-run', 'thread-1', 'company-1', 'project-1', 'root-run', 'root-run', 'running', 'now')
            "#,
        )
        .execute(&pool)
        .await
        .expect("insert run tree");
        sqlx::query(
            r#"
            INSERT INTO task_workspace_lease_history (
              lease_id, project_id, created_binding_id, active_binding_id,
              created_root_run_id, child_run_id, created_request_id, branch,
              canonical_worktree, worktree_identity_json, project_root_identity_json,
              created_at_unix_ms, updated_at_unix_ms, status
            ) VALUES (
              'lease-1', 'project-1', 'recovered-1', 'recovered-1',
              'root-run', 'child-run', 'request-1', 'codex/recovered',
              '/fixture/worktree', '{}', ?, 3, 3, 'active'
            )
            "#,
        )
        .bind(&recovered_identity)
        .execute(&pool)
        .await
        .expect("create recovered binding worktree lease");
        sqlx::query(
            "UPDATE task_workspace_lease_history SET active_binding_id = 'recovered-2' WHERE lease_id = 'lease-1'",
        )
        .execute(&pool)
        .await
        .expect("adopt lease with recovered binding");
        let catalog_after: String = sqlx::query_scalar(
            "SELECT workspace_root FROM projects WHERE project_id = 'project-1'",
        )
        .fetch_one(&pool)
        .await
        .expect("read Project catalog");
        assert_eq!(catalog_after, path_text(&original).expect("original path"));
    }

    #[tokio::test]
    async fn equal_repository_matches_are_ambiguous() {
        let tree_a = TempTree::new("ambiguous-a");
        let tree_b = TempTree::new("ambiguous-b");
        let catalog = tree_a.child("old-a");
        write_origin(&catalog, "ssh://git@example.com/org/repo.git");
        let pool = fixture_pool(&catalog, "Recovered Project").await;
        insert_witness(&pool, "witness-a", &catalog, "Recovered Project", 20).await;
        let old_b = tree_b.child("old-b");
        write_origin(&old_b, "ssh://git@example.com/org/repo.git");
        insert_witness(&pool, "witness-b", &old_b, "Recovered Project", 10).await;
        fs::remove_dir_all(&catalog).expect("remove first old root");
        fs::remove_dir_all(&old_b).expect("remove second old root");
        let recovered_a = tree_a.child("recovered-project");
        let recovered_b = tree_b.child("recovered-project");
        write_origin(&recovered_a, "git@example.com:org/repo.git");
        init_git(&recovered_b);
        let mut config = fs::read_to_string(recovered_b.join(".git/config"))
            .expect("read initialized git config");
        config.push_str(
            "\n[remote.origin]\n\tURL = \"ssh://git@example.com:22/org/repo.git\" # legacy quoted form\n",
        );
        fs::write(recovered_b.join(".git/config"), config).expect("write legacy quoted git config");
        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve ambiguous roots");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Unavailable(ref unavailable) if unavailable.reason_code == WorkspaceRecoveryReason::Ambiguous && unavailable.candidate_count == 2)
        );
    }

    #[tokio::test]
    async fn large_valid_candidate_config_remains_a_competing_match() {
        let tree_a = TempTree::new("incomplete-origin-a");
        let tree_b = TempTree::new("incomplete-origin-b");
        let catalog = tree_a.child("old-a");
        let old_b = tree_b.child("old-b");
        write_origin(&catalog, "ssh://git@example.com/org/repo.git");
        write_origin(&old_b, "ssh://git@example.com/org/repo.git");
        let pool = fixture_pool(&catalog, "Recovered Project").await;
        insert_witness(&pool, "witness-a", &catalog, "Recovered Project", 20).await;
        insert_witness(&pool, "witness-b", &old_b, "Recovered Project", 10).await;
        fs::remove_dir_all(&catalog).expect("remove first old root");
        fs::remove_dir_all(&old_b).expect("remove second old root");

        let recovered_a = tree_a.child("recovered-project");
        let recovered_b = tree_b.child("recovered-project");
        write_origin(&recovered_a, "git@example.com:org/repo.git");
        write_origin(&recovered_b, "git@example.com:org/repo.git");
        let mut config =
            fs::read_to_string(recovered_b.join(".git/config")).expect("read candidate git config");
        config.push_str(&format!("\n#{}\n", "x".repeat(1_048_576)));
        fs::write(recovered_b.join(".git/config"), config)
            .expect("write large but valid git config");

        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve large config candidate");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Unavailable(ref unavailable)
                if unavailable.reason_code == WorkspaceRecoveryReason::Ambiguous && unavailable.candidate_count == 2),
            "a large valid config must not hide a competing repository"
        );
    }

    #[tokio::test]
    async fn unrelated_local_remote_does_not_block_a_unique_supported_origin_match() {
        let tree = TempTree::new("local-remote-non-match");
        let catalog = tree.child("old-name");
        write_origin(&catalog, "ssh://git@example.com/org/repo.git");
        let pool = fixture_pool(&catalog, "Recovered Project").await;
        insert_witness(&pool, "witness-1", &catalog, "Recovered Project", 10).await;
        fs::remove_dir_all(&catalog).expect("remove original workspace");

        let recovered = tree.child("recovered-project");
        write_origin(&recovered, "git@example.com:org/repo.git");
        let unrelated = tree.child("local-remote");
        write_origin(&unrelated, "/tmp/unrelated-local-repository");

        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve beside unrelated local remote");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Bound(ref root)
                if root.reason_code() == WorkspaceRecoveryReason::UniqueNameRepoIdentityMatch
                    && root.canonical_root == recovered),
            "a fully readable unsupported remote is a complete non-match"
        );
    }

    #[tokio::test]
    async fn unrelated_broken_git_config_does_not_block_a_unique_named_match() {
        let tree = TempTree::new("unrelated-broken-config");
        let catalog = tree.child("old-name");
        write_origin(&catalog, "ssh://git@example.com/org/repo.git");
        let pool = fixture_pool(&catalog, "Recovered Project").await;
        insert_witness(&pool, "witness-1", &catalog, "Recovered Project", 10).await;
        fs::remove_dir_all(&catalog).expect("remove original workspace");

        let recovered = tree.child("recovered-project");
        write_origin(&recovered, "git@example.com:org/repo.git");
        let unrelated = tree.child("unrelated-name");
        init_git(&unrelated);
        let mut config =
            fs::read_to_string(unrelated.join(".git/config")).expect("read unrelated config");
        config.push_str("\n[broken\n");
        fs::write(unrelated.join(".git/config"), config).expect("write broken unrelated config");

        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve beside unrelated broken config");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Bound(ref root)
                if root.reason_code() == WorkspaceRecoveryReason::UniqueNameRepoIdentityMatch
                    && root.canonical_root == recovered),
            "only name-relevant repository probes participate in uniqueness"
        );
    }

    #[tokio::test]
    async fn no_match_is_unavailable_and_catalog_is_unchanged() {
        let tree = TempTree::new("none");
        let catalog = tree.child("catalog");
        let pool = fixture_pool(&catalog, "Project").await;
        insert_witness(&pool, "witness-1", &catalog, "Project", 10).await;
        let original_catalog: String = sqlx::query_scalar("SELECT workspace_root FROM projects")
            .fetch_one(&pool)
            .await
            .expect("read original catalog");
        fs::remove_dir_all(&catalog).expect("remove catalog");
        tree.child("unrelated");
        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve missing root");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Unavailable(ref unavailable) if unavailable.reason_code == WorkspaceRecoveryReason::None)
        );
        let catalog_after: String = sqlx::query_scalar("SELECT workspace_root FROM projects")
            .fetch_one(&pool)
            .await
            .expect("read catalog after recovery");
        assert_eq!(catalog_after, original_catalog);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn symlink_and_same_path_replacement_are_never_accepted() {
        use std::os::unix::fs::symlink;

        let tree = TempTree::new("replacement");
        let catalog = tree.child("project");
        write_origin(&catalog, "ssh://git@example.com/org/repo.git");
        let pool = fixture_pool(&catalog, "Project").await;
        insert_witness(&pool, "witness-1", &catalog, "Project", 10).await;
        fs::remove_dir_all(&catalog).expect("remove catalog");
        let replacement = tree.child("replacement-target");
        write_origin(&replacement, "ssh://git@example.com/org/repo.git");
        symlink(&replacement, &catalog).expect("create catalog symlink");
        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("reject symlink replacement");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Unavailable(ref unavailable) if unavailable.reason_code == WorkspaceRecoveryReason::None)
        );
        fs::remove_file(&catalog).expect("remove symlink");
        fs::create_dir_all(&catalog).expect("create same-path replacement");
        write_origin(&catalog, "ssh://git@example.com/org/repo.git");
        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("reject same-path replacement");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Unavailable(ref unavailable) if unavailable.reason_code == WorkspaceRecoveryReason::None)
        );
    }

    #[tokio::test]
    async fn invalid_known_anchor_row_never_signs_an_observed_unique_match() {
        let tree_a = TempTree::new("invalid-anchor-a");
        let tree_b = TempTree::new("invalid-anchor-b");
        let catalog = tree_a.child("old-name");
        write_origin(&catalog, "git@example.com:org/repo.git");
        let pool = fixture_pool(&catalog, "Recovered Project").await;
        insert_witness(&pool, "witness-1", &catalog, "Recovered Project", 10).await;
        fs::remove_dir_all(&catalog).expect("remove original workspace");
        let candidate_a = tree_a.child("recovered-project");
        let candidate_b = tree_b.child("recovered-project");
        write_origin(&candidate_a, "git@example.com:org/repo.git");
        write_origin(&candidate_b, "git@example.com:org/repo.git");

        let project_b_root = tree_b.0.join("catalog-placeholder");
        sqlx::query(
            "INSERT INTO projects VALUES ('project-2', 'company-1', 'Other', ?, NULL, 3, NULL)",
        )
        .bind(path_text(&project_b_root).expect("second Project path"))
        .execute(&pool)
        .await
        .expect("insert second Project");
        let mut invalid_anchor = path_text(&project_b_root)
            .expect("invalid anchor prefix")
            .into_bytes();
        invalid_anchor.push(0xff);
        sqlx::query(
            "INSERT INTO project_workspace_authority VALUES ('project-2', 'company-1', ?, '{}', 1, 1)",
        )
        .bind(invalid_anchor)
        .execute(&pool)
        .await
        .expect("insert undecodable known anchor");

        let resolution = resolve_workspace_root_from_pool(&pool, scope())
            .await
            .expect("resolve with invalid known anchor row");
        assert!(
            matches!(resolution, WorkspaceRootResolution::Unavailable(ref unavailable)
                if unavailable.reason_code == WorkspaceRecoveryReason::Ambiguous && unavailable.candidate_count == 1),
            "an undecodable known anchor must poison uniqueness"
        );
    }

    #[test]
    fn origin_identity_removes_userinfo_query_and_scp_user() {
        assert_eq!(
            sanitized_origin_identity("https://token@example.com/Org/Repo.git?secret=yes"),
            Some("example.com/Org/Repo".into())
        );
        assert_eq!(
            sanitized_origin_identity("git@example.com:Org/Repo.git"),
            Some("example.com/Org/Repo".into())
        );
        assert_eq!(
            sanitized_origin_identity("ssh://git@example.com:22/Org/Repo.git"),
            Some("example.com/Org/Repo".into())
        );
        assert_eq!(
            sanitized_origin_identity("ssh://git@example.com:2222/Org/Repo.git"),
            Some("ssh@example.com:2222/Org/Repo".into())
        );
    }

    #[test]
    fn effective_git_origin_command_clears_injected_config_and_worktree_environment() {
        let tree = TempTree::new("git-env-boundary");
        let root = tree.child("project");
        write_origin(&root, "ssh://git@example.com/org/repo.git");
        let command = effective_git_origin_command(&root);
        let environment = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().into_owned(),
                    value.map(|value| value.to_string_lossy().into_owned()),
                )
            })
            .collect::<HashMap<_, _>>();
        assert_eq!(environment.get("GIT_CONFIG_COUNT"), Some(&Some("0".into())));
        assert_eq!(environment.get("GIT_CONFIG"), Some(&None));
        assert_eq!(environment.get("GIT_CONFIG_PARAMETERS"), Some(&None));
        assert_eq!(environment.get("GIT_DIR"), Some(&None));
        assert_eq!(environment.get("GIT_WORK_TREE"), Some(&None));
        assert_eq!(environment.get("GIT_COMMON_DIR"), Some(&None));
        assert_eq!(
            environment.get("GIT_CONFIG_GLOBAL"),
            Some(&Some("/dev/null".into()))
        );
        assert_eq!(
            environment.get("GIT_CONFIG_SYSTEM"),
            Some(&Some("/dev/null".into()))
        );
    }

    #[cfg(unix)]
    #[test]
    fn blocking_git_include_is_killed_by_the_probe_timeout() {
        let tree = TempTree::new("git-fifo-timeout");
        let root = tree.child("project");
        write_origin(&root, "ssh://git@example.com/org/repo.git");
        let fifo = tree.0.join("blocking-git-include");
        let status = Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("create blocking Git include FIFO");
        assert!(status.success());
        fs::write(
            root.join(".git/config"),
            format!(
                "[include]\n\tpath = {}\n[remote \"origin\"]\n\turl = ssh://git@example.com/org/repo.git\n",
                path_text(&fifo).expect("FIFO include path")
            ),
        )
        .expect("write blocking Git config");

        let started = Instant::now();
        assert!(matches!(
            probe_git_origin_digest_with_timeout(&root, Duration::from_millis(100)),
            GitOriginProbe::Incomplete
        ));
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "a malicious include must not block workspace recovery"
        );
    }

    #[test]
    fn effective_git_config_requires_all_local_and_worktree_values_to_agree() {
        let tree = TempTree::new("effective-git-config");
        let root = tree.child("project");
        write_origin(&root, "ssh://git@example.com/org/original.git");
        let status = Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(["config", "extensions.worktreeConfig", "true"])
            .status()
            .expect("enable worktree config");
        assert!(status.success());
        let status = Command::new("git")
            .arg("-C")
            .arg(&root)
            .args([
                "config",
                "--worktree",
                "remote.origin.url",
                "git+ssh://git@example.com:22/org/override.git",
            ])
            .status()
            .expect("write worktree origin override");
        assert!(status.success());
        assert!(matches!(
            probe_git_origin_digest(&root),
            GitOriginProbe::Incomplete
        ));

        let status = Command::new("git")
            .arg("-C")
            .arg(&root)
            .args([
                "config",
                "--worktree",
                "--replace-all",
                "remote.origin.url",
                "git+ssh://git@example.com:22/org/original.git",
            ])
            .status()
            .expect("replace worktree origin with an equivalent identity");
        assert!(status.success());
        let expected = tree.child("expected");
        write_origin(&expected, "git@example.com:org/original.git");
        assert_eq!(git_origin_digest(&root), git_origin_digest(&expected));

        let status = Command::new("git")
            .arg("-C")
            .arg(&root)
            .args([
                "config",
                "--worktree",
                "--add",
                "remote.origin.url",
                "ssh://git@example.com/org/conflict.git",
            ])
            .status()
            .expect("append conflicting worktree origin");
        assert!(status.success());
        assert!(matches!(
            probe_git_origin_digest(&root),
            GitOriginProbe::Incomplete
        ));
    }

    #[test]
    fn origin_identity_uses_gits_instead_of_rewrite() {
        let tree = TempTree::new("git-instead-of");
        let root = tree.child("project");
        write_origin(&root, "https://github.com/org/repo.git");
        let expected = tree.child("expected");
        write_origin(&expected, "https://github.com/org/repo.git");

        let status = Command::new("git")
            .arg("-C")
            .arg(&root)
            .args([
                "config",
                "url.ssh://evil.example/x/.insteadOf",
                "https://github.com/",
            ])
            .status()
            .expect("write insteadOf rewrite");
        assert!(status.success());
        assert_ne!(git_origin_digest(&root), git_origin_digest(&expected));

        let rewritten = tree.child("rewritten");
        write_origin(&rewritten, "ssh://evil.example/x/org/repo.git");
        assert_eq!(git_origin_digest(&root), git_origin_digest(&rewritten));
    }
}
