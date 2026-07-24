use std::convert::Infallible;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use base64::{
    engine::general_purpose::{STANDARD as BASE64_STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use http_body_util::{BodyExt as _, Full};
use hyper::body::{Bytes, Incoming};
use hyper::header::{AUTHORIZATION, CONTENT_LENGTH, CONTENT_TYPE, WWW_AUTHENTICATE};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use rand::{rngs::OsRng, RngCore};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Runtime};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::browser_agent_tools;
use crate::browser_session::BrowserSessionScope;

pub(crate) const BROWSER_MCP_TOKEN_ENV: &str = "OFFISIM_BROWSER_MCP_TOKEN";
pub(crate) const BROWSER_MCP_URL_ENV: &str = "OFFISIM_BROWSER_MCP_URL";

const MCP_PATH: &str = "/mcp";
const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_SCREENSHOT_BYTES: usize = 4 * 1024 * 1024;

const TOOL_NAVIGATE: &str = "browser_navigate";
const TOOL_READ_PAGE: &str = "browser_read_page";
const TOOL_SCREENSHOT: &str = "browser_screenshot";
const TOOL_BACK: &str = "browser_back";
const TOOL_STATUS: &str = "browser_status";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct BrowserAgentRunScope {
    company_id: String,
    project_id: String,
    thread_id: String,
    plan_mode: bool,
}

impl BrowserAgentRunScope {
    pub(crate) fn new(
        company_id: impl Into<String>,
        project_id: impl Into<String>,
        thread_id: impl Into<String>,
        permission_mode: Option<&str>,
    ) -> Result<Self, String> {
        let scope = Self {
            company_id: company_id.into(),
            project_id: project_id.into(),
            thread_id: thread_id.into(),
            plan_mode: permission_mode == Some("plan"),
        };
        if [&scope.company_id, &scope.project_id, &scope.thread_id]
            .iter()
            .any(|value| value.trim().is_empty())
        {
            return Err("browser agent gateway requires companyId, projectId, and threadId".into());
        }
        Ok(scope)
    }

    fn browser_scope(&self) -> BrowserSessionScope {
        BrowserSessionScope {
            company_id: self.company_id.clone(),
            project_id: self.project_id.clone(),
            thread_id: Some(self.thread_id.clone()),
        }
    }

    fn authorize_tool(&self, tool: &str) -> Result<(), String> {
        if self.plan_mode && matches!(tool, TOOL_NAVIGATE | TOOL_BACK) {
            return Err(format!(
                "{tool} is unavailable in plan mode because it changes remote browser state"
            ));
        }
        Ok(())
    }
}

#[derive(Clone)]
pub(crate) struct BrowserAgentGatewayConfig {
    url: String,
    token: String,
}

impl BrowserAgentGatewayConfig {
    pub(crate) fn url(&self) -> &str {
        &self.url
    }

    pub(crate) fn token(&self) -> &str {
        &self.token
    }

    pub(crate) fn codex_config_override(&self) -> String {
        format!(
            "mcp_servers.offisim_browser={{url=\"{}\",bearer_token_env_var=\"{}\",required=true,default_tools_approval_mode=\"approve\"}}",
            self.url, BROWSER_MCP_TOKEN_ENV
        )
    }
}

struct GatewayAuthority {
    token_digest: [u8; 32],
    active: AtomicBool,
    scope: BrowserAgentRunScope,
    session_id: String,
}

impl GatewayAuthority {
    fn new(token: &str, scope: BrowserAgentRunScope, session_id: String) -> Self {
        Self {
            token_digest: token_digest(token),
            active: AtomicBool::new(true),
            scope,
            session_id,
        }
    }

    fn authenticate(&self, authorization: Option<&str>) -> bool {
        if !self.active.load(Ordering::Acquire) {
            return false;
        }
        let Some(token) = authorization.and_then(|value| value.strip_prefix("Bearer ")) else {
            return false;
        };
        !token.is_empty() && token_digest(token) == self.token_digest
    }

    fn revoke(&self) {
        self.active.store(false, Ordering::Release);
    }
}

pub(crate) struct BrowserAgentGateway {
    config: BrowserAgentGatewayConfig,
    authority: Arc<GatewayAuthority>,
    cancellation: CancellationToken,
    task: Option<JoinHandle<()>>,
}

impl BrowserAgentGateway {
    pub(crate) async fn start<R: Runtime>(
        app: AppHandle<R>,
        scope: BrowserAgentRunScope,
    ) -> Result<Self, String> {
        let listener = bind_loopback().await?;
        let address = listener
            .local_addr()
            .map_err(|error| format!("inspect browser MCP listener: {error}"))?;
        if !address.ip().is_loopback() {
            return Err("browser MCP gateway refused a non-loopback listener".into());
        }

        let token = random_secret();
        let session_id = random_secret();
        let authority = Arc::new(GatewayAuthority::new(&token, scope, session_id));
        let cancellation = CancellationToken::new();
        let task = tokio::spawn(serve(
            listener,
            app,
            Arc::clone(&authority),
            cancellation.clone(),
        ));
        Ok(Self {
            config: BrowserAgentGatewayConfig {
                url: format!("http://127.0.0.1:{}/mcp", address.port()),
                token,
            },
            authority,
            cancellation,
            task: Some(task),
        })
    }

    pub(crate) fn config(&self) -> &BrowserAgentGatewayConfig {
        &self.config
    }

    pub(crate) async fn shutdown(&mut self) {
        self.authority.revoke();
        self.cancellation.cancel();
        if let Some(task) = self.task.take() {
            let _ = task.await;
        }
    }
}

impl Drop for BrowserAgentGateway {
    fn drop(&mut self) {
        self.authority.revoke();
        self.cancellation.cancel();
    }
}

fn random_secret() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn token_digest(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

async fn bind_loopback() -> Result<TcpListener, String> {
    TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
        .await
        .map_err(|error| format!("bind browser MCP gateway: {error}"))
}

async fn serve<R: Runtime>(
    listener: TcpListener,
    app: AppHandle<R>,
    authority: Arc<GatewayAuthority>,
    cancellation: CancellationToken,
) {
    loop {
        let accepted = tokio::select! {
            () = cancellation.cancelled() => break,
            accepted = listener.accept() => accepted,
        };
        let Ok((stream, peer)) = accepted else {
            break;
        };
        if !peer.ip().is_loopback() {
            continue;
        }
        let app = app.clone();
        let authority = Arc::clone(&authority);
        tokio::spawn(async move {
            let service = service_fn(move |request| {
                let app = app.clone();
                let authority = Arc::clone(&authority);
                async move { Ok::<_, Infallible>(handle_http_request(request, app, authority).await) }
            });
            let _ = http1::Builder::new()
                .serve_connection(TokioIo::new(stream), service)
                .await;
        });
    }
}

async fn handle_http_request<R: Runtime>(
    request: Request<Incoming>,
    app: AppHandle<R>,
    authority: Arc<GatewayAuthority>,
) -> Response<Full<Bytes>> {
    if request.uri().path() != MCP_PATH {
        return plain_response(StatusCode::NOT_FOUND, "not found");
    }
    let authorization = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    if !authority.authenticate(authorization) {
        return Response::builder()
            .status(StatusCode::UNAUTHORIZED)
            .header(WWW_AUTHENTICATE, "Bearer")
            .header(CONTENT_TYPE, "application/json")
            .body(Full::new(Bytes::from_static(
                b"{\"error\":\"unauthorized\"}",
            )))
            .expect("static unauthorized response");
    }

    match *request.method() {
        Method::GET => plain_response(
            StatusCode::METHOD_NOT_ALLOWED,
            "This MCP gateway does not expose a server-to-client SSE stream.",
        ),
        Method::DELETE => empty_response(StatusCode::OK),
        Method::POST => {
            if request
                .headers()
                .get(CONTENT_LENGTH)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<usize>().ok())
                .is_some_and(|length| length > MAX_REQUEST_BYTES)
            {
                return plain_response(StatusCode::PAYLOAD_TOO_LARGE, "request body too large");
            }
            let body = match read_limited_body(request.into_body()).await {
                Ok(body) => body,
                Err(response) => return response,
            };
            handle_json_rpc(&app, &authority, &body).await
        }
        _ => plain_response(StatusCode::METHOD_NOT_ALLOWED, "method not allowed"),
    }
}

async fn read_limited_body(mut body: Incoming) -> Result<Vec<u8>, Response<Full<Bytes>>> {
    let mut bytes = Vec::new();
    while let Some(frame) = body.frame().await {
        let frame =
            frame.map_err(|_| plain_response(StatusCode::BAD_REQUEST, "invalid request body"))?;
        let Ok(data) = frame.into_data() else {
            continue;
        };
        if bytes.len().saturating_add(data.len()) > MAX_REQUEST_BYTES {
            return Err(plain_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "request body too large",
            ));
        }
        bytes.extend_from_slice(&data);
    }
    Ok(bytes)
}

