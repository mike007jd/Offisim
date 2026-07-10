mod bridge;
mod payload;
mod run;
mod stream;
mod types;
mod wire;

pub use stream::PiRunStreamSnapshot;
pub use types::{
    PiAgentCollaborateRequest, PiAgentEnhanceRequest, PiAgentExecuteRequest, PiAgentHostEvent,
    PiAgentHostResponse, PiAgentModelsConfig, PiAgentPaths, PiAgentProviderAuthStatus,
    PiAgentProviderConfigInput, PiAgentProviderConfigStatus, PiAgentProviderModelConfig,
    PiAgentProviderStatus, PiAgentProviderTemplate, PiAgentStatusResponse, PiModelSummary,
};

#[cfg(test)]
use bridge::PiUiResponse;
use bridge::{
    handle_mcp_call, handle_worktree_call, pi_stdin_guard, ui_response_impl, write_mcp_result,
    PiMcpResult, StdinGuard, PI_MCP_CALL_TIMEOUT,
};
use payload::{
    app_pi_agent_dir, app_pi_session_dir, collaborate_payload, enhance_payload, pi_env,
    sidecar_payload, write_payload,
};
use run::{abort_impl, collaborate_impl, enhance_impl, execute_impl, run_pi_sidecar_jsonl};
use stream::{begin_run_stream, finish_run_stream, publish_host_event};
#[cfg(test)]
use stream::{
    cleanup_terminal_run_streams, finish_run_stream_at, pi_run_streams_guard, PI_RUN_STREAMS,
    PI_RUN_STREAM_TERMINAL_TTL,
};
use wire::{
    consume_ready_handshake, decode_sidecar_line, parse_response, parse_status, send_sidecar_event,
    PiSidecarLine,
};
#[cfg(test)]
use wire::{PI_HOST_PROTOCOL_VERSION, PI_KNOWN_WIRE_KINDS};

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::sync::CancellationToken;

use crate::agent_host_runtime::{
    append_sidecar_audit, dev_workspace_root, project_workspace_root, required_text,
    resolve_node_executable, resolved_request_cwd, sidecar_script_path, AgentHostLane, HostError,
    SidecarAudit,
};
use crate::in_flight::InFlightRegistry;
use crate::sidecar_stderr::sanitized_stderr;

const PI_LANE: AgentHostLane = AgentHostLane {
    name: "Pi Agent",
    execution_lane: "pi-agent",
    resource_path: "resources/pi-agent-host.mjs",
    dev_script_name: "scripts/tauri-pi-agent-host.entry.mjs",
    aborted_message: "Pi Agent request aborted",
};

#[tauri::command]
pub fn agent_runtime_stream_snapshot(
    request_id: String,
) -> Result<Option<PiRunStreamSnapshot>, String> {
    stream::stream_snapshot(request_id)
}

#[tauri::command]
pub fn agent_runtime_release_stream(request_id: String) -> Result<(), String> {
    stream::release_stream(request_id)
}

