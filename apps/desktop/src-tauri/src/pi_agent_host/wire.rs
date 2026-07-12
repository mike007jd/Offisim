use serde::Deserialize;
use tauri::ipc::Channel;

use crate::agent_host_runtime::HostError;

use super::stream::publish_host_event;
use super::types::{PiAgentHostEvent, PiAgentHostResponse, PiAgentStatusResponse, PiModelSummary};

/// Wire-contract version negotiated with the bundled Node host via the `ready`
/// handshake. Must stay in lockstep with `PI_HOST_PROTOCOL_VERSION` in
/// scripts/pi-agent-host-wire.mjs; bump both when a line's required shape changes.
pub(super) const PI_HOST_PROTOCOL_VERSION: u32 = 6;

/// Wire kinds the Rust bridge knows how to decode. A line with an unknown kind is
/// skipped (forward-compatible with newer hosts); a malformed line on a KNOWN kind
/// is surfaced as a protocol error rather than silently dropped.
pub(super) const PI_KNOWN_WIRE_KINDS: &[&str] = &[
    "ready",
    "started",
    "messageDelta",
    "messageEnd",
    "tool",
    "uiRequest",
    "mcpCall",
    "worktreeCall",
    "verifyCall",
    "agentRun",
    "result",
    "error",
];

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(super) enum PiSidecarLine {
    Ready {
        protocol_version: u32,
    },
    Started {
        #[serde(default)]
        session_id: Option<String>,
        #[serde(default)]
        session_file: Option<String>,
        #[serde(default)]
        model: Option<PiModelSummary>,
        #[serde(default)]
        model_fallback_message: Option<String>,
    },
    MessageDelta {
        delta: String,
        #[serde(default)]
        channel: Option<String>,
    },
    MessageEnd {
        text: String,
        #[serde(default)]
        stop_reason: Option<String>,
        #[serde(default)]
        error_message: Option<String>,
    },
    Tool {
        status: String,
        tool_call_id: String,
        tool_name: String,
        #[serde(default)]
        detail: Option<String>,
        #[serde(default)]
        duration_ms: Option<u64>,
    },
    UiRequest {
        id: String,
        method: String,
        title: String,
        #[serde(default)]
        message: Option<String>,
        #[serde(default)]
        options: Option<Vec<String>>,
        #[serde(default)]
        placeholder: Option<String>,
        #[serde(default)]
        prefill: Option<String>,
    },
    AgentRun {
        thread_id: String,
        root_run_id: String,
        run_id: String,
        #[serde(default)]
        parent_run_id: Option<String>,
        #[serde(default)]
        employee_id: Option<String>,
        #[serde(default)]
        relation: Option<String>,
        #[serde(default)]
        work_kind: Option<String>,
        run_type: String,
        payload: serde_json::Value,
    },
    /// The host's MCP bridge extension asked to invoke an MCP tool. Intercepted
    /// in-process (NOT forwarded to the renderer): the Rust host calls
    /// mcp_bridge::call_tool and writes a `mcpResult` line back to the host stdin.
    McpCall {
        id: String,
        server: String,
        tool: String,
        #[serde(default)]
        arguments: Option<serde_json::Value>,
    },
    WorktreeCall {
        id: String,
        op: String,
        #[serde(default)]
        args: Option<serde_json::Value>,
    },
    VerifyCall {
        id: String,
        command: String,
        cwd: String,
        project_id: String,
    },
    Result {
        response: serde_json::Value,
    },
    Error {
        code: String,
        message: String,
    },
}

impl PiSidecarLine {
    pub(super) fn kind_name(&self) -> &'static str {
        match self {
            Self::Ready { .. } => "ready",
            Self::Started { .. } => "started",
            Self::MessageDelta { .. } => "messageDelta",
            Self::MessageEnd { .. } => "messageEnd",
            Self::Tool { .. } => "tool",
            Self::UiRequest { .. } => "uiRequest",
            Self::McpCall { .. } => "mcpCall",
            Self::WorktreeCall { .. } => "worktreeCall",
            Self::VerifyCall { .. } => "verifyCall",
            Self::AgentRun { .. } => "agentRun",
            Self::Result { .. } => "result",
            Self::Error { .. } => "error",
        }
    }
}

pub(super) fn parse_response(value: serde_json::Value) -> Result<PiAgentHostResponse, HostError> {
    serde_json::from_value(value)
        .map_err(|err| HostError::Protocol(format!("Decode Pi Agent response: {err}")))
}

pub(super) fn parse_status(value: serde_json::Value) -> Result<PiAgentStatusResponse, HostError> {
    serde_json::from_value(value)
        .map_err(|err| HostError::Protocol(format!("Decode Pi Agent status: {err}")))
}

