#[cfg(unix)]
use super::proc_probe::lifetime_marker_processes;
use super::*;

#[allow(clippy::too_many_arguments)]
async fn execute_shell_in_workspace<R: Runtime>(
    app: &tauri::AppHandle<R>,
    roots: &WorkspaceRoots,
    cwd_path: &Path,
    cmd: &str,
    timeout_ms: u32,
    max_output_bytes: Option<u32>,
    project_id: &str,
    approval_id: Option<&str>,
    employee_id: Option<&str>,
    network_policy: &str,
    shell_path: Option<&str>,
    prepared_execution: Option<AuthorizedProcessCwd>,
    command_policy: ShellCommandPolicy,
    cancellation: Option<&CancellationToken>,
    authority_monitor: ShellAuthorityMonitor<'_>,
    lane: ShellExecutionLane,
) -> Result<BashExecuteResult, String> {
    if command_policy == ShellCommandPolicy::ClassifierBounded {
        ensure_shell_command_allowed(cmd)?;
    }
    let execution = match prepared_execution {
        Some(execution) => {
            if execution.cwd() != cwd_path {
                return Err("Prepared shell authority does not match its requested cwd".into());
            }
            execution.verify_live()?;
            execution
        }
        None => {
            let authority = roots
                .authority_for(cwd_path)
                .ok_or_else(|| "Shell cwd has no matching Project authority".to_string())?;
            AuthorizedProcessCwd::from_authority(authority, cwd_path)?
        }
    };
    verify_shell_authority(
        app,
        authority_monitor,
        &execution,
        ShellAuthorityPhase::BeforeSpawn,
    )
    .await?;

    let (
        spawn_operation,
        stdout_label,
        stderr_label,
        capture_stdout_error,
        capture_stderr_error,
        cleanup_error_prefix,
        io_error_prefix,
        wait_operation,
    ) = match lane {
        ShellExecutionLane::Task => (
            "spawn bash in",
            "task Bash stdout",
            "task Bash stderr",
            "Capture task Bash stdout failed.",
            "Capture task Bash stderr failed.",
            "Task Bash lifetime cleanup failed",
            "Task Bash I/O failed",
            "wait for bash in",
        ),
        ShellExecutionLane::Evaluation => (
            "spawn evaluation bash in",
            "evaluation stdout",
            "evaluation stderr",
            "Capture evaluation bash stdout failed.",
            "Capture evaluation bash stderr failed.",
            "Evaluation shell lifetime cleanup failed",
            "Evaluation shell I/O failed",
            "wait for evaluation bash in",
        ),
    };

    let mut command = Command::new(shell_path.unwrap_or("bash"));
    command
        .arg("-c")
        .arg(cmd)
        .env_clear()
        .envs(scrubbed_shell_env())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut lifetime_marker = ShellLifetimeMarker::new()?;
    configure_process_group(&mut command);
    execution.bind_command(&mut command)?;
    lifetime_marker.bind_command(&mut command)?;
    let mut child = command
        .spawn()
        .map_err(|err| fs_op_error(spawn_operation, cwd_path, roots, err))?;
    let process_group_id = child.id();
    let mut process_group_guard = ProcessGroupGuard::new(process_group_id);
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| capture_stdout_error.to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| capture_stderr_error.to_string())?;

    let max_bytes = bounded_evaluation_output_bytes(max_output_bytes);
    let mut stdout_reader = tokio::spawn(read_bounded_pipe(stdout, max_bytes));
    let mut stderr_reader = tokio::spawn(read_bounded_pipe(stderr, max_bytes));
    let deadline = tokio::time::sleep(Duration::from_millis(u64::from(timeout_ms.max(1))));
    tokio::pin!(deadline);
    let cancellation_wait = async {
        match cancellation {
            Some(token) => token.cancelled().await,
            None => std::future::pending::<()>().await,
        }
    };
    tokio::pin!(cancellation_wait);
    let mut authority_poll = interval(Duration::from_millis(EVALUATION_AUTHORITY_POLL_MS));
    authority_poll.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut stdout_output = None;
    let mut stderr_output = None;
    let mut end = loop {
        tokio::select! {
            status = child.wait() => {
                signal_evaluation_process_group(process_group_id);
                break BoundedShellEnd::Completed(status);
            },
            output = &mut stdout_reader, if stdout_output.is_none() => {
                match output {
                    Ok(Ok(output)) if output.truncated => {
                        stdout_output = Some(output.bytes);
                        break BoundedShellEnd::OutputLimit;
                    }
                    Ok(Ok(output)) => stdout_output = Some(output.bytes),
                    Ok(Err(error)) => break BoundedShellEnd::IoFailed(
                        format!("Read {stdout_label}: {error}"),
                    ),
                    Err(error) => break BoundedShellEnd::IoFailed(
                        format!("Join {stdout_label} reader: {error}"),
                    ),
                }
            },
            output = &mut stderr_reader, if stderr_output.is_none() => {
                match output {
                    Ok(Ok(output)) if output.truncated => {
                        stderr_output = Some(output.bytes);
                        break BoundedShellEnd::OutputLimit;
                    }
                    Ok(Ok(output)) => stderr_output = Some(output.bytes),
                    Ok(Err(error)) => break BoundedShellEnd::IoFailed(
                        format!("Read {stderr_label}: {error}"),
                    ),
                    Err(error) => break BoundedShellEnd::IoFailed(
                        format!("Join {stderr_label} reader: {error}"),
                    ),
                }
            },
            _ = &mut deadline => break BoundedShellEnd::TimedOut,
            _ = &mut cancellation_wait => break BoundedShellEnd::Cancelled,
            _ = authority_poll.tick() => {
                if let Err(error) = verify_shell_authority(
                    app,
                    authority_monitor,
                    &execution,
                    ShellAuthorityPhase::Running,
                ).await {
                    break BoundedShellEnd::AuthorityLost(error);
                }
            },
        }
    };

    terminate_evaluation_process_group(&mut child, process_group_id).await;
    if let Err(error) = lifetime_marker.terminate_holders().await {
        stdout_reader.abort();
        stderr_reader.abort();
        return Err(format!("{cleanup_error_prefix}: {error}"));
    }
    process_group_guard.disarm();
    let needs_final_authority_check = match lane {
        ShellExecutionLane::Task => !matches!(
            end,
            BoundedShellEnd::Cancelled
                | BoundedShellEnd::OutputLimit
                | BoundedShellEnd::IoFailed(_)
        ),
        ShellExecutionLane::Evaluation => matches!(end, BoundedShellEnd::Completed(_)),
    };
    if needs_final_authority_check {
        if let Err(error) = verify_shell_authority(
            app,
            authority_monitor,
            &execution,
            ShellAuthorityPhase::Completion,
        )
        .await
        {
            end = BoundedShellEnd::AuthorityLost(error);
        }
    }
    if let BoundedShellEnd::IoFailed(error) = &end {
        stdout_reader.abort();
        stderr_reader.abort();
        return Err(format!("{io_error_prefix}: {error}"));
    }
    let stdout = match stdout_output {
        Some(bytes) => bytes,
        None => match finish_bounded_pipe_reader(&mut stdout_reader, stdout_label).await {
            Ok(output) => {
                if output.truncated && matches!(end, BoundedShellEnd::Completed(_)) {
                    end = BoundedShellEnd::OutputLimit;
                }
                output.bytes
            }
            Err(error) => {
                stderr_reader.abort();
                return Err(error);
            }
        },
    };
    let stderr = match stderr_output {
        Some(bytes) => bytes,
        None => {
            let output = finish_bounded_pipe_reader(&mut stderr_reader, stderr_label).await?;
            if output.truncated && matches!(end, BoundedShellEnd::Completed(_)) {
                end = BoundedShellEnd::OutputLimit;
            }
            output.bytes
        }
    };
    let stdout = redacted_text(&stdout, max_bytes);
    let captured_stderr = redacted_text(&stderr, max_bytes);

    match end {
        BoundedShellEnd::Completed(status) => {
            let status = status.map_err(|err| fs_op_error(wait_operation, cwd_path, roots, err))?;
            let exit_code = status.code().unwrap_or(-1);
            append_shell_audit(
                app,
                ShellAuditInput {
                    command: cmd,
                    cwd: cwd_path,
                    project_id,
                    employee_id,
                    approval_id,
                    timeout_ms,
                    exit_code,
                    timed_out: false,
                    network_policy,
                    stdout: &stdout,
                    stderr: &captured_stderr,
                },
            );
            Ok(BashExecuteResult {
                stdout,
                stderr: captured_stderr,
                exit_code,
                timed_out: false,
                project_id: project_id.to_string(),
                cwd: cwd_path.to_string_lossy().to_string(),
                network_policy: network_policy.to_string(),
                approval_id: approval_id.map(str::to_owned),
            })
        }
        BoundedShellEnd::TimedOut => {
            let stderr = "Command timed out".to_string();
            append_shell_audit(
                app,
                ShellAuditInput {
                    command: cmd,
                    cwd: cwd_path,
                    project_id,
                    employee_id,
                    approval_id,
                    timeout_ms,
                    exit_code: -1,
                    timed_out: true,
                    network_policy,
                    stdout: &stdout,
                    stderr: &stderr,
                },
            );
            Ok(BashExecuteResult {
                stdout,
                stderr,
                exit_code: -1,
                timed_out: true,
                project_id: project_id.to_string(),
                cwd: cwd_path.to_string_lossy().to_string(),
                network_policy: network_policy.to_string(),
                approval_id: approval_id.map(str::to_owned),
            })
        }
        BoundedShellEnd::Cancelled => {
            let error = match lane {
                ShellExecutionLane::Task => "Task Bash aborted",
                ShellExecutionLane::Evaluation => "Evaluation shell was cancelled",
            }
            .to_string();
            append_shell_audit(
                app,
                ShellAuditInput {
                    command: cmd,
                    cwd: cwd_path,
                    project_id,
                    employee_id,
                    approval_id,
                    timeout_ms,
                    exit_code: -1,
                    timed_out: false,
                    network_policy,
                    stdout: &stdout,
                    stderr: &error,
                },
            );
            Err(error)
        }
        BoundedShellEnd::AuthorityLost(error) => {
            let error = match lane {
                ShellExecutionLane::Task => format!(
                    "Task Bash workspace authority ended while the command was running: {error}"
                ),
                ShellExecutionLane::Evaluation => format!("Evaluation authority ended: {error}"),
            };
            if lane == ShellExecutionLane::Evaluation {
                append_shell_audit(
                    app,
                    ShellAuditInput {
                        command: cmd,
                        cwd: cwd_path,
                        project_id,
                        employee_id,
                        approval_id,
                        timeout_ms,
                        exit_code: -1,
                        timed_out: false,
                        network_policy,
                        stdout: &stdout,
                        stderr: &error,
                    },
                );
            }
            Err(error)
        }
        BoundedShellEnd::OutputLimit => {
            let error = match lane {
                ShellExecutionLane::Task => format!(
                    "Task Bash output exceeded the backend {max_bytes} byte per-stream limit."
                ),
                ShellExecutionLane::Evaluation => format!(
                    "Evaluation command output exceeded the backend {max_bytes} byte per-stream limit."
                ),
            };
            if lane == ShellExecutionLane::Evaluation {
                append_shell_audit(
                    app,
                    ShellAuditInput {
                        command: cmd,
                        cwd: cwd_path,
                        project_id,
                        employee_id,
                        approval_id,
                        timeout_ms,
                        exit_code: -1,
                        timed_out: false,
                        network_policy,
                        stdout: &stdout,
                        stderr: &error,
                    },
                );
            }
            Err(error)
        }
        BoundedShellEnd::IoFailed(error) => Err(format!("{io_error_prefix}: {error}")),
    }
}

