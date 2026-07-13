use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex, Weak};
use std::thread::JoinHandle;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Runtime};

const TERMINAL_EVENT_NAME: &str = "offisim-terminal-session-event-v1";
const BYTE_RING_CAPACITY: usize = 2 * 1024 * 1024;
const READ_CHUNK_BYTES: usize = 32 * 1024;
const MAX_WRITE_BYTES: usize = 64 * 1024;
const MAX_WRITE_BASE64_CHARS: usize = ((MAX_WRITE_BYTES + 2) / 3) * 4;
const MIN_TERMINAL_DIMENSION: u16 = 1;
const MAX_TERMINAL_DIMENSION: u16 = 1_000;
const MAX_SESSION_ID_BYTES: usize = 128;

type EventSink = Arc<dyn Fn(TerminalSessionEvent) + Send + Sync>;
type AuditSink = Arc<dyn Fn(TerminalAuditRecord) + Send + Sync>;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionScope {
    company_id: String,
    project_id: String,
    #[serde(default)]
    thread_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputChunk {
    start_cursor: u64,
    end_cursor: u64,
    data_base64: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionSnapshot {
    session_id: String,
    scope: TerminalSessionScope,
    cwd: String,
    shell: String,
    status: String,
    start_cursor: u64,
    end_cursor: u64,
    chunks: Vec<TerminalOutputChunk>,
    gap: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSessionEvent {
    session_id: String,
    start_cursor: u64,
    end_cursor: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    data_base64: Option<String>,
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalAuditRecord {
    session_id: String,
    scope: TerminalSessionScope,
    action: String,
    actor: &'static str,
    origin: &'static str,
    at_unix_ms: u128,
    #[serde(skip_serializing_if = "Option::is_none")]
    byte_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cols: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rows: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SessionStatus {
    Running,
    Closing,
    Exited,
    Closed,
    Error,
}

impl SessionStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Closing => "closing",
            Self::Exited => "exited",
            Self::Closed => "closed",
            Self::Error => "error",
        }
    }

    fn accepts_input(self) -> bool {
        self == Self::Running
    }
}

#[derive(Debug)]
struct RetainedChunk {
    start_cursor: u64,
    end_cursor: u64,
    bytes: Vec<u8>,
}

#[derive(Debug)]
struct ByteRing {
    chunks: VecDeque<RetainedChunk>,
    retained_bytes: usize,
    end_cursor: u64,
}

impl Default for ByteRing {
    fn default() -> Self {
        Self {
            chunks: VecDeque::new(),
            retained_bytes: 0,
            end_cursor: 0,
        }
    }
}

impl ByteRing {
    fn push(&mut self, bytes: &[u8]) -> (u64, u64) {
        let start_cursor = self.end_cursor;
        self.end_cursor = self.end_cursor.saturating_add(bytes.len() as u64);
        if !bytes.is_empty() {
            self.retained_bytes = self.retained_bytes.saturating_add(bytes.len());
            self.chunks.push_back(RetainedChunk {
                start_cursor,
                end_cursor: self.end_cursor,
                bytes: bytes.to_vec(),
            });
            self.trim_to_capacity();
        }
        (start_cursor, self.end_cursor)
    }

    fn trim_to_capacity(&mut self) {
        while self.retained_bytes > BYTE_RING_CAPACITY {
            let overflow = self.retained_bytes - BYTE_RING_CAPACITY;
            let Some(front) = self.chunks.front_mut() else {
                self.retained_bytes = 0;
                return;
            };
            if overflow >= front.bytes.len() {
                self.retained_bytes -= front.bytes.len();
                self.chunks.pop_front();
                continue;
            }
            front.bytes.drain(..overflow);
            front.start_cursor = front.start_cursor.saturating_add(overflow as u64);
            self.retained_bytes -= overflow;
        }
    }

    fn retained_start_cursor(&self) -> u64 {
        self.chunks
            .front()
            .map(|chunk| chunk.start_cursor)
            .unwrap_or(self.end_cursor)
    }

    fn replay(&self, after_cursor: Option<u64>) -> ByteReplay {
        let retained_start = self.retained_start_cursor();
        let requested = after_cursor.unwrap_or(0).min(self.end_cursor);
        let gap = requested < retained_start;
        let replay_start = requested.max(retained_start);
        let chunks = self
            .chunks
            .iter()
            .filter(|chunk| chunk.end_cursor > replay_start)
            .map(|chunk| {
                let skip = replay_start.saturating_sub(chunk.start_cursor) as usize;
                let bytes = if skip < chunk.bytes.len() {
                    &chunk.bytes[skip..]
                } else {
                    &[]
                };
                let start_cursor = chunk.start_cursor.saturating_add(skip as u64);
                TerminalOutputChunk {
                    start_cursor,
                    end_cursor: chunk.end_cursor,
                    data_base64: BASE64_STANDARD.encode(bytes),
                }
            })
            .filter(|chunk| chunk.start_cursor < chunk.end_cursor)
            .collect();
        ByteReplay {
            start_cursor: replay_start,
            end_cursor: self.end_cursor,
            chunks,
            gap,
        }
    }
}

struct ByteReplay {
    start_cursor: u64,
    end_cursor: u64,
    chunks: Vec<TerminalOutputChunk>,
    gap: bool,
}

#[derive(Debug)]
struct SessionState {
    status: SessionStatus,
    exit_code: Option<i32>,
    message: Option<String>,
    ring: ByteRing,
}

impl Default for SessionState {
    fn default() -> Self {
        Self {
            status: SessionStatus::Running,
            exit_code: None,
            message: None,
            ring: ByteRing::default(),
        }
    }
}

#[derive(Default)]
struct ThreadHandles {
    reader: Option<JoinHandle<()>>,
    waiter: Option<JoinHandle<()>>,
}

#[derive(Default)]
struct StartGate {
    ready: Mutex<bool>,
    signal: Condvar,
}

impl StartGate {
    fn wait(&self) {
        let mut ready = lock_unpoisoned(&self.ready);
        while !*ready {
            ready = self
                .signal
                .wait(ready)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }

    fn open(&self) {
        *lock_unpoisoned(&self.ready) = true;
        self.signal.notify_all();
    }
}

struct TerminalSession {
    session_id: String,
    scope: TerminalSessionScope,
    cwd: PathBuf,
    shell: String,
    state: Mutex<SessionState>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    child: Mutex<Option<Box<dyn Child + Send + Sync>>>,
    killer: Mutex<Option<Box<dyn ChildKiller + Send + Sync>>>,
    threads: Mutex<ThreadHandles>,
    start_gate: Arc<StartGate>,
    process_group_id: Option<i32>,
    event_sink: EventSink,
    audit_sink: AuditSink,
}

impl TerminalSession {
    fn snapshot(&self, after_cursor: Option<u64>) -> TerminalSessionSnapshot {
        let state = lock_unpoisoned(&self.state);
        let replay = state.ring.replay(after_cursor);
        TerminalSessionSnapshot {
            session_id: self.session_id.clone(),
            scope: self.scope.clone(),
            cwd: self.cwd.to_string_lossy().to_string(),
            shell: self.shell.clone(),
            status: state.status.as_str().to_string(),
            start_cursor: replay.start_cursor,
            end_cursor: replay.end_cursor,
            chunks: replay.chunks,
            gap: replay.gap,
            exit_code: state.exit_code,
            error: state.message.clone(),
        }
    }

    fn emit_lifecycle(&self, kind: &str, message: Option<String>) {
        let state = lock_unpoisoned(&self.state);
        (self.event_sink)(TerminalSessionEvent {
            session_id: self.session_id.clone(),
            start_cursor: state.ring.end_cursor,
            end_cursor: state.ring.end_cursor,
            data_base64: None,
            kind: kind.to_string(),
            status: Some(state.status.as_str().to_string()),
            exit_code: state.exit_code,
            message: message.or_else(|| state.message.clone()),
        });
    }

    fn audit(
        &self,
        action: &str,
        byte_count: Option<u64>,
        size: Option<PtySize>,
        status: Option<SessionStatus>,
        exit_code: Option<i32>,
    ) {
        (self.audit_sink)(TerminalAuditRecord {
            session_id: self.session_id.clone(),
            scope: self.scope.clone(),
            action: action.to_string(),
            actor: "boss",
            origin: "manual",
            at_unix_ms: unix_time_ms(),
            byte_count,
            cols: size.map(|value| value.cols),
            rows: size.map(|value| value.rows),
            status: status.map(|value| value.as_str().to_string()),
            exit_code,
        });
    }

    fn write_bytes(&self, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() > MAX_WRITE_BYTES {
            return Err(format!(
                "terminal write exceeds {MAX_WRITE_BYTES} byte limit"
            ));
        }
        {
            let state = lock_unpoisoned(&self.state);
            if !state.status.accepts_input() {
                return Err(format!(
                    "terminal session is {} and cannot accept input",
                    state.status.as_str()
                ));
            }
        }
        let mut writer_guard = lock_unpoisoned(&self.writer);
        let writer = writer_guard
            .as_mut()
            .ok_or_else(|| "terminal session input is closed".to_string())?;
        writer
            .write_all(bytes)
            .and_then(|_| writer.flush())
            .map_err(|error| format!("write terminal input: {error}"))?;
        drop(writer_guard);
        self.audit("input", Some(bytes.len() as u64), None, None, None);
        Ok(())
    }

    fn resize(&self, size: PtySize) -> Result<(), String> {
        validate_size(size.cols, size.rows)?;
        {
            let state = lock_unpoisoned(&self.state);
            if !state.status.accepts_input() {
                return Err(format!(
                    "terminal session is {} and cannot resize",
                    state.status.as_str()
                ));
            }
        }
        let master_guard = lock_unpoisoned(&self.master);
        let master = master_guard
            .as_ref()
            .ok_or_else(|| "terminal session PTY is closed".to_string())?;
        master
            .resize(size)
            .map_err(|error| format!("resize terminal: {error:#}"))?;
        drop(master_guard);
        self.audit("resized", None, Some(size), None, None);
        self.emit_lifecycle("resized", None);
        Ok(())
    }

    fn close(&self) {
        {
            let mut state = lock_unpoisoned(&self.state);
            if matches!(state.status, SessionStatus::Closing | SessionStatus::Closed) {
                return;
            }
            state.status = SessionStatus::Closing;
        }
        self.start_gate.open();

        // Closing all master-side handles sends a terminal hangup. Signal the
        // foreground process group first so an active child command cannot keep
        // the slave side open after the shell itself exits.
        #[cfg(unix)]
        if let Some(process_group_id) = self.process_group_id {
            let result = unsafe { libc::kill(-process_group_id, libc::SIGHUP) };
            if result != 0 {
                let error = std::io::Error::last_os_error();
                if error.raw_os_error() != Some(libc::ESRCH) {
                    let mut state = lock_unpoisoned(&self.state);
                    state.message = Some(format!("signal terminal process group: {error}"));
                }
            }
        }

        lock_unpoisoned(&self.writer).take();
        lock_unpoisoned(&self.master).take();
        if let Some(mut killer) = lock_unpoisoned(&self.killer).take() {
            if let Err(error) = killer.kill() {
                if error.raw_os_error() != Some(libc_esrch()) {
                    let mut state = lock_unpoisoned(&self.state);
                    state.message = Some(format!("terminate terminal child: {error}"));
                }
            }
        }

        // The dedicated waiter normally owns the child. If its thread could not
        // be started, the child remains here and close still performs the wait,
        // so even thread-creation failure cannot leave a zombie.
        if let Some(mut child) = lock_unpoisoned(&self.child).take() {
            if let Ok(exit) = child.wait() {
                lock_unpoisoned(&self.state).exit_code = Some(portable_exit_code(&exit));
            }
        }

        let handles = {
            let mut handles = lock_unpoisoned(&self.threads);
            ThreadHandles {
                reader: handles.reader.take(),
                waiter: handles.waiter.take(),
            }
        };
        if let Some(waiter) = handles.waiter {
            if waiter.join().is_err() {
                lock_unpoisoned(&self.state).message =
                    Some("terminal wait thread panicked".to_string());
            }
        }
        if let Some(reader) = handles.reader {
            if reader.join().is_err() {
                lock_unpoisoned(&self.state).message =
                    Some("terminal reader thread panicked".to_string());
            }
        }

        let exit_code = {
            let mut state = lock_unpoisoned(&self.state);
            state.status = SessionStatus::Closed;
            state.exit_code
        };
        self.audit("closed", None, None, Some(SessionStatus::Closed), exit_code);
        self.emit_lifecycle("closed", None);
    }
}

struct RegistryInner {
    sessions: Mutex<HashMap<String, Arc<TerminalSession>>>,
}

impl Default for RegistryInner {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl RegistryInner {
    fn sweep(&self) {
        let sessions = lock_unpoisoned(&self.sessions)
            .drain()
            .map(|(_, session)| session)
            .collect::<Vec<_>>();
        for session in sessions {
            session.close();
        }
    }
}

#[derive(Clone)]
pub struct TerminalSessionRegistry {
    inner: Arc<RegistryInner>,
}

impl Default for TerminalSessionRegistry {
    fn default() -> Self {
        Self {
            inner: Arc::new(RegistryInner::default()),
        }
    }
}

impl Drop for TerminalSessionRegistry {
    fn drop(&mut self) {
        if Arc::strong_count(&self.inner) == 1 {
            self.inner.sweep();
        }
    }
}

impl TerminalSessionRegistry {
    fn create_native(
        &self,
        session_id: String,
        scope: TerminalSessionScope,
        cwd: PathBuf,
        cols: u16,
        rows: u16,
        event_sink: EventSink,
        audit_sink: AuditSink,
    ) -> Result<Arc<TerminalSession>, String> {
        validate_session_id(&session_id)?;
        validate_size(cols, rows)?;
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        let mut sessions = lock_unpoisoned(&self.inner.sessions);
        if let Some(existing) = sessions.get(&session_id) {
            ensure_scope(existing, &scope)?;
            return Ok(existing.clone());
        }

        let pair = native_pty_system()
            .openpty(size)
            .map_err(|error| format!("open terminal PTY: {error:#}"))?;
        let mut command = CommandBuilder::new_default_prog();
        command.cwd(&cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        let shell = command.get_shell();
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("spawn user shell: {error:#}"))?;
        let process_id = child.process_id().map(|value| value as i32);
        #[cfg(unix)]
        let process_group_id = pair.master.process_group_leader().or(process_id);
        #[cfg(not(unix))]
        let process_group_id = process_id;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("clone terminal reader: {error:#}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| format!("take terminal writer: {error:#}"))?;
        let killer = child.clone_killer();
        drop(pair.slave);

        let gate = Arc::new(StartGate::default());
        let session = Arc::new(TerminalSession {
            session_id: session_id.clone(),
            scope,
            cwd,
            shell,
            state: Mutex::new(SessionState::default()),
            master: Mutex::new(Some(pair.master)),
            writer: Mutex::new(Some(writer)),
            child: Mutex::new(Some(child)),
            killer: Mutex::new(Some(killer)),
            threads: Mutex::new(ThreadHandles::default()),
            start_gate: gate.clone(),
            process_group_id,
            event_sink,
            audit_sink,
        });
        let waiter_handle = match spawn_wait_thread(Arc::downgrade(&session), gate.clone()) {
            Ok(handle) => handle,
            Err(error) => {
                session.close();
                return Err(error);
            }
        };
        let reader_handle =
            match spawn_reader_thread(Arc::downgrade(&session), reader, gate.clone()) {
                Ok(handle) => handle,
                Err(error) => {
                    lock_unpoisoned(&session.threads).waiter = Some(waiter_handle);
                    session.close();
                    return Err(error);
                }
            };
        *lock_unpoisoned(&session.threads) = ThreadHandles {
            reader: Some(reader_handle),
            waiter: Some(waiter_handle),
        };
        sessions.insert(session_id, session.clone());
        drop(sessions);

        session.audit(
            "created",
            None,
            Some(size),
            Some(SessionStatus::Running),
            None,
        );
        session.emit_lifecycle("started", None);
        gate.open();
        Ok(session)
    }

    fn get_scoped(
        &self,
        session_id: &str,
        scope: &TerminalSessionScope,
    ) -> Result<Arc<TerminalSession>, String> {
        let sessions = lock_unpoisoned(&self.inner.sessions);
        let session = sessions
            .get(session_id)
            .ok_or_else(|| format!("terminal session not found: {session_id}"))?;
        ensure_scope(session, scope)?;
        Ok(session.clone())
    }

    fn take_scoped(
        &self,
        session_id: &str,
        scope: &TerminalSessionScope,
    ) -> Result<Option<Arc<TerminalSession>>, String> {
        let mut sessions = lock_unpoisoned(&self.inner.sessions);
        let Some(session) = sessions.get(session_id) else {
            return Ok(None);
        };
        ensure_scope(session, scope)?;
        Ok(sessions.remove(session_id))
    }

    fn list_scoped(&self, scope: &TerminalSessionScope) -> Vec<Arc<TerminalSession>> {
        let mut sessions = lock_unpoisoned(&self.inner.sessions)
            .values()
            .filter(|session| session.scope == *scope)
            .cloned()
            .collect::<Vec<_>>();
        sessions.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        sessions
    }
}

#[tauri::command]
pub async fn terminal_session_create(
    app: tauri::AppHandle,
    registry: tauri::State<'_, TerminalSessionRegistry>,
    session_id: String,
    scope: TerminalSessionScope,
    cols: u16,
    rows: u16,
) -> Result<TerminalSessionSnapshot, String> {
    validate_scope_fields(&scope)?;
    let cwd = validate_scope_and_workspace(&app, &scope).await?;
    let session = registry.create_native(
        session_id,
        scope,
        cwd,
        cols,
        rows,
        event_sink_for(&app),
        native_audit_sink(),
    )?;
    Ok(session.snapshot(None))
}

#[tauri::command]
pub fn terminal_session_write(
    registry: tauri::State<'_, TerminalSessionRegistry>,
    session_id: String,
    scope: TerminalSessionScope,
    data_base64: String,
) -> Result<(), String> {
    if data_base64.len() > MAX_WRITE_BASE64_CHARS {
        return Err(format!(
            "terminal write exceeds {MAX_WRITE_BYTES} byte limit"
        ));
    }
    let bytes = BASE64_STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|_| "terminal input is not valid base64".to_string())?;
    registry
        .get_scoped(&session_id, &scope)?
        .write_bytes(&bytes)
}

#[tauri::command]
pub fn terminal_session_resize(
    registry: tauri::State<'_, TerminalSessionRegistry>,
    session_id: String,
    scope: TerminalSessionScope,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    registry.get_scoped(&session_id, &scope)?.resize(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

#[tauri::command]
pub fn terminal_session_snapshot(
    registry: tauri::State<'_, TerminalSessionRegistry>,
    session_id: String,
    scope: TerminalSessionScope,
    after_cursor: Option<u64>,
) -> Result<TerminalSessionSnapshot, String> {
    Ok(registry
        .get_scoped(&session_id, &scope)?
        .snapshot(after_cursor))
}

#[tauri::command]
pub fn terminal_session_list_scoped(
    registry: tauri::State<'_, TerminalSessionRegistry>,
    scope: TerminalSessionScope,
) -> Result<Vec<TerminalSessionSnapshot>, String> {
    validate_scope_fields(&scope)?;
    Ok(registry
        .list_scoped(&scope)
        .into_iter()
        .map(|session| {
            let end_cursor = lock_unpoisoned(&session.state).ring.end_cursor;
            session.snapshot(Some(end_cursor))
        })
        .collect())
}

#[tauri::command]
pub async fn terminal_session_close(
    registry: tauri::State<'_, TerminalSessionRegistry>,
    session_id: String,
    scope: TerminalSessionScope,
) -> Result<Option<TerminalSessionSnapshot>, String> {
    let session = registry.take_scoped(&session_id, &scope)?;
    if let Some(session) = session {
        let snapshot = tauri::async_runtime::spawn_blocking(move || {
            session.close();
            session.snapshot(None)
        })
        .await
        .map_err(|error| format!("join terminal close task: {error}"))?;
        return Ok(Some(snapshot));
    }
    Ok(None)
}

async fn validate_scope_and_workspace<R: Runtime>(
    app: &tauri::AppHandle<R>,
    scope: &TerminalSessionScope,
) -> Result<PathBuf, String> {
    let pool = crate::local_db::get_offisim_pool(app)?;
    let project = sqlx::query(
        "SELECT project_id FROM projects WHERE project_id = ? AND company_id = ? LIMIT 1",
    )
    .bind(&scope.project_id)
    .bind(&scope.company_id)
    .fetch_optional(&pool)
    .await
    .map_err(|error| format!("validate terminal project scope: {error}"))?;
    if project.is_none() {
        return Err("terminal scope project does not belong to company".to_string());
    }

    if let Some(thread_id) = scope.thread_id.as_deref() {
        let thread = sqlx::query(
            "SELECT thread_id FROM chat_threads WHERE thread_id = ? AND project_id = ? LIMIT 1",
        )
        .bind(thread_id)
        .bind(&scope.project_id)
        .fetch_optional(&pool)
        .await
        .map_err(|error| format!("validate terminal thread scope: {error}"))?;
        if thread.is_none() {
            return Err("terminal scope thread does not belong to project".to_string());
        }
    }

    // Reuse the same canonical and overbroad-root rejection used by project file
    // and one-shot shell commands. A manual PTY starts here but intentionally
    // retains the signed-in user's normal machine permissions; this is not an OS
    // filesystem jail.
    let roots = crate::builtin_tools::workspace_roots(app, Some(&scope.project_id)).await?;
    if roots.len() != 1 {
        return Err("terminal project must have one canonical workspace_root".to_string());
    }
    roots
        .into_iter()
        .next()
        .ok_or_else(|| "terminal project has no workspace_root".to_string())
}

fn validate_scope_fields(scope: &TerminalSessionScope) -> Result<(), String> {
    validate_scope_id("companyId", &scope.company_id)?;
    validate_scope_id("projectId", &scope.project_id)?;
    if let Some(thread_id) = scope.thread_id.as_deref() {
        validate_scope_id("threadId", thread_id)?;
    }
    Ok(())
}

fn validate_scope_id(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > 256 {
        return Err(format!("terminal scope {label} is invalid"));
    }
    Ok(())
}

fn validate_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty()
        || session_id.len() > MAX_SESSION_ID_BYTES
        || !session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("terminal sessionId must contain only letters, digits, '-' or '_'".to_string());
    }
    Ok(())
}

fn validate_size(cols: u16, rows: u16) -> Result<(), String> {
    if !(MIN_TERMINAL_DIMENSION..=MAX_TERMINAL_DIMENSION).contains(&cols)
        || !(MIN_TERMINAL_DIMENSION..=MAX_TERMINAL_DIMENSION).contains(&rows)
    {
        return Err(format!(
            "terminal dimensions must be between {MIN_TERMINAL_DIMENSION} and {MAX_TERMINAL_DIMENSION}"
        ));
    }
    Ok(())
}

fn ensure_scope(session: &TerminalSession, requested: &TerminalSessionScope) -> Result<(), String> {
    if session.scope != *requested {
        return Err("terminal session scope mismatch".to_string());
    }
    Ok(())
}

fn spawn_reader_thread(
    weak: Weak<TerminalSession>,
    mut reader: Box<dyn Read + Send>,
    gate: Arc<StartGate>,
) -> Result<JoinHandle<()>, String> {
    std::thread::Builder::new()
        .name("offisim-terminal-reader".to_string())
        .spawn(move || {
            gate.wait();
            let mut buffer = vec![0_u8; READ_CHUNK_BYTES];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => return,
                    Ok(read) => {
                        let Some(session) = weak.upgrade() else {
                            return;
                        };
                        let bytes = &buffer[..read];
                        let (start_cursor, end_cursor) = {
                            let mut state = lock_unpoisoned(&session.state);
                            state.ring.push(bytes)
                        };
                        (session.event_sink)(TerminalSessionEvent {
                            session_id: session.session_id.clone(),
                            start_cursor,
                            end_cursor,
                            data_base64: Some(BASE64_STANDARD.encode(bytes)),
                            kind: "output".to_string(),
                            status: None,
                            exit_code: None,
                            message: None,
                        });
                    }
                    Err(error) if is_pty_eof_error(&error) => return,
                    Err(error) => {
                        let Some(session) = weak.upgrade() else {
                            return;
                        };
                        let message = format!("read terminal output: {error}");
                        let should_report = {
                            let mut state = lock_unpoisoned(&session.state);
                            if matches!(
                                state.status,
                                SessionStatus::Closing | SessionStatus::Closed
                            ) {
                                false
                            } else {
                                state.status = SessionStatus::Error;
                                state.message = Some(message.clone());
                                true
                            }
                        };
                        if should_report {
                            session.audit("error", None, None, Some(SessionStatus::Error), None);
                            session.emit_lifecycle("error", Some(message));
                        }
                        return;
                    }
                }
            }
        })
        .map_err(|error| format!("spawn terminal reader thread: {error}"))
}

fn spawn_wait_thread(
    weak: Weak<TerminalSession>,
    gate: Arc<StartGate>,
) -> Result<JoinHandle<()>, String> {
    std::thread::Builder::new()
        .name("offisim-terminal-wait".to_string())
        .spawn(move || {
            gate.wait();
            let Some(session) = weak.upgrade() else {
                return;
            };
            let Some(mut child) = lock_unpoisoned(&session.child).take() else {
                return;
            };
            drop(session);
            let result = child.wait();
            let Some(session) = weak.upgrade() else {
                return;
            };
            match result {
                Ok(exit) => {
                    let exit_code = portable_exit_code(&exit);
                    let should_report = {
                        let mut state = lock_unpoisoned(&session.state);
                        state.exit_code = Some(exit_code);
                        if state.status == SessionStatus::Running {
                            state.status = SessionStatus::Exited;
                            true
                        } else {
                            false
                        }
                    };
                    if should_report {
                        session.audit(
                            "exited",
                            None,
                            None,
                            Some(SessionStatus::Exited),
                            Some(exit_code),
                        );
                        session.emit_lifecycle("exited", None);
                    }
                }
                Err(error) => {
                    let message = format!("wait for terminal child: {error}");
                    let should_report = {
                        let mut state = lock_unpoisoned(&session.state);
                        if matches!(state.status, SessionStatus::Closing | SessionStatus::Closed) {
                            false
                        } else {
                            state.status = SessionStatus::Error;
                            state.message = Some(message.clone());
                            true
                        }
                    };
                    if should_report {
                        session.audit("error", None, None, Some(SessionStatus::Error), None);
                        session.emit_lifecycle("error", Some(message));
                    }
                }
            }
        })
        .map_err(|error| format!("spawn terminal wait thread: {error}"))
}

fn event_sink_for<R: Runtime>(app: &tauri::AppHandle<R>) -> EventSink {
    let app = app.clone();
    Arc::new(move |event| {
        // Target only the trusted renderer WebViews. Never broadcast native PTY
        // bytes to remote browser-session children.
        let _ = app.emit_to("main", TERMINAL_EVENT_NAME, event.clone());
        let _ = app.emit_to("main-live", TERMINAL_EVENT_NAME, event);
    })
}

fn native_audit_sink() -> AuditSink {
    Arc::new(append_native_stage_audit)
}

fn append_native_stage_audit(record: TerminalAuditRecord) {
    crate::stage_audit::append(&record);
}

fn portable_exit_code(status: &portable_pty::ExitStatus) -> i32 {
    i32::try_from(status.exit_code()).unwrap_or(i32::MAX)
}

fn is_pty_eof_error(error: &std::io::Error) -> bool {
    #[cfg(unix)]
    {
        // Unix PTYs commonly report EIO, rather than a zero-byte read, after
        // the final slave fd closes. This is terminal EOF, not a failed session.
        error.raw_os_error() == Some(libc::EIO)
    }
    #[cfg(not(unix))]
    {
        let _ = error;
        false
    }
}

fn unix_time_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[cfg(unix)]
const fn libc_esrch() -> i32 {
    libc::ESRCH
}

#[cfg(not(unix))]
const fn libc_esrch() -> i32 {
    // No Unix ESRCH contract on Windows; no portable-pty kill error should
    // match this sentinel.
    i32::MIN
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{Duration, Instant};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(label: &str) -> Self {
            let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "offisim-terminal-{label}-{}-{id}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).expect("create terminal test dir");
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn scope(label: &str) -> TerminalSessionScope {
        TerminalSessionScope {
            company_id: format!("company-{label}"),
            project_id: format!("project-{label}"),
            thread_id: Some(format!("thread-{label}")),
        }
    }

    fn sinks() -> (EventSink, AuditSink) {
        (Arc::new(|_| {}), Arc::new(|_| {}))
    }

    fn decode_snapshot(snapshot: &TerminalSessionSnapshot) -> Vec<u8> {
        snapshot
            .chunks
            .iter()
            .flat_map(|chunk| {
                BASE64_STANDARD
                    .decode(chunk.data_base64.as_bytes())
                    .expect("decode terminal chunk")
            })
            .collect()
    }

    fn wait_for_terminal(session: &TerminalSession, timeout: Duration) -> TerminalSessionSnapshot {
        let deadline = Instant::now() + timeout;
        loop {
            let snapshot = session.snapshot(None);
            if snapshot.status != "running" {
                return snapshot;
            }
            assert!(
                Instant::now() < deadline,
                "terminal did not exit before timeout"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn byte_ring_preserves_split_utf8_as_raw_bytes() {
        let source = "A🙂中Z".as_bytes();
        let mut ring = ByteRing::default();
        ring.push(&source[..3]);
        ring.push(&source[3..6]);
        ring.push(&source[6..]);
        let replay = ring.replay(None);
        let bytes = replay
            .chunks
            .iter()
            .flat_map(|chunk| BASE64_STANDARD.decode(&chunk.data_base64).expect("base64"))
            .collect::<Vec<_>>();
        assert_eq!(bytes, source);
        assert_eq!(replay.start_cursor, 0);
        assert_eq!(replay.end_cursor, source.len() as u64);
        assert!(!replay.gap);
    }

    #[test]
    fn byte_ring_reports_gap_and_monotonic_byte_cursors_after_burst() {
        let mut ring = ByteRing::default();
        let source = vec![0x5a; BYTE_RING_CAPACITY + 257];
        let (start, end) = ring.push(&source);
        assert_eq!(start, 0);
        assert_eq!(end, source.len() as u64);
        let replay = ring.replay(Some(0));
        assert!(replay.gap);
        assert_eq!(replay.start_cursor, 257);
        assert_eq!(replay.end_cursor, source.len() as u64);
        assert_eq!(
            replay
                .chunks
                .iter()
                .map(|chunk| chunk.end_cursor - chunk.start_cursor)
                .sum::<u64>(),
            BYTE_RING_CAPACITY as u64
        );
    }

    #[test]
    fn registry_rejects_scope_forgery() {
        let registry = TerminalSessionRegistry::default();
        let dir = TestDir::new("scope");
        let (events, audits) = sinks();
        let session = registry
            .create_native(
                "scope-session".to_string(),
                scope("a"),
                dir.0.clone(),
                80,
                24,
                events,
                audits,
            )
            .expect("create terminal");
        assert!(registry.get_scoped("scope-session", &scope("b")).is_err());
        assert!(registry.take_scoped("scope-session", &scope("b")).is_err());
        session.close();
    }

    #[test]
    fn input_validation_rejects_oversize_and_invalid_dimensions() {
        assert!(validate_size(0, 24).is_err());
        assert!(validate_size(80, 0).is_err());
        assert!(validate_size(MAX_TERMINAL_DIMENSION + 1, 24).is_err());
        let mut ring = ByteRing::default();
        ring.push(b"safe");
        assert!(BASE64_STANDARD.decode(b"%%%not-base64%%%").is_err());
        assert!(vec![0_u8; MAX_WRITE_BYTES + 1].len() > MAX_WRITE_BYTES);
    }

    #[cfg(unix)]
    #[test]
    fn native_session_streams_input_resizes_replays_and_exits() {
        let registry = TerminalSessionRegistry::default();
        let dir = TestDir::new("roundtrip");
        let (events, audits) = sinks();
        let session = registry
            .create_native(
                "roundtrip-session".to_string(),
                scope("roundtrip"),
                dir.0.clone(),
                80,
                24,
                events,
                audits,
            )
            .expect("create terminal");
        session
            .resize(PtySize {
                rows: 40,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("resize terminal");
        session
            .write_bytes(b"printf '__OFFISIM_PTY_OK__'; exit\r")
            .expect("write terminal input");
        let snapshot = wait_for_terminal(&session, Duration::from_secs(5));
        assert_eq!(snapshot.status, "exited");
        assert_eq!(snapshot.exit_code, Some(0));
        assert!(String::from_utf8_lossy(&decode_snapshot(&snapshot)).contains("__OFFISIM_PTY_OK__"));
        let after = snapshot.start_cursor + 1;
        let reconnect = session.snapshot(Some(after));
        assert_eq!(reconnect.start_cursor, after);
        assert_eq!(reconnect.end_cursor, snapshot.end_cursor);
        session.close();
    }

    #[cfg(unix)]
    #[test]
    fn explicit_close_is_idempotent_and_reaps_shell_process() {
        let registry = TerminalSessionRegistry::default();
        let dir = TestDir::new("close");
        let (events, audits) = sinks();
        let session = registry
            .create_native(
                "close-session".to_string(),
                scope("close"),
                dir.0.clone(),
                80,
                24,
                events,
                audits,
            )
            .expect("create terminal");
        let pid = session.process_group_id.expect("terminal process group");
        session.close();
        session.close();
        let result = unsafe { libc::kill(pid, 0) };
        assert_eq!(result, -1, "closed shell process must be reaped");
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH)
        );
    }

    #[cfg(unix)]
    #[test]
    fn registry_drop_sweeps_running_children() {
        let dir = TestDir::new("drop");
        let pid = {
            let registry = TerminalSessionRegistry::default();
            let (events, audits) = sinks();
            let session = registry
                .create_native(
                    "drop-session".to_string(),
                    scope("drop"),
                    dir.0.clone(),
                    80,
                    24,
                    events,
                    audits,
                )
                .expect("create terminal");
            session.process_group_id.expect("terminal process group")
        };
        let result = unsafe { libc::kill(pid, 0) };
        assert_eq!(result, -1, "registry drop must reap shell process");
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH)
        );
    }
}
