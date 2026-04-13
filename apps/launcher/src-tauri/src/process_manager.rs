// NOTE: This launcher is a **dev-mode tool** that assumes a full monorepo checkout
// with pnpm installed. It spawns `pnpm --filter` commands and resolves the repo root
// from CARGO_MANIFEST_DIR. It is NOT yet a distributable binary for end users.
// Future work for distributable mode: bundle pre-built binaries, discover installs
// via config file instead of pnpm workspace, and remove the repo-root assumption.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

use crate::error::LauncherError;
use crate::network;
use crate::port_checker;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LaunchMode {
    Desktop,
    Web,
    WebLan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessStatus {
    Starting,
    Running,
    Stopping,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessInfo {
    pub name: String,
    pub status: ProcessStatus,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    pub started_at_ms: u64,
    pub exit_code: Option<i32>,
    pub external: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LauncherStatus {
    pub active_mode: Option<LaunchMode>,
    pub processes: Vec<ProcessInfo>,
    pub lan_address: Option<String>,
    pub database: DatabaseInfo,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogLine {
    pub id: u64,
    pub process: String,
    pub stream: LogStream,
    pub text: String,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DependencyStatus {
    Healthy,
    Unreachable,
}

#[derive(Debug, Clone, Serialize)]
pub struct DatabaseInfo {
    pub status: DependencyStatus,
    pub address: String,
    pub message: String,
    pub can_start_with_docker: bool,
}

#[derive(Debug, Deserialize)]
struct PlatformHealthResponse {
    status: String,
}

/// Global auto-incrementing ID for log lines (stable React keys).
static LOG_LINE_ID: AtomicU64 = AtomicU64::new(0);

fn next_log_id() -> u64 {
    LOG_LINE_ID.fetch_add(1, Ordering::Relaxed)
}

fn epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ---------------------------------------------------------------------------
// Managed Process
// ---------------------------------------------------------------------------

struct ManagedProcess {
    name: String,
    /// None for externally-started processes the launcher doesn't own.
    child: Option<Child>,
    status: ProcessStatus,
    pid: Option<u32>,
    port: Option<u16>,
    /// Unix epoch ms when the process was registered.
    started_at_ms: u64,
    exit_code: Option<i32>,
    external: bool,
}

impl ManagedProcess {
    fn info(&self) -> ProcessInfo {
        ProcessInfo {
            name: self.name.clone(),
            status: self.status,
            pid: self.pid,
            port: self.port,
            started_at_ms: self.started_at_ms,
            exit_code: self.exit_code,
            external: self.external,
        }
    }
}

// ---------------------------------------------------------------------------
// Launcher State (managed by Tauri)
// ---------------------------------------------------------------------------

pub struct LauncherState {
    processes: Arc<Mutex<HashMap<String, ManagedProcess>>>,
    active_mode: Arc<Mutex<Option<LaunchMode>>>,
    log_buffers: Arc<Mutex<HashMap<String, VecDeque<LogLine>>>>,
    http_client: reqwest::Client,
    repo_root: String,
}

const MAX_LOG_LINES: usize = 5000;
const PLATFORM_PORT: u16 = 4100;
const FRONTEND_PORT: u16 = 5176;
const MARKET_PORT: u16 = 3000;
const TAURI_PORT: u16 = 1420;
const HEALTH_TIMEOUT_SECS: u64 = 15;
const KILL_TIMEOUT_SECS: u64 = 5;
const DATABASE_HOST: &str = "127.0.0.1";
const DATABASE_PORT: u16 = 5432;

impl Clone for LauncherState {
    fn clone(&self) -> Self {
        Self {
            processes: self.processes.clone(),
            active_mode: self.active_mode.clone(),
            log_buffers: self.log_buffers.clone(),
            http_client: self.http_client.clone(),
            repo_root: self.repo_root.clone(),
        }
    }
}

impl LauncherState {
    pub fn new(repo_root: String) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .expect("failed to build HTTP client");

        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            active_mode: Arc::new(Mutex::new(None)),
            log_buffers: Arc::new(Mutex::new(HashMap::new())),
            http_client,
            repo_root,
        }
    }

    // ----- Platform management -----

    /// Ensure Platform is running. Returns Ok(()) if healthy, or an error.
    pub async fn ensure_platform(&self, app: &AppHandle) -> Result<(), LauncherError> {
        // If we already have a platform process that's Starting or Running, skip.
        {
            let procs = self.processes.lock().await;
            if let Some(p) = procs.get("platform") {
                if matches!(p.status, ProcessStatus::Starting | ProcessStatus::Running) {
                    return Ok(());
                }
            }
        }

        if port_checker::is_port_in_use(PLATFORM_PORT) {
            let killed_pids = port_checker::terminate_listeners_on_port(PLATFORM_PORT)?;

            let start = std::time::Instant::now();
            while port_checker::is_port_in_use(PLATFORM_PORT) {
                if start.elapsed().as_secs() >= KILL_TIMEOUT_SECS {
                    return Err(if killed_pids.is_empty() {
                        LauncherError::PortConflict(PLATFORM_PORT)
                    } else {
                        LauncherError::FailedToFreePort(PLATFORM_PORT, killed_pids)
                    });
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }

        self.spawn_platform(app).await?;

        // Wait for health check
        let start = std::time::Instant::now();
        loop {
            if start.elapsed().as_secs() >= HEALTH_TIMEOUT_SECS {
                let mut procs = self.processes.lock().await;
                if let Some(p) = procs.get_mut("platform") {
                    if let Some(ref mut child) = p.child {
                        if let Ok(Some(status)) = child.try_wait() {
                            p.exit_code = status.code();
                        }
                    }
                    p.status = ProcessStatus::Failed;
                }
                return Err(LauncherError::PlatformHealthTimeout(HEALTH_TIMEOUT_SECS));
            }
            if self.check_platform_health().await.is_ok() {
                let mut procs = self.processes.lock().await;
                if let Some(p) = procs.get_mut("platform") {
                    p.status = ProcessStatus::Running;
                }
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    async fn check_platform_health(&self) -> Result<(), LauncherError> {
        let resp = self
            .http_client
            .get(format!("http://localhost:{}/health", PLATFORM_PORT))
            .send()
            .await?;
        let status = resp.status();
        let body = resp.json::<PlatformHealthResponse>().await.ok();
        if body
            .as_ref()
            .is_some_and(|payload| payload.status == "ok" || payload.status == "degraded")
        {
            Ok(())
        } else if status.is_success() {
            Ok(())
        } else {
            Err(LauncherError::PlatformNotOffisim(PLATFORM_PORT))
        }
    }

    async fn spawn_platform(&self, app: &AppHandle) -> Result<(), LauncherError> {
        let existing_cors = std::env::var("CORS_ORIGINS").unwrap_or_default();
        let market = format!("http://localhost:{}", MARKET_PORT);
        let frontend = format!("http://localhost:{}", FRONTEND_PORT);
        let tauri = format!("http://localhost:{}", TAURI_PORT);
        let mut required: Vec<&str> = vec![&market, &frontend, &tauri];
        // Always include the LAN origin so WebLan mode works without
        // restarting platform, and mode-switching stays seamless.
        let lan_origin =
            network::get_lan_address().map(|ip| format!("http://{}:{}", ip, FRONTEND_PORT));
        if let Some(ref origin) = lan_origin {
            required.push(origin);
        }
        let merged = merge_origins(&existing_cors, &required);

        let mut cmd = self.build_pnpm_command(&["--filter", "@offisim/platform", "dev"]);
        cmd.env("CORS_ORIGINS", &merged);

        let child = self.spawn_with_logs("platform", cmd, app).await?;
        let pid = child.id();

        let mut procs = self.processes.lock().await;
        procs.insert(
            "platform".to_string(),
            ManagedProcess {
                name: "platform".to_string(),
                child: Some(child),
                status: ProcessStatus::Starting,
                pid,
                port: Some(PLATFORM_PORT),
                started_at_ms: epoch_ms(),
                exit_code: None,
                external: false,
            },
        );
        Ok(())
    }

    async fn start_platform_for_runtime_launch(&self, app: &AppHandle) {
        if let Err(err) = self.try_start_platform_for_runtime_launch(app).await {
            self.mark_platform_launch_failure(None).await;
            self.append_log_line(
                "platform",
                LogStream::Stderr,
                format!(
                    "[launcher] Optional platform startup failed; continuing runtime launch without platform: {}",
                    err
                ),
                app,
            )
            .await;
        }
    }

    async fn try_start_platform_for_runtime_launch(
        &self,
        app: &AppHandle,
    ) -> Result<(), LauncherError> {
        {
            let procs = self.processes.lock().await;
            if let Some(p) = procs.get("platform") {
                if matches!(p.status, ProcessStatus::Starting | ProcessStatus::Running) {
                    return Ok(());
                }
            }
        }

        if port_checker::is_port_in_use(PLATFORM_PORT) {
            if self.check_platform_health().await.is_ok() {
                self.register_external_platform(ProcessStatus::Running)
                    .await;
            } else {
                self.register_external_platform(ProcessStatus::Failed).await;
                self.append_log_line(
                    "platform",
                    LogStream::Stderr,
                    format!(
                        "[launcher] Port {} is already in use by a non-Offisim service. Skipping optional platform startup.",
                        PLATFORM_PORT
                    ),
                    app,
                )
                .await;
            }
            return Ok(());
        }

        self.spawn_platform(app).await?;
        self.monitor_platform_health_in_background(app.clone());
        Ok(())
    }

    async fn register_external_platform(&self, status: ProcessStatus) {
        let mut procs = self.processes.lock().await;
        procs.insert(
            "platform".to_string(),
            ManagedProcess {
                name: "platform".to_string(),
                child: None,
                status,
                pid: None,
                port: Some(PLATFORM_PORT),
                started_at_ms: epoch_ms(),
                exit_code: None,
                external: true,
            },
        );
    }

    async fn mark_platform_launch_failure(&self, exit_code: Option<i32>) {
        let mut procs = self.processes.lock().await;
        if let Some(proc) = procs.get_mut("platform") {
            proc.status = ProcessStatus::Failed;
            proc.exit_code = exit_code;
        } else {
            procs.insert(
                "platform".to_string(),
                ManagedProcess {
                    name: "platform".to_string(),
                    child: None,
                    status: ProcessStatus::Failed,
                    pid: None,
                    port: Some(PLATFORM_PORT),
                    started_at_ms: epoch_ms(),
                    exit_code,
                    external: false,
                },
            );
        }
    }

    fn monitor_platform_health_in_background(&self, app: AppHandle) {
        let state = self.clone();
        tokio::spawn(async move {
            let start = std::time::Instant::now();
            loop {
                if state.check_platform_health().await.is_ok() {
                    let mut procs = state.processes.lock().await;
                    if let Some(p) = procs.get_mut("platform") {
                        p.status = ProcessStatus::Running;
                    }
                    break;
                }

                let timed_out = start.elapsed().as_secs() >= HEALTH_TIMEOUT_SECS;
                let should_break = {
                    let mut procs = state.processes.lock().await;
                    if let Some(p) = procs.get_mut("platform") {
                        if matches!(p.status, ProcessStatus::Failed | ProcessStatus::Stopped) {
                            true
                        } else if timed_out {
                            if let Some(ref mut child) = p.child {
                                if let Ok(Some(status)) = child.try_wait() {
                                    p.exit_code = status.code();
                                }
                            }
                            p.status = ProcessStatus::Failed;
                            false
                        } else {
                            false
                        }
                    } else {
                        true
                    }
                };

                if should_break {
                    break;
                }

                if timed_out {
                    state
                        .append_log_line(
                            "platform",
                            LogStream::Stderr,
                            format!(
                                "[launcher] Platform health check timed out after {}s. Runtime continues without platform.",
                                HEALTH_TIMEOUT_SECS
                            ),
                            &app,
                        )
                        .await;
                    break;
                }

                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        });
    }

    async fn append_log_line(
        &self,
        process: &str,
        stream: LogStream,
        text: String,
        app: &AppHandle,
    ) {
        let log_line = LogLine {
            id: next_log_id(),
            process: process.to_string(),
            stream,
            text,
            timestamp_ms: epoch_ms(),
        };

        {
            let mut buffers = self.log_buffers.lock().await;
            let buf = buffers
                .entry(process.to_string())
                .or_insert_with(|| VecDeque::with_capacity(MAX_LOG_LINES));
            if buf.len() >= MAX_LOG_LINES {
                buf.pop_front();
            }
            buf.push_back(log_line.clone());
        }

        let event_name = format!("log:{}", process);
        let _ = app.emit(&event_name, &log_line);
    }

    // ----- Mode management -----

    /// Launch the specified mode. Stops any existing mode first.
    pub async fn launch_mode(
        &self,
        mode: LaunchMode,
        app: &AppHandle,
    ) -> Result<(), LauncherError> {
        self.stop_frontend(app).await?;
        if launch_mode_waits_for_platform_health(mode) {
            self.ensure_platform(app).await?;
        } else {
            self.start_platform_for_runtime_launch(app).await;
        }

        let (cmd, port) = match mode {
            LaunchMode::Desktop => {
                let cmd = self.build_pnpm_command(&["--filter", "@offisim/desktop", "dev"]);
                (cmd, FRONTEND_PORT)
            }
            LaunchMode::Web => {
                let cmd = self.build_pnpm_command(&["--filter", "@offisim/web", "dev"]);
                (cmd, FRONTEND_PORT)
            }
            LaunchMode::WebLan => {
                let cmd =
                    self.build_pnpm_command(&["--filter", "@offisim/web", "dev", "--", "--host"]);
                (cmd, FRONTEND_PORT)
            }
        };

        let child = self.spawn_with_logs("frontend", cmd, app).await?;
        let pid = child.id();

        {
            let mut procs = self.processes.lock().await;
            // Remove stale stopped entry from previous mode
            procs.remove("frontend");
            procs.insert(
                "frontend".to_string(),
                ManagedProcess {
                    name: "frontend".to_string(),
                    child: Some(child),
                    status: ProcessStatus::Running,
                    pid,
                    port: Some(port),
                    started_at_ms: epoch_ms(),
                    exit_code: None,
                    external: false,
                },
            );
        }
        {
            let mut active = self.active_mode.lock().await;
            *active = Some(mode);
        }

        Ok(())
    }

    /// Stop the current frontend process (does NOT touch platform).
    /// Keeps the process entry in the map with Stopped status so the frontend
    /// can still observe exit_code and final state.
    pub async fn stop_frontend(&self, _app: &AppHandle) -> Result<(), LauncherError> {
        {
            let mut procs = self.processes.lock().await;
            if let Some(ref mut proc) = procs.get_mut("frontend") {
                if !proc.external {
                    proc.status = ProcessStatus::Stopping;
                    if let Some(ref mut child) = proc.child {
                        kill_process(child).await;
                    }
                    proc.status = ProcessStatus::Stopped;
                    proc.child = None;
                }
            }
        }
        let mut active = self.active_mode.lock().await;
        *active = None;
        Ok(())
    }

    /// Stop all managed processes (frontend + platform).
    pub async fn stop_all(&self, app: &AppHandle) -> Result<(), LauncherError> {
        self.stop_frontend(app).await?;

        let mut procs = self.processes.lock().await;
        if let Some(ref mut proc) = procs.get_mut("platform") {
            if !proc.external {
                proc.status = ProcessStatus::Stopping;
                if let Some(ref mut child) = proc.child {
                    kill_process(child).await;
                }
                proc.status = ProcessStatus::Stopped;
                proc.child = None;
            }
        }
        Ok(())
    }

    /// Restart platform: kill → wait for port release → re-spawn → health check.
    pub async fn restart_platform(&self, app: &AppHandle) -> Result<(), LauncherError> {
        {
            let mut procs = self.processes.lock().await;
            if let Some(ref mut proc) = procs.get_mut("platform") {
                if !proc.external {
                    proc.status = ProcessStatus::Stopping;
                    if let Some(ref mut child) = proc.child {
                        kill_process(child).await;
                    }
                    proc.child = None;
                }
            }
            // Remove after kill so re-spawn starts clean
            procs.remove("platform");
        }

        let start = std::time::Instant::now();
        while port_checker::is_port_in_use(PLATFORM_PORT) {
            if start.elapsed().as_secs() >= KILL_TIMEOUT_SECS {
                return Err(LauncherError::PortConflict(PLATFORM_PORT));
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        self.ensure_platform(app).await
    }

    /// Stop all processes (owned version for cleanup on window close).
    pub async fn stop_all_owned(&self) -> Result<(), LauncherError> {
        let mut procs = self.processes.lock().await;
        for proc in procs.values_mut() {
            if !proc.external {
                if let Some(ref mut child) = proc.child {
                    kill_process(child).await;
                }
                proc.child = None;
                proc.status = ProcessStatus::Stopped;
            }
        }
        procs.clear(); // Full cleanup on exit
        let mut active = self.active_mode.lock().await;
        *active = None;
        Ok(())
    }

    pub async fn start_postgres_with_docker(&self) -> Result<(), LauncherError> {
        let compose_path = self.repo_root_path().join("docker/docker-compose.yml");
        if !compose_path.exists() {
            return Err(LauncherError::DockerComposeFileMissing(
                compose_path.display().to_string(),
            ));
        }

        let output = Command::new("docker")
            .args([
                "compose",
                "-f",
                &compose_path.display().to_string(),
                "up",
                "-d",
                "postgres",
            ])
            .current_dir(&self.repo_root)
            .output()
            .await
            .map_err(|err| {
                if err.kind() == std::io::ErrorKind::NotFound {
                    LauncherError::DockerCliMissing
                } else {
                    LauncherError::Io(err)
                }
            })?;

        if output.status.success() {
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let combined = if stderr.is_empty() {
            stdout
        } else if stdout.is_empty() {
            stderr.clone()
        } else {
            format!("{}\n{}", stderr, stdout)
        };

        if combined.contains("Cannot connect to the Docker daemon")
            || combined.contains("docker daemon")
        {
            return Err(LauncherError::DockerDaemonNotRunning);
        }

        Err(LauncherError::DockerComposeFailed(combined))
    }

    /// Get current launcher status.
    pub async fn get_status(&self) -> LauncherStatus {
        let active_mode = { *self.active_mode.lock().await };
        let database = self.get_database_info().await;
        let procs = self.processes.lock().await;

        let mut processes: Vec<ProcessInfo> = procs.values().map(|p| p.info()).collect();
        processes.sort_by(|a, b| a.name.cmp(&b.name));

        let lan_address = if matches!(active_mode, Some(LaunchMode::WebLan)) {
            network::get_lan_address()
        } else {
            None
        };

        LauncherStatus {
            active_mode,
            processes,
            lan_address,
            database,
        }
    }

    /// Get buffered log lines for a process.
    pub async fn get_logs(&self, process: &str) -> Vec<LogLine> {
        let buffers = self.log_buffers.lock().await;
        buffers
            .get(process)
            .map(|b| b.iter().cloned().collect())
            .unwrap_or_default()
    }

    // ----- Internal helpers -----

    fn build_pnpm_command(&self, args: &[&str]) -> Command {
        let mut cmd = Command::new("pnpm");
        cmd.args(args)
            .current_dir(&self.repo_root)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        // Create a new session so kill(-pgid) only affects this tree,
        // not the launcher itself. tokio::process::Command exposes
        // pre_exec as an inherent method on Unix.
        #[cfg(unix)]
        unsafe {
            cmd.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }

        if let Ok(path) = std::env::var("PATH") {
            cmd.env("PATH", path);
        }
        if let Ok(home) = std::env::var("HOME") {
            cmd.env("HOME", home);
        }
        for key in &[
            "USER",
            "LANG",
            "TERM",
            "SHELL",
            "TMPDIR",
            "NODE_ENV",
            "LC_ALL",
            "LC_CTYPE",
            "DATABASE_URL",
            "BETTER_AUTH_URL",
            "BETTER_AUTH_SECRET",
            "VITE_PLATFORM_API_URL",
        ] {
            if let Ok(val) = std::env::var(key) {
                cmd.env(key, val);
            }
        }
        cmd
    }

    fn repo_root_path(&self) -> PathBuf {
        PathBuf::from(&self.repo_root)
    }

    async fn get_database_info(&self) -> DatabaseInfo {
        let reachable = timeout(
            Duration::from_millis(400),
            TcpStream::connect((DATABASE_HOST, DATABASE_PORT)),
        )
        .await
        .is_ok_and(|result| result.is_ok());
        build_database_info(reachable)
    }

    async fn spawn_with_logs(
        &self,
        name: &str,
        mut cmd: Command,
        app: &AppHandle,
    ) -> Result<Child, LauncherError> {
        let mut child = cmd
            .spawn()
            .map_err(|e| LauncherError::SpawnFailed(name.to_string(), e.to_string()))?;

        let process_name = name.to_string();
        let log_buffers = self.log_buffers.clone();
        let app_handle = app.clone();

        if let Some(stdout) = child.stdout.take() {
            let name = process_name.clone();
            let buffers = log_buffers.clone();
            let app = app_handle.clone();
            tokio::spawn(async move {
                drain_stream(&name, LogStream::Stdout, stdout, buffers, app).await;
            });
        }

        if let Some(stderr) = child.stderr.take() {
            let name = process_name.clone();
            let buffers = log_buffers.clone();
            let app = app_handle.clone();
            tokio::spawn(async move {
                drain_stream(&name, LogStream::Stderr, stderr, buffers, app).await;
            });
        }

        // Watch for process exit
        let procs = self.processes.clone();
        let exit_name = process_name.clone();
        let exit_app = app.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(1)).await;
            loop {
                let should_break = {
                    let mut procs = procs.lock().await;
                    if let Some(p) = procs.get_mut(&exit_name) {
                        if let Some(ref mut child) = p.child {
                            if let Ok(Some(status)) = child.try_wait() {
                                let code = status.code();
                                p.exit_code = code;
                                p.status = if code == Some(0) {
                                    ProcessStatus::Stopped
                                } else {
                                    ProcessStatus::Failed
                                };
                                let _ = exit_app.emit(
                                    "process:exit",
                                    serde_json::json!({
                                        "name": exit_name,
                                        "exit_code": code,
                                        "status": p.status,
                                    }),
                                );
                                true
                            } else {
                                false
                            }
                        } else {
                            // External process — no child to watch
                            true
                        }
                    } else {
                        // Process was removed from map (stopped by user)
                        true
                    }
                };
                if should_break {
                    break;
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        });

        Ok(child)
    }
}

// ---------------------------------------------------------------------------
// Free functions
// ---------------------------------------------------------------------------

/// Graceful shutdown: SIGTERM (process group) → wait → SIGKILL.
/// Uses negative PID on Unix to kill the entire process group (pnpm + Node children).
async fn kill_process(child: &mut Child) {
    if let Some(pid) = child.id() {
        #[cfg(unix)]
        {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGTERM);
            }
        }
        #[cfg(not(unix))]
        {
            let _ = child.kill().await;
        }
    }

    match timeout(Duration::from_secs(KILL_TIMEOUT_SECS), child.wait()).await {
        Ok(_) => {}
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }
}

/// Read lines from a stream and push to log buffer + emit Tauri events.
/// Deduplicates adjacent identical lines within a 500ms window (tsx watch
/// and tauri dev write the same output to both stdout and stderr).
async fn drain_stream<R: tokio::io::AsyncRead + Unpin>(
    process: &str,
    stream: LogStream,
    reader: R,
    buffers: Arc<Mutex<HashMap<String, VecDeque<LogLine>>>>,
    app: AppHandle,
) {
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let now = epoch_ms();

        let log_line = LogLine {
            id: next_log_id(),
            process: process.to_string(),
            stream,
            text: line,
            timestamp_ms: now,
        };

        // Single lock: check-then-insert to avoid TOCTOU race between
        // stdout and stderr drain tasks writing the same line concurrently.
        let is_dup = {
            let mut bufs = buffers.lock().await;
            let buf = bufs
                .entry(process.to_string())
                .or_insert_with(|| VecDeque::with_capacity(MAX_LOG_LINES));
            if let Some(last) = buf.back() {
                if last.text == log_line.text && now.saturating_sub(last.timestamp_ms) < 500 {
                    true
                } else {
                    if buf.len() >= MAX_LOG_LINES {
                        buf.pop_front();
                    }
                    buf.push_back(log_line.clone());
                    false
                }
            } else {
                buf.push_back(log_line.clone());
                false
            }
        };

        if is_dup {
            continue;
        }

        let event_name = format!("log:{}", process);
        let _ = app.emit(&event_name, &log_line);
    }
}

/// Merge CORS origins: take existing comma-separated list, add required ones, deduplicate.
fn merge_origins(existing: &str, required: &[&str]) -> String {
    let mut origins: Vec<String> = existing
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    for r in required {
        let r_str = r.to_string();
        if !origins.contains(&r_str) {
            origins.push(r_str);
        }
    }

    origins.join(",")
}

fn build_database_info(reachable: bool) -> DatabaseInfo {
    let address = format!("{}:{}", DATABASE_HOST, DATABASE_PORT);
    if reachable {
        DatabaseInfo {
            status: DependencyStatus::Healthy,
            address: address.clone(),
            message: format!("Postgres reachable on {}", address),
            can_start_with_docker: false,
        }
    } else {
        DatabaseInfo {
            status: DependencyStatus::Unreachable,
            address: address.clone(),
            message: format!("Postgres unreachable on {}", address),
            can_start_with_docker: true,
        }
    }
}

fn launch_mode_waits_for_platform_health(_mode: LaunchMode) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merge_origins_empty() {
        let result = merge_origins("", &["http://localhost:3000"]);
        assert_eq!(result, "http://localhost:3000");
    }

    #[test]
    fn test_merge_origins_existing() {
        let result = merge_origins(
            "http://example.com,http://localhost:3000",
            &["http://localhost:3000", "http://localhost:5176"],
        );
        assert_eq!(
            result,
            "http://example.com,http://localhost:3000,http://localhost:5176"
        );
    }

    #[test]
    fn test_merge_origins_no_duplicates() {
        let result = merge_origins(
            "http://localhost:5176",
            &["http://localhost:5176", "http://localhost:3000"],
        );
        assert_eq!(result, "http://localhost:5176,http://localhost:3000");
    }

    #[test]
    fn launch_modes_do_not_wait_for_platform_health() {
        assert!(!launch_mode_waits_for_platform_health(LaunchMode::Desktop));
        assert!(!launch_mode_waits_for_platform_health(LaunchMode::Web));
        assert!(!launch_mode_waits_for_platform_health(LaunchMode::WebLan));
    }

    #[test]
    fn database_info_reports_unreachable_and_offers_docker_start() {
        let info = build_database_info(false);
        assert_eq!(info.status, DependencyStatus::Unreachable);
        assert_eq!(info.address, "127.0.0.1:5432");
        assert_eq!(info.message, "Postgres unreachable on 127.0.0.1:5432");
        assert!(info.can_start_with_docker);
    }

    #[test]
    fn database_info_reports_healthy_without_docker_prompt() {
        let info = build_database_info(true);
        assert_eq!(info.status, DependencyStatus::Healthy);
        assert_eq!(info.message, "Postgres reachable on 127.0.0.1:5432");
        assert!(!info.can_start_with_docker);
    }
}
