use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    panic::{self, AssertUnwindSafe},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, Runtime};

const STARTUP_LOG_MAX_BYTES: u64 = 512 * 1024;
const DIAGNOSTIC_LOG_TAIL_BYTES: u64 = 128 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupStatus {
    pub mode: &'static str,
    pub incident_id: Option<String>,
    pub stage: Option<String>,
    pub summary: Option<String>,
    pub occurred_at_unix_ms: Option<u128>,
}

impl Default for StartupStatus {
    fn default() -> Self {
        Self {
            mode: "normal",
            incident_id: None,
            stage: None,
            summary: None,
            occurred_at_unix_ms: None,
        }
    }
}

#[derive(Clone, Default)]
pub struct StartupSafetyState {
    inner: Arc<RwLock<StartupStatus>>,
}

impl StartupSafetyState {
    pub fn snapshot(&self) -> StartupStatus {
        self.inner
            .read()
            .map(|status| status.clone())
            .unwrap_or_else(|_| StartupStatus {
                mode: "safe",
                incident_id: Some("startup-state-poisoned".into()),
                stage: Some("startup-state".into()),
                summary: Some("Startup recovery state became unavailable.".into()),
                occurred_at_unix_ms: Some(now_unix_ms()),
            })
    }

    pub fn enter_safe_mode(&self, stage: &str, detail: &str) {
        let timestamp = now_unix_ms();
        let sanitized = sanitize_diagnostic_text(detail);
        let incident_id = format!("offisim-{timestamp}");
        if let Ok(mut status) = self.inner.write() {
            *status = StartupStatus {
                mode: "safe",
                incident_id: Some(incident_id.clone()),
                stage: Some(stage.to_string()),
                summary: Some(user_summary(stage, &sanitized)),
                occurred_at_unix_ms: Some(timestamp),
            };
        }
        append_startup_log(&format!(
            "{timestamp} SAFE incident={incident_id} stage={stage} detail={sanitized}\n"
        ));
    }

    pub fn is_safe_mode(&self) -> bool {
        self.snapshot().mode == "safe"
    }
}

fn user_summary(stage: &str, detail: &str) -> String {
    let detail = detail.lines().next().unwrap_or(detail).trim();
    let detail = if detail.len() > 320 {
        format!("{}…", &detail[..detail.floor_char_boundary(320)])
    } else {
        detail.to_string()
    };
    format!("Offisim could not finish {stage}: {detail}")
}

fn panic_payload(payload: &(dyn std::any::Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|value| (*value).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "Rust panic with a non-text payload".to_string())
}

pub fn install_panic_hook(state: StartupSafetyState) {
    let previous = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|value| format!("{}:{}", value.file(), value.line()))
            .unwrap_or_else(|| "unknown location".into());
        state.enter_safe_mode(
            "Rust runtime",
            &format!("{} at {location}", panic_payload(info.payload())),
        );
        previous(info);
    }));
}

pub fn catch_setup_failure<F>(state: &StartupSafetyState, setup: F) -> bool
where
    F: FnOnce() -> Result<(), String>,
{
    match panic::catch_unwind(AssertUnwindSafe(setup)) {
        Ok(Ok(())) => true,
        Ok(Err(error)) => {
            state.enter_safe_mode("startup initialization", &error);
            false
        }
        Err(payload) => {
            state.enter_safe_mode("startup initialization", &panic_payload(payload.as_ref()));
            false
        }
    }
}

pub fn append_normal_startup_log() {
    append_startup_log(&format!(
        "{} START version={}\n",
        now_unix_ms(),
        env!("CARGO_PKG_VERSION")
    ));
}

