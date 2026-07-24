use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, MutexGuard};
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Runtime, State, Webview,
    WebviewUrl,
};
use url::Url;

const BROWSER_EVENT: &str = "offisim-browser-session-event-v1";
const BROWSER_LABEL_PREFIX: &str = "browser-";
// Safari freezes its UA; manually bump only Version/ with each annual Safari major release.
pub(crate) const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const MAX_TOMBSTONES: usize = 256;
const MAX_TITLE_CHARS: usize = 512;
const MAX_ERROR_CHARS: usize = 512;
const MAX_BOUND: f64 = 32_768.0;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSessionScope {
    pub company_id: String,
    pub project_id: String,
    #[serde(default)]
    pub thread_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl BrowserBounds {
    fn validate(self) -> Result<Self, String> {
        let values = [self.x, self.y, self.width, self.height];
        if values.iter().any(|value| !value.is_finite()) {
            return Err("browser bounds must be finite".to_string());
        }
        if self.x < 0.0 || self.y < 0.0 || self.width <= 0.0 || self.height <= 0.0 {
            return Err(
                "browser bounds must have a non-negative origin and positive size".to_string(),
            );
        }
        if values.iter().any(|value| *value > MAX_BOUND) {
            return Err("browser bounds exceed the native WebView limit".to_string());
        }
        Ok(self)
    }

    fn native_rect(self) -> Rect {
        Rect {
            position: tauri::Position::Logical(LogicalPosition::new(self.x, self.y)),
            size: tauri::Size::Logical(LogicalSize::new(self.width, self.height)),
        }
    }
}

fn offset_bounds_in_parent(bounds: BrowserBounds, x: f64, y: f64) -> BrowserBounds {
    BrowserBounds {
        x: bounds.x + x,
        y: bounds.y + y,
        ..bounds
    }
}

#[cfg(target_os = "macos")]
async fn host_viewport_inset<R: Runtime>(host_webview: &Webview<R>) -> Result<(f64, f64), String> {
    let window = host_webview.window();
    let native_window = window.clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let result = native_window
                .ns_window()
                .map_err(|error| format!("read native browser window: {error}"))
                .and_then(|handle| {
                    if handle.is_null() {
                        return Err("native browser window handle is unavailable".to_string());
                    }
                    // SAFETY: Tauri owns this live NSWindow. This closure runs
                    // on AppKit's main thread and borrows it only for geometry.
                    let window = unsafe { &*handle.cast::<objc2_app_kit::NSWindow>() };
                    let frame = window.frame();
                    let content = window.contentLayoutRect();
                    Ok((
                        content.origin.x.max(0.0),
                        (frame.size.height - content.origin.y - content.size.height).max(0.0),
                    ))
                });
            let _ = sender.send(result);
        })
        .map_err(|error| format!("schedule native browser geometry read: {error}"))?;
    receiver
        .await
        .map_err(|_| "native browser geometry callback was dropped".to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn host_viewport_inset<R: Runtime>(host_webview: &Webview<R>) -> Result<(f64, f64), String> {
    let window = host_webview.window();
    let host_size = host_webview
        .size()
        .map_err(|error| format!("read browser host WebView size: {error}"))?;
    let outer_size = window
        .outer_size()
        .map_err(|error| format!("read browser window outer size: {error}"))?;
    let scale_factor = window
        .scale_factor()
        .map_err(|error| format!("read browser window scale factor: {error}"))?;
    if !scale_factor.is_finite() || scale_factor <= 0.0 {
        return Err("browser window scale factor must be positive".to_string());
    }
    Ok((
        f64::from(outer_size.width.saturating_sub(host_size.width)) / (2.0 * scale_factor),
        f64::from(outer_size.height.saturating_sub(host_size.height)) / scale_factor,
    ))
}

async fn bounds_in_parent_window<R: Runtime>(
    host_webview: &Webview<R>,
    bounds: BrowserBounds,
) -> Result<BrowserBounds, String> {
    // DOMRect coordinates start at the host WebView's viewport. Child
    // WebViews are positioned from the parent window's outer content plane,
    // so derive its platform decoration inset from the actual host and outer
    // sizes instead of assuming a fixed title-bar height.
    let (x, y) = host_viewport_inset(host_webview).await?;
    Ok(offset_bounds_in_parent(bounds, x, y))
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSessionSnapshot {
    pub session_id: String,
    pub scope: BrowserSessionScope,
    pub status: String,
    pub url: String,
    pub title: Option<String>,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub sequence: u64,
    pub visible: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AuditOrigin {
    Manual,
    Page,
}

impl AuditOrigin {
    fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Page => "page",
        }
    }
}

#[derive(Clone, Debug)]
struct SessionRecord {
    label: String,
    host_webview_label: String,
    bounds: BrowserBounds,
    snapshot: BrowserSessionSnapshot,
    pending_navigation_origin: Option<AuditOrigin>,
}

#[derive(Default)]
struct RegistryInner {
    sessions: HashMap<String, SessionRecord>,
    tombstones: VecDeque<String>,
}

#[derive(Default)]
pub struct BrowserSessionRegistry {
    inner: Mutex<RegistryInner>,
}

#[derive(Clone)]
struct SessionAccess {
    label: String,
    host_webview_label: String,
    snapshot: BrowserSessionSnapshot,
}

struct MutationResult {
    host_webview_label: String,
    snapshot: BrowserSessionSnapshot,
}

enum ReserveOutcome {
    Created,
    Existing(Box<SessionAccess>),
}

enum SessionMutation {
    NavigationStarted(String),
    UrlObserved(String),
    LoadStarted(String),
    LoadFinished(String),
    TitleChanged(String),
    HistoryState { back: bool, forward: bool },
    Bounds(BrowserBounds),
    Visibility(bool),
    Notice(String),
    Error(String),
    Closed,
}

impl BrowserSessionRegistry {
    fn lock(&self) -> MutexGuard<'_, RegistryInner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn reserve(
        &self,
        session_id: String,
        scope: BrowserSessionScope,
        url: String,
        bounds: BrowserBounds,
        host_webview_label: String,
    ) -> Result<ReserveOutcome, String> {
        let label = browser_label(&session_id)?;
        let mut inner = self.lock();
        if let Some(record) = inner.sessions.get(&session_id) {
            if record.snapshot.scope != scope {
                return Err("browser session scope mismatch".to_string());
            }
            if record.snapshot.status == "closed" {
                return Err("browser session is closed".to_string());
            }
            return Ok(ReserveOutcome::Existing(Box::new(SessionAccess {
                label: record.label.clone(),
                host_webview_label: record.host_webview_label.clone(),
                snapshot: record.snapshot.clone(),
            })));
        }
        let snapshot = BrowserSessionSnapshot {
            session_id: session_id.clone(),
            scope,
            status: "loading".to_string(),
            url,
            title: None,
            can_go_back: false,
            can_go_forward: false,
            sequence: 1,
            visible: true,
            error: None,
        };
        inner.sessions.insert(
            session_id,
            SessionRecord {
                label,
                host_webview_label,
                bounds,
                snapshot: snapshot.clone(),
                pending_navigation_origin: Some(AuditOrigin::Manual),
            },
        );
        Ok(ReserveOutcome::Created)
    }

    fn abandon(&self, session_id: &str) {
        self.lock().sessions.remove(session_id);
    }

    fn access(
        &self,
        session_id: &str,
        scope: &BrowserSessionScope,
    ) -> Result<SessionAccess, String> {
        let inner = self.lock();
        let record = inner
            .sessions
            .get(session_id)
            .ok_or_else(|| "browser session was not found".to_string())?;
        if &record.snapshot.scope != scope {
            return Err("browser session scope mismatch".to_string());
        }
        Ok(SessionAccess {
            label: record.label.clone(),
            host_webview_label: record.host_webview_label.clone(),
            snapshot: record.snapshot.clone(),
        })
    }

    fn active_access(
        &self,
        session_id: &str,
        scope: &BrowserSessionScope,
    ) -> Result<SessionAccess, String> {
        let access = self.access(session_id, scope)?;
        if access.snapshot.status == "closed" {
            return Err("browser session is closed".to_string());
        }
        Ok(access)
    }

    fn current(&self, session_id: &str) -> Option<BrowserSessionSnapshot> {
        self.lock()
            .sessions
            .get(session_id)
            .map(|record| record.snapshot.clone())
    }

    fn set_pending_origin(&self, session_id: &str, origin: AuditOrigin) {
        if let Some(record) = self.lock().sessions.get_mut(session_id) {
            record.pending_navigation_origin = Some(origin);
        }
    }

    fn clear_pending_origin(&self, session_id: &str) {
        if let Some(record) = self.lock().sessions.get_mut(session_id) {
            record.pending_navigation_origin = None;
        }
    }

    fn navigation(&self, session_id: &str, url: String) -> Option<(MutationResult, AuditOrigin)> {
        let mut inner = self.lock();
        let record = inner.sessions.get_mut(session_id)?;
        if record.snapshot.status == "closed" {
            return None;
        }
        let origin = record
            .pending_navigation_origin
            .take()
            .unwrap_or(AuditOrigin::Page);
        apply_mutation(
            &mut record.snapshot,
            SessionMutation::NavigationStarted(url),
        );
        Some((mutation_result(record), origin))
    }

    fn mutate(&self, session_id: &str, mutation: SessionMutation) -> Option<MutationResult> {
        let mut inner = self.lock();
        let record = inner.sessions.get_mut(session_id)?;
        if record.snapshot.status == "closed" && !matches!(mutation, SessionMutation::Closed) {
            return None;
        }
        match mutation {
            SessionMutation::Bounds(bounds) => {
                record.bounds = bounds;
                apply_mutation(&mut record.snapshot, SessionMutation::Bounds(bounds));
            }
            mutation => apply_mutation(&mut record.snapshot, mutation),
        }
        Some(mutation_result(record))
    }

    fn reattach(
        &self,
        session_id: &str,
        scope: &BrowserSessionScope,
        bounds: BrowserBounds,
        host_webview_label: String,
    ) -> Result<MutationResult, String> {
        let mut inner = self.lock();
        let record = inner
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| "browser session was not found".to_string())?;
        if &record.snapshot.scope != scope {
            return Err("browser session scope mismatch".to_string());
        }
        if record.snapshot.status == "closed" {
            return Err("browser session is closed".to_string());
        }
        record.host_webview_label = host_webview_label;
        record.bounds = bounds;
        apply_mutation(&mut record.snapshot, SessionMutation::Bounds(bounds));
        apply_mutation(&mut record.snapshot, SessionMutation::Visibility(true));
        Ok(mutation_result(record))
    }

    fn history_if_changed(
        &self,
        session_id: &str,
        back: bool,
        forward: bool,
    ) -> Option<MutationResult> {
        let mut inner = self.lock();
        let record = inner.sessions.get_mut(session_id)?;
        if record.snapshot.status == "closed"
            || (record.snapshot.can_go_back == back && record.snapshot.can_go_forward == forward)
        {
            return None;
        }
        apply_mutation(
            &mut record.snapshot,
            SessionMutation::HistoryState { back, forward },
        );
        Some(mutation_result(record))
    }

    fn close_record(
        &self,
        session_id: &str,
        scope: &BrowserSessionScope,
    ) -> Result<(SessionAccess, bool), String> {
        let mut inner = self.lock();
        let (access, was_active) = {
            let record = inner
                .sessions
                .get_mut(session_id)
                .ok_or_else(|| "browser session was not found".to_string())?;
            if &record.snapshot.scope != scope {
                return Err("browser session scope mismatch".to_string());
            }
            let was_active = record.snapshot.status != "closed";
            if was_active {
                apply_mutation(&mut record.snapshot, SessionMutation::Closed);
            }
            let access = SessionAccess {
                label: record.label.clone(),
                host_webview_label: record.host_webview_label.clone(),
                snapshot: record.snapshot.clone(),
            };
            (access, was_active)
        };
        if was_active {
            inner.tombstones.push_back(session_id.to_string());
        }
        prune_tombstones(&mut inner);
        Ok((access, was_active))
    }

    fn active_sessions(&self) -> Vec<SessionAccess> {
        self.lock()
            .sessions
            .values()
            .filter(|record| record.snapshot.status != "closed")
            .map(|record| SessionAccess {
                label: record.label.clone(),
                host_webview_label: record.host_webview_label.clone(),
                snapshot: record.snapshot.clone(),
            })
            .collect()
    }

    fn list_scoped(&self, scope: &BrowserSessionScope) -> Vec<BrowserSessionSnapshot> {
        let mut snapshots: Vec<_> = self
            .lock()
            .sessions
            .values()
            .filter(|record| record.snapshot.status != "closed" && &record.snapshot.scope == scope)
            .map(|record| record.snapshot.clone())
            .collect();
        snapshots.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        snapshots
    }

    pub fn close_all<R: Runtime>(&self, app: &AppHandle<R>) {
        for access in self.active_sessions() {
            if let Some(webview) = app.get_webview(&access.label) {
                let _ = webview.close();
            }
            if let Ok((closed, was_active)) =
                self.close_record(&access.snapshot.session_id, &access.snapshot.scope)
            {
                if was_active {
                    emit_snapshot(app, &closed.host_webview_label, &closed.snapshot);
                    append_audit(app, &closed.snapshot, "close", AuditOrigin::Manual, None);
                }
            }
        }
    }
}

