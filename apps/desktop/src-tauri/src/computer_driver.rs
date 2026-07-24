use serde::Serialize;
use std::collections::BTreeSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerDriverStatus {
    pub installed: bool,
    pub binary_path: Option<String>,
    pub version: Option<String>,
    pub daemon_running: bool,
}

const CUA_DRIVER_PROCESS_NAME: &str = "cua-driver";

#[tauri::command]
pub async fn computer_driver_status() -> Result<ComputerDriverStatus, String> {
    let binary = find_cua_driver_binary();
    let version = match binary.as_ref() {
        Some(path) => command_stdout(path, &["--version"]).await.map(first_line),
        None => None,
    };
    // Checked 2026-07-24: the official CLI reference documents `cua-driver status`
    // as the authoritative daemon-running probe:
    // https://cua.ai/docs/reference/cua-driver/cli-reference
    // Its verdict is authoritative in BOTH directions: a clean non-zero exit means
    // "not running" and must not be overridden by the weaker fallbacks below —
    // otherwise a half-dead daemon (process alive, socket dead) reads as running.
    // Fallbacks only apply when the probe itself is unavailable (missing binary,
    // timeout, spawn failure, killed by signal).
    let status_probe = classify_status_probe(match binary.as_ref() {
        Some(path) => command_exit_output(path, &["status"]).await,
        None => None,
    });
    let daemon_running = match status_probe {
        DaemonProbe::Running => true,
        DaemonProbe::NotRunning => false,
        DaemonProbe::Unavailable => {
            process_probe_daemon_running().await || {
                // Checked 2026-07-24: the install guide says this command reads
                // grants through the daemon and reports `unknown` when no daemon
                // is running: https://cua.ai/docs/how-to-guides/driver/install
                match binary.as_ref() {
                    Some(path) => command_stdout(path, &["permissions", "status"])
                        .await
                        .as_deref()
                        .map(permissions_status_indicates_daemon)
                        .unwrap_or(false),
                    None => false,
                }
            }
        }
    };

    Ok(ComputerDriverStatus {
        installed: binary.is_some(),
        binary_path: binary.map(|path| path.to_string_lossy().to_string()),
        version,
        daemon_running,
    })
}

fn first_line(value: String) -> String {
    value
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default()
        .to_string()
}

async fn command_stdout(path: &Path, args: &[&str]) -> Option<String> {
    match command_exit_output(path, args).await {
        Some((Some(0), output)) => Some(output),
        _ => None,
    }
}

/// `None` when the command could not run at all (timeout / spawn failure);
/// otherwise the exit code (`None` inside = killed by a signal) plus combined output.
async fn command_exit_output(path: &Path, args: &[&str]) -> Option<(Option<i32>, String)> {
    let output = timeout(
        Duration::from_secs(2),
        Command::new(path).args(args).output(),
    )
    .await
    .ok()?
    .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Some((output.status.code(), format!("{stdout}{stderr}")))
}

#[derive(Debug, PartialEq)]
enum DaemonProbe {
    Running,
    NotRunning,
    Unavailable,
}

fn classify_status_probe(result: Option<(Option<i32>, String)>) -> DaemonProbe {
    match result {
        // Probe itself could not run — no verdict either way.
        None | Some((None, _)) => DaemonProbe::Unavailable,
        Some((Some(0), output)) => {
            // Belt over the exit-code contract: an exit-0 "not running" report from
            // a future CLI must not silently become a false Ready.
            let lower = output.to_ascii_lowercase();
            if lower.contains("not running") || lower.contains("no daemon") {
                DaemonProbe::NotRunning
            } else {
                DaemonProbe::Running
            }
        }
        Some((Some(_), _)) => DaemonProbe::NotRunning,
    }
}