#[tauri::command]
pub fn agent_runtime_reattach(
    request_id: String,
    after_cursor: Option<u64>,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiRunStreamSnapshot, String> {
    stream::reattach_stream(request_id, after_cursor, on_event)
}

#[tauri::command]
pub async fn pi_agent_execute(
    app: AppHandle,
    req: PiAgentExecuteRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    execute_impl(app, req, on_event).await
}

/// Agent-agnostic gateway command. Forwards verbatim to the Pi lane via
/// `execute_impl` — the renderer's runtime-neutral DesktopAgentRuntime calls this
/// instead of `pi_agent_execute`; the Pi-specific types ride in the host/driver.
#[tauri::command]
pub async fn agent_runtime_execute(
    app: AppHandle,
    req: PiAgentExecuteRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    execute_impl(app, req, on_event).await
}

/// Agent-agnostic gateway command for Prompt Enhance (PR-06). A DEDICATED,
/// isolated one-shot — never the work path. Forwards to `enhance_impl`, which runs
/// the Pi host with no project workspace, no tools, and no persistence. The
/// renderer's enhance transport calls this instead of `agent_runtime_execute`.
#[tauri::command]
pub async fn agent_runtime_enhance(
    app: AppHandle,
    req: PiAgentEnhanceRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    enhance_impl(app, req, on_event).await
}

/// Agent-agnostic gateway command for the Collaboration capability profile (PR-03).
/// The HOST-ENFORCED no-tools / no-workspace / no-persistence STREAMING path for
/// daily company chat. Forwards to `collaborate_impl`, which runs the Pi host with
/// a neutral cwd, zero tools, and no extension factories. The renderer's
/// collaboration transport calls this instead of `agent_runtime_execute`, so a
/// collaboration reply NEVER takes the work execute path (no project bind, no
/// agent_runs / mission persistence, no Office dramaturgy projection).
#[tauri::command]
pub async fn agent_runtime_collaborate(
    app: AppHandle,
    req: PiAgentCollaborateRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    collaborate_impl(app, req, on_event).await
}

/// Agent-agnostic durable-resume gateway. Pi resumes by re-entering the same
/// thread/session directory; the Node host's SessionManager continues the recent
/// session automatically when the same sessionDir is supplied.
#[tauri::command]
pub async fn agent_runtime_resume(
    app: AppHandle,
    req: PiAgentExecuteRequest,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiAgentHostResponse, String> {
    execute_impl(app, req, on_event).await
}

#[tauri::command]
pub fn pi_agent_abort(request_id: String) -> Result<(), String> {
    abort_impl(request_id)
}

/// Agent-agnostic gateway abort. Forwards verbatim to `abort_impl`.
#[tauri::command]
pub fn agent_runtime_abort(request_id: String) -> Result<(), String> {
    abort_impl(request_id)
}

#[tauri::command]
pub async fn pi_agent_ui_response(
    request_id: String,
    id: String,
    confirmed: Option<bool>,
    value: Option<String>,
    cancelled: Option<bool>,
) -> Result<(), String> {
    ui_response_impl(request_id, id, confirmed, value, cancelled).await
}

/// Agent-agnostic gateway: the generic name for an interaction answer. Forwards
/// verbatim to `ui_response_impl` — the runtime-neutral DesktopAgentRuntime calls
/// this instead of `pi_agent_ui_response`.
#[tauri::command]
pub async fn agent_runtime_answer(
    request_id: String,
    id: String,
    confirmed: Option<bool>,
    value: Option<String>,
    cancelled: Option<bool>,
) -> Result<(), String> {
    ui_response_impl(request_id, id, confirmed, value, cancelled).await
}

#[tauri::command]
pub async fn pi_agent_open_config_folder(app: AppHandle) -> Result<(), String> {
    let dir = app_pi_agent_dir(&app)
        .ok_or_else(|| "Resolve Pi Agent config folder: home directory unavailable".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|err| format!("Create Pi Agent config folder: {err}"))?;

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(&dir);
        cmd
    };

    #[cfg(target_os = "linux")]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(&dir);
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("explorer");
        cmd.arg(&dir);
        cmd
    };

    let status = command
        .status()
        .await
        .map_err(|err| format!("Open Pi Agent config folder: {err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Open Pi Agent config folder exited with {status}"))
    }
}

fn trim_required(value: &str, label: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(format!("{label} is required"))
    } else {
        Ok(trimmed.to_string())
    }
}

fn normalize_provider_id(value: &str) -> Result<String, String> {
    let provider_id = trim_required(value, "Provider id")?;
    if !provider_id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(
            "Provider id may only contain letters, numbers, dot, dash, and underscore".into(),
        );
    }
    Ok(provider_id)
}

fn normalize_base_url(value: &str) -> Result<String, String> {
    let base_url = trim_required(value, "Base URL")?;
    let parsed = url::Url::parse(&base_url).map_err(|err| format!("Base URL is invalid: {err}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Base URL must start with http:// or https://".into());
    }
    Ok(base_url)
}

