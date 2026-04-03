use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum LauncherError {
    #[error("Process '{0}' failed to start: {1}")]
    SpawnFailed(String, String),

    #[error("Process '{0}' not found")]
    ProcessNotFound(String),

    #[error("Port {0} is already in use by another application")]
    PortConflict(u16),

    #[error("Port {0} stayed busy after stopping existing listener(s): {1:?}")]
    FailedToFreePort(u16, Vec<u32>),

    #[error("Platform health check failed after {0}s")]
    PlatformHealthTimeout(u64),

    #[error("Platform on port {0} is not an Offisim instance")]
    PlatformNotOffisim(u16),

    #[error("No active mode to stop")]
    NoActiveMode,

    #[error("Docker CLI is not installed or not on PATH")]
    DockerCliMissing,

    #[error("Docker daemon is not running")]
    DockerDaemonNotRunning,

    #[error("docker-compose file not found at {0}")]
    DockerComposeFileMissing(String),

    #[error("Failed to start Postgres with Docker: {0}")]
    DockerComposeFailed(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
}

/// Serializable version sent to the frontend via Tauri IPC.
#[derive(Debug, Serialize, Clone)]
pub struct LauncherErrorPayload {
    pub code: String,
    pub message: String,
}

impl From<&LauncherError> for LauncherErrorPayload {
    fn from(e: &LauncherError) -> Self {
        let code = match e {
            LauncherError::SpawnFailed(..) => "SPAWN_FAILED",
            LauncherError::ProcessNotFound(_) => "PROCESS_NOT_FOUND",
            LauncherError::PortConflict(_) => "PORT_CONFLICT",
            LauncherError::FailedToFreePort(..) => "FAILED_TO_FREE_PORT",
            LauncherError::PlatformHealthTimeout(_) => "PLATFORM_HEALTH_TIMEOUT",
            LauncherError::PlatformNotOffisim(_) => "PLATFORM_NOT_OFFISIM",
            LauncherError::NoActiveMode => "NO_ACTIVE_MODE",
            LauncherError::DockerCliMissing => "DOCKER_CLI_MISSING",
            LauncherError::DockerDaemonNotRunning => "DOCKER_DAEMON_NOT_RUNNING",
            LauncherError::DockerComposeFileMissing(_) => "DOCKER_COMPOSE_FILE_MISSING",
            LauncherError::DockerComposeFailed(_) => "DOCKER_COMPOSE_FAILED",
            LauncherError::Io(_) => "IO_ERROR",
            LauncherError::Http(_) => "HTTP_ERROR",
        };
        Self {
            code: code.to_string(),
            message: e.to_string(),
        }
    }
}

impl From<LauncherError> for tauri::ipc::InvokeError {
    fn from(e: LauncherError) -> Self {
        let payload = LauncherErrorPayload::from(&e);
        tauri::ipc::InvokeError::from(serde_json::to_value(payload).unwrap_or_default())
    }
}