async fn handle_json_rpc<R: Runtime>(
    app: &AppHandle<R>,
    authority: &GatewayAuthority,
    body: &[u8],
) -> Response<Full<Bytes>> {
    let message: Value = match serde_json::from_slice(body) {
        Ok(Value::Object(message)) => Value::Object(message),
        Ok(_) => return rpc_error_response(Value::Null, -32600, "Invalid Request"),
        Err(_) => return rpc_error_response(Value::Null, -32700, "Parse error"),
    };
    let object = message.as_object().expect("checked JSON object");
    let id = object.get("id").cloned();
    let method = object.get("method").and_then(Value::as_str);
    if id.is_none() {
        return empty_response(StatusCode::ACCEPTED);
    }
    let id = id.unwrap_or(Value::Null);
    match method {
        Some("initialize") => {
            let protocol_version = object
                .get("params")
                .and_then(Value::as_object)
                .and_then(|params| params.get("protocolVersion"))
                .and_then(Value::as_str)
                .unwrap_or("2025-06-18");
            rpc_result_response(
                id,
                json!({
                    "protocolVersion": protocol_version,
                    "capabilities": { "tools": {} },
                    "serverInfo": {
                        "name": "offisim-browser",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "instructions": "Use the Offisim browser tools for web navigation and page inspection. After browser_navigate, poll browser_status until loading is false before browser_read_page or browser_screenshot.",
                }),
                Some(&authority.session_id),
            )
        }
        Some("ping") => rpc_result_response(id, json!({}), None),
        Some("tools/list") => rpc_result_response(id, json!({ "tools": tool_definitions() }), None),
        Some("tools/call") => {
            let params = object.get("params").and_then(Value::as_object);
            let name = params
                .and_then(|params| params.get("name"))
                .and_then(Value::as_str);
            let arguments = params
                .and_then(|params| params.get("arguments"))
                .cloned()
                .unwrap_or_else(|| json!({}));
            let Some(name) = name else {
                return rpc_error_response(id, -32602, "tools/call requires a tool name");
            };
            let result = call_tool(app, &authority.scope, name, arguments).await;
            rpc_result_response(id, result, None)
        }
        Some(_) => rpc_error_response(id, -32601, "Method not found"),
        None => rpc_error_response(id, -32600, "Invalid Request"),
    }
}

fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": TOOL_NAVIGATE,
            "title": "Navigate Offisim browser",
            "description": "Open an absolute http/https URL in this conversation's private incognito Offisim browser. This changes remote browser state. Poll browser_status until loading is false before reading the page.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Absolute http:// or https:// URL to open."
                    }
                },
                "required": ["url"],
                "additionalProperties": false
            },
            "annotations": {
                "readOnlyHint": false,
                "destructiveHint": false,
                "idempotentHint": false,
                "openWorldHint": true
            }
        }),
        json!({
            "name": TOOL_READ_PAGE,
            "title": "Read Offisim browser page",
            "description": "Read the current page URL, title, and visible body text from this conversation's Offisim browser. Text is capped at 256 KiB and reports whether it was truncated.",
            "inputSchema": empty_object_schema(),
            "annotations": {
                "readOnlyHint": true,
                "destructiveHint": false,
                "idempotentHint": true,
                "openWorldHint": true
            }
        }),
        json!({
            "name": TOOL_SCREENSHOT,
            "title": "Capture Offisim browser screenshot",
            "description": "Capture the current page as a PNG image from this conversation's Offisim browser. The gateway rejects captures larger than 4 MiB with a clear error.",
            "inputSchema": empty_object_schema(),
            "annotations": {
                "readOnlyHint": true,
                "destructiveHint": false,
                "idempotentHint": true,
                "openWorldHint": true
            }
        }),
        json!({
            "name": TOOL_BACK,
            "title": "Go back in Offisim browser",
            "description": "Go back once in this conversation's Offisim browser history. This changes remote browser state and is unavailable in plan mode.",
            "inputSchema": empty_object_schema(),
            "annotations": {
                "readOnlyHint": false,
                "destructiveHint": false,
                "idempotentHint": false,
                "openWorldHint": true
            }
        }),
        json!({
            "name": TOOL_STATUS,
            "title": "Inspect Offisim browser status",
            "description": "Return the current URL, loading state, and back/forward availability for this conversation's Offisim browser. Poll until loading is false after navigation.",
            "inputSchema": empty_object_schema(),
            "annotations": {
                "readOnlyHint": true,
                "destructiveHint": false,
                "idempotentHint": true,
                "openWorldHint": true
            }
        }),
    ]
}

