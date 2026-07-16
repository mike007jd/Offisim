use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use globset::{GlobBuilder, GlobMatcher};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use regex::RegexBuilder;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

use crate::builtin_tools::{
    list_project_directory_anchored, project_path_metadata_anchored,
    read_project_file_anchored_bytes, write_project_file_anchored_bytes, ProjectFileMutationError,
    ProjectPathMetadata, WorkspaceRoots,
};
use crate::git::{resolve_registered_workspace_process_cwd_exact, RegisteredWorkspaceProcessClaim};
use crate::task_workspace_binding::{AuthorizedWorkspaceRoot, TaskWorkspaceBinding};

pub(super) const VIRTUAL_WORKSPACE_ROOT: &str = "/__offisim_workspace__";
const MAX_DIRECTORY_ENTRIES: usize = 10_000;
const MAX_TRAVERSED_ENTRIES: usize = 100_000;
const MAX_FIND_RESULTS: usize = 10_000;
const MAX_GREP_MATCHES: usize = 2_000;
const MAX_GREP_CONTEXT_LINES: usize = 20;
const GREP_MAX_LINE_CHARS: usize = 500;

#[derive(Debug)]
pub(super) struct WorkspaceFileBridgeError {
    pub(super) code: &'static str,
    pub(super) message: String,
}

impl WorkspaceFileBridgeError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "workspace-invalid-request",
            message: message.into(),
        }
    }

    fn out_of_bounds() -> Self {
        Self {
            code: "workspace-out-of-bounds",
            message: "The requested path is outside this task workspace.".into(),
        }
    }

    fn authority_lost() -> Self {
        Self {
            code: "workspace-authority-lost",
            message: "The task workspace is no longer the folder that was originally bound.".into(),
        }
    }

    fn conflict() -> Self {
        Self {
            code: "workspace-file-conflict",
            message: "The file changed after it was read; read it again before editing.".into(),
        }
    }

    fn cancelled() -> Self {
        Self {
            code: "workspace-operation-cancelled",
            message: "The workspace operation was cancelled.".into(),
        }
    }

    fn file(message: impl Into<String>) -> Self {
        Self {
            code: "workspace-file-error",
            message: message.into(),
        }
    }
}

pub(super) fn is_workspace_file_operation(op: &str) -> bool {
    matches!(
        op,
        "fileRead" | "fileWrite" | "fileStat" | "fileList" | "fileFind" | "fileGrep"
    )
}

struct WorkspaceFileScope {
    authority: AuthorizedWorkspaceRoot,
    roots: WorkspaceRoots,
}

impl WorkspaceFileScope {
    fn new(authority: AuthorizedWorkspaceRoot) -> Result<Self, WorkspaceFileBridgeError> {
        authority
            .verify_live()
            .map_err(|_| WorkspaceFileBridgeError::authority_lost())?;
        Ok(Self {
            roots: WorkspaceRoots::new(vec![authority.clone()]),
            authority,
        })
    }

    fn target(&self, raw: &str, file_only: bool) -> Result<PathBuf, WorkspaceFileBridgeError> {
        let relative = virtual_relative_path(raw)?;
        if file_only && relative.as_os_str().is_empty() {
            return Err(WorkspaceFileBridgeError::invalid(
                "A workspace file path is required.",
            ));
        }
        Ok(self.authority.path().join(relative))
    }

    fn verify(&self) -> Result<(), WorkspaceFileBridgeError> {
        self.authority
            .verify_live()
            .map_err(|_| WorkspaceFileBridgeError::authority_lost())
    }

    fn virtual_path(&self, target: &Path) -> Result<String, WorkspaceFileBridgeError> {
        let relative = target
            .strip_prefix(self.authority.path())
            .map_err(|_| WorkspaceFileBridgeError::out_of_bounds())?;
        if relative.as_os_str().is_empty() {
            return Ok(VIRTUAL_WORKSPACE_ROOT.into());
        }
        Ok(format!(
            "{VIRTUAL_WORKSPACE_ROOT}/{}",
            relative.to_string_lossy().replace('\\', "/")
        ))
    }
}

fn virtual_relative_path(raw: &str) -> Result<PathBuf, WorkspaceFileBridgeError> {
    if raw.is_empty() {
        return Err(WorkspaceFileBridgeError::invalid(
            "A virtual workspace path is required.",
        ));
    }
    let path = Path::new(raw);
    let relative = path
        .strip_prefix(Path::new(VIRTUAL_WORKSPACE_ROOT))
        .map_err(|_| WorkspaceFileBridgeError::out_of_bounds())?;
    let mut safe = PathBuf::new();
    for component in relative.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(segment) => safe.push(segment),
            _ => return Err(WorkspaceFileBridgeError::out_of_bounds()),
        }
    }
    Ok(safe)
}

fn string_arg<'a>(args: &'a Value, name: &str) -> Result<&'a str, WorkspaceFileBridgeError> {
    args.get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            WorkspaceFileBridgeError::invalid(format!(
                "Workspace operation requires string arg '{name}'."
            ))
        })
}

fn optional_string_arg<'a>(args: &'a Value, name: &str) -> Option<&'a str> {
    args.get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}

fn has_isolated_claim(args: &Value) -> bool {
    [
        "leaseId",
        "registeredRunId",
        "workspaceRoot",
        "cwd",
        "branch",
    ]
    .iter()
    .any(|field| args.get(field).is_some())
}

