use crate::mcp_bridge::jsonrpc_framer::write_message;
use crate::mcp_bridge::process_manager::{ManagedProcess, ProcessState};
use crate::mcp_bridge::types::JsonRpcMessage;
use rand::Rng;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::{interval, timeout, Duration};

type ProcessHandle = Arc<Mutex<ManagedProcess>>;
type SharedRegistry = Arc<Mutex<HashMap<String, ProcessHandle>>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HealthFailure {
    ProcessExited,
    PingFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReconnectFailure {
    Spawn,
    Initialize,
}

#[derive(Debug)]
struct ReconnectAttempts {
    max_retries: u32,
    attempted: u32,
    last_failure: Option<ReconnectFailure>,
}

impl ReconnectAttempts {
    fn new(max_retries: u32) -> Self {
        Self {
            max_retries,
            attempted: 0,
            last_failure: None,
        }
    }

    fn next(&mut self) -> Option<u32> {
        if self.attempted >= self.max_retries {
            return None;
        }
        self.attempted += 1;
        Some(self.attempted)
    }

    fn failed(&mut self, failure: ReconnectFailure) {
        self.last_failure = Some(failure);
    }

    fn attempted(&self) -> u32 {
        self.attempted
    }
}

fn health_failure(process_alive: bool, ping_ok: bool) -> Option<HealthFailure> {
    if !process_alive {
        Some(HealthFailure::ProcessExited)
    } else if !ping_ok {
        Some(HealthFailure::PingFailed)
    } else {
        None
    }
}

fn owns_expected_arc<T>(current: Option<&Arc<T>>, expected: &Arc<T>) -> bool {
    current
        .map(|current| Arc::ptr_eq(current, expected))
        .unwrap_or(false)
}

pub struct HealthConfig {
    pub interval: Duration,
    pub ping_timeout: Duration,
    pub max_retries: u32,
    pub base_delay: Duration,
    pub max_delay: Duration,
}

impl Default for HealthConfig {
    fn default() -> Self {
        Self {
            interval: Duration::from_secs(30),
            ping_timeout: Duration::from_secs(10),
            max_retries: 5,
            base_delay: Duration::from_secs(1),
            max_delay: Duration::from_secs(60),
        }
    }
}

/// Calculate backoff delay with ±20% jitter.
pub fn backoff_delay(attempt: u32, base: Duration, max: Duration) -> Duration {
    let exp = base.as_millis() as u64 * 2u64.pow(attempt.min(10));
    let capped = exp.min(max.as_millis() as u64);
    let jitter = {
        let mut rng = rand::thread_rng();
        let factor: f64 = rng.gen_range(0.8..1.2);
        (capped as f64 * factor) as u64
    };
    Duration::from_millis(jitter)
}

/// Check if process is still alive.
pub fn is_process_alive(process: &mut ManagedProcess) -> bool {
    match process.child.try_wait() {
        Ok(None) => true,     // still running
        Ok(Some(_)) => false, // exited
        Err(_) => false,      // error checking
    }
}

/// Send MCP `ping` request and wait for response.
/// Returns true if ping succeeds within timeout, false otherwise.
pub async fn ping_check(process: &mut ManagedProcess, ping_timeout: Duration) -> bool {
    let ping_id = process.tracker.next_id();
    let rx = process.tracker.register(ping_id);
    let ping_req = JsonRpcMessage::request(ping_id, "ping", serde_json::json!({}));

    if write_message(&mut process.stdin, &ping_req).await.is_err() {
        return false;
    }

    matches!(timeout(ping_timeout, rx).await, Ok(Ok(_)))
}

enum ReconnectOutcome {
    Reconnected(ProcessHandle),
    Superseded,
    Exhausted,
}

async fn registry_owns(
    registry: &SharedRegistry,
    server_name: &str,
    expected: &ProcessHandle,
) -> bool {
    registry
        .lock()
        .await
        .get(server_name)
        .is_some_and(|current| owns_expected_arc(Some(current), expected))
}

async fn set_reconnect_state(process: &ProcessHandle, state: ProcessState, failures: u32) {
    let mut process = process.lock().await;
    process.state = state;
    process.consecutive_failures = failures;
}

/// Retry spawn + initialize without removing the old registry entry. The old
/// handle remains an observable `unhealthy`/`dead` placeholder while recovery is
/// in progress; only a fully initialized replacement is installed. Explicit
/// kill/re-register wins by changing/removing the registry entry, in which case
/// this stale monitor stops and kills any candidate it spawned.
async fn reconnect_with_backoff(
    server_name: &str,
    registry: &SharedRegistry,
    old_handle: &ProcessHandle,
    process_config: crate::mcp_bridge::types::McpProcessConfig,
    health_config: &HealthConfig,
) -> ReconnectOutcome {
    let mut attempts = ReconnectAttempts::new(health_config.max_retries);
    while let Some(attempt) = attempts.next() {
        if !registry_owns(registry, server_name, old_handle).await {
            return ReconnectOutcome::Superseded;
        }

        set_reconnect_state(old_handle, ProcessState::Unhealthy, attempt).await;
        let delay = backoff_delay(
            attempt - 1,
            health_config.base_delay,
            health_config.max_delay,
        );
        tokio::time::sleep(delay).await;

        if !registry_owns(registry, server_name, old_handle).await {
            return ReconnectOutcome::Superseded;
        }

        eprintln!(
            "[mcp_bridge] {} reconnect attempt {}/{}",
            server_name, attempt, health_config.max_retries
        );
        let mut candidate = match ManagedProcess::spawn(process_config.clone()).await {
            Ok(candidate) => candidate,
            Err(error) => {
                attempts.failed(ReconnectFailure::Spawn);
                eprintln!(
                    "[mcp_bridge] {} reconnect spawn failed on attempt {}: {}",
                    server_name, attempt, error
                );
                continue;
            }
        };
        if let Err(error) = candidate.initialize().await {
            attempts.failed(ReconnectFailure::Initialize);
            eprintln!(
                "[mcp_bridge] {} reconnect init failed on attempt {}: {}",
                server_name, attempt, error
            );
            candidate.kill().await;
            continue;
        }

        candidate.state = ProcessState::Ready;
        candidate.consecutive_failures = 0;
        let new_handle = Arc::new(Mutex::new(candidate));
        let installed = {
            let mut servers = registry.lock().await;
            match servers.get(server_name) {
                Some(current) if Arc::ptr_eq(current, old_handle) => {
                    servers.insert(server_name.to_string(), new_handle.clone());
                    true
                }
                _ => false,
            }
        };
        if installed {
            eprintln!("[mcp_bridge] {} reconnected successfully", server_name);
            return ReconnectOutcome::Reconnected(new_handle);
        }

        new_handle.lock().await.kill().await;
        return ReconnectOutcome::Superseded;
    }

    set_reconnect_state(old_handle, ProcessState::Dead, attempts.attempted()).await;
    eprintln!(
        "[mcp_bridge] {} marked dead after {} reconnect attempts",
        server_name,
        attempts.attempted()
    );
    ReconnectOutcome::Exhausted
}

/// Run health monitoring loop for a single server.
/// Must be spawned as a tokio task; accesses the ProcessRegistry to check/update state.
///
/// State machine: Ready → (ping fail) → Unhealthy → (reconnect attempts) → Ready or Dead
pub async fn health_monitor_loop(
    server_name: String,
    registry: std::sync::Arc<
        tokio::sync::Mutex<
            std::collections::HashMap<String, std::sync::Arc<tokio::sync::Mutex<ManagedProcess>>>,
        >,
    >,
    config: HealthConfig,
) {
    let mut tick = interval(config.interval);
    // E/I7: a monitor binds to the specific `Arc<Mutex<ManagedProcess>>` it
    // was spawned for. If `spawn_managed_process` re-inserts the same name
    // with a different process (reconnect / re-register), the *old* monitor
    // would otherwise keep pinging the new process alongside the freshly
    // spawned monitor — two monitors, doubled ping rate, doubled reconnect
    // attempts. We capture the original handle on the first tick and
    // ptr_eq-check on every subsequent tick so each monitor exits as soon
    // as it's been superseded.
    let mut bound_handle: Option<std::sync::Arc<tokio::sync::Mutex<ManagedProcess>>> = None;

    loop {
        tick.tick().await;

        let process_handle = {
            let servers = registry.lock().await;
            servers.get(&server_name).cloned()
        };
        let Some(process_handle) = process_handle else {
            break; // Server removed, stop monitoring
        };
        if let Some(bound) = bound_handle.as_ref() {
            if !std::sync::Arc::ptr_eq(bound, &process_handle) {
                // Registry entry was replaced (reconnect / re-register).
                // The fresh process has its own monitor — this one is stale.
                break;
            }
        } else {
            bound_handle = Some(process_handle.clone());
        }
        let Ok(mut process) = process_handle.try_lock() else {
            continue;
        };

        // Process exit and ping failure share one reconnect state machine. The
        // config is captured before killing the child and remains available even
        // when every respawn attempt fails.
        let process_alive = is_process_alive(&mut process);
        let ping_ok = process_alive && ping_check(&mut process, config.ping_timeout).await;
        match health_failure(process_alive, ping_ok) {
            None => {
                if process.state == ProcessState::Unhealthy {
                    eprintln!("[mcp_bridge] {} recovered", server_name);
                }
                process.state = ProcessState::Ready;
                process.consecutive_failures = 0;
                continue;
            }
            Some(HealthFailure::PingFailed) => {
                eprintln!("[mcp_bridge] {} ping failed", server_name);
            }
            Some(HealthFailure::ProcessExited) => {
                eprintln!("[mcp_bridge] {} process exited", server_name);
            }
        }
        let process_config = process.config.clone();
        process.state = ProcessState::Unhealthy;
        process.consecutive_failures = 0;
        process.kill().await;
        drop(process);

        match reconnect_with_backoff(
            &server_name,
            &registry,
            &process_handle,
            process_config,
            &config,
        )
        .await
        {
            ReconnectOutcome::Reconnected(new_handle) => {
                bound_handle = Some(new_handle);
            }
            ReconnectOutcome::Superseded | ReconnectOutcome::Exhausted => break,
        }
    }
}

#[cfg(test)]
mod reconnect_tests {
    use super::*;

    #[test]
    fn retry_budget_survives_spawn_and_initialize_failures_until_exhausted() {
        let mut attempts = ReconnectAttempts::new(3);
        assert_eq!(attempts.next(), Some(1));
        attempts.failed(ReconnectFailure::Spawn);
        assert_eq!(attempts.next(), Some(2));
        attempts.failed(ReconnectFailure::Initialize);
        assert_eq!(attempts.next(), Some(3));
        assert_eq!(attempts.next(), None);
        assert_eq!(attempts.attempted(), 3);
        assert_eq!(attempts.last_failure, Some(ReconnectFailure::Initialize));
    }

    #[test]
    fn process_exit_and_ping_failure_enter_the_same_reconnect_lane() {
        assert_eq!(
            health_failure(false, false),
            Some(HealthFailure::ProcessExited)
        );
        assert_eq!(health_failure(true, false), Some(HealthFailure::PingFailed));
        assert_eq!(health_failure(true, true), None);
    }

    #[test]
    fn registry_ownership_stops_when_a_process_is_removed_or_superseded() {
        let expected = Arc::new(());
        let replacement = Arc::new(());
        assert!(owns_expected_arc(Some(&expected), &expected));
        assert!(!owns_expected_arc(Some(&replacement), &expected));
        assert!(!owns_expected_arc(None, &expected));
    }
}
