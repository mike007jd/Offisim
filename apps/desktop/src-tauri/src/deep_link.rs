//! Deep link handler for `offisim://install?listing_id=X&version=Y` URLs.
//!
//! Parses incoming deep link URLs and emits a Tauri event to the webview
//! so the frontend can trigger the install review flow.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use url::Url;

const MAIN_WINDOW_LABEL: &str = "main";
const MAX_PENDING_INSTALLS: usize = 16;

/// Payload emitted to the webview when a valid install deep link is received.
#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
pub struct DeepLinkInstallPayload {
    pub listing_id: String,
    pub version: String,
}

#[derive(Default)]
struct DeepLinkStateInner {
    renderer_ready: bool,
    pending: Vec<DeepLinkInstallPayload>,
}

/// Handshake state that closes the cold-start race between the OS delivering
/// a URL and the renderer attaching its Tauri event listener.
#[derive(Default)]
pub struct DeepLinkState {
    inner: Mutex<DeepLinkStateInner>,
}

impl DeepLinkState {
    fn queue_until_renderer_ready(&self, payload: DeepLinkInstallPayload) -> Result<bool, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "deep-link state lock is poisoned".to_string())?;
        if inner.renderer_ready {
            return Ok(false);
        }
        if inner.pending.iter().any(|pending| pending == &payload) {
            return Ok(true);
        }
        if inner.pending.len() >= MAX_PENDING_INSTALLS {
            eprintln!("[deep_link] Pending install queue is full; ignoring newest intent");
            return Ok(true);
        }
        inner.pending.push(payload);
        Ok(true)
    }

    fn requeue_after_emit_failure(&self, payload: DeepLinkInstallPayload) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.renderer_ready = false;
            if !inner.pending.iter().any(|pending| pending == &payload)
                && inner.pending.len() < MAX_PENDING_INSTALLS
            {
                inner.pending.push(payload);
            }
        }
    }

    fn mark_renderer_ready(&self) -> Result<Vec<DeepLinkInstallPayload>, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "deep-link state lock is poisoned".to_string())?;
        inner.renderer_ready = true;
        Ok(std::mem::take(&mut inner.pending))
    }

    fn mark_renderer_not_ready(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.renderer_ready = false;
        }
    }
}

fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
}

/// Parse an `offisim://install?listing_id=X&version=Y` URL.
///
/// Returns `Some(payload)` if the URL is a valid install deep link,
/// `None` otherwise (e.g. unknown host, missing params).
fn parse_install_url(raw: &str) -> Option<DeepLinkInstallPayload> {
    if raw.len() > 512 {
        return None;
    }
    let url = Url::parse(raw).ok()?;

    // Expect scheme "offisim" and host "install"
    // offisim://install?... parses as scheme=offisim, host=install
    if url.scheme() != "offisim" {
        return None;
    }

    let host = url.host_str()?;
    if host != "install"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !matches!(url.path(), "" | "/")
        || url.fragment().is_some()
    {
        return None;
    }

    let mut listing_id: Option<String> = None;
    let mut version: Option<String> = None;

    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "listing_id" if listing_id.is_none() => listing_id = Some(value.into_owned()),
            "version" if version.is_none() => version = Some(value.into_owned()),
            "listing_id" | "version" => return None,
            _ => return None,
        }
    }

    let listing_id = listing_id?;
    let version = version?;
    if !is_uuid(&listing_id) || version.len() > 64 || semver::Version::parse(&version).is_err() {
        return None;
    }

    Some(DeepLinkInstallPayload {
        listing_id,
        version,
    })
}

/// The renderer attaches its event listener before invoking this command. Any
/// cold-start intents are returned through the command response; subsequent
/// intents are delivered through `deep-link-install` events.
#[tauri::command]
pub fn deep_link_mark_renderer_ready(
    state: State<'_, DeepLinkState>,
) -> Result<Vec<DeepLinkInstallPayload>, String> {
    state.mark_renderer_ready()
}

pub fn mark_renderer_not_ready(app: &AppHandle) {
    app.state::<DeepLinkState>().mark_renderer_not_ready();
}