#[tauri::command]
pub fn startup_status(state: tauri::State<'_, StartupSafetyState>) -> StartupStatus {
    state.snapshot()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticExport {
    path: String,
    display_path: String,
    file_name: String,
    size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseMetadata {
    exists: bool,
    size_bytes: Option<u64>,
    modified_at_unix_ms: Option<u128>,
    sqlite_header_valid: Option<bool>,
    user_version: Option<u32>,
    wal_exists: bool,
    wal_size_bytes: Option<u64>,
    shm_exists: bool,
    shm_size_bytes: Option<u64>,
}

#[tauri::command]
pub async fn startup_export_diagnostics<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, StartupSafetyState>,
) -> Result<DiagnosticExport, String> {
    let downloads = app
        .path()
        .download_dir()
        .map_err(|error| format!("Resolve Downloads folder: {error}"))?;
    let output_dir = downloads.join("Offisim Diagnostics");
    fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Create diagnostics folder: {error}"))?;

    let timestamp = now_unix_ms();
    let staging = output_dir.join(format!(".offisim-diagnostics-{timestamp}"));
    fs::create_dir(&staging).map_err(|error| format!("Create diagnostics staging: {error}"))?;

    let result = write_diagnostics(&app, &state, &staging).and_then(|file_name| {
        let destination = output_dir.join(&file_name);
        let status = Command::new("/usr/bin/ditto")
            .args(["-c", "-k", "--sequesterRsrc"])
            .arg(&staging)
            .arg(&destination)
            .status()
            .map_err(|error| format!("Launch diagnostic archiver: {error}"))?;
        if !status.success() {
            return Err(format!("Diagnostic archiver exited with {status}"));
        }
        let metadata = destination
            .metadata()
            .map_err(|error| format!("Inspect diagnostic archive: {error}"))?;
        Ok(DiagnosticExport {
            path: destination.to_string_lossy().to_string(),
            display_path: display_path(&destination),
            file_name,
            size_bytes: metadata.len(),
        })
    });
    let _ = fs::remove_dir_all(&staging);
    result
}

fn write_diagnostics<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &StartupSafetyState,
    staging: &Path,
) -> Result<String, String> {
    let status = state.snapshot();
    write_json(staging.join("incident.json"), &status)?;
    write_json(staging.join("database-metadata.json"), &database_metadata())?;
    let environment = serde_json::json!({
        "appVersion": app.package_info().version.to_string(),
        "appName": app.package_info().name,
        "os": std::env::consts::OS,
        "architecture": std::env::consts::ARCH,
        "macOSVersion": macos_version(),
        "installedInApplications": std::env::current_exe()
            .ok()
            .is_some_and(|path| path.starts_with("/Applications/Offisim.app/")),
        "exportedAtUnixMs": now_unix_ms(),
    });
    write_json(staging.join("environment.json"), &environment)?;
    fs::write(
        staging.join("startup.log"),
        sanitize_diagnostic_text(&read_startup_log_tail()),
    )
    .map_err(|error| format!("Write diagnostic log: {error}"))?;
    fs::write(
        staging.join("README.txt"),
        "Offisim startup diagnostic bundle\n\nThis archive contains a sanitized startup log, app/OS environment summary, and SQLite metadata only. It contains no database rows, credentials, environment variables, project files, conversations, or native agent data.\n",
    )
    .map_err(|error| format!("Write diagnostic README: {error}"))?;
    Ok(format!("offisim-diagnostics-{}.zip", now_unix_ms()))
}

fn write_json(path: PathBuf, value: &impl Serialize) -> Result<(), String> {
    let body = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Serialize diagnostic data: {error}"))?;
    fs::write(path, sanitize_diagnostic_text(&body))
        .map_err(|error| format!("Write diagnostic data: {error}"))
}

#[tauri::command]
pub fn startup_reset_local_data<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, StartupSafetyState>,
) -> Result<(), String> {
    if !state.is_safe_mode() {
        return Err("Local data reset is available only in startup safe mode.".into());
    }
    let root = crate::local_paths::offisim_home_dir()?;
    let expected = dirs::home_dir()
        .ok_or_else(|| "Resolve home directory".to_string())?
        .join(".offisim");
    if root != expected || root.file_name().and_then(|name| name.to_str()) != Some(".offisim") {
        return Err("Refusing to reset an unexpected local data path.".into());
    }
    if root.exists() {
        let metadata = fs::symlink_metadata(&root)
            .map_err(|error| format!("Inspect local data before reset: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(
                "Refusing to reset local data because ~/.offisim is not a real directory.".into(),
            );
        }
        fs::remove_dir_all(&root).map_err(|error| format!("Reset local data: {error}"))?;
    }
    fs::create_dir_all(root.join("logs"))
        .map_err(|error| format!("Recreate local data directory: {error}"))?;
    append_startup_log(&format!("{} RESET local-data\n", now_unix_ms()));
    app.restart();
}

fn database_metadata() -> DatabaseMetadata {
    let Ok(path) = crate::local_paths::offisim_home_dir().map(|root| root.join("offisim.db"))
    else {
        return DatabaseMetadata {
            exists: false,
            size_bytes: None,
            modified_at_unix_ms: None,
            sqlite_header_valid: None,
            user_version: None,
            wal_exists: false,
            wal_size_bytes: None,
            shm_exists: false,
            shm_size_bytes: None,
        };
    };
    database_metadata_at(&path)
}

