use super::persistence::host_error_message;
use super::*;

const MAX_RESUME_SESSION_HEADER_BYTES: u64 = 64 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ResumePrestartFailureKind {
    SessionMissing,
    SessionInvalid,
    RuntimeIncompatible,
    ContextInvalid,
    Conflict,
    Persistence,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ResettableNativeSessionPrestartCode {
    Missing,
    Invalid,
    RuntimeIncompatible,
    ContextInvalid,
}

impl ResettableNativeSessionPrestartCode {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "native-session-missing" => Some(Self::Missing),
            "native-session-invalid" => Some(Self::Invalid),
            "native-session-runtime-incompatible" => Some(Self::RuntimeIncompatible),
            "native-session-context-invalid" => Some(Self::ContextInvalid),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Missing => "native-session-missing",
            Self::Invalid => "native-session-invalid",
            Self::RuntimeIncompatible => "native-session-runtime-incompatible",
            Self::ContextInvalid => "native-session-context-invalid",
        }
    }
}

impl ResumePrestartFailureKind {
    pub(super) fn code(self) -> &'static str {
        match self {
            Self::SessionMissing => "resume-prestart-session-missing",
            Self::SessionInvalid => "resume-prestart-session-invalid",
            Self::RuntimeIncompatible => "resume-prestart-runtime-incompatible",
            Self::ContextInvalid => "resume-prestart-context-invalid",
            Self::Conflict => "resume-prestart-conflict",
            Self::Persistence => "resume-prestart-persistence",
        }
    }

    pub(super) fn compatibility_reason(self) -> &'static str {
        match self {
            Self::SessionMissing => "session_missing",
            Self::SessionInvalid => "session_invalid",
            Self::RuntimeIncompatible => "runtime_incompatible",
            Self::ContextInvalid => "resume_context_invalid",
            Self::Conflict => "resume_conflict",
            Self::Persistence => "resume_persistence_unavailable",
        }
    }

    pub(super) fn native_session_code(self) -> &'static str {
        match self {
            Self::SessionMissing => ResettableNativeSessionPrestartCode::Missing.as_str(),
            Self::SessionInvalid => ResettableNativeSessionPrestartCode::Invalid.as_str(),
            Self::RuntimeIncompatible => {
                ResettableNativeSessionPrestartCode::RuntimeIncompatible.as_str()
            }
            Self::ContextInvalid => ResettableNativeSessionPrestartCode::ContextInvalid.as_str(),
            Self::Conflict => "native-session-conflict",
            Self::Persistence => "native-session-persistence",
        }
    }
}

#[derive(Debug)]
pub(super) struct ResumePrestartFailure {
    kind: ResumePrestartFailureKind,
    message: String,
}

impl ResumePrestartFailure {
    pub(super) fn new(kind: ResumePrestartFailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub(super) fn into_host_error(self) -> HostError {
        HostError::ResumePrestart {
            code: self.kind.code(),
            message: self.message,
        }
    }

    pub(super) fn into_native_session_host_error(self) -> HostError {
        HostError::NativeSessionPrestart {
            code: self.kind.native_session_code(),
            message: self.message,
        }
    }
}

pub(super) fn classify_resume_database_failure(
    error: sqlx::Error,
    action: &str,
) -> ResumePrestartFailure {
    if matches!(
        &error,
        sqlx::Error::Database(database_error) if database_error.is_unique_violation()
    ) {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::Conflict,
            "This Conversation already has another running root or this interrupted task was already resumed.",
        )
    } else {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::Persistence,
            format!("{action}: {error}"),
        )
    }
}

pub(super) struct ResumeRootExpectation<'a> {
    pub(super) history_id: &'a str,
    pub(super) original_request_id: &'a str,
    pub(super) company_id: &'a str,
    pub(super) project_id: &'a str,
    pub(super) thread_id: &'a str,
    pub(super) turn_id: &'a str,
    pub(super) access: &'a str,
    pub(super) source: &'a str,
    pub(super) reason_code: &'a str,
}

pub(super) struct ValidatedResumeRoot {
    pub(super) context: serde_json::Value,
    pub(super) native_session: NativeSessionReference,
    pub(super) stored_session_file: Option<String>,
}

pub(super) fn context_string_matches(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
    expected: &str,
) -> bool {
    object.get(key).and_then(serde_json::Value::as_str) == Some(expected)
}

pub(super) fn validate_exact_native_session_file(
    expected_session_dir: &Path,
    stored_session_file: Option<&str>,
) -> Result<(PathBuf, String, String), ResumePrestartFailure> {
    let stored_session_file = stored_session_file
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::SessionMissing,
                "The Conversation has no saved native Pi session reference.",
            )
        })?
        .to_string();
    let stored_path = Path::new(&stored_session_file);
    if !stored_path.is_absolute() {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::SessionInvalid,
            "The saved native Pi session reference is invalid.",
        ));
    }
    let stored_metadata = match std::fs::symlink_metadata(stored_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(ResumePrestartFailure::new(
                ResumePrestartFailureKind::SessionMissing,
                "The saved native Pi session no longer exists.",
            ));
        }
        Err(error) => {
            return Err(ResumePrestartFailure::new(
                ResumePrestartFailureKind::SessionInvalid,
                format!("Inspect the saved native Pi session: {error}"),
            ));
        }
    };
    if stored_metadata.file_type().is_symlink() || !stored_metadata.is_file() {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::SessionInvalid,
            "The saved native Pi session is not a regular session file.",
        ));
    }
    let canonical_session_dir = match expected_session_dir.canonicalize() {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(ResumePrestartFailure::new(
                ResumePrestartFailureKind::SessionMissing,
                "The Conversation native Pi session directory no longer exists.",
            ));
        }
        Err(error) => {
            return Err(ResumePrestartFailure::new(
                ResumePrestartFailureKind::SessionInvalid,
                format!("Inspect the Conversation native Pi session directory: {error}"),
            ));
        }
    };
    let canonical_session_file = stored_path.canonicalize().map_err(|error| {
        let kind = if error.kind() == std::io::ErrorKind::NotFound {
            ResumePrestartFailureKind::SessionMissing
        } else {
            ResumePrestartFailureKind::SessionInvalid
        };
        ResumePrestartFailure::new(
            kind,
            format!("Resolve the saved native Pi session: {error}"),
        )
    })?;
    if canonical_session_file.parent() != Some(canonical_session_dir.as_path())
        || canonical_session_file
            .extension()
            .and_then(|value| value.to_str())
            != Some("jsonl")
    {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::SessionInvalid,
            "The saved native Pi session escaped its Conversation session directory.",
        ));
    }
    let file = std::fs::File::open(&canonical_session_file).map_err(|error| {
        let kind = if error.kind() == std::io::ErrorKind::NotFound {
            ResumePrestartFailureKind::SessionMissing
        } else {
            ResumePrestartFailureKind::SessionInvalid
        };
        ResumePrestartFailure::new(kind, format!("Open the saved native Pi session: {error}"))
    })?;
    let mut first_line = String::new();
    let mut limited = std::io::Read::take(
        std::io::BufReader::new(file),
        MAX_RESUME_SESSION_HEADER_BYTES + 1,
    );
    std::io::BufRead::read_line(&mut limited, &mut first_line).map_err(|error| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::SessionInvalid,
            format!("Read the saved native Pi session header: {error}"),
        )
    })?;
    if first_line.len() as u64 > MAX_RESUME_SESSION_HEADER_BYTES {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::SessionInvalid,
            "The saved native Pi session header is invalid.",
        ));
    }
    let header: serde_json::Value = serde_json::from_str(first_line.trim_end()).map_err(|_| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::SessionInvalid,
            "The saved native Pi session header is invalid.",
        )
    })?;
    let session_id = header
        .get("id")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let valid_header = header.get("type").and_then(serde_json::Value::as_str) == Some("session")
        && session_id.is_some()
        && header
            .get("cwd")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|value| !value.trim().is_empty());
    if !valid_header {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::SessionInvalid,
            "The saved native Pi session header is invalid.",
        ));
    }
    Ok((
        canonical_session_file,
        stored_session_file,
        session_id.expect("validated native session id").to_string(),
    ))
}

pub(super) fn validate_conversation_native_session(
    runtime_context_json: Option<&str>,
    stored_session_file: Option<&str>,
    expected_session_dir: &Path,
) -> Result<(PathBuf, String), ResumePrestartFailure> {
    let context: serde_json::Value = runtime_context_json
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::ContextInvalid,
                "The saved Conversation native session context is missing.",
            )
        })?
        .parse()
        .map_err(|_| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::ContextInvalid,
                "The saved Conversation native session context is invalid.",
            )
        })?;
    let context_object = context.as_object().ok_or_else(|| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::ContextInvalid,
            "The saved Conversation native session context is invalid.",
        )
    })?;
    let compatible_runtime =
        context_string_matches(context_object, "runtime", AGENT_RUNTIME_CONTEXT_ID)
            && context_object
                .get("wireProtocolVersion")
                .and_then(serde_json::Value::as_u64)
                == Some(u64::from(crate::pi_agent_host::PI_HOST_PROTOCOL_VERSION));
    if !compatible_runtime {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::RuntimeIncompatible,
            "The saved Conversation session belongs to another or incompatible native Agent runtime.",
        ));
    }
    let (session_file, _stored_session_file, session_id) =
        validate_exact_native_session_file(expected_session_dir, stored_session_file)?;
    if !context_string_matches(context_object, "nativeSessionId", &session_id) {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::SessionInvalid,
            "The saved Conversation native session identity no longer matches its session file.",
        ));
    }
    Ok((session_file, session_id))
}

