//! Desktop LLM HTTP transport with credential isolation.
//!
//! Contract: the provider secret (stored plaintext in a Rust-only file under
//! `app_local_data_dir`, mode 0600 — see `runtime_secrets`) is read here
//! per-request and injected into the outbound `reqwest` call only. It MUST
//! NOT cross the Rust→webview IPC boundary. The webview sends an
//! `auth: { scheme, headerName? }` discriminator that names _how_ to inject
//! the credential, never the credential bytes themselves. See
//! `openspec/specs/desktop-llm-credential-isolation/spec.md`.

use std::collections::HashMap;
use std::sync::Mutex;

use futures_util::StreamExt;
use once_cell::sync::Lazy;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

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
#[serde(rename_all = "camelCase")]
struct AuthInject {
    scheme: AuthScheme,
    #[serde(default)]
    header_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmFetchRequest {
    request_id: String,
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    #[serde(default)]
    body: Option<String>,
    auth: AuthInject,
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
        message: String,
    },
}

static IN_FLIGHT: Lazy<Mutex<HashMap<String, CancellationToken>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn register_token(id: &str) -> CancellationToken {
    let token = CancellationToken::new();
    IN_FLIGHT
        .lock()
        .expect("llm_transport in_flight poisoned")
        .insert(id.to_string(), token.clone());
    token
}

fn clear_token(id: &str) {
    IN_FLIGHT
        .lock()
        .expect("llm_transport in_flight poisoned")
        .remove(id);
}

fn pluck_token(id: &str) -> Option<CancellationToken> {
    IN_FLIGHT
        .lock()
        .expect("llm_transport in_flight poisoned")
        .remove(id)
}

#[tauri::command]
pub async fn llm_fetch(
    req: LlmFetchRequest,
    on_event: Channel<TransportEvent>,
) -> Result<(), String> {
    let LlmFetchRequest {
        request_id,
        url,
        method,
        headers,
        body,
        auth,
    } = req;

    let token = register_token(&request_id);

    let result = do_fetch(
        &url,
        &method,
        headers,
        body.as_deref(),
        &auth,
        &on_event,
        token.clone(),
    )
    .await;

    clear_token(&request_id);

    match result {
        Ok(()) => Ok(()),
        Err(FetchError::Aborted) => {
            // Caller observed the abort via their AbortSignal; no Done /
            // Error emission and the command resolves Ok so Tauri does not
            // surface a spurious rejection.
            Ok(())
        }
        Err(FetchError::Io(msg)) => {
            let _ = on_event.send(TransportEvent::Error {
                message: msg.clone(),
            });
            Err(msg)
        }
    }
}

enum FetchError {
    Aborted,
    Io(String),
}

impl From<String> for FetchError {
    fn from(s: String) -> Self {
        FetchError::Io(s)
    }
}

async fn do_fetch(
    url: &str,
    method: &str,
    mut headers: Vec<(String, String)>,
    body: Option<&str>,
    auth: &AuthInject,
    on_event: &Channel<TransportEvent>,
    token: CancellationToken,
) -> Result<(), FetchError> {
    // TS side may forward its own Authorization / x-api-key sentinel (e.g.
    // `Bearer ignored`). Drop any existing credential-shaped header before we
    // inject the real one from Keychain — otherwise the SDK's sentinel wins
    // because reqwest keeps the first insertion.
    headers.retain(|(name, _)| {
        let lower = name.to_ascii_lowercase();
        lower != "authorization" && lower != "x-api-key"
    });

    match auth.scheme {
        AuthScheme::None => {}
        AuthScheme::Bearer => {
            let secret = read_secret()?;
            headers.push(("authorization".into(), format!("Bearer {secret}")));
        }
        AuthScheme::XApiKey => {
            let secret = read_secret()?;
            let name = auth
                .header_name
                .clone()
                .unwrap_or_else(|| "x-api-key".into());
            headers.push((name, secret));
        }
    }

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("reqwest build: {e}"))?;

    let method_parsed = Method::from_bytes(method.as_bytes())
        .map_err(|e| format!("invalid method {method}: {e}"))?;

    let mut req_builder = client.request(method_parsed, url);
    for (name, value) in headers {
        req_builder = req_builder.header(name, value);
    }
    if let Some(b) = body {
        req_builder = req_builder.body(b.to_string());
    }

    let response = tokio::select! {
        _ = token.cancelled() => return Err(FetchError::Aborted),
        res = req_builder.send() => res.map_err(|e| format!("request send: {e}"))?,
    };

    let status = response.status().as_u16();
    let headers_out: Vec<(String, String)> = response
        .headers()
        .iter()
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
        .map_err(|e| format!("channel send headers: {e}"))?;

    let mut stream = response.bytes_stream();
    loop {
        tokio::select! {
            _ = token.cancelled() => return Err(FetchError::Aborted),
            next = stream.next() => {
                match next {
                    None => break,
                    Some(Ok(chunk)) => {
                        on_event
                            .send(TransportEvent::Chunk { bytes: chunk.to_vec() })
                            .map_err(|e| format!("channel send chunk: {e}"))?;
                    }
                    Some(Err(e)) => return Err(FetchError::Io(format!("stream read: {e}"))),
                }
            }
        }
    }

    on_event
        .send(TransportEvent::Done)
        .map_err(|e| format!("channel send done: {e}"))?;
    Ok(())
}

fn read_secret() -> Result<String, String> {
    match runtime_secrets::read_secret_raw()? {
        Some(secret) => Ok(secret),
        None => Err("no-credential".into()),
    }
}

#[tauri::command]
pub fn llm_fetch_abort(request_id: String) -> Result<(), String> {
    if let Some(token) = pluck_token(&request_id) {
        token.cancel();
    }
    Ok(())
}