fn isolated_claim(
    args: &Value,
) -> Result<RegisteredWorkspaceProcessClaim, WorkspaceFileBridgeError> {
    Ok(RegisteredWorkspaceProcessClaim {
        lease_id: string_arg(args, "leaseId")?.to_string(),
        registered_run_id: string_arg(args, "registeredRunId")?.to_string(),
        workspace_root: PathBuf::from(string_arg(args, "workspaceRoot")?),
        cwd: PathBuf::from(string_arg(args, "cwd")?),
        branch: string_arg(args, "branch")?.to_string(),
    })
}

async fn resolve_scope<R: tauri::Runtime>(
    app: &AppHandle<R>,
    binding: &TaskWorkspaceBinding,
    args: &Value,
) -> Result<WorkspaceFileScope, WorkspaceFileBridgeError> {
    if has_isolated_claim(args) {
        let claim = isolated_claim(args)?;
        let execution = resolve_registered_workspace_process_cwd_exact(app, binding, &claim)
            .await
            .map_err(|_| WorkspaceFileBridgeError::authority_lost())?;
        let authority = execution
            .authorized_cwd_root()
            .map_err(|_| WorkspaceFileBridgeError::authority_lost())?;
        WorkspaceFileScope::new(authority)
    } else {
        binding
            .verify_live_root()
            .map_err(|_| WorkspaceFileBridgeError::authority_lost())?;
        WorkspaceFileScope::new(binding.authorized_root())
    }
}

