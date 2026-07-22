use super::*;

fn resolve_candidate(path: &str, cwd: Option<&str>) -> Result<PathBuf, String> {
    let input = PathBuf::from(path);
    let candidate = if input.is_absolute() {
        input
    } else {
        let cwd = cwd.ok_or_else(|| "relative paths require a workspace cwd".to_string())?;
        PathBuf::from(cwd).join(input)
    };
    if has_parent_dir(&candidate) {
        return Err("parent-directory path segments are not allowed".to_string());
    }
    Ok(candidate)
}

pub(crate) fn resolve_project_candidate(
    path: &str,
    cwd: Option<&str>,
    roots: &[PathBuf],
) -> Result<PathBuf, String> {
    if Path::new(path).is_absolute() || cwd.is_some() {
        return resolve_candidate(path, cwd);
    }
    let input = Path::new(path);
    if has_parent_dir(input) {
        return Err("parent-directory path segments are not allowed".to_string());
    }
    if roots.len() == 1 {
        return Ok(roots[0].join(input));
    }
    resolve_candidate(path, cwd)
}

pub(crate) fn relativize_for_error(path: &Path, roots: &[PathBuf]) -> String {
    for root in roots {
        if path.starts_with(root) {
            let root_name = root
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| "workspace".to_string());
            let relative = path.strip_prefix(root).unwrap_or_else(|_| Path::new(""));
            if relative.as_os_str().is_empty() {
                return root_name;
            }
            return format!("{root_name}/{}", relative.to_string_lossy());
        }
    }
    "<out-of-bounds>".to_string()
}

pub(crate) fn ensure_inside_workspace(candidate: &Path, roots: &[PathBuf]) -> Result<(), String> {
    if roots.is_empty() {
        return Err("No Project folder is selected for this task.".to_string());
    }
    if roots.iter().any(|root| candidate.starts_with(root)) {
        return Ok(());
    }
    Err(format!(
        "path is outside bound project workspaces: {}",
        relativize_for_error(candidate, roots)
    ))
}

pub(super) fn ensure_read_size(size: u64, path: &Path, roots: &[PathBuf]) -> Result<(), String> {
    if size > MAX_READ_BYTES {
        return Err(format!(
            "file too large to read in-process: {} ({}B > {}B)",
            relativize_for_error(path, roots),
            size,
            MAX_READ_BYTES
        ));
    }
    Ok(())
}

pub(super) fn ensure_write_size(size: usize, path: &Path, roots: &[PathBuf]) -> Result<(), String> {
    if size > MAX_WRITE_BYTES {
        return Err(format!(
            "file too large to write in-process: {} ({}B > {}B)",
            relativize_for_error(path, roots),
            size,
            MAX_WRITE_BYTES
        ));
    }
    Ok(())
}

#[cfg(unix)]
pub(super) struct AnchoredProjectParent {
    pub(super) directory: std::fs::File,
    pub(super) leaf: std::ffi::CString,
}

#[cfg(unix)]
fn open_authorized_project_root(
    authority: &AuthorizedWorkspaceRoot,
    roots: &WorkspaceRoots,
) -> Result<std::fs::File, String> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;

    let root = authority.path();
    let mut directory = std::fs::File::open("/")
        .map_err(|err| fs_op_error("open filesystem root", Path::new("/"), roots, err))?;
    for component in root.components() {
        let name = match component {
            Component::RootDir => continue,
            Component::Normal(name) => name,
            _ => return Err("bound project workspace contains an invalid path component".into()),
        };
        let name = CString::new(name.as_bytes())
            .map_err(|_| "bound project workspace contains a NUL byte".to_string())?;
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(fs_op_error(
                "open bound project workspace without following symlinks",
                root,
                roots,
                std::io::Error::last_os_error(),
            ));
        }
        // SAFETY: openat returned a fresh owned descriptor on success.
        directory = std::fs::File::from(unsafe { OwnedFd::from_raw_fd(fd) });
    }
    let metadata = directory
        .metadata()
        .map_err(|error| fs_op_error("stat bound Project folder", root, roots, error))?;
    if !authority.matches_metadata(&metadata) {
        return Err("Project folder identity changed after it was selected.".into());
    }
    Ok(directory)
}