/// Handle a list of deep link URLs received by the app.
///
/// For each valid `offisim://install` URL, targets the primary desktop webview
/// with a `deep-link-install` event, or requeues it until that renderer is ready.
pub fn handle_deep_link_urls(app: &AppHandle, urls: Vec<url::Url>) {
    for url in urls {
        let raw = url.as_str();
        if let Some(payload) = parse_install_url(raw) {
            let state = app.state::<DeepLinkState>();
            match state.queue_until_renderer_ready(payload.clone()) {
                Ok(true) => continue,
                Err(error) => {
                    eprintln!("[deep_link] Failed to queue install intent: {error}");
                    continue;
                }
                Ok(false) => {}
            }
            // E/I6: address the deep-link payload at the primary install
            // window only, not every webview. `app.emit` broadcasts to all
            // windows, which means a child preview or hidden popup that
            // happens to be alive would also see the install intent. Target
            // the single privileged `main` renderer. Development uses the same
            // label so capability and event routing cannot diverge by build mode.
            let target = app.get_webview_window(MAIN_WINDOW_LABEL);
            let Some(window) = target else {
                state.requeue_after_emit_failure(payload);
                continue;
            };
            let emit_result = window.emit("deep-link-install", &payload);
            if let Err(e) = emit_result {
                eprintln!("[deep_link] Failed to emit install event: {e}");
                state.requeue_after_emit_failure(payload);
            }
        } else {
            eprintln!("[deep_link] Ignoring unrecognized install URL");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LISTING_ID: &str = "550e8400-e29b-41d4-a716-446655440000";

    #[test]
    fn parses_a_strict_install_intent() {
        assert_eq!(
            parse_install_url(&format!(
                "offisim://install?listing_id={LISTING_ID}&version=1.2.3-rc.1"
            )),
            Some(DeepLinkInstallPayload {
                listing_id: LISTING_ID.to_string(),
                version: "1.2.3-rc.1".to_string(),
            })
        );
    }

    #[test]
    fn rejects_ambiguous_or_untrusted_install_urls() {
        for raw in [
            "https://install?listing_id=550e8400-e29b-41d4-a716-446655440000&version=1.2.3",
            "offisim://install/path?listing_id=550e8400-e29b-41d4-a716-446655440000&version=1.2.3",
            "offisim://user@install?listing_id=550e8400-e29b-41d4-a716-446655440000&version=1.2.3",
            "offisim://install?listing_id=not-a-uuid&version=1.2.3",
            "offisim://install?listing_id=550e8400-e29b-41d4-a716-446655440000&version=latest",
            "offisim://install?listing_id=550e8400-e29b-41d4-a716-446655440000&listing_id=550e8400-e29b-41d4-a716-446655440001&version=1.2.3",
            "offisim://install?listing_id=550e8400-e29b-41d4-a716-446655440000&version=1.2.3&token=secret",
        ] {
            assert_eq!(parse_install_url(raw), None, "accepted {raw}");
        }
        assert_eq!(
            parse_install_url(&format!("offisim://{}", "x".repeat(513))),
            None
        );
    }

    #[test]
    fn renderer_handshake_drains_pending_intents_once() {
        let state = DeepLinkState::default();
        let payload = DeepLinkInstallPayload {
            listing_id: LISTING_ID.to_string(),
            version: "1.2.3".to_string(),
        };
        assert_eq!(state.queue_until_renderer_ready(payload.clone()), Ok(true));
        assert_eq!(state.mark_renderer_ready(), Ok(vec![payload.clone()]));
        assert_eq!(state.mark_renderer_ready(), Ok(Vec::new()));
        assert_eq!(state.queue_until_renderer_ready(payload), Ok(false));
    }

    #[test]
    fn pending_queue_is_bounded_and_deduplicated() {
        let state = DeepLinkState::default();
        let first = DeepLinkInstallPayload {
            listing_id: LISTING_ID.to_string(),
            version: "1.0.0".to_string(),
        };
        assert_eq!(state.queue_until_renderer_ready(first.clone()), Ok(true));
        assert_eq!(state.queue_until_renderer_ready(first), Ok(true));
        for index in 1..=MAX_PENDING_INSTALLS {
            assert_eq!(
                state.queue_until_renderer_ready(DeepLinkInstallPayload {
                    listing_id: format!("00000000-0000-0000-0000-{index:012}"),
                    version: "1.0.0".to_string(),
                }),
                Ok(true)
            );
        }
        assert_eq!(
            state.mark_renderer_ready().unwrap().len(),
            MAX_PENDING_INSTALLS
        );
    }
}
