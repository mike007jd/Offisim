use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(test)]
use std::cell::RefCell;

static NEXT_OVERLAY_ID: AtomicU64 = AtomicU64::new(1);

#[cfg(test)]
thread_local! {
    static AFTER_OVERLAY_ROOT_OPENED_HOOK: RefCell<Option<Box<dyn FnOnce(&Path)>>> =
        RefCell::new(None);
    static AFTER_OVERLAY_SKILLS_ROOT_OPENED_HOOK: RefCell<Option<Box<dyn FnOnce(&Path)>>> =
        RefCell::new(None);
}

#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn set_after_overlay_root_opened_hook(hook: impl FnOnce(&Path) + 'static) {
    AFTER_OVERLAY_ROOT_OPENED_HOOK.with(|slot| {
        *slot.borrow_mut() = Some(Box::new(hook));
    });
}

#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn set_after_overlay_skills_root_opened_hook(hook: impl FnOnce(&Path) + 'static) {
    AFTER_OVERLAY_SKILLS_ROOT_OPENED_HOOK.with(|slot| {
        *slot.borrow_mut() = Some(Box::new(hook));
    });
}

#[cfg(test)]
fn run_after_overlay_root_opened_hook(root: &Path) {
    AFTER_OVERLAY_ROOT_OPENED_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook(root);
        }
    });
}

#[cfg(test)]
fn run_after_overlay_skills_root_opened_hook(root: &Path) {
    AFTER_OVERLAY_SKILLS_ROOT_OPENED_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook(root);
        }
    });
}

const PROJECT_SKILL_PREFIXES: &[&str] =
    &[".claude/skills/", ".agents/skills/", ".opencode/skills/"];

#[derive(Clone, Copy)]
pub(crate) enum EngineSkillOverlayKind {
    CodexHome,
    ClaudePlugin,
}

pub(crate) struct EngineSkillOverlay {
    root: PathBuf,
    load_path: PathBuf,
    project_experience_path: Option<PathBuf>,
    #[cfg(unix)]
    root_directory: fs::File,
}

pub(crate) struct ResolvedEngineSkill {
    skill_file_path: PathBuf,
    source_directory: fs::File,
    skill_file: fs::File,
}

impl EngineSkillOverlay {
    pub(crate) fn load_path(&self) -> &Path {
        &self.load_path
    }

    pub(crate) fn system_prompt_with_project_experience(
        &self,
        base: Option<&str>,
    ) -> Option<String> {
        let mut sections = base
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| vec![value.to_string()])
            .unwrap_or_default();
        if let Some(path) = &self.project_experience_path {
            sections.push(format!(
                "Read and follow the employee's read-only Offisim Project experience in {}. Treat it as project-specific working context, never as credentials or a user message.",
                path.display()
            ));
        }
        (!sections.is_empty()).then(|| sections.join("\n\n"))
    }
}

