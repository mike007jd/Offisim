//! Deep link handler for `offisim://install?listing_id=X&version=Y` URLs.
//!
//! Parses incoming deep link URLs and emits a Tauri event to the webview
//! so the frontend can trigger the install review flow.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

const MAIN_WINDOW_LABEL: &str = "main";
const MAIN_WINDOW_FALLBACK_LABEL: &str = "main-live";

/// Payload emitted to the webview when a valid install deep link is received.
#[derive(Debug, Clone, Serialize)]
pub struct DeepLinkInstallPayload {
    pub listing_id: String,
    pub version: String,
}

/// Parse an `offisim://install?listing_id=X&version=Y` URL.
///
/// Returns `Some(payload)` if the URL is a valid install deep link,
/// `None` otherwise (e.g. unknown host, missing params).
fn parse_install_url(raw: &str) -> Option<DeepLinkInstallPayload> {
    let url = Url::parse(raw).ok()?;

    // Expect scheme "offisim" and host "install"
    // offisim://install?... parses as scheme=offisim, host=install
    if url.scheme() != "offisim" {
        return None;
    }

    let host = url.host_str()?;
    if host != "install" {
        return None;
    }

    let mut listing_id: Option<String> = None;
    let mut version: Option<String> = None;

    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "listing_id" => listing_id = Some(value.into_owned()),
            "version" => version = Some(value.into_owned()),
            _ => {}
        }
    }

    Some(DeepLinkInstallPayload {
        listing_id: listing_id?,
        version: version?,
    })
}

/// Handle a list of deep link URLs received by the app.
///
/// For each valid `offisim://install` URL, emits a `deep-link-install` event
/// to all webview windows.
pub fn handle_deep_link_urls(app: &AppHandle, urls: Vec<url::Url>) {
    for url in urls {
        let raw = url.as_str();
        if let Some(payload) = parse_install_url(raw) {
            // E/I6: address the deep-link payload at the primary install
            // window only, not every webview. `app.emit` broadcasts to all
            // windows, which means a child preview or hidden popup that
            // happens to be alive would also see the install intent. Target
            // `main`; fall back to `main-live` for the live-rebuild webview
            // so dev still receives the event.
            let target = app
                .get_webview_window(MAIN_WINDOW_LABEL)
                .or_else(|| app.get_webview_window(MAIN_WINDOW_FALLBACK_LABEL));
            let emit_result = match &target {
                Some(window) => window.emit("deep-link-install", &payload),
                None => app.emit("deep-link-install", &payload),
            };
            if let Err(e) = emit_result {
                eprintln!("[deep_link] Failed to emit install event: {e}");
            }
        } else {
            eprintln!("[deep_link] Ignoring unrecognized deep link: {raw}");
        }
    }
}