fn mutation_result(record: &SessionRecord) -> MutationResult {
    MutationResult {
        host_webview_label: record.host_webview_label.clone(),
        snapshot: record.snapshot.clone(),
    }
}

fn prune_tombstones(inner: &mut RegistryInner) {
    while inner.tombstones.len() > MAX_TOMBSTONES {
        if let Some(session_id) = inner.tombstones.pop_front() {
            if inner
                .sessions
                .get(&session_id)
                .is_some_and(|record| record.snapshot.status == "closed")
            {
                inner.sessions.remove(&session_id);
            }
        }
    }
}

fn apply_mutation(snapshot: &mut BrowserSessionSnapshot, mutation: SessionMutation) {
    match mutation {
        SessionMutation::NavigationStarted(url) | SessionMutation::LoadStarted(url) => {
            snapshot.url = url;
            snapshot.status = "loading".to_string();
            snapshot.error = None;
        }
        SessionMutation::UrlObserved(url) => snapshot.url = url,
        SessionMutation::LoadFinished(url) => {
            snapshot.url = url;
            snapshot.status = "ready".to_string();
            snapshot.error = None;
        }
        SessionMutation::TitleChanged(title) => {
            snapshot.title = nonempty_limited(title, MAX_TITLE_CHARS);
        }
        SessionMutation::HistoryState { back, forward } => {
            snapshot.can_go_back = back;
            snapshot.can_go_forward = forward;
        }
        SessionMutation::Bounds(_) => {}
        SessionMutation::Visibility(visible) => snapshot.visible = visible,
        SessionMutation::Notice(message) => {
            snapshot.error = nonempty_limited(message, MAX_ERROR_CHARS);
        }
        SessionMutation::Error(message) => {
            snapshot.status = "error".to_string();
            snapshot.error = nonempty_limited(message, MAX_ERROR_CHARS);
        }
        SessionMutation::Closed => {
            snapshot.status = "closed".to_string();
            snapshot.visible = false;
            snapshot.can_go_back = false;
            snapshot.can_go_forward = false;
            snapshot.error = None;
        }
    }
    snapshot.sequence = snapshot.sequence.saturating_add(1);
}