fn permissions_status_indicates_daemon(output: &str) -> bool {
    let lower = output.to_ascii_lowercase();
    if lower.contains("unknown") || lower.contains("not running") || lower.contains("no daemon") {
        return false;
    }

    let source_is_daemon = lower.lines().any(|line| {
        line.split_once(':')
            .map(|(label, value)| label.trim() == "source" && value.trim() == "driver-daemon")
            .unwrap_or(false)
    });
    let has_definitive_permission = |permission: &str| {
        lower.lines().any(|line| {
            line.split_once(':')
                .map(|(label, value)| {
                    label.trim() == permission
                        && value.split_whitespace().any(|word| {
                            matches!(word.trim_matches(['.', '✅']), "granted" | "denied")
                        })
                })
                .unwrap_or(false)
        })
    };

    source_is_daemon
        && has_definitive_permission("accessibility")
        && has_definitive_permission("screen recording")
}

fn pgrep_output_indicates_daemon(output: &str) -> bool {
    // Each `pgrep -f -l` line is "PID <argv...>". A daemon match requires the
    // executable (basename) to be exactly `cua-driver` AND its first argument to
    // be `serve` — the daemon-mode discriminator. Plain CLI invocations such as
    // `cua-driver permissions grant` (which the setup panel tells users to run,
    // and which waits long-lived for the grant) or our own short-lived
    // status/version probes must NOT read as a running daemon.
    output.lines().any(|line| {
        let mut fields = line.split_whitespace();
        let pid_is_numeric = fields
            .next()
            .map(|pid| !pid.is_empty() && pid.bytes().all(|byte| byte.is_ascii_digit()))
            .unwrap_or(false);
        let executable_is_cua_driver = fields
            .next()
            .map(|executable| {
                executable.rsplit('/').next().unwrap_or(executable) == CUA_DRIVER_PROCESS_NAME
            })
            .unwrap_or(false);
        pid_is_numeric && executable_is_cua_driver && fields.next() == Some("serve")
    })
}

async fn process_probe_daemon_running() -> bool {
    // Checked 2026-07-24: the install guide names the executable `cua-driver`,
    // while the CLI reference defines `serve` as its long-running daemon mode.
    // `pgrep -f -l` prints the PID plus the full argument list, letting the
    // parser require both the exact executable name and the `serve` argument:
    // https://cua.ai/docs/how-to-guides/driver/install
    // https://cua.ai/docs/reference/cua-driver/cli-reference
    let Ok(result) = timeout(
        Duration::from_secs(2),
        Command::new("pgrep")
            .args(["-f", "-l", CUA_DRIVER_PROCESS_NAME])
            .output(),
    )
    .await
    else {
        return false;
    };
    let Ok(output) = result else {
        return false;
    };
    output.status.success()
        && pgrep_output_indicates_daemon(String::from_utf8_lossy(&output.stdout).as_ref())
}

fn find_cua_driver_binary() -> Option<PathBuf> {
    candidate_cua_driver_paths()
        .into_iter()
        .find(|path| is_executable(path))
}

fn candidate_cua_driver_paths() -> Vec<PathBuf> {
    let mut seen = BTreeSet::new();
    let mut paths = Vec::new();
    if let Some(path_var) = env::var_os("PATH") {
        for dir in env::split_paths(&path_var) {
            let candidate = dir.join("cua-driver");
            if seen.insert(candidate.clone()) {
                paths.push(candidate);
            }
        }
    }
    if let Some(home) = dirs::home_dir() {
        let candidate = home.join(".local/bin/cua-driver");
        if seen.insert(candidate.clone()) {
            paths.push(candidate);
        }
    }
    for candidate in [
        "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
        "/usr/local/bin/cua-driver",
        "/opt/homebrew/bin/cua-driver",
    ] {
        let path = PathBuf::from(candidate);
        if seen.insert(path.clone()) {
            paths.push(path);
        }
    }
    paths
}

