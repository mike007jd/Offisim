use super::*;

pub(super) const WORKSPACE_LEASE_PATCH_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_WORKSPACE_LEASE_PATCH_BYTES: usize = 1024 * 1024;
const MAX_WORKSPACE_LEASE_CANONICAL_DIFF_BYTES: usize = 32 * 1024 * 1024;
static WORKSPACE_LEASE_MUTATION_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub(super) async fn lock_workspace_lease_mutation() -> tokio::sync::MutexGuard<'static, ()> {
    WORKSPACE_LEASE_MUTATION_LOCK.lock().await
}

pub(super) fn git_now_unix_ms() -> Result<i64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Read workspace lease clock: {error}"))?
        .as_millis();
    i64::try_from(millis).map_err(|_| "Workspace lease clock is out of range".to_string())
}

#[derive(Debug)]
pub(super) struct RegisteredWorkspaceLease {
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

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CompetitiveDraftContext {
    pub(crate) group_id: String,
    pub(crate) source_run_id: String,
    pub(crate) attempt_id: String,
    pub(crate) attempt_index: u32,
    pub(crate) total_attempts: u32,
}

#[derive(Clone, Debug)]
pub(crate) struct CompetitiveDraftWorkspaceLease {
    pub(crate) lease_id: String,
    pub(crate) registered_run_id: String,
    pub(crate) workspace_root: PathBuf,
    pub(crate) cwd: PathBuf,
    pub(crate) branch: String,
    pub(crate) created_at: String,
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

pub(super) fn sanitize_workspace_ref(value: &str) -> String {
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

pub(super) fn expected_workspace_lease_branch(run_id: &str, lease_id: &str) -> String {
    format!(
        "offisim/lease/{}-{}",
        sanitize_workspace_ref(run_id),
        sanitize_workspace_ref(lease_id)
    )
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

fn validate_competitive_draft_context_shape(
    context: &CompetitiveDraftContext,
) -> Result<(), String> {
    if context.group_id.trim().is_empty()
        || context.source_run_id.trim().is_empty()
        || context.attempt_id.trim().is_empty()
        || !(2..=4).contains(&context.total_attempts)
        || context.attempt_index == 0
        || context.attempt_index > context.total_attempts
    {
        return Err("Competitive draft workspace context is invalid".into());
    }
    Ok(())
}

async fn validate_competitive_draft_attempt_from_pool(
    pool: &SqlitePool,
    binding: &TaskWorkspaceBinding,
    context: &CompetitiveDraftContext,
) -> Result<bool, String> {
    validate_competitive_draft_context_shape(context)?;
    let row = sqlx::query(
        r#"
        SELECT
          draft.company_id AS group_company_id,
          draft.project_id AS group_project_id,
          draft.source_run_id AS group_source_run_id,
          draft.status AS group_status,
          attempt.ordinal AS attempt_ordinal,
          attempt.employee_id AS attempt_employee_id,
          attempt.thread_id AS attempt_thread_id,
          attempt.run_id AS attempt_run_id,
          attempt.status AS attempt_status,
          run.company_id AS run_company_id,
          run.project_id AS run_project_id,
          run.thread_id AS run_thread_id,
          run.employee_id AS run_employee_id,
          run.parent_run_id AS run_parent_run_id,
          run.root_run_id AS run_root_run_id,
          run.status AS run_status,
          (SELECT COUNT(*) FROM competitive_draft_attempts peers WHERE peers.group_id = draft.group_id)
            AS attempt_count
        FROM competitive_draft_groups draft
        JOIN competitive_draft_attempts attempt ON attempt.group_id = draft.group_id
        LEFT JOIN agent_runs run ON run.run_id = attempt.run_id
        WHERE draft.group_id = ? AND attempt.attempt_id = ?
        "#,
    )
    .bind(&context.group_id)
    .bind(&context.attempt_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Validate competitive draft workspace provenance: {error}"))?;
    let Some(row) = row else {
        return Ok(false);
    };
    let group_company_id: String = row
        .try_get("group_company_id")
        .map_err(|error| format!("Decode competitive draft group company provenance: {error}"))?;
    let group_project_id: String = row
        .try_get("group_project_id")
        .map_err(|error| format!("Decode competitive draft group Project provenance: {error}"))?;
    let group_source_run_id: String = row
        .try_get("group_source_run_id")
        .map_err(|error| format!("Decode competitive draft source run provenance: {error}"))?;
    let group_status: String = row
        .try_get("group_status")
        .map_err(|error| format!("Decode competitive draft group status: {error}"))?;
    let attempt_ordinal: i64 = row
        .try_get("attempt_ordinal")
        .map_err(|error| format!("Decode competitive draft attempt ordinal: {error}"))?;
    let attempt_employee_id: String = row.try_get("attempt_employee_id").map_err(|error| {
        format!("Decode competitive draft attempt employee provenance: {error}")
    })?;
    let attempt_thread_id: String = row.try_get("attempt_thread_id").map_err(|error| {
        format!("Decode competitive draft attempt Conversation provenance: {error}")
    })?;
    let attempt_run_id: String = row
        .try_get("attempt_run_id")
        .map_err(|error| format!("Decode competitive draft attempt run provenance: {error}"))?;
    let attempt_status: String = row
        .try_get("attempt_status")
        .map_err(|error| format!("Decode competitive draft attempt status: {error}"))?;
    let run_company_id: Option<String> = row
        .try_get("run_company_id")
        .map_err(|error| format!("Decode competitive draft run company: {error}"))?;
    let run_project_id: Option<String> = row
        .try_get("run_project_id")
        .map_err(|error| format!("Decode competitive draft run Project: {error}"))?;
    let run_thread_id: Option<String> = row
        .try_get("run_thread_id")
        .map_err(|error| format!("Decode competitive draft run Conversation: {error}"))?;
    let run_employee_id: Option<String> = row
        .try_get("run_employee_id")
        .map_err(|error| format!("Decode competitive draft run employee: {error}"))?;
    let run_parent_run_id: Option<String> = row
        .try_get("run_parent_run_id")
        .map_err(|error| format!("Decode competitive draft run parent: {error}"))?;
    let run_root_run_id: Option<String> = row
        .try_get("run_root_run_id")
        .map_err(|error| format!("Decode competitive draft root provenance: {error}"))?;
    let run_status: Option<String> = row
        .try_get("run_status")
        .map_err(|error| format!("Decode competitive draft run status: {error}"))?;
    let attempt_count: i64 = row
        .try_get("attempt_count")
        .map_err(|error| format!("Decode competitive draft attempt count: {error}"))?;

    let exact_scope = group_company_id == binding.company_id
        && group_project_id == binding.project_id
        && group_source_run_id == context.source_run_id
        && group_status == "drafting"
        && attempt_ordinal == i64::from(context.attempt_index)
        && attempt_thread_id == binding.thread_id
        && attempt_run_id == binding.turn_id
        && attempt_status == "running"
        && attempt_count == i64::from(context.total_attempts)
        && run_company_id.as_deref() == Some(binding.company_id.as_str())
        && run_project_id.as_deref() == Some(binding.project_id.as_str())
        && run_thread_id.as_deref() == Some(binding.thread_id.as_str())
        && run_employee_id.as_deref() == Some(attempt_employee_id.as_str())
        && run_parent_run_id.is_none()
        && run_root_run_id.as_deref() == Some(binding.turn_id.as_str())
        && run_status.as_deref() == Some("running");
    if !exact_scope {
        return Err(
            "Competitive draft workspace provenance does not match its active durable attempt"
                .into(),
        );
    }
    Ok(true)
}

async fn wait_for_competitive_draft_attempt_from_pool(
    pool: &SqlitePool,
    binding: &TaskWorkspaceBinding,
    context: &CompetitiveDraftContext,
) -> Result<(), String> {
    const VISIBILITY_TIMEOUT: Duration = Duration::from_secs(2);
    const VISIBILITY_POLL: Duration = Duration::from_millis(25);
    let deadline = tokio::time::Instant::now() + VISIBILITY_TIMEOUT;
    loop {
        if validate_competitive_draft_attempt_from_pool(pool, binding, context).await? {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(
                "Competitive draft attempt was not durably running before workspace registration timeout"
                    .into(),
            );
        }
        tokio::time::sleep(VISIBILITY_POLL).await;
    }
}

#[derive(Clone, Copy)]
enum WorkspaceLeaseRunProvenance<'a> {
    DelegatedChild,
    CompetitiveDraft(&'a CompetitiveDraftContext),
}

pub(crate) async fn register_task_workspace_lease<R: Runtime>(
    app: &tauri::AppHandle<R>,
    binding: &TaskWorkspaceBinding,
    lease_id: &str,
    child_run_id: &str,
    branch: &str,
    path: &Path,
) -> Result<PathBuf, String> {
    register_workspace_lease(
        app,
        binding,
        lease_id,
        child_run_id,
        branch,
        path,
        WorkspaceLeaseRunProvenance::DelegatedChild,
    )
    .await
}

async fn register_workspace_lease<R: Runtime>(
    app: &tauri::AppHandle<R>,
    binding: &TaskWorkspaceBinding,
    lease_id: &str,
    registered_run_id: &str,
    branch: &str,
    path: &Path,
    provenance: WorkspaceLeaseRunProvenance<'_>,
) -> Result<PathBuf, String> {
    let execution = GitExecutionScope::from_authority(binding, &binding.canonical_root)?;
    let requested = validate_new_workspace_lease_request(
        &binding.canonical_root,
        lease_id,
        registered_run_id,
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
        match provenance {
            WorkspaceLeaseRunProvenance::DelegatedChild => {
                wait_for_workspace_lease_agent_run_from_pool(&pool, binding, registered_run_id)
                    .await?;
            }
            WorkspaceLeaseRunProvenance::CompetitiveDraft(context) => {
                wait_for_competitive_draft_attempt_from_pool(&pool, binding, context).await?;
            }
        }
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
            child_run_id: registered_run_id,
            request_id: &binding.request_id,
            branch,
            canonical_worktree: &canonical_worktree,
            worktree_identity_json: &worktree_identity_json,
            project_identity_json: &project_identity_json,
            created_at_unix_ms: now,
        },
        match provenance {
            WorkspaceLeaseRunProvenance::DelegatedChild => None,
            WorkspaceLeaseRunProvenance::CompetitiveDraft(context) => Some(context),
        },
    )
    .await?;
    if let Err(error) = execution.verify_live() {
        let cleanup =
            close_registered_workspace_lease(app, binding, &canonical_worktree, "discarded").await;
        return Err(match cleanup {
            Ok(()) => error,
            Err(cleanup_error) => format!("{error}; cleanup failed: {cleanup_error}"),
        });
    }
    Ok(PathBuf::from(canonical_worktree_text))
}

pub(crate) async fn create_competitive_draft_workspace_lease<R: Runtime>(
    app: &tauri::AppHandle<R>,
    binding: &TaskWorkspaceBinding,
    context: &CompetitiveDraftContext,
) -> Result<CompetitiveDraftWorkspaceLease, String> {
    validate_competitive_draft_context_shape(context)?;
    let pool = crate::local_db::get_offisim_pool(app)?;
    wait_for_competitive_draft_attempt_from_pool(&pool, binding, context).await?;
    binding.verify_live_root()?;

    let lease_id = sanitize_workspace_ref(&format!(
        "draft-{}-{}",
        context.attempt_index, binding.turn_id
    ));
    let branch = expected_workspace_lease_branch(&binding.turn_id, &lease_id);
    let destination = binding
        .canonical_root
        .join(".offisim")
        .join("worktrees")
        .join(&lease_id);
    validate_new_workspace_lease_request(
        &binding.canonical_root,
        &lease_id,
        &binding.turn_id,
        &branch,
        destination.to_string_lossy().as_ref(),
    )?;
    let created = run_task_workspace_worktree_add(binding, &branch, &destination).await?;
    if !created.ok {
        return Err(workspace_lease_command_error(
            created,
            "Create competitive draft worktree",
        ));
    }
    let cwd = register_workspace_lease(
        app,
        binding,
        &lease_id,
        &binding.turn_id,
        &branch,
        &destination,
        WorkspaceLeaseRunProvenance::CompetitiveDraft(context),
    )
    .await?;
    let created_at = unix_ms_to_rfc3339(git_now_unix_ms()?);
    Ok(CompetitiveDraftWorkspaceLease {
        lease_id,
        registered_run_id: binding.turn_id.clone(),
        workspace_root: binding.canonical_root.clone(),
        cwd,
        branch,
        created_at,
    })
}

pub(crate) async fn verify_competitive_draft_attempt<R: Runtime>(
    app: &tauri::AppHandle<R>,
    binding: &TaskWorkspaceBinding,
    context: &CompetitiveDraftContext,
    cwd: &Path,
) -> Result<(), String> {
    validate_competitive_draft_context_shape(context)?;
    let pool = crate::local_db::get_offisim_pool(app)?;
    if !validate_competitive_draft_attempt_from_pool(&pool, binding, context).await? {
        return Err("Competitive draft verification lost its durable attempt authority".into());
    }
    let verified_cwd = require_registered_workspace_lease(app, binding, cwd).await?;
    let (summary, passed) = match binding
        .project_verify_command
        .as_deref()
        .map(str::trim)
        .filter(|command| !command.is_empty())
    {
        None => (
            "No Project verification command is configured.".to_string(),
            None,
        ),
        Some(command) => {
            let result = crate::builtin_tools::execute_trusted_verification(
                app,
                &binding.authorized_root(),
                &verified_cwd,
                command,
                5 * 60 * 1_000,
                Some(1024 * 1024),
                &binding.project_id,
                None,
            )
            .await;
            match result {
                Ok(result) => {
                    let value = serde_json::to_value(result).map_err(|error| {
                        format!("Encode competitive draft verification: {error}")
                    })?;
                    let exit_code = value
                        .get("exitCode")
                        .and_then(serde_json::Value::as_i64)
                        .unwrap_or(-1);
                    let timed_out = value
                        .get("timedOut")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false);
                    let output = value
                        .get("stdout")
                        .and_then(serde_json::Value::as_str)
                        .filter(|text| !text.trim().is_empty())
                        .or_else(|| {
                            value
                                .get("stderr")
                                .and_then(serde_json::Value::as_str)
                                .filter(|text| !text.trim().is_empty())
                        })
                        .map(str::trim)
                        .unwrap_or("");
                    let output = output.chars().take(500).collect::<String>();
                    let passed = exit_code == 0 && !timed_out;
                    let headline = if timed_out {
                        "Verification timed out".to_string()
                    } else if passed {
                        "Verification passed".to_string()
                    } else {
                        format!("Verification failed with exit code {exit_code}")
                    };
                    (
                        if output.is_empty() {
                            headline
                        } else {
                            format!("{headline}: {output}")
                        },
                        Some(passed),
                    )
                }
                Err(error) => (format!("Verification could not run: {error}"), None),
            }
        }
    };
    let updated = sqlx::query(
        "UPDATE competitive_draft_attempts SET verification_summary = ?, verification_passed = ? WHERE group_id = ? AND attempt_id = ? AND run_id = ? AND ordinal = ? AND status = 'running'",
    )
    .bind(summary)
    .bind(passed)
    .bind(&context.group_id)
    .bind(&context.attempt_id)
    .bind(&binding.turn_id)
    .bind(i64::from(context.attempt_index))
    .execute(&pool)
    .await
    .map_err(|error| format!("Persist competitive draft verification: {error}"))?;
    if updated.rows_affected() != 1 {
        return Err("Competitive draft changed before verification could be recorded".into());
    }
    Ok(())
}

async fn persist_task_workspace_lease_registration(
    pool: &SqlitePool,
    canonical_root: &Path,
    registration: NewRegisteredWorkspaceLease<'_>,
    competitive_context: Option<&CompetitiveDraftContext>,
) -> Result<(), String> {
    let canonical_worktree_text = registration
        .canonical_worktree
        .to_str()
        .ok_or_else(|| "Workspace lease path is not valid UTF-8".to_string())?;
    let mut transaction = match pool.begin().await {
        Ok(transaction) => transaction,
        Err(error) => {
            let cause = format!("Begin workspace lease registration: {error}");
            let rollback = rollback_created_worktree_with_expected_identity(
                canonical_root,
                registration.canonical_worktree,
                registration.branch,
                registration.project_identity_json,
            )
            .await;
            return Err(match rollback {
                Ok(()) => cause,
                Err(rollback_error) => format!("{cause}; rollback failed: {rollback_error}"),
            });
        }
    };
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
    .execute(&mut *transaction)
    .await;
    let registration_result = match inserted {
        Ok(_) => {
            if let Some(context) = competitive_context {
                let updated = sqlx::query(
                    "UPDATE competitive_draft_attempts SET lease_id = ? WHERE group_id = ? AND attempt_id = ? AND run_id = ? AND ordinal = ? AND status = 'running' AND lease_id IS NULL",
                )
                .bind(registration.lease_id)
                .bind(&context.group_id)
                .bind(&context.attempt_id)
                .bind(registration.child_run_id)
                .bind(i64::from(context.attempt_index))
                .execute(&mut *transaction)
                .await;
                match updated {
                    Ok(updated) if updated.rows_affected() == 1 => Ok(()),
                    Ok(_) => Err(
                        "Competitive draft attempt changed before atomic lease registration".into(),
                    ),
                    Err(error) => Err(format!("Register competitive draft attempt lease: {error}")),
                }
            } else {
                Ok(())
            }
        }
        Err(error) => Err(format!("Register workspace lease: {error}")),
    };
    if let Err(error) = registration_result {
        let _ = transaction.rollback().await;
        let rollback = rollback_created_worktree_with_expected_identity(
            canonical_root,
            registration.canonical_worktree,
            registration.branch,
            registration.project_identity_json,
        )
        .await;
        return Err(match rollback {
            Ok(()) => error,
            Err(rollback_error) => {
                format!("{error}; rollback failed: {rollback_error}")
            }
        });
    }
    if let Err(error) = transaction.commit().await {
        let rollback = rollback_created_worktree_with_expected_identity(
            canonical_root,
            registration.canonical_worktree,
            registration.branch,
            registration.project_identity_json,
        )
        .await;
        return Err(match rollback {
            Ok(()) => format!("Commit workspace lease registration: {error}"),
            Err(rollback_error) => format!(
                "Commit workspace lease registration: {error}; rollback failed: {rollback_error}"
            ),
        });
    }
    Ok(())
}

pub(super) async fn invalidate_registered_workspace_lease(
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

pub(super) async fn load_registered_workspace_lease_from_pool(
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

pub(super) async fn workspace_lease_list_from_pool(
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

pub(super) fn unix_ms_to_rfc3339(unix_ms: i64) -> String {
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

pub(super) async fn registered_workspace_lease_scopes(
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

pub(super) fn validate_workspace_lease_patch_input(
    lease_id: &str,
    patch: &str,
    reverse: bool,
) -> Result<(), String> {
    if lease_id.trim().is_empty() || sanitize_workspace_ref(lease_id) != lease_id {
        return Err("Invalid workspace lease id".into());
    }
    if !reverse {
        return Err(
            "Workspace review patches only support reverse application inside the lease worktree"
                .into(),
        );
    }
    if patch.trim().is_empty() {
        return Err("Workspace review patch is empty".into());
    }
    if patch.len() > MAX_WORKSPACE_LEASE_PATCH_BYTES {
        return Err(format!(
            "Workspace review patch exceeds the {} byte limit",
            MAX_WORKSPACE_LEASE_PATCH_BYTES
        ));
    }
    if patch.as_bytes().contains(&0) {
        return Err("Workspace review patch contains a NUL byte".into());
    }
    Ok(())
}

fn validate_workspace_lease_patch_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("Workspace review patch contains an empty path".into());
    }
    let path = Path::new(path);
    if path.is_absolute() {
        return Err("Workspace review patch paths must be relative".into());
    }
    for component in path.components() {
        let Component::Normal(segment) = component else {
            return Err("Workspace review patch paths cannot contain '.' or '..' segments".into());
        };
        if segment.to_str().is_some_and(|segment| {
            segment.eq_ignore_ascii_case(".git") || segment.eq_ignore_ascii_case(".offisim")
        }) {
            return Err("Workspace review patch cannot modify .git or .offisim".into());
        }
    }
    Ok(())
}

#[derive(Debug)]
struct WorkspaceReviewPatchSection {
    full: String,
    headers: String,
    hunks: Vec<String>,
}

fn trim_workspace_patch(value: &str) -> &str {
    value.trim_end_matches(&['\r', '\n'][..])
}

fn workspace_review_patch_sections(
    patch: &str,
) -> Result<Vec<WorkspaceReviewPatchSection>, String> {
    let mut starts = Vec::new();
    let mut offset = 0;
    for line in patch.split_inclusive('\n') {
        if line.starts_with("diff --git ") {
            starts.push(offset);
        }
        offset += line.len();
    }
    if starts.first().copied() != Some(0) {
        return Err("Workspace review patch must start with a git diff section".into());
    }
    starts.push(patch.len());
    let mut sections = Vec::new();
    for range in starts.windows(2) {
        let section = &patch[range[0]..range[1]];
        let mut hunk_starts = Vec::new();
        let mut section_offset = 0;
        for line in section.split_inclusive('\n') {
            if line.starts_with("@@ ") {
                hunk_starts.push(section_offset);
            }
            section_offset += line.len();
        }
        let header_end = hunk_starts.first().copied().unwrap_or(section.len());
        hunk_starts.push(section.len());
        let hunks = hunk_starts
            .windows(2)
            .filter_map(|range| {
                let hunk = trim_workspace_patch(&section[range[0]..range[1]]);
                (!hunk.is_empty()).then(|| hunk.to_string())
            })
            .collect();
        sections.push(WorkspaceReviewPatchSection {
            full: trim_workspace_patch(section).to_string(),
            headers: trim_workspace_patch(&section[..header_end]).to_string(),
            hunks,
        });
    }
    if sections.is_empty() {
        return Err("Workspace review patch has no git diff sections".into());
    }
    Ok(sections)
}

fn workspace_review_headers_support_partial(headers: &str) -> bool {
    !headers.lines().any(|line| {
        matches!(
            line.split_whitespace()
                .take(3)
                .collect::<Vec<_>>()
                .as_slice(),
            ["new", "file", "mode"]
                | ["deleted", "file", "mode"]
                | ["old", "mode", _]
                | ["new", "mode", _]
                | ["similarity", "index", _]
                | ["dissimilarity", "index", _]
                | ["rename", "from", _]
                | ["rename", "to", _]
                | ["copy", "from", _]
                | ["copy", "to", _]
        )
    })
}

fn workspace_review_patch_is_canonical_subset(
    patch: &str,
    canonical_diff: &str,
) -> Result<bool, String> {
    let submitted = workspace_review_patch_sections(patch)?;
    let canonical = workspace_review_patch_sections(canonical_diff)?;
    Ok(submitted.iter().all(|section| {
        canonical.iter().any(|candidate| {
            if section.full == candidate.full {
                return true;
            }
            section.headers == candidate.headers
                && workspace_review_headers_support_partial(&section.headers)
                && !section.hunks.is_empty()
                && section.hunks.iter().all(|hunk| {
                    candidate
                        .hunks
                        .iter()
                        .any(|candidate_hunk| candidate_hunk == hunk)
                })
        })
    }))
}

fn workspace_lease_patch_numstat_paths(output: &str) -> Result<HashSet<String>, String> {
    if !output.ends_with('\0') {
        return Err("Workspace review patch numstat is not NUL terminated".into());
    }
    let records = output
        .strip_suffix('\0')
        .unwrap_or(output)
        .split('\0')
        .collect::<Vec<_>>();
    let mut paths = HashSet::new();
    let mut index = 0;
    while index < records.len() {
        let mut fields = records[index].splitn(3, '\t');
        let added = fields
            .next()
            .ok_or_else(|| "Workspace review patch numstat is malformed".to_string())?;
        let deleted = fields
            .next()
            .ok_or_else(|| "Workspace review patch numstat is malformed".to_string())?;
        let path = fields
            .next()
            .ok_or_else(|| "Workspace review patch numstat is malformed".to_string())?;
        let valid_count = |value: &str| value == "-" || value.parse::<u64>().is_ok();
        if !valid_count(added) || !valid_count(deleted) {
            return Err("Workspace review patch numstat has invalid line counts".into());
        }
        if path.is_empty() {
            let old_path = records
                .get(index + 1)
                .ok_or_else(|| "Workspace review rename is missing its source path".to_string())?;
            let new_path = records
                .get(index + 2)
                .ok_or_else(|| "Workspace review rename is missing its target path".to_string())?;
            for renamed_path in [old_path, new_path] {
                validate_workspace_lease_patch_path(renamed_path)?;
                paths.insert((*renamed_path).to_string());
            }
            index += 3;
        } else {
            validate_workspace_lease_patch_path(path)?;
            paths.insert(path.to_string());
            index += 1;
        }
    }
    if paths.is_empty() {
        return Err("Workspace review patch must target at least one file".into());
    }
    Ok(paths)
}

fn workspace_lease_nul_paths(output: &str, label: &str) -> Result<HashSet<String>, String> {
    if output.is_empty() {
        return Ok(HashSet::new());
    }
    if !output.ends_with('\0') {
        return Err(format!("{label} is not NUL terminated"));
    }
    let mut paths = HashSet::new();
    for path in output.strip_suffix('\0').unwrap_or(output).split('\0') {
        validate_workspace_lease_patch_path(path)?;
        paths.insert(path.to_string());
    }
    Ok(paths)
}

async fn run_workspace_lease_machine_command(
    execution: &GitExecutionScope,
    args: &[&str],
) -> Result<GitResult, String> {
    execution.verify_live()?;
    let mut command = Command::new("git");
    command.args(args).env_clear().envs(scrubbed_git_env());
    execution.bind_command(&mut command)?;
    let result = run_git_capped_machine(command, GIT_EXEC_TIMEOUT, MAX_GIT_OUTPUT_BYTES).await?;
    execution.verify_live()?;
    Ok(result)
}

async fn run_workspace_lease_machine_command_owned(
    execution: &GitExecutionScope,
    args: &[String],
) -> Result<GitResult, String> {
    execution.verify_live()?;
    let mut command = Command::new("git");
    command.args(args).env_clear().envs(scrubbed_git_env());
    execution.bind_command(&mut command)?;
    let result = run_git_capped_machine(
        command,
        GIT_EXEC_TIMEOUT,
        MAX_WORKSPACE_LEASE_CANONICAL_DIFF_BYTES,
    )
    .await?;
    execution.verify_live()?;
    Ok(result)
}

async fn current_workspace_lease_canonical_diff(
    root_execution: &GitExecutionScope,
    worktree_execution: &GitExecutionScope,
    paths: &HashSet<String>,
) -> Result<String, String> {
    let root_head =
        run_workspace_lease_machine_command(root_execution, &["rev-parse", "--verify", "HEAD"])
            .await?;
    if !root_head.ok {
        return Err(workspace_lease_command_error(
            root_head,
            "Resolve Project HEAD for canonical workspace review diff",
        ));
    }
    let root_head = root_head.stdout.trim();
    if !matches!(root_head.len(), 40 | 64)
        || !root_head
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("Project HEAD is not an exact object id".into());
    }
    let mut sorted_paths = paths.iter().cloned().collect::<Vec<_>>();
    sorted_paths.sort();
    let mut args = vec![
        "diff".to_string(),
        "--binary".to_string(),
        "--unified=3".to_string(),
        root_head.to_string(),
        "--".to_string(),
    ];
    args.extend(sorted_paths);
    let canonical = run_workspace_lease_machine_command_owned(worktree_execution, &args).await?;
    if !canonical.ok {
        return Err(workspace_lease_command_error(
            canonical,
            "Build canonical workspace review diff",
        ));
    }
    if canonical.stdout.trim().is_empty() {
        return Err("Canonical workspace review diff is empty".into());
    }
    Ok(canonical.stdout)
}

async fn current_workspace_lease_diff_paths(
    root_execution: &GitExecutionScope,
    worktree_execution: &GitExecutionScope,
) -> Result<HashSet<String>, String> {
    let root_head =
        run_workspace_lease_machine_command(root_execution, &["rev-parse", "--verify", "HEAD"])
            .await?;
    if !root_head.ok {
        return Err(workspace_lease_command_error(
            root_head,
            "Resolve Project HEAD for workspace review",
        ));
    }
    let root_head = root_head.stdout.trim();
    if !matches!(root_head.len(), 40 | 64)
        || !root_head
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("Project HEAD is not an exact object id".into());
    }

    let tracked = run_workspace_lease_machine_command(
        worktree_execution,
        &["diff", "--name-only", "--no-renames", "-z", root_head],
    )
    .await?;
    if !tracked.ok {
        return Err(workspace_lease_command_error(
            tracked,
            "Inspect tracked workspace lease diff",
        ));
    }
    let untracked = run_workspace_lease_machine_command(
        worktree_execution,
        &["ls-files", "--others", "--exclude-standard", "-z"],
    )
    .await?;
    if !untracked.ok {
        return Err(workspace_lease_command_error(
            untracked,
            "Inspect untracked workspace lease diff",
        ));
    }
    let mut paths = workspace_lease_nul_paths(&tracked.stdout, "Tracked workspace lease paths")?;
    paths.extend(workspace_lease_nul_paths(
        &untracked.stdout,
        "Untracked workspace lease paths",
    )?);
    Ok(paths)
}

async fn run_workspace_lease_patch_command(
    execution: &GitExecutionScope,
    args: &[&str],
    patch: &str,
    stdout_policy: GitStdoutPolicy,
) -> Result<GitResult, String> {
    execution.verify_live()?;
    let mut command = Command::new("git");
    command.args(args).env_clear().envs(scrubbed_git_env());
    execution.bind_command(&mut command)?;
    let result = run_git_patch_capped(command, patch.as_bytes().to_vec(), stdout_policy).await?;
    execution.verify_live()?;
    Ok(result)
}

async fn run_workspace_lease_patch_command_checked(
    pool: &SqlitePool,
    project_id: &str,
    lease: &RegisteredWorkspaceLease,
    root_execution: &GitExecutionScope,
    worktree_execution: &GitExecutionScope,
    args: &[&str],
    patch: &str,
    stdout_policy: GitStdoutPolicy,
) -> Result<GitResult, String> {
    match run_workspace_lease_patch_command(worktree_execution, args, patch, stdout_policy).await {
        Ok(result) => Ok(result),
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
                    "Workspace lease authority changed during patch application: {authority_error}; {error}"
                ),
            )
            .await),
        },
    }
}