fn nonempty_limited(value: String, max_chars: usize) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(max_chars).collect())
}

fn validate_scope_fields(scope: &BrowserSessionScope) -> Result<(), String> {
    if scope.company_id.is_empty()
        || scope.project_id.is_empty()
        || scope.company_id.trim() != scope.company_id
        || scope.project_id.trim() != scope.project_id
    {
        return Err("browser scope requires canonical companyId and projectId".to_string());
    }
    if scope
        .thread_id
        .as_deref()
        .is_some_and(|value| value.is_empty() || value.trim() != value)
    {
        return Err("browser scope threadId must be canonical when present".to_string());
    }
    Ok(())
}

async fn validate_scope(pool: &SqlitePool, scope: &BrowserSessionScope) -> Result<(), String> {
    validate_scope_fields(scope)?;
    let project_matches: i64 = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE project_id = ?1 AND company_id = ?2)",
    )
    .bind(&scope.project_id)
    .bind(&scope.company_id)
    .fetch_one(pool)
    .await
    .map_err(|error| format!("validate browser project scope: {error}"))?;
    if project_matches != 1 {
        return Err("browser scope project does not belong to company".to_string());
    }
    if let Some(thread_id) = &scope.thread_id {
        let thread_matches: i64 = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM chat_threads WHERE thread_id = ?1 AND project_id = ?2)",
        )
        .bind(thread_id)
        .bind(&scope.project_id)
        .fetch_one(pool)
        .await
        .map_err(|error| format!("validate browser thread scope: {error}"))?;
        if thread_matches != 1 {
            return Err("browser scope thread does not belong to project".to_string());
        }
    }
    Ok(())
}