#[cfg(unix)]
pub(super) fn open_project_parent_anchored(
    target: &Path,
    roots: &WorkspaceRoots,
    create_parents: bool,
) -> Result<AnchoredProjectParent, String> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;

    let authority = roots.authority_for(target).ok_or_else(|| {
        format!(
            "path is outside bound project workspaces: {}",
            relativize_for_error(target, roots)
        )
    })?;
    let root = authority.path();
    let relative = target
        .strip_prefix(root)
        .map_err(|_| "resolve project file target failed".to_string())?;
    let mut relative_components = relative.components().collect::<Vec<_>>();
    let leaf = match relative_components.pop() {
        Some(Component::Normal(name)) => name,
        _ => return Err("project file target has no file name".into()),
    };

    // Keep every traversal bound to opened directory objects. Symlink swaps
    // cannot redirect it; a later rename preserves the opened object identity.
    let mut directory = open_authorized_project_root(authority, roots)?;

    for component in relative_components {
        let Component::Normal(name) = component else {
            return Err("project file parent contains an invalid path component".into());
        };
        let name = CString::new(name.as_bytes())
            .map_err(|_| "project file parent contains a NUL byte".to_string())?;
        if create_parents {
            let created = unsafe { libc::mkdirat(directory.as_raw_fd(), name.as_ptr(), 0o755) };
            if created != 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() != std::io::ErrorKind::AlreadyExists {
                    return Err(fs_op_error(
                        "create project file parent",
                        target,
                        roots,
                        error,
                    ));
                }
            }
        }
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(fs_op_error(
                "open project file parent without following symlinks",
                target,
                roots,
                std::io::Error::last_os_error(),
            ));
        }
        // SAFETY: openat returned a fresh owned descriptor on success.
        directory = std::fs::File::from(unsafe { OwnedFd::from_raw_fd(fd) });
    }

    Ok(AnchoredProjectParent {
        directory,
        leaf: CString::new(leaf.as_bytes())
            .map_err(|_| "project file name contains a NUL byte".to_string())?,
    })
}

fn verify_project_write_authority(target: &Path, roots: &WorkspaceRoots) -> Result<(), String> {
    roots
        .authority_for(target)
        .ok_or_else(|| "project file target is outside the bound workspace".to_string())?
        .verify_live()
}