impl Drop for EngineSkillOverlay {
    fn drop(&mut self) {
        #[cfg(unix)]
        if opened_directory_matches_path(&self.root_directory, &self.root) {
            let _ = fs::remove_dir_all(&self.root);
        }
        #[cfg(not(unix))]
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn validate_skill_suffix(path: &Path) -> bool {
    path.file_name().and_then(|name| name.to_str()) == Some("SKILL.md")
}

fn canonical_vault_skill_paths(paths: Option<&[String]>) -> Result<Vec<PathBuf>, String> {
    let Some(paths) = paths else {
        return Ok(Vec::new());
    };
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let vault_root = crate::local_paths::offisim_storage_dir("vault")
        .and_then(|path| path.canonicalize().map_err(|error| error.to_string()))?;
    paths
        .iter()
        .map(|raw| {
            let requested = Path::new(raw.trim());
            if !requested.is_absolute() || !validate_skill_suffix(requested) {
                return Err("Employee skill path is not a valid vault SKILL.md path.".into());
            }
            let canonical = requested
                .canonicalize()
                .map_err(|_| "Employee SKILL.md is unavailable.".to_string())?;
            if !canonical.starts_with(&vault_root) || !canonical.is_file() {
                return Err("Employee SKILL.md is outside the Offisim vault.".into());
            }
            Ok(canonical)
        })
        .collect()
}

pub(crate) fn resolve_project_skill_paths(
    workspace_root: &Path,
    paths: Option<&[String]>,
) -> Result<Vec<PathBuf>, String> {
    let Some(paths) = paths else {
        return Ok(Vec::new());
    };
    let canonical_root = workspace_root
        .canonicalize()
        .map_err(|_| "Project workspace is unavailable while resolving skills.".to_string())?;
    paths
        .iter()
        .map(|raw| {
            let value = raw.trim();
            let relative = Path::new(value);
            let safe_components = !relative.is_absolute()
                && relative
                    .components()
                    .all(|component| matches!(component, Component::Normal(_)));
            if !safe_components
                || !value.ends_with("/SKILL.md")
                || !PROJECT_SKILL_PREFIXES
                    .iter()
                    .any(|prefix| value.starts_with(prefix))
            {
                return Err("Project skill path is not a supported relative SKILL.md path.".into());
            }
            let canonical = canonical_root
                .join(relative)
                .canonicalize()
                .map_err(|_| "Project SKILL.md is unavailable.".to_string())?;
            if !canonical.starts_with(&canonical_root)
                || !canonical.is_file()
                || !validate_skill_suffix(&canonical)
            {
                return Err("Project SKILL.md escaped the bound Project workspace.".into());
            }
            Ok(canonical)
        })
        .collect()
}

pub(crate) fn resolve_engine_skill_paths(
    workspace_root: &Path,
    vault_paths: Option<&[String]>,
    project_paths: Option<&[String]>,
) -> Result<Vec<ResolvedEngineSkill>, String> {
    let mut unique = HashSet::new();
    let mut resolved = Vec::new();
    for path in canonical_vault_skill_paths(vault_paths)?
        .into_iter()
        .chain(resolve_project_skill_paths(workspace_root, project_paths)?)
    {
        if unique.insert(path.clone()) {
            let source_directory_path = path
                .parent()
                .ok_or_else(|| "Resolve employee skill directory.".to_string())?;
            let source_directory = open_directory_without_symlinks(source_directory_path)?;
            let skill_file = open_regular_entry(&source_directory, path.file_name().unwrap())?;
            resolved.push(ResolvedEngineSkill {
                skill_file_path: path,
                source_directory,
                skill_file,
            });
        }
    }
    Ok(resolved)
}

fn safe_directory_name(path: &Path, index: usize) -> String {
    let base = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("skill")
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    format!("{index:03}-{}", base.trim_matches('-'))
}

#[cfg(unix)]
fn open_directory_without_symlinks(path: &Path) -> Result<fs::File, String> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;

    if !path.is_absolute() {
        return Err("Employee skill directory must be absolute.".into());
    }
    let mut directory =
        fs::File::open("/").map_err(|_| "Open filesystem root for employee skill.".to_string())?;
    for component in path.components() {
        let name = match component {
            Component::RootDir => continue,
            Component::Normal(name) => name,
            _ => return Err("Employee skill directory contains an invalid component.".into()),
        };
        let name = CString::new(name.as_bytes())
            .map_err(|_| "Employee skill directory contains a NUL byte.".to_string())?;
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err("Employee skill directory changed or contains a symbolic link.".into());
        }
        // SAFETY: openat returned a fresh owned descriptor on success.
        directory = fs::File::from(unsafe { OwnedFd::from_raw_fd(fd) });
    }
    Ok(directory)
}

#[cfg(not(unix))]
fn open_directory_without_symlinks(_path: &Path) -> Result<fs::File, String> {
    Err("Secure employee skill overlays are unavailable on this platform.".into())
}

#[cfg(unix)]
fn open_regular_entry(directory: &fs::File, name: &std::ffi::OsStr) -> Result<fs::File, String> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::MetadataExt;

    let name = CString::new(name.as_bytes())
        .map_err(|_| "Employee skill entry contains a NUL byte.".to_string())?;
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
        )
    };
    if fd < 0 {
        return Err("Employee skill entry changed or is a symbolic link.".into());
    }
    // SAFETY: openat returned a fresh owned descriptor on success.
    let file = fs::File::from(unsafe { OwnedFd::from_raw_fd(fd) });
    let metadata = file
        .metadata()
        .map_err(|_| "Inspect opened employee skill entry.".to_string())?;
    if !metadata.is_file() || metadata.nlink() != 1 {
        return Err("Employee skill entry must be a single-linked regular file.".into());
    }
    Ok(file)
}