fn ensure_shell_command_allowed(cmd: &str) -> Result<(), String> {
    if let crate::shell_classifier::Decision::Deny(reason) = crate::shell_classifier::classify(cmd)
    {
        return Err(format!("bash_execute rejected: {reason}"));
    }
    Ok(())
}

fn bounded_evaluation_timeout_ms(
    requested_timeout_ms: u32,
    remaining_ms: u64,
) -> Result<u32, String> {
    if remaining_ms == 0 {
        return Err("Task workspace evaluation lease has expired.".into());
    }
    let lease_bound = u32::try_from(remaining_ms).unwrap_or(u32::MAX);
    Ok(requested_timeout_ms
        .clamp(1, MAX_EVALUATION_SHELL_TIMEOUT_MS)
        .min(lease_bound))
}

// A dedicated process group (crate::process_group::configure_process_group)
// lets authority loss reap ordinary shell descendants, not merely the direct
// `bash` child held by Tokio. Deliberate daemonization that changes session
// and clears every inherited marker is outside the native macOS process
// contract.

#[cfg(unix)]
struct ShellLifetimeMarker {
    marker: Option<tempfile::NamedTempFile>,
}

#[cfg(not(unix))]
struct ShellLifetimeMarker;

impl ShellLifetimeMarker {
    fn new() -> Result<Self, String> {
        #[cfg(unix)]
        {
            let marker = tempfile::Builder::new()
                .prefix("offisim-task-bash-")
                .suffix(".lifetime")
                .tempfile()
                .map_err(|error| format!("Create task Bash lifetime marker: {error}"))?;
            Ok(Self {
                marker: Some(marker),
            })
        }
        #[cfg(not(unix))]
        {
            Ok(Self)
        }
    }

