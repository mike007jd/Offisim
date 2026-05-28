use crate::mcp_bridge::jsonrpc_framer::write_message;
use crate::mcp_bridge::process_manager::{ManagedProcess, ProcessState};
use crate::mcp_bridge::types::JsonRpcMessage;
use rand::Rng;
use tokio::time::{interval, timeout, Duration};

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
    let mut consecutive_failures: u32 = 0;

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
        let mut process = process_handle.lock().await;

        // Signal 1: Process liveness
        if !is_process_alive(&mut process) {
            eprintln!("[mcp_bridge] {} process exited", server_name);
            process.state = ProcessState::Dead;
            break;
        }

        // Signal 2: MCP ping
        let ping_ok = ping_check(&mut process, config.ping_timeout).await;

        if ping_ok {
            if process.state == ProcessState::Unhealthy {
                eprintln!("[mcp_bridge] {} recovered", server_name);
            }
            process.state = ProcessState::Ready;
            consecutive_failures = 0;
            continue;
        }

        // Ping failed
        consecutive_failures += 1;
        process.state = ProcessState::Unhealthy;
        process.consecutive_failures = consecutive_failures;
        eprintln!(
            "[mcp_bridge] {} ping failed (attempt {})",
            server_name, consecutive_failures
        );

        if consecutive_failures >= config.max_retries {
            eprintln!(
                "[mcp_bridge] {} marked dead after {} failures",
                server_name, consecutive_failures
            );
            process.state = ProcessState::Dead;
            break;
        }

        // Attempt reconnect: kill old process, re-spawn
        let old_config = process.config.clone();
        drop(process);

        let delay = backoff_delay(
            consecutive_failures - 1,
            config.base_delay,
            config.max_delay,
        );
        tokio::time::sleep(delay).await;

        // Re-acquire lock and attempt respawn
        let mut servers = registry.lock().await;
        if let Some(old_process) = servers.remove(&server_name) {
            drop(servers);
            old_process.lock().await.kill().await;
            servers = registry.lock().await;
        }

        match ManagedProcess::spawn(old_config.clone()).await {
            Ok(mut new_process) => {
                match new_process.initialize().await {
                    Ok(()) => {
                        eprintln!("[mcp_bridge] {} reconnected successfully", server_name);
                        new_process.state = ProcessState::Ready;
                        consecutive_failures = 0;
                        // This monitor performed the respawn itself, so the
                        // new Arc IS the one this monitor now owns. Rebind
                        // bound_handle to the fresh Arc; otherwise the next
                        // tick's ptr_eq check would treat the in-loop
                        // reconnect as a supersession and break, leaving
                        // the reconnected server with zero health watch.
                        let new_arc =
                            std::sync::Arc::new(tokio::sync::Mutex::new(new_process));
                        servers.insert(server_name.clone(), new_arc.clone());
                        bound_handle = Some(new_arc);
                    }
                    Err(e) => {
                        eprintln!("[mcp_bridge] {} reconnect init failed: {}", server_name, e);
                        // Process spawned but init failed; kill it
                        new_process.kill().await;
                    }
                }
            }
            Err(e) => {
                eprintln!("[mcp_bridge] {} reconnect spawn failed: {}", server_name, e);
            }
        }
    }
}
