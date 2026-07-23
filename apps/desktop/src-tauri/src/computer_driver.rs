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
    let status_probe_running = match binary.as_ref() {
        Some(path) => command_stdout(path, &["status"]).await.is_some(),
        None => false,
    };
    let daemon_running = if status_probe_running {
        true
    } else if process_probe_daemon_running().await {
        true
    } else {
        // Checked 2026-07-24: the install guide says this command reads grants
        // through the daemon and reports `unknown` when no daemon is running:
        // https://cua.ai/docs/how-to-guides/driver/install
        match binary.as_ref() {
            Some(path) => command_stdout(path, &["permissions", "status"])
                .await
                .as_deref()
                .map(permissions_status_indicates_daemon)
                .unwrap_or(false),
            None => false,
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
    let output = timeout(
        Duration::from_secs(2),
        Command::new(path).args(args).output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Some(format!("{stdout}{stderr}"))
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
    output.lines().any(|line| {
        let mut fields = line.split_whitespace();
        fields
            .next()
            .map(|pid| !pid.is_empty() && pid.bytes().all(|byte| byte.is_ascii_digit()))
            .unwrap_or(false)
            && fields.next() == Some(CUA_DRIVER_PROCESS_NAME)
            && fields.next().is_none()
    })
}

async fn process_probe_daemon_running() -> bool {
    // Checked 2026-07-24: the install guide names the executable `cua-driver`,
    // while the CLI reference defines `serve` as its long-running daemon mode.
    // `pgrep -x` therefore uses the exact executable name instead of matching
    // arbitrary command lines containing driver or serve text:
    // https://cua.ai/docs/how-to-guides/driver/install
    // https://cua.ai/docs/reference/cua-driver/cli-reference
    let Ok(result) = timeout(
        Duration::from_secs(2),
        Command::new("pgrep")
            .args(["-x", "-l", CUA_DRIVER_PROCESS_NAME])
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
    fn exact_process_probe_accepts_only_cua_driver_process_name() {
        assert!(pgrep_output_indicates_daemon("76213 cua-driver\n"));
        assert!(!pgrep_output_indicates_daemon("launcher cua-driver\n"));
        assert!(!pgrep_output_indicates_daemon("76213 CuaDriver\n"));
        assert!(!pgrep_output_indicates_daemon("76213 cua-driver-helper\n",));
        assert!(!pgrep_output_indicates_daemon(
            "76213 zsh cua-driver serve\n",
        ));
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