pub(super) fn validate_conversation_opaque_native_session(
    runtime_context_json: Option<&str>,
    stored_session_file: Option<&str>,
    expected_engine_id: &str,
    expected_account_id: &str,
    expected_billing_mode: &str,
    expected_protocol_version: u64,
) -> Result<Option<String>, ResumePrestartFailure> {
    let context: serde_json::Value = runtime_context_json
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::ContextInvalid,
                "The saved Conversation native session context is missing.",
            )
        })?
        .parse()
        .map_err(|_| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::ContextInvalid,
                "The saved Conversation native session context is invalid.",
            )
        })?;
    let context_object = context.as_object().ok_or_else(|| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::ContextInvalid,
            "The saved Conversation native session context is invalid.",
        )
    })?;
    let execution_target = context_object
        .get("executionTarget")
        .and_then(serde_json::Value::as_object);
    let execution_value = |field: &str| {
        execution_target
            .and_then(|target| target.get(field))
            .and_then(serde_json::Value::as_str)
    };
    if execution_value("engineId") != Some(expected_engine_id)
        || execution_value("accountId") != Some(expected_account_id)
        || execution_value("billingMode") != Some(expected_billing_mode)
    {
        // Switching engine, native account, or billing lane starts a separate
        // native Conversation. Never revive a session from an older identity.
        return Ok(None);
    }
    let compatible_runtime =
        context_string_matches(context_object, "runtime", AGENT_RUNTIME_CONTEXT_ID)
            && context_object
                .get("nativeProtocolVersion")
                .and_then(serde_json::Value::as_u64)
                == Some(expected_protocol_version);
    if !compatible_runtime {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::RuntimeIncompatible,
            "The saved Conversation session belongs to an incompatible native Agent runtime.",
        ));
    }
    if stored_session_file.is_some() {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::SessionInvalid,
            "The saved native session must use an opaque identity without a session file.",
        ));
    }
    let session_id = context_object
        .get("nativeSessionId")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::SessionMissing,
                "The saved Conversation has no opaque native session identity.",
            )
        })?;
    Ok(Some(session_id.to_string()))
}

pub(super) async fn read_conversation_native_session_row(
    pool: &sqlx::SqlitePool,
    company_id: &str,
    thread_id: &str,
    current_root_run_id: &str,
) -> Result<Option<(Option<String>, Option<String>)>, HostError> {
    let interrupted_root: Option<String> = sqlx::query_scalar(
        r#"
        SELECT run_id
        FROM agent_runs
        WHERE company_id = ? AND thread_id = ?
          AND run_id = root_run_id AND parent_run_id IS NULL
          AND run_id <> ? AND status = 'interrupted'
        ORDER BY started_at DESC, run_id DESC
        LIMIT 1
        "#,
    )
    .bind(company_id)
    .bind(thread_id)
    .bind(current_root_run_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| HostError::NativeSessionPrestart {
        code: "native-session-persistence",
        message: format!("Check the Conversation for an interrupted root: {error}"),
    })?;
    if interrupted_root.is_some() {
        return Err(HostError::NativeSessionPrestart {
            code: "native-session-interrupted-root",
            message:
                "Resume or discard the interrupted task before starting another Turn in this Conversation."
                    .into(),
        });
    }
    let row = sqlx::query(
        r#"
        SELECT runtime_context_json, session_file
        FROM agent_runs
        WHERE company_id = ? AND thread_id = ?
          AND run_id = root_run_id AND parent_run_id IS NULL
          AND run_id <> ?
          AND status IN ('completed', 'failed', 'cancelled')
          AND (
            (session_file IS NOT NULL AND trim(session_file) <> '')
            OR CASE
                 WHEN json_valid(runtime_context_json)
                 THEN COALESCE(trim(json_extract(runtime_context_json, '$.nativeSessionId')), '') <> ''
                   OR json_extract(runtime_context_json, '$.nativeSessionReset') = 1
                 ELSE 0
               END
          )
        ORDER BY COALESCE(NULLIF(finished_at, ''), started_at) DESC,
                 started_at DESC,
                 run_id DESC
        LIMIT 1
        "#,
    )
    .bind(company_id)
    .bind(thread_id)
    .bind(current_root_run_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| HostError::NativeSessionPrestart {
        code: "native-session-persistence",
        message: format!("Read the Conversation's durable native session: {error}"),
    })?;
    let Some(row) = row else {
        return Ok(None);
    };
    let runtime_context_json: Option<String> =
        row.try_get("runtime_context_json")
            .map_err(|error| HostError::NativeSessionPrestart {
                code: "native-session-persistence",
                message: format!("Decode the Conversation native session context: {error}"),
            })?;
    let session_file: Option<String> =
        row.try_get("session_file")
            .map_err(|error| HostError::NativeSessionPrestart {
                code: "native-session-persistence",
                message: format!("Decode the Conversation native session reference: {error}"),
            })?;
    if runtime_context_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|context| {
            context
                .get("nativeSessionReset")
                .and_then(serde_json::Value::as_bool)
        })
        == Some(true)
    {
        return Ok(None);
    }
    Ok(Some((runtime_context_json, session_file)))
}

pub(super) async fn resolve_conversation_native_session_from_pool(
    pool: &sqlx::SqlitePool,
    expected_session_dir: &Path,
    company_id: &str,
    thread_id: &str,
    current_root_run_id: &str,
) -> Result<Option<(PathBuf, String)>, HostError> {
    let Some((runtime_context_json, session_file)) =
        read_conversation_native_session_row(pool, company_id, thread_id, current_root_run_id)
            .await?
    else {
        return Ok(None);
    };
    validate_conversation_native_session(
        runtime_context_json.as_deref(),
        session_file.as_deref(),
        expected_session_dir,
    )
    .map(Some)
    .map_err(ResumePrestartFailure::into_native_session_host_error)
}

pub(crate) async fn resolve_conversation_native_session_for_execute<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    company_id: &str,
    thread_id: &str,
    current_root_run_id: &str,
) -> Result<Option<(PathBuf, String)>, HostError> {
    let pool = crate::local_db::get_offisim_pool(app)
        .map_err(|error| HostError::HostUnavailable(format!("Open offisim.db: {error}")))?;
    let session_dir = crate::pi_agent_host::app_pi_session_dir(app, thread_id)?;
    resolve_conversation_native_session_from_pool(
        &pool,
        &session_dir,
        company_id,
        thread_id,
        current_root_run_id,
    )
    .await
}

pub(crate) struct OpaqueNativeSessionExpectation<'a> {
    pub engine_id: &'a str,
    pub account_id: &'a str,
    pub billing_mode: &'a str,
    pub protocol_version: u64,
}

pub(crate) async fn resolve_conversation_opaque_native_session_for_execute<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    company_id: &str,
    thread_id: &str,
    current_root_run_id: &str,
    expectation: OpaqueNativeSessionExpectation<'_>,
) -> Result<Option<String>, HostError> {
    let pool = crate::local_db::get_offisim_pool(app)
        .map_err(|error| HostError::HostUnavailable(format!("Open offisim.db: {error}")))?;
    let Some((runtime_context_json, session_file)) =
        read_conversation_native_session_row(&pool, company_id, thread_id, current_root_run_id)
            .await?
    else {
        return Ok(None);
    };
    validate_conversation_opaque_native_session(
        runtime_context_json.as_deref(),
        session_file.as_deref(),
        expectation.engine_id,
        expectation.account_id,
        expectation.billing_mode,
        expectation.protocol_version,
    )
    .map_err(ResumePrestartFailure::into_native_session_host_error)
}

