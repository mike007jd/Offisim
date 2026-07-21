use super::*;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCheckpointRow {
    checkpoint_id: String,
    lease_id: String,
    project_id: String,
    run_id: String,
    thread_id: Option<String>,
    root_run_id: String,
    workspace_root: String,
    cwd: String,
    branch: String,
    step: i64,
    #[serde(rename = "ref")]
    checkpoint_ref: String,
    trigger_tool: String,
    trigger_tool_call_id: Option<String>,
    created_at: String,
    changed_paths: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCheckpointRollbackRow {
    rollback_id: String,
    lease_id: String,
    project_id: String,
    checkpoint_id: String,
    target_step: i64,
    target_ref: String,
    actor: String,
    rolled_back_at: String,
    changed_paths: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCheckpointTimeline {
    checkpoints: Vec<WorkspaceCheckpointRow>,
    rollbacks: Vec<WorkspaceCheckpointRollbackRow>,
}

struct CheckpointIndexDir {
    _dir: tempfile::TempDir,
    index: PathBuf,
}

impl CheckpointIndexDir {
    fn create() -> Result<Self, String> {
        #[cfg(unix)]
        use std::os::unix::fs::PermissionsExt;

        let mut builder = tempfile::Builder::new();
        builder.prefix("offisim-checkpoint-index-");
        #[cfg(unix)]
        builder.permissions(std::fs::Permissions::from_mode(0o700));
        let dir = builder
            .tempdir()
            .map_err(|error| format!("Create checkpoint index directory: {error}"))?;
        let index = dir.path().join("index");
        Ok(Self { _dir: dir, index })
    }
}

fn checkpoint_ref(lease_id: &str, step: i64) -> Result<String, String> {
    if lease_id.is_empty() || sanitize_workspace_ref(lease_id) != lease_id || step < 0 {
        return Err("Checkpoint requires a valid lease id and non-negative step".into());
    }
    let reference = format!("{CHECKPOINT_REF_PREFIX}{lease_id}/{step}");
    validate_checkpoint_ref(&reference)?;
    Ok(reference)
}

fn checkpoint_git_error(result: GitResult, action: &str) -> String {
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

fn checkpoint_oid(result: GitResult, action: &str) -> Result<String, String> {
    if !result.ok {
        return Err(checkpoint_git_error(result, action));
    }
    let oid = result.stdout.trim();
    if !is_full_git_sha(oid) {
        return Err(format!("{action} returned an invalid object id"));
    }
    Ok(oid.to_string())
}

async fn run_checkpoint_git(
    execution: &GitExecutionScope,
    args: Vec<String>,
    index: Option<&Path>,
    commit_date: Option<&str>,
) -> Result<GitResult, String> {
    is_allowed(&args, &execution.root_path)?;
    let mut command = Command::new("git");
    command.args(&args).env_clear().envs(scrubbed_git_env());
    if let Some(index) = index {
        command.env("GIT_INDEX_FILE", index);
    }
    if let Some(date) = commit_date {
        command
            .env("GIT_AUTHOR_NAME", "Offisim Checkpoint")
            .env("GIT_AUTHOR_EMAIL", "checkpoint@offisim.local")
            .env("GIT_COMMITTER_NAME", "Offisim Checkpoint")
            .env("GIT_COMMITTER_EMAIL", "checkpoint@offisim.local")
            .env("GIT_AUTHOR_DATE", date)
            .env("GIT_COMMITTER_DATE", date);
    }
    execution.bind_command(&mut command)?;
    let result = run_git_capped_machine(command, GIT_EXEC_TIMEOUT, MAX_GIT_OUTPUT_BYTES).await?;
    execution.verify_live()?;
    Ok(result)
}

async fn checkpoint_index_tree(
    execution: &GitExecutionScope,
    index: &Path,
) -> Result<String, String> {
    let read = run_checkpoint_git(
        execution,
        vec!["read-tree".into(), "HEAD".into()],
        Some(index),
        None,
    )
    .await?;
    if !read.ok {
        return Err(checkpoint_git_error(read, "Initialize checkpoint index"));
    }
    let add = run_checkpoint_git(
        execution,
        vec!["add".into(), "--all".into(), "--".into(), ".".into()],
        Some(index),
        None,
    )
    .await?;
    if !add.ok {
        return Err(checkpoint_git_error(add, "Stage checkpoint tree"));
    }
    checkpoint_oid(
        run_checkpoint_git(execution, vec!["write-tree".into()], Some(index), None).await?,
        "Write checkpoint tree",
    )
}

fn nul_paths(output: &str) -> Vec<String> {
    output
        .split('\0')
        .filter(|path| !path.is_empty())
        .map(str::to_string)
        .collect()
}

async fn diff_checkpoint_paths(
    execution: &GitExecutionScope,
    from: &str,
    to: &str,
) -> Result<Vec<String>, String> {
    let result = run_checkpoint_git(
        execution,
        vec![
            "diff".into(),
            "--name-only".into(),
            "-z".into(),
            from.into(),
            to.into(),
        ],
        None,
        None,
    )
    .await?;
    if !result.ok {
        return Err(checkpoint_git_error(result, "Compare checkpoint trees"));
    }
    Ok(nul_paths(&result.stdout))
}

async fn resolve_checkpoint_ref(
    execution: &GitExecutionScope,
    reference: &str,
) -> Result<String, String> {
    validate_checkpoint_ref(reference)?;
    checkpoint_oid(
        run_checkpoint_git(
            execution,
            vec!["rev-parse".into(), "--verify".into(), reference.into()],
            None,
            None,
        )
        .await?,
        "Resolve checkpoint ref",
    )
}

fn decode_changed_paths(json: String) -> Result<Vec<String>, String> {
    serde_json::from_str::<Vec<String>>(&json)
        .map_err(|error| format!("Decode checkpoint changed paths: {error}"))
}

pub(super) async fn workspace_checkpoint_timeline_from_pool(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<WorkspaceCheckpointTimeline, String> {
    let checkpoint_rows = sqlx::query(
        r#"
        SELECT checkpoint.checkpoint_id, checkpoint.lease_id, lease.project_id,
               checkpoint.run_id, binding.thread_id, lease.created_root_run_id,
               binding.canonical_root, lease.canonical_worktree, lease.branch,
               checkpoint.step, checkpoint.checkpoint_ref, checkpoint.trigger_tool,
               checkpoint.trigger_tool_call_id, checkpoint.created_at,
               checkpoint.changed_paths_json
        FROM workspace_checkpoints AS checkpoint
        JOIN task_workspace_lease_history AS lease ON lease.lease_id = checkpoint.lease_id
        JOIN task_workspace_binding_history AS binding ON binding.binding_id = lease.created_binding_id
        WHERE lease.project_id = ?
        ORDER BY checkpoint.created_at DESC, checkpoint.step DESC
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Read workspace checkpoints: {error}"))?;
    let mut checkpoints = Vec::with_capacity(checkpoint_rows.len());
    for row in checkpoint_rows {
        checkpoints.push(WorkspaceCheckpointRow {
            checkpoint_id: row.try_get("checkpoint_id").map_err(|e| e.to_string())?,
            lease_id: row.try_get("lease_id").map_err(|e| e.to_string())?,
            project_id: row.try_get("project_id").map_err(|e| e.to_string())?,
            run_id: row.try_get("run_id").map_err(|e| e.to_string())?,
            thread_id: row.try_get("thread_id").map_err(|e| e.to_string())?,
            root_run_id: row
                .try_get("created_root_run_id")
                .map_err(|e| e.to_string())?,
            workspace_root: row.try_get("canonical_root").map_err(|e| e.to_string())?,
            cwd: row
                .try_get("canonical_worktree")
                .map_err(|e| e.to_string())?,
            branch: row.try_get("branch").map_err(|e| e.to_string())?,
            step: row.try_get("step").map_err(|e| e.to_string())?,
            checkpoint_ref: row.try_get("checkpoint_ref").map_err(|e| e.to_string())?,
            trigger_tool: row.try_get("trigger_tool").map_err(|e| e.to_string())?,
            trigger_tool_call_id: row
                .try_get("trigger_tool_call_id")
                .map_err(|e| e.to_string())?,
            created_at: row.try_get("created_at").map_err(|e| e.to_string())?,
            changed_paths: decode_changed_paths(
                row.try_get("changed_paths_json")
                    .map_err(|e| e.to_string())?,
            )?,
        });
    }
    let rollback_rows = sqlx::query(
        r#"
        SELECT rollback.rollback_id, rollback.lease_id, lease.project_id,
               rollback.checkpoint_id, rollback.target_step, rollback.target_ref,
               rollback.actor, rollback.rolled_back_at, rollback.changed_paths_json
        FROM workspace_checkpoint_rollbacks AS rollback
        JOIN task_workspace_lease_history AS lease ON lease.lease_id = rollback.lease_id
        WHERE lease.project_id = ? AND rollback.status = 'completed'
        ORDER BY rollback.rolled_back_at DESC
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Read workspace checkpoint rollbacks: {error}"))?;
    let mut rollbacks = Vec::with_capacity(rollback_rows.len());
    for row in rollback_rows {
        rollbacks.push(WorkspaceCheckpointRollbackRow {
            rollback_id: row.try_get("rollback_id").map_err(|e| e.to_string())?,
            lease_id: row.try_get("lease_id").map_err(|e| e.to_string())?,
            project_id: row.try_get("project_id").map_err(|e| e.to_string())?,
            checkpoint_id: row.try_get("checkpoint_id").map_err(|e| e.to_string())?,
            target_step: row.try_get("target_step").map_err(|e| e.to_string())?,
            target_ref: row.try_get("target_ref").map_err(|e| e.to_string())?,
            actor: row.try_get("actor").map_err(|e| e.to_string())?,
            rolled_back_at: row.try_get("rolled_back_at").map_err(|e| e.to_string())?,
            changed_paths: decode_changed_paths(
                row.try_get("changed_paths_json")
                    .map_err(|e| e.to_string())?,
            )?,
        });
    }
    Ok(WorkspaceCheckpointTimeline {
        checkpoints,
        rollbacks,
    })
}

pub(crate) async fn create_registered_workspace_checkpoint<R: Runtime>(
    app: &tauri::AppHandle<R>,
    binding: &TaskWorkspaceBinding,
    path: &Path,
    run_id: &str,
    trigger_tool: &str,
    trigger_tool_call_id: Option<&str>,
    created_at: &str,
) -> Result<Option<WorkspaceCheckpointRow>, String> {
    let _guard = lock_workspace_lease_mutation().await;
    let lease_id = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Workspace checkpoint path has no lease id".to_string())?;
    let run_id = run_id.trim();
    let trigger_tool = trigger_tool.trim();
    let created_at = created_at.trim();
    if run_id.is_empty() || run_id.len() > 256 {
        return Err("Workspace checkpoint requires a bounded run id".into());
    }
    if trigger_tool.is_empty() || trigger_tool.len() > 128 {
        return Err("Workspace checkpoint requires a bounded trigger tool".into());
    }
    if created_at.is_empty() || created_at.len() > 64 {
        return Err("Workspace checkpoint requires a bounded timestamp".into());
    }
    if trigger_tool_call_id.is_some_and(|value| value.trim().is_empty() || value.len() > 256) {
        return Err("Workspace checkpoint tool call id is invalid".into());
    }

    let pool = crate::local_db::get_offisim_pool(app)?;
    let lease = load_registered_workspace_lease_from_pool(
        &pool,
        &binding.project_id,
        &binding.canonical_root,
        lease_id,
        Some(path),
        None,
        Some(&binding.binding_id),
    )
    .await?;
    let (_, execution) = registered_workspace_lease_scopes(
        &pool,
        &binding.project_id,
        &binding.canonical_root,
        &lease,
    )
    .await?;
    let latest = sqlx::query(
        "SELECT step, checkpoint_ref FROM workspace_checkpoints WHERE lease_id = ? ORDER BY step DESC LIMIT 1",
    )
    .bind(lease_id)
    .fetch_optional(&pool)
    .await
    .map_err(|error| format!("Read latest workspace checkpoint: {error}"))?;
    let (step, parent) = if let Some(row) = latest {
        let step: i64 = row
            .try_get("step")
            .map_err(|error| format!("Decode latest checkpoint step: {error}"))?;
        let reference: String = row
            .try_get("checkpoint_ref")
            .map_err(|error| format!("Decode latest checkpoint ref: {error}"))?;
        (
            step + 1,
            resolve_checkpoint_ref(&execution, &reference).await?,
        )
    } else {
        let head = checkpoint_oid(
            run_checkpoint_git(
                &execution,
                vec!["rev-parse".into(), "HEAD".into()],
                None,
                None,
            )
            .await?,
            "Resolve checkpoint baseline",
        )?;
        (0, head)
    };
    let index = CheckpointIndexDir::create()?;
    let tree = checkpoint_index_tree(&execution, &index.index).await?;
    let message = format!("offisim checkpoint {lease_id} step {step} ({trigger_tool})");
    let commit = checkpoint_oid(
        run_checkpoint_git(
            &execution,
            vec![
                "commit-tree".into(),
                tree,
                "-p".into(),
                parent.clone(),
                "-m".into(),
                message,
            ],
            Some(&index.index),
            Some(created_at),
        )
        .await?,
        "Create checkpoint commit",
    )?;
    let changed_paths = diff_checkpoint_paths(&execution, &parent, &commit).await?;
    if step > 0 && changed_paths.is_empty() {
        return Ok(None);
    }
    let reference = checkpoint_ref(lease_id, step)?;
    let update = run_checkpoint_git(
        &execution,
        vec!["update-ref".into(), reference.clone(), commit.clone()],
        None,
        None,
    )
    .await?;
    if !update.ok {
        return Err(checkpoint_git_error(update, "Create checkpoint ref"));
    }
    let checkpoint_id = format!("checkpoint:{lease_id}:{step}");
    let changed_paths_json = serde_json::to_string(&changed_paths)
        .map_err(|error| format!("Encode checkpoint changed paths: {error}"))?;
    if let Err(error) = sqlx::query(
        r#"INSERT INTO workspace_checkpoints
           (checkpoint_id, lease_id, run_id, step, checkpoint_ref, trigger_tool,
            trigger_tool_call_id, changed_paths_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&checkpoint_id)
    .bind(lease_id)
    .bind(run_id)
    .bind(step)
    .bind(&reference)
    .bind(trigger_tool)
    .bind(trigger_tool_call_id)
    .bind(&changed_paths_json)
    .bind(created_at)
    .execute(&pool)
    .await
    {
        let _ = run_checkpoint_git(
            &execution,
            vec!["update-ref".into(), "-d".into(), reference.clone(), commit],
            None,
            None,
        )
        .await;
        return Err(format!("Persist workspace checkpoint: {error}"));
    }
    let timeline = workspace_checkpoint_timeline_from_pool(&pool, &binding.project_id).await?;
    timeline
        .checkpoints
        .into_iter()
        .find(|checkpoint| checkpoint.checkpoint_id == checkpoint_id)
        .map(Some)
        .ok_or_else(|| "Persisted workspace checkpoint could not be read back".to_string())
}

pub(crate) async fn list_registered_workspace_checkpoints<R: Runtime>(
    app: &tauri::AppHandle<R>,
    binding: &TaskWorkspaceBinding,
    path: &Path,
) -> Result<Vec<WorkspaceCheckpointRow>, String> {
    let lease_id = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Workspace checkpoint path has no lease id".to_string())?;
    let pool = crate::local_db::get_offisim_pool(app)?;
    let lease = load_registered_workspace_lease_from_pool(
        &pool,
        &binding.project_id,
        &binding.canonical_root,
        lease_id,
        Some(path),
        None,
        Some(&binding.binding_id),
    )
    .await?;
    let (_, execution) = registered_workspace_lease_scopes(
        &pool,
        &binding.project_id,
        &binding.canonical_root,
        &lease,
    )
    .await?;
    let timeline = workspace_checkpoint_timeline_from_pool(&pool, &binding.project_id).await?;
    let checkpoints: Vec<_> = timeline
        .checkpoints
        .into_iter()
        .filter(|checkpoint| checkpoint.lease_id == lease_id)
        .collect();
    for checkpoint in &checkpoints {
        resolve_checkpoint_ref(&execution, &checkpoint.checkpoint_ref).await?;
    }
    Ok(checkpoints)
}

pub(super) async fn rollback_registered_workspace_checkpoint_for_project<R: Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: &str,
    lease_id: &str,
    path: &Path,
    checkpoint_id: &str,
    actor: &str,
) -> Result<WorkspaceCheckpointRollbackRow, String> {
    let _guard = lock_workspace_lease_mutation().await;
    let actor = actor.trim();
    if actor.is_empty() || actor.len() > 128 {
        return Err("Workspace checkpoint rollback requires a bounded actor".into());
    }
    let root = project_workspace_root(app, project_id).await?;
    let pool = crate::local_db::get_offisim_pool(app)?;
    let lease = load_registered_workspace_lease_from_pool(
        &pool,
        project_id,
        root.git_root(),
        lease_id,
        Some(path),
        None,
        None,
    )
    .await?;
    let (_, execution) =
        registered_workspace_lease_scopes(&pool, project_id, root.git_root(), &lease).await?;
    let target = sqlx::query(
        "SELECT checkpoint_id, step, checkpoint_ref FROM workspace_checkpoints WHERE checkpoint_id = ? AND lease_id = ?",
    )
    .bind(checkpoint_id)
    .bind(lease_id)
    .fetch_optional(&pool)
    .await
    .map_err(|error| format!("Read rollback checkpoint: {error}"))?
    .ok_or_else(|| "The selected checkpoint does not belong to this workspace lease".to_string())?;
    let target_step: i64 = target
        .try_get("step")
        .map_err(|error| format!("Decode rollback checkpoint step: {error}"))?;
    let target_ref: String = target
        .try_get("checkpoint_ref")
        .map_err(|error| format!("Decode rollback checkpoint ref: {error}"))?;
    if checkpoint_ref(lease_id, target_step)? != target_ref {
        return Err("The selected checkpoint ref does not match its durable step".into());
    }
    let target_oid = resolve_checkpoint_ref(&execution, &target_ref).await?;
    let index = CheckpointIndexDir::create()?;
    let current_tree = checkpoint_index_tree(&execution, &index.index).await?;
    let changed_paths = diff_checkpoint_paths(&execution, &target_oid, &current_tree).await?;
    let changed_paths_json = serde_json::to_string(&changed_paths)
        .map_err(|error| format!("Encode rollback changed paths: {error}"))?;
    let rolled_back_at = unix_ms_to_rfc3339(git_now_unix_ms()?);
    let rollback_id = format!(
        "rollback:{lease_id}:{}:{:016x}",
        git_now_unix_ms()?,
        rand::random::<u64>()
    );
    sqlx::query(
        r#"INSERT INTO workspace_checkpoint_rollbacks
           (rollback_id, lease_id, checkpoint_id, target_step, target_ref, actor,
            changed_paths_json, rolled_back_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')"#,
    )
    .bind(&rollback_id)
    .bind(lease_id)
    .bind(checkpoint_id)
    .bind(target_step)
    .bind(&target_ref)
    .bind(actor)
    .bind(&changed_paths_json)
    .bind(&rolled_back_at)
    .execute(&pool)
    .await
    .map_err(|error| format!("Prepare workspace checkpoint rollback audit: {error}"))?;
    let reset = run_checkpoint_git(
        &execution,
        vec![
            "read-tree".into(),
            "--reset".into(),
            "-u".into(),
            target_oid,
        ],
        Some(&index.index),
        None,
    )
    .await;
    if let Err(error) = reset.and_then(|result| {
        if result.ok {
            Ok(result)
        } else {
            Err(checkpoint_git_error(result, "Restore checkpoint tree"))
        }
    }) {
        let _ = sqlx::query(
            "UPDATE workspace_checkpoint_rollbacks SET status = 'failed' WHERE rollback_id = ? AND status = 'pending'",
        )
        .bind(&rollback_id)
        .execute(&pool)
        .await;
        return Err(error);
    }
    execution.verify_live()?;
    let updated = sqlx::query(
        "UPDATE workspace_checkpoint_rollbacks SET status = 'completed' WHERE rollback_id = ? AND status = 'pending'",
    )
    .bind(&rollback_id)
    .execute(&pool)
    .await
    .map_err(|error| format!("Complete workspace checkpoint rollback audit: {error}"))?;
    if updated.rows_affected() != 1 {
        return Err("Workspace checkpoint rollback audit changed concurrently".into());
    }
    Ok(WorkspaceCheckpointRollbackRow {
        rollback_id,
        lease_id: lease_id.to_string(),
        project_id: project_id.to_string(),
        checkpoint_id: checkpoint_id.to_string(),
        target_step,
        target_ref,
        actor: actor.to_string(),
        rolled_back_at,
        changed_paths,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::exec::tests::*;

    #[tokio::test]
    async fn checkpoint_plumbing_snapshots_and_restores_without_moving_branch_head() {
        let root = git_root();
        let execution = git_execution(&root);
        let original_head =
            String::from_utf8_lossy(&fixture_git(&root, &["rev-parse", "HEAD"]).stdout)
                .trim()
                .to_string();
        std::fs::write(root.join("one.txt"), "one checkpoint\n").unwrap();
        std::fs::write(root.join("two.txt"), "two checkpoint\n").unwrap();
        std::fs::write(root.join("three.txt"), "three checkpoint\n").unwrap();

        let snapshot_index = CheckpointIndexDir::create().unwrap();
        let tree = checkpoint_index_tree(&execution, &snapshot_index.index)
            .await
            .unwrap();
        let commit = checkpoint_oid(
            run_checkpoint_git(
                &execution,
                vec![
                    "commit-tree".into(),
                    tree,
                    "-p".into(),
                    original_head.clone(),
                    "-m".into(),
                    "Offisim checkpoint integration test".into(),
                ],
                Some(&snapshot_index.index),
                Some("2026-07-17T00:00:00Z"),
            )
            .await
            .unwrap(),
            "Create test checkpoint",
        )
        .unwrap();
        let reference = "refs/offisim/checkpoints/lease-test/1";
        let updated = run_checkpoint_git(
            &execution,
            vec!["update-ref".into(), reference.into(), commit.clone()],
            None,
            None,
        )
        .await
        .unwrap();
        assert!(updated.ok);
        assert_eq!(
            String::from_utf8_lossy(&fixture_git(&root, &["rev-parse", "HEAD"]).stdout).trim(),
            original_head,
            "hidden checkpoint must not move branch HEAD"
        );

        std::fs::write(root.join("one.txt"), "wrong\n").unwrap();
        std::fs::remove_file(root.join("two.txt")).unwrap();
        std::fs::write(root.join("later.txt"), "remove me\n").unwrap();
        let rollback_index = CheckpointIndexDir::create().unwrap();
        checkpoint_index_tree(&execution, &rollback_index.index)
            .await
            .unwrap();
        let restored = run_checkpoint_git(
            &execution,
            vec!["read-tree".into(), "--reset".into(), "-u".into(), commit],
            Some(&rollback_index.index),
            None,
        )
        .await
        .unwrap();
        assert!(restored.ok);
        assert_eq!(
            std::fs::read_to_string(root.join("one.txt")).unwrap(),
            "one checkpoint\n"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("two.txt")).unwrap(),
            "two checkpoint\n"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("three.txt")).unwrap(),
            "three checkpoint\n"
        );
        assert!(!root.join("later.txt").exists());
        assert_eq!(
            String::from_utf8_lossy(&fixture_git(&root, &["rev-parse", reference]).stdout).trim(),
            resolve_checkpoint_ref(&execution, reference).await.unwrap()
        );
        cleanup_root(root);
    }
}