fn empty_object_schema() -> Value {
    json!({
        "type": "object",
        "properties": {},
        "additionalProperties": false
    })
}

async fn call_tool<R: Runtime>(
    app: &AppHandle<R>,
    scope: &BrowserAgentRunScope,
    name: &str,
    arguments: Value,
) -> Value {
    if let Err(error) = scope.authorize_tool(name) {
        return tool_error(error);
    }
    let browser_scope = scope.browser_scope();
    let outcome: Result<Value, String> = match name {
        TOOL_NAVIGATE => {
            let url = arguments
                .as_object()
                .and_then(|arguments| arguments.get("url"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "browser_navigate requires a non-empty url".to_string());
            match url {
                Ok(url) => {
                    browser_agent_tools::agent_browser_navigate(app, browser_scope, url.to_string())
                        .await
                        .and_then(to_json_value)
                }
                Err(error) => Err(error),
            }
        }
        TOOL_READ_PAGE => browser_agent_tools::agent_browser_read_page(app, browser_scope)
            .await
            .and_then(to_json_value),
        TOOL_SCREENSHOT => {
            match browser_agent_tools::agent_browser_screenshot(app, browser_scope).await {
                Ok(bytes) if bytes.len() <= MAX_SCREENSHOT_BYTES => {
                    return json!({
                        "content": [
                            {
                                "type": "text",
                                "text": format!("Captured a {} byte PNG from the Offisim browser.", bytes.len())
                            },
                            {
                                "type": "image",
                                "data": BASE64_STANDARD.encode(bytes),
                                "mimeType": "image/png"
                            }
                        ],
                        "isError": false
                    });
                }
                Ok(bytes) => Err(format!(
                    "browser_screenshot produced {} bytes, exceeding the 4 MiB MCP response limit; use browser_read_page or reduce page complexity",
                    bytes.len()
                )),
                Err(error) => Err(error),
            }
        }
        TOOL_BACK => browser_agent_tools::agent_browser_back(app, browser_scope)
            .await
            .and_then(to_json_value),
        TOOL_STATUS => browser_agent_tools::agent_browser_status(app, browser_scope)
            .await
            .and_then(to_json_value),
        _ => Err(format!("unknown Offisim browser tool: {name}")),
    };
    match outcome {
        Ok(value) => json!({
            "content": [{ "type": "text", "text": value.to_string() }],
            "structuredContent": value,
            "isError": false
        }),
        Err(error) => tool_error(error),
    }
}

fn to_json_value<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| format!("encode browser tool response: {error}"))
}