#[cfg(unix)]
pub(super) fn open_project_directory_anchored(
    target: &Path,
    roots: &WorkspaceRoots,
) -> Result<std::fs::File, String> {
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

    let authority = roots.authority_for(target).ok_or_else(|| {
        format!(
            "project directory is outside bound project workspaces: {}",
            relativize_for_error(target, roots)
        )
    })?;
    if target == authority.path() {
        return open_authorized_project_root(authority, roots);
    }
    let anchored = open_project_parent_anchored(target, roots, false)?;
    let fd = unsafe {
        libc::openat(
            anchored.directory.as_raw_fd(),
            anchored.leaf.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(fs_op_error(
            "open project directory without following symlinks",
            target,
            roots,
            std::io::Error::last_os_error(),
        ));
    }
    // SAFETY: openat returned a fresh owned descriptor on success.
    Ok(std::fs::File::from(unsafe { OwnedFd::from_raw_fd(fd) }))
}

#[cfg(unix)]
pub(crate) fn project_path_metadata_anchored(
    target: &Path,
    roots: &WorkspaceRoots,
) -> Result<Option<ProjectPathMetadata>, String> {
    use std::ffi::CString;
    use std::mem::MaybeUninit;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;

    let authority = roots.authority_for(target).ok_or_else(|| {
        format!(
            "path is outside bound project workspaces: {}",
            relativize_for_error(target, roots)
        )
    })?;
    if target == authority.path() {
        open_authorized_project_root(authority, roots)?;
        return Ok(Some(ProjectPathMetadata {
            is_file: false,
            is_directory: true,
            is_symlink: false,
            size: None,
        }));
    }
    let relative = target
        .strip_prefix(authority.path())
        .map_err(|_| "resolve project path failed".to_string())?;
    let mut components = relative.components().collect::<Vec<_>>();
    let leaf = match components.pop() {
        Some(Component::Normal(name)) => CString::new(name.as_bytes())
            .map_err(|_| "project path contains a NUL byte".to_string())?,
        _ => return Err("project path has no valid leaf".into()),
    };
    let mut directory = open_authorized_project_root(authority, roots)?;
    for component in components {
        let Component::Normal(name) = component else {
            return Err("project path contains an invalid component".into());
        };
        let name = CString::new(name.as_bytes())
            .map_err(|_| "project path contains a NUL byte".to_string())?;
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::NotFound {
                return Ok(None);
            }
            return Err(fs_op_error("open project path", target, roots, error));
        }
        // SAFETY: openat returned a fresh owned descriptor on success.
        directory = std::fs::File::from(unsafe { OwnedFd::from_raw_fd(fd) });
    }
    let mut stat = MaybeUninit::<libc::stat>::uninit();
    let result = unsafe {
        libc::fstatat(
            directory.as_raw_fd(),
            leaf.as_ptr(),
            stat.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    if result == 0 {
        // SAFETY: fstatat initialized the stat buffer on success.
        let stat = unsafe { stat.assume_init() };
        let file_kind = stat.st_mode & libc::S_IFMT;
        let is_file = file_kind == libc::S_IFREG;
        return Ok(Some(ProjectPathMetadata {
            is_file,
            is_directory: file_kind == libc::S_IFDIR,
            is_symlink: file_kind == libc::S_IFLNK,
            size: is_file.then_some(stat.st_size.max(0) as u64),
        }));
    }
    let error = std::io::Error::last_os_error();
    if error.kind() == std::io::ErrorKind::NotFound {
        Ok(None)
    } else {
        Err(fs_op_error("inspect project path", target, roots, error))
    }
}

#[cfg(not(unix))]
pub(crate) fn project_path_metadata_anchored(
    target: &Path,
    roots: &WorkspaceRoots,
) -> Result<Option<ProjectPathMetadata>, String> {
    let authority = roots.authority_for(target).ok_or_else(|| {
        format!(
            "path is outside bound project workspaces: {}",
            relativize_for_error(target, roots)
        )
    })?;
    authority.verify_live()?;
    if target == authority.path() {
        return Ok(Some(ProjectPathMetadata {
            is_file: false,
            is_directory: true,
            is_symlink: false,
            size: None,
        }));
    }
    let parent = target
        .parent()
        .ok_or_else(|| "project path has no parent".to_string())?;
    let canonical_parent = match parent.canonicalize() {
        Ok(parent) => parent,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(fs_resolve_error(
                "resolve project path parent",
                parent,
                error,
            ))
        }
    };
    ensure_inside_workspace(&canonical_parent, roots)?;
    let leaf = target
        .file_name()
        .ok_or_else(|| "project path has no valid leaf".to_string())?;
    let candidate = canonical_parent.join(leaf);
    let metadata = match std::fs::symlink_metadata(&candidate) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(fs_op_error(
                "inspect project path",
                &candidate,
                roots,
                error,
            ))
        }
    };
    authority.verify_live()?;
    if parent
        .canonicalize()
        .map_err(|error| fs_resolve_error("recheck project path parent", parent, error))?
        != canonical_parent
    {
        return Err("Project path parent identity changed during access.".into());
    }
    let file_type = metadata.file_type();
    Ok(Some(ProjectPathMetadata {
        is_file: file_type.is_file(),
        is_directory: file_type.is_dir(),
        is_symlink: file_type.is_symlink(),
        size: file_type.is_file().then_some(metadata.len()),
    }))
}

