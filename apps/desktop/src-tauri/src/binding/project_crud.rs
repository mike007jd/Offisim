use super::persistence::{host_error_message, reconcile_stale_active_bindings_from_pool};
use super::*;

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
pub async fn project_demo_workspace_prepare<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    selections: tauri::State<'_, ProjectWorkspaceSelectionRegistry>,
) -> Result<ProjectWorkspaceSelectionClaim, String> {
    let demo_root = crate::local_paths::offisim_storage_dir("demo-projects")?
        .join(format!("first-project-{}", random_id()));
    fs::create_dir_all(&demo_root)
        .map_err(|error| format!("Create the demo Project folder: {error}"))?;
    fs::write(
        demo_root.join("PROJECT_BRIEF.md"),
        "# First Project\n\nThis is a small local workspace for your first Offisim order.\n\n## Goal\n\nTurn a short request into one clear, visible deliverable.\n",
    )
    .map_err(|error| format!("Seed the demo Project brief: {error}"))?;
    fs::write(
        demo_root.join("README.md"),
        "# Welcome\n\nYour employee can read and write files in this Project folder.\n",
    )
    .map_err(|error| format!("Seed the demo Project readme: {error}"))?;
    let canonical = crate::local_paths::resolve_project_workspace_root_path(demo_root)?;
    let now = now_unix_ms().map_err(host_error_message)?;
    selections.register(window.label(), canonical, now)
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
    use super::super::persistence::{
        publish_task_workspace_binding_from_pool, record_task_workspace_binding_from_pool,
    };
    use super::super::registry::tests::{fixture_binding, scope};
    use super::super::resume_compat::tests::resume_race_pool;
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

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
        sqlx::raw_sql(include_str!(
            "../../../../../packages/db-local/src/schema.sql"
        ))
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