#[cfg(not(unix))]
fn open_regular_entry(_directory: &fs::File, _name: &std::ffi::OsStr) -> Result<fs::File, String> {
    Err("Secure employee skill overlays are unavailable on this platform.".into())
}

#[cfg(unix)]
struct DirectoryStream(*mut libc::DIR);

#[cfg(unix)]
impl Drop for DirectoryStream {
    fn drop(&mut self) {
        unsafe {
            libc::closedir(self.0);
        }
    }
}

#[cfg(unix)]
fn directory_entry_names(directory: &fs::File) -> Result<Vec<std::ffi::OsString>, String> {
    use std::ffi::CStr;
    use std::os::fd::AsRawFd;
    use std::os::unix::ffi::OsStrExt;

    let stream_fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            c".".as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if stream_fd < 0 {
        return Err("Open independent employee skill directory stream.".into());
    }
    let stream = unsafe { libc::fdopendir(stream_fd) };
    if stream.is_null() {
        unsafe {
            libc::close(stream_fd);
        }
        return Err("Read opened employee skill directory.".into());
    }
    let stream = DirectoryStream(stream);
    let mut names = Vec::new();
    loop {
        set_errno(0);
        let entry = unsafe { libc::readdir(stream.0) };
        if entry.is_null() {
            if errno() != 0 {
                return Err("Enumerate opened employee skill directory.".into());
            }
            break;
        }
        let bytes = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
        if matches!(bytes, b"." | b"..") {
            continue;
        }
        names.push(std::ffi::OsStr::from_bytes(bytes).to_os_string());
    }
    names.sort();
    Ok(names)
}

#[cfg(unix)]
fn set_errno(value: libc::c_int) {
    unsafe {
        *errno_location() = value;
    }
}

#[cfg(unix)]
fn errno() -> libc::c_int {
    unsafe { *errno_location() }
}

#[cfg(any(target_vendor = "apple", target_os = "freebsd"))]
fn errno_location() -> *mut libc::c_int {
    unsafe { libc::__error() }
}

#[cfg(any(
    target_os = "android",
    target_os = "dragonfly",
    target_os = "emscripten",
    target_os = "fuchsia",
    target_os = "hurd",
    target_os = "linux",
    target_os = "redox"
))]
fn errno_location() -> *mut libc::c_int {
    unsafe { libc::__errno_location() }
}

#[cfg(any(target_os = "netbsd", target_os = "openbsd"))]
fn errno_location() -> *mut libc::c_int {
    unsafe { libc::__errno() }
}

#[cfg(any(target_os = "illumos", target_os = "solaris"))]
fn errno_location() -> *mut libc::c_int {
    unsafe { libc::___errno() }
}

#[cfg(unix)]
fn path_component(name: &std::ffi::OsStr, label: &str) -> Result<std::ffi::CString, String> {
    use std::os::unix::ffi::OsStrExt;

    if name.is_empty() || name.as_bytes() == b"." || name.as_bytes() == b".." {
        return Err(format!("{label} is not a safe path component."));
    }
    std::ffi::CString::new(name.as_bytes()).map_err(|_| format!("{label} contains a NUL byte."))
}

#[cfg(unix)]
fn inspect_entry_at(parent: &fs::File, name: &std::ffi::CString) -> Result<libc::stat, String> {
    use std::os::fd::AsRawFd;

    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    let result = unsafe {
        libc::fstatat(
            parent.as_raw_fd(),
            name.as_ptr(),
            stat.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    if result < 0 {
        return Err("Inspect engine skill overlay entry.".into());
    }
    Ok(unsafe { stat.assume_init() })
}

#[cfg(unix)]
fn create_directory_at(
    parent: &fs::File,
    name: &std::ffi::OsStr,
    label: &str,
) -> Result<fs::File, String> {
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::fs::MetadataExt;

    let name = path_component(name, label)?;
    let created = unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) };
    if created < 0 {
        return Err(format!("Create {label}."));
    }
    let initial = inspect_entry_at(parent, &name)?;
    let descriptor = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if descriptor < 0 {
        return Err(format!("Open {label} without following symbolic links."));
    }
    let directory = fs::File::from(unsafe { OwnedFd::from_raw_fd(descriptor) });
    let opened = directory
        .metadata()
        .map_err(|_| format!("Inspect opened {label}."))?;
    let live = inspect_entry_at(parent, &name)?;
    if initial.st_mode & libc::S_IFMT != libc::S_IFDIR
        || live.st_mode & libc::S_IFMT != libc::S_IFDIR
        || initial.st_dev as u64 != opened.dev()
        || initial.st_ino as u64 != opened.ino()
        || live.st_dev as u64 != opened.dev()
        || live.st_ino as u64 != opened.ino()
    {
        return Err(format!("{label} changed during creation."));
    }
    Ok(directory)
}

