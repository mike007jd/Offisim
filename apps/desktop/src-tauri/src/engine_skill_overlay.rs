use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static NEXT_OVERLAY_ID: AtomicU64 = AtomicU64::new(1);

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
fn copy_open_file(source: &fs::File, destination: &Path) -> Result<(), String> {
    use std::os::unix::fs::FileExt;

    let metadata = source
        .metadata()
        .map_err(|_| "Inspect opened employee skill file.".to_string())?;
    let mut target = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|_| "Create engine skill overlay file.".to_string())?;
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
fn copy_directory_entries(source: &fs::File, destination: &Path, root: bool) -> Result<(), String> {
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
        let target = destination.join(&name);
        if metadata.is_dir() {
            fs::create_dir(&target)
                .map_err(|_| "Create engine skill overlay directory.".to_string())?;
            copy_directory_entries(&entry, &target, false)?;
        } else if metadata.is_file() {
            use std::os::unix::fs::MetadataExt;
            if metadata.nlink() != 1 {
                return Err("Employee skill entry must be a single-linked regular file.".into());
            }
            copy_open_file(&entry, &target)?;
        } else {
            return Err("Employee skill tree contains an unsupported entry type.".into());
        }
    }
    Ok(())
}

fn copy_skill_tree(source: &ResolvedEngineSkill, destination: &Path) -> Result<(), String> {
    fs::create_dir(destination)
        .map_err(|_| "Create engine skill overlay directory.".to_string())?;
    #[cfg(unix)]
    {
        copy_open_file(&source.skill_file, &destination.join("SKILL.md"))?;
        copy_directory_entries(&source.source_directory, destination, true)?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        let _ = source;
        Err("Secure employee skill overlays are unavailable on this platform.".into())
    }
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
    let suffix = NEXT_OVERLAY_ID.fetch_add(1, Ordering::Relaxed);
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Create unique engine skill overlay id.".to_string())?
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "offisim-engine-skills-{}-{created_at}-{suffix}",
        std::process::id(),
    ));
    let mut root_builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        root_builder.mode(0o700);
    }
    root_builder
        .create(&root)
        .map_err(|_| "Create engine skill overlay.".to_string())?;
    let mut project_experience_path = None;
    let materialized = (|| {
        let skills_root = match kind {
            EngineSkillOverlayKind::CodexHome => root.join(".agents/skills"),
            EngineSkillOverlayKind::ClaudePlugin => {
                let manifest_dir = root.join(".claude-plugin");
                fs::create_dir_all(&manifest_dir)
                    .map_err(|_| "Create Claude skill plugin metadata directory.".to_string())?;
                fs::write(
                    manifest_dir.join("plugin.json"),
                    r#"{"name":"offisim-employee-skills","description":"Skills selected by Offisim for this run","version":"1.0.0"}"#,
                )
                .map_err(|_| "Write Claude skill plugin manifest.".to_string())?;
                root.join("skills")
            }
        };
        fs::create_dir_all(&skills_root)
            .map_err(|_| "Create engine skills directory.".to_string())?;
        for (index, skill_file) in skill_files.iter().enumerate() {
            let source = skill_file
                .skill_file_path
                .parent()
                .ok_or_else(|| "Resolve employee skill directory.".to_string())?;
            copy_skill_tree(
                skill_file,
                &skills_root.join(safe_directory_name(source, index + 1)),
            )?;
        }
        if let Some(project_experience) = project_experience {
            let path = root.join("OFFISIM_PROJECT_EXPERIENCE.md");
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|_| "Create employee Project experience overlay.".to_string())?;
            file.write_all(project_experience.as_bytes())
                .map_err(|_| "Write employee Project experience overlay.".to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(fs::Permissions::from_mode(0o444))
                    .map_err(|_| {
                        "Make employee Project experience overlay read-only.".to_string()
                    })?;
            }
            project_experience_path = Some(path);
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = materialized {
        let _ = fs::remove_dir_all(&root);
        return Err(error);
    }
    Ok(Some(EngineSkillOverlay {
        load_path: root.clone(),
        root,
        project_experience_path,
    }))
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