fn normalize_api(value: &str) -> Result<String, String> {
    let api = trim_required(value, "API format")?;
    if !api
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '/'))
    {
        return Err(
            "API format may only contain letters, numbers, dot, slash, dash, and underscore".into(),
        );
    }
    Ok(api)
}

#[tauri::command]
pub async fn pi_agent_save_provider(
    app: AppHandle,
    config: PiAgentProviderConfigInput,
) -> Result<PiAgentStatusResponse, String> {
    let provider_id = normalize_provider_id(&config.provider_id)?;
    let display_name = config
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let base_url = normalize_base_url(&config.base_url)?;
    let api = normalize_api(&config.api)?;
    let api_key = config
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if api_key.is_none() && !config.keep_existing_api_key {
        return Err("API key is required".into());
    }
    let models = config
        .models
        .iter()
        .map(|model| {
            let id = trim_required(&model.id, "Model id")?;
            let name = model
                .name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let api = model
                .api
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(normalize_api)
                .transpose()?;
            let mut value = serde_json::Map::new();
            value.insert("id".to_string(), serde_json::json!(id));
            if let Some(name) = name {
                value.insert("name".to_string(), serde_json::json!(name));
            }
            if let Some(api) = api {
                value.insert("api".to_string(), serde_json::json!(api));
            }
            if let Some(context_window) = model.context_window.filter(|value| *value > 0) {
                value.insert(
                    "contextWindow".to_string(),
                    serde_json::json!(context_window),
                );
            }
            if let Some(max_tokens) = model.max_tokens.filter(|value| *value > 0) {
                value.insert("maxTokens".to_string(), serde_json::json!(max_tokens));
            }
            Ok(serde_json::Value::Object(value))
        })
        .collect::<Result<Vec<_>, String>>()?;
    if models.is_empty() {
        return Err("Add at least one model id".into());
    }

    let dev_root = dev_workspace_root();
    let script_path = sidecar_script_path(&app, dev_root.as_ref(), PI_LANE)
        .map_err(|err| err.into_code_message(PI_LANE).1)?;
    let cwd = dev_root
        .clone()
        .or_else(|| app.path().home_dir().ok())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let agent_dir = app_pi_agent_dir(&app)
        .ok_or_else(|| "Resolve Pi Agent config folder: home directory unavailable".to_string())?;
    let payload = serde_json::json!({
        "mode": "saveProvider",
        "agentDir": agent_dir.to_string_lossy().to_string(),
        "config": {
            "providerId": provider_id,
            "displayName": display_name,
            "baseUrl": base_url,
            "api": api,
            "apiKey": api_key,
            "keepExistingApiKey": config.keep_existing_api_key,
            "models": models,
        },
    });
    let response = run_pi_sidecar_jsonl(
        &app,
        &script_path,
        &cwd,
        None,
        pi_env(None),
        payload,
        CancellationToken::new(),
        None,
        None,
        None,
    )
    .await
    .map_err(|err| err.into_code_message(PI_LANE).1)?;
    parse_status(response).map_err(|err| err.into_code_message(PI_LANE).1)
}

/// Shared status impl. Both `pi_agent_status` (back-compat + the Pi settings
/// pane) and `agent_runtime_status` (gateway) call this verbatim.
async fn status_impl(app: AppHandle) -> Result<PiAgentStatusResponse, String> {
    let dev_root = dev_workspace_root();
    let script_path = sidecar_script_path(&app, dev_root.as_ref(), PI_LANE)
        .map_err(|err| err.into_code_message(PI_LANE).1)?;
    let cwd = dev_root
        .clone()
        .or_else(|| app.path().home_dir().ok())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let payload = serde_json::json!({
        "mode": "status",
        "agentDir": app_pi_agent_dir(&app).map(|path| path.to_string_lossy().to_string()),
    });
    let response = run_pi_sidecar_jsonl(
        &app,
        &script_path,
        &cwd,
        None,
        pi_env(None),
        payload,
        CancellationToken::new(),
        None,
        None,
        None,
    )
    .await
    .map_err(|err| err.into_code_message(PI_LANE).1)?;
    parse_status(response).map_err(|err| err.into_code_message(PI_LANE).1)
}