fn browser_label(session_id: &str) -> Result<String, String> {
    if session_id.is_empty()
        || session_id.len() > 80
        || !session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("browser sessionId must be 1-80 URL-safe label characters".to_string());
    }
    Ok(format!("{BROWSER_LABEL_PREFIX}{session_id}"))
}

fn validated_navigation_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value.trim()).map_err(|_| "browser URL is invalid".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("browser navigation allows only absolute http/https URLs".to_string());
    }
    Ok(url)
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuditUrl {
    scheme: String,
    host: String,
}

fn sanitized_audit_url(url: &Url) -> Option<AuditUrl> {
    Some(AuditUrl {
        scheme: url.scheme().to_string(),
        host: url.host_str()?.to_string(),
    })
}

fn append_audit<R: Runtime>(
    _app: &AppHandle<R>,
    snapshot: &BrowserSessionSnapshot,
    action: &str,
    origin: AuditOrigin,
    url: Option<&Url>,
) {
    let event = serde_json::json!({
        "sessionId": snapshot.session_id,
        "scope": snapshot.scope,
        "lane": "browser",
        "action": action,
        "actor": "boss",
        "origin": origin.as_str(),
        "url": url.and_then(sanitized_audit_url),
        "atUnixMs": now_unix_ms(),
    });
    crate::stage_audit::append(&event);
}

fn now_unix_ms() -> u64 {
    // Canonical clock is i64 (non-negative in practice); this lane keeps u64.
    crate::time_util::now_unix_ms() as u64
}

fn emit_snapshot<R: Runtime>(
    app: &AppHandle<R>,
    host_webview_label: &str,
    snapshot: &BrowserSessionSnapshot,
) {
    let _ = app.emit_to(host_webview_label, BROWSER_EVENT, snapshot.clone());
}

fn emit_mutation<R: Runtime>(app: &AppHandle<R>, mutation: Option<MutationResult>) {
    if let Some(mutation) = mutation {
        emit_snapshot(app, &mutation.host_webview_label, &mutation.snapshot);
    }
}

fn registry<R: Runtime>(app: &AppHandle<R>) -> State<'_, BrowserSessionRegistry> {
    app.state::<BrowserSessionRegistry>()
}

fn handle_navigation<R: Runtime>(app: &AppHandle<R>, session_id: &str, url: &Url) -> bool {
    let accepted = validated_navigation_url(url.as_str()).is_ok();
    if !accepted {
        let registry = registry(app);
        registry.clear_pending_origin(session_id);
        let mutation = registry.mutate(
            session_id,
            SessionMutation::Notice("Blocked non-http(s) navigation".to_string()),
        );
        if let Some(mutation) = mutation {
            append_audit(
                app,
                &mutation.snapshot,
                "navigation-blocked",
                AuditOrigin::Page,
                Some(url),
            );
            emit_snapshot(app, &mutation.host_webview_label, &mutation.snapshot);
        }
    }
    accepted
}

fn handle_page_load<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    webview: Webview<R>,
    url: &Url,
    event: PageLoadEvent,
) {
    match event {
        PageLoadEvent::Started => {
            if let Some((mutation, origin)) = registry(app).navigation(session_id, url.to_string())
            {
                if origin == AuditOrigin::Page {
                    append_audit(app, &mutation.snapshot, "navigate", origin, Some(url));
                }
                emit_snapshot(app, &mutation.host_webview_label, &mutation.snapshot);
            }
        }
        PageLoadEvent::Finished => {
            emit_mutation(
                app,
                registry(app).mutate(session_id, SessionMutation::LoadFinished(url.to_string())),
            );
        }
    }
    if event == PageLoadEvent::Finished {
        let app = app.clone();
        let session_id = session_id.to_string();
        tauri::async_runtime::spawn(async move {
            let _ = refresh_history(&app, &session_id, webview).await;
        });
    }
}

fn handle_title<R: Runtime>(app: &AppHandle<R>, session_id: &str, title: String) {
    let mutation = registry(app).mutate(session_id, SessionMutation::TitleChanged(title));
    emit_mutation(app, mutation);
}

fn handle_blocked_page_action<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    action: &str,
    message: &str,
    url: Option<&Url>,
) {
    if let Some(mutation) =
        registry(app).mutate(session_id, SessionMutation::Notice(message.to_string()))
    {
        append_audit(app, &mutation.snapshot, action, AuditOrigin::Page, url);
        emit_snapshot(app, &mutation.host_webview_label, &mutation.snapshot);
    }
}

