use std::net::TcpListener;
use std::process::Command;

/// Find listener PIDs for a TCP port using `lsof`.
fn listener_pids(port: u16) -> std::io::Result<Vec<u32>> {
    let output = Command::new("lsof")
        .args(["-tiTCP", &port.to_string(), "-sTCP:LISTEN"])
        .output()?;

    if !output.status.success() && output.stdout.is_empty() {
        return Ok(Vec::new());
    }

    Ok(parse_lsof_pids(&String::from_utf8_lossy(&output.stdout)))
}

fn parse_lsof_pids(output: &str) -> Vec<u32> {
    output
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .collect()
}

/// Check if a TCP port is available (not in use) on both IPv4 and IPv6.
/// Hono/Node.js defaults to `:::port` (IPv6 dual-stack), so we must check both.
pub fn is_port_available(port: u16) -> bool {
    let ipv4_free = TcpListener::bind(("127.0.0.1", port)).is_ok();
    let ipv6_free = TcpListener::bind(("::1", port)).is_ok();
    ipv4_free && ipv6_free
}

/// Check if a TCP port is currently in use on localhost (either IPv4 or IPv6).
pub fn is_port_in_use(port: u16) -> bool {
    !is_port_available(port)
}

/// Terminate all processes listening on a TCP port.
pub fn terminate_listeners_on_port(port: u16) -> std::io::Result<Vec<u32>> {
    let pids = listener_pids(port)?;

    for pid in &pids {
        #[cfg(unix)]
        unsafe {
            libc::kill(*pid as i32, libc::SIGTERM);
        }
    }

    Ok(pids)
}
