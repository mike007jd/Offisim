//! Desktop LLM HTTP transport with credential isolation.
//!
//! Contract: the provider secret (stored plaintext in a Rust-only file under
//! `app_local_data_dir`, mode 0600 — see `runtime_secrets`) is read here
//! per-request and injected into the outbound `reqwest` call only. It MUST
//! NOT cross the Rust→webview IPC boundary. The webview sends a provider
//! profile id plus endpoint kind; Rust resolves the canonical destination and
//! auth scheme from its provider profile registry.

use futures_util::StreamExt;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::runtime_secrets;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum AuthScheme {
    Bearer,
    #[serde(rename = "x-api-key")]
    XApiKey,
    None,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum LlmEndpointKind {
    OpenAiChatCompletions,
    OpenAiResponses,
    OpenAiEmbeddings,
    OpenAiModels,
    AnthropicMessages,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmFetchRequest {
    request_id: String,
    provider_profile_id: String,
    endpoint_kind: LlmEndpointKind,
    method: String,
    headers: Vec<(String, String)>,
    #[serde(default)]
    body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TransportEvent {
    Headers {
        status: u16,
        headers: Vec<(String, String)>,
    },
    Chunk {
        bytes: Vec<u8>,
    },
    Done,
    Error {
        /// Machine-readable category the TS side maps to user-visible copy:
        /// `no-credential` | `network` | `stream` | `channel` | `request`.
        code: String,
        message: String,
    },
}

use crate::in_flight::InFlightRegistry;

static IN_FLIGHT: InFlightRegistry = InFlightRegistry::new("llm_transport");

const MAX_PROVIDER_RESPONSE_BYTES: usize = 64 * 1024 * 1024;
const MAX_PROVIDER_CHUNK_BYTES: usize = 4 * 1024 * 1024;

#[tauri::command]
pub async fn llm_fetch(
    req: LlmFetchRequest,
    on_event: Channel<TransportEvent>,
) -> Result<(), String> {
    let LlmFetchRequest {
        request_id,
        provider_profile_id,
        endpoint_kind,
        method,
        headers,
        body,
    } = req;

    let token = IN_FLIGHT.register(&request_id);

    let result = do_fetch(
        &provider_profile_id,
        &endpoint_kind,
        &method,
        headers,
        body.as_deref(),
        &on_event,
        token.clone(),
    )
    .await;

    IN_FLIGHT.clear(&request_id);

    match result {
        Ok(()) => Ok(()),
        Err(FetchError::Aborted) => {
            // Caller observed the abort via their AbortSignal; no Done /
            // Error emission and the command resolves Ok so Tauri does not
            // surface a spurious rejection.
            Ok(())
        }
        Err(err) => {
            let (code, message) = err.into_code_message();
            let _ = on_event.send(TransportEvent::Error {
                code: code.to_string(),
                message: message.clone(),
            });
            // Bubble the message up through the command return so the TS
            // `.catch` also sees something if the channel was closed first.
            Err(format!("{code}: {message}"))
        }
    }
}

#[derive(Debug)]
enum FetchError {
    Aborted,
    NoCredential,
    Network(String),
    Stream(String),
    Channel(String),
    Request(String),
}

impl FetchError {
    fn into_code_message(self) -> (&'static str, String) {
        match self {
            FetchError::Aborted => ("aborted", "Request aborted".into()),
            FetchError::NoCredential => (
                "no-credential",
                "No provider credential stored on this device.".into(),
            ),
            FetchError::Network(msg) => ("network", msg),
            FetchError::Stream(msg) => ("stream", msg),
            FetchError::Channel(msg) => ("channel", msg),
            FetchError::Request(msg) => ("request", msg),
        }
    }
}

async fn do_fetch(
    provider_profile_id: &str,
    endpoint_kind: &LlmEndpointKind,
    method: &str,
    mut headers: Vec<(String, String)>,
    body: Option<&str>,
    on_event: &Channel<TransportEvent>,
    token: CancellationToken,
) -> Result<(), FetchError> {
    // TS side may forward its own Authorization / x-api-key sentinel (e.g.
    // `Bearer ignored`). Drop any existing credential-shaped header before we
    // inject the real one from runtime_secrets (the Rust-only 0600 plaintext
    // file, NOT the OS Keychain — see runtime_secrets) — otherwise the SDK's
    // sentinel wins because reqwest keeps the first insertion.
    headers.retain(|(name, _)| {
        let lower = name.to_ascii_lowercase();
        lower != "authorization" && lower != "x-api-key"
    });

    let profile = runtime_secrets::resolve_runtime_provider_profile(provider_profile_id)
        .map_err(FetchError::Request)?;
    let url = endpoint_url(&profile.base_url, endpoint_kind)?;
    enforce_profile_destination(&url, &profile.allowed_host, profile.local_endpoint)?;
    let auth_scheme = match profile.auth_scheme.as_str() {
        "bearer" => AuthScheme::Bearer,
        "x-api-key" => AuthScheme::XApiKey,
        "none" => AuthScheme::None,
        other => {
            return Err(FetchError::Request(format!(
                "unsupported auth scheme for provider profile: {other}"
            )));
        }
    };

    match auth_scheme {
        AuthScheme::None => {}
        AuthScheme::Bearer => {
            let secret = read_secret(Some(&profile.secret_ref))?;
            headers.push(("authorization".into(), format!("Bearer {secret}")));
        }
        AuthScheme::XApiKey => {
            let secret = read_secret(Some(&profile.secret_ref))?;
            headers.push(("x-api-key".into(), secret));
        }
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| FetchError::Request(format!("reqwest build: {e}")))?;

    let method_parsed = Method::from_bytes(method.as_bytes())
        .map_err(|e| FetchError::Request(format!("invalid method {method}: {e}")))?;

    let mut req_builder = client.request(method_parsed, url.clone());
    for (name, value) in headers {
        req_builder = req_builder.header(name, value);
    }
    if let Some(b) = body {
        req_builder = req_builder.body(b.to_string());
    }

    let response = tokio::select! {
        _ = token.cancelled() => return Err(FetchError::Aborted),
        res = req_builder.send() => res.map_err(|e| FetchError::Network(format!("request send: {e}")))?,
    };

    if response.status().is_redirection() {
        if let Some(location) = response.headers().get(reqwest::header::LOCATION) {
            let location = location
                .to_str()
                .map_err(|_| FetchError::Network("redirect location was not UTF-8".into()))?;
            validate_redirect_target(&url, location, &profile.allowed_host)?;
        }
        return Err(FetchError::Network(
            "provider redirect was blocked for credential isolation".into(),
        ));
    }

    let status = response.status().as_u16();
    let headers_out: Vec<(String, String)> = response
        .headers()
        .iter()
        .filter(|(name, _)| !is_filtered_response_header(name.as_str()))
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|s| (k.as_str().to_string(), s.to_string()))
        })
        .collect();
    on_event
        .send(TransportEvent::Headers {
            status,
            headers: headers_out,
        })
        .map_err(|e| FetchError::Channel(format!("send headers: {e}")))?;

    let mut stream = response.bytes_stream();
    let mut streamed_bytes: usize = 0;
    loop {
        tokio::select! {
            _ = token.cancelled() => return Err(FetchError::Aborted),
            next = stream.next() => {
                match next {
                    None => break,
                    Some(Ok(chunk)) => {
                        streamed_bytes = checked_streamed_provider_bytes(streamed_bytes, chunk.len())?;
                        on_event
                            .send(TransportEvent::Chunk { bytes: chunk.to_vec() })
                            .map_err(|e| FetchError::Channel(format!("send chunk: {e}")))?;
                    }
                    Some(Err(e)) => return Err(FetchError::Stream(format!("stream read: {e}"))),
                }
            }
        }
    }

    on_event
        .send(TransportEvent::Done)
        .map_err(|e| FetchError::Channel(format!("send done: {e}")))?;
    Ok(())
}