#[derive(Clone, Copy)]
enum NativeHistoryAction {
    Query,
    Back,
    Forward,
}

struct NativeHistoryResult {
    performed: bool,
    back: bool,
    forward: bool,
}

#[cfg(target_os = "macos")]
async fn native_history<R: Runtime>(
    webview: Webview<R>,
    action: NativeHistoryAction,
) -> Result<NativeHistoryResult, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    webview
        .with_webview(move |platform| {
            let result = if platform.inner().is_null() {
                Err("native WKWebView handle is unavailable".to_string())
            } else {
                // SAFETY: Tauri supplies the live WKWebView pointer and executes
                // this closure on the native main thread. It is borrowed only for
                // the duration of this callback.
                let view = unsafe { &*platform.inner().cast::<objc2_web_kit::WKWebView>() };
                let before_back = unsafe { view.canGoBack() };
                let before_forward = unsafe { view.canGoForward() };
                let performed = match action {
                    NativeHistoryAction::Query => false,
                    NativeHistoryAction::Back if before_back => {
                        let _ = unsafe { view.goBack() };
                        true
                    }
                    NativeHistoryAction::Forward if before_forward => {
                        let _ = unsafe { view.goForward() };
                        true
                    }
                    _ => false,
                };
                Ok(NativeHistoryResult {
                    performed,
                    back: unsafe { view.canGoBack() },
                    forward: unsafe { view.canGoForward() },
                })
            };
            let _ = sender.send(result);
        })
        .map_err(|error| format!("access native browser history: {error}"))?;
    receiver
        .await
        .map_err(|_| "native browser history callback was dropped".to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn native_history<R: Runtime>(
    _webview: Webview<R>,
    action: NativeHistoryAction,
) -> Result<NativeHistoryResult, String> {
    if matches!(action, NativeHistoryAction::Query) {
        return Ok(NativeHistoryResult {
            performed: false,
            back: false,
            forward: false,
        });
    }
    Err("native browser history is currently supported only on macOS".to_string())
}

async fn refresh_history<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    webview: Webview<R>,
) -> Result<(), String> {
    let history = native_history(webview, NativeHistoryAction::Query).await?;
    let mutation = registry(app).history_if_changed(session_id, history.back, history.forward);
    emit_mutation(app, mutation);
    Ok(())
}

fn webview_for<R: Runtime>(
    app: &AppHandle<R>,
    access: &SessionAccess,
) -> Result<Webview<R>, String> {
    app.get_webview(&access.label)
        .ok_or_else(|| "native browser WebView is unavailable".to_string())
}

fn command_failed<R: Runtime>(app: &AppHandle<R>, session_id: &str, message: String) -> String {
    let mutation = registry(app).mutate(session_id, SessionMutation::Error(message.clone()));
    emit_mutation(app, mutation);
    message
}

#[tauri::command]
pub async fn browser_session_create<R: Runtime>(
    app: AppHandle<R>,
    caller: Webview<R>,
    registry: State<'_, BrowserSessionRegistry>,
    session_id: String,
    scope: BrowserSessionScope,
    url: String,
    bounds: BrowserBounds,
) -> Result<BrowserSessionSnapshot, String> {
    browser_label(&session_id)?;
    validate_scope(&crate::local_db::get_offisim_pool(&app)?, &scope).await?;
    let url = validated_navigation_url(&url)?;
    let bounds = bounds.validate()?;
    let native_bounds = bounds_in_parent_window(&caller, bounds).await?;
    let reservation = registry.reserve(
        session_id.clone(),
        scope.clone(),
        url.to_string(),
        bounds,
        caller.label().to_string(),
    )?;

    if let ReserveOutcome::Existing(access) = reservation {
        let webview = webview_for(&app, &access)?;
        webview
            .set_bounds(native_bounds.native_rect())
            .map_err(|error| format!("reattach browser bounds: {error}"))?;
        webview
            .show()
            .map_err(|error| format!("reattach browser visibility: {error}"))?;
        let mutation =
            registry.reattach(&session_id, &scope, bounds, caller.label().to_string())?;
        append_audit(
            &app,
            &mutation.snapshot,
            "reattach",
            AuditOrigin::Manual,
            Url::parse(&mutation.snapshot.url).ok().as_ref(),
        );
        emit_snapshot(&app, &mutation.host_webview_label, &mutation.snapshot);
        let _ = refresh_history(&app, &session_id, webview).await;
        return Ok(registry.current(&session_id).unwrap_or(mutation.snapshot));
    }

    let navigation_app = app.clone();
    let navigation_id = session_id.clone();
    let popup_app = app.clone();
    let popup_id = session_id.clone();
    let title_app = app.clone();
    let title_id = session_id.clone();
    let download_app = app.clone();
    let download_id = session_id.clone();
    let load_app = app.clone();
    let load_id = session_id.clone();
    let label = browser_label(&session_id)?;
    let builder = WebviewBuilder::new(label, WebviewUrl::External(url.clone()))
        .user_agent(BROWSER_USER_AGENT)
        .accept_first_mouse(true)
        // The browser chrome lives in the main renderer WebView. A child that
        // claims focus during creation makes the address field look fake and
        // swallows the first keyboard interaction.
        .focused(false)
        .incognito(false)
        .on_navigation(move |target| handle_navigation(&navigation_app, &navigation_id, target))
        .on_new_window(move |target, _features| {
            handle_blocked_page_action(
                &popup_app,
                &popup_id,
                "popup-blocked",
                "Popup blocked",
                Some(&target),
            );
            NewWindowResponse::Deny
        })
        .on_document_title_changed(move |_webview, title| {
            handle_title(&title_app, &title_id, title);
        })
        .on_download(move |_webview, event| {
            if let DownloadEvent::Requested { url, .. } = event {
                handle_blocked_page_action(
                    &download_app,
                    &download_id,
                    "download-blocked",
                    "Download blocked",
                    Some(&url),
                );
            }
            false
        })
        .on_page_load(move |webview, payload| {
            handle_page_load(&load_app, &load_id, webview, payload.url(), payload.event());
        });

    let webview = match caller.window().add_child(
        builder,
        LogicalPosition::new(native_bounds.x, native_bounds.y),
        LogicalSize::new(native_bounds.width, native_bounds.height),
    ) {
        Ok(webview) => webview,
        Err(error) => {
            registry.abandon(&session_id);
            return Err(format!("create browser WebView: {error}"));
        }
    };
    let Some(snapshot) = registry.current(&session_id) else {
        let _ = webview.close();
        return Err("browser session disappeared during creation".to_string());
    };
    if snapshot.status == "closed" {
        let _ = webview.close();
        return Ok(snapshot);
    }
    append_audit(&app, &snapshot, "create", AuditOrigin::Manual, Some(&url));
    emit_snapshot(&app, caller.label(), &snapshot);
    let _ = refresh_history(&app, &session_id, webview).await;
    Ok(registry.current(&session_id).unwrap_or(snapshot))
}

