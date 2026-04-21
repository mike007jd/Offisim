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
        /// Machine-readable category the TS side maps to user-visible copy:
        /// `no-credential` | `network` | `stream` | `channel` | `request`.
        code: String,
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
        .map_err(|e| FetchError::Request(format!("reqwest build: {e}")))?;

    let method_parsed = Method::from_bytes(method.as_bytes())
        .map_err(|e| FetchError::Request(format!("invalid method {method}: {e}")))?;

    let mut req_builder = client.request(method_parsed, url);
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
        .map_err(|e| FetchError::Channel(format!("send headers: {e}")))?;

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

fn read_secret() -> Result<String, FetchError> {
    match runtime_secrets::read_secret_raw().map_err(FetchError::Request)? {
        Some(secret) => Ok(secret),
        None => Err(FetchError::NoCredential),
    }
}

#[tauri::command]
pub fn llm_fetch_abort(request_id: String) -> Result<(), String> {
    if let Some(token) = pluck_token(&request_id) {
        token.cancel();
    }
    Ok(())
}