fn checked_streamed_provider_bytes(
    current_bytes: usize,
    chunk_bytes: usize,
) -> Result<usize, FetchError> {
    if chunk_bytes > MAX_PROVIDER_CHUNK_BYTES {
        return Err(FetchError::Stream(format!(
            "provider response chunk exceeded {MAX_PROVIDER_CHUNK_BYTES} bytes"
        )));
    }
    let total = current_bytes
        .checked_add(chunk_bytes)
        .ok_or_else(|| FetchError::Stream("provider response byte count overflowed".to_string()))?;
    if total > MAX_PROVIDER_RESPONSE_BYTES {
        return Err(FetchError::Stream(format!(
            "provider response exceeded {MAX_PROVIDER_RESPONSE_BYTES} bytes"
        )));
    }
    Ok(total)
}

fn read_secret(secret_ref: Option<&str>) -> Result<String, FetchError> {
    match runtime_secrets::read_provider_secret(secret_ref).map_err(FetchError::Request)? {
        Some(secret) => Ok(secret),
        None => Err(FetchError::NoCredential),
    }
}

fn endpoint_url(base_url: &str, endpoint_kind: &LlmEndpointKind) -> Result<Url, FetchError> {
    let mut base = Url::parse(base_url)
        .map_err(|err| FetchError::Request(format!("invalid baseURL: {err}")))?;
    if !base.path().ends_with('/') {
        let normalized_path = format!("{}/", base.path().trim_end_matches('/'));
        base.set_path(&normalized_path);
    }
    let path = match endpoint_kind {
        LlmEndpointKind::OpenAiChatCompletions => "chat/completions",
        LlmEndpointKind::OpenAiResponses => "responses",
        LlmEndpointKind::OpenAiEmbeddings => "embeddings",
        LlmEndpointKind::OpenAiModels => "models",
        LlmEndpointKind::AnthropicMessages => "v1/messages",
    };
    base.join(path)
        .map_err(|err| FetchError::Request(format!("resolve endpoint path: {err}")))
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}

