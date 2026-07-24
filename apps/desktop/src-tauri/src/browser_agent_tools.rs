use crate::browser_session::{self, BrowserBounds, BrowserSessionScope, BrowserSessionSnapshot};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime, Webview};
use url::Url;

pub(crate) const TOOL_NAVIGATE: &str = "browser_navigate";
pub(crate) const TOOL_READ_PAGE: &str = "browser_read_page";
pub(crate) const TOOL_SCREENSHOT: &str = "browser_screenshot";
pub(crate) const TOOL_BACK: &str = "browser_back";
pub(crate) const TOOL_STATUS: &str = "browser_status";
pub(crate) const MAX_SCREENSHOT_BYTES: usize = 4 * 1024 * 1024;
const MAX_PAGE_TEXT_BYTES: usize = 256 * 1024;
const AGENT_BROWSER_X: f64 = 16_384.0;
const AGENT_BROWSER_Y: f64 = 16_384.0;
const AGENT_BROWSER_WIDTH: f64 = 1_280.0;
const AGENT_BROWSER_HEIGHT: f64 = 720.0;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentBrowserPage {
    pub url: String,
    pub title: String,
    pub text: String,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentBrowserStatus {
    pub url: String,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub loading: bool,
}

#[derive(Deserialize)]
struct EvaluatedPage {
    url: String,
    title: String,
    text: String,
}

fn agent_session_id(scope: &BrowserSessionScope) -> Result<String, String> {
    let thread_id = scope
        .thread_id
        .as_deref()
        .ok_or_else(|| "agent browser scope requires threadId".to_string())?;
    let session_id = format!("agent-{thread_id}");
    if session_id.len() > 80
        || !session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("agent browser threadId must form a URL-safe session label".to_string());
    }
    Ok(session_id)
}

fn agent_bounds() -> BrowserBounds {
    // Keep the independent agent WebView attached to the main native window
    // but outside its drawable area. It remains hidden except for the brief,
    // off-screen visibility fallback used while taking a WKWebView snapshot.
    BrowserBounds {
        x: AGENT_BROWSER_X,
        y: AGENT_BROWSER_Y,
        width: AGENT_BROWSER_WIDTH,
        height: AGENT_BROWSER_HEIGHT,
    }
}

fn host_webview<R: Runtime>(app: &AppHandle<R>) -> Result<Webview<R>, String> {
    app.get_webview(crate::MAIN_WINDOW_LABEL)
        .ok_or_else(|| "agent browser host WebView is unavailable".to_string())
}

pub(crate) async fn agent_browser_navigate<R: Runtime>(
    app: &AppHandle<R>,
    scope: BrowserSessionScope,
    url: String,
) -> Result<BrowserSessionSnapshot, String> {
    let session_id = agent_session_id(&scope)?;
    let creation = browser_session::create_agent_browser_session(
        app,
        &host_webview(app)?,
        session_id.clone(),
        scope.clone(),
        url.clone(),
        agent_bounds(),
    )
    .await?;
    if creation.created {
        browser_session::append_agent_browser_audit(
            app,
            &creation.snapshot,
            "navigate",
            Url::parse(url.trim()).ok().as_ref(),
        );
        return Ok(creation.snapshot);
    }
    browser_session::navigate_agent_browser_session(app, session_id, scope, url).await
}

pub(crate) async fn agent_browser_read_page<R: Runtime>(
    app: &AppHandle<R>,
    scope: BrowserSessionScope,
) -> Result<AgentBrowserPage, String> {
    let session_id = agent_session_id(&scope)?;
    let access = browser_session::access_agent_browser_session(app, &session_id, &scope)?;
    browser_session::append_agent_browser_audit(
        app,
        &access.snapshot,
        "read-page",
        Url::parse(&access.snapshot.url).ok().as_ref(),
    );
    let evaluated: EvaluatedPage =
        serde_json::from_str(&native_read_page(access.webview).await?)
            .map_err(|error| format!("decode browser page content: {error}"))?;
    let (text, truncated) = truncate_utf8_bytes(evaluated.text, MAX_PAGE_TEXT_BYTES);
    Ok(AgentBrowserPage {
        url: evaluated.url,
        title: evaluated.title,
        text,
        truncated,
    })
}

