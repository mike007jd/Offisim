use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentExecuteRequest {
    pub(super) request_id: String,
    pub(super) text: String,
    pub(super) company_id: String,
    pub(super) thread_id: String,
    #[serde(default)]
    pub(super) cwd: Option<String>,
    #[serde(default)]
    pub(super) project_id: Option<String>,
    #[serde(default)]
    pub(super) employee_id: Option<String>,
    #[serde(default)]
    pub(super) model: Option<String>,
    /// Per-conversation permission mode (`plan` / `ask` / `auto` / `full`).
    /// Forwarded to the Node host, which turns it into Pi tool gating. Absent →
    /// host default.
    #[serde(default)]
    pub(super) permission_mode: Option<String>,
    /// Per-conversation thinking level / reasoning effort (`off` / `minimal` /
    /// `low` / `medium` / `high` / `xhigh`). An opaque forwarded string — the
    /// Node host validates it and clamps it to the model's reasoning
    /// capabilities. Absent → host default.
    #[serde(default)]
    pub(super) thinking_level: Option<String>,
    /// Employee persona forwarded as the Pi session's `appendSystemPrompt`. An
    /// opaque string the renderer builds from the saved employee profile; the
    /// host hands it to the resource loader. Absent → Pi uses its base prompt.
    #[serde(default)]
    pub(super) system_prompt_append: Option<String>,
    /// Root run id for this user turn (the renderer's controller attemptId). The
    /// delegation supervisor stamps every child `agentRun` event with it so the
    /// renderer can graft children under the root. Absent → no delegation scope.
    #[serde(default)]
    pub(super) root_run_id: Option<String>,
    /// Company roster (opaque, forwarded verbatim): each employee the root agent
    /// may delegate to, with persona / model / access / tools. Built renderer-side
    /// from `employees.findByCompany`; Rust does not interpret it.
    #[serde(default)]
    pub(super) roster: Option<serde_json::Value>,
    /// Verified Missions context packet (MS-005). A minimal JSON summary of the
    /// mission goal + criteria the renderer's MissionRunController injects for a
    /// mission attempt; the host hands it to the mission-bridge extension so
    /// `query_mission_state` can return it. Opaque to Rust — never interpreted,
    /// never persisted here. Absent on a plain chat (no mission bridge registered).
    #[serde(default)]
    pub(super) mission_context_json: Option<String>,
    /// Employee-scoped MCP tool catalog. Built renderer-side from live grants and
    /// connected MCP servers, then forwarded verbatim to the Node host so it can
    /// register the fixed MCP meta tools (`mcp_search_tools` / `mcp_describe_tool`
    /// / `mcp_call`). Opaque to Rust.
    #[serde(default)]
    pub(super) mcp_tools: Option<serde_json::Value>,
}

/// Prompt Enhance request (PR-06). A DEDICATED, isolated one-shot — never a work
/// run. It carries only what the no-tools, no-workspace, no-persistence enhance
/// path needs: the user text, the selected profile's versioned system prompt, and
/// optional model / thinking overrides. There is deliberately NO `project_id`,
/// `company_id`, `thread_id`, `roster`, or `mission_context_json`: enhance never
/// binds a workspace and never persists, so it has no scope fields at all.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentEnhanceRequest {
    pub(super) request_id: String,
    pub(super) text: String,
    /// The selected enhance profile's versioned system instruction. Built
    /// renderer-side from the frozen profile constants; opaque to Rust.
    pub(super) system_prompt: String,
    #[serde(default)]
    pub(super) model: Option<String>,
    #[serde(default)]
    pub(super) thinking_level: Option<String>,
}

