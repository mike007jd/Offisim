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

const CLAUDE_LANE: AgentHostLane = AgentHostLane {
    name: "Claude",
    execution_lane: "claude-agent-sdk",
    resource_path: "resources/claude-agent-host.mjs",
    dev_script_name: "scripts/tauri-claude-agent-host.mjs",
    aborted_message: "Claude lane request aborted",
    no_credential_message: "No provider credential stored on this device.",
    output_cap_bytes: Some(16 * 1024 * 1024),
};

static IN_FLIGHT: InFlightRegistry = InFlightRegistry::new("claude_agent_host");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeAgentExecuteRequest {
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
    #[serde(default)]
    credential_mode: Option<ClaudeCredentialMode>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum ClaudeCredentialMode {
    ApiKey,
    LocalAuth,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ClaudeAgentHostEvent {
    Result { response: serde_json::Value },
    Error { code: String, message: String },
}

fn build_env(
    workspace_root: Option<&PathBuf>,
    secret: Option<&str>,
    base_url: Option<&str>,
) -> HashMap<String, String> {
    let mut env = trusted_host_env(workspace_root, &[], "OFFISIM_CLAUDE_CODE_EXECUTABLE");
    env.insert("CLAUDE_CODE_DISABLE_AUTO_MEMORY".into(), "1".into());

    if let Some(secret) = secret {
        if let Some(base_url) = base_url.and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then_some(trimmed)
        }) {
            env.insert("ANTHROPIC_BASE_URL".into(), base_url.to_string());
            env.insert("ANTHROPIC_AUTH_TOKEN".into(), secret.to_string());
        } else {
            env.insert("ANTHROPIC_API_KEY".into(), secret.to_string());
        }
    }

    env
}

fn assert_claude_provider(provider: &str) -> Result<(), HostError> {
    match provider {
        "anthropic" => Ok(()),
        provider => Err(HostError::Request(format!(
            "Trusted Claude lane requires an anthropic provider profile; received '{provider}'."
        ))),
    }
}

fn assert_local_auth_profile(
    profile: Option<&runtime_secrets::RuntimeProviderProfile>,
) -> Result<(), HostError> {
    let Some(profile) = profile else {
        return Err(HostError::Request(
            "Claude local-auth requires a runtime provider profile.".into(),
        ));
    };
    if profile.execution_lane != "claude-agent-sdk" || profile.auth_mode != "local-auth" {
        return Err(HostError::Request(
            "Claude local-auth requires a claude-agent-sdk/local-auth runtime profile.".into(),
        ));
    }
    Ok(())
}