pub(crate) async fn persist_conversation_native_session_reset<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    company_id: &str,
    thread_id: &str,
    source_failed_root_run_id: &str,
    target_root_run_id: &str,
) -> Result<(), HostError> {
    let pool = crate::local_db::get_offisim_pool(app)
        .map_err(|error| HostError::HostUnavailable(format!("Open offisim.db: {error}")))?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| HostError::NativeSessionPrestart {
            code: "native-session-reset-persistence",
            message: format!("Begin the fresh-session reset transaction: {error}"),
        })?;
    let operation: Result<(), HostError> = async {
        let target_rowid: i64 = sqlx::query_scalar(
            r#"
            SELECT rowid
            FROM agent_runs
            WHERE run_id = ? AND root_run_id = ? AND parent_run_id IS NULL
              AND company_id = ? AND thread_id = ? AND status = 'running'
            "#,
        )
        .bind(target_root_run_id)
        .bind(target_root_run_id)
        .bind(company_id)
        .bind(thread_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| HostError::NativeSessionPrestart {
            code: "native-session-reset-persistence",
            message: format!("Read the Turn requesting Start fresh session: {error}"),
        })?
        .ok_or_else(|| HostError::NativeSessionPrestart {
            code: "native-session-reset-invalid",
            message: "Start fresh session no longer matches the current running Turn.".into(),
        })?;

        let latest_root_run_id: Option<String> = sqlx::query_scalar(
            r#"
            SELECT run_id
            FROM agent_runs
            WHERE company_id = ? AND thread_id = ?
              AND run_id = root_run_id AND parent_run_id IS NULL
            ORDER BY rowid DESC
            LIMIT 1
            "#,
        )
        .bind(company_id)
        .bind(thread_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| HostError::NativeSessionPrestart {
            code: "native-session-reset-persistence",
            message: format!("Check the latest Conversation Turn: {error}"),
        })?;
        if latest_root_run_id.as_deref() != Some(target_root_run_id) {
            return Err(HostError::NativeSessionPrestart {
                code: "native-session-reset-invalid",
                message: "A newer Conversation Turn replaced this Start fresh session action."
                    .into(),
            });
        }

        let row = sqlx::query(
            r#"
            SELECT run_id, status, runtime_context_json, session_file
            FROM agent_runs
            WHERE company_id = ? AND thread_id = ?
              AND run_id = root_run_id AND parent_run_id IS NULL
              AND rowid < ?
            ORDER BY rowid DESC
            LIMIT 1
            "#,
        )
        .bind(company_id)
        .bind(thread_id)
        .bind(target_rowid)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| HostError::NativeSessionPrestart {
            code: "native-session-reset-persistence",
            message: format!("Read the failed Turn authorizing Start fresh session: {error}"),
        })?
        .ok_or_else(|| HostError::NativeSessionPrestart {
            code: "native-session-reset-invalid",
            message:
                "Start fresh session no longer matches the failed Turn that offered it.".into(),
        })?;
        let previous_run_id: String = row.try_get("run_id").map_err(|error| {
            HostError::NativeSessionPrestart {
                code: "native-session-reset-persistence",
                message: format!("Decode the previous Conversation Turn: {error}"),
            }
        })?;
        let previous_status: String = row.try_get("status").map_err(|error| {
            HostError::NativeSessionPrestart {
                code: "native-session-reset-persistence",
                message: format!("Decode the previous Conversation Turn status: {error}"),
            }
        })?;
        if previous_run_id != source_failed_root_run_id || previous_status != "failed" {
            return Err(HostError::NativeSessionPrestart {
                code: "native-session-reset-invalid",
                message: "Start fresh session is valid only for the immediately previous failed Turn."
                    .into(),
            });
        }
        let original_context_json: String = row
            .try_get::<Option<String>, _>("runtime_context_json")
            .map_err(|error| HostError::NativeSessionPrestart {
                code: "native-session-reset-persistence",
                message: format!("Decode the failed Turn native session context: {error}"),
            })?
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| HostError::NativeSessionPrestart {
                code: "native-session-reset-invalid",
                message: "The failed Turn has no durable native-session error context.".into(),
            })?;
        let source_session_file: Option<String> =
            row.try_get("session_file")
                .map_err(|error| HostError::NativeSessionPrestart {
                    code: "native-session-reset-persistence",
                    message: format!("Decode the failed Turn native session reference: {error}"),
                })?;
        if source_session_file
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        {
            return Err(HostError::NativeSessionPrestart {
                code: "native-session-reset-invalid",
                message: "Start fresh session is only valid for a Turn rejected before native session start."
                    .into(),
            });
        }
        let mut context: serde_json::Value =
            serde_json::from_str(&original_context_json).map_err(|_| {
                HostError::NativeSessionPrestart {
                    code: "native-session-reset-invalid",
                    message: "The failed Turn native-session error context is invalid.".into(),
                }
            })?;
        let context_object =
            context
                .as_object_mut()
                .ok_or_else(|| HostError::NativeSessionPrestart {
                    code: "native-session-reset-invalid",
                    message: "The failed Turn native-session error context is invalid.".into(),
                })?;
        let source_code = context_object
            .get("nativeSessionPrestartErrorCode")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .and_then(ResettableNativeSessionPrestartCode::parse)
            .map(|code| code.as_str().to_string())
            .ok_or_else(|| HostError::NativeSessionPrestart {
                code: "native-session-reset-invalid",
                message: "The failed Turn did not record a resettable native-session error.".into(),
            })?;
        context_object.insert("nativeSessionReset".into(), serde_json::Value::Bool(true));
        context_object.insert(
            "nativeSessionResetSourceErrorCode".into(),
            serde_json::Value::String(source_code),
        );
        context_object.insert(
            "nativeSessionResetAtUnixMs".into(),
            serde_json::json!(now_unix_ms()?),
        );
        let reset_context_json = serde_json::to_string(&context).map_err(|error| {
            HostError::NativeSessionPrestart {
                code: "native-session-reset-persistence",
                message: format!("Encode the fresh-session reset marker: {error}"),
            }
        })?;
        let changed = sqlx::query(
            r#"
            UPDATE agent_runs
            SET runtime_context_json = ?
            WHERE run_id = ? AND root_run_id = ? AND parent_run_id IS NULL
              AND company_id = ? AND thread_id = ? AND status = 'failed'
              AND session_file IS NULL AND runtime_context_json = ?
              AND EXISTS (
                SELECT 1 FROM agent_runs AS target
                WHERE target.rowid = ? AND target.run_id = ? AND target.root_run_id = ?
                  AND target.parent_run_id IS NULL AND target.company_id = ?
                  AND target.thread_id = ? AND target.status = 'running'
              )
            "#,
        )
        .bind(&reset_context_json)
        .bind(source_failed_root_run_id)
        .bind(source_failed_root_run_id)
        .bind(company_id)
        .bind(thread_id)
        .bind(&original_context_json)
        .bind(target_rowid)
        .bind(target_root_run_id)
        .bind(target_root_run_id)
        .bind(company_id)
        .bind(thread_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| HostError::NativeSessionPrestart {
            code: "native-session-reset-persistence",
            message: format!("Persist the fresh-session reset marker: {error}"),
        })?
        .rows_affected();
        if changed != 1 {
            return Err(HostError::NativeSessionPrestart {
                code: "native-session-reset-conflict",
                message: "The failed Turn changed before its fresh-session reset could commit."
                    .into(),
            });
        }
        let readback: Option<String> = sqlx::query_scalar(
            "SELECT runtime_context_json FROM agent_runs WHERE run_id = ? AND company_id = ? AND thread_id = ? AND status = 'failed'",
        )
        .bind(source_failed_root_run_id)
        .bind(company_id)
        .bind(thread_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| HostError::NativeSessionPrestart {
            code: "native-session-reset-persistence",
            message: format!("Read back the fresh-session reset marker: {error}"),
        })?;
        if readback.as_deref() != Some(reset_context_json.as_str()) {
            return Err(HostError::NativeSessionPrestart {
                code: "native-session-reset-persistence",
                message: "The fresh-session reset marker durable readback did not match.".into(),
            });
        }
        Ok(())
    }
    .await;
    match operation {
        Ok(()) => tx
            .commit()
            .await
            .map_err(|error| HostError::NativeSessionPrestart {
                code: "native-session-reset-persistence",
                message: format!("Commit the fresh-session reset marker: {error}"),
            }),
        Err(error) => {
            if let Err(rollback_error) = tx.rollback().await {
                eprintln!(
                    "[task-workspace] failed to roll back fresh-session reset: {rollback_error}"
                );
            }
            Err(error)
        }
    }
}

