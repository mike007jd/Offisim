use serde::{Deserialize, Serialize};

use crate::git::CompetitiveDraftContext;

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CodexWorkspaceRequirement {
    #[default]
    Required,
    Optional,
}

impl CodexWorkspaceRequirement {
    pub(super) fn is_optional(self) -> bool {
        self == Self::Optional
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CodexNativeSessionMode {
    #[default]
    Tracked,
    Fresh,
}

impl CodexNativeSessionMode {
    pub(super) fn is_fresh(self) -> bool {
        self == Self::Fresh
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexModelSource {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexExecutionTarget {
    pub engine_id: String,
    pub account_id: String,
    pub billing_mode: String,
    pub model_id: String,
    pub model_source: CodexModelSource,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexAdapterIdentity {
    pub id: String,
    pub version: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexExecutionProvenance {
    pub engine_id: String,
    pub account_id: String,
    pub billing_mode: String,
    pub model_id: String,
    pub model_source: CodexModelSource,
    pub run_id: String,
    pub adapter: CodexAdapterIdentity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actual_model_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub(super) struct CodexNativeThreadRef {
    pub protocol: String,
    pub thread_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexAgentExecuteRequest {
    pub request_id: String,
    pub text: String,
    pub expected_target: CodexExecutionTarget,
    pub company_id: String,
    pub thread_id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub employee_id: Option<String>,
    #[serde(default)]
    pub root_run_id: Option<String>,
    /// Durable workspace history authority. It is required only by
    /// `codex_agent_resume`; a normal execute must never accept one.
    #[serde(default)]
    pub workspace_binding_history_id: Option<String>,
    /// Closed recovery mode. `fresh` is an explicit one-shot reset authorized
    /// by a durable failed root; it is never inferred from an invalid session.
    #[serde(default)]
    pub native_session_mode: CodexNativeSessionMode,
    /// Failed normal-Turn root that authorizes an explicit fresh-session reset.
    /// It is accepted only with `nativeSessionMode: "fresh"`.
    #[serde(default)]
    pub native_session_reset_source_run_id: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub system_prompt_append: Option<String>,
    #[serde(default)]
    pub skill_paths: Option<Vec<String>>,
    #[serde(default)]
    pub project_skill_paths: Option<Vec<String>>,
    #[serde(default)]
    pub client_user_message_id: Option<String>,
    #[serde(default)]
    pub workspace_requirement: CodexWorkspaceRequirement,
    /// Opaque product-facing continuation reference. Its payload is a strict
    /// `CodexNativeThreadRef` JSON object; native ids are never split into UI
    /// fields.
    #[serde(default)]
    pub native_session_id: Option<String>,
    #[serde(default)]
    pub competitive_draft: Option<CompetitiveDraftContext>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexAgentEnhanceRequest {
    pub request_id: String,
    pub text: String,
    pub expected_target: CodexExecutionTarget,
    pub system_prompt: String,
    #[serde(default)]
    pub source_provenance: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexModelSummary {
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub api: Option<String>,
    #[serde(default)]
    pub reasoning: Option<bool>,
    #[serde(default)]
    pub context_window: Option<u64>,
    #[serde(default)]
    pub max_tokens: Option<u64>,
    #[serde(default)]
    pub input: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAgentHostResponse {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<CodexModelSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<CodexExecutionProvenance>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub budget_usage: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CodexAgentHostEvent {
    WorkspaceBound {
        workspace_ref: String,
        history_id: String,
        company_id: String,
        project_id: String,
        thread_id: String,
        turn_id: String,
        request_id: String,
        access: String,
        source: String,
        confidence: f64,
        reason_code: String,
        issued_at_unix_ms: i64,
        expires_at_unix_ms: i64,
        display_path: String,
    },
    WorkspaceUnavailable {
        project_id: String,
        thread_id: String,
        turn_id: String,
        request_id: String,
        source: String,
        reason_code: String,
    },
    Started {
        #[serde(default)]
        session_id: Option<String>,
        #[serde(default)]
        session_file: Option<String>,
        #[serde(default)]
        model: Option<CodexModelSummary>,
        #[serde(default)]
        model_fallback_message: Option<String>,
    },
    ExecutionPrepared {
        prepare_id: String,
        run_id: String,
        identity: CodexExecutionProvenance,
        target_digest: String,
        adapter: CodexAdapterIdentity,
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        params: Option<serde_json::Value>,
        #[serde(default)]
        options: Option<Vec<String>>,
        #[serde(default)]
        placeholder: Option<String>,
        #[serde(default)]
        prefill: Option<String>,
    },
    UiRequestResolved {
        id: String,
        resolution: String,
    },
    Result {
        response: Box<CodexAgentHostResponse>,
    },
    Error {
        code: String,
        message: String,
    },
    StreamCursor {
        cursor: u64,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexRunStreamTerminal {
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexRunStreamSnapshot {
    pub request_id: String,
    pub running: bool,
    pub cursor: u64,
    pub buffered: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal: Option<CodexRunStreamTerminal>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAgentStatusResponse {
    pub engine_id: String,
    pub display_name: String,
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_reason: Option<String>,
    pub login_command: String,
    pub docs_url: String,
    pub checked_at: String,
    pub capabilities: serde_json::Value,
}