async fn do_execute<R: tauri::Runtime>(
    app: &AppHandle<R>,
    req: ClaudeAgentExecuteRequest,
    on_event: &Channel<ClaudeAgentHostEvent>,
    token: CancellationToken,
) -> Result<(), HostError> {
    let credential_mode = req.credential_mode.unwrap_or(ClaudeCredentialMode::ApiKey);
    let provider_profile_id = required_text(
        req.provider_profile_id.as_ref(),
        "providerProfileId",
        CLAUDE_LANE,
    )?;
    let company_id = required_text(req.company_id.as_ref(), "companyId", CLAUDE_LANE)?;
    let provider_profile = runtime_secrets::resolve_runtime_provider_profile(provider_profile_id)
        .map_err(HostError::Request)?;
    assert_claude_provider(provider_profile.provider.as_str())?;
    if credential_mode == ClaudeCredentialMode::LocalAuth {
        assert_local_auth_profile(Some(&provider_profile))?;
    }
    let secret = if credential_mode == ClaudeCredentialMode::ApiKey {
        Some(
            runtime_secrets::read_provider_secret(Some(provider_profile.secret_ref.as_str()))
                .map_err(HostError::Request)?
                .ok_or(HostError::NoCredential)?,
        )
    } else {
        None
    };

    let workspace_root = project_workspace_root(
        app,
        Some(company_id),
        req.project_id.as_deref(),
        CLAUDE_LANE,
    )
    .await?;
    let cwd = resolved_request_cwd(req.cwd.as_deref(), &workspace_root, CLAUDE_LANE)?;
    append_sidecar_audit(
        app,
        CLAUDE_LANE,
        SidecarAudit {
            request_id: &req.request_id,
            project_id: req.project_id.as_deref(),
            employee_id: req.employee_id.as_deref(),
            provider_profile_id: Some(provider_profile_id),
            credential_recorded: credential_mode == ClaudeCredentialMode::ApiKey,
        },
        &cwd,
        "started",
    );

    let dev_root = dev_workspace_root();
    let script_path = sidecar_script_path(app, dev_root.as_ref(), CLAUDE_LANE)?;
    let payload = serde_json::json!({
        "request": req.request,
        "cwd": cwd.to_string_lossy().to_string(),
        "credentialMode": match credential_mode {
            ClaudeCredentialMode::ApiKey => "api-key",
            ClaudeCredentialMode::LocalAuth => "local-auth",
        },
    });
    let env = build_env(
        Some(&workspace_root),
        secret.as_deref(),
        Some(provider_profile.base_url.as_str()),
    );
    let response = run_sidecar_json(CLAUDE_LANE, &script_path, &cwd, env, payload, token).await?;

    on_event
        .send(ClaudeAgentHostEvent::Result { response })
        .map_err(|e| HostError::Request(format!("Send trusted host result: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn claude_agent_execute(
    app: AppHandle,
    req: ClaudeAgentExecuteRequest,
    on_event: Channel<ClaudeAgentHostEvent>,
) -> Result<(), String> {
    let request_id = req.request_id.clone();
    let token = IN_FLIGHT.register(&request_id);
    let result = do_execute(&app, req, &on_event, token.clone()).await;
    IN_FLIGHT.clear(&request_id);

    match result {
        Ok(()) => Ok(()),
        Err(HostError::Aborted) => Ok(()),
        Err(error) => {
            let (code, message) = error.into_code_message(CLAUDE_LANE);
            let _ = on_event.send(ClaudeAgentHostEvent::Error {
                code: code.clone(),
                message: message.clone(),
            });
            Err(format!("{code}: {message}"))
        }
    }
}

#[tauri::command]
pub fn claude_agent_abort(request_id: String) -> Result<(), String> {
    if let Some(token) = IN_FLIGHT.pluck(&request_id) {
        token.cancel();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_project_root(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("offisim-claude-sidecar-{label}-{suffix}"));
        std::fs::create_dir_all(&root).expect("create temp project root");
        root.canonicalize().expect("canonical temp project root")
    }

    #[test]
    fn trusted_claude_cwd_defaults_to_project_workspace() {
        let root = temp_project_root("default");
        let cwd = resolved_request_cwd(None, &root, CLAUDE_LANE).expect("resolve default cwd");
        assert_eq!(cwd, root);
    }

    #[test]
    fn trusted_claude_cwd_rejects_outside_project_workspace() {
        let root = temp_project_root("root");
        let outside = temp_project_root("outside");
        let err =
            resolved_request_cwd(Some(outside.to_string_lossy().as_ref()), &root, CLAUDE_LANE)
                .expect_err("outside cwd should fail");
        assert!(matches!(err, HostError::Request(message) if message.contains("outside")));
    }

    #[test]
    fn claude_env_uses_anthropic_auth_token_for_compatible_base_url() {
        let env = build_env(
            None,
            Some("secret"),
            Some("https://api.minimax.io/anthropic"),
        );
        assert_eq!(
            env.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://api.minimax.io/anthropic")
        );
        assert_eq!(
            env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("secret")
        );
        assert!(!env.contains_key("ANTHROPIC_API_KEY"));
        assert!(!env.contains_key("OPENAI_API_KEY"));
    }

    #[test]
    fn claude_env_uses_native_api_key_without_base_url() {
        let env = build_env(None, Some("secret"), None);
        assert_eq!(
            env.get("ANTHROPIC_API_KEY").map(String::as_str),
            Some("secret")
        );
        assert!(!env.contains_key("ANTHROPIC_AUTH_TOKEN"));
        assert!(!env.contains_key("OPENAI_API_KEY"));
    }

    #[test]
    fn claude_provider_gate_rejects_openai_compat_profile() {
        let err = assert_claude_provider("openai-compat").expect_err("wrong provider should fail");
        assert!(
            matches!(err, HostError::Request(message) if message.contains("requires an anthropic"))
        );
    }
}
