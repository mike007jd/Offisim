use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use once_cell::sync::Lazy;
use serde::Deserialize;
use sqlx::sqlite::SqlitePoolOptions;
use tauri::ipc::Channel;
use tauri::Manager;
use tokio_util::sync::CancellationToken;

use crate::agent_host_runtime::HostError;
use crate::task_workspace_binding::{test_task_workspace_binding, TaskWorkspaceBindingRegistry};

use super::bridge::PiUiResponse;
use super::payload::{
    collaborate_payload, enhance_payload, pi_session_dir_under, sidecar_payload,
    ExecuteWorkspacePayload, TestPiSessionDir,
};
use super::run::{
    authorize_mcp_frame, do_execute, gate_sidecar_terminal, mcp_bridge_profile,
    run_pi_sidecar_jsonl_inner, validate_execute_workspace_requirement,
    validate_workspace_binding_history_mode, McpBridgeProfile, PiSidecarRun, TerminalAuthorityGate,
    TestPiSidecarScript,
};
use super::stream::{
    begin_run_stream, cleanup_terminal_run_streams, finish_run_stream, finish_run_stream_at,
    pi_run_streams_guard, publish_host_event, reattach_stream, PI_RUN_STREAMS,
    PI_RUN_STREAM_BUFFER_LIMIT, PI_RUN_STREAM_TERMINAL_TTL,
};
use super::types::{
    PiAgentCollaborateRequest, PiAgentEnhanceRequest, PiAgentExecuteRequest, PiAgentHostEvent,
    PiAgentHostResponse,
};
use super::wire::{
    consume_ready_handshake, decode_sidecar_line, parse_response, PiSidecarLine,
    PI_HOST_PROTOCOL_VERSION, PI_KNOWN_WIRE_KINDS,
};
use super::{agent_runtime_release_stream, agent_runtime_stream_snapshot};

static PI_RUN_STREAM_TEST_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
static NEXT_TEMP_FIXTURE_ID: AtomicU64 = AtomicU64::new(0);

fn pi_run_stream_test_guard() -> std::sync::MutexGuard<'static, ()> {
    PI_RUN_STREAM_TEST_LOCK
        .lock()
        .expect("pi run stream test lock poisoned")
}

fn unique_suffix() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before epoch")
        .as_nanos();
    let sequence = NEXT_TEMP_FIXTURE_ID.fetch_add(1, Ordering::Relaxed);
    format!("{}-{timestamp}-{sequence}", std::process::id())
}

fn temp_project_root(label: &str) -> PathBuf {
    let suffix = unique_suffix();
    let root = std::env::temp_dir().join(format!("offisim-pi-agent-{label}-{suffix}"));
    std::fs::create_dir_all(&root).expect("create temp project root");
    root.canonicalize().expect("canonical temp project root")
}

struct ResumePrestartFixture {
    app: tauri::App<tauri::test::MockRuntime>,
    pool: sqlx::SqlitePool,
    root: PathBuf,
    sidecar_audit_root: PathBuf,
    session_dir: PathBuf,
    session_file: PathBuf,
    invocation_file: PathBuf,
    payload_file: PathBuf,
    sidecar_failure_file: PathBuf,
}

impl Drop for ResumePrestartFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
        let _ = std::fs::remove_dir_all(&self.sidecar_audit_root);
    }
}

async fn resume_prestart_fixture(runtime_context_json: serde_json::Value) -> ResumePrestartFixture {
    let root = temp_project_root("resume-prestart");
    let canonical_root = root.to_string_lossy().to_string();
    let session_dir = root.join("sessions");
    std::fs::create_dir_all(&session_dir).expect("create resume native session directory");
    let session_file = session_dir.join("session-a.jsonl");
    std::fs::write(
        &session_file,
        format!(
            "{{\"type\":\"session\",\"version\":3,\"id\":\"session-a\",\"timestamp\":\"2026-07-14T00:00:00.000Z\",\"cwd\":{}}}\n",
            serde_json::to_string(&canonical_root).expect("encode resume session cwd")
        ),
    )
    .expect("write resume native session");
    // Sidecar audit/control files must not mutate the selected Project tree.
    // Workspace identity revalidation is intentionally sensitive to those
    // changes, so test instrumentation lives in a separate temp root.
    let sidecar_audit_root = temp_project_root("sidecar-audit");
    let invocation_file = sidecar_audit_root.join("sidecar-invocations");
    let payload_file = sidecar_audit_root.join("sidecar-payload.json");
    let sidecar_failure_file = sidecar_audit_root.join("sidecar-failure-enabled");
    let script = sidecar_audit_root.join("resume-sidecar.mjs");
    let invocation_path =
        serde_json::to_string(&invocation_file.to_string_lossy()).expect("encode invocation path");
    let payload_path =
        serde_json::to_string(&payload_file.to_string_lossy()).expect("encode payload path");
    let failure_path = serde_json::to_string(&sidecar_failure_file.to_string_lossy())
        .expect("encode sidecar failure path");
    std::fs::write(
        &script,
        format!(
            "import fs from 'node:fs';\nimport {{ createInterface }} from 'node:readline';\nfs.appendFileSync({invocation_path}, 'spawned\\n');\nconsole.log(JSON.stringify({{ kind: 'ready', protocolVersion: 9 }}));\nconst input = createInterface({{ input: process.stdin }});\nfor await (const line of input) {{\n  fs.writeFileSync({payload_path}, line);\n  break;\n}}\ninput.close();\nif (fs.existsSync({failure_path})) {{\n  console.log(JSON.stringify({{ kind: 'error', code: 'fixture-upstream', message: 'injected sidecar failure after durable session reset' }}));\n}} else {{\n  console.log(JSON.stringify({{ kind: 'result', response: {{ text: 'done' }} }}));\n}}\n"
        ),
    )
    .expect("write resume test sidecar");

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("open resume prestart db");
    sqlx::raw_sql(include_str!(
        "../../../../../packages/db-local/src/schema.sql"
    ))
    .execute(&pool)
    .await
    .expect("apply production local schema");

    let identity_json = test_task_workspace_binding(&root, "project-1", None, 3, None)
        .expected_root_identity_json()
        .expect("encode fixture root identity");
    let evidence = crate::workspace_recovery::capture_workspace_evidence(&root, "Project")
        .expect("capture fixture workspace evidence");
    for statement in [
        "INSERT INTO companies (company_id, name, created_at, updated_at) VALUES ('company-1', 'Company', '2026-07-14T00:00:00Z', '2026-07-14T00:00:00Z')",
        "INSERT INTO projects (project_id, company_id, name, workspace_root, created_at, updated_at) VALUES ('project-1', 'company-1', 'Project', ?, '2026-07-14T00:00:00Z', '2026-07-14T00:00:00Z')",
        "INSERT INTO project_workspace_authority (project_id, company_id, canonical_root, root_identity_json, selected_at_unix_ms, updated_at_unix_ms) VALUES ('project-1', 'company-1', ?, ?, 1000, 1000)",
        "INSERT INTO chat_threads (thread_id, project_id, title, created_at, updated_at) VALUES ('thread-1', 'project-1', 'Conversation', '2026-07-14T00:00:00Z', '2026-07-14T00:00:00Z')",
    ] {
        let mut query = sqlx::query(statement);
        if statement.contains("INSERT INTO projects") {
            query = query.bind(&canonical_root);
        } else if statement.contains("project_workspace_authority") {
            query = query.bind(&canonical_root).bind(&identity_json);
        }
        query.execute(&pool).await.expect("seed resume scope");
    }
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
          source, confidence, reason_code, issued_at_unix_ms, expires_at_unix_ms,
          activated_at_unix_ms, last_used_at_unix_ms, status
        ) VALUES (
          'history-1', 'company-1', 'project-1', 'thread-1', 'turn-1',
          'old-request', 'write', ?, ?, ?, ?, ?, ?, ?, ?, 1000,
          'project_catalog', 1.0, 'current_project_folder', 1, 2, 1, 1,
          'app_restart'
        )
        "#,
    )
    .bind(&canonical_root)
    .bind(&identity_json)
    .bind(&evidence.basename_normalized)
    .bind(&evidence.project_name_normalized)
    .bind(&evidence.anchor)
    .bind(&evidence.git_origin_digest)
    .bind(&canonical_root)
    .bind(&identity_json)
    .execute(&pool)
    .await
    .expect("seed interrupted workspace history");
    sqlx::query(
        r#"
        INSERT INTO agent_runs (
          run_id, thread_id, company_id, project_id, root_run_id, status,
          runtime_context_json, session_file, started_at
        ) VALUES (
          'turn-1', 'thread-1', 'company-1', 'project-1', 'turn-1',
          'interrupted', ?, ?, '2026-07-14T00:00:00Z'
        )
        "#,
    )
    .bind(runtime_context_json.to_string())
    .bind(session_file.to_string_lossy().to_string())
    .execute(&pool)
    .await
    .expect("seed interrupted root run");

    let app = tauri::test::mock_app();
    crate::local_db::install_test_offisim_pool(app.handle(), pool.clone());
    app.manage(TaskWorkspaceBindingRegistry::default());
    app.manage(TestPiSidecarScript(script));
    app.manage(TestPiSessionDir(session_dir.clone()));
    ResumePrestartFixture {
        app,
        pool,
        root,
        sidecar_audit_root,
        session_dir,
        session_file,
        invocation_file,
        payload_file,
        sidecar_failure_file,
    }
}

fn interrupted_runtime_context() -> serde_json::Value {
    serde_json::json!({
        "requestId": "old-request",
        "streamCursor": 7,
        "workspaceBinding": {
            "historyId": "history-1",
            "companyId": "company-1",
            "projectId": "project-1",
            "threadId": "thread-1",
            "turnId": "turn-1",
            "requestId": "old-request",
            "access": "write",
            "source": "project_catalog",
            "confidence": 1.0,
            "reasonCode": "current_project_folder",
            "issuedAtUnixMs": 1,
            "expiresAtUnixMs": 2,
            "displayPath": "old-display-path"
        },
        "workspaceRequirement": "optional",
        "workspaceAvailability": "bound",
        "runtime": "pi-agent",
        "piSdkVersion": "0.79.8",
        "wireProtocolVersion": PI_HOST_PROTOCOL_VERSION,
        "nativeSessionId": "session-a",
        "projectId": "project-1"
    })
}

fn sidecar_invocation_count(fixture: &ResumePrestartFixture) -> usize {
    std::fs::read_to_string(&fixture.invocation_file)
        .map(|contents| contents.lines().count())
        .unwrap_or(0)
}

async fn run_resume(fixture: &ResumePrestartFixture) -> Result<PiAgentHostResponse, HostError> {
    let req: PiAgentExecuteRequest = serde_json::from_value(serde_json::json!({
        "requestId": "new-request",
        "text": "Resume",
        "companyId": "company-1",
        "threadId": "thread-1",
        "projectId": "project-1",
        "rootRunId": "turn-1",
        "workspaceRequirement": "required",
        "workspaceBindingHistoryId": "history-1",
        "permissionMode": "auto"
    }))
    .expect("decode resume request");
    let channel: Channel<PiAgentHostEvent> = Channel::new(|_body| Ok(()));
    do_execute(
        fixture.app.handle(),
        req,
        &channel,
        CancellationToken::new(),
        true,
    )
    .await
}

