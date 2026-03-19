//! Deep link handler for `offisim://install?listing_id=X&version=Y` URLs.
//!
//! Parses incoming deep link URLs and emits a Tauri event to the webview
//! so the frontend can trigger the install review flow.

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use url::Url;

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
            if let Err(e) = app.emit("deep-link-install", &payload) {
                eprintln!("[deep_link] Failed to emit install event: {e}");
            }
        } else {
            eprintln!("[deep_link] Ignoring unrecognized deep link: {raw}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_install_url() {
        let payload =
            parse_install_url("offisim://install?listing_id=abc-123&version=1.2.0").unwrap();
        assert_eq!(payload.listing_id, "abc-123");
        assert_eq!(payload.version, "1.2.0");
    }

    #[test]
    fn parses_encoded_version() {
        let payload =
            parse_install_url("offisim://install?listing_id=x&version=1.0.0-beta%2B1").unwrap();
        assert_eq!(payload.version, "1.0.0-beta+1");
    }

    #[test]
    fn rejects_wrong_scheme() {
        assert!(parse_install_url("https://install?listing_id=x&version=1").is_none());
    }

    #[test]
    fn rejects_wrong_host() {
        assert!(parse_install_url("offisim://update?listing_id=x&version=1").is_none());
    }

    #[test]
    fn rejects_missing_listing_id() {
        assert!(parse_install_url("offisim://install?version=1").is_none());
    }

    #[test]
    fn rejects_missing_version() {
        assert!(parse_install_url("offisim://install?listing_id=x").is_none());
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse_install_url("not a url at all").is_none());
    }
}