#[cfg(unix)]
pub(super) fn write_project_file_anchored_guarded<F>(
    target: &Path,
    roots: &WorkspaceRoots,
    content: &[u8],
    before_commit: F,
) -> Result<(), String>
where
    F: Fn() -> Result<(), String>,
{
    use std::ffi::CString;
    use std::mem::MaybeUninit;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

    let anchored = open_project_parent_anchored(target, roots, true)?;
    let mut existing_stat = MaybeUninit::<libc::stat>::uninit();
    let existing_stat_result = unsafe {
        libc::fstatat(
            anchored.directory.as_raw_fd(),
            anchored.leaf.as_ptr(),
            existing_stat.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    let preserved_mode = if existing_stat_result == 0 {
        // SAFETY: fstatat initialized the stat buffer on success.
        let stat = unsafe { existing_stat.assume_init() };
        let is_regular = stat.st_mode & libc::S_IFMT == libc::S_IFREG;
        if is_regular && stat.st_nlink == 1 {
            Some(stat.st_mode & 0o777)
        } else {
            // Symlinks and multiply-linked files are replaced with a fresh,
            // non-executable entry; their metadata is not trusted/inherited.
            None
        }
    } else {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::NotFound {
            None
        } else {
            return Err(fs_op_error(
                "inspect existing project file",
                target,
                roots,
                error,
            ));
        }
    };
    for _ in 0..16 {
        let temp_name = CString::new(format!(
            ".offisim-write-{}-{:016x}",
            std::process::id(),
            rand::random::<u64>()
        ))
        .map_err(|_| "temporary project file name is invalid".to_string())?;
        if temp_name.as_bytes() == anchored.leaf.as_bytes() {
            continue;
        }
        let fd = unsafe {
            libc::openat(
                anchored.directory.as_raw_fd(),
                temp_name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o666,
            )
        };
        if fd < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                continue;
            }
            return Err(fs_op_error(
                "create temporary project file",
                target,
                roots,
                error,
            ));
        }
        if let Some(mode) = preserved_mode {
            if unsafe { libc::fchmod(fd, mode) } != 0 {
                let error = std::io::Error::last_os_error();
                unsafe {
                    libc::close(fd);
                    libc::unlinkat(anchored.directory.as_raw_fd(), temp_name.as_ptr(), 0);
                }
                return Err(fs_op_error(
                    "preserve project file permissions",
                    target,
                    roots,
                    error,
                ));
            }
        }
        // SAFETY: openat returned a fresh owned descriptor on success.
        let mut file = std::fs::File::from(unsafe { OwnedFd::from_raw_fd(fd) });
        let write_result = file.write_all(content).and_then(|()| file.sync_all());
        if let Err(error) = write_result {
            unsafe {
                libc::unlinkat(anchored.directory.as_raw_fd(), temp_name.as_ptr(), 0);
            }
            return Err(fs_op_error(
                "write temporary project file",
                target,
                roots,
                error,
            ));
        }
        if let Err(error) = before_commit() {
            unsafe {
                libc::unlinkat(anchored.directory.as_raw_fd(), temp_name.as_ptr(), 0);
            }
            return Err(error);
        }
        if let Err(error) = verify_project_write_authority(target, roots) {
            unsafe {
                libc::unlinkat(anchored.directory.as_raw_fd(), temp_name.as_ptr(), 0);
            }
            return Err(error);
        }
        let renamed = unsafe {
            libc::renameat(
                anchored.directory.as_raw_fd(),
                temp_name.as_ptr(),
                anchored.directory.as_raw_fd(),
                anchored.leaf.as_ptr(),
            )
        };
        if renamed != 0 {
            let error = std::io::Error::last_os_error();
            unsafe {
                libc::unlinkat(anchored.directory.as_raw_fd(), temp_name.as_ptr(), 0);
            }
            return Err(fs_op_error("replace project file", target, roots, error));
        }
        anchored
            .directory
            .sync_all()
            .map_err(|error| fs_op_error("flush project file parent", target, roots, error))?;
        return Ok(());
    }
    Err("Could not allocate a unique temporary project file".into())
}

#[cfg(not(unix))]
pub(crate) fn open_project_read_target_anchored(
    target: &Path,
    roots: &WorkspaceRoots,
) -> Result<std::fs::File, String> {
    let authority = roots.authority_for(target).ok_or_else(|| {
        format!(
            "path is outside bound project workspaces: {}",
            relativize_for_error(target, roots)
        )
    })?;
    authority.verify_live()?;
    let parent = target
        .parent()
        .ok_or_else(|| "project file target has no parent".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| fs_resolve_error("resolve project file parent", parent, error))?;
    ensure_inside_workspace(&canonical_parent, roots)?;
    let leaf = target
        .file_name()
        .ok_or_else(|| "project file target has no file name".to_string())?;
    let candidate = canonical_parent.join(leaf);
    let leaf_metadata = std::fs::symlink_metadata(&candidate)
        .map_err(|error| fs_op_error("inspect project file", &candidate, roots, error))?;
    if leaf_metadata.file_type().is_symlink() {
        return Err("project file target cannot be a symlink".into());
    }
    let file = std::fs::File::open(&candidate)
        .map_err(|err| fs_op_error("open project file", &candidate, roots, err))?;
    let metadata = file
        .metadata()
        .map_err(|err| fs_op_error("stat project file", &candidate, roots, err))?;
    ensure_safe_project_file_metadata(&metadata, &candidate, roots)?;
    authority.verify_live()?;
    if parent
        .canonicalize()
        .map_err(|error| fs_resolve_error("recheck project file parent", parent, error))?
        != canonical_parent
    {
        return Err("Project file parent identity changed during access.".into());
    }
    Ok(file)
}