pub(super) fn validate_resume_root_prestart(
    runtime_context_json: Option<&str>,
    stored_session_file: Option<&str>,
    expected_session_dir: &Path,
    expected: ResumeRootExpectation<'_>,
) -> Result<ValidatedResumeRoot, ResumePrestartFailure> {
    let context: serde_json::Value = runtime_context_json
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::ContextInvalid,
                "The interrupted task's durable runtime context is missing. Start a new task instead.",
            )
        })?
        .parse()
        .map_err(|_| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::ContextInvalid,
                "The interrupted task's durable runtime context is invalid. Start a new task instead.",
            )
        })?;
    let context_object = context.as_object().ok_or_else(|| {
        ResumePrestartFailure::new(
            ResumePrestartFailureKind::ContextInvalid,
            "The interrupted task's durable runtime context is invalid. Start a new task instead.",
        )
    })?;
    let execution_target = context_object
        .get("executionTarget")
        .and_then(serde_json::Value::as_object);
    let engine_id = execution_target
        .and_then(|target| target.get("engineId"))
        .and_then(serde_json::Value::as_str);
    let compatible_runtime =
        context_string_matches(context_object, "runtime", AGENT_RUNTIME_CONTEXT_ID)
            && match engine_id {
                Some("codex") => {
                    context_object
                        .get("nativeProtocolVersion")
                        .and_then(serde_json::Value::as_u64)
                        == Some(crate::codex_agent_host::CODEX_HOST_PROTOCOL_VERSION)
                }
                Some("claude") => {
                    context_object
                        .get("nativeProtocolVersion")
                        .and_then(serde_json::Value::as_u64)
                        == Some(crate::claude_agent_host::CLAUDE_HOST_PROTOCOL_VERSION)
                }
                None | Some("api") => {
                    context_object
                        .get("wireProtocolVersion")
                        .and_then(serde_json::Value::as_u64)
                        == Some(u64::from(crate::pi_agent_host::PI_HOST_PROTOCOL_VERSION))
                }
                Some(_) => false,
            };
    if !compatible_runtime {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::RuntimeIncompatible,
            "This interrupted task belongs to another or incompatible native Agent runtime. Start a new task instead.",
        ));
    }
    let workspace_binding = context_object
        .get("workspaceBinding")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| {
            ResumePrestartFailure::new(
                ResumePrestartFailureKind::ContextInvalid,
                "The interrupted task's durable workspace projection is missing. Start a new task instead.",
            )
        })?;
    let saved_workspace_requirement = context_object
        .get("workspaceRequirement")
        .and_then(serde_json::Value::as_str);
    let binding_matches =
        context_string_matches(context_object, "requestId", expected.original_request_id)
            && matches!(
                saved_workspace_requirement,
                Some("optional") | Some("required")
            )
            && context_string_matches(context_object, "workspaceAvailability", "bound")
            && context_string_matches(context_object, "projectId", expected.project_id)
            && context_string_matches(workspace_binding, "historyId", expected.history_id)
            && context_string_matches(workspace_binding, "companyId", expected.company_id)
            && context_string_matches(workspace_binding, "projectId", expected.project_id)
            && context_string_matches(workspace_binding, "threadId", expected.thread_id)
            && context_string_matches(workspace_binding, "turnId", expected.turn_id)
            && context_string_matches(workspace_binding, "requestId", expected.original_request_id)
            && context_string_matches(workspace_binding, "access", expected.access)
            && context_string_matches(workspace_binding, "source", expected.source)
            && context_string_matches(workspace_binding, "reasonCode", expected.reason_code);
    if !binding_matches {
        return Err(ResumePrestartFailure::new(
            ResumePrestartFailureKind::ContextInvalid,
            "The interrupted task's durable workspace projection no longer matches its saved run. Start a new task instead.",
        ));
    }
    let (native_session, stored_session_file) = if matches!(engine_id, Some("codex" | "claude")) {
        let opaque_engine = engine_id.expect("opaque engine was matched");
        let display_engine = if opaque_engine == "codex" {
            "Codex"
        } else {
            "Claude"
        };
        if stored_session_file.is_some() {
            return Err(ResumePrestartFailure::new(
                ResumePrestartFailureKind::SessionInvalid,
                format!("The interrupted {display_engine} task must use an opaque native session identity without a session file. Start a new task instead."),
            ));
        }
        let session_id = context_object
            .get("nativeSessionId")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                ResumePrestartFailure::new(
                    ResumePrestartFailureKind::SessionMissing,
                    format!("The interrupted {display_engine} task has no saved opaque native session identity. Start a new task instead."),
                )
            })?
            .to_string();
        let account_id = execution_target
            .and_then(|target| target.get("accountId"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                ResumePrestartFailure::new(
                    ResumePrestartFailureKind::ContextInvalid,
                    format!("The interrupted {display_engine} task has no saved native account identity. Start a new task instead."),
                )
            })?
            .to_string();
        let billing_mode = execution_target
            .and_then(|target| target.get("billingMode"))
            .and_then(serde_json::Value::as_str)
            .filter(|value| *value == "subscription")
            .ok_or_else(|| {
                ResumePrestartFailure::new(
                    ResumePrestartFailureKind::ContextInvalid,
                    format!("The interrupted {display_engine} task is not bound to a subscription account. Start a new task instead."),
                )
            })?
            .to_string();
        (
            NativeSessionReference::Opaque {
                engine_id: opaque_engine.into(),
                account_id,
                billing_mode,
                id: session_id,
            },
            None,
        )
    } else {
        let (session_file, stored_session_file, session_id) =
            validate_exact_native_session_file(expected_session_dir, stored_session_file)?;
        if !context_string_matches(context_object, "nativeSessionId", &session_id) {
            return Err(ResumePrestartFailure::new(
                ResumePrestartFailureKind::SessionInvalid,
                "The interrupted task's durable native Pi session identity no longer matches its saved session. Start a new task instead.",
            ));
        }
        (
            NativeSessionReference::FileBacked {
                file: session_file,
                id: session_id,
            },
            Some(stored_session_file),
        )
    };
    Ok(ValidatedResumeRoot {
        context,
        native_session,
        stored_session_file,
    })
}

#[allow(clippy::too_many_arguments)] // Resume scope is intentionally explicit and fail-closed.
pub(super) async fn task_workspace_resume_compatibility_from_pool(
    pool: &sqlx::SqlitePool,
    expected_session_dir: &Path,
    history_id: &str,
    company_id: &str,
    project_id: &str,
    thread_id: &str,
    root_run_id: &str,
    access: TaskWorkspaceAccess,
) -> Result<TaskWorkspaceResumeCompatibility, String> {
    let history = sqlx::query(
        r#"
        SELECT h.company_id, h.project_id, h.thread_id, h.turn_id,
               h.request_id, h.access, h.source, h.reason_code,
               h.status AS binding_status, ar.status AS agent_run_status,
               ar.runtime_context_json, ar.session_file
        FROM task_workspace_binding_history AS h
        LEFT JOIN agent_runs AS ar
          ON ar.run_id = h.turn_id
         AND ar.root_run_id = h.turn_id
         AND ar.company_id = h.company_id
         AND ar.thread_id = h.thread_id
         AND ar.project_id = h.project_id
        WHERE h.binding_id = ?
        "#,
    )
    .bind(history_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Read resume workspace history: {error}"))?;
    let Some(history) = history else {
        return Ok(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Missing,
            reason: "workspace_history_missing".into(),
        });
    };
    let history_company_id: String = history
        .try_get("company_id")
        .map_err(|error| format!("Decode resume company_id: {error}"))?;
    let history_project_id: String = history
        .try_get("project_id")
        .map_err(|error| format!("Decode resume project_id: {error}"))?;
    let history_thread_id: String = history
        .try_get("thread_id")
        .map_err(|error| format!("Decode resume thread_id: {error}"))?;
    let history_turn_id: String = history
        .try_get("turn_id")
        .map_err(|error| format!("Decode resume turn_id: {error}"))?;
    if history_company_id != company_id
        || history_project_id != project_id
        || history_thread_id != thread_id
        || history_turn_id != root_run_id
    {
        return Ok(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Changed,
            reason: "workspace_scope_changed".into(),
        });
    }
    let binding_status: String = history
        .try_get("binding_status")
        .map_err(|error| format!("Decode resume binding status: {error}"))?;
    let agent_run_status: Option<String> = history
        .try_get("agent_run_status")
        .map_err(|error| format!("Decode resume Agent run status: {error}"))?;
    if !resume_history_is_recoverable(&binding_status, agent_run_status.as_deref()) {
        return Ok(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Changed,
            reason: "workspace_history_not_recoverable".into(),
        });
    }
    let original_request_id: String = history
        .try_get("request_id")
        .map_err(|error| format!("Decode resume request_id: {error}"))?;
    let expected_access: String = history
        .try_get("access")
        .map_err(|error| format!("Decode resume access: {error}"))?;
    let source: String = history
        .try_get("source")
        .map_err(|error| format!("Decode resume workspace source: {error}"))?;
    let source = WorkspaceRecoverySource::try_from(source.as_str())
        .map_err(|error| format!("Decode resume workspace source: {error}"))?;
    let reason_code: String = history
        .try_get("reason_code")
        .map_err(|error| format!("Decode resume workspace reason: {error}"))?;
    let reason_code = WorkspaceRecoveryReason::try_from(reason_code.as_str())
        .map_err(|error| format!("Decode resume workspace reason: {error}"))?;
    let runtime_context_json: Option<String> = history
        .try_get("runtime_context_json")
        .map_err(|error| format!("Decode resume runtime context: {error}"))?;
    let session_file: Option<String> = history
        .try_get("session_file")
        .map_err(|error| format!("Decode resume native session: {error}"))?;
    if expected_access != access.as_str() {
        return Ok(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Changed,
            reason: "workspace_scope_changed".into(),
        });
    }
    if let Err(failure) = validate_resume_root_prestart(
        runtime_context_json.as_deref(),
        session_file.as_deref(),
        expected_session_dir,
        ResumeRootExpectation {
            history_id,
            original_request_id: &original_request_id,
            company_id,
            project_id,
            thread_id,
            turn_id: root_run_id,
            access: &expected_access,
            source: source.as_str(),
            reason_code: reason_code.as_str(),
        },
    ) {
        return Ok(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Changed,
            reason: failure.kind.compatibility_reason().into(),
        });
    }

    // The issuance path is the durable authority oracle. In particular, an
    // auto-recovered Conversation/known-root binding may legitimately differ
    // from the stale Project catalog root while retaining its exact filesystem
    // identity, witness and authority snapshot. Discard the resolved path and
    // return only the compatibility enum to the renderer.
    let scope = crate::workspace_recovery::WorkspaceRecoveryScope {
        company_id,
        project_id,
        thread_id,
    };
    match crate::workspace_recovery::resolve_resumed_workspace_root_from_pool(
        pool,
        scope,
        history_id,
        root_run_id,
        access.as_str(),
    )
    .await
    {
        Ok(_) => Ok(TaskWorkspaceResumeCompatibility {
            status: TaskWorkspaceResumeCompatibilityStatus::Same,
            reason: "workspace_history_durable_match".into(),
        }),
        Err(crate::workspace_recovery::ResumedWorkspaceRootError::Incompatible(_)) => {
            Ok(TaskWorkspaceResumeCompatibility {
                status: TaskWorkspaceResumeCompatibilityStatus::Changed,
                reason: "workspace_history_incompatible".into(),
            })
        }
        Err(crate::workspace_recovery::ResumedWorkspaceRootError::Operational(error)) => Err(error),
    }
}

