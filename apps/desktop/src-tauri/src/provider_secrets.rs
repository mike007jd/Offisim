use keyring::{Entry, Error as KeyringError};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const SERVICE_NAME: &str = "com.offisim.desktop";
const ACCOUNT_NAME: &str = "provider.api_key";
const OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSecretStatus {
    has_api_key: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderChatRequest {
    provider: String,
    base_url: Option<String>,
    #[serde(default)]
    default_headers: Option<HashMap<String, String>>,
    llm_request: DesktopLlmRequest,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLlmRequest {
    messages: Vec<DesktopLlmMessage>,
    model: String,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    tools: Option<Vec<DesktopToolDef>>,
    timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLlmMessage {
    role: String,
    content: String,
    #[serde(default)]
    tool_calls: Vec<DesktopToolCall>,
    tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopToolCall {
    id: String,
    name: String,
    arguments: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DesktopToolDef {
    name: String,
    description: String,
    parameters: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLlmResponse {
    content: String,
    tool_calls: Vec<DesktopToolCall>,
    usage: DesktopLlmUsage,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopLlmUsage {
    input_tokens: u32,
    output_tokens: u32,
}

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, ACCOUNT_NAME).map_err(|e| e.to_string())
}

fn read_provider_secret() -> Result<String, String> {
    match entry()?.get_password() {
        Ok(secret) if !secret.trim().is_empty() => Ok(secret),
        Ok(_) | Err(KeyringError::NoEntry) => {
            Err("No desktop API key configured. Open Settings to save one.".into())
        }
        Err(err) => Err(err.to_string()),
    }
}

fn build_headers(
    default_headers: Option<&HashMap<String, String>>,
    auth_scheme: Option<&str>,
    api_key: &str,
) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    if let Some(extra) = default_headers {
        for (name, value) in extra {
            let header_name = HeaderName::try_from(name.as_str()).map_err(|e| e.to_string())?;
            let header_value = HeaderValue::from_str(value).map_err(|e| e.to_string())?;
            headers.insert(header_name, header_value);
        }
    }

    if let Some(scheme) = auth_scheme {
        let value =
            HeaderValue::from_str(&format!("{scheme} {api_key}")).map_err(|e| e.to_string())?;
        headers.insert(AUTHORIZATION, value);
    }

    Ok(headers)
}

fn request_timeout_ms(request: &DesktopLlmRequest) -> u64 {
    request.timeout_ms.unwrap_or(60_000)
}

fn normalize_arguments(arguments: &str) -> Value {
    serde_json::from_str::<Value>(arguments)
        .ok()
        .filter(|value| value.is_object())
        .unwrap_or_else(|| json!({}))
}

fn extract_openai_content(message: &Value) -> String {
    match message.get("content") {
        Some(Value::String(content)) => content.clone(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter_map(|block| block.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

fn map_openai_message(message: &DesktopLlmMessage) -> Value {
    if message.role == "assistant" && !message.tool_calls.is_empty() {
        return json!({
            "role": "assistant",
            "content": if message.content.is_empty() { Value::Null } else { Value::String(message.content.clone()) },
            "tool_calls": message.tool_calls.iter().map(|tool_call| {
                json!({
                    "id": tool_call.id,
                    "type": "function",
                    "function": {
                        "name": tool_call.name,
                        "arguments": tool_call.arguments.to_string(),
                    }
                })
            }).collect::<Vec<_>>()
        });
    }

    if message.role == "tool" {
        return json!({
            "role": "tool",
            "content": message.content,
            "tool_call_id": message.tool_call_id,
        });
    }

    json!({
        "role": message.role,
        "content": message.content,
    })
}

fn map_openai_tools(tools: Option<&Vec<DesktopToolDef>>) -> Option<Value> {
    tools.filter(|tools| !tools.is_empty()).map(|tools| {
        Value::Array(
            tools
                .iter()
                .map(|tool| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": tool.parameters,
                        }
                    })
                })
                .collect(),
        )
    })
}

fn map_anthropic_message(message: &DesktopLlmMessage) -> Option<Value> {
    if message.role == "system" {
        return None;
    }

    if message.role == "assistant" && !message.tool_calls.is_empty() {
        let mut content = Vec::new();
        if !message.content.is_empty() {
            content.push(json!({
                "type": "text",
                "text": message.content,
            }));
        }
        for tool_call in &message.tool_calls {
            content.push(json!({
                "type": "tool_use",
                "id": tool_call.id,
                "name": tool_call.name,
                "input": tool_call.arguments,
            }));
        }

        return Some(json!({
            "role": "assistant",
            "content": content,
        }));
    }

    if message.role == "tool" {
        return Some(json!({
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": message.tool_call_id,
                    "content": message.content,
                }
            ]
        }));
    }

    Some(json!({
        "role": message.role,
        "content": message.content,
    }))
}

fn map_anthropic_tools(tools: Option<&Vec<DesktopToolDef>>) -> Option<Value> {
    tools.filter(|tools| !tools.is_empty()).map(|tools| {
        Value::Array(
            tools
                .iter()
                .map(|tool| {
                    json!({
                        "name": tool.name,
                        "description": tool.description,
                        "input_schema": tool.parameters,
                    })
                })
                .collect(),
        )
    })
}

async fn execute_openai_chat(
    request: &ProviderChatRequest,
    api_key: &str,
) -> Result<DesktopLlmResponse, String> {
    let base_url = match request.provider.as_str() {
        "openai" => request
            .base_url
            .as_deref()
            .unwrap_or(OPENAI_BASE_URL)
            .trim_end_matches('/'),
        "openai-compat" => request
            .base_url
            .as_deref()
            .ok_or_else(|| "'openai-compat' provider requires a baseURL".to_string())?
            .trim_end_matches('/'),
        other => return Err(format!("Unsupported OpenAI provider '{other}'")),
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(request_timeout_ms(
            &request.llm_request,
        )))
        .build()
        .map_err(|e| e.to_string())?;

    let headers = build_headers(request.default_headers.as_ref(), Some("Bearer"), api_key)?;
    let mut body = json!({
        "model": request.llm_request.model,
        "messages": request
            .llm_request
            .messages
            .iter()
            .map(map_openai_message)
            .collect::<Vec<_>>(),
        "max_tokens": request.llm_request.max_tokens.unwrap_or(4096),
    });

    if let Some(temperature) = request.llm_request.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(tools) = map_openai_tools(request.llm_request.tools.as_ref()) {
        body["tools"] = tools;
    }

    let response = client
        .post(format!("{base_url}/chat/completions"))
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Provider request failed with {status}: {body}"));
    }

    let response_body = response.json::<Value>().await.map_err(|e| e.to_string())?;
    let message = response_body
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .ok_or_else(|| "Provider response did not include a message".to_string())?;

    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let function = item.get("function")?;
                    Some(DesktopToolCall {
                        id: item.get("id")?.as_str()?.to_string(),
                        name: function.get("name")?.as_str()?.to_string(),
                        arguments: function
                            .get("arguments")
                            .and_then(Value::as_str)
                            .map(normalize_arguments)
                            .unwrap_or_else(|| json!({})),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(DesktopLlmResponse {
        content: extract_openai_content(message),
        tool_calls,
        usage: DesktopLlmUsage {
            input_tokens: response_body
                .get("usage")
                .and_then(|usage| usage.get("prompt_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32,
            output_tokens: response_body
                .get("usage")
                .and_then(|usage| usage.get("completion_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32,
        },
    })
}

async fn execute_anthropic_chat(
    request: &ProviderChatRequest,
    api_key: &str,
) -> Result<DesktopLlmResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(request_timeout_ms(
            &request.llm_request,
        )))
        .build()
        .map_err(|e| e.to_string())?;

    let mut headers = build_headers(request.default_headers.as_ref(), None, api_key)?;
    headers.insert(
        HeaderName::from_static("x-api-key"),
        HeaderValue::from_str(api_key).map_err(|e| e.to_string())?,
    );
    headers.insert(
        HeaderName::from_static("anthropic-version"),
        HeaderValue::from_static("2023-06-01"),
    );

    let system = request
        .llm_request
        .messages
        .iter()
        .filter(|message| message.role == "system")
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    let mut body = json!({
        "model": request.llm_request.model,
        "messages": request
            .llm_request
            .messages
            .iter()
            .filter_map(map_anthropic_message)
            .collect::<Vec<_>>(),
        "max_tokens": request.llm_request.max_tokens.unwrap_or(4096),
    });

    if !system.is_empty() {
        body["system"] = json!(system);
    }
    if let Some(temperature) = request.llm_request.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(tools) = map_anthropic_tools(request.llm_request.tools.as_ref()) {
        body["tools"] = tools;
    }

    let response = client
        .post(ANTHROPIC_MESSAGES_URL)
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Provider request failed with {status}: {body}"));
    }

    let response_body = response.json::<Value>().await.map_err(|e| e.to_string())?;
    let mut content = String::new();
    let mut tool_calls = Vec::new();

    if let Some(blocks) = response_body.get("content").and_then(Value::as_array) {
        for block in blocks {
            match block.get("type").and_then(Value::as_str) {
                Some("text") => {
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        content.push_str(text);
                    }
                }
                Some("tool_use") => {
                    let Some(id) = block.get("id").and_then(Value::as_str) else {
                        continue;
                    };
                    let Some(name) = block.get("name").and_then(Value::as_str) else {
                        continue;
                    };
                    tool_calls.push(DesktopToolCall {
                        id: id.to_string(),
                        name: name.to_string(),
                        arguments: block
                            .get("input")
                            .cloned()
                            .filter(|value| value.is_object())
                            .unwrap_or_else(|| json!({})),
                    });
                }
                _ => {}
            }
        }
    }

    Ok(DesktopLlmResponse {
        content,
        tool_calls,
        usage: DesktopLlmUsage {
            input_tokens: response_body
                .get("usage")
                .and_then(|usage| usage.get("input_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32,
            output_tokens: response_body
                .get("usage")
                .and_then(|usage| usage.get("output_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32,
        },
    })
}

#[tauri::command]
pub fn provider_secret_status() -> Result<ProviderSecretStatus, String> {
    match entry()?.get_password() {
        Ok(secret) => Ok(ProviderSecretStatus {
            has_api_key: !secret.trim().is_empty(),
        }),
        Err(KeyringError::NoEntry) => Ok(ProviderSecretStatus { has_api_key: false }),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn provider_secret_set(api_key: String) -> Result<(), String> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err("API key cannot be empty".into());
    }
    entry()?.set_password(trimmed).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn provider_secret_clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command(async)]
pub async fn provider_chat(request: ProviderChatRequest) -> Result<DesktopLlmResponse, String> {
    if request.provider == "subscription" {
        return Err("Subscription provider does not use the desktop provider bridge".into());
    }

    let secret = read_provider_secret()?;
    match request.provider.as_str() {
        "openai" | "openai-compat" => execute_openai_chat(&request, &secret).await,
        "anthropic" => execute_anthropic_chat(&request, &secret).await,
        other => Err(format!("Unsupported provider '{other}'")),
    }
}