pub(super) async fn apply_workspace_lease_patch_from_pool(
    pool: &SqlitePool,
    project_id: &str,
    canonical_root: &Path,
    lease_id: &str,
    expected_path: &Path,
    patch: &str,
    reverse: bool,
) -> Result<(), String> {
    validate_workspace_lease_patch_input(lease_id, patch, reverse)?;
    let lease = load_registered_workspace_lease_from_pool(
        pool,
        project_id,
        canonical_root,
        lease_id,
        Some(expected_path),
        None,
        None,
    )
    .await?;
    let (root_execution, worktree_execution) =
        registered_workspace_lease_scopes(pool, project_id, canonical_root, &lease).await?;

    let numstat = run_workspace_lease_patch_command_checked(
        pool,
        project_id,
        &lease,
        &root_execution,
        &worktree_execution,
        &["apply", "--numstat", "-z", "--reverse", "--recount", "-"],
        patch,
        GitStdoutPolicy::MachineExact,
    )
    .await?;
    if !numstat.ok {
        return Err(workspace_lease_command_error(
            numstat,
            "Inspect workspace review patch",
        ));
    }
    let patch_paths = workspace_lease_patch_numstat_paths(&numstat.stdout)?;
    let current_paths = current_workspace_lease_diff_paths(&root_execution, &worktree_execution)
        .await
        .map_err(|error| format!("Verify workspace review patch paths: {error}"))?;
    if !patch_paths.is_subset(&current_paths) {
        return Err("Workspace review patch includes a path outside the current lease diff".into());
    }
    let canonical_diff =
        current_workspace_lease_canonical_diff(&root_execution, &worktree_execution, &patch_paths)
            .await
            .map_err(|error| format!("Verify canonical workspace review patch: {error}"))?;
    if !workspace_review_patch_is_canonical_subset(patch, &canonical_diff)? {
        return Err(
            "Workspace review patch is not an exact subset of the current lease diff".into(),
        );
    }

    let checked = run_workspace_lease_patch_command_checked(
        pool,
        project_id,
        &lease,
        &root_execution,
        &worktree_execution,
        &[
            "apply",
            "--check",
            "--reverse",
            "--recount",
            "--whitespace=nowarn",
            "-",
        ],
        patch,
        GitStdoutPolicy::HumanRedacted,
    )
    .await?;
    if !checked.ok {
        return Err(workspace_lease_command_error(
            checked,
            "Check workspace review patch",
        ));
    }

    let applied = run_workspace_lease_patch_command_checked(
        pool,
        project_id,
        &lease,
        &root_execution,
        &worktree_execution,
        &[
            "apply",
            "--reverse",
            "--recount",
            "--whitespace=nowarn",
            "-",
        ],
        patch,
        GitStdoutPolicy::HumanRedacted,
    )
    .await?;
    if !applied.ok {
        return Err(workspace_lease_command_error(
            applied,
            "Apply workspace review patch",
        ));
    }
    root_execution.verify_live()?;
    worktree_execution.verify_live()?;

    let worktree_identity_json = serde_json::to_string(&lease.worktree_identity)
        .map_err(|error| format!("Encode workspace lease identity: {error}"))?;
    let project_identity_json = serde_json::to_string(&lease.project_identity)
        .map_err(|error| format!("Encode workspace lease Project identity: {error}"))?;
    let updated = sqlx::query(
        "UPDATE task_workspace_lease_history SET updated_at_unix_ms = ? WHERE lease_id = ? AND project_id = ? AND active_binding_id = ? AND branch = ? AND canonical_worktree = ? AND worktree_identity_json = ? AND project_root_identity_json = ? AND status = 'active'",
    )
    .bind(git_now_unix_ms()?)
    .bind(&lease.lease_id)
    .bind(project_id)
    .bind(&lease.active_binding_id)
    .bind(&lease.branch)
    .bind(lease.canonical_worktree.to_string_lossy().as_ref())
    .bind(worktree_identity_json)
    .bind(project_identity_json)
    .execute(pool)
    .await
    .map_err(|error| format!("Update workspace lease review timestamp: {error}"))?;
    if updated.rows_affected() != 1 {
        return Err("Workspace lease registration changed during patch application".into());
    }
    Ok(())
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

pub(super) async fn registered_workspace_lease_changed_for_project<R: Runtime>(
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

pub(super) fn workspace_lease_command_error(result: GitResult, action: &str) -> String {
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

pub(super) async fn close_registered_workspace_lease_for_project<R: Runtime>(
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

#[cfg(test)]
pub(in crate::git) mod tests {
    use super::*;
    use crate::git::exec::tests::*;
    use sqlx::sqlite::SqlitePoolOptions;

    pub(in crate::git) async fn lease_pool() -> SqlitePool {
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

    pub(in crate::git) async fn lease_pool_with_binding_status(status: &str) -> SqlitePool {
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

    pub(in crate::git) async fn lease_projection_pool(
        root: &Path,
        owner_status: &str,
    ) -> SqlitePool {
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

    pub(in crate::git) async fn agent_run_provenance_pool() -> SqlitePool {
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

    pub(in crate::git) async fn persist_fixture_lease(
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
            None,
        )
        .await
    }

    pub(in crate::git) async fn fixture_lease_status(pool: &SqlitePool, lease_id: &str) -> String {
        sqlx::query_scalar("SELECT status FROM task_workspace_lease_history WHERE lease_id = ?")
            .bind(lease_id)
            .fetch_one(pool)
            .await
            .expect("read fixture lease status")
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

    #[tokio::test]
    async fn workspace_review_patch_atomically_reverses_multiple_files_and_updates_lease() {
        let root = git_root();
        std::fs::write(root.join("review.txt"), "before\n").expect("write reviewed fixture");
        std::fs::write(root.join("second.txt"), "second before\n")
            .expect("write second reviewed fixture");
        fixture_git_ok(&root, &["add", "review.txt", "second.txt"]);
        fixture_git_ok(&root, &["commit", "-m", "add reviewed fixture"]);
        let lease_id = "lease-review-patch";
        let (worktree, branch) = fixture_worktree(&root, lease_id, "run-review-patch");
        let pool = lease_pool().await;
        persist_fixture_lease(&pool, &root, &worktree, lease_id, &branch, None)
            .await
            .expect("persist review lease");

        std::fs::write(worktree.join("review.txt"), "after\n").expect("change reviewed fixture");
        std::fs::write(worktree.join("second.txt"), "second after\n")
            .expect("change second reviewed fixture");
        let diff = fixture_git(&worktree, &["diff", "--", "review.txt", "second.txt"]);
        assert!(diff.status.success());
        let patch = String::from_utf8(diff.stdout).expect("utf8 review patch");

        apply_workspace_lease_patch_from_pool(
            &pool,
            "project-1",
            &root,
            lease_id,
            &worktree,
            &patch,
            true,
        )
        .await
        .expect("reverse reviewed file patch");

        assert_eq!(
            std::fs::read_to_string(worktree.join("review.txt")).expect("read reviewed fixture"),
            "before\n"
        );
        assert_eq!(
            std::fs::read_to_string(worktree.join("second.txt"))
                .expect("read second reviewed fixture"),
            "second before\n"
        );
        let remaining = fixture_git(&worktree, &["diff", "--", "review.txt", "second.txt"]);
        assert!(remaining.status.success());
        assert!(remaining.stdout.is_empty());
        let updated_at: i64 = sqlx::query_scalar(
            "SELECT updated_at_unix_ms FROM task_workspace_lease_history WHERE lease_id = ?",
        )
        .bind(lease_id)
        .fetch_one(&pool)
        .await
        .expect("read review timestamp");
        assert!(updated_at > 1);
        cleanup_root(root);
    }

    #[tokio::test]
    async fn workspace_review_patch_accepts_small_hunk_from_large_canonical_diff() {
        let root = git_root();
        let filler = (0..12)
            .map(|index| format!("unchanged {index}"))
            .collect::<Vec<_>>()
            .join("\n");
        let large_before = "a".repeat(600_000);
        let large_after = "b".repeat(600_000);
        let before = format!("small before\n{filler}\n{large_before}\n");
        let after = format!("small after\n{filler}\n{large_after}\n");
        std::fs::write(root.join("large-review.txt"), &before).expect("write large base fixture");
        fixture_git_ok(&root, &["add", "large-review.txt"]);
        fixture_git_ok(&root, &["commit", "-m", "add large review fixture"]);
        let lease_id = "lease-large-review-patch";
        let (worktree, branch) = fixture_worktree(&root, lease_id, "run-large-review-patch");
        let pool = lease_pool().await;
        persist_fixture_lease(&pool, &root, &worktree, lease_id, &branch, None)
            .await
            .expect("persist large review lease");
        std::fs::write(worktree.join("large-review.txt"), &after)
            .expect("write large reviewed fixture");
        let diff = fixture_git(
            &worktree,
            &["diff", "--unified=3", "--", "large-review.txt"],
        );
        assert!(diff.status.success());
        let canonical = String::from_utf8(diff.stdout).expect("utf8 large review diff");
        assert!(canonical.len() > MAX_GIT_OUTPUT_BYTES);
        let sections =
            workspace_review_patch_sections(&canonical).expect("parse large review diff");
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].hunks.len(), 2);
        let patch = format!("{}\n{}\n", sections[0].headers, sections[0].hunks[0]);
        assert!(patch.len() < MAX_WORKSPACE_LEASE_PATCH_BYTES);

        apply_workspace_lease_patch_from_pool(
            &pool,
            "project-1",
            &root,
            lease_id,
            &worktree,
            &patch,
            true,
        )
        .await
        .expect("reverse a small hunk from a large canonical diff");

        let current = std::fs::read_to_string(worktree.join("large-review.txt"))
            .expect("read large reviewed fixture");
        assert!(current.starts_with("small before\n"));
        assert!(current.ends_with(&format!("{large_after}\n")));
        cleanup_root(root);
    }

    #[tokio::test]
    async fn workspace_review_patch_rejects_forward_and_internal_paths() {
        let root = git_root();
        std::fs::write(root.join("review.txt"), "before\n").expect("write reviewed fixture");
        fixture_git_ok(&root, &["add", "review.txt"]);
        fixture_git_ok(&root, &["commit", "-m", "add reviewed fixture"]);
        let lease_id = "lease-review-guard";
        let (worktree, branch) = fixture_worktree(&root, lease_id, "run-review-guard");
        let pool = lease_pool().await;
        persist_fixture_lease(&pool, &root, &worktree, lease_id, &branch, None)
            .await
            .expect("persist guarded review lease");
        std::fs::write(worktree.join("review.txt"), "after\n").expect("change reviewed fixture");
        let diff = fixture_git(&worktree, &["diff", "--", "review.txt"]);
        let patch = String::from_utf8(diff.stdout).expect("utf8 review patch");

        let forward_error = apply_workspace_lease_patch_from_pool(
            &pool,
            "project-1",
            &root,
            lease_id,
            &worktree,
            &patch,
            false,
        )
        .await
        .expect_err("forward workspace review patch must fail closed");
        assert!(forward_error.contains("only support reverse"));
        assert_eq!(
            std::fs::read_to_string(worktree.join("review.txt")).expect("read guarded fixture"),
            "after\n"
        );

        let forged_same_path_patch = "diff --git a/review.txt b/review.txt\n--- a/review.txt\n+++ b/review.txt\n@@ -1 +1 @@\n-owned by forged patch\n+after\n";
        let forged_error = apply_workspace_lease_patch_from_pool(
            &pool,
            "project-1",
            &root,
            lease_id,
            &worktree,
            forged_same_path_patch,
            true,
        )
        .await
        .expect_err("same-path forged patch must not mutate the lease");
        assert!(
            forged_error.contains("not an exact subset"),
            "{forged_error}"
        );
        assert_eq!(
            std::fs::read_to_string(worktree.join("review.txt")).expect("read guarded fixture"),
            "after\n"
        );

        let internal_patch = "diff --git a/.offisim/private.txt b/.offisim/private.txt\nnew file mode 100644\n--- /dev/null\n+++ b/.offisim/private.txt\n@@ -0,0 +1 @@\n+private\n";
        let internal_error = apply_workspace_lease_patch_from_pool(
            &pool,
            "project-1",
            &root,
            lease_id,
            &worktree,
            internal_patch,
            true,
        )
        .await
        .expect_err("internal workspace path must fail closed");
        assert!(
            internal_error.contains(".git or .offisim"),
            "{internal_error}"
        );

        let unrelated_patch = "diff --git a/unrelated.txt b/unrelated.txt\nnew file mode 100644\n--- /dev/null\n+++ b/unrelated.txt\n@@ -0,0 +1 @@\n+unrelated\n";
        let unrelated_error = apply_workspace_lease_patch_from_pool(
            &pool,
            "project-1",
            &root,
            lease_id,
            &worktree,
            unrelated_patch,
            true,
        )
        .await
        .expect_err("path outside the current lease diff must fail closed");
        assert!(
            unrelated_error.contains("outside the current lease diff"),
            "{unrelated_error}"
        );
        cleanup_root(root);
    }

    #[test]
    fn workspace_review_patch_rejects_unbounded_or_unsafe_input() {
        assert!(validate_workspace_lease_patch_input("lease-1", "", true).is_err());
        assert!(validate_workspace_lease_patch_input("lease-1", "patch\0data", true).is_err());
        assert!(validate_workspace_lease_patch_input(
            "lease-1",
            &"x".repeat(MAX_WORKSPACE_LEASE_PATCH_BYTES + 1),
            true,
        )
        .is_err());
        assert!(validate_workspace_lease_patch_path("../outside.txt").is_err());
        assert!(validate_workspace_lease_patch_path("/absolute.txt").is_err());
        assert!(validate_workspace_lease_patch_path("src/.git/config").is_err());
        assert!(validate_workspace_lease_patch_path("src/.GIT/config").is_err());
        assert!(validate_workspace_lease_patch_path("src/.offisim/state").is_err());
    }

    #[test]
    fn workspace_review_patch_accepts_only_exact_safe_hunk_subsets() {
        let canonical = "diff --git a/src/file.ts b/src/file.ts\nindex 1111111..2222222 100644\n--- a/src/file.ts\n+++ b/src/file.ts\n@@ -1,3 +1,3 @@\n one\n-old\n+new\n three\n@@ -20,3 +20,3 @@\n twenty\n-before\n+after\n end\n";
        let safe_subset = "diff --git a/src/file.ts b/src/file.ts\nindex 1111111..2222222 100644\n--- a/src/file.ts\n+++ b/src/file.ts\n@@ -20,3 +20,3 @@\n twenty\n-before\n+after\n end\n";
        let forged_subset = "diff --git a/src/file.ts b/src/file.ts\nindex 1111111..2222222 100644\n--- a/src/file.ts\n+++ b/src/file.ts\n@@ -20,3 +20,3 @@\n twenty\n-owned\n+after\n end\n";
        assert!(
            workspace_review_patch_is_canonical_subset(safe_subset, canonical)
                .expect("validate safe subset")
        );
        assert!(
            !workspace_review_patch_is_canonical_subset(forged_subset, canonical)
                .expect("reject forged subset")
        );

        let renamed = "diff --git a/src/old.ts b/src/new.ts\nsimilarity index 88%\nrename from src/old.ts\nrename to src/new.ts\n--- a/src/old.ts\n+++ b/src/new.ts\n@@ -1 +1 @@\n-old\n+new\n@@ -10 +10 @@\n-before\n+after\n";
        let renamed_hunk = "diff --git a/src/old.ts b/src/new.ts\nsimilarity index 88%\nrename from src/old.ts\nrename to src/new.ts\n--- a/src/old.ts\n+++ b/src/new.ts\n@@ -10 +10 @@\n-before\n+after\n";
        assert!(
            !workspace_review_patch_is_canonical_subset(renamed_hunk, renamed)
                .expect("reject partial rename")
        );
        assert!(workspace_review_patch_is_canonical_subset(renamed, renamed)
            .expect("accept exact rename"));
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
            None,
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
}