#[tauri::command]
pub async fn browser_session_navigate<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, BrowserSessionRegistry>,
    session_id: String,
    scope: BrowserSessionScope,
    url: String,
) -> Result<BrowserSessionSnapshot, String> {
    let access = registry.active_access(&session_id, &scope)?;
    let target = match validated_navigation_url(&url) {
        Ok(url) => url,
        Err(error) => {
            append_audit(
                &app,
                &access.snapshot,
                "navigation-blocked",
                AuditOrigin::Manual,
                Url::parse(url.trim()).ok().as_ref(),
            );
            return Err(error);
        }
    };
    registry.set_pending_origin(&session_id, AuditOrigin::Manual);
    append_audit(
        &app,
        &access.snapshot,
        "navigate",
        AuditOrigin::Manual,
        Some(&target),
    );
    if let Err(error) = webview_for(&app, &access)?.navigate(target) {
        registry.clear_pending_origin(&session_id);
        return Err(command_failed(
            &app,
            &session_id,
            format!("navigate browser: {error}"),
        ));
    }
    Ok(registry.current(&session_id).unwrap_or(access.snapshot))
}

async fn history_command<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, BrowserSessionRegistry>,
    session_id: String,
    scope: BrowserSessionScope,
    action: NativeHistoryAction,
    audit_action: &'static str,
) -> Result<BrowserSessionSnapshot, String> {
    let access = registry.active_access(&session_id, &scope)?;
    let webview = webview_for(&app, &access)?;
    registry.set_pending_origin(&session_id, AuditOrigin::Manual);
    let history = native_history(webview, action).await.map_err(|error| {
        registry.clear_pending_origin(&session_id);
        command_failed(&app, &session_id, error)
    })?;
    if !history.performed {
        registry.clear_pending_origin(&session_id);
        return Ok(access.snapshot);
    }
    append_audit(
        &app,
        &access.snapshot,
        audit_action,
        AuditOrigin::Manual,
        Url::parse(&access.snapshot.url).ok().as_ref(),
    );
    emit_mutation(
        &app,
        registry.history_if_changed(&session_id, history.back, history.forward),
    );
    Ok(registry.current(&session_id).unwrap_or(access.snapshot))
}

#[tauri::command]
pub async fn browser_session_back<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, BrowserSessionRegistry>,
    session_id: String,
    scope: BrowserSessionScope,
) -> Result<BrowserSessionSnapshot, String> {
    history_command(
        app,
        registry,
        session_id,
        scope,
        NativeHistoryAction::Back,
        "back",
    )
    .await
}

#[tauri::command]
pub async fn browser_session_forward<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, BrowserSessionRegistry>,
    session_id: String,
    scope: BrowserSessionScope,
) -> Result<BrowserSessionSnapshot, String> {
    history_command(
        app,
        registry,
        session_id,
        scope,
        NativeHistoryAction::Forward,
        "forward",
    )
    .await
}

#[tauri::command]
pub async fn browser_session_reload<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, BrowserSessionRegistry>,
    session_id: String,
    scope: BrowserSessionScope,
) -> Result<BrowserSessionSnapshot, String> {
    let access = registry.active_access(&session_id, &scope)?;
    registry.set_pending_origin(&session_id, AuditOrigin::Manual);
    append_audit(
        &app,
        &access.snapshot,
        "reload",
        AuditOrigin::Manual,
        Url::parse(&access.snapshot.url).ok().as_ref(),
    );
    emit_mutation(
        &app,
        registry.mutate(
            &session_id,
            SessionMutation::LoadStarted(access.snapshot.url.clone()),
        ),
    );
    webview_for(&app, &access)?.reload().map_err(|error| {
        registry.clear_pending_origin(&session_id);
        command_failed(&app, &session_id, format!("reload browser: {error}"))
    })?;
    Ok(registry.current(&session_id).unwrap_or(access.snapshot))
}