fn classify_file_error(error: String) -> WorkspaceFileBridgeError {
    if error.contains("identity changed")
        || error.contains("folder identity")
        || error.contains("bound project workspace")
    {
        WorkspaceFileBridgeError::authority_lost()
    } else {
        WorkspaceFileBridgeError::file(error)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileStatResult {
    exists: bool,
    is_file: bool,
    is_directory: bool,
    is_symlink: bool,
    size: Option<u64>,
}

impl FileStatResult {
    fn missing() -> Self {
        Self {
            exists: false,
            is_file: false,
            is_directory: false,
            is_symlink: false,
            size: None,
        }
    }

    fn from_metadata(metadata: ProjectPathMetadata) -> Self {
        Self {
            exists: true,
            is_file: metadata.is_file,
            is_directory: metadata.is_directory,
            is_symlink: metadata.is_symlink,
            size: metadata.size,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GrepMatch {
    path: String,
    line_number: usize,
    line: String,
    context_before: Vec<String>,
    context_after: Vec<String>,
}

fn truncate_grep_line(line: &str) -> (String, bool) {
    let mut chars = line.chars();
    let text = chars.by_ref().take(GREP_MAX_LINE_CHARS).collect::<String>();
    if chars.next().is_some() {
        (format!("{text}…"), true)
    } else {
        (text, false)
    }
}

struct WorkspaceGlob {
    matcher: GlobMatcher,
    basename_only: bool,
    negated: bool,
}

impl WorkspaceGlob {
    fn matches(&self, relative: &Path) -> bool {
        let candidate = if self.basename_only {
            relative.file_name().map(Path::new).unwrap_or(relative)
        } else {
            relative
        };
        let matched = self.matcher.is_match(candidate);
        if self.negated {
            !matched
        } else {
            matched
        }
    }
}

fn compile_workspace_glob(
    pattern: &str,
    allow_negation: bool,
) -> Result<WorkspaceGlob, WorkspaceFileBridgeError> {
    if pattern.is_empty() {
        return Err(WorkspaceFileBridgeError::invalid(
            "A non-empty glob pattern is required.",
        ));
    }
    let (negated, glob_pattern) = if allow_negation {
        pattern
            .strip_prefix('!')
            .map(|pattern| (true, pattern))
            .unwrap_or((false, pattern))
    } else {
        (false, pattern)
    };
    if glob_pattern.is_empty() {
        return Err(WorkspaceFileBridgeError::invalid(
            "A negated glob must include a pattern after '!'.",
        ));
    }
    let normalized = glob_pattern.replace('\\', "/");
    let basename_only = !normalized.contains('/');
    let matcher = GlobBuilder::new(&normalized)
        .literal_separator(true)
        .backslash_escape(true)
        .build()
        .map_err(|_| WorkspaceFileBridgeError::invalid("The glob pattern is invalid."))?
        .compile_matcher();
    Ok(WorkspaceGlob {
        matcher,
        basename_only,
        negated,
    })
}

fn should_skip_directory(name: &str) -> bool {
    matches!(name, ".git" | ".offisim" | "node_modules")
}

fn load_directory_gitignore(
    scope: &WorkspaceFileScope,
    directory: &Path,
) -> Result<Option<Arc<Gitignore>>, WorkspaceFileBridgeError> {
    let ignore_path = directory.join(".gitignore");
    let Some(metadata) =
        project_path_metadata_anchored(&ignore_path, &scope.roots).map_err(classify_file_error)?
    else {
        return Ok(None);
    };
    if !metadata.is_file || metadata.is_symlink {
        return Ok(None);
    }
    let read = read_project_file_anchored_bytes(&ignore_path, &scope.roots)
        .map_err(classify_file_error)?;
    let text = String::from_utf8(read.bytes)
        .map_err(|_| WorkspaceFileBridgeError::file("Workspace .gitignore is not valid UTF-8."))?;
    let mut builder = GitignoreBuilder::new(directory);
    for line in text.lines() {
        builder
            .add_line(Some(ignore_path.clone()), line)
            .map_err(|_| WorkspaceFileBridgeError::file("Workspace .gitignore is invalid."))?;
    }
    builder
        .build()
        .map(Arc::new)
        .map(Some)
        .map_err(|_| WorkspaceFileBridgeError::file("Workspace .gitignore is invalid."))
}

fn is_gitignored(path: &Path, is_directory: bool, rules: &[Arc<Gitignore>]) -> bool {
    let mut ignored = false;
    for rule in rules {
        // Directories are filtered before they are queued, so parent matches do
        // not need to be replayed for every descendant. This also preserves
        // Pi/fd semantics where an explicitly requested ignored directory is a
        // valid search root while inherited file rules still apply inside it.
        let matched = rule.matched(path, is_directory);
        if matched.is_ignore() {
            ignored = true;
        } else if matched.is_whitelist() {
            ignored = false;
        }
    }
    ignored
}

fn require_not_cancelled(cancellation: &CancellationToken) -> Result<(), WorkspaceFileBridgeError> {
    if cancellation.is_cancelled() {
        Err(WorkspaceFileBridgeError::cancelled())
    } else {
        Ok(())
    }
}

struct PendingDirectory {
    path: PathBuf,
    gitignore_rules: Vec<Arc<Gitignore>>,
}

fn inherited_gitignore_rules(
    scope: &WorkspaceFileScope,
    start: &Path,
) -> Result<Vec<Arc<Gitignore>>, WorkspaceFileBridgeError> {
    let relative = start
        .strip_prefix(scope.authority.path())
        .map_err(|_| WorkspaceFileBridgeError::out_of_bounds())?;
    let mut current = scope.authority.path().to_path_buf();
    let mut rules = Vec::new();
    for component in relative.components() {
        if let Some(rule) = load_directory_gitignore(scope, &current)? {
            rules.push(rule);
        }
        let Component::Normal(segment) = component else {
            return Err(WorkspaceFileBridgeError::out_of_bounds());
        };
        current.push(segment);
    }
    Ok(rules)
}

fn walk_workspace(
    scope: &WorkspaceFileScope,
    start: &Path,
    max_entries: usize,
    max_directory_entries: usize,
    cancellation: &CancellationToken,
) -> Result<(Vec<(PathBuf, ProjectPathMetadata)>, bool), WorkspaceFileBridgeError> {
    require_not_cancelled(cancellation)?;
    scope.verify()?;
    let Some(start_metadata) =
        project_path_metadata_anchored(start, &scope.roots).map_err(classify_file_error)?
    else {
        return Err(WorkspaceFileBridgeError::file(
            "Workspace path was not found.",
        ));
    };
    if !start_metadata.is_directory {
        return Ok((vec![(start.to_path_buf(), start_metadata)], false));
    }

    let mut output = Vec::new();
    let mut directories = vec![PendingDirectory {
        path: start.to_path_buf(),
        gitignore_rules: inherited_gitignore_rules(scope, start)?,
    }];
    let mut limit_reached = false;
    while let Some(directory) = directories.pop() {
        require_not_cancelled(cancellation)?;
        let mut gitignore_rules = directory.gitignore_rules;
        if let Some(rule) = load_directory_gitignore(scope, &directory.path)? {
            gitignore_rules.push(rule);
        }
        let entries = list_project_directory_anchored(
            &directory.path,
            &scope.roots,
            max_directory_entries.saturating_add(1),
        )
        .map_err(classify_file_error)?;
        let directory_limited = entries.len() > max_directory_entries;
        limit_reached |= directory_limited;
        for entry in entries.into_iter().take(max_directory_entries) {
            require_not_cancelled(cancellation)?;
            if entry.is_directory && should_skip_directory(&entry.name) {
                continue;
            }
            if output.len() >= max_entries {
                limit_reached = true;
                break;
            }
            let target = scope.authority.path().join(&entry.path);
            let metadata = ProjectPathMetadata {
                is_file: entry.is_file,
                is_directory: entry.is_directory,
                is_symlink: entry.is_symlink,
                size: entry.size,
            };
            if is_gitignored(&target, metadata.is_directory, &gitignore_rules) {
                continue;
            }
            if metadata.is_directory {
                directories.push(PendingDirectory {
                    path: target.clone(),
                    gitignore_rules: gitignore_rules.clone(),
                });
            }
            output.push((target, metadata));
        }
        if limit_reached {
            break;
        }
    }
    scope.verify()?;
    Ok((output, limit_reached))
}

fn run_file_read(
    scope: &WorkspaceFileScope,
    args: &Value,
) -> Result<Value, WorkspaceFileBridgeError> {
    let target = scope.target(string_arg(args, "path")?, true)?;
    let read =
        read_project_file_anchored_bytes(&target, &scope.roots).map_err(classify_file_error)?;
    scope.verify()?;
    Ok(json!({
        "contentBase64": BASE64_STANDARD.encode(read.bytes),
        "mimeType": read.mime_type,
        "version": read.version,
    }))
}

fn run_file_write(
    scope: &WorkspaceFileScope,
    args: &Value,
    cancellation: &CancellationToken,
) -> Result<Value, WorkspaceFileBridgeError> {
    let target = scope.target(string_arg(args, "path")?, true)?;
    let content = args.get("content").and_then(Value::as_str).ok_or_else(|| {
        WorkspaceFileBridgeError::invalid("Workspace fileWrite requires string arg 'content'.")
    })?;
    let expected_version = optional_string_arg(args, "expectedVersion");
    match write_project_file_anchored_bytes(
        &target,
        &scope.roots,
        content.as_bytes(),
        expected_version,
        Some(cancellation),
    ) {
        Ok(()) => {}
        Err(ProjectFileMutationError::Conflict) => return Err(WorkspaceFileBridgeError::conflict()),
        Err(ProjectFileMutationError::Cancelled) => {
            return Err(WorkspaceFileBridgeError::cancelled())
        }
        Err(ProjectFileMutationError::File(error)) => return Err(classify_file_error(error)),
    }
    scope.verify()?;
    Ok(json!({ "bytes": content.len() }))
}

fn run_file_stat(
    scope: &WorkspaceFileScope,
    args: &Value,
) -> Result<Value, WorkspaceFileBridgeError> {
    let target = scope.target(string_arg(args, "path")?, false)?;
    let result = project_path_metadata_anchored(&target, &scope.roots)
        .map_err(classify_file_error)?
        .map(FileStatResult::from_metadata)
        .unwrap_or_else(FileStatResult::missing);
    serde_json::to_value(result)
        .map_err(|_| WorkspaceFileBridgeError::file("Serialize workspace file metadata failed."))
}

fn run_file_list(
    scope: &WorkspaceFileScope,
    args: &Value,
) -> Result<Value, WorkspaceFileBridgeError> {
    let target = scope.target(string_arg(args, "path")?, false)?;
    let limit = args
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(500)
        .clamp(1, MAX_DIRECTORY_ENTRIES as u64) as usize;
    let entries = list_project_directory_anchored(&target, &scope.roots, limit.saturating_add(1))
        .map_err(classify_file_error)?;
    let limit_reached = entries.len() > limit;
    let entries = entries.into_iter().take(limit).collect::<Vec<_>>();
    Ok(json!({
        "entries": entries,
        "appliedLimit": limit,
        "entryLimitReached": limit_reached,
        "limitReached": limit_reached,
    }))
}

fn run_file_find(
    scope: &WorkspaceFileScope,
    args: &Value,
    cancellation: &CancellationToken,
) -> Result<Value, WorkspaceFileBridgeError> {
    let target = scope.target(string_arg(args, "path")?, false)?;
    let pattern = string_arg(args, "pattern")?;
    let glob = compile_workspace_glob(pattern, false)?;
    let limit = args
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(1_000)
        .clamp(1, MAX_FIND_RESULTS as u64) as usize;
    let (entries, traversal_limited) = walk_workspace(
        scope,
        &target,
        MAX_TRAVERSED_ENTRIES,
        MAX_DIRECTORY_ENTRIES,
        cancellation,
    )?;
    let mut paths = Vec::new();
    let mut result_limit_reached = false;
    for (path, _) in entries {
        let relative = if path == target {
            path.file_name().map(PathBuf::from).unwrap_or_default()
        } else {
            path.strip_prefix(&target)
                .map_err(|_| WorkspaceFileBridgeError::out_of_bounds())?
                .to_path_buf()
        };
        if relative.as_os_str().is_empty() || !glob.matches(&relative) {
            continue;
        }
        if paths.len() >= limit {
            result_limit_reached = true;
            break;
        }
        paths.push(scope.virtual_path(&path)?);
    }
    Ok(json!({
        "paths": paths,
        "appliedLimit": limit,
        "resultLimitReached": result_limit_reached,
        "traversalLimitReached": traversal_limited,
        "limitReached": traversal_limited || result_limit_reached,
    }))
}

fn run_file_grep(
    scope: &WorkspaceFileScope,
    args: &Value,
    cancellation: &CancellationToken,
) -> Result<Value, WorkspaceFileBridgeError> {
    run_file_grep_with_limits(
        scope,
        args,
        cancellation,
        MAX_TRAVERSED_ENTRIES,
        MAX_DIRECTORY_ENTRIES,
    )
}

fn run_file_grep_with_limits(
    scope: &WorkspaceFileScope,
    args: &Value,
    cancellation: &CancellationToken,
    max_traversed_entries: usize,
    max_directory_entries: usize,
) -> Result<Value, WorkspaceFileBridgeError> {
    let target = scope.target(string_arg(args, "path")?, false)?;
    let pattern = string_arg(args, "pattern")?;
    let literal = args
        .get("literal")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let ignore_case = args
        .get("ignoreCase")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let regex_pattern = if literal {
        regex::escape(pattern)
    } else {
        pattern.to_string()
    };
    let matcher = RegexBuilder::new(&regex_pattern)
        .case_insensitive(ignore_case)
        .build()
        .map_err(|_| WorkspaceFileBridgeError::invalid("The search pattern is invalid."))?;
    let glob = optional_string_arg(args, "glob")
        .map(|pattern| compile_workspace_glob(pattern, true))
        .transpose()?;
    let context = args
        .get("context")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        .clamp(0, MAX_GREP_CONTEXT_LINES as u64) as usize;
    let limit = args
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(100)
        .clamp(1, MAX_GREP_MATCHES as u64) as usize;
    let (entries, traversal_limited) = walk_workspace(
        scope,
        &target,
        max_traversed_entries,
        max_directory_entries,
        cancellation,
    )?;
    let mut matches = Vec::new();
    let mut match_limit_reached = false;
    let mut lines_truncated = false;
    for (path, metadata) in entries {
        require_not_cancelled(cancellation)?;
        if !metadata.is_file {
            continue;
        }
        let relative = if target == path {
            path.file_name().map(PathBuf::from).unwrap_or_default()
        } else {
            path.strip_prefix(&target)
                .map_err(|_| WorkspaceFileBridgeError::out_of_bounds())?
                .to_path_buf()
        };
        if let Some(glob) = &glob {
            if !glob.matches(&relative) {
                continue;
            }
        }
        let read = match read_project_file_anchored_bytes(&path, &scope.roots) {
            Ok(read) => read,
            Err(error) => {
                let classified = classify_file_error(error);
                if classified.code == "workspace-authority-lost" {
                    return Err(classified);
                }
                continue;
            }
        };
        let Ok(text) = String::from_utf8(read.bytes) else {
            continue;
        };
        let lines = text
            .replace("\r\n", "\n")
            .replace('\r', "\n")
            .split('\n')
            .map(str::to_string)
            .collect::<Vec<_>>();
        for (index, line) in lines.iter().enumerate() {
            if index % 256 == 0 {
                require_not_cancelled(cancellation)?;
            }
            if !matcher.is_match(line) {
                continue;
            }
            if matches.len() >= limit {
                match_limit_reached = true;
                break;
            }
            let (line, truncated) = truncate_grep_line(line);
            lines_truncated |= truncated;
            let before_start = index.saturating_sub(context);
            let context_before = lines[before_start..index]
                .iter()
                .map(|line| {
                    let (line, truncated) = truncate_grep_line(line);
                    lines_truncated |= truncated;
                    line
                })
                .collect::<Vec<_>>();
            let after_end = (index + 1 + context).min(lines.len());
            let context_after = lines[index + 1..after_end]
                .iter()
                .map(|line| {
                    let (line, truncated) = truncate_grep_line(line);
                    lines_truncated |= truncated;
                    line
                })
                .collect::<Vec<_>>();
            matches.push(GrepMatch {
                path: scope.virtual_path(&path)?,
                line_number: index + 1,
                line,
                context_before,
                context_after,
            });
        }
        if match_limit_reached {
            break;
        }
    }
    Ok(json!({
        "matches": matches,
        "appliedLimit": limit,
        "matchLimitReached": match_limit_reached,
        "traversalLimitReached": traversal_limited,
        "limitReached": traversal_limited || match_limit_reached,
        "linesTruncated": lines_truncated,
    }))
}

fn run_sync(
    scope: WorkspaceFileScope,
    op: String,
    args: Value,
    cancellation: CancellationToken,
) -> Result<Value, WorkspaceFileBridgeError> {
    require_not_cancelled(&cancellation)?;
    scope.verify()?;
    let result = match op.as_str() {
        "fileRead" => run_file_read(&scope, &args),
        "fileWrite" => run_file_write(&scope, &args, &cancellation),
        "fileStat" => run_file_stat(&scope, &args),
        "fileList" => run_file_list(&scope, &args),
        "fileFind" => run_file_find(&scope, &args, &cancellation),
        "fileGrep" => run_file_grep(&scope, &args, &cancellation),
        _ => Err(WorkspaceFileBridgeError::invalid(
            "Unknown workspace file operation.",
        )),
    }?;
    require_not_cancelled(&cancellation)?;
    scope.verify()?;
    Ok(result)
}

pub(super) async fn run_workspace_file_operation<R: tauri::Runtime>(
    app: &AppHandle<R>,
    binding: &TaskWorkspaceBinding,
    op: &str,
    args: Value,
    cancellation: Option<&CancellationToken>,
) -> Result<Value, WorkspaceFileBridgeError> {
    let scope = resolve_scope(app, binding, &args).await?;
    let op = op.to_string();
    let cancellation = cancellation.cloned().unwrap_or_default();
    tokio::task::spawn_blocking(move || run_sync(scope, op, args, cancellation))
        .await
        .map_err(|_| WorkspaceFileBridgeError::file("Workspace file worker failed."))?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestWorkspace {
        parent: PathBuf,
        root: PathBuf,
    }

    impl TestWorkspace {
        fn new(label: &str) -> Self {
            let parent = std::env::temp_dir().join(format!(
                "offisim-workspace-files-{label}-{}-{:016x}",
                std::process::id(),
                rand::random::<u64>()
            ));
            let root = parent.join("project");
            std::fs::create_dir_all(&root).expect("create test workspace");
            Self { parent, root }
        }

        fn authority(&self) -> AuthorizedWorkspaceRoot {
            AuthorizedWorkspaceRoot::from_live_path(
                self.root
                    .canonicalize()
                    .expect("canonicalize test workspace"),
            )
            .expect("capture workspace authority")
        }
    }

    impl Drop for TestWorkspace {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.parent);
        }
    }

    #[test]
    fn virtual_paths_accept_only_the_fixed_workspace_namespace() {
        assert_eq!(
            virtual_relative_path(VIRTUAL_WORKSPACE_ROOT).expect("virtual root"),
            PathBuf::new()
        );
        assert_eq!(
            virtual_relative_path(&format!("{VIRTUAL_WORKSPACE_ROOT}/src/main.rs"))
                .expect("nested virtual path"),
            PathBuf::from("src/main.rs")
        );
        for invalid in [
            "/tmp/outside",
            "/__offisim_workspace_evil/file",
            "/__offisim_workspace__/../outside",
        ] {
            assert_eq!(
                virtual_relative_path(invalid)
                    .expect_err("must reject")
                    .code,
                "workspace-out-of-bounds"
            );
        }
    }

    #[test]
    fn workspace_globs_cover_native_braces_classes_and_negation() {
        let rust = compile_workspace_glob("*.rs", false).expect("compile basename glob");
        assert!(rust.matches(Path::new("src/main.rs")));
        assert!(!rust.matches(Path::new("src/main.ts")));

        let nested =
            compile_workspace_glob("src/**/*.test.ts", false).expect("compile recursive glob");
        assert!(nested.matches(Path::new("src/unit/example.test.ts")));
        assert!(nested.matches(Path::new("src/example.test.ts")));

        let braces =
            compile_workspace_glob("**/*.{ts,tsx}", false).expect("compile brace alternatives");
        assert!(braces.matches(Path::new("src/app.ts")));
        assert!(braces.matches(Path::new("src/app.tsx")));
        assert!(!braces.matches(Path::new("src/app.js")));

        let class = compile_workspace_glob("src/[jt]s/**", false).expect("compile character class");
        assert!(class.matches(Path::new("src/js/app.js")));
        assert!(class.matches(Path::new("src/ts/app.ts")));
        assert!(!class.matches(Path::new("src/rs/app.rs")));

        let exclude_generated =
            compile_workspace_glob("!**/*.generated.ts", true).expect("compile grep exclusion");
        assert!(exclude_generated.matches(Path::new("src/app.ts")));
        assert!(!exclude_generated.matches(Path::new("src/app.generated.ts")));
    }

    #[test]
    fn descriptor_bound_file_read_write_search_and_compare_and_swap_are_functional() {
        let fixture = TestWorkspace::new("functional");
        std::fs::create_dir_all(fixture.root.join("src")).expect("create src");
        std::fs::write(fixture.root.join("src/main.rs"), "alpha\nbeta\n")
            .expect("write source fixture");
        std::fs::write(
            fixture.root.join(".gitignore"),
            "*.ignored\nignored-dir/\nexplicit-src/\n!keep.ignored\n",
        )
        .expect("write root ignore rules");
        std::fs::write(fixture.root.join("ignored.ignored"), "hidden needle\n")
            .expect("write ignored file");
        std::fs::write(fixture.root.join("keep.ignored"), "visible needle\n")
            .expect("write re-included file");
        std::fs::create_dir_all(fixture.root.join("ignored-dir"))
            .expect("create ignored directory");
        std::fs::write(
            fixture.root.join("ignored-dir/secret.rs"),
            "hidden needle\n",
        )
        .expect("write ignored directory file");
        std::fs::write(fixture.root.join("src/.gitignore"), "generated.rs\n")
            .expect("write nested ignore rules");
        std::fs::write(fixture.root.join("src/generated.rs"), "hidden needle\n")
            .expect("write nested ignored file");
        std::fs::write(
            fixture.root.join("src/root-rule.ignored"),
            "hidden nested-marker\n",
        )
        .expect("write ancestor-ignored file");
        std::fs::write(
            fixture.root.join("src/visible.txt"),
            "visible nested-marker\n",
        )
        .expect("write visible nested file");
        std::fs::write(
            fixture.root.join("src/context.txt"),
            format!("{}\ncontext-target\n", "x".repeat(GREP_MAX_LINE_CHARS + 1)),
        )
        .expect("write long grep context fixture");
        std::fs::create_dir_all(fixture.root.join("src/js")).expect("create glob fixture");
        std::fs::write(fixture.root.join("src/js/app.ts"), "glob-token\n")
            .expect("write TypeScript glob fixture");
        std::fs::write(fixture.root.join("src/js/app.tsx"), "glob-token\n")
            .expect("write TSX glob fixture");
        std::fs::write(fixture.root.join("src/js/app.generated.ts"), "glob-token\n")
            .expect("write generated glob fixture");
        std::fs::create_dir_all(fixture.root.join("explicit-src"))
            .expect("create explicitly searched ignored directory");
        std::fs::write(
            fixture.root.join("explicit-src/visible.rs"),
            "explicit needle\n",
        )
        .expect("write explicit-root file");
        let scope = WorkspaceFileScope::new(fixture.authority()).expect("bind scope");
        let cancellation = CancellationToken::new();

        let read = run_file_read(
            &scope,
            &json!({ "path": format!("{VIRTUAL_WORKSPACE_ROOT}/src/main.rs") }),
        )
        .expect("read through workspace bridge");
        let version = read["version"].as_str().expect("read version").to_string();
        assert_eq!(
            BASE64_STANDARD
                .decode(read["contentBase64"].as_str().expect("base64 content"))
                .expect("decode content"),
            b"alpha\nbeta\n"
        );

        let find = run_file_find(
            &scope,
            &json!({
                "path": VIRTUAL_WORKSPACE_ROOT,
                "pattern": "**/*.rs",
                "limit": 100,
            }),
            &cancellation,
        )
        .expect("find through workspace bridge");
        assert_eq!(find["paths"].as_array().expect("find paths").len(), 1);

        let brace_find = run_file_find(
            &scope,
            &json!({
                "path": VIRTUAL_WORKSPACE_ROOT,
                "pattern": "**/*.{ts,tsx}",
                "limit": 100,
            }),
            &cancellation,
        )
        .expect("find brace alternatives through workspace bridge");
        assert_eq!(
            brace_find["paths"]
                .as_array()
                .expect("brace find paths")
                .len(),
            3
        );

        let class_find = run_file_find(
            &scope,
            &json!({
                "path": VIRTUAL_WORKSPACE_ROOT,
                "pattern": "src/[jt]s/**",
                "limit": 100,
            }),
            &cancellation,
        )
        .expect("find character class through workspace bridge");
        assert_eq!(
            class_find["paths"]
                .as_array()
                .expect("class find paths")
                .len(),
            3,
            "the three files below the matching directory are returned"
        );

        let ignored_find = run_file_find(
            &scope,
            &json!({
                "path": VIRTUAL_WORKSPACE_ROOT,
                "pattern": "*.ignored",
                "limit": 100,
            }),
            &cancellation,
        )
        .expect("find respects hierarchical gitignore rules");
        assert_eq!(
            ignored_find["paths"].as_array().expect("visible paths"),
            &vec![Value::String(format!(
                "{VIRTUAL_WORKSPACE_ROOT}/keep.ignored"
            ))]
        );

        let single_file_find = run_file_find(
            &scope,
            &json!({
                "path": format!("{VIRTUAL_WORKSPACE_ROOT}/src/main.rs"),
                "pattern": "*.rs",
                "limit": 100,
            }),
            &cancellation,
        )
        .expect("find an explicitly targeted file");
        assert_eq!(
            single_file_find["paths"].as_array().expect("single path"),
            &vec![Value::String(format!(
                "{VIRTUAL_WORKSPACE_ROOT}/src/main.rs"
            ))]
        );

        run_file_write(
            &scope,
            &json!({
                "path": format!("{VIRTUAL_WORKSPACE_ROOT}/src/empty.txt"),
                "content": "",
            }),
            &cancellation,
        )
        .expect("write an empty file");
        assert_eq!(
            std::fs::read(fixture.root.join("src/empty.txt")).expect("read empty file"),
            Vec::<u8>::new()
        );

        let spaced_name = " spaced.txt ";
        std::fs::write(fixture.root.join("src").join(spaced_name), "space-safe")
            .expect("write spaced filename");
        let spaced_read = run_file_read(
            &scope,
            &json!({
                "path": format!("{VIRTUAL_WORKSPACE_ROOT}/src/{spaced_name}"),
            }),
        )
        .expect("preserve valid leading and trailing path whitespace");
        assert_eq!(
            BASE64_STANDARD
                .decode(
                    spaced_read["contentBase64"]
                        .as_str()
                        .expect("spaced file content")
                )
                .expect("decode spaced file"),
            b"space-safe"
        );

        let grep = run_file_grep(
            &scope,
            &json!({
                "path": VIRTUAL_WORKSPACE_ROOT,
                "pattern": "beta",
                "limit": 100,
            }),
            &cancellation,
        )
        .expect("grep through workspace bridge");
        assert_eq!(
            grep["matches"].as_array().expect("grep matches")[0]["lineNumber"],
            2
        );
        assert_eq!(grep["appliedLimit"], 100);
        assert_eq!(grep["matchLimitReached"], false);
        assert_eq!(grep["traversalLimitReached"], false);

        let included_grep = run_file_grep(
            &scope,
            &json!({
                "path": VIRTUAL_WORKSPACE_ROOT,
                "pattern": "glob-token",
                "glob": "**/*.{ts,tsx}",
                "limit": 100,
            }),
            &cancellation,
        )
        .expect("grep brace include through workspace bridge");
        assert_eq!(
            included_grep["matches"]
                .as_array()
                .expect("included grep matches")
                .len(),
            3
        );

        let excluded_grep = run_file_grep(
            &scope,
            &json!({
                "path": VIRTUAL_WORKSPACE_ROOT,
                "pattern": "glob-token",
                "glob": "!**/*.generated.ts",
                "limit": 100,
            }),
            &cancellation,
        )
        .expect("grep negated exclusion through workspace bridge");
        assert_eq!(
            excluded_grep["matches"]
                .as_array()
                .expect("excluded grep matches")
                .len(),
            2
        );

        let ignored_grep = run_file_grep(
            &scope,
            &json!({
                "path": VIRTUAL_WORKSPACE_ROOT,
                "pattern": "needle",
                "limit": 100,
            }),
            &cancellation,
        )
        .expect("grep respects hierarchical gitignore rules");
        let ignored_grep_matches = ignored_grep["matches"]
            .as_array()
            .expect("visible grep matches");
        assert_eq!(ignored_grep_matches.len(), 1);
        assert_eq!(
            ignored_grep_matches[0]["path"],
            format!("{VIRTUAL_WORKSPACE_ROOT}/keep.ignored")
        );

        let nested_grep = run_file_grep(
            &scope,
            &json!({
                "path": format!("{VIRTUAL_WORKSPACE_ROOT}/src"),
                "pattern": "nested-marker",
                "limit": 100,
            }),
            &cancellation,
        )
        .expect("nested grep inherits Project-root gitignore rules");
        let nested_paths = nested_grep["matches"]
            .as_array()
            .expect("nested grep matches")
            .iter()
            .map(|entry| entry["path"].as_str().expect("nested match path"))
            .collect::<Vec<_>>();
        assert_eq!(
            nested_paths,
            vec![format!("{VIRTUAL_WORKSPACE_ROOT}/src/visible.txt")]
        );

        let context_grep = run_file_grep(
            &scope,
            &json!({
                "path": format!("{VIRTUAL_WORKSPACE_ROOT}/src/context.txt"),
                "pattern": "context-target",
                "context": 1,
                "limit": 100,
            }),
            &cancellation,
        )
        .expect("grep reports context truncation");
        assert_eq!(context_grep["linesTruncated"], true);

        let explicit_find = run_file_find(
            &scope,
            &json!({
                "path": format!("{VIRTUAL_WORKSPACE_ROOT}/explicit-src"),
                "pattern": "*.rs",
                "limit": 100,
            }),
            &cancellation,
        )
        .expect("explicit ignored directory remains a valid find root");
        assert_eq!(
            explicit_find["paths"]
                .as_array()
                .expect("explicit paths")
                .len(),
            1
        );
        let explicit_grep = run_file_grep(
            &scope,
            &json!({
                "path": format!("{VIRTUAL_WORKSPACE_ROOT}/explicit-src"),
                "pattern": "explicit needle",
                "limit": 100,
            }),
            &cancellation,
        )
        .expect("explicit ignored directory remains a valid grep root");
        assert_eq!(
            explicit_grep["matches"]
                .as_array()
                .expect("explicit matches")
                .len(),
            1
        );

        std::fs::write(fixture.root.join("src/main.rs"), "concurrent\n")
            .expect("write concurrent edit");
        let conflict = run_file_write(
            &scope,
            &json!({
                "path": format!("{VIRTUAL_WORKSPACE_ROOT}/src/main.rs"),
                "content": "replacement\n",
                "expectedVersion": version,
            }),
            &cancellation,
        )
        .expect_err("stale edit must not overwrite a concurrent change");
        assert_eq!(conflict.code, "workspace-file-conflict");
        assert_eq!(
            std::fs::read_to_string(fixture.root.join("src/main.rs"))
                .expect("read concurrent content"),
            "concurrent\n"
        );
    }

    #[test]
    fn cancelled_workspace_operation_never_starts_a_mutation() {
        let fixture = TestWorkspace::new("cancelled");
        let scope = WorkspaceFileScope::new(fixture.authority()).expect("bind scope");
        let cancellation = CancellationToken::new();
        cancellation.cancel();

        let cancelled = run_sync(
            scope,
            "fileWrite".into(),
            json!({
                "path": format!("{VIRTUAL_WORKSPACE_ROOT}/cancelled.txt"),
                "content": "must-not-exist",
            }),
            cancellation,
        )
        .expect_err("pre-cancelled mutation must fail closed");
        assert_eq!(cancelled.code, "workspace-operation-cancelled");
        assert!(!fixture.root.join("cancelled.txt").exists());
    }

    #[test]
    fn directory_lookahead_reports_incomplete_traversal() {
        let fixture = TestWorkspace::new("directory-limit");
        for name in ["a.txt", "b.txt", "c.txt"] {
            std::fs::write(fixture.root.join(name), name).expect("seed directory entry");
        }
        let scope = WorkspaceFileScope::new(fixture.authority()).expect("bind scope");
        let cancellation = CancellationToken::new();

        let (entries, limited) = walk_workspace(
            &scope,
            scope.authority.path(),
            MAX_TRAVERSED_ENTRIES,
            2,
            &cancellation,
        )
        .expect("bounded directory traversal");
        assert_eq!(entries.len(), 2);
        assert!(limited);
    }

    #[test]
    fn grep_scans_all_collected_entries_when_traversal_is_incomplete() {
        let fixture = TestWorkspace::new("grep-directory-limit");
        std::fs::write(fixture.root.join("a.txt"), "no match\n").expect("seed first file");
        std::fs::write(fixture.root.join("b.txt"), "needle\n").expect("seed second file");
        std::fs::write(fixture.root.join("c.txt"), "not collected\n").expect("seed lookahead file");
        let scope = WorkspaceFileScope::new(fixture.authority()).expect("bind scope");
        let cancellation = CancellationToken::new();

        let result = run_file_grep_with_limits(
            &scope,
            &json!({
                "path": VIRTUAL_WORKSPACE_ROOT,
                "pattern": "needle",
                "limit": 100,
            }),
            &cancellation,
            MAX_TRAVERSED_ENTRIES,
            2,
        )
        .expect("grep all entries collected before the directory limit");

        assert_eq!(result["limitReached"], true);
        assert_eq!(result["appliedLimit"], 100);
        assert_eq!(result["matchLimitReached"], false);
        assert_eq!(result["traversalLimitReached"], true);
        assert_eq!(result["matches"].as_array().expect("grep matches").len(), 1);
        assert_eq!(
            result["matches"][0]["path"],
            format!("{VIRTUAL_WORKSPACE_ROOT}/b.txt")
        );
    }

    #[test]
    fn absolute_escape_and_same_path_root_replacement_fail_closed() {
        let fixture = TestWorkspace::new("identity");
        std::fs::write(fixture.root.join("safe.txt"), "ORIGINAL").expect("write original file");
        let authority = fixture.authority();
        let scope = WorkspaceFileScope::new(authority.clone()).expect("bind scope");

        let escape = run_file_read(&scope, &json!({ "path": "/tmp/outside.txt" }))
            .expect_err("absolute host path must be rejected");
        assert_eq!(escape.code, "workspace-out-of-bounds");

        let moved = fixture.parent.join("moved-project");
        std::fs::rename(&fixture.root, &moved).expect("move original root");
        std::fs::create_dir_all(&fixture.root).expect("create replacement root");
        std::fs::write(fixture.root.join("safe.txt"), "REPLACEMENT")
            .expect("write replacement sentinel");

        let lost = match WorkspaceFileScope::new(authority) {
            Ok(_) => panic!("same-path replacement must not regain workspace authority"),
            Err(error) => error,
        };
        assert_eq!(lost.code, "workspace-authority-lost");
        assert_eq!(
            std::fs::read_to_string(fixture.root.join("safe.txt"))
                .expect("read replacement sentinel"),
            "REPLACEMENT"
        );
        assert_eq!(
            std::fs::read_to_string(moved.join("safe.txt")).expect("read moved original"),
            "ORIGINAL"
        );
    }
}
