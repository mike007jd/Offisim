use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::agent_host_runtime::{dev_workspace_root, sidecar_script_path};

use super::payload::{app_pi_agent_dir, pi_env};
use super::run::{run_pi_sidecar_jsonl, PiSidecarRun};
use super::types::{AiRuntimeStatusResponse, PiAgentProviderConfigInput, PiAgentStatusResponse};
use super::wire::parse_status;
use super::PI_LANE;

/// Adapter diagnostics used only by the legacy diagnostic command and provider
/// inspection. Product surfaces must call `runtime_status_impl`, which strips paths,
/// provider configuration, and credential-source details at this boundary.
async fn status_request(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<PiAgentStatusResponse, String> {
    let dev_root = dev_workspace_root();
    let script_path = sidecar_script_path(&app, dev_root.as_ref(), PI_LANE)
        .map_err(|err| err.into_code_message(PI_LANE).1)?;
    let cwd = dev_root
        .clone()
        .or_else(|| app.path().home_dir().ok())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let response = run_pi_sidecar_jsonl(
        &app,
        PiSidecarRun {
            script_path: &script_path,
            cwd: &cwd,
            workspace_binding: None,
            env: pi_env(None),
            payload,
            token: CancellationToken::new(),
            on_event: None,
            register_stdin: None,
            stream_request_id: None,
        },
    )
    .await
    .map_err(|err| err.into_code_message(PI_LANE).1)?;
    parse_status(response).map_err(|err| err.into_code_message(PI_LANE).1)
}

pub(super) async fn open_config_folder(app: AppHandle) -> Result<(), String> {
    let dir = app_pi_agent_dir(&app)
        .ok_or_else(|| "Resolve Pi Agent config folder: home directory unavailable".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|err| format!("Create Pi Agent config folder: {err}"))?;

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(&dir);
        command
    };
    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(&dir);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(&dir);
        command
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
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("Base URL must not contain credentials, query parameters, or fragments".into());
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

pub(super) async fn save_provider(
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

    status_request(
        app.clone(),
        serde_json::json!({
            "mode": "saveProvider",
            "agentDir": app_pi_agent_dir(&app).map(|path| path.to_string_lossy().to_string()),
            "config": {
                "providerId": provider_id,
                "displayName": display_name,
                "baseUrl": base_url,
                "api": api,
                "apiKey": api_key,
                "keepExistingApiKey": config.keep_existing_api_key,
                "models": models,
            },
        }),
    )
    .await
}

pub(super) async fn status_impl(app: AppHandle) -> Result<PiAgentStatusResponse, String> {
    let payload = serde_json::json!({
        "mode": "status",
        "agentDir": app_pi_agent_dir(&app).map(|path| path.to_string_lossy().to_string()),
    });
    status_request(app, payload).await
}

pub(super) async fn runtime_status_impl(app: AppHandle) -> Result<AiRuntimeStatusResponse, String> {
    status_impl(app)
        .await?
        .runtime_status
        .ok_or_else(|| "Agent runtime returned no safe account catalog.".to_string())
}