pub(super) fn send_sidecar_event(
    request_id: Option<&str>,
    on_event: Option<&Channel<PiAgentHostEvent>>,
    line: PiSidecarLine,
) -> Result<Option<serde_json::Value>, HostError> {
    match line {
        // The handshake is consumed by the stream loop before this point; never forwarded.
        PiSidecarLine::Ready { .. } => Ok(None),
        PiSidecarLine::Started {
            session_id,
            session_file,
            model,
            model_fallback_message,
        } => {
            publish_host_event(
                request_id,
                on_event,
                PiAgentHostEvent::Started {
                    session_id,
                    session_file,
                    model,
                    model_fallback_message,
                },
                "Send Pi start event",
            )?;
            Ok(None)
        }
        PiSidecarLine::MessageDelta { delta, channel } => {
            publish_host_event(
                request_id,
                on_event,
                PiAgentHostEvent::MessageDelta { delta, channel },
                "Send Pi message delta",
            )?;
            Ok(None)
        }
        PiSidecarLine::MessageEnd {
            text,
            stop_reason,
            error_message,
        } => {
            publish_host_event(
                request_id,
                on_event,
                PiAgentHostEvent::MessageEnd {
                    text,
                    stop_reason,
                    error_message,
                },
                "Send Pi message end",
            )?;
            Ok(None)
        }
        PiSidecarLine::Tool {
            status,
            tool_call_id,
            tool_name,
            detail,
            duration_ms,
        } => {
            publish_host_event(
                request_id,
                on_event,
                PiAgentHostEvent::Tool {
                    status,
                    tool_call_id,
                    tool_name,
                    detail,
                    duration_ms,
                },
                "Send Pi tool event",
            )?;
            Ok(None)
        }
        PiSidecarLine::UiRequest {
            id,
            method,
            title,
            message,
            options,
            placeholder,
            prefill,
        } => {
            publish_host_event(
                request_id,
                on_event,
                PiAgentHostEvent::UiRequest {
                    id,
                    method,
                    title,
                    message,
                    options,
                    placeholder,
                    prefill,
                },
                "Send Pi UI request",
            )?;
            Ok(None)
        }
        // mcpCall is intercepted in the stream loop (handled in-process, never
        // forwarded). This arm is the defensive fallback if one ever reaches here.
        PiSidecarLine::McpCall { .. } => Ok(None),
        // worktreeCall follows the same in-process intercept pattern; never
        // forward it to the renderer.
        PiSidecarLine::WorktreeCall { .. } => Ok(None),
        // verifyCall is serviced through the sandboxed bash builtin in the
        // stream loop and answered on stdin; never forward it to the renderer.
        PiSidecarLine::VerifyCall { .. } => Ok(None),
        PiSidecarLine::AgentRun {
            thread_id,
            root_run_id,
            run_id,
            parent_run_id,
            employee_id,
            relation,
            work_kind,
            run_type,
            payload,
        } => {
            publish_host_event(
                request_id,
                on_event,
                PiAgentHostEvent::AgentRun {
                    thread_id,
                    root_run_id,
                    run_id,
                    parent_run_id,
                    employee_id,
                    relation,
                    work_kind,
                    run_type,
                    payload,
                },
                "Send Pi agent run event",
            )?;
            Ok(None)
        }
        PiSidecarLine::Result { response } => Ok(Some(response)),
        PiSidecarLine::Error { code, message } => {
            let _ = publish_host_event(
                request_id,
                on_event,
                PiAgentHostEvent::Error {
                    code: code.clone(),
                    message: message.clone(),
                },
                "Send Pi error event",
            );
            Err(HostError::Upstream {
                code: Some(code),
                message,
            })
        }
    }
}

/// Decode one JSONL line from the Pi host. Unknown wire kinds are skipped (so a
/// newer host that adds an event type does not abort the run), while a malformed
/// line on a KNOWN kind is surfaced as a protocol error instead of being lost.
pub(super) fn decode_sidecar_line(raw: &str) -> Result<Option<PiSidecarLine>, HostError> {
    match serde_json::from_str::<PiSidecarLine>(raw) {
        Ok(line) => Ok(Some(line)),
        Err(strict_err) => {
            let kind = serde_json::from_str::<serde_json::Value>(raw)
                .ok()
                .and_then(|value| {
                    value
                        .get("kind")
                        .and_then(|kind| kind.as_str().map(str::to_owned))
                });
            match kind {
                Some(kind) if PI_KNOWN_WIRE_KINDS.contains(&kind.as_str()) => {
                    Err(HostError::Protocol(format!(
                        "Pi Agent host emitted a malformed \"{kind}\" line: {strict_err}; line: {raw}"
                    )))
                }
                Some(kind) => {
                    eprintln!(
                        "[pi-agent-host] skipping unknown wire kind \"{kind}\" (forward-compat); line: {raw}"
                    );
                    Ok(None)
                }
                None => Err(HostError::Protocol(format!(
                    "Pi Agent host returned invalid JSONL: {strict_err}; line: {raw}"
                ))),
            }
        }
    }
}

pub(super) fn consume_ready_handshake(
    saw_ready: &mut bool,
    line: &PiSidecarLine,
) -> Result<bool, HostError> {
    if let PiSidecarLine::Ready { protocol_version } = line {
        if *protocol_version != PI_HOST_PROTOCOL_VERSION {
            return Err(HostError::Protocol(format!(
                "Pi Agent host protocol version {protocol_version} does not match runtime {PI_HOST_PROTOCOL_VERSION}; rebuild the bundled host (pnpm build:pi-agent-host)"
            )));
        }
        *saw_ready = true;
        return Ok(true);
    }
    if !*saw_ready {
        return Err(HostError::Protocol(format!(
            "Pi Agent host did not emit the required ready handshake before \"{}\"; rebuild the bundled host (pnpm build:pi-agent-host)",
            line.kind_name()
        )));
    }
    Ok(false)
}