#[cfg(not(unix))]
pub(super) fn write_project_file_anchored_guarded<F>(
    target: &Path,
    roots: &WorkspaceRoots,
    content: &[u8],
    before_commit: F,
) -> Result<(), String>
where
    F: Fn() -> Result<(), String>,
{
    let parent = target
        .parent()
        .ok_or_else(|| "project file target has no parent".to_string())?;
    let root = roots
        .iter()
        .find(|root| target.starts_with(root))
        .ok_or_else(|| "project file target is outside the bound workspace".to_string())?;
    let relative = parent
        .strip_prefix(root)
        .map_err(|_| "project file target is outside the bound workspace".to_string())?;
    let mut current = root.clone();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err("project file parent contains an invalid path component".into());
        };
        current.push(name);
        match std::fs::create_dir(&current) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(fs_op_error(
                    "create project file parent",
                    &current,
                    roots,
                    error,
                ))
            }
        }
        let metadata = std::fs::symlink_metadata(&current)
            .map_err(|error| fs_op_error("inspect project file parent", &current, roots, error))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("project file parent cannot traverse a symlink".into());
        }
        let canonical = current
            .canonicalize()
            .map_err(|error| fs_resolve_error("resolve project file parent", &current, error))?;
        ensure_inside_workspace(&canonical, roots)?;
        current = canonical;
    }
    for _ in 0..16 {
        let temporary = current.join(format!(
            ".offisim-write-{}-{:016x}",
            std::process::id(),
            rand::random::<u64>()
        ));
        let mut file = match OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(fs_op_error(
                    "create temporary project file",
                    &temporary,
                    roots,
                    error,
                ))
            }
        };
        if let Err(error) = file.write_all(content).and_then(|()| file.sync_all()) {
            let _ = std::fs::remove_file(&temporary);
            return Err(fs_op_error(
                "write temporary project file",
                &temporary,
                roots,
                error,
            ));
        }
        if let Err(error) = before_commit() {
            let _ = std::fs::remove_file(&temporary);
            return Err(error);
        }
        if let Err(error) = verify_project_write_authority(target, roots) {
            let _ = std::fs::remove_file(&temporary);
            return Err(error);
        }
        match std::fs::remove_file(target) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                let _ = std::fs::remove_file(&temporary);
                return Err(fs_op_error("replace project file", target, roots, error));
            }
        }
        return std::fs::rename(&temporary, target)
            .map_err(|error| fs_op_error("replace project file", target, roots, error));
    }
    Err("Could not allocate a unique temporary project file".into())
}

pub(crate) fn write_project_file_anchored(
    target: &Path,
    roots: &WorkspaceRoots,
    content: &[u8],
) -> Result<(), String> {
    let _mutation_guard = PROJECT_FILE_MUTATION_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    write_project_file_anchored_guarded(target, roots, content, || Ok(()))
}

#[cfg(test)]
mod builtin_tools_contracts {
    use super::super::builtin_tools_contracts::*;
    use super::*;
    use std::fs;

    #[test]
    fn rejects_overbroad_workspace_root() {
        assert!(is_overbroad_workspace_root(Path::new("/")));
        assert!(is_overbroad_workspace_root(Path::new("/Users")));
        assert!(is_overbroad_workspace_root(Path::new("/tmp")));
        assert!(is_overbroad_workspace_root(Path::new("/private/tmp")));
    }

    #[test]
    fn redacts_out_of_bounds_paths() {
        let workspace = TestDir::new("redact");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let rendered = relativize_for_error(Path::new("/Users/example/.ssh/id_rsa"), &[root]);
        assert_eq!(rendered, "<out-of-bounds>");
    }