/// Read-only preflight for Recovery UI. It intentionally returns only a small
/// compatibility enum; the historical/current canonical paths remain backend
/// data. `agent_runtime_resume` repeats the same identity check while issuing
/// the new capability, so this command is never an authority grant.
#[tauri::command]
pub async fn task_workspace_resume_compatibility<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    history_id: String,
    company_id: String,
    project_id: String,
    thread_id: String,
    root_run_id: String,
    access: String,
) -> Result<TaskWorkspaceResumeCompatibility, String> {
    let history_id = required_scope_text(&history_id, "historyId").map_err(host_error_message)?;
    let company_id = required_scope_text(&company_id, "companyId").map_err(host_error_message)?;
    let project_id = required_scope_text(&project_id, "projectId").map_err(host_error_message)?;
    let thread_id = required_scope_text(&thread_id, "threadId").map_err(host_error_message)?;
    let root_run_id = required_scope_text(&root_run_id, "rootRunId").map_err(host_error_message)?;
    let access = match access.trim() {
        "read" => TaskWorkspaceAccess::Read,
        "write" => TaskWorkspaceAccess::Write,
        _ => return Err("access must be read or write for resume compatibility.".into()),
    };
    let pool = crate::local_db::get_offisim_pool(&app)?;
    let session_dir = crate::pi_agent_host::app_pi_session_dir(&app, thread_id)
        .map_err(|error| format!("Resolve Pi Conversation session directory: {error:?}"))?;
    task_workspace_resume_compatibility_from_pool(
        &pool,
        &session_dir,
        history_id,
        company_id,
        project_id,
        thread_id,
        root_run_id,
        access,
    )
    .await
}

#[cfg(test)]
pub(super) mod tests {
    use super::super::persistence::{
        publish_resolved_task_workspace_binding, record_task_workspace_binding_from_pool,
        ResumeBindingExpectation,
    };
    use super::super::registry::tests::fixture_binding;
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    fn opaque_conversation_context(
        engine_id: &str,
        account_id: &str,
        billing_mode: &str,
        protocol_version: u64,
        session_id: &str,
    ) -> String {
        serde_json::json!({
            "runtime": AGENT_RUNTIME_CONTEXT_ID,
            "nativeProtocolVersion": protocol_version,
            "executionTarget": {
                "engineId": engine_id,
                "accountId": account_id,
                "billingMode": billing_mode,
            },
            "nativeSessionId": session_id,
        })
        .to_string()
    }

    #[test]
    fn opaque_conversation_session_is_engine_and_protocol_scoped() {
        let context = opaque_conversation_context(
            "codex",
            "codex-subscription-account",
            "subscription",
            2,
            "opaque-codex-thread",
        );
        assert_eq!(
            validate_conversation_opaque_native_session(
                Some(&context),
                None,
                "codex",
                "codex-subscription-account",
                "subscription",
                2,
            )
            .expect("validate same-account opaque session"),
            Some("opaque-codex-thread".into())
        );
        assert_eq!(
            validate_conversation_opaque_native_session(
                Some(&context),
                None,
                "claude",
                "codex-subscription-account",
                "subscription",
                2,
            )
            .expect("switching engine starts a new native session"),
            None
        );
        assert_eq!(
            validate_conversation_opaque_native_session(
                Some(&context),
                None,
                "codex",
                "another-account",
                "subscription",
                2,
            )
            .expect("switching native account starts a new native session"),
            None
        );
        let incompatible = validate_conversation_opaque_native_session(
            Some(&context),
            None,
            "codex",
            "codex-subscription-account",
            "subscription",
            3,
        )
        .expect_err("protocol drift must fail closed");
        assert_eq!(
            incompatible.kind,
            ResumePrestartFailureKind::RuntimeIncompatible
        );
    }

    #[test]
    fn opaque_conversation_session_rejects_file_or_missing_identity() {
        let context = opaque_conversation_context(
            "codex",
            "codex-subscription-account",
            "subscription",
            2,
            "opaque-codex-thread",
        );
        let file_backed = validate_conversation_opaque_native_session(
            Some(&context),
            Some("/tmp/forbidden.jsonl"),
            "codex",
            "codex-subscription-account",
            "subscription",
            2,
        )
        .expect_err("opaque engine must reject a session file");
        assert_eq!(file_backed.kind, ResumePrestartFailureKind::SessionInvalid);

        let missing = opaque_conversation_context(
            "codex",
            "codex-subscription-account",
            "subscription",
            2,
            "   ",
        );
        let missing = validate_conversation_opaque_native_session(
            Some(&missing),
            None,
            "codex",
            "codex-subscription-account",
            "subscription",
            2,
        )
        .expect_err("opaque engine must require a nonempty identity");
        assert_eq!(missing.kind, ResumePrestartFailureKind::SessionMissing);
    }

    #[test]
    fn resettable_native_session_codes_round_trip_through_typed_policy() {
        for value in [
            "native-session-missing",
            "native-session-invalid",
            "native-session-runtime-incompatible",
            "native-session-context-invalid",
        ] {
            assert_eq!(
                ResettableNativeSessionPrestartCode::parse(value).map(|code| code.as_str()),
                Some(value)
            );
        }

        for value in [
            "native-session-conflict",
            "native-session-persistence",
            "future-native-session-code",
        ] {
            assert_eq!(ResettableNativeSessionPrestartCode::parse(value), None);
        }
    }

    pub(super) fn write_test_native_session(
        session_dir: &Path,
        session_id: &str,
        cwd: &Path,
    ) -> PathBuf {
        std::fs::create_dir_all(session_dir).expect("create native session fixture directory");
        let session_file = session_dir.join(format!("{session_id}.jsonl"));
        std::fs::write(
            &session_file,
            format!(
                "{{\"type\":\"session\",\"version\":3,\"id\":{},\"timestamp\":\"2026-07-14T00:00:00.000Z\",\"cwd\":{}}}\n",
                serde_json::to_string(session_id).expect("encode fixture session id"),
                serde_json::to_string(&cwd.to_string_lossy()).expect("encode session cwd")
            ),
        )
        .expect("write native session fixture");
        session_file
    }

