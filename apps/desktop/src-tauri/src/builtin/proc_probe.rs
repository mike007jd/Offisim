use super::*;

#[cfg(target_os = "macos")]
fn macos_process_ids() -> Result<Vec<i32>, String> {
    let initial_count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    if initial_count < 0 {
        return Err(format!(
            "List task Bash processes for lifetime cleanup: {}",
            std::io::Error::last_os_error()
        ));
    }
    let mut pids = vec![0_i32; initial_count as usize + 64];
    let buffer_bytes = pids
        .len()
        .checked_mul(std::mem::size_of::<i32>())
        .and_then(|bytes| i32::try_from(bytes).ok())
        .ok_or_else(|| "Task Bash process list exceeded the platform limit".to_string())?;
    let count =
        unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast::<libc::c_void>(), buffer_bytes) };
    if count < 0 {
        return Err(format!(
            "Read task Bash process list for lifetime cleanup: {}",
            std::io::Error::last_os_error()
        ));
    }
    pids.truncate(count as usize);
    pids.retain(|pid| *pid > 0 && *pid != std::process::id() as i32);
    Ok(pids)
}

#[cfg(target_os = "macos")]
#[repr(C)]
struct MacProcFileInfo {
    open_flags: u32,
    status: u32,
    offset: libc::off_t,
    file_type: i32,
    guard_flags: u32,
}

#[cfg(target_os = "macos")]
#[repr(C)]
struct MacVnodeFdInfoWithPath {
    file_info: MacProcFileInfo,
    vnode_path: libc::vnode_info_path,
}

#[cfg(target_os = "macos")]
fn lifetime_marker_fd_processes(path: &Path) -> Result<Vec<i32>, String> {
    use std::os::unix::fs::MetadataExt;

    let metadata = path
        .metadata()
        .map_err(|error| format!("Inspect task Bash lifetime marker: {error}"))?;
    let expected_device = metadata.dev();
    let expected_inode = metadata.ino();
    let info_size = std::mem::size_of::<MacVnodeFdInfoWithPath>();
    let info_size_i32 = i32::try_from(info_size)
        .map_err(|_| "Task Bash vnode info exceeded the platform limit".to_string())?;
    let mut matches = Vec::new();
    for pid in macos_process_ids()? {
        let mut info = std::mem::MaybeUninit::<MacVnodeFdInfoWithPath>::uninit();
        let read = unsafe {
            libc::proc_pidfdinfo(
                pid,
                SHELL_LIFETIME_MARKER_FD,
                2, // PROC_PIDFDVNODEPATHINFO
                info.as_mut_ptr().cast::<libc::c_void>(),
                info_size_i32,
            )
        };
        if read as usize != info_size {
            continue;
        }
        let stat = unsafe { info.assume_init() }.vnode_path.vip_vi.vi_stat;
        if u64::from(stat.vst_dev) == expected_device && stat.vst_ino == expected_inode {
            matches.push(pid);
        }
    }
    Ok(matches)
}

#[cfg(target_os = "linux")]
fn lifetime_marker_fd_processes(path: &Path) -> Result<Vec<i32>, String> {
    let mut processes = Vec::new();
    for entry in std::fs::read_dir("/proc")
        .map_err(|error| format!("List Linux processes for task Bash cleanup: {error}"))?
    {
        let Ok(entry) = entry else { continue };
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|value| value.parse::<i32>().ok())
        else {
            continue;
        };
        if pid == std::process::id() as i32 {
            continue;
        }
        let Ok(descriptors) = std::fs::read_dir(entry.path().join("fd")) else {
            continue;
        };
        if descriptors.filter_map(Result::ok).any(|descriptor| {
            std::fs::read_link(descriptor.path()).is_ok_and(|target| target == path)
        }) {
            processes.push(pid);
        }
    }
    Ok(processes)
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn lifetime_marker_fd_processes(path: &Path) -> Result<Vec<i32>, String> {
    let output = std::process::Command::new("lsof")
        .args(["-t", "--"])
        .arg(path)
        .env_clear()
        .output()
        .map_err(|error| format!("List task Bash lifetime holders: {error}"))?;
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<i32>().ok())
        .filter(|pid| *pid != std::process::id() as i32)
        .collect())
}

#[cfg(unix)]
fn lifetime_marker_environment_needle(path: &Path) -> Vec<u8> {
    use std::os::unix::ffi::OsStrExt;

    let mut needle = format!("{SHELL_LIFETIME_MARKER_ENV}=").into_bytes();
    needle.extend_from_slice(path.as_os_str().as_bytes());
    needle
}

#[cfg(target_os = "macos")]
fn lifetime_marker_environment_processes(path: &Path) -> Result<Vec<i32>, String> {
    let arg_max = unsafe { libc::sysconf(libc::_SC_ARG_MAX) };
    let buffer_capacity = usize::try_from(arg_max)
        .ok()
        .filter(|value| *value > 0)
        .unwrap_or(1024 * 1024)
        .min(4 * 1024 * 1024);
    let mut buffer = vec![0_u8; buffer_capacity];
    let needle = lifetime_marker_environment_needle(path);
    let mut matches = Vec::new();
    for pid in macos_process_ids()? {
        let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
        let mut size = buffer.len();
        let result = unsafe {
            libc::sysctl(
                mib.as_mut_ptr(),
                mib.len() as u32,
                buffer.as_mut_ptr().cast::<libc::c_void>(),
                &mut size,
                std::ptr::null_mut(),
                0,
            )
        };
        if result == 0
            && size >= needle.len()
            && buffer[..size]
                .windows(needle.len())
                .any(|candidate| candidate == needle)
        {
            matches.push(pid);
        }
    }
    Ok(matches)
}

#[cfg(target_os = "linux")]
fn lifetime_marker_environment_processes(path: &Path) -> Result<Vec<i32>, String> {
    let needle = lifetime_marker_environment_needle(path);
    let current_pid = std::process::id() as i32;
    let mut matches = Vec::new();
    for entry in std::fs::read_dir("/proc")
        .map_err(|error| format!("List Linux processes for task Bash cleanup: {error}"))?
    {
        let Ok(entry) = entry else { continue };
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|value| value.parse::<i32>().ok())
        else {
            continue;
        };
        if pid <= 0 || pid == current_pid {
            continue;
        }
        let Ok(environment) = std::fs::read(entry.path().join("environ")) else {
            continue;
        };
        if environment
            .windows(needle.len())
            .any(|candidate| candidate == needle)
        {
            matches.push(pid);
        }
    }
    Ok(matches)
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn lifetime_marker_environment_processes(_path: &Path) -> Result<Vec<i32>, String> {
    Ok(Vec::new())
}

#[cfg(unix)]
pub(super) fn lifetime_marker_processes(path: &Path) -> Result<Vec<i32>, String> {
    let mut processes = lifetime_marker_fd_processes(path)?;
    processes.extend(lifetime_marker_environment_processes(path)?);
    processes.sort_unstable();
    processes.dedup();
    Ok(processes)
}