async fn insert_execute_root(fixture: &ResumePrestartFixture, run_id: &str, started_at: &str) {
    sqlx::query(
        r#"
        INSERT INTO agent_runs (
          run_id, thread_id, company_id, project_id, root_run_id, status,
          runtime_context_json, started_at
        ) VALUES (?, 'thread-1', 'company-1', 'project-1', ?, 'running', ?, ?)
        "#,
    )
    .bind(run_id)
    .bind(run_id)
    .bind(
        serde_json::json!({
            "requestId": format!("request-{run_id}"),
            "runtime": "pi-agent",
            "wireProtocolVersion": 9
        })
        .to_string(),
    )
    .bind(started_at)
    .execute(&fixture.pool)
    .await
    .expect("seed current normal execute root");
}

async fn insert_current_execute_root(fixture: &ResumePrestartFixture) {
    insert_execute_root(fixture, "turn-2", "2026-07-14T04:00:00Z").await;
}

async fn terminalize_interrupted_root(fixture: &ResumePrestartFixture, status: &str, at: &str) {
    sqlx::query("UPDATE agent_runs SET status = ?, finished_at = ? WHERE run_id = 'turn-1'")
        .bind(status)
        .bind(at)
        .execute(&fixture.pool)
        .await
        .expect("terminalize prior Conversation root");
}

async fn run_execute_request(
    fixture: &ResumePrestartFixture,
    run_id: &str,
    request_id: &str,
    native_session_mode: Option<&str>,
    native_session_reset_source_run_id: Option<&str>,
) -> Result<PiAgentHostResponse, HostError> {
    let mut value = serde_json::json!({
        "requestId": request_id,
        "text": "Continue the Conversation",
        "companyId": "company-1",
        "threadId": "thread-1",
        "projectId": "project-1",
        "rootRunId": run_id,
        "workspaceRequirement": "required",
        "permissionMode": "auto"
    });
    if let Some(mode) = native_session_mode {
        value["nativeSessionMode"] = serde_json::Value::String(mode.into());
    }
    if let Some(source_run_id) = native_session_reset_source_run_id {
        value["nativeSessionResetSourceRunId"] = serde_json::Value::String(source_run_id.into());
    }
    let req: PiAgentExecuteRequest =
        serde_json::from_value(value).expect("decode normal execute request");
    let channel: Channel<PiAgentHostEvent> = Channel::new(|_body| Ok(()));
    do_execute(
        fixture.app.handle(),
        req,
        &channel,
        CancellationToken::new(),
        false,
    )
    .await
}

async fn run_normal_execute(
    fixture: &ResumePrestartFixture,
) -> Result<PiAgentHostResponse, HostError> {
    run_execute_request(fixture, "turn-2", "execute-request", None, None).await
}

fn captured_sidecar_payload(fixture: &ResumePrestartFixture) -> serde_json::Value {
    serde_json::from_str(
        &std::fs::read_to_string(&fixture.payload_file).expect("read captured sidecar payload"),
    )
    .expect("decode captured sidecar payload")
}

async fn resume_compatibility_reason(fixture: &ResumePrestartFixture) -> String {
    let compatibility = crate::task_workspace_binding::task_workspace_resume_compatibility(
        fixture.app.handle().clone(),
        "history-1".into(),
        "company-1".into(),
        "project-1".into(),
        "thread-1".into(),
        "turn-1".into(),
        "write".into(),
    )
    .await
    .expect("read resume compatibility");
    serde_json::to_value(compatibility)
        .expect("encode resume compatibility")
        .get("reason")
        .and_then(serde_json::Value::as_str)
        .expect("resume compatibility reason")
        .to_string()
}