#[tauri::command]
pub async fn browser_session_set_bounds<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, BrowserSessionRegistry>,
    session_id: String,
    scope: BrowserSessionScope,
    bounds: BrowserBounds,
) -> Result<BrowserSessionSnapshot, String> {
    let access = registry.active_access(&session_id, &scope)?;
    let bounds = bounds.validate()?;
    let host_webview = app
        .get_webview(&access.host_webview_label)
        .ok_or_else(|| "browser host WebView is unavailable".to_string())?;
    let native_bounds = bounds_in_parent_window(&host_webview, bounds).await?;
    let webview = webview_for(&app, &access)?;
    webview
        .set_bounds(native_bounds.native_rect())
        .map_err(|error| {
            command_failed(&app, &session_id, format!("set browser bounds: {error}"))
        })?;
    emit_mutation(
        &app,
        registry.mutate(&session_id, SessionMutation::Bounds(bounds)),
    );
    Ok(registry.current(&session_id).unwrap_or(access.snapshot))
}

#[tauri::command]
pub async fn browser_session_set_visible<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, BrowserSessionRegistry>,
    session_id: String,
    scope: BrowserSessionScope,
    visible: bool,
) -> Result<BrowserSessionSnapshot, String> {
    let access = registry.active_access(&session_id, &scope)?;
    let webview = webview_for(&app, &access)?;
    let result = if visible {
        webview.show()
    } else {
        webview.hide()
    };
    result.map_err(|error| {
        command_failed(
            &app,
            &session_id,
            format!("set browser visibility: {error}"),
        )
    })?;
    emit_mutation(
        &app,
        registry.mutate(&session_id, SessionMutation::Visibility(visible)),
    );
    Ok(registry.current(&session_id).unwrap_or(access.snapshot))
}

#[tauri::command]
pub async fn browser_session_snapshot<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, BrowserSessionRegistry>,
    session_id: String,
    scope: BrowserSessionScope,
) -> Result<BrowserSessionSnapshot, String> {
    let access = registry.access(&session_id, &scope)?;
    if access.snapshot.status == "closed" {
        return Ok(access.snapshot);
    }
    let webview = webview_for(&app, &access)?;
    if let Ok(url) = webview.url() {
        if url.as_str() != access.snapshot.url {
            emit_mutation(
                &app,
                registry.mutate(&session_id, SessionMutation::UrlObserved(url.to_string())),
            );
        }
    }
    refresh_history(&app, &session_id, webview).await?;
    registry
        .current(&session_id)
        .ok_or_else(|| "browser session disappeared".to_string())
}

#[tauri::command]
pub async fn browser_session_list_scoped(
    registry: State<'_, BrowserSessionRegistry>,
    scope: BrowserSessionScope,
) -> Result<Vec<BrowserSessionSnapshot>, String> {
    validate_scope_fields(&scope)?;
    Ok(registry.list_scoped(&scope))
}