    pub(in super::super) async fn resume_race_pool(
        binding_status: &str,
        agent_status: &str,
        root: &Path,
    ) -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open resume race db");
        sqlx::query(
            r#"
            CREATE TABLE task_workspace_binding_history (
              binding_id TEXT PRIMARY KEY NOT NULL,
              company_id TEXT NOT NULL,
              project_id TEXT NOT NULL,
              thread_id TEXT NOT NULL,
              turn_id TEXT NOT NULL,
              request_id TEXT NOT NULL UNIQUE,
              access TEXT NOT NULL,
              canonical_root TEXT NOT NULL,
              root_identity_json TEXT NOT NULL,
              workspace_basename_normalized TEXT,
              project_name_normalized TEXT,
              workspace_anchor TEXT,
              git_origin_digest TEXT,
              recovery_witness_binding_id TEXT,
              recovery_witness_authority_project_id TEXT,
              authority_snapshot_canonical_root TEXT NOT NULL,
              authority_snapshot_root_identity_json TEXT NOT NULL,
              authority_snapshot_updated_at_unix_ms INTEGER NOT NULL,
              source TEXT NOT NULL,
              confidence REAL NOT NULL,
              reason_code TEXT NOT NULL,
              issued_at_unix_ms INTEGER NOT NULL,
              expires_at_unix_ms INTEGER NOT NULL,
              activated_at_unix_ms INTEGER NOT NULL,
              last_used_at_unix_ms INTEGER NOT NULL,
              status TEXT NOT NULL,
              resumed_from_binding_id TEXT
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create resume binding history schema");
        for statement in [
            "CREATE TABLE projects (project_id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, name TEXT NOT NULL, workspace_root TEXT NOT NULL, verify_command TEXT, verify_max_attempts INTEGER NOT NULL DEFAULT 3, verify_token_budget INTEGER)",
            "CREATE TABLE chat_threads (thread_id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL)",
            "CREATE TABLE project_workspace_authority (project_id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, canonical_root TEXT NOT NULL, root_identity_json TEXT NOT NULL, updated_at_unix_ms INTEGER NOT NULL)",
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("create authority CAS fixture schema");
        }
        let root_text = canonical_root_text(root).expect("resume fixture root text");
        let identity_json =
            serde_json::to_string(&root_identity(root).expect("resume fixture root identity"))
                .expect("resume fixture identity json");
        sqlx::query(
            "INSERT INTO projects (project_id, company_id, name, workspace_root) VALUES ('project-1', 'company-1', 'Project', ?)",
        )
            .bind(&root_text)
            .execute(&pool)
            .await
            .expect("insert resume fixture Project");
        sqlx::query("INSERT INTO chat_threads VALUES ('thread-1', 'project-1')")
            .execute(&pool)
            .await
            .expect("insert resume fixture Conversation");
        sqlx::query(
            "INSERT INTO project_workspace_authority VALUES ('project-1', 'company-1', ?, ?, 1000)",
        )
        .bind(&root_text)
        .bind(&identity_json)
        .execute(&pool)
        .await
        .expect("insert resume fixture authority");
        sqlx::query(
            "CREATE UNIQUE INDEX idx_task_workspace_binding_resume_once ON task_workspace_binding_history(resumed_from_binding_id) WHERE resumed_from_binding_id IS NOT NULL",
        )
        .execute(&pool)
        .await
        .expect("create resume uniqueness index");
        sqlx::query(
            r#"
            CREATE TABLE agent_runs (
              run_id TEXT PRIMARY KEY NOT NULL,
              root_run_id TEXT NOT NULL,
              parent_run_id TEXT,
              company_id TEXT NOT NULL,
              project_id TEXT,
              thread_id TEXT NOT NULL,
              status TEXT NOT NULL,
              failure_kind TEXT,
              runtime_context_json TEXT,
              session_file TEXT,
              finished_at TEXT
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create resume Agent run schema");
        sqlx::query(
            r#"
            CREATE TABLE task_workspace_lease_history (
              lease_id TEXT PRIMARY KEY NOT NULL,
              project_id TEXT NOT NULL,
              created_root_run_id TEXT NOT NULL,
              canonical_worktree TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("create resume workspace lease schema");
        sqlx::query(
            r#"
            INSERT INTO task_workspace_binding_history (
              binding_id, company_id, project_id, thread_id, turn_id, request_id,
              access, canonical_root, root_identity_json, source, confidence,
              reason_code, issued_at_unix_ms, expires_at_unix_ms,
              activated_at_unix_ms, last_used_at_unix_ms, status,
              authority_snapshot_canonical_root,
              authority_snapshot_root_identity_json,
              authority_snapshot_updated_at_unix_ms,
              resumed_from_binding_id
            ) VALUES (
              'history-1', 'company-1', 'project-1', 'thread-1', 'turn-1',
              'original-request', 'write', ?, ?, 'project_catalog',
              1.0, 'current_project_folder', 1, 2, 1, 1, ?, ?, ?, 1000, NULL
            )
            "#,
        )
        .bind(&root_text)
        .bind(&identity_json)
        .bind(binding_status)
        .bind(&root_text)
        .bind(&identity_json)
        .execute(&pool)
        .await
        .expect("insert original binding history");
        let session_file = write_test_native_session(root, "session-a", root);
        let runtime_context = serde_json::json!({
            "requestId": "original-request",
            "streamCursor": 7,
            "workspaceBinding": {
                "historyId": "history-1",
                "companyId": "company-1",
                "projectId": "project-1",
                "threadId": "thread-1",
                "turnId": "turn-1",
                "requestId": "original-request",
                "access": "write",
                "source": "project_catalog",
                "confidence": 1.0,
                "reasonCode": "current_project_folder",
                "issuedAtUnixMs": 1,
                "expiresAtUnixMs": 2,
                "displayPath": root_text,
            },
            "workspaceRequirement": "optional",
            "workspaceAvailability": "bound",
            "runtime": AGENT_RUNTIME_CONTEXT_ID,
            "piSdkVersion": "0.79.8",
            "wireProtocolVersion": crate::pi_agent_host::PI_HOST_PROTOCOL_VERSION,
            "nativeSessionId": "session-a",
            "projectId": "project-1",
        });
        sqlx::query(
            "INSERT INTO agent_runs (run_id, root_run_id, parent_run_id, company_id, project_id, thread_id, status, runtime_context_json, session_file) VALUES ('turn-1', 'turn-1', NULL, 'company-1', 'project-1', 'thread-1', ?, ?, ?)",
        )
        .bind(agent_status)
        .bind(runtime_context.to_string())
        .bind(session_file.to_string_lossy().to_string())
        .execute(&pool)
        .await
        .expect("insert interrupted Agent run");
        pool
    }

    pub(super) async fn configure_codex_resume_identity(
        pool: &sqlx::SqlitePool,
        native_session_id: serde_json::Value,
        session_file: Option<&str>,
    ) {
        let runtime_context_json: String = sqlx::query_scalar(
            "SELECT runtime_context_json FROM agent_runs WHERE run_id = 'turn-1'",
        )
        .fetch_one(pool)
        .await
        .expect("read Codex resume runtime context");
        let mut runtime_context: serde_json::Value = serde_json::from_str(&runtime_context_json)
            .expect("decode Codex resume runtime context");
        runtime_context["executionTarget"] = serde_json::json!({
            "engineId": "codex",
            "accountId": "codex-subscription-fixture",
            "billingMode": "subscription",
            "modelId": "codex-model-fixture",
            "modelSource": "native",
        });
        runtime_context["nativeSessionId"] = native_session_id;
        runtime_context["nativeRuntimeVersion"] = serde_json::json!("0.144.4");
        runtime_context["nativeProtocolVersion"] =
            serde_json::json!(crate::codex_agent_host::CODEX_HOST_PROTOCOL_VERSION);
        let context = runtime_context
            .as_object_mut()
            .expect("Codex resume context object");
        context.remove("piSdkVersion");
        context.remove("wireProtocolVersion");
        sqlx::query(
            "UPDATE agent_runs SET runtime_context_json = ?, session_file = ? WHERE run_id = 'turn-1'",
        )
        .bind(runtime_context.to_string())
        .bind(session_file)
        .execute(pool)
        .await
        .expect("persist opaque Codex resume identity");
    }

    pub(in super::super) async fn deletion_preflight_pool() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open deletion preflight db");
        for statement in [
            "CREATE TABLE companies (company_id TEXT PRIMARY KEY NOT NULL)",
            "CREATE TABLE projects (project_id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL)",
            "CREATE TABLE chat_threads (thread_id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL)",
            "CREATE TABLE task_workspace_binding_history (binding_id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, project_id TEXT NOT NULL, thread_id TEXT NOT NULL, status TEXT NOT NULL)",
            "CREATE TABLE task_workspace_lease_history (lease_id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, created_binding_id TEXT NOT NULL, active_binding_id TEXT NOT NULL, status TEXT NOT NULL)",
            "INSERT INTO companies (company_id) VALUES ('company-1')",
            "INSERT INTO projects (project_id, company_id) VALUES ('project-1', 'company-1')",
            "INSERT INTO chat_threads (thread_id, project_id) VALUES ('thread-1', 'project-1')",
        ] {
            sqlx::query(statement)
                .execute(&pool)
                .await
                .expect("build deletion preflight fixture");
        }
        pool
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn resume_compatibility_accepts_durable_recovered_history_without_returning_root() {
        use std::os::unix::fs::MetadataExt;

        let write_origin = |root: &Path, origin: &str| {
            if !root.join(".git/HEAD").is_file() {
                let status = std::process::Command::new("git")
                    .arg("init")
                    .arg("--quiet")
                    .arg(root)
                    .env("GIT_CONFIG_NOSYSTEM", "1")
                    .env("GIT_CONFIG_GLOBAL", "/dev/null")
                    .status()
                    .expect("initialize recovery Git fixture");
                assert!(status.success(), "initialize recovery Git fixture");
            }
            let status = std::process::Command::new("git")
                .arg("-C")
                .arg(root)
                .args(["config", "--replace-all", "remote.origin.url", origin])
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .status()
                .expect("write recovery Git origin");
            assert!(status.success(), "write recovery Git origin");
        };
        let fixture = std::env::temp_dir().join(format!("offisim-resume-compat-{}", random_id()));
        let original = fixture.join("old-name");
        std::fs::create_dir_all(&original).expect("create original Project root");
        write_origin(&original, "ssh://git@example.com/org/repo.git");
        let original = original.canonicalize().expect("canonical original root");
        let original_text = canonical_root_text(&original).expect("original root text");
        let authority_identity =
            serde_json::to_string(&root_identity(&original).expect("original root identity"))
                .expect("encode original root identity");
        let original_metadata = original.metadata().expect("inspect original root identity");
        let original_recovery_identity = serde_json::json!({
            "canonicalRoot": &original_text,
            "device": original_metadata.dev(),
            "inode": original_metadata.ino(),
        })
        .to_string();
        let original_evidence =
            crate::workspace_recovery::capture_workspace_evidence(&original, "Project")
                .expect("capture original evidence");
        let pool = resume_race_pool("app_restart", "interrupted", &original).await;
        let session_dir = fixture.join("sessions");
        let session_file = write_test_native_session(&session_dir, "session-a", &original);
        sqlx::query("UPDATE agent_runs SET session_file = ? WHERE run_id = 'turn-1'")
            .bind(session_file.to_string_lossy().to_string())
            .execute(&pool)
            .await
            .expect("move resume compatibility native session outside stale Project root");
        sqlx::query(
            r#"
            INSERT INTO task_workspace_binding_history (
              binding_id, company_id, project_id, thread_id, turn_id, request_id,
              access, canonical_root, root_identity_json,
              workspace_basename_normalized, project_name_normalized,
              workspace_anchor, git_origin_digest,
              recovery_witness_binding_id, recovery_witness_authority_project_id,
              authority_snapshot_canonical_root,
              authority_snapshot_root_identity_json,
              authority_snapshot_updated_at_unix_ms,
              source, confidence, reason_code, issued_at_unix_ms,
              expires_at_unix_ms, activated_at_unix_ms, last_used_at_unix_ms,
              status, resumed_from_binding_id
            ) VALUES (
              'witness-1', 'company-1', 'project-1', 'thread-1', 'witness-turn',
              'witness-request', 'write', ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 1000,
              'project_catalog', 1.0, 'current_project_folder', 0, 1, 0, 0,
              'completed', NULL
            )
            "#,
        )
        .bind(&original_text)
        .bind(&original_recovery_identity)
        .bind(&original_evidence.basename_normalized)
        .bind(&original_evidence.project_name_normalized)
        .bind(&original_evidence.anchor)
        .bind(&original_evidence.git_origin_digest)
        .bind(&original_text)
        .bind(&authority_identity)
        .execute(&pool)
        .await
        .expect("insert successful recovery witness");

        std::fs::remove_dir_all(&original).expect("remove stale Project catalog root");
        let recovered = fixture.join("Project");
        std::fs::create_dir_all(&recovered).expect("create repository-matched recovery root");
        write_origin(&recovered, "git@example.com:org/repo.git");
        let recovered = recovered.canonicalize().expect("canonical recovered root");
        let recovered_text = canonical_root_text(&recovered).expect("recovered root text");
        let recovered_metadata = recovered
            .metadata()
            .expect("inspect recovered root identity");
        let recovered_identity = serde_json::json!({
            "canonicalRoot": &recovered_text,
            "device": recovered_metadata.dev(),
            "inode": recovered_metadata.ino(),
        })
        .to_string();
        let recovered_evidence =
            crate::workspace_recovery::capture_workspace_evidence(&recovered, "Project")
                .expect("capture recovered evidence");

        let resolution = crate::workspace_recovery::resolve_workspace_root_from_pool(
            &pool,
            crate::workspace_recovery::WorkspaceRecoveryScope {
                company_id: "company-1",
                project_id: "project-1",
                thread_id: "thread-1",
            },
        )
        .await
        .expect("resolve first repository recovery");
        let crate::workspace_recovery::WorkspaceRootResolution::Bound(resolved) = resolution else {
            panic!("repository-matched recovery should resolve before issuance");
        };
        assert_eq!(
            resolved.reason_code,
            WorkspaceRecoveryReason::UniqueNameRepoIdentityMatch
        );
        write_origin(&recovered, "git@example.com:other/repository.git");
        let registry = TaskWorkspaceBindingRegistry::default();
        match publish_resolved_task_workspace_binding(
            &pool,
            &registry,
            IssueTaskWorkspaceBinding {
                company_id: "company-1",
                project_id: "project-1",
                thread_id: "thread-1",
                turn_id: "fresh-turn",
                request_id: "fresh-request",
                access: TaskWorkspaceAccess::Write,
            },
            *resolved,
            None,
        )
        .await
        {
            Err(HostError::Request(message)) => assert_eq!(
                message,
                "Recovered Project repository identity changed before binding issuance."
            ),
            Err(error) => panic!("unexpected repository recheck error: {error:?}"),
            Ok(_) => panic!("changed repository identity must not publish a capability"),
        }
        let rejected_publish_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM task_workspace_binding_history WHERE request_id = 'fresh-request'",
        )
        .fetch_one(&pool)
        .await
        .expect("inspect rejected repository capability publication");
        assert_eq!(rejected_publish_count, 0);
        write_origin(&recovered, "git@example.com:org/repo.git");

        sqlx::query(
            r#"
            UPDATE task_workspace_binding_history
            SET canonical_root = ?, root_identity_json = ?,
                workspace_basename_normalized = ?, project_name_normalized = ?,
                workspace_anchor = ?, git_origin_digest = ?,
                recovery_witness_binding_id = 'witness-1',
                source = 'known_root_recovery', confidence = 0.95,
                reason_code = 'unique_name_repo_identity_match'
            WHERE binding_id = 'history-1'
            "#,
        )
        .bind(&recovered_text)
        .bind(&recovered_identity)
        .bind(&recovered_evidence.basename_normalized)
        .bind(&recovered_evidence.project_name_normalized)
        .bind(&recovered_evidence.anchor)
        .bind(&recovered_evidence.git_origin_digest)
        .execute(&pool)
        .await
        .expect("project interrupted history onto recovered root");
        let runtime_context_json: String = sqlx::query_scalar(
            "SELECT runtime_context_json FROM agent_runs WHERE run_id = 'turn-1'",
        )
        .fetch_one(&pool)
        .await
        .expect("read recovered resume runtime context");
        let mut runtime_context: serde_json::Value = serde_json::from_str(&runtime_context_json)
            .expect("decode recovered resume runtime context");
        runtime_context["workspaceBinding"]["source"] = serde_json::json!("known_root_recovery");
        runtime_context["workspaceBinding"]["reasonCode"] =
            serde_json::json!("unique_name_repo_identity_match");
        sqlx::query(
            "UPDATE agent_runs SET runtime_context_json = ?, session_file = ? WHERE run_id = 'turn-1'",
        )
        .bind(runtime_context.to_string())
        .bind(session_file.to_string_lossy().to_string())
        .execute(&pool)
        .await
        .expect("project recovered resume runtime context");

        write_origin(&recovered, "git@example.com:other/repository.git");

        sqlx::query(
            "ALTER TABLE task_workspace_lease_history RENAME TO task_workspace_lease_history_unavailable",
        )
        .execute(&pool)
        .await
        .expect("simulate transient durable-authority storage failure");
        let transient_failure = match task_workspace_resume_compatibility_from_pool(
            &pool,
            &session_dir,
            "history-1",
            "company-1",
            "project-1",
            "thread-1",
            "turn-1",
            TaskWorkspaceAccess::Write,
        )
        .await
        {
            Ok(_) => panic!("transient storage failure must not be cached as incompatible"),
            Err(error) => error,
        };
        assert!(transient_failure.contains("Check recovered workspace ownership"));
        sqlx::query(
            "ALTER TABLE task_workspace_lease_history_unavailable RENAME TO task_workspace_lease_history",
        )
        .execute(&pool)
        .await
        .expect("restore durable-authority storage for retry");

        let resumed = crate::workspace_recovery::resolve_resumed_workspace_root_from_pool(
            &pool,
            crate::workspace_recovery::WorkspaceRecoveryScope {
                company_id: "company-1",
                project_id: "project-1",
                thread_id: "thread-1",
            },
            "history-1",
            "turn-1",
            "write",
        )
        .await
        .unwrap_or_else(|error| {
            panic!(
                "signed repository recovery must remain resumable after remote change: {}",
                error.into_message()
            )
        });
        resumed
            .verify_live()
            .expect("resume issuance depends on durable root identity, not the later remote");

        let compatibility = task_workspace_resume_compatibility_from_pool(
            &pool,
            &session_dir,
            "history-1",
            "company-1",
            "project-1",
            "thread-1",
            "turn-1",
            TaskWorkspaceAccess::Write,
        )
        .await
        .expect("preflight recovered workspace history");
        let projection =
            serde_json::to_value(compatibility).expect("serialize compatibility projection");
        assert_eq!(projection["status"], "same");
        assert_eq!(projection["reason"], "workspace_history_durable_match");
        assert!(projection.get("root").is_none());
        assert!(projection.get("workspaceRoot").is_none());
        let projection_text = projection.to_string();
        assert!(!projection_text.contains(&original_text));
        assert!(!projection_text.contains(&recovered_text));

        let wrong_access = task_workspace_resume_compatibility_from_pool(
            &pool,
            &session_dir,
            "history-1",
            "company-1",
            "project-1",
            "thread-1",
            "turn-1",
            TaskWorkspaceAccess::Read,
        )
        .await
        .expect("preflight mismatched access");
        let wrong_access = serde_json::to_value(wrong_access).expect("serialize access mismatch");
        assert_eq!(wrong_access["status"], "changed");
        assert_eq!(wrong_access["reason"], "workspace_scope_changed");

        std::fs::remove_dir_all(fixture).expect("remove resume compatibility fixture");
    }

    #[test]
    fn active_workspace_history_cannot_be_resumed_or_preflighted() {
        assert!(resume_history_is_recoverable(
            "app_restart",
            Some("interrupted")
        ));
        assert!(!resume_history_is_recoverable(
            "active",
            Some("interrupted")
        ));
        assert!(!resume_history_is_recoverable(
            "completed",
            Some("interrupted")
        ));
        assert!(!resume_history_is_recoverable(
            "app_restart",
            Some("running")
        ));
        assert!(!resume_history_is_recoverable("app_restart", None));
    }

    #[tokio::test]
    async fn codex_resume_claim_accepts_opaque_native_session_without_file_access() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create Codex resume fixture root");
        let root = root.canonicalize().expect("canonical Codex resume root");
        let pool = resume_race_pool("app_restart", "interrupted", &root).await;
        configure_codex_resume_identity(&pool, serde_json::json!("codex-thread-opaque"), None)
            .await;

        let mut resumed_binding = fixture_binding(&root, TaskWorkspaceAccess::Write);
        resumed_binding.binding_id = "codex-resumed-binding".into();
        resumed_binding.request_id = "codex-resumed-request".into();
        resumed_binding.source = WorkspaceRecoverySource::ResumeHistory;
        resumed_binding.reason_code = WorkspaceRecoveryReason::ResumeHistoryIdentityMatch;
        let root_text = canonical_root_text(&root).expect("Codex resume root text");
        let identity_json = serde_json::to_string(&resumed_binding.root_identity)
            .expect("encode Codex resume root identity");
        let expectation = ResumeBindingExpectation {
            history_id: "history-1".into(),
            session_dir: root.join("nonexistent-pi-session-dir"),
        };

        let recorded = record_task_workspace_binding_from_pool(
            &pool,
            &resumed_binding,
            &root_text,
            &identity_json,
            2_000,
            Some(&expectation),
        )
        .await
        .expect("claim Codex interrupted root using only its opaque native identity");
        assert_eq!(recorded.rows, 1);
        assert_eq!(
            recorded.resume_session,
            Some(NativeSessionReference::Opaque {
                engine_id: "codex".into(),
                account_id: "codex-subscription-fixture".into(),
                billing_mode: "subscription".into(),
                id: "codex-thread-opaque".into(),
            })
        );

        let row = sqlx::query(
            "SELECT status, runtime_context_json, session_file FROM agent_runs WHERE run_id = 'turn-1'",
        )
        .fetch_one(&pool)
        .await
        .expect("read claimed Codex interrupted root");
        let status: String = row.try_get("status").expect("decode Codex resume status");
        let session_file: Option<String> = row
            .try_get("session_file")
            .expect("decode Codex resume session file");
        let resumed_context_json: String = row
            .try_get("runtime_context_json")
            .expect("decode resumed Codex context");
        let resumed_context: serde_json::Value =
            serde_json::from_str(&resumed_context_json).expect("parse resumed Codex context");
        assert_eq!(status, "running");
        assert_eq!(session_file, None);
        assert_eq!(resumed_context["executionTarget"]["engineId"], "codex");
        assert_eq!(resumed_context["nativeSessionId"], "codex-thread-opaque");
        assert_eq!(resumed_context["requestId"], "codex-resumed-request");
        assert_eq!(
            resumed_context["workspaceBinding"]["historyId"],
            "codex-resumed-binding"
        );

        std::fs::remove_dir_all(root).expect("remove Codex resume fixture root");
    }

    #[tokio::test]
    async fn codex_resume_claim_rejects_any_persisted_session_file() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create invalid Codex resume fixture root");
        let root = root
            .canonicalize()
            .expect("canonical invalid Codex resume root");
        let pool = resume_race_pool("app_restart", "interrupted", &root).await;
        let forbidden_session_file = root.join("must-not-be-a-codex-session.jsonl");
        let forbidden_session_file = forbidden_session_file.to_string_lossy().to_string();
        configure_codex_resume_identity(
            &pool,
            serde_json::json!("codex-thread-opaque"),
            Some(&forbidden_session_file),
        )
        .await;

        let mut resumed_binding = fixture_binding(&root, TaskWorkspaceAccess::Write);
        resumed_binding.binding_id = "codex-file-backed-rejected".into();
        resumed_binding.request_id = "codex-file-backed-request".into();
        resumed_binding.source = WorkspaceRecoverySource::ResumeHistory;
        resumed_binding.reason_code = WorkspaceRecoveryReason::ResumeHistoryIdentityMatch;
        let error = record_task_workspace_binding_from_pool(
            &pool,
            &resumed_binding,
            &canonical_root_text(&root).expect("invalid Codex resume root text"),
            &serde_json::to_string(&resumed_binding.root_identity)
                .expect("encode invalid Codex resume root identity"),
            2_000,
            Some(&ResumeBindingExpectation {
                history_id: "history-1".into(),
                session_dir: root.join("must-not-be-read"),
            }),
        )
        .await
        .expect_err("Codex resume must reject every non-NULL session_file");
        assert!(matches!(
            error,
            HostError::ResumePrestart {
                code: "resume-prestart-session-invalid",
                ..
            }
        ));
        let status: String =
            sqlx::query_scalar("SELECT status FROM agent_runs WHERE run_id = 'turn-1'")
                .fetch_one(&pool)
                .await
                .expect("read rejected Codex resume status");
        let replacement_rows: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM task_workspace_binding_history WHERE binding_id = 'codex-file-backed-rejected'",
        )
        .fetch_one(&pool)
        .await
        .expect("count rejected Codex replacement history");
        assert_eq!(status, "interrupted");
        assert_eq!(replacement_rows, 0);

        std::fs::remove_dir_all(root).expect("remove invalid Codex resume fixture root");
    }

    #[tokio::test]
    async fn codex_resume_compatibility_requires_nonempty_opaque_session_id() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create missing Codex session fixture root");
        let root = root
            .canonicalize()
            .expect("canonical missing Codex session root");
        for invalid_session_id in [serde_json::Value::Null, serde_json::json!("   ")] {
            let pool = resume_race_pool("app_restart", "interrupted", &root).await;
            configure_codex_resume_identity(&pool, invalid_session_id, None).await;
            let compatibility = task_workspace_resume_compatibility_from_pool(
                &pool,
                &root.join("nonexistent-pi-session-dir"),
                "history-1",
                "company-1",
                "project-1",
                "thread-1",
                "turn-1",
                TaskWorkspaceAccess::Write,
            )
            .await
            .expect("preflight missing Codex opaque session identity");
            let projection = serde_json::to_value(compatibility)
                .expect("serialize missing Codex session compatibility");
            assert_eq!(projection["status"], "changed");
            assert_eq!(projection["reason"], "session_missing");
        }

        std::fs::remove_dir_all(root).expect("remove missing Codex session fixture root");
    }

