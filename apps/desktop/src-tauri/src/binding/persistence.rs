use super::resume_compat::*;
use super::*;

#[derive(Debug)]
pub(super) struct RecordedTaskWorkspaceBinding {
    pub(super) rows: u64,
    pub(super) resume_session: Option<NativeSessionReference>,
}

#[derive(Clone, Debug)]
pub(super) struct ResumeBindingExpectation {
    pub(super) history_id: String,
    pub(super) session_dir: PathBuf,
}

pub(super) async fn claim_resumed_root_before_start(
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
    let update_sql = if validated.stored_session_file.is_some() {
        r#"
        UPDATE agent_runs
        SET status = 'running', runtime_context_json = ?,
            finished_at = NULL, failure_kind = NULL
        WHERE run_id = ? AND root_run_id = ? AND parent_run_id IS NULL
          AND company_id = ? AND project_id = ? AND thread_id = ?
          AND status = 'interrupted'
          AND runtime_context_json = ? AND session_file = ?
        "#
    } else {
        r#"
        UPDATE agent_runs
        SET status = 'running', runtime_context_json = ?,
            finished_at = NULL, failure_kind = NULL
        WHERE run_id = ? AND root_run_id = ? AND parent_run_id IS NULL
          AND company_id = ? AND project_id = ? AND thread_id = ?
          AND status = 'interrupted'
          AND runtime_context_json = ? AND session_file IS NULL
        "#
    };
    let update = sqlx::query(update_sql)
        .bind(&resumed_context_json)
        .bind(&binding.turn_id)
        .bind(&binding.turn_id)
        .bind(&binding.company_id)
        .bind(&binding.project_id)
        .bind(&binding.thread_id)
        .bind(runtime_context_json.as_deref());
    let update = if let Some(stored_session_file) = validated.stored_session_file.as_deref() {
        update.bind(stored_session_file)
    } else {
        update
    };
    let changed = update
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
        || readback_session_file.as_deref() != validated.stored_session_file.as_deref()
    {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::Persistence,
            "The resumed root durable readback did not match the committed Resume authority.",
        ));
    }
    Ok(validated.native_session)
}

pub(super) async fn record_task_workspace_binding_from_pool(
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

pub(super) async fn publish_task_workspace_binding_from_pool(
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

pub(super) async fn publish_resolved_task_workspace_binding(
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

pub(super) fn host_error_message(error: HostError) -> String {
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

pub(super) fn validate_task_workspace_claim(
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

pub(super) fn validate_evaluation_lease_claim(
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
pub(super) async fn verify_evaluation_scope<R: tauri::Runtime>(
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

pub(super) async fn persist_binding_revocation_with_retry(
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

pub(super) async fn reconcile_stale_active_bindings_from_pool(
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

#[cfg(test)]
mod tests {
    use super::super::registry::tests::{claim, fixture_binding, scope};
    use super::super::resume_compat::tests::{deletion_preflight_pool, resume_race_pool};
    use super::*;

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
}