async fn assert_resume_failed_before_sidecar(
    fixture: &ResumePrestartFixture,
    expected_code: &str,
    expected_compatibility_reason: &str,
) {
    assert_eq!(
        resume_compatibility_reason(fixture).await,
        expected_compatibility_reason,
        "read-only preflight must classify the same durable Resume fault"
    );
    let result = run_resume(fixture).await;
    let (actual_code, actual_message) = match result {
        Err(HostError::ResumePrestart { code, message }) => (code, message),
        Err(other) => panic!("resume prestart fault returned an unstable error: {other:?}"),
        Ok(_) => panic!("resume prestart fault must fail closed"),
    };
    assert_eq!(actual_code, expected_code, "{actual_message}");
    assert_eq!(
        sidecar_invocation_count(fixture),
        0,
        "durable resume failure must prevent sidecar spawn"
    );
    let new_history_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM task_workspace_binding_history WHERE resumed_from_binding_id = 'history-1'",
    )
    .fetch_one(&fixture.pool)
    .await
    .expect("count replacement resume history");
    assert_eq!(
        new_history_count, 0,
        "failed prestart transaction must roll back replacement history"
    );
    let root_status: String =
        sqlx::query_scalar("SELECT status FROM agent_runs WHERE run_id = 'turn-1'")
            .fetch_one(&fixture.pool)
            .await
            .expect("read root status after blocked resume");
    assert_eq!(
        root_status, "interrupted",
        "failed prestart transaction must leave the root recoverable"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn resume_persistence_failure_never_spawns_real_sidecar() {
    let fixture = resume_prestart_fixture(interrupted_runtime_context()).await;
    sqlx::query(
        r#"
        CREATE TRIGGER fail_resume_root_persistence
        BEFORE UPDATE OF status ON agent_runs
        WHEN OLD.status = 'interrupted' AND NEW.status = 'running'
        BEGIN
          SELECT RAISE(ABORT, 'injected resume root persistence failure');
        END
        "#,
    )
    .execute(&fixture.pool)
    .await
    .expect("install resume persistence fault");
    assert_resume_failed_before_sidecar(
        &fixture,
        "resume-prestart-persistence",
        "workspace_history_durable_match",
    )
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn resume_status_conflict_never_spawns_real_sidecar() {
    let fixture = resume_prestart_fixture(interrupted_runtime_context()).await;
    sqlx::query(
        r#"
        CREATE TRIGGER conflict_resume_root_status
        AFTER INSERT ON task_workspace_binding_history
        WHEN NEW.resumed_from_binding_id IS NOT NULL
        BEGIN
          UPDATE agent_runs SET status = 'completed' WHERE run_id = NEW.turn_id;
        END
        "#,
    )
    .execute(&fixture.pool)
    .await
    .expect("install resume status conflict");
    assert_resume_failed_before_sidecar(
        &fixture,
        "resume-prestart-conflict",
        "workspace_history_durable_match",
    )
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn resume_invalid_root_context_never_spawns_real_sidecar() {
    let fixture = resume_prestart_fixture(serde_json::Value::String("{".into())).await;
    sqlx::query("UPDATE agent_runs SET runtime_context_json = '{' WHERE run_id = 'turn-1'")
        .execute(&fixture.pool)
        .await
        .expect("corrupt interrupted root context");
    assert_resume_failed_before_sidecar(
        &fixture,
        "resume-prestart-context-invalid",
        "resume_context_invalid",
    )
    .await;
}

async fn replace_durable_session_file(fixture: &ResumePrestartFixture, path: Option<&Path>) {
    sqlx::query("UPDATE agent_runs SET session_file = ? WHERE run_id = 'turn-1'")
        .bind(path.map(|value| value.to_string_lossy().to_string()))
        .execute(&fixture.pool)
        .await
        .expect("replace durable native session path");
}

fn write_native_session(path: &Path, session_id: &str, cwd: &Path) {
    std::fs::write(
        path,
        format!(
            "{{\"type\":\"session\",\"version\":3,\"id\":{},\"timestamp\":\"2026-07-14T00:00:00.000Z\",\"cwd\":{}}}\n",
            serde_json::to_string(session_id).expect("encode native session id"),
            serde_json::to_string(&cwd.to_string_lossy()).expect("encode native session cwd")
        ),
    )
    .expect("write native session fixture");
}

#[tokio::test(flavor = "current_thread")]
async fn resume_exact_native_session_faults_never_spawn_real_sidecar() {
    for fault in [
        "missing",
        "relative",
        "outside",
        "directory",
        "bad-header",
        "replaced-id",
    ] {
        let fixture = resume_prestart_fixture(interrupted_runtime_context()).await;
        match fault {
            "missing" => std::fs::remove_file(&fixture.session_file)
                .expect("remove interrupted native session"),
            "relative" => {
                replace_durable_session_file(&fixture, Some(Path::new("sessions/session-a.jsonl")))
                    .await;
            }
            "outside" => {
                let outside = fixture.root.join("outside-session.jsonl");
                write_native_session(&outside, "session-a", &fixture.root);
                replace_durable_session_file(&fixture, Some(&outside)).await;
            }
            "directory" => {
                let session_dir = fixture.session_dir.clone();
                replace_durable_session_file(&fixture, Some(&session_dir)).await;
            }
            "bad-header" => {
                std::fs::write(&fixture.session_file, "{not-json}\n")
                    .expect("corrupt interrupted native session header");
            }
            "replaced-id" => {
                write_native_session(&fixture.session_file, "session-replaced", &fixture.root);
            }
            other => panic!("unknown exact-session fault: {other}"),
        }
        let (expected_code, expected_reason) = if fault == "missing" {
            ("resume-prestart-session-missing", "session_missing")
        } else {
            ("resume-prestart-session-invalid", "session_invalid")
        };
        assert_resume_failed_before_sidecar(&fixture, expected_code, expected_reason).await;
    }
}

#[cfg(unix)]
#[tokio::test(flavor = "current_thread")]
async fn resume_symlinked_native_session_never_spawns_real_sidecar() {
    use std::os::unix::fs::symlink;

    let fixture = resume_prestart_fixture(interrupted_runtime_context()).await;
    let target = fixture.root.join("symlink-target.jsonl");
    write_native_session(&target, "session-a", &fixture.root);
    let symlink_path = fixture.session_dir.join("session-link.jsonl");
    symlink(&target, &symlink_path).expect("create native session symlink");
    replace_durable_session_file(&fixture, Some(&symlink_path)).await;
    assert_resume_failed_before_sidecar(
        &fixture,
        "resume-prestart-session-invalid",
        "session_invalid",
    )
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn resume_runtime_lane_and_wire_faults_never_spawn_real_sidecar() {
    let mut cases = Vec::new();
    for (field, replacement) in [
        ("runtime", None),
        ("runtime", Some(serde_json::json!("codex-subscription"))),
        ("wireProtocolVersion", None),
        (
            "wireProtocolVersion",
            Some(serde_json::json!(PI_HOST_PROTOCOL_VERSION - 1)),
        ),
    ] {
        let mut context = interrupted_runtime_context();
        let object = context
            .as_object_mut()
            .expect("fixture runtime context object");
        if let Some(value) = replacement {
            object.insert(field.into(), value);
        } else {
            object.remove(field);
        }
        cases.push(context);
    }
    for context in cases {
        let fixture = resume_prestart_fixture(context).await;
        assert_resume_failed_before_sidecar(
            &fixture,
            "resume-prestart-runtime-incompatible",
            "runtime_incompatible",
        )
        .await;
    }
}

#[tokio::test(flavor = "current_thread")]
async fn resume_running_root_unique_conflict_rolls_back_before_real_sidecar() {
    let fixture = resume_prestart_fixture(interrupted_runtime_context()).await;
    sqlx::query(
        "UPDATE agent_runs SET status = 'running' WHERE run_id = 'turn-1' AND status = 'interrupted'",
    )
    .execute(&fixture.pool)
    .await
    .expect("same unresolved root may transition from interrupted to running");
    sqlx::query("UPDATE agent_runs SET status = 'interrupted' WHERE run_id = 'turn-1'")
        .execute(&fixture.pool)
        .await
        .expect("restore interrupted root before injected Resume race");
    sqlx::query(
        r#"
        CREATE TRIGGER inject_competing_root_during_resume
        AFTER UPDATE OF status ON agent_runs
        WHEN OLD.run_id = 'turn-1'
          AND OLD.status = 'interrupted'
          AND NEW.status = 'running'
        BEGIN
          INSERT INTO agent_runs (
            run_id, thread_id, company_id, project_id, root_run_id, status,
            started_at
          ) VALUES (
            'competing-root', 'thread-1', 'company-1', 'project-1',
            'competing-root', 'running', '2026-07-14T00:01:00Z'
          );
        END
        "#,
    )
    .execute(&fixture.pool)
    .await
    .expect("install competing-root Resume race");
    assert_resume_failed_before_sidecar(
        &fixture,
        "resume-prestart-conflict",
        "workspace_history_durable_match",
    )
    .await;
}

#[tokio::test(flavor = "current_thread")]
async fn resume_durable_prestart_commit_precedes_one_real_sidecar_spawn() {
    let fixture = resume_prestart_fixture(interrupted_runtime_context()).await;
    let newer_session = fixture.session_dir.join("session-b.jsonl");
    std::fs::write(
        &newer_session,
        format!(
            "{{\"type\":\"session\",\"version\":3,\"id\":\"session-b\",\"timestamp\":\"2026-07-14T01:00:00.000Z\",\"cwd\":{}}}\n",
            serde_json::to_string(&fixture.root.to_string_lossy()).expect("encode newer session cwd")
        ),
    )
    .expect("write newer native session B");
    let response = run_resume(&fixture).await.expect("resume succeeds");
    assert_eq!(response.text, "done");
    assert_eq!(
        sidecar_invocation_count(&fixture),
        1,
        "successful durable resume launches exactly one sidecar"
    );
    let row: (String, String) = sqlx::query_as(
        "SELECT status, runtime_context_json FROM agent_runs WHERE run_id = 'turn-1'",
    )
    .fetch_one(&fixture.pool)
    .await
    .expect("read durable resumed root");
    assert_eq!(row.0, "running");
    let context: serde_json::Value =
        serde_json::from_str(&row.1).expect("decode durable resumed root context");
    assert_eq!(context["requestId"], "new-request");
    assert_eq!(context["streamCursor"], 0);
    assert_eq!(context["workspaceBinding"]["requestId"], "new-request");
    assert_eq!(context["workspaceBinding"]["companyId"], "company-1");
    assert_eq!(context["workspaceBinding"]["projectId"], "project-1");
    assert_eq!(context["workspaceBinding"]["threadId"], "thread-1");
    assert_eq!(context["workspaceBinding"]["turnId"], "turn-1");
    assert_eq!(context["workspaceBinding"]["access"], "write");
    assert_eq!(context["workspaceRequirement"], "required");
    assert_eq!(context["workspaceAvailability"], "bound");
    assert!(context.get("workspaceSource").is_none());
    assert!(context.get("workspaceReasonCode").is_none());
    let replacement_history_id = context["workspaceBinding"]["historyId"]
        .as_str()
        .expect("resumed context history id");
    assert_ne!(replacement_history_id, "history-1");
    let durable_status: String = sqlx::query_scalar(
        "SELECT status FROM task_workspace_binding_history WHERE binding_id = ? AND resumed_from_binding_id = 'history-1'",
    )
    .bind(replacement_history_id)
    .fetch_one(&fixture.pool)
    .await
    .expect("read replacement history status");
    assert_eq!(durable_status, "completed");
    let sidecar_payload = captured_sidecar_payload(&fixture);
    assert_eq!(
        sidecar_payload["exactSessionFile"],
        fixture.session_file.to_string_lossy().as_ref(),
        "Resume must pass exact interrupted session A, never newer session B"
    );
    assert_eq!(sidecar_payload["exactSessionId"], "session-a");
}

#[tokio::test(flavor = "current_thread")]
async fn normal_execute_uses_latest_terminalized_exact_session_not_newer_filename() {
    let fixture = resume_prestart_fixture(interrupted_runtime_context()).await;
    write_native_session(
        &fixture.session_file,
        "session-a",
        Path::new("/old/project-before-rename"),
    );
    terminalize_interrupted_root(&fixture, "completed", "2026-07-14T03:00:00Z").await;

    let session_b = fixture.session_dir.join("session-b.jsonl");
    write_native_session(&session_b, "session-b", &fixture.root);
    sqlx::query(
        r#"
        INSERT INTO agent_runs (
          run_id, thread_id, company_id, project_id, root_run_id, status,
          runtime_context_json, session_file, started_at, finished_at
        ) VALUES (
          'turn-b', 'thread-1', 'company-1', 'project-1', 'turn-b', 'completed',
          '{"runtime":"pi-agent","wireProtocolVersion":9,"nativeSessionId":"session-b"}',
          ?, '2026-07-14T02:00:00Z', '2026-07-14T02:30:00Z'
        )
        "#,
    )
    .bind(session_b.to_string_lossy().to_string())
    .execute(&fixture.pool)
    .await
    .expect("seed older terminalized session B");
    insert_current_execute_root(&fixture).await;

    let response = run_normal_execute(&fixture)
        .await
        .expect("normal exact continuation succeeds");
    assert_eq!(response.text, "done");
    assert_eq!(sidecar_invocation_count(&fixture), 1);
    let payload = captured_sidecar_payload(&fixture);
    assert_eq!(
        payload["exactSessionFile"],
        fixture.session_file.to_string_lossy().as_ref(),
        "terminal time must select resumed/finished A even when session B exists"
    );
    assert_eq!(payload["exactSessionId"], "session-a");
}

#[tokio::test(flavor = "current_thread")]
async fn normal_execute_with_no_durable_session_explicitly_starts_new() {
    let fixture = resume_prestart_fixture(interrupted_runtime_context()).await;
    terminalize_interrupted_root(&fixture, "failed", "2026-07-14T03:00:00Z").await;
    replace_durable_session_file(&fixture, None).await;
    let mut context = interrupted_runtime_context();
    context
        .as_object_mut()
        .expect("first-session context object")
        .remove("nativeSessionId");
    sqlx::query("UPDATE agent_runs SET runtime_context_json = ? WHERE run_id = 'turn-1'")
        .bind(context.to_string())
        .execute(&fixture.pool)
        .await
        .expect("remove nonexistent native identity from first-session fixture");
    insert_current_execute_root(&fixture).await;

    run_normal_execute(&fixture)
        .await
        .expect("first tracked native session starts");
    assert_eq!(sidecar_invocation_count(&fixture), 1);
    let payload = captured_sidecar_payload(&fixture);
    assert!(payload["exactSessionFile"].is_null());
    assert!(payload["exactSessionId"].is_null());
}

#[tokio::test(flavor = "current_thread")]
async fn normal_execute_never_adopts_another_thread_session() {
    let fixture = resume_prestart_fixture(interrupted_runtime_context()).await;
    terminalize_interrupted_root(&fixture, "completed", "2026-07-14T03:00:00Z").await;
    sqlx::query("UPDATE agent_runs SET thread_id = 'thread-other' WHERE run_id = 'turn-1'")
        .execute(&fixture.pool)
        .await
        .expect("move prior native session to another Conversation");
    insert_current_execute_root(&fixture).await;

    run_normal_execute(&fixture)
        .await
        .expect("Conversation without a tracked session starts new");
    assert_eq!(sidecar_invocation_count(&fixture), 1);
    let payload = captured_sidecar_payload(&fixture);
    assert!(payload["exactSessionFile"].is_null());
    assert!(payload["exactSessionId"].is_null());
}

#[tokio::test(flavor = "current_thread")]
async fn normal_execute_tampered_durable_session_fails_before_real_sidecar() {
    let fixture = resume_prestart_fixture(interrupted_runtime_context()).await;
    terminalize_interrupted_root(&fixture, "completed", "2026-07-14T03:00:00Z").await;
    std::fs::remove_file(&fixture.session_file).expect("remove tracked Conversation session");
    insert_current_execute_root(&fixture).await;

    let error = run_normal_execute(&fixture)
        .await
        .expect_err("tampered durable session must fail closed");
    assert!(matches!(
        error,
        HostError::NativeSessionPrestart {
            code: "native-session-missing",
            ..
        }
    ));
    assert_eq!(sidecar_invocation_count(&fixture), 0);
    let history_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM task_workspace_binding_history WHERE turn_id = 'turn-2'",
    )
    .fetch_one(&fixture.pool)
    .await
    .expect("count normal-turn history after session rejection");
    assert_eq!(history_count, 0);
}

#[tokio::test(flavor = "current_thread")]
async fn explicit_fresh_session_recovers_a_broken_mapping_but_ordinary_retry_does_not() {
    let fixture = resume_prestart_fixture(interrupted_runtime_context()).await;
    terminalize_interrupted_root(&fixture, "completed", "2026-07-14T03:00:00Z").await;
    replace_durable_session_file(&fixture, None).await;
    insert_execute_root(&fixture, "turn-2", "2026-07-14T04:00:00Z").await;

    let first_error = run_execute_request(&fixture, "turn-2", "request-turn-2", None, None)
        .await
        .expect_err("id without its exact file must fail visibly");
    assert!(matches!(
        first_error,
        HostError::NativeSessionPrestart {
            code: "native-session-missing",
            ..
        }
    ));
    assert_eq!(sidecar_invocation_count(&fixture), 0);
    sqlx::query(
        "UPDATE agent_runs SET status = 'failed', finished_at = '2026-07-14T04:01:00Z' WHERE run_id = 'turn-2'",
    )
    .execute(&fixture.pool)
    .await
    .expect("terminalize first native-session prestart failure");

    insert_execute_root(&fixture, "turn-3", "2026-07-14T04:02:00Z").await;
    let retry_error = run_execute_request(&fixture, "turn-3", "request-turn-3", None, None)
        .await
        .expect_err("ordinary retry must not silently bypass a broken mapping");
    assert!(matches!(
        retry_error,
        HostError::NativeSessionPrestart {
            code: "native-session-missing",
            ..
        }
    ));
    assert_eq!(sidecar_invocation_count(&fixture), 0);
    sqlx::query(
        r#"
        UPDATE agent_runs
        SET runtime_context_json = json_set(
          runtime_context_json,
          '$.nativeSessionPrestartErrorCode',
          'native-session-missing'
        )
        WHERE run_id = 'turn-3'
        "#,
    )
    .execute(&fixture.pool)
    .await
    .expect("record resettable native-session error on ordinary retry");
    sqlx::query(
        "UPDATE agent_runs SET status = 'failed', finished_at = '2026-07-14T04:03:00Z' WHERE run_id = 'turn-3'",
    )
    .execute(&fixture.pool)
    .await
    .expect("terminalize ordinary retry failure");

    insert_execute_root(&fixture, "turn-4", "2026-07-14T04:04:00Z").await;
    let response = run_execute_request(
        &fixture,
        "turn-4",
        "request-turn-4",
        Some("fresh"),
        Some("turn-3"),
    )
    .await
    .expect("explicit fresh-session retry starts a new native session");
    assert_eq!(response.text, "done");
    assert_eq!(sidecar_invocation_count(&fixture), 1);
    let payload = captured_sidecar_payload(&fixture);
    assert_eq!(payload["nativeSessionMode"], "fresh");
    assert!(payload["exactSessionFile"].is_null());
    assert!(payload["exactSessionId"].is_null());
}

async fn seed_failed_native_session_source(
    fixture: &ResumePrestartFixture,
    run_id: &str,
    started_at: &str,
    finished_at: &str,
) {
    insert_execute_root(fixture, run_id, started_at).await;
    sqlx::query(
        r#"
        UPDATE agent_runs
        SET status = 'failed', finished_at = ?,
            runtime_context_json = json_set(
              runtime_context_json,
              '$.nativeSessionPrestartErrorCode',
              'native-session-missing'
            )
        WHERE run_id = ?
        "#,
    )
    .bind(finished_at)
    .bind(run_id)
    .execute(&fixture.pool)
    .await
    .expect("seed failed native-session prestart source");
}

#[tokio::test(flavor = "current_thread")]
async fn fresh_session_reset_persistence_failure_never_spawns_real_sidecar() {
    let fixture = resume_prestart_fixture(interrupted_runtime_context()).await;
    terminalize_interrupted_root(&fixture, "completed", "2026-07-14T03:00:00Z").await;
    replace_durable_session_file(&fixture, None).await;
    seed_failed_native_session_source(
        &fixture,
        "turn-source",
        "2026-07-14T04:00:00Z",
        "2026-07-14T04:01:00Z",
    )
    .await;
    insert_execute_root(&fixture, "turn-fresh", "2026-07-14T04:02:00Z").await;
    sqlx::query(
        r#"
        CREATE TRIGGER fail_native_session_reset
        BEFORE UPDATE OF runtime_context_json ON agent_runs
        WHEN OLD.run_id = 'turn-source'
          AND json_extract(NEW.runtime_context_json, '$.nativeSessionReset') = 1
        BEGIN
          SELECT RAISE(ABORT, 'injected native session reset persistence failure');
        END
        "#,
    )
    .execute(&fixture.pool)
    .await
    .expect("install native session reset persistence fault");

    let error = run_execute_request(
        &fixture,
        "turn-fresh",
        "request-fresh",
        Some("fresh"),
        Some("turn-source"),
    )
    .await
    .expect_err("fresh-session marker persistence must fail closed");
    assert!(matches!(
        error,
        HostError::NativeSessionPrestart {
            code: "native-session-reset-persistence",
            ..
        }
    ));
    assert_eq!(sidecar_invocation_count(&fixture), 0);
    let reset: i64 = sqlx::query_scalar(
        "SELECT COALESCE(json_extract(runtime_context_json, '$.nativeSessionReset'), 0) FROM agent_runs WHERE run_id = 'turn-source'",
    )
    .fetch_one(&fixture.pool)
    .await
    .expect("read rolled-back native session reset marker");
    assert_eq!(reset, 0);
}

#[tokio::test(flavor = "current_thread")]
async fn fresh_session_rejects_a_stale_source_after_a_later_terminal_turn() {
    let fixture = resume_prestart_fixture(interrupted_runtime_context()).await;
    terminalize_interrupted_root(&fixture, "completed", "2026-07-14T03:00:00Z").await;
    replace_durable_session_file(&fixture, None).await;
    seed_failed_native_session_source(
        &fixture,
        "turn-source",
        "2026-07-14T04:00:00Z",
        "2026-07-14T04:01:00Z",
    )
    .await;
    insert_execute_root(&fixture, "turn-later", "2026-07-14T04:02:00Z").await;
    sqlx::query(
        "UPDATE agent_runs SET status = 'completed', finished_at = '2026-07-14T04:03:00Z' WHERE run_id = 'turn-later'",
    )
    .execute(&fixture.pool)
    .await
    .expect("terminalize the newer Conversation Turn");
    insert_execute_root(&fixture, "turn-fresh", "2026-07-14T04:04:00Z").await;

    let error = run_execute_request(
        &fixture,
        "turn-fresh",
        "request-fresh",
        Some("fresh"),
        Some("turn-source"),
    )
    .await
    .expect_err("a later root must invalidate the old Fresh action");
    assert!(matches!(
        error,
        HostError::NativeSessionPrestart {
            code: "native-session-reset-invalid",
            ..
        }
    ));
    assert_eq!(sidecar_invocation_count(&fixture), 0);
    let reset: i64 = sqlx::query_scalar(
        "SELECT COALESCE(json_extract(runtime_context_json, '$.nativeSessionReset'), 0) FROM agent_runs WHERE run_id = 'turn-source'",
    )
    .fetch_one(&fixture.pool)
    .await
    .expect("read stale source reset marker");
    assert_eq!(reset, 0);
}

#[tokio::test(flavor = "current_thread")]
async fn durable_fresh_marker_survives_new_host_failure_and_blocks_bad_ref_fallback() {
    let fixture = resume_prestart_fixture(interrupted_runtime_context()).await;
    terminalize_interrupted_root(&fixture, "completed", "2026-07-14T03:00:00Z").await;
    replace_durable_session_file(&fixture, None).await;
    seed_failed_native_session_source(
        &fixture,
        "turn-source",
        "2026-07-14T04:00:00Z",
        "2026-07-14T04:01:00Z",
    )
    .await;
    insert_execute_root(&fixture, "turn-fresh", "2026-07-14T04:02:00Z").await;
    std::fs::write(&fixture.sidecar_failure_file, "enabled")
        .expect("enable post-reset sidecar failure");

    run_execute_request(
        &fixture,
        "turn-fresh",
        "request-fresh",
        Some("fresh"),
        Some("turn-source"),
    )
    .await
    .expect_err("injected post-reset sidecar failure surfaces");
    assert_eq!(sidecar_invocation_count(&fixture), 1);
    let reset: i64 = sqlx::query_scalar(
        "SELECT json_extract(runtime_context_json, '$.nativeSessionReset') FROM agent_runs WHERE run_id = 'turn-source'",
    )
    .fetch_one(&fixture.pool)
    .await
    .expect("read committed native session reset marker");
    assert_eq!(reset, 1);

    sqlx::query(
        "UPDATE agent_runs SET status = 'failed', finished_at = '2026-07-14T04:03:00Z' WHERE run_id = 'turn-fresh'",
    )
    .execute(&fixture.pool)
    .await
    .expect("terminalize post-reset host failure");
    std::fs::remove_file(&fixture.sidecar_failure_file)
        .expect("disable post-reset sidecar failure");
    insert_execute_root(&fixture, "turn-after-reset", "2026-07-14T04:04:00Z").await;

    run_execute_request(
        &fixture,
        "turn-after-reset",
        "request-after-reset",
        None,
        None,
    )
    .await
    .expect("ordinary Turn after a durable reset starts a new native session");
    assert_eq!(sidecar_invocation_count(&fixture), 2);
    let payload = captured_sidecar_payload(&fixture);
    assert_eq!(payload["nativeSessionMode"], "tracked");
    assert!(payload["exactSessionFile"].is_null());
    assert!(payload["exactSessionId"].is_null());
}

#[tokio::test(flavor = "current_thread")]
async fn normal_execute_unique_index_rejects_new_root_while_interrupted() {
    let fixture = resume_prestart_fixture(interrupted_runtime_context()).await;
    let conflict = sqlx::query(
        r#"
        INSERT INTO agent_runs (
          run_id, thread_id, company_id, project_id, root_run_id, status,
          runtime_context_json, started_at
        ) VALUES (
          'turn-2', 'thread-1', 'company-1', 'project-1', 'turn-2', 'running',
          '{"requestId":"execute-request","runtime":"pi-agent","wireProtocolVersion":9}',
          '2026-07-14T04:00:00Z'
        )
        "#,
    )
    .execute(&fixture.pool)
    .await
    .expect_err("database authority must reject a second unresolved root");
    assert!(
        matches!(&conflict, sqlx::Error::Database(error) if error.is_unique_violation()),
        "unexpected unresolved-root database failure: {conflict:?}"
    );
    assert_eq!(sidecar_invocation_count(&fixture), 0);
}

#[tokio::test(flavor = "current_thread")]
async fn normal_execute_host_defense_blocks_legacy_interrupted_overlap_without_index() {
    let fixture = resume_prestart_fixture(interrupted_runtime_context()).await;
    sqlx::query("DROP INDEX idx_agent_runs_one_unresolved_root_per_thread")
        .execute(&fixture.pool)
        .await
        .expect("remove final-authority index only inside the legacy-overlap oracle");
    insert_current_execute_root(&fixture).await;

    let error = run_normal_execute(&fixture)
        .await
        .expect_err("unresolved interrupted root must block a new Turn");
    assert!(matches!(
        error,
        HostError::NativeSessionPrestart {
            code: "native-session-interrupted-root",
            ..
        }
    ));
    assert_eq!(sidecar_invocation_count(&fixture), 0);

    sqlx::query("DELETE FROM agent_runs WHERE run_id = 'turn-2'")
        .execute(&fixture.pool)
        .await
        .expect("remove backend-defense current root fixture");
    terminalize_interrupted_root(&fixture, "cancelled", "2026-07-14T03:00:00Z").await;
    insert_current_execute_root(&fixture).await;
    run_normal_execute(&fixture)
        .await
        .expect("discarded interrupted root releases the Conversation");
    assert_eq!(sidecar_invocation_count(&fixture), 1);
    assert_eq!(
        captured_sidecar_payload(&fixture)["exactSessionId"],
        "session-a"
    );
}

#[test]
fn pi_session_dir_has_one_storage_segment() {
    let base = Path::new("/home/test/.offisim/pi-agent-sessions");
    let actual = pi_session_dir_under(base, "thread/with:unsafe");
    let expected = base.join("thread_with_unsafe");

    assert_eq!(actual, expected);
}

#[test]
fn execute_and_resume_enforce_distinct_workspace_history_contracts() {
    assert!(validate_workspace_binding_history_mode(false, None)
        .expect("normal execute without history")
        .is_none());
    assert!(validate_workspace_binding_history_mode(false, Some("history-1")).is_err());
    assert_eq!(
        validate_workspace_binding_history_mode(true, Some("history-1"))
            .expect("resume with history"),
        Some("history-1")
    );
    assert!(validate_workspace_binding_history_mode(true, None).is_err());
    assert!(validate_workspace_binding_history_mode(true, Some("  ")).is_err());
}

#[test]
fn optional_workspace_is_allowed_only_for_plain_execute_turns() {
    let plain: PiAgentExecuteRequest = serde_json::from_value(serde_json::json!({
        "requestId": "request-plain",
        "text": "Continue our discussion",
        "companyId": "company-1",
        "threadId": "thread-1",
        "projectId": "project-1",
        "rootRunId": "turn-1",
        "workspaceRequirement": "optional"
    }))
    .expect("decode optional plain request");
    validate_execute_workspace_requirement(&plain, false)
        .expect("plain execute may continue without a workspace");
    assert!(validate_execute_workspace_requirement(&plain, true).is_err());

    for extra in [
        serde_json::json!({"missionContextJson": "{}"}),
        serde_json::json!({"directDelegation": {"employeeId": "employee-2"}}),
    ] {
        let mut value = serde_json::to_value(serde_json::json!({
            "requestId": "request-scoped",
            "text": "Run scoped work",
            "companyId": "company-1",
            "threadId": "thread-1",
            "projectId": "project-1",
            "rootRunId": "turn-1",
            "workspaceRequirement": "optional"
        }))
        .expect("encode request fixture");
        value
            .as_object_mut()
            .expect("request fixture object")
            .extend(extra.as_object().expect("extra object").clone());
        let scoped: PiAgentExecuteRequest =
            serde_json::from_value(value).expect("decode scoped optional request");
        assert!(validate_execute_workspace_requirement(&scoped, false).is_err());
    }
}

#[test]
fn sidecar_terminal_success_requires_final_authority_and_prefers_user_abort() {
    assert_eq!(
        gate_sidecar_terminal("response", false, Ok::<(), &str>(())),
        TerminalAuthorityGate::Accept("response")
    );
    assert_eq!(
        gate_sidecar_terminal("response", false, Err::<(), &str>("expired")),
        TerminalAuthorityGate::AuthorityLost("expired")
    );
    assert_eq!(
        gate_sidecar_terminal("response", true, Err::<(), &str>("expired")),
        TerminalAuthorityGate::UserAborted
    );
}

struct TestSidecar {
    root: PathBuf,
    script: PathBuf,
    pid_file: PathBuf,
}

impl Drop for TestSidecar {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn test_sidecar(label: &str, body: &str) -> TestSidecar {
    let root = temp_project_root(label);
    let script = root.join("hostile-sidecar.mjs");
    let pid_file = root.join("pid");
    let pid_path = serde_json::to_string(&pid_file.to_string_lossy()).expect("encode pid path");
    std::fs::write(
        &script,
        format!(
            "import fs from 'node:fs';\nfs.writeFileSync({pid_path}, String(process.pid));\n{body}\n"
        ),
    )
    .expect("write test sidecar");
    TestSidecar {
        root,
        script,
        pid_file,
    }
}

fn sidecar_pid(sidecar: &TestSidecar) -> u32 {
    std::fs::read_to_string(&sidecar.pid_file)
        .expect("sidecar wrote pid")
        .parse()
        .expect("sidecar pid is numeric")
}

#[cfg(unix)]
fn process_is_alive(pid: u32) -> bool {
    let result = unsafe { libc::kill(pid as i32, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

async fn run_test_sidecar(
    sidecar: &TestSidecar,
    token: CancellationToken,
) -> Result<serde_json::Value, HostError> {
    run_pi_sidecar_jsonl_inner::<tauri::Wry>(
        None,
        PiSidecarRun {
            script_path: &sidecar.script,
            cwd: &sidecar.root,
            workspace_binding: None,
            env: HashMap::new(),
            payload: serde_json::json!({ "mode": "test" }),
            token,
            on_event: None,
            register_stdin: None,
            stream_request_id: None,
        },
    )
    .await
}

#[tokio::test]
async fn pi_sidecar_success_waits_for_clean_exit() {
    let sidecar = test_sidecar(
        "success-cleanup",
        r#"
console.log(JSON.stringify({ kind: 'ready', protocolVersion: 9 }));
console.log(JSON.stringify({ kind: 'result', response: { text: 'done' } }));
"#,
    );

    let response = run_test_sidecar(&sidecar, CancellationToken::new())
        .await
        .expect("successful sidecar");
    assert_eq!(response["text"], "done");
    #[cfg(unix)]
    assert!(!process_is_alive(sidecar_pid(&sidecar)));
}

#[cfg(unix)]
#[tokio::test]
async fn pi_sidecar_success_reaps_same_group_background_descendant() {
    let sidecar = test_sidecar(
        "success-descendant-cleanup",
        r#"
const { spawn } = await import('node:child_process');
const descendant = spawn(process.execPath, ['-e', "setTimeout(() => require('node:fs').writeFileSync('descendant-marker', 'leaked'), 800)"], { stdio: 'ignore' });
descendant.unref();
console.log(JSON.stringify({ kind: 'ready', protocolVersion: 9 }));
console.log(JSON.stringify({ kind: 'result', response: { text: 'done' } }));
"#,
    );

    let response = run_test_sidecar(&sidecar, CancellationToken::new())
        .await
        .expect("successful sidecar");
    assert_eq!(response["text"], "done");
    tokio::time::sleep(Duration::from_millis(1_100)).await;
    assert!(
        !sidecar.root.join("descendant-marker").exists(),
        "same-group sidecar descendant survived leader exit"
    );
}

#[tokio::test]
async fn pi_sidecar_protocol_failure_kills_and_reaps_hostile_child() {
    let sidecar = test_sidecar(
        "protocol-cleanup",
        r#"
console.log(JSON.stringify({ kind: 'ready', protocolVersion: 9 }));
console.log(JSON.stringify({ kind: 'tool', status: 'started', toolCallId: 'call-1' }));
setInterval(() => {}, 1_000);
"#,
    );

    let error = run_test_sidecar(&sidecar, CancellationToken::new())
        .await
        .expect_err("malformed known event must fail");
    assert!(matches!(error, HostError::Protocol(message) if message.contains("tool")));
    #[cfg(unix)]
    assert!(!process_is_alive(sidecar_pid(&sidecar)));
}

#[test]
fn mcp_bridge_profiles_allow_only_bound_work_and_collaboration_read() {
    let binding =
        test_task_workspace_binding(Path::new("/fixture/project"), "project-1", None, 3, None);
    let cases = [
        (
            Some(&binding),
            serde_json::json!({
                "mode": "execute",
                "workspaceAvailability": "bound"
            }),
            McpBridgeProfile::BoundWork,
            true,
        ),
        (
            None,
            serde_json::json!({
                "mode": "collaborate",
                "collaborationProfile": "collaboration_read"
            }),
            McpBridgeProfile::CollaborationRead,
            true,
        ),
        (
            None,
            serde_json::json!({
                "mode": "execute",
                "workspaceAvailability": "unavailable"
            }),
            McpBridgeProfile::WorkspaceUnavailable,
            false,
        ),
        (
            None,
            serde_json::json!({ "mode": "enhance" }),
            McpBridgeProfile::Enhance,
            false,
        ),
        (
            None,
            serde_json::json!({ "mode": "test" }),
            McpBridgeProfile::Test,
            false,
        ),
        (
            None,
            serde_json::json!({
                "mode": "collaborate",
                "collaborationProfile": "strict"
            }),
            McpBridgeProfile::Restricted,
            false,
        ),
    ];

    for (workspace_binding, payload, expected, allowed) in cases {
        let actual = mcp_bridge_profile(workspace_binding, &payload);
        assert_eq!(actual, expected);
        assert_eq!(authorize_mcp_frame(actual).is_ok(), allowed);
    }

    assert_eq!(
        mcp_bridge_profile(
            None,
            &serde_json::json!({
                "mode": "execute",
                "workspaceAvailability": "bound"
            })
        ),
        McpBridgeProfile::Restricted,
        "a sidecar payload cannot grant itself bound-work MCP access"
    );
}

#[tokio::test]
async fn unavailable_sidecar_mcp_call_is_rejected_before_the_app_bridge() {
    let sidecar = test_sidecar(
        "unavailable-mcp-isolation",
        r#"
console.log(JSON.stringify({ kind: 'ready', protocolVersion: 9 }));
console.log(JSON.stringify({ kind: 'mcpCall', id: 'mcp-1', server: 'files', tool: 'read_file', arguments: {} }));
setInterval(() => {}, 1_000);
"#,
    );

    let error = run_pi_sidecar_jsonl_inner::<tauri::Wry>(
        None,
        PiSidecarRun {
            script_path: &sidecar.script,
            cwd: &sidecar.root,
            workspace_binding: None,
            env: HashMap::new(),
            payload: serde_json::json!({
                "mode": "execute",
                "workspaceAvailability": "unavailable"
            }),
            token: CancellationToken::new(),
            on_event: None,
            register_stdin: Some("unavailable-mcp-request"),
            stream_request_id: None,
        },
    )
    .await
    .expect_err("workspace-unavailable sidecar must not reach the MCP bridge");

    assert!(matches!(
        error,
        HostError::Protocol(message)
            if message.contains("workspace-isolation")
                && message.contains("workspace-unavailable")
    ));
    #[cfg(unix)]
    assert!(!process_is_alive(sidecar_pid(&sidecar)));
}

#[tokio::test]
async fn pi_sidecar_ready_mismatch_kills_and_reaps_hostile_child() {
    let sidecar = test_sidecar(
        "ready-cleanup",
        r#"
console.log(JSON.stringify({ kind: 'ready', protocolVersion: 999 }));
setInterval(() => {}, 1_000);
"#,
    );

    let error = run_test_sidecar(&sidecar, CancellationToken::new())
        .await
        .expect_err("ready mismatch must fail");
    assert!(
        matches!(error, HostError::Protocol(message) if message.contains("does not match runtime"))
    );
    #[cfg(unix)]
    assert!(!process_is_alive(sidecar_pid(&sidecar)));
}

#[tokio::test]
async fn pi_sidecar_abort_kills_and_reaps_hostile_child() {
    let sidecar = test_sidecar(
        "abort-cleanup",
        r#"
console.log(JSON.stringify({ kind: 'ready', protocolVersion: 9 }));
setInterval(() => {}, 1_000);
"#,
    );
    let token = CancellationToken::new();
    let cancel = token.clone();
    let pid_file = sidecar.pid_file.clone();
    let cancel_task = tokio::spawn(async move {
        for _ in 0..100 {
            if pid_file.exists() {
                cancel.cancel();
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        cancel.cancel();
    });

    let error = run_test_sidecar(&sidecar, token)
        .await
        .expect_err("cancelled sidecar must abort");
    cancel_task.await.expect("join cancel task");
    assert!(matches!(error, HostError::Aborted));
    #[cfg(unix)]
    assert!(!process_is_alive(sidecar_pid(&sidecar)));
}

// Root-usage passthrough: the Node host puts `usage` on the result-line response;
// PiAgentHostResponse must carry it through parse + re-serialize, or solo-run
// usage_json stays null at the renderer (the field would be silently dropped by
// serde at the IPC boundary). Regression guard for the VM-003 root-usage path.
#[test]
fn pi_response_preserves_root_usage() {
    let value = serde_json::json!({
        "text": "done",
        "usage": { "input": 10, "output": 5, "cost": 0.001, "turns": 1 },
        "budgetUsage": { "input": 1010, "output": 5, "cost": 0.021, "turns": 2 }
    });
    let response = parse_response(value).expect("decode response with usage");
    let usage = response
        .usage
        .as_ref()
        .expect("usage must survive parse, not be dropped");
    assert_eq!(usage["input"], serde_json::json!(10));
    assert_eq!(usage["output"], serde_json::json!(5));
    // And it must re-serialize back out to the renderer as camelCase `usage`.
    let back = serde_json::to_value(&response).expect("re-serialize");
    assert_eq!(back["usage"]["turns"], serde_json::json!(1));
    assert_eq!(back["budgetUsage"]["input"], serde_json::json!(1010));
}

// Wire-contract guards. The Node host (scripts/tauri-pi-agent-host.entry.mjs) emits
// camelCase keys and the renderer reads camelCase (desktop-agent-runtime.ts). The
// `tag`/`rename_all` pair only renames variant tags, NOT struct-variant fields, so
// without `rename_all_fields = "camelCase"` the required `tool_call_id`/`tool_name`
// hard-fail decode on the first tool event (and optionals silently drop to None).
// These round-trip tests are the gate that `harness:pi-agent-host` (status-only) lacked.
#[test]
fn pi_sidecar_tool_line_decodes_camel_case_wire() {
    let line = r#"{"kind":"tool","status":"started","toolCallId":"call_1","toolName":"bash","durationMs":12}"#;
    match serde_json::from_str::<PiSidecarLine>(line).expect("decode camelCase tool line") {
        PiSidecarLine::Tool {
            status,
            tool_call_id,
            tool_name,
            duration_ms,
            ..
        } => {
            assert_eq!(status, "started");
            assert_eq!(tool_call_id, "call_1");
            assert_eq!(tool_name, "bash");
            assert_eq!(duration_ms, Some(12));
        }
        other => panic!("expected Tool variant, got {other:?}"),
    }
}

#[test]
fn pi_sidecar_started_line_decodes_camel_case_optionals() {
    let line = r#"{"kind":"started","sessionId":"s1","sessionFile":"/tmp/s1.json","modelFallbackMessage":"fell back"}"#;
    match serde_json::from_str::<PiSidecarLine>(line).expect("decode camelCase started line") {
        PiSidecarLine::Started {
            session_id,
            session_file,
            model_fallback_message,
            ..
        } => {
            assert_eq!(session_id.as_deref(), Some("s1"));
            assert_eq!(session_file.as_deref(), Some("/tmp/s1.json"));
            assert_eq!(model_fallback_message.as_deref(), Some("fell back"));
        }
        other => panic!("expected Started variant, got {other:?}"),
    }
}

#[test]
fn pi_agent_host_event_serializes_camel_case_for_renderer() {
    let event = PiAgentHostEvent::Tool {
        status: "completed".into(),
        tool_call_id: "call_9".into(),
        tool_name: "write_file".into(),
        detail: None,
        duration_ms: Some(7),
    };
    let json = serde_json::to_string(&event).expect("serialize tool event");
    assert!(
        json.contains(r#""toolCallId":"call_9""#),
        "expected camelCase toolCallId, got: {json}"
    );
    assert!(
        json.contains(r#""toolName":"write_file""#),
        "expected camelCase toolName, got: {json}"
    );
    assert!(
        json.contains(r#""durationMs":7"#),
        "expected camelCase durationMs, got: {json}"
    );
    assert!(
        !json.contains("tool_call_id"),
        "snake_case key leaked to the renderer Channel: {json}"
    );
}

#[test]
fn pi_run_stream_buffers_events_and_terminal_snapshot() {
    let _stream_test_guard = pi_run_stream_test_guard();
    let request_id = format!(
        "test-stream-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_nanos()
    );
    begin_run_stream(&request_id);
    publish_host_event(
        Some(&request_id),
        None,
        PiAgentHostEvent::MessageDelta {
            delta: "hello".into(),
            channel: Some("content".into()),
        },
        "test stream delta",
    )
    .expect("publish buffered delta");
    publish_host_event(
        Some(&request_id),
        None,
        PiAgentHostEvent::Tool {
            status: "completed".into(),
            tool_call_id: "call-1".into(),
            tool_name: "read_file".into(),
            detail: None,
            duration_ms: Some(3),
        },
        "test stream tool",
    )
    .expect("publish buffered tool");
    finish_run_stream(&request_id, "completed", None);

    let streams = pi_run_streams_guard();
    let state = streams.get(&request_id).expect("stream state exists");
    let snapshot = state.snapshot(&request_id);
    assert!(!snapshot.running, "finished stream must not report running");
    assert_eq!(snapshot.cursor, 2);
    assert_eq!(snapshot.buffered, 2);
    assert_eq!(
        snapshot
            .terminal
            .as_ref()
            .map(|terminal| terminal.status.as_str()),
        Some("completed")
    );
    let replay = state
        .events
        .iter()
        .filter(|entry| entry.cursor > 1)
        .collect::<Vec<_>>();
    assert_eq!(
        replay.len(),
        1,
        "cursor replay should skip already seen events"
    );
}

#[test]
fn pi_run_stream_terminal_cleanup_and_release() {
    let _stream_test_guard = pi_run_stream_test_guard();
    let old_id = format!("test-stream-old-{}", unique_suffix());
    let fresh_id = format!("test-stream-fresh-{}", unique_suffix());
    let running_id = format!("test-stream-running-{}", unique_suffix());
    let now = Instant::now();
    let old_finished_at = now
        .checked_sub(PI_RUN_STREAM_TERMINAL_TTL + Duration::from_secs(1))
        .expect("test instant should support subtracting terminal ttl");

    begin_run_stream(&old_id);
    finish_run_stream_at(&old_id, "completed", None, old_finished_at);
    begin_run_stream(&fresh_id);
    finish_run_stream_at(&fresh_id, "completed", None, now);
    begin_run_stream(&running_id);

    cleanup_terminal_run_streams(now);
    {
        let streams = pi_run_streams_guard();
        assert!(
            !streams.contains_key(&old_id),
            "expired terminal stream should be cleaned"
        );
        assert!(
            streams.contains_key(&fresh_id),
            "fresh terminal stream should remain available"
        );
        assert!(
            streams.contains_key(&running_id),
            "running stream should not be cleaned by terminal ttl"
        );
    }

    agent_runtime_release_stream(fresh_id.clone()).expect("release terminal stream");
    agent_runtime_release_stream(running_id.clone()).expect("release running stream is a no-op");
    {
        let streams = pi_run_streams_guard();
        assert!(
            !streams.contains_key(&fresh_id),
            "manual release should remove terminal stream"
        );
        assert!(
            streams.contains_key(&running_id),
            "manual release must not remove running stream"
        );
    }

    finish_run_stream_at(&running_id, "aborted", None, old_finished_at);
    cleanup_terminal_run_streams(now);
}

#[test]
fn pi_run_stream_reattach_replays_after_cursor_and_subscribes() {
    let _stream_test_guard = pi_run_stream_test_guard();
    let request_id = format!("test-stream-reattach-{}", unique_suffix());
    begin_run_stream(&request_id);
    publish_host_event(
        Some(&request_id),
        None,
        PiAgentHostEvent::MessageDelta {
            delta: "first".into(),
            channel: Some("content".into()),
        },
        "test stream first",
    )
    .expect("publish first buffered event");
    publish_host_event(
        Some(&request_id),
        None,
        PiAgentHostEvent::MessageDelta {
            delta: "second".into(),
            channel: Some("content".into()),
        },
        "test stream second",
    )
    .expect("publish second buffered event");

    let delivered = Arc::new(Mutex::new(0usize));
    let delivered_for_channel = delivered.clone();
    let channel: Channel<PiAgentHostEvent> = Channel::new(move |_body| {
        *delivered_for_channel
            .lock()
            .expect("delivered counter poisoned") += 1;
        Ok(())
    });

    let snapshot = reattach_stream(request_id.clone(), Some(1), channel).expect("reattach stream");
    assert!(
        snapshot.running,
        "reattach snapshot should still be running"
    );
    assert_eq!(snapshot.cursor, 2);
    assert_eq!(
        *delivered.lock().expect("delivered counter poisoned"),
        2,
        "reattach should replay the second event and its cursor"
    );

    publish_host_event(
        Some(&request_id),
        None,
        PiAgentHostEvent::MessageDelta {
            delta: "third".into(),
            channel: Some("content".into()),
        },
        "test stream third",
    )
    .expect("publish event to reattached subscriber");
    assert_eq!(
        *delivered.lock().expect("delivered counter poisoned"),
        4,
        "reattached subscriber should receive future event and cursor"
    );

    let old_finished_at = Instant::now()
        .checked_sub(PI_RUN_STREAM_TERMINAL_TTL + Duration::from_secs(1))
        .expect("test instant should support subtracting terminal ttl");
    finish_run_stream_at(&request_id, "completed", None, old_finished_at);
    cleanup_terminal_run_streams(Instant::now());
}

#[test]
fn pi_run_stream_reattach_replays_workspace_unavailable_after_cursor() {
    let _stream_test_guard = pi_run_stream_test_guard();
    let request_id = format!("test-stream-unavailable-{}", unique_suffix());
    begin_run_stream(&request_id);
    publish_host_event(
        Some(&request_id),
        None,
        PiAgentHostEvent::WorkspaceUnavailable {
            project_id: "project-1".into(),
            thread_id: "thread-1".into(),
            turn_id: "turn-1".into(),
            request_id: request_id.clone(),
            source: "workspace_recovery".into(),
            reason_code: "none".into(),
        },
        "test unavailable declaration",
    )
    .expect("publish unavailable declaration");
    publish_host_event(
        Some(&request_id),
        None,
        PiAgentHostEvent::MessageDelta {
            delta: "already consumed".into(),
            channel: Some("content".into()),
        },
        "test consumed delta",
    )
    .expect("publish consumed delta");

    let delivered = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
    let delivered_for_channel = delivered.clone();
    let published_during_declaration = Arc::new(Mutex::new(false));
    let published_for_channel = published_during_declaration.clone();
    let request_id_for_channel = request_id.clone();
    let channel: Channel<PiAgentHostEvent> = Channel::new(move |body| {
        let event: serde_json::Value = body.deserialize().expect("decode replayed event");
        delivered_for_channel
            .lock()
            .expect("delivered events poisoned")
            .push(event.clone());
        let should_publish = event["kind"] == "workspaceUnavailable" && {
            let mut published = published_for_channel
                .lock()
                .expect("published flag poisoned");
            if *published {
                false
            } else {
                *published = true;
                true
            }
        };
        if should_publish {
            publish_host_event(
                Some(&request_id_for_channel),
                None,
                PiAgentHostEvent::MessageDelta {
                    delta: "live during declaration replay".into(),
                    channel: Some("content".into()),
                },
                "test live event during unavailable declaration",
            )
            .expect("publish live event during declaration replay");
        }
        Ok(())
    });

    let snapshot = reattach_stream(request_id.clone(), Some(2), channel).expect("reattach stream");
    assert!(
        snapshot.running,
        "reattached unavailable stream remains live"
    );
    let delivered = delivered.lock().expect("delivered events poisoned");
    assert_eq!(
        delivered.len(),
        3,
        "the declaration must lead the concurrently published event and its cursor"
    );
    assert_eq!(delivered[0]["kind"], "workspaceUnavailable");
    assert_eq!(delivered[0]["reasonCode"], "none");
    assert_eq!(delivered[1]["kind"], "messageDelta");
    assert_eq!(delivered[2]["kind"], "streamCursor");
}

#[test]
fn pi_run_stream_reattach_subscribes_before_replay_without_lock_send() {
    let _stream_test_guard = pi_run_stream_test_guard();
    let request_id = format!("test-stream-reattach-race-{}", unique_suffix());
    begin_run_stream(&request_id);
    publish_host_event(
        Some(&request_id),
        None,
        PiAgentHostEvent::MessageDelta {
            delta: "first".into(),
            channel: Some("content".into()),
        },
        "test stream first",
    )
    .expect("publish first buffered event");
    publish_host_event(
        Some(&request_id),
        None,
        PiAgentHostEvent::MessageDelta {
            delta: "second".into(),
            channel: Some("content".into()),
        },
        "test stream second",
    )
    .expect("publish second buffered event");

    let delivered = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
    let lock_failures = Arc::new(Mutex::new(0usize));
    let published_during_replay = Arc::new(Mutex::new(false));
    let request_id_for_channel = request_id.clone();
    let delivered_for_channel = delivered.clone();
    let lock_failures_for_channel = lock_failures.clone();
    let published_for_channel = published_during_replay.clone();
    let channel: Channel<PiAgentHostEvent> = Channel::new(move |body| {
        if PI_RUN_STREAMS.try_lock().is_err() {
            *lock_failures_for_channel
                .lock()
                .expect("lock failure counter poisoned") += 1;
        }
        delivered_for_channel
            .lock()
            .expect("delivered events poisoned")
            .push(body.deserialize().expect("decode delivered event"));
        let should_publish = {
            let mut already_published = published_for_channel
                .lock()
                .expect("published flag poisoned");
            if *already_published {
                false
            } else {
                *already_published = true;
                true
            }
        };
        if should_publish {
            publish_host_event(
                Some(&request_id_for_channel),
                None,
                PiAgentHostEvent::MessageDelta {
                    delta: "third".into(),
                    channel: Some("content".into()),
                },
                "test stream third during replay",
            )
            .expect("publish future event during replay");
        }
        Ok(())
    });

    let snapshot = reattach_stream(request_id.clone(), Some(1), channel).expect("reattach stream");
    assert!(
        snapshot.running,
        "reattach snapshot should still be running"
    );
    assert_eq!(snapshot.cursor, 2);
    assert_eq!(
        delivered.lock().expect("delivered events poisoned").len(),
        4,
        "reattach should deliver replay event/cursor plus future event/cursor"
    );
    let delivered = delivered.lock().expect("delivered events poisoned");
    assert_eq!(delivered[0]["kind"], "messageDelta");
    assert_eq!(delivered[0]["delta"], "second");
    assert_eq!(delivered[1]["kind"], "streamCursor");
    assert_eq!(delivered[1]["cursor"], 2);
    assert_eq!(delivered[2]["kind"], "messageDelta");
    assert_eq!(delivered[2]["delta"], "third");
    assert_eq!(delivered[3]["kind"], "streamCursor");
    assert_eq!(delivered[3]["cursor"], 3);
    drop(delivered);
    assert_eq!(
        *lock_failures.lock().expect("lock failure counter poisoned"),
        0,
        "Channel.send must happen after releasing PI_RUN_STREAMS"
    );
    assert_eq!(
        agent_runtime_stream_snapshot(request_id.clone())
            .expect("snapshot")
            .expect("stream exists")
            .cursor,
        3,
        "future event published during replay should remain in the stream"
    );

    let old_finished_at = Instant::now()
        .checked_sub(PI_RUN_STREAM_TERMINAL_TTL + Duration::from_secs(1))
        .expect("test instant should support subtracting terminal ttl");
    finish_run_stream_at(&request_id, "completed", None, old_finished_at);
    cleanup_terminal_run_streams(Instant::now());
}

#[test]
fn pi_run_stream_reattach_pending_is_bounded_and_fails_closed() {
    let _stream_test_guard = pi_run_stream_test_guard();
    let request_id = format!("test-stream-pending-bound-{}", unique_suffix());
    begin_run_stream(&request_id);
    publish_host_event(
        Some(&request_id),
        None,
        PiAgentHostEvent::MessageDelta {
            delta: "initial".into(),
            channel: Some("content".into()),
        },
        "seed bounded replay",
    )
    .expect("publish initial replay event");

    let published = Arc::new(Mutex::new(false));
    let published_for_channel = published.clone();
    let request_id_for_channel = request_id.clone();
    let channel: Channel<PiAgentHostEvent> = Channel::new(move |_body| {
        let should_publish = {
            let mut published = published_for_channel
                .lock()
                .expect("pending overflow publication flag poisoned");
            if *published {
                false
            } else {
                *published = true;
                true
            }
        };
        if should_publish {
            for index in 0..=PI_RUN_STREAM_BUFFER_LIMIT {
                publish_host_event(
                    Some(&request_id_for_channel),
                    None,
                    PiAgentHostEvent::MessageDelta {
                        delta: format!("concurrent-{index}"),
                        channel: Some("content".into()),
                    },
                    "fill bounded replay pending queue",
                )
                .expect("publish concurrent replay event");
            }
        }
        Ok(())
    });

    let error = reattach_stream(request_id.clone(), Some(0), channel)
        .expect_err("overflowed subscriber replay must fail closed");
    assert!(
        error.contains("bounded pending buffer"),
        "unexpected pending overflow error: {error}"
    );
    let streams = pi_run_streams_guard();
    let state = streams
        .get(&request_id)
        .expect("bounded replay stream exists");
    assert_eq!(state.events.len(), PI_RUN_STREAM_BUFFER_LIMIT);
    assert!(
        state.subscriber_count() == 0,
        "overflowed replay subscriber must be removed so reattach can retry"
    );
}

#[test]
fn pi_run_stream_reattach_rejects_evicted_cursor_gap() {
    let _stream_test_guard = pi_run_stream_test_guard();
    let request_id = format!("test-stream-gap-{}", unique_suffix());
    begin_run_stream(&request_id);
    for index in 0..=PI_RUN_STREAM_BUFFER_LIMIT {
        publish_host_event(
            Some(&request_id),
            None,
            PiAgentHostEvent::MessageDelta {
                delta: format!("buffered-{index}"),
                channel: Some("content".into()),
            },
            "fill replay retention buffer",
        )
        .expect("publish retained stream event");
    }
    let channel: Channel<PiAgentHostEvent> = Channel::new(|_body| Ok(()));
    let error = reattach_stream(request_id.clone(), Some(0), channel)
        .expect_err("an evicted replay cursor must not silently skip stream content");
    assert!(
        error.contains("replay gap"),
        "unexpected replay gap error: {error}"
    );
    assert!(
        pi_run_streams_guard()
            .get(&request_id)
            .expect("gap stream exists")
            .subscriber_count()
            == 0,
        "gap rejection must not leave a subscriber registered"
    );
}

#[test]
fn pi_sidecar_agent_run_line_round_trips_camel_case() {
    // Decode the neutral delegation envelope from camelCase wire, then
    // re-serialize the renderer-facing event and assert it stays camelCase
    // (incl. runType / rootRunId) with the opaque payload preserved.
    let line = r#"{"kind":"agentRun","threadId":"t1","rootRunId":"r1","runId":"c1","parentRunId":"r1","employeeId":"e1","relation":"delegate","workKind":"research","runType":"run.started","payload":{"objective":"scout","access":"read"}}"#;
    match serde_json::from_str::<PiSidecarLine>(line).expect("decode agentRun line") {
        PiSidecarLine::AgentRun {
            thread_id,
            root_run_id,
            run_id,
            relation,
            work_kind,
            run_type,
            payload,
            ..
        } => {
            assert_eq!(thread_id, "t1");
            assert_eq!(root_run_id, "r1");
            assert_eq!(run_id, "c1");
            assert_eq!(relation.as_deref(), Some("delegate"));
            assert_eq!(work_kind.as_deref(), Some("research"));
            assert_eq!(run_type, "run.started");
            assert_eq!(
                payload.get("objective").and_then(|v| v.as_str()),
                Some("scout")
            );
        }
        other => panic!("expected AgentRun variant, got {other:?}"),
    }

    let event = PiAgentHostEvent::AgentRun {
        thread_id: "t1".into(),
        root_run_id: "r1".into(),
        run_id: "c1".into(),
        parent_run_id: Some("r1".into()),
        employee_id: Some("e1".into()),
        relation: Some("delegate".into()),
        work_kind: Some("research".into()),
        run_type: "run.completed".into(),
        payload: serde_json::json!({ "status": "completed" }),
    };
    let json = serde_json::to_string(&event).expect("serialize agentRun event");
    assert!(
        json.contains(r#""rootRunId":"r1""#),
        "expected camelCase rootRunId, got: {json}"
    );
    assert!(
        json.contains(r#""workKind":"research""#),
        "expected camelCase workKind, got: {json}"
    );
    assert!(
        json.contains(r#""runType":"run.completed""#),
        "expected camelCase runType, got: {json}"
    );
    assert!(
        !json.contains("root_run_id") && !json.contains("run_type"),
        "snake_case key leaked to the renderer Channel: {json}"
    );
}

#[test]
fn workspace_unavailable_event_serializes_safe_scope_without_a_path() {
    let event = PiAgentHostEvent::WorkspaceUnavailable {
        project_id: "project-1".into(),
        thread_id: "thread-1".into(),
        turn_id: "turn-1".into(),
        request_id: "request-1".into(),
        source: "workspace_recovery".into(),
        reason_code: "ambiguous".into(),
    };
    let value = serde_json::to_value(event).expect("serialize workspaceUnavailable event");
    assert_eq!(value["kind"], "workspaceUnavailable");
    assert_eq!(value["reasonCode"], "ambiguous");
    assert_eq!(value["source"], "workspace_recovery");
    assert!(value.get("cwd").is_none());
    assert!(value.get("displayPath").is_none());
}

#[test]
fn pi_ui_response_serializes_camel_case_for_host() {
    // The inbound response line the host reads must stay camelCase in lockstep
    // with `resolveUiResponse(JSON.parse(line))` in the host, and must DROP the
    // unset fields so the host's `confirmed === true` / `cancelled` checks see
    // exactly what the renderer set (a serialized `confirmed: null` would not
    // satisfy `=== true`, but an absent `value`/`cancelled` must stay absent).
    let line = serde_json::to_string(&PiUiResponse {
        id: "ui-1".into(),
        confirmed: Some(true),
        value: None,
        cancelled: None,
    })
    .expect("serialize ui response");
    assert!(
        line.contains(r#""id":"ui-1""#),
        "expected the request id, got: {line}"
    );
    assert!(
        line.contains(r#""confirmed":true"#),
        "expected confirmed flag, got: {line}"
    );
    assert!(
        !line.contains("value") && !line.contains("cancelled"),
        "unset response fields must be dropped, not serialized as null: {line}"
    );
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiRequestContractFixture {
    cases: Vec<PiRequestContractCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiRequestContractCase {
    mode: String,
    request: serde_json::Value,
    context: PiRequestContractContext,
    payload: serde_json::Value,
    #[serde(rename = "normalized")]
    _normalized: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiRequestContractContext {
    cwd: String,
    #[serde(default)]
    session_dir: Option<String>,
    #[serde(default)]
    agent_dir: Option<String>,
}

#[test]
fn pi_request_fixture_encodes_across_languages() {
    // The SAME fixture is decoded through the production Node request decoder
    // by scripts/check-pi-wire-contract.mjs. Rust owns the raw payload emitter;
    // Node owns normalization/dispatch, so either side drifting fails a gate.
    let fixture_path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../scripts/fixtures/pi-request-contract.json"
    );
    let raw = std::fs::read_to_string(fixture_path)
        .unwrap_or_else(|err| panic!("read request fixture {fixture_path}: {err}"));
    let fixture: PiRequestContractFixture =
        serde_json::from_str(&raw).expect("request fixture is valid JSON");
    assert_eq!(
        fixture.cases.len(),
        3,
        "fixture must cover all request modes"
    );

    for case in fixture.cases {
        let cwd = Path::new(&case.context.cwd);
        let agent_dir = case.context.agent_dir.as_deref().map(Path::new);
        let actual = match case.mode.as_str() {
            "execute" => {
                let req: PiAgentExecuteRequest = serde_json::from_value(case.request)
                    .expect("decode execute request from camelCase fixture");
                let session_dir = case
                    .context
                    .session_dir
                    .as_deref()
                    .map(Path::new)
                    .expect("execute fixture requires sessionDir");
                let project_id = case
                    .payload
                    .get("projectId")
                    .and_then(serde_json::Value::as_str)
                    .expect("execute payload requires projectId");
                let verify_command = case
                    .payload
                    .get("projectVerifyCommand")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned);
                let verify_max_attempts = case
                    .payload
                    .get("projectVerifyMaxAttempts")
                    .and_then(serde_json::Value::as_u64)
                    .expect("execute payload requires projectVerifyMaxAttempts")
                    as u32;
                let verify_token_budget = case
                    .payload
                    .get("projectVerifyTokenBudget")
                    .and_then(serde_json::Value::as_u64);
                let binding = test_task_workspace_binding(
                    cwd,
                    project_id,
                    verify_command,
                    verify_max_attempts,
                    verify_token_budget,
                );
                sidecar_payload(
                    &req,
                    ExecuteWorkspacePayload::Bound(&binding),
                    session_dir,
                    agent_dir,
                    req.direct_delegation.as_ref(),
                    None,
                    None,
                )
            }
            "enhance" => {
                let req: PiAgentEnhanceRequest = serde_json::from_value(case.request)
                    .expect("decode enhance request from camelCase fixture");
                enhance_payload(&req, cwd, agent_dir)
            }
            "collaborate" => {
                let req: PiAgentCollaborateRequest = serde_json::from_value(case.request)
                    .expect("decode collaborate request from camelCase fixture");
                collaborate_payload(&req, cwd, agent_dir)
            }
            other => panic!("unknown request fixture mode: {other}"),
        };
        assert_eq!(
            actual, case.payload,
            "Rust request payload drifted for mode {}",
            case.mode
        );
    }
}

#[test]
fn pi_execute_payload_omits_absent_delegation_limits() {
    let req: PiAgentExecuteRequest = serde_json::from_value(serde_json::json!({
        "requestId": "plain-request",
        "text": "Plain chat",
        "companyId": "company-1",
        "threadId": "thread-1"
    }))
    .expect("decode minimal plain-chat request");

    let binding =
        test_task_workspace_binding(Path::new("/fixture/project"), "project-1", None, 3, None);
    let payload = sidecar_payload(
        &req,
        ExecuteWorkspacePayload::Bound(&binding),
        Path::new("/fixture/sessions/thread-1"),
        None,
        None,
        None,
        None,
    );
    assert!(
        payload.get("delegationLimits").is_none(),
        "plain-chat payload must not gain a delegationLimits key"
    );
}

#[test]
fn pi_execute_unavailable_payload_strips_every_workspace_capability() {
    let req: PiAgentExecuteRequest = serde_json::from_value(serde_json::json!({
        "requestId": "unavailable-request",
        "text": "What did we decide earlier?",
        "companyId": "company-1",
        "threadId": "thread-1",
        "projectId": "project-1",
        "rootRunId": "turn-1",
        "workspaceRequirement": "optional",
        "skillPaths": ["/stale/SKILL.md"],
        "roster": [{"employeeId": "employee-2"}],
        "missionContextJson": "{\"missionId\":\"mission-1\"}",
        "mcpTools": [{"serverId": "server-1", "toolName": "read_file"}],
        "directDelegation": {"employeeId": "employee-2", "objective": "edit files"},
        "delegationLimits": {"maxDepth": 1}
    }))
    .expect("decode optional workspace request");

    let payload = sidecar_payload(
        &req,
        ExecuteWorkspacePayload::Unavailable {
            reason_code: "ambiguous",
        },
        Path::new("/fixture/sessions/thread-1"),
        None,
        req.direct_delegation.as_ref(),
        None,
        None,
    );

    assert_eq!(payload["workspaceRequirement"], "optional");
    assert_eq!(payload["workspaceAvailability"], "unavailable");
    assert_eq!(payload["workspaceUnavailableReasonCode"], "ambiguous");
    assert_eq!(payload["projectId"], "project-1");
    for key in [
        "skillPaths",
        "roster",
        "missionContextJson",
        "mcpTools",
        "projectVerifyCommand",
        "projectVerifyMaxAttempts",
        "projectVerifyTokenBudget",
    ] {
        assert!(
            payload[key].is_null(),
            "{key} must be removed without a workspace"
        );
    }
    assert!(payload.get("directDelegation").is_none());
    assert!(payload.get("delegationLimits").is_none());
}

#[test]
fn pi_wire_fixture_decodes_across_languages() {
    // The SAME fixture is validated by scripts/check-pi-wire-contract.mjs on the
    // Node side, so the Node emitter and the Rust decoder cannot drift apart.
    let fixture_path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../scripts/fixtures/pi-wire-contract.json"
    );
    let raw = std::fs::read_to_string(fixture_path)
        .unwrap_or_else(|err| panic!("read wire fixture {fixture_path}: {err}"));
    let lines: Vec<serde_json::Value> =
        serde_json::from_str(&raw).expect("fixture is a JSON array");
    assert!(!lines.is_empty(), "fixture must not be empty");

    let mut saw_ready = false;
    let mut saw_tool = false;
    let mut saw_mcp_call = false;
    let mut saw_worktree_call = false;
    for value in &lines {
        // Tie the Rust known-kinds list to the shared fixture. The JS gate proves the
        // fixture exercises every PI_WIRE_KINDS entry, so asserting each fixture kind is
        // in PI_KNOWN_WIRE_KINDS transitively catches Rust/Node kind-list drift (a kind
        // the Rust decoder would otherwise treat as unknown and silently skip).
        let kind = value
            .get("kind")
            .and_then(|kind| kind.as_str())
            .unwrap_or_else(|| panic!("fixture line missing a string kind: {value}"));
        assert!(
                PI_KNOWN_WIRE_KINDS.contains(&kind),
                "fixture kind \"{kind}\" is missing from PI_KNOWN_WIRE_KINDS (Rust and Node kind lists drifted)"
            );
        let decoded: PiSidecarLine = serde_json::from_value(value.clone())
            .unwrap_or_else(|err| panic!("decode fixture line {value}: {err}"));
        match decoded {
            PiSidecarLine::Ready { protocol_version } => {
                saw_ready = true;
                assert_eq!(
                    protocol_version, PI_HOST_PROTOCOL_VERSION,
                    "fixture ready handshake must match the runtime protocol version"
                );
            }
            PiSidecarLine::Tool {
                tool_call_id,
                tool_name,
                ..
            } => {
                saw_tool = true;
                assert!(!tool_call_id.is_empty());
                assert!(!tool_name.is_empty());
            }
            PiSidecarLine::McpCall {
                id, server, tool, ..
            } => {
                saw_mcp_call = true;
                assert!(!id.is_empty(), "mcpCall id");
                assert!(!server.is_empty(), "mcpCall server");
                assert!(!tool.is_empty(), "mcpCall tool");
            }
            PiSidecarLine::WorktreeCall { id, op, args } => {
                saw_worktree_call = true;
                assert!(!id.is_empty(), "worktreeCall id");
                assert!(!op.is_empty(), "worktreeCall op");
                assert!(args.is_some(), "worktreeCall args");
            }
            _ => {}
        }
    }
    assert!(saw_ready, "fixture must exercise the ready handshake");
    assert!(saw_tool, "fixture must exercise a tool event");
    assert!(saw_mcp_call, "fixture must exercise an mcpCall line");
    assert!(
        saw_worktree_call,
        "fixture must exercise a worktreeCall line"
    );
}

#[test]
fn decode_sidecar_line_skips_unknown_kind() {
    let line = r#"{"kind":"telemetry","foo":"bar"}"#;
    let decoded = decode_sidecar_line(line).expect("unknown kind is forward-compatible");
    assert!(
        decoded.is_none(),
        "unknown kind should be skipped, not decoded"
    );
}

#[test]
fn decode_sidecar_line_surfaces_malformed_known_kind() {
    // A `tool` line missing the required toolName is a real contract break.
    let line = r#"{"kind":"tool","status":"started","toolCallId":"call_1"}"#;
    let err = decode_sidecar_line(line).expect_err("malformed known kind must error");
    assert!(matches!(err, HostError::Protocol(message) if message.contains("tool")));
}

#[test]
fn decode_sidecar_line_validates_ready_handshake() {
    let line = format!(r#"{{"kind":"ready","protocolVersion":{PI_HOST_PROTOCOL_VERSION}}}"#);
    match decode_sidecar_line(&line)
        .expect("ready decodes")
        .expect("ready present")
    {
        PiSidecarLine::Ready { protocol_version } => {
            assert_eq!(protocol_version, PI_HOST_PROTOCOL_VERSION)
        }
        other => panic!("expected Ready, got {other:?}"),
    }
}

#[test]
fn consume_ready_handshake_rejects_version_mismatch() {
    let mut saw_ready = false;
    let line = PiSidecarLine::Ready {
        protocol_version: PI_HOST_PROTOCOL_VERSION + 1,
    };
    let err =
        consume_ready_handshake(&mut saw_ready, &line).expect_err("mismatched ready must error");
    assert!(
        matches!(err, HostError::Protocol(message) if message.contains("does not match runtime"))
    );
    assert!(!saw_ready);
}

#[test]
fn consume_ready_handshake_requires_ready_before_business_event() {
    let mut saw_ready = false;
    let line: PiSidecarLine =
        serde_json::from_str(r#"{"kind":"result","response":{"ok":true,"text":"done"}}"#)
            .expect("decode result line");
    let err = consume_ready_handshake(&mut saw_ready, &line)
        .expect_err("business event before ready must error");
    assert!(
        matches!(err, HostError::Protocol(message) if message.contains("required ready handshake"))
    );
    assert!(!saw_ready);
}

#[test]
fn pi_sidecar_line_kind_name_matches_wire_kind() {
    let line = r#"{"kind":"result","response":{"ok":true,"text":"done"}}"#;
    let decoded: PiSidecarLine = serde_json::from_str(line).expect("decode result line");
    assert_eq!(decoded.kind_name(), "result");
}
