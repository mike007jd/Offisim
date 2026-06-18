use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, AppHandle};
use tokio_util::sync::CancellationToken;

use crate::agent_host_runtime::{
    append_sidecar_audit, dev_workspace_root, project_workspace_root, required_text,
    resolved_request_cwd, run_sidecar_json, sidecar_script_path, trusted_host_env, AgentHostLane,
    HostError, SidecarAudit,
};
use crate::in_flight::InFlightRegistry;
use crate::runtime_secrets;

const CODEX_ENV_EXTRAS: &[&str] = &["CODEX_HOME"];

const CODEX_LANE: AgentHostLane = AgentHostLane {
    name: "Codex",
    execution_lane: "codex-agent-sdk",
    resource_path: "resources/codex-agent-host.mjs",
    dev_script_name: "scripts/tauri-codex-agent-host.mjs",
    aborted_message: "Codex lane request aborted",
    no_credential_message:
        "No provider credential stored on this device for the trusted Codex lane.",
    output_cap_bytes: Some(16 * 1024 * 1024),
};

static IN_FLIGHT: InFlightRegistry = InFlightRegistry::new("codex_agent_host");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAgentExecuteRequest {
    request_id: String,
    request: serde_json::Value,
    #[serde(default)]
    provider_profile_id: Option<String>,
    #[serde(default)]
    company_id: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    employee_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum CodexAgentHostEvent {
    Result { response: serde_json::Value },
    Error { code: String, message: String },
}

fn build_env(
    workspace_root: Option<&PathBuf>,
    secret: Option<&str>,
    base_url: Option<&str>,
) -> HashMap<String, String> {
    let mut env = trusted_host_env(workspace_root, CODEX_ENV_EXTRAS, "OFFISIM_CODEX_EXECUTABLE");

    if let Some(secret) = secret {
        env.insert("OPENAI_API_KEY".into(), secret.to_string());
        if let Some(base_url) = base_url.and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then_some(trimmed)
        }) {
            env.insert("OPENAI_BASE_URL".into(), base_url.to_string());
        }
    }

    env
}

fn is_codex_responses_incompatible_base_url(base_url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(base_url.trim()) else {
        return false;
    };
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let path = parsed.path().trim_end_matches('/');
    host == "api.z.ai" && matches!(path, "/api/paas/v4" | "/api/coding/paas/v4")
}

fn assert_codex_provider(
    profile: &runtime_secrets::RuntimeProviderProfile,
) -> Result<(), HostError> {
    match profile.provider.as_str() {
        "openai" | "openai-compat" => Ok(()),
        provider => Err(HostError::Request(format!(
            "Trusted Codex lane requires an OpenAI-compatible provider profile; received '{provider}'."
        ))),
    }?;
    if is_codex_responses_incompatible_base_url(&profile.base_url) {
        return Err(HostError::Request(
            "Z.AI OpenAI-compatible endpoints are chat-completions only. Use the gateway runtime profile, or use the Z.AI Anthropic endpoint for the Claude lane."
                .into(),
        ));
    }
    Ok(())
}