    #[tokio::test]
    async fn codex_resume_rejects_every_durable_workspace_scope_mismatch() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create Codex scope fixture root");
        let root = root.canonicalize().expect("canonical Codex scope root");
        let mismatches = [
            (None, "requestId"),
            (None, "projectId"),
            (Some("workspaceBinding"), "historyId"),
            (Some("workspaceBinding"), "companyId"),
            (Some("workspaceBinding"), "projectId"),
            (Some("workspaceBinding"), "threadId"),
            (Some("workspaceBinding"), "turnId"),
            (Some("workspaceBinding"), "requestId"),
            (Some("workspaceBinding"), "access"),
            (Some("workspaceBinding"), "source"),
            (Some("workspaceBinding"), "reasonCode"),
        ];
        for (parent, field) in mismatches {
            let pool = resume_race_pool("app_restart", "interrupted", &root).await;
            configure_codex_resume_identity(&pool, serde_json::json!("codex-thread-opaque"), None)
                .await;
            let runtime_context_json: String = sqlx::query_scalar(
                "SELECT runtime_context_json FROM agent_runs WHERE run_id = 'turn-1'",
            )
            .fetch_one(&pool)
            .await
            .expect("read Codex scope context");
            let mut runtime_context: serde_json::Value =
                serde_json::from_str(&runtime_context_json).expect("decode Codex scope context");
            if let Some(parent) = parent {
                runtime_context[parent][field] = serde_json::json!("tampered");
            } else {
                runtime_context[field] = serde_json::json!("tampered");
            }
            sqlx::query("UPDATE agent_runs SET runtime_context_json = ? WHERE run_id = 'turn-1'")
                .bind(runtime_context.to_string())
                .execute(&pool)
                .await
                .expect("persist tampered Codex scope context");

            let compatibility = task_workspace_resume_compatibility_from_pool(
                &pool,
                &root.join("nonexistent-pi-session-dir"),
                "history-1",
                "company-1",
                "project-1",
                "thread-1",
                "turn-1",
                TaskWorkspaceAccess::Write,
            )
            .await
            .expect("preflight tampered Codex workspace scope");
            let projection = serde_json::to_value(compatibility)
                .expect("serialize tampered Codex compatibility");
            assert_eq!(
                projection["status"], "changed",
                "{parent:?}.{field} must fail closed"
            );
            assert_eq!(
                projection["reason"], "resume_context_invalid",
                "{parent:?}.{field} must report context drift"
            );
        }