fn enforce_profile_destination(
    url: &Url,
    allowed_host: &str,
    local_endpoint: bool,
) -> Result<(), FetchError> {
    let host = url
        .host_str()
        .map(|host| host.to_ascii_lowercase())
        .ok_or_else(|| FetchError::Request("provider endpoint has no host".into()))?;
    if host != allowed_host {
        return Err(FetchError::Request(
            "provider endpoint host did not match provider profile".into(),
        ));
    }
    if url.scheme() == "https" {
        return Ok(());
    }
    if local_endpoint && url.scheme() == "http" && is_loopback_host(&host) {
        return Ok(());
    }
    Err(FetchError::Request(
        "provider endpoint must use https unless profile is explicit localhost".into(),
    ))
}

fn validate_redirect_target(
    current_url: &Url,
    location: &str,
    allowed_host: &str,
) -> Result<(), FetchError> {
    let redirected = current_url
        .join(location)
        .map_err(|err| FetchError::Network(format!("invalid redirect location: {err}")))?;
    let redirected_host = redirected
        .host_str()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if redirected_host != allowed_host {
        return Err(FetchError::Network(
            "provider redirect to a different credential host was blocked".into(),
        ));
    }
    Ok(())
}

fn is_filtered_response_header(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == "authorization"
        || lower == "proxy-authorization"
        || lower == "set-cookie"
        || lower == "cookie"
        || lower == "x-api-key"
        || lower.contains("secret")
        || lower.contains("token")
}

#[tauri::command]
pub fn llm_fetch_abort(request_id: String) -> Result<(), String> {
    if let Some(token) = IN_FLIGHT.pluck(&request_id) {
        token.cancel();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_destination_rejects_cross_host() {
        let url = Url::parse("https://evil.example/v1/chat/completions").unwrap();
        let err = enforce_profile_destination(&url, "api.openai.com", false).unwrap_err();
        assert!(matches!(err, FetchError::Request(_)));
    }

    #[test]
    fn profile_destination_rejects_plain_http_for_remote_hosts() {
        let url = Url::parse("http://api.openai.com/v1/chat/completions").unwrap();
        let err = enforce_profile_destination(&url, "api.openai.com", false).unwrap_err();
        assert!(matches!(err, FetchError::Request(_)));
    }

    #[test]
    fn profile_destination_accepts_explicit_loopback_http() {
        let url = Url::parse("http://localhost:1234/v1/chat/completions").unwrap();
        enforce_profile_destination(&url, "localhost", true).unwrap();
    }

    #[test]
    fn provider_redirect_to_cross_host_is_blocked() {
        let url = Url::parse("https://api.openai.com/v1/chat/completions").unwrap();
        let err = validate_redirect_target(&url, "https://evil.example/capture", "api.openai.com")
            .unwrap_err();
        assert!(matches!(err, FetchError::Network(_)));
    }

    #[test]
    fn filtered_headers_cover_credential_shapes() {
        assert!(is_filtered_response_header("Authorization"));
        assert!(is_filtered_response_header("Set-Cookie"));
        assert!(is_filtered_response_header("X-Api-Key"));
        assert!(is_filtered_response_header("X-Provider-Token"));
        assert!(!is_filtered_response_header("content-type"));
    }

    #[test]
    fn endpoint_kind_resolves_provider_relative_paths() {
        let url = endpoint_url(
            "https://api.openai.com/v1/",
            &LlmEndpointKind::OpenAiChatCompletions,
        )
        .unwrap();
        assert_eq!(url.as_str(), "https://api.openai.com/v1/chat/completions");
    }

    #[test]
    fn endpoint_kind_preserves_base_path_without_trailing_slash() {
        let url = endpoint_url(
            "https://api.openai.com/v1",
            &LlmEndpointKind::OpenAiChatCompletions,
        )
        .unwrap();
        assert_eq!(url.as_str(), "https://api.openai.com/v1/chat/completions");
    }

    #[test]
    fn anthropic_endpoint_resolves_v1_messages_under_provider_base() {
        let url = endpoint_url(
            "https://api.minimax.io/anthropic",
            &LlmEndpointKind::AnthropicMessages,
        )
        .unwrap();
        assert_eq!(url.as_str(), "https://api.minimax.io/anthropic/v1/messages");
    }

    #[test]
    fn provider_response_byte_counter_rejects_oversize_chunk() {
        let err = checked_streamed_provider_bytes(0, MAX_PROVIDER_CHUNK_BYTES + 1).unwrap_err();
        assert!(matches!(err, FetchError::Stream(_)));
    }

    #[test]
    fn provider_response_byte_counter_rejects_oversize_total() {
        let err = checked_streamed_provider_bytes(MAX_PROVIDER_RESPONSE_BYTES - 1, 2).unwrap_err();
        assert!(matches!(err, FetchError::Stream(_)));
    }

    #[test]
    fn provider_response_byte_counter_allows_bounded_total() {
        let total = checked_streamed_provider_bytes(1024, 2048).unwrap();
        assert_eq!(total, 3072);
    }
}