#[cfg(unix)]
fn create_file_at(
    parent: &fs::File,
    name: &std::ffi::OsStr,
    mode: libc::mode_t,
    label: &str,
) -> Result<fs::File, String> {
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

    let name = path_component(name, label)?;
    let descriptor = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_WRONLY
                | libc::O_CREAT
                | libc::O_EXCL
                | libc::O_NOFOLLOW
                | libc::O_CLOEXEC
                | libc::O_NONBLOCK,
            mode as libc::c_uint,
        )
    };
    if descriptor < 0 {
        return Err(format!("Create {label}."));
    }
    Ok(fs::File::from(unsafe { OwnedFd::from_raw_fd(descriptor) }))
}

#[cfg(unix)]
struct OpenedOverlayEntry {
    parent: fs::File,
    name: std::ffi::OsString,
    entry: fs::File,
    directory: bool,
}

#[cfg(unix)]
fn remember_opened_entry(
    entries: &mut Vec<OpenedOverlayEntry>,
    parent: &fs::File,
    name: &std::ffi::OsStr,
    entry: &fs::File,
    directory: bool,
) -> Result<(), String> {
    entries.push(OpenedOverlayEntry {
        parent: parent
            .try_clone()
            .map_err(|_| "Retain engine overlay parent descriptor.".to_string())?,
        name: name.to_os_string(),
        entry: entry
            .try_clone()
            .map_err(|_| "Retain engine overlay entry descriptor.".to_string())?,
        directory,
    });
    Ok(())
}

#[cfg(unix)]
fn create_tracked_directory_at(
    entries: &mut Vec<OpenedOverlayEntry>,
    parent: &fs::File,
    name: &std::ffi::OsStr,
    label: &str,
) -> Result<fs::File, String> {
    let directory = create_directory_at(parent, name, label)?;
    remember_opened_entry(entries, parent, name, &directory, true)?;
    Ok(directory)
}

#[cfg(unix)]
fn create_tracked_file_at(
    entries: &mut Vec<OpenedOverlayEntry>,
    parent: &fs::File,
    name: &std::ffi::OsStr,
    mode: libc::mode_t,
    label: &str,
) -> Result<fs::File, String> {
    let file = create_file_at(parent, name, mode, label)?;
    remember_opened_entry(entries, parent, name, &file, false)?;
    Ok(file)
}

#[cfg(unix)]
fn verify_opened_entries(entries: &[OpenedOverlayEntry]) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;

    for expected in entries {
        let name = path_component(&expected.name, "engine overlay entry")?;
        let live = inspect_entry_at(&expected.parent, &name)?;
        let opened = expected
            .entry
            .metadata()
            .map_err(|_| "Inspect retained engine overlay entry.".to_string())?;
        let expected_type = if expected.directory {
            libc::S_IFDIR
        } else {
            libc::S_IFREG
        };
        if live.st_mode & libc::S_IFMT != expected_type
            || live.st_dev as u64 != opened.dev()
            || live.st_ino as u64 != opened.ino()
            || (!expected.directory && opened.nlink() != 1)
        {
            return Err("Engine skill overlay entry changed during materialization.".into());
        }
    }
    Ok(())
}

#[cfg(unix)]
fn opened_directory_matches_path(directory: &fs::File, path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;

    let Ok(opened) = directory.metadata() else {
        return false;
    };
    let Ok(live) = fs::symlink_metadata(path) else {
        return false;
    };
    !live.file_type().is_symlink()
        && live.is_dir()
        && live.dev() == opened.dev()
        && live.ino() == opened.ino()
}

