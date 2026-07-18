//! Shared child-process group management.
//!
//! Single source of truth for the configure/signal/guard/terminate pattern
//! previously copy-pasted into `git.rs`, `builtin_tools.rs`,
//! `pi_agent_host/run.rs`, and `codex_agent_host/protocol.rs`. Semantics match
//! the `git.rs` original exactly: every child gets its own process group, the
//! guard SIGKILLs the whole group on drop unless disarmed, and terminate does
//! SIGTERM → bounded wait → SIGKILL → reap fallback.
//!
//! Call-site policy (stdout capping, redaction, signal escalation variants)
//! stays at the call site; this module only owns group lifecycle.

use std::time::Duration;
use tokio::process::{Child, Command};

/// Place the child in its own process group so signals can reach the whole
/// tree. Must be called before spawn.
pub fn configure_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    #[cfg(not(unix))]
    let _ = command;
}

/// Send `signal` to the entire process group. No-op when the group id is
/// unknown or on non-unix targets.
pub fn signal_process_group(process_group_id: Option<u32>, signal: i32) {
    #[cfg(unix)]
    if let Some(pid) = process_group_id {
        // SAFETY: callers assign every child to its own process group via
        // `configure_process_group`, so a negative pid targets only that tree.
        unsafe {
            libc::kill(-(pid as i32), signal);
        }
    }
    #[cfg(not(unix))]
    let _ = (process_group_id, signal);
}

/// Kills the whole process group on drop unless `disarm`ed after a clean reap.
pub struct ProcessGroupGuard(Option<u32>);

impl ProcessGroupGuard {
    pub fn new(process_group_id: Option<u32>) -> Self {
        Self(process_group_id)
    }

    pub fn disarm(&mut self) {
        self.0 = None;
    }
}

impl Drop for ProcessGroupGuard {
    fn drop(&mut self) {
        #[cfg(unix)]
        signal_process_group(self.0, libc::SIGKILL);
    }
}

/// SIGTERM the group, wait up to `grace` for a clean exit, then SIGKILL the
/// group and reap the child unconditionally.
pub async fn terminate_process_group(
    child: &mut Child,
    process_group_id: Option<u32>,
    grace: Duration,
) {
    #[cfg(unix)]
    signal_process_group(process_group_id, libc::SIGTERM);
    let reaped = matches!(tokio::time::timeout(grace, child.wait()).await, Ok(Ok(_)));
    #[cfg(unix)]
    signal_process_group(process_group_id, libc::SIGKILL);
    if !reaped {
        let _ = child.start_kill();
        let _ = child.wait().await;
    }
}