#[tauri::command]
pub async fn browser_session_close<R: Runtime>(
    app: AppHandle<R>,
    registry: State<'_, BrowserSessionRegistry>,
    session_id: String,
    scope: BrowserSessionScope,
) -> Result<BrowserSessionSnapshot, String> {
    let access = registry.access(&session_id, &scope)?;
    if let Some(webview) = app.get_webview(&access.label) {
        webview
            .close()
            .map_err(|error| format!("close browser WebView: {error}"))?;
    }
    let (closed, was_active) = registry.close_record(&session_id, &scope)?;
    if was_active {
        append_audit(
            &app,
            &closed.snapshot,
            "close",
            AuditOrigin::Manual,
            Url::parse(&closed.snapshot.url).ok().as_ref(),
        );
        emit_snapshot(&app, &closed.host_webview_label, &closed.snapshot);
    }
    Ok(closed.snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    fn scope() -> BrowserSessionScope {
        BrowserSessionScope {
            company_id: "company-1".to_string(),
            project_id: "project-1".to_string(),
            thread_id: Some("thread-1".to_string()),
        }
    }

    fn snapshot() -> BrowserSessionSnapshot {
        BrowserSessionSnapshot {
            session_id: "session-1".to_string(),
            scope: scope(),
            status: "loading".to_string(),
            url: "https://example.com".to_string(),
            title: None,
            can_go_back: false,
            can_go_forward: false,
            sequence: 1,
            visible: true,
            error: None,
        }
    }

    #[test]
    fn url_policy_allows_only_absolute_http_and_https() {
        assert!(validated_navigation_url("https://example.com/a").is_ok());
        assert!(validated_navigation_url("http://localhost:5173").is_ok());
        for denied in [
            "file:///tmp/a",
            "javascript:alert(1)",
            "data:text/html,hello",
            "tauri://localhost",
            "ipc://localhost",
            "offisim-media://localhost/file",
            "example.com",
        ] {
            assert!(
                validated_navigation_url(denied).is_err(),
                "accepted {denied}"
            );
        }
    }

    #[test]
    fn labels_are_browser_prefixed_and_injection_safe() {
        assert_eq!(browser_label("abc_123-xyz").unwrap(), "browser-abc_123-xyz");
        for denied in ["", "../main", "a:b", "contains space", "💥"] {
            assert!(browser_label(denied).is_err(), "accepted {denied}");
        }
    }

    #[test]
    fn renderer_bounds_are_offset_to_native_parent_coordinates() {
        let bounds = BrowserBounds {
            x: 24.0,
            y: 48.0,
            width: 640.0,
            height: 480.0,
        };
        let adjusted = offset_bounds_in_parent(bounds, 1.0, 28.0);
        let rect = adjusted.native_rect();
        assert_eq!(
            rect.position,
            tauri::Position::Logical(LogicalPosition::new(25.0, 76.0))
        );
        assert_eq!(
            rect.size,
            tauri::Size::Logical(LogicalSize::new(640.0, 480.0))
        );
    }

    #[test]
    fn scope_is_immutable_and_canonical() {
        assert!(validate_scope_fields(&scope()).is_ok());
        let mut forged = scope();
        forged.project_id = "project-2".to_string();
        assert_ne!(scope(), forged);
        forged.project_id = " project-1 ".to_string();
        assert!(validate_scope_fields(&forged).is_err());
    }

    #[test]
    fn audit_url_discards_credentials_path_query_and_fragment() {
        let url =
            Url::parse("https://user:secret@example.com:8443/private?token=top-secret#fragment")
                .unwrap();
        assert_eq!(
            sanitized_audit_url(&url),
            Some(AuditUrl {
                scheme: "https".to_string(),
                host: "example.com".to_string(),
            })
        );
        let encoded = serde_json::to_string(&sanitized_audit_url(&url)).unwrap();
        assert!(!encoded.contains("secret"));
        assert!(!encoded.contains("private"));
        assert!(!encoded.contains("token"));
        assert!(!encoded.contains("fragment"));
    }

    #[test]
    fn reducer_orders_state_with_monotonic_sequence() {
        let mut value = snapshot();
        apply_mutation(
            &mut value,
            SessionMutation::LoadFinished("https://example.com/a".to_string()),
        );
        apply_mutation(
            &mut value,
            SessionMutation::TitleChanged(" Example ".to_string()),
        );
        apply_mutation(
            &mut value,
            SessionMutation::HistoryState {
                back: true,
                forward: false,
            },
        );
        assert_eq!(value.sequence, 4);
        assert_eq!(value.status, "ready");
        assert_eq!(value.url, "https://example.com/a");
        assert_eq!(value.title.as_deref(), Some("Example"));
        assert!(value.can_go_back);
        apply_mutation(&mut value, SessionMutation::Closed);
        assert_eq!(value.sequence, 5);
        assert_eq!(value.status, "closed");
        assert!(!value.visible);
    }

    #[tokio::test]
    async fn database_scope_requires_project_company_and_thread_project_ownership() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE projects (project_id TEXT PRIMARY KEY, company_id TEXT NOT NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE chat_threads (thread_id TEXT PRIMARY KEY, project_id TEXT NOT NULL)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO projects VALUES ('project-1', 'company-1')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO chat_threads VALUES ('thread-1', 'project-1')")
            .execute(&pool)
            .await
            .unwrap();
        assert!(validate_scope(&pool, &scope()).await.is_ok());

        let mut forged = scope();
        forged.company_id = "company-2".to_string();
        assert!(validate_scope(&pool, &forged).await.is_err());
        let mut forged = scope();
        forged.thread_id = Some("thread-2".to_string());
        assert!(validate_scope(&pool, &forged).await.is_err());
    }

    #[test]
    fn registry_rejects_scope_forgery_and_keeps_close_idempotent() {
        let registry = BrowserSessionRegistry::default();
        registry
            .reserve(
                "session-1".to_string(),
                scope(),
                "https://example.com".to_string(),
                BrowserBounds {
                    x: 0.0,
                    y: 0.0,
                    width: 800.0,
                    height: 600.0,
                },
                "main".to_string(),
            )
            .unwrap();
        let mut forged = scope();
        forged.thread_id = None;
        assert!(registry.access("session-1", &forged).is_err());
        let (first, first_active) = registry.close_record("session-1", &scope()).unwrap();
        let (second, second_active) = registry.close_record("session-1", &scope()).unwrap();
        assert!(first_active);
        assert!(!second_active);
        assert_eq!(first.snapshot, second.snapshot);
    }

    #[test]
    fn registry_reattaches_same_scope_without_allocating_a_second_session() {
        let registry = BrowserSessionRegistry::default();
        let initial_bounds = BrowserBounds {
            x: 0.0,
            y: 0.0,
            width: 800.0,
            height: 600.0,
        };
        assert!(matches!(
            registry
                .reserve(
                    "session-1".to_string(),
                    scope(),
                    "https://example.com".to_string(),
                    initial_bounds,
                    "main".to_string(),
                )
                .unwrap(),
            ReserveOutcome::Created
        ));
        registry.mutate("session-1", SessionMutation::Visibility(false));

        assert!(matches!(
            registry
                .reserve(
                    "session-1".to_string(),
                    scope(),
                    "https://ignored.example.com".to_string(),
                    initial_bounds,
                    "replacement-main".to_string(),
                )
                .unwrap(),
            ReserveOutcome::Existing(_)
        ));
        let new_bounds = BrowserBounds {
            x: 40.0,
            y: 50.0,
            width: 900.0,
            height: 700.0,
        };
        let reattached = registry
            .reattach(
                "session-1",
                &scope(),
                new_bounds,
                "replacement-main".to_string(),
            )
            .unwrap();
        assert!(reattached.snapshot.visible);
        assert_eq!(reattached.host_webview_label, "replacement-main");
        let inner = registry.lock();
        assert_eq!(inner.sessions.len(), 1);
        assert_eq!(inner.sessions["session-1"].bounds, new_bounds);
    }
}