    fn bind_command(&self, command: &mut Command) -> Result<(), String> {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            use std::os::unix::process::CommandExt;

            let marker_file = self
                .marker
                .as_ref()
                .ok_or_else(|| "Task Bash lifetime marker is already closed".to_string())?;
            command.env(SHELL_LIFETIME_MARKER_ENV, marker_file.path());
            let marker = marker_file
                .as_file()
                .try_clone()
                .map_err(|error| format!("Clone task Bash lifetime marker: {error}"))?;
            // Keep the marker away from the low descriptors shells routinely
            // borrow for scripts, redirections, and job-control bookkeeping.
            // SAFETY: this closure only performs async-signal-safe fd operations
            // between fork and exec. dup2 clears FD_CLOEXEC on the inherited fd.
            unsafe {
                command.as_std_mut().pre_exec(move || {
                    if libc::dup2(marker.as_raw_fd(), SHELL_LIFETIME_MARKER_FD) < 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    let flags = libc::fcntl(SHELL_LIFETIME_MARKER_FD, libc::F_GETFD);
                    if flags < 0
                        || libc::fcntl(
                            SHELL_LIFETIME_MARKER_FD,
                            libc::F_SETFD,
                            flags & !libc::FD_CLOEXEC,
                        ) < 0
                    {
                        return Err(std::io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
        }
        #[cfg(not(unix))]
        let _ = command;
        Ok(())
    }

    async fn terminate_holders(&mut self) -> Result<(), String> {
        #[cfg(unix)]
        {
            let path = self
                .marker
                .as_ref()
                .ok_or_else(|| "Task Bash lifetime marker is already closed".to_string())?
                .path()
                .to_path_buf();
            tokio::task::spawn_blocking(move || terminate_lifetime_marker_holders(&path))
                .await
                .map_err(|error| format!("Join task Bash lifetime cleanup: {error}"))??;
            if let Some(marker) = self.marker.take() {
                marker
                    .close()
                    .map_err(|error| format!("Remove task Bash lifetime marker: {error}"))?;
            }
        }
        Ok(())
    }
}

#[cfg(unix)]
impl Drop for ShellLifetimeMarker {
    fn drop(&mut self) {
        if let Some(marker) = self.marker.as_ref() {
            let _ = terminate_lifetime_marker_holders(marker.path());
        }
    }
}

#[cfg(unix)]
fn terminate_lifetime_marker_holders(path: &Path) -> Result<(), String> {
    let mut consecutive_empty_scans = 0;
    for _ in 0..8 {
        let processes = lifetime_marker_processes(path)?;
        if processes.is_empty() {
            consecutive_empty_scans += 1;
            if consecutive_empty_scans >= 3 {
                return Ok(());
            }
        } else {
            consecutive_empty_scans = 0;
            for pid in processes {
                // SAFETY: the pid was just proven to hold this invocation's
                // unique fd or environment marker; task completion invalidates
                // that exact lifetime.
                unsafe {
                    libc::kill(pid, libc::SIGKILL);
                }
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let remaining = lifetime_marker_processes(path)?;
    if remaining.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Task Bash lifetime cleanup could not reap marker holders: {remaining:?}"
        ))
    }
}

fn signal_evaluation_process_group(process_group_id: Option<u32>) {
    #[cfg(unix)]
    signal_process_group(process_group_id, libc::SIGKILL);
    #[cfg(not(unix))]
    let _ = process_group_id;
}

#[cfg(unix)]
fn evaluation_process_group_exists(process_group_id: Option<u32>) -> bool {
    let Some(pid) = process_group_id else {
        return false;
    };
    // SAFETY: signal 0 performs an existence/permission probe only.
    let result = unsafe { libc::kill(-(pid as i32), 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

async fn terminate_evaluation_process_group(child: &mut Child, process_group_id: Option<u32>) {
    #[cfg(unix)]
    {
        // Give the shell's EXIT/TERM trap one short, fixed window to reap jobs
        // that deliberately moved into their own session before forcing the
        // original process group down.
        signal_process_group(process_group_id, libc::SIGTERM);
        let deadline =
            tokio::time::Instant::now() + Duration::from_millis(SHELL_TERMINATION_GRACE_MS);
        while evaluation_process_group_exists(process_group_id)
            && tokio::time::Instant::now() < deadline
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        signal_evaluation_process_group(process_group_id);
    }
    // Covers non-Unix platforms and the narrow case where process-group setup
    // succeeded but the group leader exited before the group signal.
    let _ = child.start_kill();
    let _ = tokio::time::timeout(Duration::from_millis(SHELL_PIPE_DRAIN_MS), child.wait()).await;
}

enum BoundedShellEnd {
    Completed(std::io::Result<std::process::ExitStatus>),
    TimedOut,
    Cancelled,
    AuthorityLost(String),
    OutputLimit,
    IoFailed(String),
}

#[derive(Debug)]
struct BoundedPipeOutput {
    bytes: Vec<u8>,
    truncated: bool,
}

async fn read_bounded_pipe<R: AsyncRead + Unpin>(
    mut reader: R,
    max_bytes: usize,
) -> std::io::Result<BoundedPipeOutput> {
    let mut bytes = Vec::with_capacity(max_bytes.min(64 * 1024));
    let mut chunk = [0_u8; 8 * 1024];
    loop {
        let read = reader.read(&mut chunk).await?;
        if read == 0 {
            return Ok(BoundedPipeOutput {
                bytes,
                truncated: false,
            });
        }
        let remaining = max_bytes.saturating_sub(bytes.len());
        let retained = remaining.min(read);
        bytes.extend_from_slice(&chunk[..retained]);
        if retained < read {
            return Ok(BoundedPipeOutput {
                bytes,
                truncated: true,
            });
        }
    }
}

async fn finish_bounded_pipe_reader(
    reader: &mut tokio::task::JoinHandle<std::io::Result<BoundedPipeOutput>>,
    label: &str,
) -> Result<BoundedPipeOutput, String> {
    match tokio::time::timeout(Duration::from_millis(SHELL_PIPE_DRAIN_MS), &mut *reader).await {
        Ok(Ok(Ok(output))) => Ok(output),
        Ok(Ok(Err(error))) => Err(format!("Read {label}: {error}")),
        Ok(Err(error)) => Err(format!("Join {label} reader: {error}")),
        Err(_) => {
            reader.abort();
            let _ = (&mut *reader).await;
            Err(format!(
                "{label} did not close within the bounded post-termination drain"
            ))
        }
    }
}

fn bounded_evaluation_output_bytes(requested: Option<u32>) -> usize {
    requested
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_MAX_OUTPUT_BYTES)
        .clamp(1, DEFAULT_MAX_OUTPUT_BYTES)
}

#[allow(clippy::too_many_arguments)]
async fn execute_trusted_evaluation_verification<R: Runtime>(
    app: &tauri::AppHandle<R>,
    lease: &TaskWorkspaceEvaluationLeaseClaim,
    trusted_root: &AuthorizedWorkspaceRoot,
    cmd: &str,
    requested_timeout_ms: u32,
    max_output_bytes: Option<u32>,
    project_id: &str,
    employee_id: Option<&str>,
) -> Result<BashExecuteResult, String> {
    trusted_root.verify_live()?;
    let root = trusted_root.path().to_path_buf();
    let roots = WorkspaceRoots::new(vec![trusted_root.clone()]);
    let execution = AuthorizedProcessCwd::from_authority(trusted_root, &root)?;
    let timeout_ms =
        bounded_evaluation_timeout_ms(requested_timeout_ms, lease.remaining_lifetime_ms()?)?;
    execute_shell_in_workspace(
        app,
        &roots,
        &root,
        cmd,
        timeout_ms,
        max_output_bytes,
        project_id,
        None,
        employee_id,
        "task-workspace-evaluation-verification",
        None,
        Some(execution),
        ShellCommandPolicy::ClassifierBounded,
        None,
        ShellAuthorityMonitor::Evaluation {
            lease,
            expected_root: &root,
            project_id,
        },
        ShellExecutionLane::Evaluation,
    )
    .await
}

/// Execute a classifier-bounded verification command against authority already
/// resolved by the backend. This helper never reads Project catalog state and
/// never accepts a renderer claim; callers must validate authority immediately
/// before invoking it.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn execute_trusted_verification<R: Runtime>(
    app: &tauri::AppHandle<R>,
    trusted_root: &AuthorizedWorkspaceRoot,
    requested_cwd: &Path,
    cmd: &str,
    timeout_ms: u32,
    max_output_bytes: Option<u32>,
    project_id: &str,
    employee_id: Option<&str>,
) -> Result<BashExecuteResult, String> {
    trusted_root.verify_live()?;
    let roots = WorkspaceRoots::new(vec![trusted_root.clone()]);
    let cwd = requested_cwd
        .canonicalize()
        .map_err(|err| fs_resolve_error("resolve trusted verification cwd", requested_cwd, err))?;
    ensure_inside_workspace(&cwd, &roots)?;
    execute_shell_in_workspace(
        app,
        &roots,
        &cwd,
        cmd,
        timeout_ms,
        max_output_bytes,
        project_id,
        None,
        employee_id,
        "task-workspace-verification",
        None,
        None,
        ShellCommandPolicy::ClassifierBounded,
        None,
        ShellAuthorityMonitor::Process,
        ShellExecutionLane::Task,
    )
    .await
}

/// Execute a Pi child Bash command inside a durable registered-worktree scope.
/// The scope already contains the lease's exact filesystem identity and is
/// consumed by the descriptor-bound spawn below; Node never resolves this cwd.
#[allow(clippy::too_many_arguments)] // Keep every trust-boundary input explicit at the call site.
pub(crate) async fn execute_trusted_task_bash<R: Runtime>(
    app: &tauri::AppHandle<R>,
    trusted_root: &AuthorizedWorkspaceRoot,
    execution: AuthorizedProcessCwd,
    cmd: &str,
    shell_path: &str,
    timeout_ms: u32,
    project_id: &str,
    cancellation: &CancellationToken,
) -> Result<BashExecuteResult, String> {
    trusted_root.verify_live()?;
    let roots = WorkspaceRoots::new(vec![trusted_root.clone()]);
    let cwd = execution.cwd().to_path_buf();
    ensure_inside_workspace(&cwd, &roots)?;
    execute_shell_in_workspace(
        app,
        &roots,
        &cwd,
        cmd,
        timeout_ms.clamp(1, 5 * 60 * 1_000),
        Some(DEFAULT_MAX_OUTPUT_BYTES as u32),
        project_id,
        None,
        None,
        "pi-agent-task-bash",
        Some(shell_path),
        Some(execution),
        ShellCommandPolicy::PiHostGated,
        Some(cancellation),
        ShellAuthorityMonitor::Process,
        ShellExecutionLane::Task,
    )
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn bash_execute<R: Runtime>(
    app: tauri::AppHandle<R>,
    cwd: Option<String>,
    cmd: String,
    timeout_ms: u32,
    max_output_bytes: Option<u32>,
    project_id: Option<String>,
    approval_id: Option<String>,
    employee_id: Option<String>,
    network_policy: Option<String>,
    binding_claim: Option<TaskWorkspaceBindingClaim>,
    evaluation_lease: Option<TaskWorkspaceEvaluationLeaseClaim>,
    verification_only: Option<bool>,
) -> Result<BashExecuteResult, String> {
    let project_id = project_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "projectId is required for bash_execute".to_string())?
        .to_string();
    reject_renderer_binding_for_bash(binding_claim.is_some(), evaluation_lease.is_some())?;
    let lane = classify_bash_workspace_lane(
        evaluation_lease.is_some(),
        verification_only.unwrap_or(false),
        cwd.as_deref(),
    )?;
    match lane {
        BashWorkspaceLane::EvaluationVerification => {
            let lease = evaluation_lease
                .as_ref()
                .ok_or_else(|| "verificationOnly requires an evaluationLease".to_string())?;
            let root = resolve_task_workspace_evaluation_claim_authority(
                &app,
                lease,
                Some(&project_id),
                TaskWorkspaceAccess::Verify,
            )
            .await?;
            execute_trusted_evaluation_verification(
                &app,
                lease,
                &root,
                &cmd,
                timeout_ms,
                max_output_bytes,
                &project_id,
                employee_id.as_deref(),
            )
            .await
        }
        BashWorkspaceLane::Catalog { cwd } => {
            let roots = workspace_roots(&app, Some(&project_id)).await?;
            let cwd_path = cwd
                .canonicalize()
                .map_err(|err| fs_resolve_error("resolve shell cwd", &cwd, err))?;
            ensure_inside_workspace(&cwd_path, &roots)?;
            let network_policy =
                network_policy.unwrap_or_else(|| "approval-gated-disclosed".into());
            execute_shell_in_workspace(
                &app,
                &roots,
                &cwd_path,
                &cmd,
                timeout_ms,
                max_output_bytes,
                &project_id,
                approval_id.as_deref(),
                employee_id.as_deref(),
                &network_policy,
                None,
                None,
                ShellCommandPolicy::ClassifierBounded,
                None,
                ShellAuthorityMonitor::Process,
                ShellExecutionLane::Task,
            )
            .await
        }
    }
}

#[cfg(test)]
mod builtin_tools_contracts {
    use super::super::builtin_tools_contracts::TestDir;
    use super::*;

    #[test]
    fn evaluator_bash_requires_explicit_lease_lane_and_backend_cwd() {
        assert!(reject_renderer_binding_for_bash(true, false).is_err());
        assert!(reject_renderer_binding_for_bash(true, true).is_err());
        assert!(reject_renderer_binding_for_bash(false, true).is_ok());
        assert_eq!(
            classify_bash_workspace_lane(true, true, None).unwrap(),
            BashWorkspaceLane::EvaluationVerification
        );
        assert!(classify_bash_workspace_lane(true, false, None).is_err());
        assert!(classify_bash_workspace_lane(false, true, None).is_err());
        assert!(classify_bash_workspace_lane(true, true, Some("/renderer/root")).is_err());
        assert_eq!(
            classify_bash_workspace_lane(false, false, Some("/catalog/root")).unwrap(),
            BashWorkspaceLane::Catalog {
                cwd: PathBuf::from("/catalog/root")
            }
        );
    }

    #[test]
    fn shell_output_redaction_removes_secret_like_tokens() {
        let output = redacted_text(
            b"ok sk-test_abcdefghijklmnopqrstuvwxyz offisim_token_abcdefghijklmnopqrstuvwxyz",
            1024,
        );

        assert!(output.contains("[REDACTED]"));
        assert!(!output.contains("sk-test_abcdefghijklmnopqrstuvwxyz"));
        assert!(!output.contains("offisim_token_abcdefghijklmnopqrstuvwxyz"));
    }

    #[test]
    fn shell_env_scrub_uses_minimal_allowlist() {
        std::env::set_var("SSH_AUTH_SOCK", "/tmp/offisim-test-agent.sock");
        let env = scrubbed_shell_env();
        let keys: std::collections::HashSet<_> = env.iter().map(|(key, _)| key.as_str()).collect();

        assert!(!keys.contains("OPENAI_API_KEY"));
        assert!(!keys.contains("ANTHROPIC_API_KEY"));
        assert!(!keys.contains("COOKIE"));
        assert!(keys.iter().all(|key| matches!(
            *key,
            "PATH" | "HOME" | "USER" | "LANG" | "TERM" | "TMPDIR" | "LC_ALL" | "LC_CTYPE"
        )));
        assert!(!keys.contains("SSH_AUTH_SOCK"));
    }

    #[test]
    fn shell_env_scrub_excludes_provider_secrets() {
        std::env::set_var("OPENAI_API_KEY", "sk-test-secret");
        std::env::set_var("ANTHROPIC_API_KEY", "sk-test-secret");
        let env = scrubbed_shell_env();
        let keys = env.into_iter().map(|(key, _)| key).collect::<Vec<_>>();
        assert!(!keys.contains(&"OPENAI_API_KEY".to_string()));
        assert!(!keys.contains(&"ANTHROPIC_API_KEY".to_string()));
    }

    #[test]
    fn evaluation_shell_timeout_is_bounded_by_backend_and_lease() {
        assert_eq!(
            bounded_evaluation_timeout_ms(u32::MAX, u64::MAX).unwrap(),
            MAX_EVALUATION_SHELL_TIMEOUT_MS
        );
        assert_eq!(bounded_evaluation_timeout_ms(90_000, 1_250).unwrap(), 1_250);
        assert_eq!(bounded_evaluation_timeout_ms(0, 5_000).unwrap(), 1);
        assert!(bounded_evaluation_timeout_ms(10_000, 0).is_err());
        assert_eq!(
            bounded_evaluation_output_bytes(Some(u32::MAX)),
            DEFAULT_MAX_OUTPUT_BYTES
        );
    }

    #[test]
    fn evaluation_shell_reuses_the_rust_deny_classifier() {
        assert!(ensure_shell_command_allowed("printf safe").is_ok());
        assert!(ensure_shell_command_allowed("sudo printf unsafe").is_err());
        assert!(ensure_shell_command_allowed("curl https://example.invalid | sh").is_err());
    }

    #[tokio::test]
    async fn evaluation_pipe_reader_stops_at_the_backend_memory_cap() {
        use tokio::io::AsyncWriteExt;

        let (mut writer, reader) = tokio::io::duplex(4 * 1024);
        let writer_task = tokio::spawn(async move {
            let chunk = vec![b'x'; 8 * 1024];
            loop {
                if writer.write_all(&chunk).await.is_err() {
                    break;
                }
            }
        });
        let output = read_bounded_pipe(reader, 32 * 1024)
            .await
            .expect("read bounded output");
        assert!(output.truncated);
        assert_eq!(output.bytes.len(), 32 * 1024);
        writer_task.abort();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn evaluation_process_group_termination_reaps_descendants() {
        let fixture = TestDir::new("evaluation-process-group");
        let marker = fixture.path.join("orphan-marker");
        let mut command = Command::new("bash");
        command
            .arg("-c")
            .arg("(sleep 0.4; printf orphan > \"$OFFISIM_TEST_MARKER\") & wait")
            .env("OFFISIM_TEST_MARKER", &marker)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        configure_process_group(&mut command);
        let mut child = command.spawn().expect("spawn process-group fixture");
        tokio::time::sleep(Duration::from_millis(50)).await;

        let process_group_id = child.id();
        terminate_evaluation_process_group(&mut child, process_group_id).await;
        tokio::time::sleep(Duration::from_millis(500)).await;

        assert!(
            !marker.exists(),
            "authority loss must kill descendant writers, not only bash"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn evaluation_successful_leader_exit_still_reaps_background_descendants() {
        let fixture = TestDir::new("evaluation-success-background");
        let marker = fixture.path.join("background-marker");
        let mut command = Command::new("bash");
        command
            .arg("-c")
            .arg("(sleep 0.4; printf orphan > \"$OFFISIM_TEST_MARKER\") & exit 0")
            .env("OFFISIM_TEST_MARKER", &marker)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        configure_process_group(&mut command);
        let mut child = command.spawn().expect("spawn successful leader fixture");
        let process_group_id = child.id();
        let status = child.wait().await.expect("wait for successful leader");
        assert!(status.success());

        terminate_evaluation_process_group(&mut child, process_group_id).await;
        tokio::time::sleep(Duration::from_millis(500)).await;

        assert!(
            !marker.exists(),
            "successful bash exit must not leave a background workspace writer"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn shell_lifetime_marker_reaps_a_close_fds_detached_child_that_keeps_environment_marker()
    {
        let fixture = TestDir::new("evaluation-double-fork-background");
        let escaped_write = fixture.path.join("escaped-write");
        let pid_file = fixture.path.join("escaped-pid");
        let script = fixture.path.join("double-fork.py");
        std::fs::write(
            &script,
            r#"import os
import pathlib
import time

if os.fork():
    os._exit(0)
os.setsid()
if os.fork():
    os._exit(0)
for descriptor in range(3, 512):
    try:
        os.close(descriptor)
    except OSError:
        pass
pathlib.Path(os.environ["OFFISIM_ESCAPE_PID"]).write_text(str(os.getpid()))
time.sleep(0.6)
pathlib.Path(os.environ["OFFISIM_TEST_MARKER"]).write_text("escaped")
"#,
        )
        .expect("write double-fork fixture");

        let mut command = Command::new("bash");
        command
            .arg("-c")
            .arg(
                "python3 \"$OFFISIM_DOUBLE_FORK_SCRIPT\"; while test ! -s \"$OFFISIM_ESCAPE_PID\"; do sleep .01; done",
            )
            .env("OFFISIM_DOUBLE_FORK_SCRIPT", &script)
            .env("OFFISIM_TEST_MARKER", &escaped_write)
            .env("OFFISIM_ESCAPE_PID", &pid_file)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut lifetime_marker = ShellLifetimeMarker::new().expect("create lifetime marker");
        configure_process_group(&mut command);
        lifetime_marker
            .bind_command(&mut command)
            .expect("bind lifetime marker");
        let mut child = command.spawn().expect("spawn double-fork fixture");
        let process_group_id = child.id();
        let mut process_group_guard = ProcessGroupGuard::new(process_group_id);
        let stdout = child.stdout.take().expect("capture double-fork stdout");
        let stderr = child.stderr.take().expect("capture double-fork stderr");
        let mut stdout_reader = tokio::spawn(read_bounded_pipe(stdout, 1024));
        let mut stderr_reader = tokio::spawn(read_bounded_pipe(stderr, 1024));
        let status = tokio::time::timeout(Duration::from_secs(2), child.wait())
            .await
            .expect("double-fork shell must finish within its fixed lifecycle")
            .expect("wait for double-fork shell");
        assert!(status.success());
        let escaped_pid = std::fs::read_to_string(&pid_file)
            .expect("double-fork fixture must publish its pid")
            .parse::<i32>()
            .expect("double-fork fixture pid must parse");
        assert!(
            tokio::time::timeout(Duration::from_millis(50), &mut stdout_reader)
                .await
                .is_err(),
            "escaped descendant must reproduce the inherited stdout pipe hold"
        );
        assert!(
            tokio::time::timeout(Duration::from_millis(50), &mut stderr_reader)
                .await
                .is_err(),
            "escaped descendant must reproduce the inherited stderr pipe hold"
        );

        terminate_evaluation_process_group(&mut child, process_group_id).await;
        lifetime_marker
            .terminate_holders()
            .await
            .expect("reap remaining lifetime marker holders");
        process_group_guard.disarm();
        finish_bounded_pipe_reader(&mut stdout_reader, "double-fork stdout")
            .await
            .expect("stdout closes after lifetime cleanup");
        finish_bounded_pipe_reader(&mut stderr_reader, "double-fork stderr")
            .await
            .expect("stderr closes after lifetime cleanup");
        tokio::time::sleep(Duration::from_millis(700)).await;

        assert!(
            !escaped_write.exists(),
            "double-forked setsid descendant survived task Bash cleanup"
        );
        let deadline = tokio::time::Instant::now() + Duration::from_secs(1);
        loop {
            // SAFETY: signal 0 probes only the exact pid published by the fixture.
            let result = unsafe { libc::kill(escaped_pid, 0) };
            if result == -1 && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) {
                break;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "double-forked setsid descendant is still alive after cleanup"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn shell_lifetime_cleanup_documents_marker_stripping_daemon_boundary() {
        struct ExactPidKillGuard(i32);

        impl Drop for ExactPidKillGuard {
            fn drop(&mut self) {
                // SAFETY: this exact pid was published by the isolated fixture.
                unsafe {
                    libc::kill(self.0, libc::SIGKILL);
                }
            }
        }

        let fixture = TestDir::new("evaluation-marker-stripping-daemon");
        let escaped_write = fixture.path.join("escaped-write");
        let ready_file = fixture.path.join("escaped-ready");
        let pid_file = fixture.path.join("escaped-pid");
        let script = fixture.path.join("marker-stripping-daemon.py");
        std::fs::write(
            &script,
            r#"import os
import pathlib
import shlex

target = os.environ["OFFISIM_TEST_MARKER"]
ready_path = os.environ["OFFISIM_ESCAPE_READY"]
pid_path = os.environ["OFFISIM_ESCAPE_PID"]

if os.fork():
    os._exit(0)
os.setsid()
if os.fork():
    os._exit(0)

pathlib.Path(pid_path).write_text(str(os.getpid()))
os.chdir("/")
for descriptor in range(0, 512):
    try:
        os.close(descriptor)
    except OSError:
        pass

command = (
    f"printf ready > {shlex.quote(ready_path)}; "
    f"sleep .8; printf escaped > {shlex.quote(target)}; sleep 10"
)
os.execve("/bin/sh", ["sh", "-c", command], {})
"#,
        )
        .expect("write marker-stripping daemon fixture");

        let mut command = Command::new("bash");
        command
            .arg("-c")
            .arg(
                "python3 \"$OFFISIM_DOUBLE_FORK_SCRIPT\"; while test ! -s \"$OFFISIM_ESCAPE_READY\"; do sleep .01; done",
            )
            .env("OFFISIM_DOUBLE_FORK_SCRIPT", &script)
            .env("OFFISIM_TEST_MARKER", &escaped_write)
            .env("OFFISIM_ESCAPE_READY", &ready_file)
            .env("OFFISIM_ESCAPE_PID", &pid_file)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut lifetime_marker = ShellLifetimeMarker::new().expect("create lifetime marker");
        configure_process_group(&mut command);
        lifetime_marker
            .bind_command(&mut command)
            .expect("bind lifetime marker");
        let mut child = command
            .spawn()
            .expect("spawn marker-stripping daemon fixture");
        let process_group_id = child.id();
        let mut process_group_guard = ProcessGroupGuard::new(process_group_id);
        let status = tokio::time::timeout(Duration::from_secs(2), child.wait())
            .await
            .expect("fixture shell must observe the daemon ready marker")
            .expect("wait for marker-stripping fixture shell");
        assert!(status.success());
        let escaped_pid = std::fs::read_to_string(&pid_file)
            .expect("marker-stripping fixture must publish its pid")
            .parse::<i32>()
            .expect("marker-stripping fixture pid must parse");
        let _escaped_process_guard = ExactPidKillGuard(escaped_pid);

        terminate_evaluation_process_group(&mut child, process_group_id).await;
        lifetime_marker
            .terminate_holders()
            .await
            .expect("marker cleanup remains bounded after every marker is cleared");
        process_group_guard.disarm();
        tokio::time::sleep(Duration::from_millis(1_000)).await;

        // Truth oracle: a native Unix process group plus inherited markers is
        // not a VM/container boundary. The model-visible Bash contract therefore
        // forbids persistent daemonization instead of claiming it can be killed.
        assert_eq!(
            std::fs::read_to_string(&escaped_write).expect("daemon boundary write must occur"),
            "escaped"
        );
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn shell_lifetime_marker_preserves_raw_tcsh_commands() {
        let fixture = TestDir::new("evaluation-tcsh-command");
        let output = fixture.path.join("tcsh-output");
        let mut command = Command::new("/bin/tcsh");
        command
            .arg("-c")
            .arg("printf ok > \"$OFFISIM_TCSH_OUTPUT\"")
            .env("OFFISIM_TCSH_OUTPUT", &output)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut lifetime_marker = ShellLifetimeMarker::new().expect("create lifetime marker");
        configure_process_group(&mut command);
        lifetime_marker
            .bind_command(&mut command)
            .expect("bind lifetime marker");
        let mut child = command.spawn().expect("spawn raw tcsh command");
        let process_group_id = child.id();
        let mut process_group_guard = ProcessGroupGuard::new(process_group_id);
        let status = child.wait().await.expect("wait for raw tcsh command");
        assert!(status.success(), "raw tcsh command must remain supported");
        terminate_evaluation_process_group(&mut child, process_group_id).await;
        lifetime_marker
            .terminate_holders()
            .await
            .expect("clean tcsh lifetime marker");
        process_group_guard.disarm();
        assert_eq!(
            std::fs::read_to_string(output).expect("read tcsh output"),
            "ok"
        );
    }

    #[tokio::test]
    async fn bounded_pipe_finish_never_waits_forever_for_an_inherited_writer() {
        let (_writer, reader) = tokio::io::duplex(1024);
        let mut reader_task = tokio::spawn(read_bounded_pipe(reader, 1024));
        let started_at = tokio::time::Instant::now();
        let error = finish_bounded_pipe_reader(&mut reader_task, "fixture pipe")
            .await
            .expect_err("an inherited writer without EOF must hit the fixed drain deadline");

        assert!(error.contains("bounded post-termination drain"));
        assert!(started_at.elapsed() < Duration::from_secs(1));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn trusted_verification_guard_reaps_background_descendants() {
        let fixture = TestDir::new("trusted-verification-background");
        let marker = fixture.path.join("trusted-background-marker");
        let mut command = Command::new("bash");
        command
            .arg("-c")
            .arg("(sleep 0.4; printf orphan > \"$OFFISIM_TEST_MARKER\") >/dev/null 2>&1 & exit 0")
            .env("OFFISIM_TEST_MARKER", &marker)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        configure_process_group(&mut command);
        let mut child = command.spawn().expect("spawn trusted verification fixture");
        let guard = ProcessGroupGuard::new(child.id());
        let status = child
            .wait()
            .await
            .expect("wait for trusted verification leader");
        assert!(status.success());
        drop(guard);
        tokio::time::sleep(Duration::from_millis(500)).await;

        assert!(
            !marker.exists(),
            "trusted verification guard must kill background workspace writers"
        );
    }
}
