use std::net::TcpListener;

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