pub(crate) async fn agent_browser_screenshot<R: Runtime>(
    app: &AppHandle<R>,
    scope: BrowserSessionScope,
) -> Result<Vec<u8>, String> {
    let session_id = agent_session_id(&scope)?;
    let access = browser_session::access_agent_browser_session(app, &session_id, &scope)?;
    browser_session::append_agent_browser_audit(
        app,
        &access.snapshot,
        "screenshot",
        Url::parse(&access.snapshot.url).ok().as_ref(),
    );

    if access.snapshot.visible {
        return native_snapshot_png(access.webview).await;
    }

    // WKWebView does not contractually guarantee rendered pixels while hidden.
    // Agent views live off-screen, so temporarily showing the view preserves
    // user invisibility while giving takeSnapshot a renderable view hierarchy.
    // A spectator view may have moved the session on-screen before hiding it,
    // so force the bounds back to the off-screen parking spot BEFORE show();
    // otherwise this fallback would flash the page at the spectator's rect.
    browser_session::park_agent_browser_offscreen(app, &access.webview, agent_bounds()).await?;
    access
        .webview
        .show()
        .map_err(|error| format!("show agent browser for screenshot: {error}"))?;
    let capture = native_snapshot_png(access.webview.clone()).await;
    let hide = access
        .webview
        .hide()
        .map_err(|error| format!("hide agent browser after screenshot: {error}"));
    match (capture, hide) {
        (Ok(bytes), Ok(())) => Ok(bytes),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(error)) => Err(error),
        (Err(capture_error), Err(hide_error)) => {
            Err(format!("{capture_error}; additionally {hide_error}"))
        }
    }
}

pub(crate) async fn agent_browser_back<R: Runtime>(
    app: &AppHandle<R>,
    scope: BrowserSessionScope,
) -> Result<BrowserSessionSnapshot, String> {
    browser_session::back_agent_browser_session(app, agent_session_id(&scope)?, scope).await
}

pub(crate) async fn agent_browser_status<R: Runtime>(
    app: &AppHandle<R>,
    scope: BrowserSessionScope,
) -> Result<AgentBrowserStatus, String> {
    let session_id = agent_session_id(&scope)?;
    let snapshot = browser_session::inspect_agent_browser_session(app, session_id, scope).await?;
    browser_session::append_agent_browser_audit(
        app,
        &snapshot,
        "status",
        Url::parse(&snapshot.url).ok().as_ref(),
    );
    Ok(AgentBrowserStatus {
        url: snapshot.url,
        can_go_back: snapshot.can_go_back,
        can_go_forward: snapshot.can_go_forward,
        loading: snapshot.status == "loading",
    })
}

/// One browser tool result, already assembled as MCP content blocks. Both
/// lanes — the loopback MCP gateway for external CLI engines and the Pi
/// sidecar's in-process bridge — consume this single truth so the plan-mode
/// gate, argument validation, size caps, and content shape cannot drift.
#[derive(Debug)]
pub(crate) struct BrowserToolOutcome {
    /// MCP content blocks (text and/or image).
    pub content: Value,
    /// Structured payload for the gateway's `structuredContent` field; the Pi
    /// bridge ignores it because Pi consumes content blocks only.
    pub structured: Option<Value>,
}

impl BrowserToolOutcome {
    fn from_serializable<T: Serialize>(value: T) -> Result<Self, String> {
        let value = serde_json::to_value(value)
            .map_err(|error| format!("encode browser tool response: {error}"))?;
        Ok(Self {
            content: json!([{ "type": "text", "text": value.to_string() }]),
            structured: Some(value),
        })
    }

    fn from_screenshot(bytes: Vec<u8>) -> Result<Self, String> {
        if bytes.len() > MAX_SCREENSHOT_BYTES {
            return Err(format!(
                "browser_screenshot produced {} bytes, exceeding the 4 MiB MCP response limit; use browser_read_page or reduce page complexity",
                bytes.len()
            ));
        }
        Ok(Self {
            content: json!([
                {
                    "type": "text",
                    "text": format!("Captured a {} byte PNG from the Offisim browser.", bytes.len())
                },
                {
                    "type": "image",
                    "data": BASE64_STANDARD.encode(bytes),
                    "mimeType": "image/png"
                }
            ]),
            structured: None,
        })
    }
}