    #[test]
    fn anchored_write_creates_nested_file_inside_workspace() {
        let workspace = TestDir::new("anchored-write");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let target = root.join("nested/deeper/file.txt");

        write_project_file_anchored(&target, &authorized_roots(&root), b"inside")
            .expect("write anchored project file");

        assert_eq!(
            fs::read_to_string(target).expect("read anchored file"),
            "inside"
        );
    }

    #[test]
    fn bounded_project_read_stops_one_byte_past_the_hard_limit() {
        let mut reader = std::io::Cursor::new(b"abcdef".to_vec());
        let (bytes, exceeded) =
            read_to_hard_limit(&mut reader, 2, 4).expect("bounded read succeeds");
        assert_eq!(bytes, b"abcde");
        assert!(exceeded);
    }

    #[test]
    fn guarded_project_write_cancels_before_atomic_replace() {
        let workspace = TestDir::new("guarded-cancel");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let target = root.join("file.txt");
        fs::write(&target, "original").expect("seed original");

        let error = write_project_file_anchored_guarded(
            &target,
            &authorized_roots(&root),
            b"replacement",
            || Err(PROJECT_FILE_CANCELLED_SENTINEL.into()),
        )
        .expect_err("cancelled commit must retain the original file");

        assert_eq!(error, PROJECT_FILE_CANCELLED_SENTINEL);
        assert_eq!(
            fs::read_to_string(&target).expect("read original"),
            "original"
        );
        assert!(!fs::read_dir(&root)
            .expect("list root")
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with(".offisim-write-")));
    }

    #[cfg(unix)]
    #[test]
    fn guarded_project_write_rechecks_authority_immediately_before_replace() {
        let workspace = TestDir::new("guarded-root-swap");
        let root = workspace.path.join("project");
        fs::create_dir(&root).expect("create authorized root");
        fs::write(root.join("file.txt"), "original").expect("seed authorized file");
        let root = root.canonicalize().expect("canonical authorized root");
        let roots = authorized_roots(&root);
        let target = root.join("file.txt");
        let moved = workspace.path.join("project.old");

        let error =
            write_project_file_anchored_guarded(&target, &roots, b"must-not-commit", || {
                fs::rename(&root, &moved).expect("move authorized root during write");
                fs::create_dir(&root).expect("create same-path replacement root");
                fs::write(root.join("file.txt"), "replacement-root")
                    .expect("seed replacement sentinel");
                Ok(())
            })
            .expect_err("root replacement before commit must fail closed");

        assert!(error.contains("identity changed"), "{error}");
        assert_eq!(
            fs::read_to_string(moved.join("file.txt")).expect("read moved original"),
            "original"
        );
        assert_eq!(
            fs::read_to_string(root.join("file.txt")).expect("read replacement sentinel"),
            "replacement-root"
        );
        assert!(!fs::read_dir(&moved)
            .expect("list moved root")
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with(".offisim-write-")));
    }

    #[test]
    fn compare_and_swap_allows_only_one_concurrent_edit_for_a_version() {
        let workspace = TestDir::new("concurrent-cas");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let target = root.join("file.txt");
        fs::write(&target, "original").expect("seed original");
        let expected = read_project_file_anchored_bytes(&target, &authorized_roots(&root))
            .expect("read initial version")
            .version;
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));

        let run_edit = |content: &'static [u8]| {
            let root = root.clone();
            let target = target.clone();
            let expected = expected.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                write_project_file_anchored_bytes(
                    &target,
                    &authorized_roots(&root),
                    content,
                    Some(&expected),
                    None,
                )
            })
        };
        let first = run_edit(b"first");
        let second = run_edit(b"second");
        barrier.wait();
        let results = [
            first.join().expect("join first edit"),
            second.join().expect("join second edit"),
        ];

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, Err(ProjectFileMutationError::Conflict)))
                .count(),
            1
        );
        let final_content = fs::read(&target).expect("read CAS result");
        assert!(final_content == b"first" || final_content == b"second");
    }

    #[cfg(unix)]
    #[test]
    fn anchored_write_rejects_same_path_replacement_of_authorized_root() {
        let workspace = TestDir::new("anchored-root-swap-parent");
        let root = workspace.path.join("project");
        fs::create_dir(&root).expect("create authorized root");
        let root = root.canonicalize().expect("canonical authorized root");
        let authority = authorized_roots(&root);
        let moved = workspace.path.join("project.old");
        fs::rename(&root, &moved).expect("move authorized root");
        fs::create_dir(&root).expect("create replacement at same path");
        let target = root.join("forged.txt");

        let error = write_project_file_anchored(&target, &authority, b"must-not-write")
            .expect_err("same-path replacement must not inherit Project authority");

        assert!(error.contains("identity changed"), "{error}");
        assert!(!target.exists());
    }

    #[cfg(unix)]
    #[test]
    fn anchored_metadata_and_list_reject_same_path_replacement_of_authorized_root() {
        let workspace = TestDir::new("anchored-list-root-swap-parent");
        let root = workspace.path.join("project");
        fs::create_dir(&root).expect("create authorized root");
        fs::write(root.join("original.txt"), "original").expect("seed authorized root");
        let root = root.canonicalize().expect("canonical authorized root");
        let authority = authorized_roots(&root);
        let moved = workspace.path.join("project.old");
        fs::rename(&root, &moved).expect("move authorized root");
        fs::create_dir(&root).expect("create replacement at same path");
        fs::write(root.join("forged.txt"), "forged").expect("seed replacement root");

        let metadata_error = project_path_metadata_anchored(&root.join("forged.txt"), &authority)
            .expect_err("Files metadata must surface replacement authority loss");
        assert!(
            metadata_error.contains("identity changed"),
            "{metadata_error}"
        );
        let error = list_project_directory_anchored(&root, &authority, 300)
            .expect_err("Files list must reject a same-path replacement root");
        assert!(error.contains("identity changed"), "{error}");
        assert_eq!(
            fs::read_to_string(root.join("forged.txt")).expect("replacement remains untouched"),
            "forged"
        );
    }

    #[cfg(unix)]
    #[test]
    fn opened_directory_fd_keeps_listing_the_authorized_object_after_path_replacement() {
        let workspace = TestDir::new("anchored-open-list-root-swap-parent");
        let root = workspace.path.join("project");
        fs::create_dir(&root).expect("create authorized root");
        fs::write(root.join("original.txt"), "original").expect("seed authorized root");
        let root = root.canonicalize().expect("canonical authorized root");
        let authority = authorized_roots(&root);
        let normal = list_project_directory_anchored(&root, &authority, 300)
            .expect("normal descriptor-backed directory listing");
        assert!(normal.iter().any(|entry| entry.name == "original.txt"));
        let directory = open_project_directory_anchored(&root, &authority)
            .expect("open authorized directory descriptor");

        let moved = workspace.path.join("project.old");
        fs::rename(&root, &moved).expect("move authorized root after opening");
        fs::create_dir(&root).expect("create same-path replacement");
        fs::write(root.join("forged.txt"), "forged").expect("seed replacement root");

        let names =
            list_open_project_directory_anchored(&directory, &root, Path::new(""), &authority, 300)
                .expect("list opened directory descriptor")
                .into_iter()
                .map(|entry| entry.name)
                .collect::<Vec<_>>();
        assert!(names.iter().any(|name| name == "original.txt"));
        assert!(!names.iter().any(|name| name == "forged.txt"));
    }

    #[cfg(unix)]
    #[test]
    fn anchored_metadata_maps_missing_paths_to_none() {
        let workspace = TestDir::new("anchored-exists-missing");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        assert!(project_path_metadata_anchored(
            &root.join("missing/leaf.txt"),
            &authorized_roots(&root),
        )
        .expect("missing path is not an authority failure")
        .is_none());
    }

    #[cfg(unix)]
    #[test]
    fn anchored_write_rejects_swapped_parent_symlink_without_touching_outside() {
        let workspace = TestDir::new("anchored-symlink-workspace");
        let outside = TestDir::new("anchored-symlink-outside");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let target = root.join("swapped/child/file.txt");
        fs::create_dir(root.join("swapped")).expect("create initial parent");
        fs::remove_dir(root.join("swapped")).expect("remove initial parent");
        symlink_dir(&outside.path, &root.join("swapped"));

        let error =
            write_project_file_anchored(&target, &authorized_roots(&root), b"must-not-escape")
                .expect_err("swapped parent symlink must be rejected");

        assert!(error.contains("without following symlinks"), "{error}");
        assert!(!outside.path.join("child").exists());
        assert!(!outside.path.join("file.txt").exists());
    }

    #[cfg(unix)]
    #[test]
    fn anchored_write_replaces_hard_link_without_modifying_external_inode() {
        let workspace = TestDir::new("anchored-hardlink-workspace");
        let outside = TestDir::new("anchored-hardlink-outside");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let external = outside.path.join("sensitive.txt");
        fs::write(&external, "sensitive").expect("seed external file");
        let target = root.join("linked.txt");
        fs::hard_link(&external, &target).expect("link external inode into workspace");

        write_project_file_anchored(&target, &authorized_roots(&root), b"workspace")
            .expect("atomically replace workspace directory entry");

        assert_eq!(
            fs::read_to_string(&external).expect("read external file"),
            "sensitive"
        );
        assert_eq!(
            fs::read_to_string(&target).expect("read replaced target"),
            "workspace"
        );
    }

    #[cfg(unix)]
    #[test]
    fn anchored_write_preserves_existing_executable_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let workspace = TestDir::new("anchored-executable-workspace");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let target = root.join("verify.sh");
        fs::write(&target, "#!/bin/sh\nexit 1\n").expect("seed executable");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o755))
            .expect("mark fixture executable");

        write_project_file_anchored(&target, &authorized_roots(&root), b"#!/bin/sh\nexit 0\n")
            .expect("replace executable atomically");

        let mode = fs::metadata(&target)
            .expect("stat executable")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o755);
    }

    #[cfg(unix)]
    #[test]
    fn anchored_read_rejects_hard_link_to_external_inode() {
        let workspace = TestDir::new("read-hardlink-workspace");
        let outside = TestDir::new("read-hardlink-outside");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let external = outside.path.join("sensitive.txt");
        fs::write(&external, "sensitive").expect("seed external file");
        let target = root.join("linked.txt");
        fs::hard_link(&external, &target).expect("link external inode into workspace");

        let error = open_project_read_target_anchored(&target, &authorized_roots(&root))
            .expect_err("multi-link file must not be readable through workspace sandbox");

        assert!(error.contains("multiple hard links"), "{error}");
    }

    #[test]
    fn rejects_oversize_read_with_redacted_path() {
        let workspace = TestDir::new("oversize-read");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let file = root.join("large.txt");
        let err = ensure_read_size(MAX_READ_BYTES + 1, &file, &[root])
            .expect_err("oversize read must be rejected");

        assert!(err.contains("file too large to read in-process"));
        assert!(err.contains("large.txt"));
        assert!(!err.contains("/Users/"));
    }

    #[test]
    fn rejects_oversize_write_with_redacted_path() {
        let workspace = TestDir::new("oversize-write");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let file = root.join("large.txt");
        let err = ensure_write_size(MAX_WRITE_BYTES + 1, &file, &[root])
            .expect_err("oversize write must be rejected");

        assert!(err.contains("file too large to write in-process"));
        assert!(err.contains("large.txt"));
        assert!(!err.contains("/Users/"));
    }

    #[test]
    fn utf8_boundary_walk_back_drops_partial_codepoint() {
        // "héllo" — UTF-8: 0x68 0xC3 0xA9 0x6C 0x6C 0x6F (6 bytes total).
        // Truncating at 2 bytes (h + first byte of é) must walk back to 1 byte.
        let bytes = vec![0x68, 0xC3];
        let recovered = utf8_boundary_safe_string(bytes);
        assert_eq!(recovered, "h", "walk-back should drop partial é prefix");
    }

    #[test]
    fn utf8_boundary_walk_back_returns_empty_for_first_byte_partial() {
        // Just the leading byte of a multi-byte codepoint — no valid prefix.
        let bytes = vec![0xC3];
        let recovered = utf8_boundary_safe_string(bytes);
        assert_eq!(
            recovered, "",
            "walk-back must return empty when no valid bytes precede partial"
        );
    }

    #[test]
    fn utf8_boundary_passes_through_valid_utf8() {
        let bytes = "hello".as_bytes().to_vec();
        let recovered = utf8_boundary_safe_string(bytes);
        assert_eq!(recovered, "hello");
    }
}