#[cfg(unix)]
fn create_overlay_root() -> Result<(PathBuf, fs::File), String> {
    let temp_parent = std::env::temp_dir()
        .canonicalize()
        .map_err(|_| "Resolve engine skill overlay parent.".to_string())?;
    let parent = open_directory_without_symlinks(&temp_parent)?;
    if !opened_directory_matches_path(&parent, &temp_parent) {
        return Err("Engine skill overlay parent changed during access.".into());
    }
    let suffix = NEXT_OVERLAY_ID.fetch_add(1, Ordering::Relaxed);
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Create unique engine skill overlay id.".to_string())?
        .as_nanos();
    let name = format!(
        "offisim-engine-skills-{}-{created_at}-{suffix}",
        std::process::id()
    );
    let root_directory = create_directory_at(
        &parent,
        std::ffi::OsStr::new(&name),
        "engine skill overlay root",
    )?;
    let root = temp_parent.join(name);
    if !opened_directory_matches_path(&parent, &temp_parent)
        || !opened_directory_matches_path(&root_directory, &root)
    {
        return Err("Engine skill overlay root changed during creation.".into());
    }
    Ok((root, root_directory))
}

#[cfg(unix)]
fn copy_open_file(
    source: &fs::File,
    destination: &fs::File,
    name: &std::ffi::OsStr,
    entries: &mut Vec<OpenedOverlayEntry>,
) -> Result<(), String> {
    use std::os::unix::fs::FileExt;

    let metadata = source
        .metadata()
        .map_err(|_| "Inspect opened employee skill file.".to_string())?;
    let mut target = create_tracked_file_at(
        entries,
        destination,
        name,
        0o600,
        "engine skill overlay file",
    )?;
    let mut offset = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = source
            .read_at(&mut buffer, offset)
            .map_err(|_| "Read employee skill into engine overlay.".to_string())?;
        if read == 0 {
            break;
        }
        target
            .write_all(&buffer[..read])
            .map_err(|_| "Copy employee skill into engine overlay.".to_string())?;
        offset = offset
            .checked_add(read as u64)
            .ok_or_else(|| "Employee skill file is too large.".to_string())?;
    }
    target
        .set_permissions(metadata.permissions())
        .map_err(|_| "Preserve employee skill overlay permissions.".to_string())?;
    Ok(())
}

#[cfg(unix)]
fn copy_directory_entries(
    source: &fs::File,
    destination: &fs::File,
    root: bool,
    entries: &mut Vec<OpenedOverlayEntry>,
) -> Result<(), String> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;

    for name in directory_entry_names(source)? {
        if root && name == "SKILL.md" {
            continue;
        }
        let encoded = CString::new(name.as_bytes())
            .map_err(|_| "Employee skill entry contains a NUL byte.".to_string())?;
        let fd = unsafe {
            libc::openat(
                source.as_raw_fd(),
                encoded.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
            )
        };
        if fd < 0 {
            return Err("Employee skill entry changed or is a symbolic link.".into());
        }
        // SAFETY: openat returned a fresh owned descriptor on success.
        let entry = fs::File::from(unsafe { OwnedFd::from_raw_fd(fd) });
        let metadata = entry
            .metadata()
            .map_err(|_| "Inspect opened employee skill entry.".to_string())?;
        if metadata.is_dir() {
            let target = create_tracked_directory_at(
                entries,
                destination,
                &name,
                "engine skill overlay directory",
            )?;
            copy_directory_entries(&entry, &target, false, entries)?;
        } else if metadata.is_file() {
            use std::os::unix::fs::MetadataExt;
            if metadata.nlink() != 1 {
                return Err("Employee skill entry must be a single-linked regular file.".into());
            }
            copy_open_file(&entry, destination, &name, entries)?;
        } else {
            return Err("Employee skill tree contains an unsupported entry type.".into());
        }
    }
    Ok(())
}

#[cfg(unix)]
fn copy_skill_tree(
    source: &ResolvedEngineSkill,
    destination: &fs::File,
    name: &std::ffi::OsStr,
    entries: &mut Vec<OpenedOverlayEntry>,
) -> Result<(), String> {
    let target =
        create_tracked_directory_at(entries, destination, name, "engine skill overlay directory")?;
    copy_open_file(
        &source.skill_file,
        &target,
        std::ffi::OsStr::new("SKILL.md"),
        entries,
    )?;
    copy_directory_entries(&source.source_directory, &target, true, entries)?;
    Ok(())
}

