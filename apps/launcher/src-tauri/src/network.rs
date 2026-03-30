/// Returns the first non-loopback IPv4 address found on this machine,
/// suitable for displaying as a LAN access address.
pub fn get_lan_address() -> Option<String> {
    local_ip_address::local_ip().ok().map(|ip| ip.to_string())
}