async fn do_execute<R: tauri::Runtime>(
    app: &AppHandle<R>,
    req: CodexAgentExecuteRequest,
    on_event: &Channel<CodexAgentHostEvent>,
    token: CancellationToken,
) -> Result<(), HostError> {
    // Resolve provider profile + secret from runtime_secrets (mirrors the
    // Claude host). Fail-closed: if no providerProfileId or no stored secret,
    // we don't try to fall back to ambient env.
    let provider_profile_id = required_text(
        req.provider_profile_id.as_ref(),
        "providerProfileId",
        CODEX_LANE,
    )?;
    let company_id = required_text(req.company_id.as_ref(), "companyId", CODEX_LANE)?;
    let provider_profile = runtime_secrets::resolve_runtime_provider_profile(provider_profile_id)
        .map_err(HostError::Request)?;
    assert_codex_provider(&provider_profile)?;
    let secret = runtime_secrets::read_provider_secret(Some(provider_profile.secret_ref.as_str()))
        .map_err(HostError::Request)?
        .ok_or(HostError::NoCredential)?;

    let workspace_root =
        project_workspace_root(app, Some(company_id), req.project_id.as_deref(), CODEX_LANE)
            .await?;
    let cwd = resolved_request_cwd(req.cwd.as_deref(), &workspace_root, CODEX_LANE)?;
    append_sidecar_audit(
        app,
        CODEX_LANE,
        SidecarAudit {
            request_id: &req.request_id,
            project_id: req.project_id.as_deref(),
            employee_id: req.employee_id.as_deref(),
            provider_profile_id: Some(provider_profile_id),
            credential_recorded: true,
        },
        &cwd,
        "started",
    );

    let dev_root = dev_workspace_root();
    let script_path = sidecar_script_path(app, dev_root.as_ref(), CODEX_LANE)?;
    let payload = serde_json::json!({
        "request": req.request,
        "cwd": cwd.to_string_lossy().to_string(),
    });
    let env = build_env(
        Some(&workspace_root),
        Some(secret.as_str()),
        Some(provider_profile.base_url.as_str()),
    );
    let response = run_sidecar_json(CODEX_LANE, &script_path, &cwd, env, payload, token).await?;

    on_event
        .send(CodexAgentHostEvent::Result { response })
        .map_err(|e| HostError::Request(format!("Send trusted host result: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn codex_agent_execute(
    app: AppHandle,
    req: CodexAgentExecuteRequest,
    on_event: Channel<CodexAgentHostEvent>,
) -> Result<(), String> {
    let request_id = req.request_id.clone();
    let token = IN_FLIGHT.register(&request_id);
    let result = do_execute(&app, req, &on_event, token.clone()).await;
    IN_FLIGHT.clear(&request_id);

    match result {
        Ok(()) => Ok(()),
        Err(HostError::Aborted) => Ok(()),
        Err(error) => {
            let (code, message) = error.into_code_message(CODEX_LANE);
            let _ = on_event.send(CodexAgentHostEvent::Error {
                code: code.clone(),
                message: message.clone(),
            });
            Err(format!("{code}: {message}"))
        }
    }
}

#[tauri::command]
pub fn codex_agent_abort(request_id: String) -> Result<(), String> {
    if let Some(token) = IN_FLIGHT.pluck(&request_id) {
        token.cancel();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn provider_profile(provider: &str, base_url: &str) -> runtime_secrets::RuntimeProviderProfile {
        serde_json::from_value(json!({
            "id": "test-profile",
            "displayName": "Test profile",
            "provider": provider,
            "model": "test-model",
            "baseUrl": base_url,
            "secretRef": "test-profile",
            "authScheme": "bearer",
            "allowedHost": "example.com",
            "localEndpoint": false
        }))
        .expect("deserialize runtime provider profile")
    }

    fn temp_project_root(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("offisim-codex-sidecar-{label}-{suffix}"));
        std::fs::create_dir_all(&root).expect("create temp project root");
        root.canonicalize().expect("canonical temp project root")
    }

    #[test]
    fn trusted_codex_cwd_defaults_to_project_workspace() {
        let root = temp_project_root("default");
        let cwd = resolved_request_cwd(None, &root, CODEX_LANE).expect("resolve default cwd");
        assert_eq!(cwd, root);
    }

    #[test]
    fn trusted_codex_cwd_rejects_outside_project_workspace() {
        let root = temp_project_root("root");
        let outside = temp_project_root("outside");
        let err = resolved_request_cwd(Some(outside.to_string_lossy().as_ref()), &root, CODEX_LANE)
            .expect_err("outside cwd should fail");
        assert!(matches!(err, HostError::Request(message) if message.contains("outside")));
    }

    #[test]
    fn codex_env_uses_openai_compatible_keys_only() {
        let env = build_env(None, Some("secret"), Some("https://api.z.ai/api/paas/v4"));
        assert_eq!(
            env.get("OPENAI_BASE_URL").map(String::as_str),
            Some("https://api.z.ai/api/paas/v4")
        );
        assert_eq!(
            env.get("OPENAI_API_KEY").map(String::as_str),
            Some("secret")
        );
        assert!(!env.contains_key("ANTHROPIC_BASE_URL"));
        assert!(!env.contains_key("ANTHROPIC_AUTH_TOKEN"));
        assert!(!env.contains_key("ANTHROPIC_API_KEY"));
    }

    #[test]
    fn codex_provider_gate_rejects_anthropic_profile() {
        let profile = provider_profile("anthropic", "https://api.minimax.io/anthropic");
        let err = assert_codex_provider(&profile).expect_err("wrong provider should fail");
        assert!(
            matches!(err, HostError::Request(message) if message.contains("OpenAI-compatible"))
        );
    }

    #[test]
    fn codex_provider_gate_rejects_zai_chat_only_openai_base_urls() {
        for base_url in [
            "https://api.z.ai/api/paas/v4",
            "https://api.z.ai/api/coding/paas/v4/",
        ] {
            let profile = provider_profile("openai-compat", base_url);
            let err = assert_codex_provider(&profile)
                .expect_err("chat-completions-only Z.AI base URL should fail");
            assert!(
                matches!(err, HostError::Request(message) if message.contains("chat-completions only"))
            );
        }
    }

    #[test]
    fn codex_provider_gate_accepts_minimax_openai_base_url() {
        let profile = provider_profile("openai-compat", "https://api.minimax.io/v1");
        assert_codex_provider(&profile).expect("MiniMax OpenAI-compatible base is accepted");
    }
}