fn database_metadata_at(path: &Path) -> DatabaseMetadata {
    let metadata = path.metadata().ok();
    let mut header = [0_u8; 100];
    let header_read = fs::File::open(path)
        .and_then(|mut file| file.read_exact(&mut header))
        .is_ok();
    let header_valid = header_read.then(|| header.starts_with(b"SQLite format 3\0"));
    let user_version = header_valid
        .filter(|valid| *valid)
        .map(|_| u32::from_be_bytes([header[60], header[61], header[62], header[63]]));
    let wal = path.with_extension("db-wal");
    let shm = path.with_extension("db-shm");
    DatabaseMetadata {
        exists: metadata.is_some(),
        size_bytes: metadata.as_ref().map(|value| value.len()),
        modified_at_unix_ms: metadata
            .as_ref()
            .and_then(|value| value.modified().ok())
            .and_then(system_time_unix_ms),
        sqlite_header_valid: header_valid,
        user_version,
        wal_exists: wal.exists(),
        wal_size_bytes: wal.metadata().ok().map(|value| value.len()),
        shm_exists: shm.exists(),
        shm_size_bytes: shm.metadata().ok().map(|value| value.len()),
    }
}

fn sanitize_diagnostic_text(text: &str) -> String {
    let mut sanitized = crate::redaction::redact_secret_tokens(
        text,
        true,
        &[
            "secret",
            "password",
            "credential",
            "authorization",
            "ghp_",
            "gho_",
            "github_pat_",
        ],
    );
    if let Some(home) = dirs::home_dir().and_then(|path| path.to_str().map(str::to_string)) {
        sanitized = sanitized.replace(&home, "~");
    }
    sanitized
}

fn startup_log_path() -> Option<PathBuf> {
    crate::local_paths::offisim_home_dir()
        .ok()
        .map(|root| root.join("logs/startup.log"))
}

fn append_startup_log(line: &str) {
    let Some(path) = startup_log_path() else {
        return;
    };
    let Some(parent) = path.parent() else {
        return;
    };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    if path
        .metadata()
        .is_ok_and(|metadata| metadata.len() > STARTUP_LOG_MAX_BYTES)
    {
        let _ = fs::rename(&path, path.with_extension("log.previous"));
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(sanitize_diagnostic_text(line).as_bytes());
    }
}

fn read_startup_log_tail() -> String {
    let Some(path) = startup_log_path() else {
        return "Startup log path unavailable.\n".into();
    };
    let Ok(bytes) = fs::read(path) else {
        return "No startup log was available.\n".into();
    };
    let start = bytes
        .len()
        .saturating_sub(DIAGNOSTIC_LOG_TAIL_BYTES as usize);
    String::from_utf8_lossy(&bytes[start..]).to_string()
}

fn display_path(path: &Path) -> String {
    let raw = path.to_string_lossy().to_string();
    dirs::home_dir()
        .and_then(|home| home.to_str().map(str::to_string))
        .filter(|home| raw.starts_with(home))
        .map(|home| format!("~{}", &raw[home.len()..]))
        .unwrap_or(raw)
}

fn macos_version() -> Option<String> {
    Command::new("/usr/bin/sw_vers")
        .args(["-productVersion"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn now_unix_ms() -> u128 {
    // Canonical clock is i64 (non-negative in practice); this lane keeps u128.
    crate::time_util::now_unix_ms() as u128
}

fn system_time_unix_ms(value: SystemTime) -> Option<u128> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_text_redacts_home_and_secret_shapes() {
        let home = dirs::home_dir().expect("home");
        let text = format!(
            "path={}/.offisim token=gho_abcdefghijklmnopqrstuvwxyz123456",
            home.display()
        );
        let sanitized = sanitize_diagnostic_text(&text);
        assert!(sanitized.contains("~/.offisim"));
        assert!(!sanitized.contains("gho_abcdefghijklmnopqrstuvwxyz123456"));
        assert!(sanitized.contains("[REDACTED]"));
    }

    #[test]
    fn database_metadata_reads_only_header_fields() {
        let root = std::env::temp_dir().join(format!("offisim-db-meta-{}", now_unix_ms()));
        fs::create_dir_all(&root).expect("fixture root");
        let path = root.join("offisim.db");
        let mut bytes = vec![0_u8; 100];
        bytes[..16].copy_from_slice(b"SQLite format 3\0");
        bytes[60..64].copy_from_slice(&18_u32.to_be_bytes());
        fs::write(&path, bytes).expect("fixture db");
        let metadata = database_metadata_at(&path);
        assert_eq!(metadata.sqlite_header_valid, Some(true));
        assert_eq!(metadata.user_version, Some(18));
        fs::remove_dir_all(root).expect("remove fixture");
    }
}