#[tauri::command]
pub async fn pi_agent_status(app: AppHandle) -> Result<PiAgentStatusResponse, String> {
    status_impl(app).await
}

/// Agent-agnostic gateway status. Forwards verbatim to `status_impl`.
#[tauri::command]
pub async fn agent_runtime_status(app: AppHandle) -> Result<PiAgentStatusResponse, String> {
    status_impl(app).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    static PI_RUN_STREAM_TEST_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn pi_run_stream_test_guard() -> std::sync::MutexGuard<'static, ()> {
        PI_RUN_STREAM_TEST_LOCK
            .lock()
            .expect("pi run stream test lock poisoned")
    }

    fn unique_suffix() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_nanos()
    }

    fn temp_project_root(label: &str) -> PathBuf {
        let suffix = unique_suffix();
        let root = std::env::temp_dir().join(format!("offisim-pi-agent-{label}-{suffix}"));
        std::fs::create_dir_all(&root).expect("create temp project root");
        root.canonicalize().expect("canonical temp project root")
    }

    #[test]
    fn pi_cwd_defaults_to_project_workspace() {
        let root = temp_project_root("default");
        let cwd = resolved_request_cwd(None, &root, PI_LANE).expect("resolve default cwd");
        assert_eq!(cwd, root);
    }

    #[test]
    fn pi_cwd_rejects_outside_project_workspace() {
        let root = temp_project_root("root");
        let outside = temp_project_root("outside");
        let err = resolved_request_cwd(Some(outside.to_string_lossy().as_ref()), &root, PI_LANE)
            .expect_err("outside cwd should fail");
        assert!(matches!(err, HostError::Request(message) if message.contains("outside")));
    }

    // Root-usage passthrough: the Node host puts `usage` on the result-line response;
    // PiAgentHostResponse must carry it through parse + re-serialize, or solo-run
    // usage_json stays null at the renderer (the field would be silently dropped by
    // serde at the IPC boundary). Regression guard for the VM-003 root-usage path.
    #[test]
    fn pi_response_preserves_root_usage() {
        let value = serde_json::json!({
            "text": "done",
            "usage": { "input": 10, "output": 5, "cost": 0.001, "turns": 1 }
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
        agent_runtime_release_stream(running_id.clone())
            .expect("release running stream is a no-op");
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

        let snapshot =
            agent_runtime_reattach(request_id.clone(), Some(1), channel).expect("reattach stream");
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

        let delivered = Arc::new(Mutex::new(0usize));
        let lock_failures = Arc::new(Mutex::new(0usize));
        let published_during_replay = Arc::new(Mutex::new(false));
        let request_id_for_channel = request_id.clone();
        let delivered_for_channel = delivered.clone();
        let lock_failures_for_channel = lock_failures.clone();
        let published_for_channel = published_during_replay.clone();
        let channel: Channel<PiAgentHostEvent> = Channel::new(move |_body| {
            if PI_RUN_STREAMS.try_lock().is_err() {
                *lock_failures_for_channel
                    .lock()
                    .expect("lock failure counter poisoned") += 1;
            }
            {
                let mut delivered = delivered_for_channel
                    .lock()
                    .expect("delivered counter poisoned");
                *delivered += 1;
            }
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

        let snapshot =
            agent_runtime_reattach(request_id.clone(), Some(1), channel).expect("reattach stream");
        assert!(
            snapshot.running,
            "reattach snapshot should still be running"
        );
        assert_eq!(snapshot.cursor, 2);
        assert_eq!(
            *delivered.lock().expect("delivered counter poisoned"),
            4,
            "reattach should deliver replay event/cursor plus future event/cursor"
        );
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
                    sidecar_payload(&req, cwd, session_dir, agent_dir)
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
        let err = consume_ready_handshake(&mut saw_ready, &line)
            .expect_err("mismatched ready must error");
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
}