fn is_executable(path: &Path) -> bool {
    let Ok(meta) = fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn permissions_status_distinguishes_unknown_daemon_state() {
        assert!(!permissions_status_indicates_daemon(
            "Accessibility: unknown\nScreen Recording: unknown",
        ));
        assert!(!permissions_status_indicates_daemon(
            "Accessibility:\nScreen Recording:",
        ));
        assert!(!permissions_status_indicates_daemon(
            "Accessibility: granted\nScreen Recording: denied",
        ));
        assert!(!permissions_status_indicates_daemon(
            "Accessibility: granted\nScreen Recording: denied\nSource: driver-daemon-stale",
        ));
        assert!(permissions_status_indicates_daemon(
            "Accessibility:    ✅ granted\nScreen Recording: ✅ denied\nSource: driver-daemon",
        ));
    }

    #[test]
    fn process_probe_requires_cua_driver_executable_in_serve_mode() {
        assert!(pgrep_output_indicates_daemon("76213 cua-driver serve\n"));
        assert!(pgrep_output_indicates_daemon(
            "76213 /Applications/CuaDriver.app/Contents/MacOS/cua-driver serve\n",
        ));
        assert!(pgrep_output_indicates_daemon(
            "76213 cua-driver serve --socket /tmp/cua.sock\n",
        ));
        // Non-daemon CLI invocations — including the long-lived `permissions
        // grant` the setup panel tells users to run — must not read as a daemon.
        assert!(!pgrep_output_indicates_daemon(
            "76213 cua-driver permissions grant\n",
        ));
        assert!(!pgrep_output_indicates_daemon("76213 cua-driver status\n"));
        assert!(!pgrep_output_indicates_daemon("76213 cua-driver\n"));
        assert!(!pgrep_output_indicates_daemon("launcher cua-driver serve\n"));
        assert!(!pgrep_output_indicates_daemon("76213 CuaDriver serve\n"));
        assert!(!pgrep_output_indicates_daemon(
            "76213 cua-driver-helper serve\n",
        ));
        assert!(!pgrep_output_indicates_daemon(
            "76213 zsh cua-driver serve\n",
        ));
        assert!(!pgrep_output_indicates_daemon(
            "76213 /usr/bin/tail -f cua-driver-serve.log\n",
        ));
    }

    #[test]
    fn status_probe_classification_covers_all_verdicts() {
        // Probe could not run at all → no verdict, fallbacks may apply.
        assert_eq!(classify_status_probe(None), DaemonProbe::Unavailable);
        // Killed by a signal → probe crashed, not a verdict.
        assert_eq!(
            classify_status_probe(Some((None, String::new()))),
            DaemonProbe::Unavailable
        );
        // Clean exit 0 → running.
        assert_eq!(
            classify_status_probe(Some((
                Some(0),
                "Daemon is running\nSocket: /tmp/cua.sock\nPID: 76213\n".to_string(),
            ))),
            DaemonProbe::Running
        );
        // Exit 0 but the CLI says it is not running → believe the text.
        assert_eq!(
            classify_status_probe(Some((Some(0), "Daemon is not running\n".to_string()))),
            DaemonProbe::NotRunning
        );
        // Clean non-zero exit → authoritative "not running".
        assert_eq!(
            classify_status_probe(Some((Some(1), "Daemon is not running\n".to_string()))),
            DaemonProbe::NotRunning
        );
    }

    #[test]
    fn executable_probe_rejects_missing_path() {
        let id = TEMP_COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!("offisim-missing-cua-driver-{id}"));
        assert!(!is_executable(&path));
    }

    #[cfg(unix)]
    #[test]
    fn executable_probe_accepts_executable_file() {
        use std::os::unix::fs::PermissionsExt;

        let id = TEMP_COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!("offisim-cua-driver-{id}"));
        fs::write(&path, "#!/bin/sh\n").unwrap();
        let mut perms = fs::metadata(&path).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&path, perms).unwrap();
        assert!(is_executable(&path));
        fs::remove_file(path).ok();
    }
}