/// Plan mode keeps the browser observable but read-only: navigate and back
/// change remote browser state, so both lanes reject them through this gate.
pub(crate) fn authorize_browser_tool(tool: &str, plan_mode: bool) -> Result<(), String> {
    if plan_mode && matches!(tool, TOOL_NAVIGATE | TOOL_BACK) {
        return Err(format!(
            "{tool} is unavailable in plan mode because it changes remote browser state"
        ));
    }
    Ok(())
}

fn navigate_url(arguments: &Value) -> Result<String, String> {
    arguments
        .as_object()
        .and_then(|arguments| arguments.get("url"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "browser_navigate requires a non-empty url".to_string())
}

/// Single truth for Offisim browser tool execution: plan gate, url extraction,
/// the 4 MiB screenshot cap, content assembly, and the unknown-tool error all
/// live here. The MCP gateway's `call_tool` and the Pi bridge's
/// `invoke_browser_tool` are thin shells over this function.
pub(crate) async fn run_browser_tool<R: Runtime>(
    app: &AppHandle<R>,
    scope: BrowserSessionScope,
    plan_mode: bool,
    tool: &str,
    arguments: Value,
) -> Result<BrowserToolOutcome, String> {
    authorize_browser_tool(tool, plan_mode)?;
    match tool {
        TOOL_NAVIGATE => {
            let url = navigate_url(&arguments)?;
            BrowserToolOutcome::from_serializable(agent_browser_navigate(app, scope, url).await?)
        }
        TOOL_READ_PAGE => {
            BrowserToolOutcome::from_serializable(agent_browser_read_page(app, scope).await?)
        }
        TOOL_SCREENSHOT => {
            BrowserToolOutcome::from_screenshot(agent_browser_screenshot(app, scope).await?)
        }
        TOOL_BACK => BrowserToolOutcome::from_serializable(agent_browser_back(app, scope).await?),
        TOOL_STATUS => {
            BrowserToolOutcome::from_serializable(agent_browser_status(app, scope).await?)
        }
        _ => Err(format!("unknown Offisim browser tool: {tool}")),
    }
}

fn truncate_utf8_bytes(mut value: String, max_bytes: usize) -> (String, bool) {
    if value.len() <= max_bytes {
        return (value, false);
    }
    let mut boundary = max_bytes;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value.truncate(boundary);
    (value, true)
}

#[cfg(target_os = "macos")]
async fn native_read_page<R: Runtime>(webview: Webview<R>) -> Result<String, String> {
    use block2::RcBlock;
    use objc2::{runtime::AnyObject, AnyThread};
    use objc2_foundation::{
        NSError, NSJSONSerialization, NSJSONWritingOptions, NSString, NSUTF8StringEncoding,
    };
    use std::sync::Mutex;

    const SCRIPT: &str = r#"(() => ({
        url: String(window.location.href || ""),
        title: String(document.title || ""),
        text: String(document.body ? document.body.innerText : "")
    }))()"#;

    let (sender, receiver) = tokio::sync::oneshot::channel();
    webview
        .with_webview(move |platform| {
            if platform.inner().is_null() {
                let _ = sender.send(Err("native WKWebView handle is unavailable".to_string()));
                return;
            }
            let sender = Mutex::new(Some(sender));
            let handler = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
                let result = if !error.is_null() {
                    Err(format!(
                        "evaluate browser page: {}",
                        unsafe { &*error }.localizedDescription()
                    ))
                } else if value.is_null() {
                    Err("evaluate browser page returned no value".to_string())
                } else {
                    unsafe {
                        NSJSONSerialization::dataWithJSONObject_options_error(
                            &*value,
                            NSJSONWritingOptions::FragmentsAllowed,
                        )
                    }
                    .map_err(|error| {
                        format!(
                            "serialize browser page result: {}",
                            error.localizedDescription()
                        )
                    })
                    .and_then(|data| {
                        NSString::initWithData_encoding(
                            NSString::alloc(),
                            &data,
                            NSUTF8StringEncoding,
                        )
                        .map(|value| value.to_string())
                        .ok_or_else(|| "decode browser page result as UTF-8".to_string())
                    })
                };
                if let Some(sender) = sender
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .take()
                {
                    let _ = sender.send(result);
                }
            });
            // SAFETY: Tauri supplies a live WKWebView and runs this closure on
            // WebKit's main thread. WebKit copies the completion block.
            let view = unsafe { &*platform.inner().cast::<objc2_web_kit::WKWebView>() };
            unsafe {
                view.evaluateJavaScript_completionHandler(
                    &NSString::from_str(SCRIPT),
                    Some(&handler),
                );
            }
        })
        .map_err(|error| format!("access native browser page: {error}"))?;
    receiver
        .await
        .map_err(|_| "native browser page callback was dropped".to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn native_read_page<R: Runtime>(_webview: Webview<R>) -> Result<String, String> {
    Err("agent browser page reading is currently supported only on macOS".to_string())
}

#[cfg(target_os = "macos")]
async fn native_snapshot_png<R: Runtime>(webview: Webview<R>) -> Result<Vec<u8>, String> {
    use block2::RcBlock;
    use objc2::{msg_send, runtime::AnyObject, AnyThread};
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSBitmapImageRepPropertyKey, NSImage,
    };
    use objc2_foundation::{NSDictionary, NSError};
    use std::ptr::NonNull;
    use std::sync::Mutex;

    let (sender, receiver) = tokio::sync::oneshot::channel();
    webview
        .with_webview(move |platform| {
            if platform.inner().is_null() {
                let _ = sender.send(Err("native WKWebView handle is unavailable".to_string()));
                return;
            }
            let sender = Mutex::new(Some(sender));
            let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                let result = if !error.is_null() {
                    Err(format!(
                        "snapshot browser page: {}",
                        unsafe { &*error }.localizedDescription()
                    ))
                } else if image.is_null() {
                    Err("snapshot browser page returned no image".to_string())
                } else {
                    let image = unsafe { &*image };
                    image
                        .TIFFRepresentation()
                        .ok_or_else(|| "encode browser snapshot as TIFF".to_string())
                        .and_then(|tiff| {
                            NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff)
                                .ok_or_else(|| "decode browser snapshot bitmap".to_string())
                        })
                        .and_then(|bitmap| {
                            let properties =
                                NSDictionary::<NSBitmapImageRepPropertyKey, AnyObject>::new();
                            unsafe {
                                bitmap.representationUsingType_properties(
                                    NSBitmapImageFileType::PNG,
                                    &properties,
                                )
                            }
                            .ok_or_else(|| "encode browser snapshot as PNG".to_string())
                        })
                        .map(|data| {
                            let length = data.length();
                            let mut bytes = vec![0_u8; length];
                            if let Some(pointer) =
                                NonNull::new(bytes.as_mut_ptr().cast::<std::ffi::c_void>())
                            {
                                unsafe { data.getBytes_length(pointer, length) };
                            }
                            bytes
                        })
                };
                if let Some(sender) = sender
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .take()
                {
                    let _ = sender.send(result);
                }
            });
            // objc2-web-kit gates this generated method behind the optional
            // WKSnapshotConfiguration feature. The Objective-C selector is
            // available on every supported macOS, so call it directly with a
            // nil configuration (meaning the current WKWebView bounds).
            let view = unsafe { &*platform.inner().cast::<objc2_web_kit::WKWebView>() };
            let configuration: *mut AnyObject = std::ptr::null_mut();
            unsafe {
                let _: () = msg_send![
                    view,
                    takeSnapshotWithConfiguration: configuration,
                    completionHandler: &*handler
                ];
            }
        })
        .map_err(|error| format!("access native browser snapshot: {error}"))?;
    receiver
        .await
        .map_err(|_| "native browser snapshot callback was dropped".to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn native_snapshot_png<R: Runtime>(_webview: Webview<R>) -> Result<Vec<u8>, String> {
    Err("agent browser screenshots are currently supported only on macOS".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope() -> BrowserSessionScope {
        BrowserSessionScope {
            company_id: "company-1".to_string(),
            project_id: "project-1".to_string(),
            thread_id: Some("thread-1".to_string()),
        }
    }

    #[test]
    fn agent_session_id_is_stable_and_thread_scoped() {
        assert_eq!(agent_session_id(&scope()).unwrap(), "agent-thread-1");
        let mut missing = scope();
        missing.thread_id = None;
        assert_eq!(
            agent_session_id(&missing).unwrap_err(),
            "agent browser scope requires threadId"
        );
        let mut unsafe_id = scope();
        unsafe_id.thread_id = Some("../thread".to_string());
        assert!(agent_session_id(&unsafe_id).is_err());
    }

    #[test]
    fn read_page_text_is_truncated_at_256_kib_without_splitting_utf8() {
        let ascii = "a".repeat(MAX_PAGE_TEXT_BYTES + 1);
        let (ascii, truncated) = truncate_utf8_bytes(ascii, MAX_PAGE_TEXT_BYTES);
        assert!(truncated);
        assert_eq!(ascii.len(), MAX_PAGE_TEXT_BYTES);

        let unicode = format!("{}界", "a".repeat(MAX_PAGE_TEXT_BYTES - 1));
        let (unicode, truncated) = truncate_utf8_bytes(unicode, MAX_PAGE_TEXT_BYTES);
        assert!(truncated);
        assert_eq!(unicode.len(), MAX_PAGE_TEXT_BYTES - 1);
        assert!(unicode.is_char_boundary(unicode.len()));
    }

    #[test]
    fn plan_gate_is_the_single_source_for_both_lanes() {
        // The MCP gateway and the Pi bridge both authorize through this one
        // function; per-lane copies must not reappear.
        for tool in [TOOL_NAVIGATE, TOOL_BACK] {
            let error = authorize_browser_tool(tool, true).unwrap_err();
            assert_eq!(
                error,
                format!("{tool} is unavailable in plan mode because it changes remote browser state")
            );
            assert!(authorize_browser_tool(tool, false).is_ok());
        }
        for tool in [TOOL_READ_PAGE, TOOL_SCREENSHOT, TOOL_STATUS] {
            assert!(authorize_browser_tool(tool, true).is_ok());
        }
    }

    #[test]
    fn navigate_url_requires_a_non_empty_url() {
        assert_eq!(
            navigate_url(&json!({ "url": " https://example.com " })).unwrap(),
            "https://example.com"
        );
        for arguments in [
            json!({}),
            json!({ "url": "" }),
            json!({ "url": "   " }),
            json!({ "url": 42 }),
            json!(["https://example.com"]),
        ] {
            assert_eq!(
                navigate_url(&arguments).unwrap_err(),
                "browser_navigate requires a non-empty url"
            );
        }
    }

    #[test]
    fn screenshot_cap_and_content_assembly_are_the_single_source_for_both_lanes() {
        assert_eq!(MAX_SCREENSHOT_BYTES, 4 * 1024 * 1024);
        let png = vec![1_u8; 8];
        let outcome = BrowserToolOutcome::from_screenshot(png.clone()).unwrap();
        assert_eq!(outcome.structured, None);
        let content = outcome.content.as_array().unwrap();
        assert_eq!(content.len(), 2);
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[0]["text"], "Captured a 8 byte PNG from the Offisim browser.");
        assert_eq!(content[1]["type"], "image");
        assert_eq!(content[1]["mimeType"], "image/png");
        assert_eq!(content[1]["data"], BASE64_STANDARD.encode(png));

        let oversized = vec![0_u8; MAX_SCREENSHOT_BYTES + 1];
        let error = BrowserToolOutcome::from_screenshot(oversized).unwrap_err();
        assert!(error.contains("exceeding the 4 MiB MCP response limit"));
    }

    #[test]
    fn text_outcome_wraps_the_structured_value_as_mcp_content() {
        let outcome = BrowserToolOutcome::from_serializable(AgentBrowserStatus {
            url: "https://example.com".to_string(),
            can_go_back: true,
            can_go_forward: false,
            loading: false,
        })
        .unwrap();
        let structured = outcome.structured.unwrap();
        assert_eq!(structured["url"], "https://example.com");
        let content = outcome.content.as_array().unwrap();
        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[0]["text"], structured.to_string());
    }
}