/// Collaboration request (PR-03). The HOST-ENFORCED `collaboration` capability
/// profile of the Pi Agent: daily company chat with NO project bind, ZERO tools,
/// NO delegation, NO mission bridge, NO workspace cwd. Like enhance it never binds
/// a workspace and never persists a transcript — but unlike enhance it STREAMS.
///
/// `capabilityProfile` is a frozen, additive request enum (default `'work'` is the
/// existing execute path; `'collaboration'` routes here). It carries only the
/// collaboration scope (company / thread / employee — the conversationKey, NOT a
/// project workspace) plus the persona/context system prompt and optional
/// model/thinking overrides. There is deliberately NO `project_id`, `roster`, or
/// `mission_context_json`: collaboration never delegates and never runs a mission.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentCollaborateRequest {
    pub(super) request_id: String,
    pub(super) text: String,
    /// Frozen capability enum. The renderer always sends `'collaboration'` here;
    /// shaped so future profiles only ADD a branch. Opaque to Rust beyond routing.
    #[serde(default)]
    pub(super) capability_profile: Option<String>,
    /// Connect permission profile (`strict` / `collaboration_read`). Opaque to
    /// Rust except for deciding whether the sidecar stdin channel must stay open
    /// for MCP results.
    #[serde(default)]
    pub(super) collaboration_profile: Option<String>,
    pub(super) company_id: String,
    /// The Collaboration thread id (company-scoped daily chat) — NOT a project /
    /// chat_thread id. Part of the conversationKey, never a workspace.
    pub(super) collaboration_thread_id: String,
    #[serde(default)]
    pub(super) employee_id: Option<String>,
    #[serde(default)]
    pub(super) model: Option<String>,
    #[serde(default)]
    pub(super) thinking_level: Option<String>,
    #[serde(default)]
    pub(super) mcp_tools: Option<serde_json::Value>,
    /// The speaking employee's persona + the collaboration context packet, built
    /// renderer-side and forwarded as the Pi session's `appendSystemPrompt`. Opaque
    /// to Rust. Carries identity context only — never a delegate roster.
    #[serde(default)]
    pub(super) system_prompt_append: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiModelSummary {
    #[serde(default)]
    pub(super) provider: Option<String>,
    #[serde(default)]
    pub(super) id: Option<String>,
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) api: Option<String>,
    #[serde(default)]
    pub(super) reasoning: Option<bool>,
    #[serde(default)]
    pub(super) context_window: Option<u64>,
    #[serde(default)]
    pub(super) max_tokens: Option<u64>,
    #[serde(default)]
    pub(super) input: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentHostResponse {
    pub(super) text: String,
    #[serde(default)]
    pub(super) reasoning: Option<String>,
    #[serde(default)]
    pub(super) session_id: Option<String>,
    #[serde(default)]
    pub(super) session_file: Option<String>,
    #[serde(default)]
    pub(super) model: Option<PiModelSummary>,
    // Root-session token/cost usage (the Node host's `rootUsage` on the result
    // line). Carried through as an opaque JSON object so the renderer can record
    // it on the root agent_runs row — without this field serde silently drops it
    // at the IPC boundary and solo-run usage_json stays null (the VM-003 path).
    #[serde(default)]
    pub(super) usage: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PiAgentHostEvent {
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
    Result {
        response: PiAgentHostResponse,
    },
    Error {
        code: String,
        message: String,
    },
    StreamCursor {
        cursor: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentProviderAuthStatus {
    pub(super) configured: bool,
    #[serde(default)]
    pub(super) source: Option<String>,
    #[serde(default)]
    pub(super) label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentProviderStatus {
    pub(super) provider: String,
    pub(super) display_name: String,
    pub(super) auth: PiAgentProviderAuthStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentProviderModelConfig {
    pub(super) id: String,
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) api: Option<String>,
    #[serde(default)]
    pub(super) context_window: Option<u64>,
    #[serde(default)]
    pub(super) max_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentProviderConfigStatus {
    pub(super) provider: String,
    pub(super) display_name: String,
    #[serde(default)]
    pub(super) name: Option<String>,
    #[serde(default)]
    pub(super) base_url: Option<String>,
    #[serde(default)]
    pub(super) api: Option<String>,
    #[serde(default)]
    pub(super) has_api_key: bool,
    #[serde(default)]
    pub(super) auth_source: Option<String>,
    #[serde(default)]
    pub(super) models: Vec<PiAgentProviderModelConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentProviderTemplate {
    pub(super) provider: String,
    pub(super) display_name: String,
    #[serde(default)]
    pub(super) base_url: Option<String>,
    #[serde(default)]
    pub(super) api: Option<String>,
    #[serde(default)]
    pub(super) configured: bool,
    #[serde(default)]
    pub(super) models: Vec<PiAgentProviderModelConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentStatusResponse {
    pub(super) ok: bool,
    #[serde(default)]
    pub(super) auth_providers: Vec<String>,
    #[serde(default)]
    pub(super) provider_status: Vec<PiAgentProviderStatus>,
    #[serde(default)]
    pub(super) configured_provider_status: Vec<PiAgentProviderStatus>,
    #[serde(default)]
    pub(super) provider_configs: Vec<PiAgentProviderConfigStatus>,
    #[serde(default)]
    pub(super) provider_templates: Vec<PiAgentProviderTemplate>,
    #[serde(default)]
    pub(super) available_models: Vec<PiModelSummary>,
    #[serde(default)]
    pub(super) all_model_count: u64,
    #[serde(default)]
    pub(super) paths: Option<PiAgentPaths>,
    #[serde(default)]
    pub(super) models_config: Option<PiAgentModelsConfig>,
    #[serde(default)]
    pub(super) checked_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentPaths {
    #[serde(default)]
    pub(super) agent_dir: Option<String>,
    #[serde(default)]
    pub(super) auth_path: Option<String>,
    #[serde(default)]
    pub(super) models_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentModelsConfig {
    #[serde(default)]
    pub(super) path: Option<String>,
    pub(super) exists: bool,
    #[serde(default)]
    pub(super) provider_count: u64,
    #[serde(default)]
    pub(super) model_count: u64,
    #[serde(default)]
    pub(super) override_count: u64,
    #[serde(default)]
    pub(super) providers: Vec<String>,
    #[serde(default)]
    pub(super) parse_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiAgentProviderConfigInput {
    pub(super) provider_id: String,
    #[serde(default)]
    pub(super) display_name: Option<String>,
    pub(super) base_url: String,
    pub(super) api: String,
    #[serde(default)]
    pub(super) api_key: Option<String>,
    #[serde(default)]
    pub(super) keep_existing_api_key: bool,
    #[serde(default)]
    pub(super) models: Vec<PiAgentProviderModelConfig>,
}