pub(crate) fn materialize_engine_context_overlay(
    skill_files: &[ResolvedEngineSkill],
    kind: EngineSkillOverlayKind,
    project_experience: Option<&str>,
) -> Result<Option<EngineSkillOverlay>, String> {
    let project_experience = project_experience
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if skill_files.is_empty() && project_experience.is_none() {
        return Ok(None);
    }
    #[cfg(not(unix))]
    {
        let _ = (skill_files, kind, project_experience);
        return Err("Secure engine context overlays are unavailable on this platform.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        let (root, root_directory) = create_overlay_root()?;
        #[cfg(test)]
        run_after_overlay_root_opened_hook(&root);
        let mut project_experience_path = None;
        let mut opened_entries = Vec::new();
        let materialized = (|| {
            let (skills_root, _skills_root_path) = match kind {
                EngineSkillOverlayKind::CodexHome => {
                    let agents = create_tracked_directory_at(
                        &mut opened_entries,
                        &root_directory,
                        std::ffi::OsStr::new(".agents"),
                        "Codex overlay metadata directory",
                    )?;
                    (
                        create_tracked_directory_at(
                            &mut opened_entries,
                            &agents,
                            std::ffi::OsStr::new("skills"),
                            "engine skills directory",
                        )?,
                        root.join(".agents/skills"),
                    )
                }
                EngineSkillOverlayKind::ClaudePlugin => {
                    let manifest_directory = create_tracked_directory_at(
                        &mut opened_entries,
                        &root_directory,
                        std::ffi::OsStr::new(".claude-plugin"),
                        "Claude skill plugin metadata directory",
                    )?;
                    let mut manifest = create_tracked_file_at(
                        &mut opened_entries,
                        &manifest_directory,
                        std::ffi::OsStr::new("plugin.json"),
                        0o600,
                        "Claude skill plugin manifest",
                    )?;
                    manifest
                        .write_all(
                            r#"{"name":"offisim-employee-skills","description":"Skills selected by Offisim for this run","version":"1.0.0"}"#
                                .as_bytes(),
                        )
                        .map_err(|_| "Write Claude skill plugin manifest.".to_string())?;
                    (
                        create_tracked_directory_at(
                            &mut opened_entries,
                            &root_directory,
                            std::ffi::OsStr::new("skills"),
                            "engine skills directory",
                        )?,
                        root.join("skills"),
                    )
                }
            };
            #[cfg(test)]
            run_after_overlay_skills_root_opened_hook(&_skills_root_path);
            for (index, skill_file) in skill_files.iter().enumerate() {
                let source = skill_file
                    .skill_file_path
                    .parent()
                    .ok_or_else(|| "Resolve employee skill directory.".to_string())?;
                let name = safe_directory_name(source, index + 1);
                copy_skill_tree(
                    skill_file,
                    &skills_root,
                    std::ffi::OsStr::new(&name),
                    &mut opened_entries,
                )?;
            }
            if let Some(project_experience) = project_experience {
                let path = root.join("OFFISIM_PROJECT_EXPERIENCE.md");
                let mut file = create_tracked_file_at(
                    &mut opened_entries,
                    &root_directory,
                    std::ffi::OsStr::new("OFFISIM_PROJECT_EXPERIENCE.md"),
                    0o600,
                    "employee Project experience overlay",
                )?;
                file.write_all(project_experience.as_bytes())
                    .map_err(|_| "Write employee Project experience overlay.".to_string())?;
                file.set_permissions(fs::Permissions::from_mode(0o444))
                    .map_err(|_| {
                        "Make employee Project experience overlay read-only.".to_string()
                    })?;
                project_experience_path = Some(path);
            }
            let metadata = root_directory
                .metadata()
                .map_err(|_| "Inspect completed engine skill overlay root.".to_string())?;
            verify_opened_entries(&opened_entries)?;
            if metadata.nlink() == 0 || !opened_directory_matches_path(&root_directory, &root) {
                return Err("Engine skill overlay root changed during materialization.".into());
            }
            Ok::<(), String>(())
        })();
        if let Err(error) = materialized {
            if opened_directory_matches_path(&root_directory, &root) {
                let _ = fs::remove_dir_all(&root);
            }
            return Err(error);
        }
        Ok(Some(EngineSkillOverlay {
            load_path: root.clone(),
            root,
            project_experience_path,
            root_directory,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "offisim-engine-skills-test-{}-{}-{name}",
            std::process::id(),
            NEXT_OVERLAY_ID.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn project_skills_require_supported_relative_skill_files() {
        let root = fixture_root("project-resolution");
        let skill = root.join(".claude/skills/live/SKILL.md");
        fs::create_dir_all(skill.parent().unwrap()).unwrap();
        fs::write(&skill, "---\nname: live\ndescription: fixture\n---\n").unwrap();

        let resolved =
            resolve_project_skill_paths(&root, Some(&[".claude/skills/live/SKILL.md".into()]))
                .unwrap();
        assert_eq!(resolved, vec![skill.canonicalize().unwrap()]);
        assert!(
            resolve_project_skill_paths(&root, Some(&["../outside/SKILL.md".into()]),).is_err()
        );
        assert!(
            resolve_project_skill_paths(&root, Some(&["skills/live/SKILL.md".into()])).is_err()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn overlays_copy_the_complete_skill_without_rewriting_frontmatter() {
        #[cfg(unix)]
        use std::os::unix::fs::PermissionsExt;

        let root = fixture_root("overlay-copy");
        let skill_dir = root.join(".claude/skills/live");
        fs::create_dir_all(skill_dir.join("references")).unwrap();
        let source =
            "---\nname: exact-name\ndescription: exact description\n---\nDo the exact thing.\n";
        fs::write(skill_dir.join("SKILL.md"), source).unwrap();
        fs::write(skill_dir.join("references/details.md"), "supporting file").unwrap();
        let skills =
            resolve_engine_skill_paths(&root, None, Some(&[".claude/skills/live/SKILL.md".into()]))
                .unwrap();

        let overlay =
            materialize_engine_context_overlay(&skills, EngineSkillOverlayKind::ClaudePlugin, None)
                .unwrap()
                .unwrap();
        let copied_dir = fs::read_dir(overlay.load_path().join("skills"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(
            fs::read_to_string(copied_dir.join("SKILL.md")).unwrap(),
            source
        );
        assert_eq!(
            fs::read_to_string(copied_dir.join("references/details.md")).unwrap(),
            "supporting file"
        );
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(overlay.load_path())
                .unwrap()
                .permissions()
                .mode()
                & 0o077,
            0
        );
        drop(overlay);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn overlays_keep_the_verified_source_when_the_path_is_replaced() {
        use std::os::unix::fs::symlink;

        let root = fixture_root("overlay-source-swap");
        let outside = fixture_root("overlay-source-swap-outside");
        let skill_dir = root.join(".claude/skills/live");
        fs::create_dir_all(skill_dir.join("references")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: verified\ndescription: verified\n---\nverified source\n",
        )
        .unwrap();
        fs::write(
            skill_dir.join("references/details.md"),
            "verified reference",
        )
        .unwrap();
        fs::write(
            outside.join("SKILL.md"),
            "---\nname: outside\ndescription: outside\n---\noutside source\n",
        )
        .unwrap();
        fs::write(outside.join("outside-only.md"), "must not escape").unwrap();

        let skills =
            resolve_engine_skill_paths(&root, None, Some(&[".claude/skills/live/SKILL.md".into()]))
                .unwrap();
        let verified_dir = root.join(".claude/skills/verified-live");
        fs::rename(&skill_dir, &verified_dir).unwrap();
        symlink(&outside, &skill_dir).unwrap();

        for (kind, relative_skills_root) in [
            (EngineSkillOverlayKind::CodexHome, ".agents/skills"),
            (EngineSkillOverlayKind::ClaudePlugin, "skills"),
        ] {
            let overlay = materialize_engine_context_overlay(&skills, kind, None)
                .unwrap()
                .unwrap();
            let copied_dir = fs::read_dir(overlay.load_path().join(relative_skills_root))
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .path();
            assert!(fs::read_to_string(copied_dir.join("SKILL.md"))
                .unwrap()
                .contains("verified source"));
            assert_eq!(
                fs::read_to_string(copied_dir.join("references/details.md")).unwrap(),
                "verified reference"
            );
            assert!(!copied_dir.join("outside-only.md").exists());
        }

        drop(skills);
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn codex_and_claude_overlays_reject_symlinked_skill_entries() {
        use std::os::unix::fs::symlink;

        let root = fixture_root("overlay-symlink-entry");
        let outside = fixture_root("overlay-symlink-entry-outside");
        let skill_dir = root.join(".claude/skills/live");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: live\ndescription: live\n---\n",
        )
        .unwrap();
        fs::write(outside.join("secret.md"), "outside secret").unwrap();
        symlink(&outside, skill_dir.join("references")).unwrap();
        let skills =
            resolve_engine_skill_paths(&root, None, Some(&[".claude/skills/live/SKILL.md".into()]))
                .unwrap();

        for kind in [
            EngineSkillOverlayKind::CodexHome,
            EngineSkillOverlayKind::ClaudePlugin,
        ] {
            let error = materialize_engine_context_overlay(&skills, kind, None)
                .err()
                .unwrap();
            assert!(error.contains("symbolic link"), "unexpected error: {error}");
        }

        drop(skills);
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn overlays_reject_hard_linked_skill_files() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        use std::os::unix::fs::symlink;
        use std::os::unix::net::UnixListener;

        let root = fixture_root("overlay-hard-link");
        let outside = fixture_root("overlay-hard-link-outside");
        let skill_dir = root.join(".claude/skills/live");
        fs::create_dir_all(skill_dir.join("references")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: live\ndescription: live\n---\n",
        )
        .unwrap();
        let secret = outside.join("secret.md");
        fs::write(&secret, "outside secret").unwrap();
        fs::hard_link(&secret, skill_dir.join("references/secret.md")).unwrap();
        let skills =
            resolve_engine_skill_paths(&root, None, Some(&[".claude/skills/live/SKILL.md".into()]))
                .unwrap();

        let error =
            materialize_engine_context_overlay(&skills, EngineSkillOverlayKind::CodexHome, None)
                .err()
                .unwrap();
        assert!(error.contains("single-linked"), "unexpected error: {error}");

        drop(skills);
        fs::remove_file(skill_dir.join("references/secret.md")).unwrap();

        let fifo = skill_dir.join("references/pipe");
        let fifo_name = CString::new(fifo.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo_name.as_ptr(), 0o600) }, 0);
        let skills =
            resolve_engine_skill_paths(&root, None, Some(&[".claude/skills/live/SKILL.md".into()]))
                .unwrap();
        let error =
            materialize_engine_context_overlay(&skills, EngineSkillOverlayKind::CodexHome, None)
                .err()
                .unwrap();
        assert!(
            error.contains("unsupported entry type"),
            "unexpected FIFO error: {error}"
        );
        drop(skills);
        fs::remove_file(&fifo).unwrap();

        let socket_alias = Path::new("/tmp").join(format!(
            "offisim-skill-socket-{}-{}",
            std::process::id(),
            NEXT_OVERLAY_ID.fetch_add(1, Ordering::Relaxed)
        ));
        symlink(skill_dir.join("references"), &socket_alias).unwrap();
        let socket = UnixListener::bind(socket_alias.join("socket")).unwrap();
        let skills =
            resolve_engine_skill_paths(&root, None, Some(&[".claude/skills/live/SKILL.md".into()]))
                .unwrap();
        let error =
            materialize_engine_context_overlay(&skills, EngineSkillOverlayKind::CodexHome, None)
                .err()
                .unwrap();
        assert!(
            error.contains("unsupported entry type")
                || error.contains("changed or is a symbolic link"),
            "unexpected socket error: {error}"
        );

        drop(skills);
        drop(socket);
        fs::remove_file(socket_alias).unwrap();
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn context_overlay_exports_project_experience_as_read_only_context() {
        let overlay = materialize_engine_context_overlay(
            &[],
            EngineSkillOverlayKind::CodexHome,
            Some("## Project experience\n- Avoid generated files."),
        )
        .unwrap()
        .unwrap();
        let context_path = overlay.load_path().join("OFFISIM_PROJECT_EXPERIENCE.md");
        assert_eq!(
            fs::read_to_string(&context_path).unwrap(),
            "## Project experience\n- Avoid generated files."
        );
        assert!(fs::metadata(&context_path)
            .unwrap()
            .permissions()
            .readonly());
        let prompt = overlay
            .system_prompt_with_project_experience(Some("Employee persona"))
            .unwrap();
        assert!(prompt.contains("Employee persona"));
        assert!(prompt.contains(context_path.to_string_lossy().as_ref()));
    }
}