        std::fs::remove_dir_all(root).expect("remove Codex scope fixture root");
    }

    #[tokio::test]
    async fn resume_and_discard_are_atomic_and_mutually_exclusive() {
        let root = std::env::temp_dir().join(format!("offisim-binding-{}", random_id()));
        std::fs::create_dir_all(&root).expect("create resume race fixture root");
        let root = root.canonicalize().expect("canonical resume race root");
        let mut resumed_binding = fixture_binding(&root, TaskWorkspaceAccess::Write);
        resumed_binding.binding_id = "resumed-binding".into();
        resumed_binding.request_id = "resumed-request".into();
        resumed_binding.source = WorkspaceRecoverySource::ResumeHistory;
        resumed_binding.reason_code = WorkspaceRecoveryReason::ResumeHistoryIdentityMatch;
        let root_text = canonical_root_text(&root).expect("resume root text");
        let identity_json =
            serde_json::to_string(&resumed_binding.root_identity).expect("encode resume identity");
        let resume_expectation = ResumeBindingExpectation {
            history_id: "history-1".into(),
            session_dir: root.clone(),
        };

        let resume_first = resume_race_pool("app_restart", "interrupted", &root).await;
        assert_eq!(
            record_task_workspace_binding_from_pool(
                &resume_first,
                &resumed_binding,
                &root_text,
                &identity_json,
                2_000,
                Some(&resume_expectation),
            )
            .await
            .expect("resume wins race")
            .rows,
            1
        );
        assert_eq!(
            cancel_interrupted_run_from_pool(
                &resume_first,
                Some("history-1"),
                "company-1",
                "project-1",
                "thread-1",
                "turn-1",
            )
            .await
            .expect("discard loses after resume"),
            0
        );

        let discard_first = resume_race_pool("app_restart", "interrupted", &root).await;
        assert_eq!(
            cancel_interrupted_run_from_pool(
                &discard_first,
                Some("history-1"),
                "company-1",
                "project-1",
                "thread-1",
                "turn-1",
            )
            .await
            .expect("discard wins race"),
            1
        );
        let mut late_binding = resumed_binding.clone();
        late_binding.binding_id = "late-resume-binding".into();
        late_binding.request_id = "late-resume-request".into();
        let late_resume_error = record_task_workspace_binding_from_pool(
            &discard_first,
            &late_binding,
            &root_text,
            &identity_json,
            2_001,
            Some(&resume_expectation),
        )
        .await
        .expect_err("late resume condition is evaluated atomically");
        assert!(matches!(
            late_resume_error,
            HostError::ResumePrestart {
                code: "resume-prestart-conflict",
                ..
            }
        ));

        let active_history = resume_race_pool("active", "interrupted", &root).await;
        let mut active_binding = resumed_binding;
        active_binding.binding_id = "active-history-resume".into();
        active_binding.request_id = "active-history-request".into();
        let active_history_error = record_task_workspace_binding_from_pool(
            &active_history,
            &active_binding,
            &root_text,
            &identity_json,
            2_002,
            Some(&resume_expectation),
        )
        .await
        .expect_err("active history is rejected by conditional insert");
        assert!(matches!(
            active_history_error,
            HostError::ResumePrestart {
                code: "resume-prestart-conflict",
                ..
            }
        ));

        std::fs::remove_dir_all(root).expect("remove resume race fixture root");
    }
}