fn tool_error(message: impl Into<String>) -> Value {
    json!({
        "content": [{ "type": "text", "text": message.into() }],
        "isError": true
    })
}

fn rpc_result_response(
    id: Value,
    result: Value,
    session_id: Option<&str>,
) -> Response<Full<Bytes>> {
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, "application/json");
    if let Some(session_id) = session_id {
        builder = builder.header("mcp-session-id", session_id);
    }
    builder
        .body(Full::new(Bytes::from(
            json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string(),
        )))
        .expect("static MCP result response")
}

fn rpc_error_response(id: Value, code: i64, message: &str) -> Response<Full<Bytes>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, "application/json")
        .body(Full::new(Bytes::from(
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": code, "message": message }
            })
            .to_string(),
        )))
        .expect("static MCP error response")
}

fn plain_response(status: StatusCode, message: &str) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Full::new(Bytes::copy_from_slice(message.as_bytes())))
        .expect("static plain response")
}

fn empty_response(status: StatusCode) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .body(Full::new(Bytes::new()))
        .expect("static empty response")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(permission_mode: Option<&str>) -> BrowserAgentRunScope {
        BrowserAgentRunScope::new("company-1", "project-1", "thread-1", permission_mode).unwrap()
    }

    #[test]
    fn token_authentication_rejects_wrong_missing_and_revoked_tokens() {
        let authority =
            GatewayAuthority::new("correct-token", scope(Some("auto")), "session-1".into());
        assert!(authority.authenticate(Some("Bearer correct-token")));
        assert!(!authority.authenticate(Some("Bearer wrong-token")));
        assert!(!authority.authenticate(None));
        authority.revoke();
        assert!(!authority.authenticate(Some("Bearer correct-token")));
    }

    #[test]
    fn plan_mode_blocks_remote_state_mutations_but_allows_observation() {
        let plan = scope(Some("plan"));
        assert!(plan.authorize_tool(TOOL_NAVIGATE).is_err());
        assert!(plan.authorize_tool(TOOL_BACK).is_err());
        assert!(plan.authorize_tool(TOOL_READ_PAGE).is_ok());
        assert!(plan.authorize_tool(TOOL_SCREENSHOT).is_ok());
        assert!(plan.authorize_tool(TOOL_STATUS).is_ok());
        assert!(scope(Some("auto")).authorize_tool(TOOL_NAVIGATE).is_ok());
    }

    #[tokio::test]
    async fn listener_uses_an_ephemeral_loopback_port_only() {
        let listener = bind_loopback().await.unwrap();
        let address = listener.local_addr().unwrap();
        assert!(address.ip().is_loopback());
        assert_ne!(address.port(), 0);
    }

    #[test]
    fn run_end_revokes_the_token_authority() {
        let authority = GatewayAuthority::new("run-token", scope(Some("full")), "session-1".into());
        assert!(authority.authenticate(Some("Bearer run-token")));
        authority.revoke();
        assert!(!authority.active.load(Ordering::Acquire));
        assert!(!authority.authenticate(Some("Bearer run-token")));
    }

    #[test]
    fn codex_override_references_the_token_environment_without_exposing_the_secret() {
        let config = BrowserAgentGatewayConfig {
            url: "http://127.0.0.1:49152/mcp".into(),
            token: "must-not-enter-codex-argv".into(),
        };
        let override_value = config.codex_config_override();
        assert_eq!(
            override_value,
            "mcp_servers.offisim_browser={url=\"http://127.0.0.1:49152/mcp\",bearer_token_env_var=\"OFFISIM_BROWSER_MCP_TOKEN\",required=true,default_tools_approval_mode=\"approve\"}"
        );
        assert!(!override_value.contains(config.token()));
    }
}
