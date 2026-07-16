pub(crate) mod commands;
mod manager;
mod protocol;
mod stream;
mod types;

pub(crate) const CODEX_HOST_PROTOCOL_VERSION: u64 = 2;

#[allow(unused_imports)]
pub(crate) use manager::{status_impl, CodexAgentHostState};
pub(crate) use types::CodexAgentStatusResponse;

pub(crate) fn checked_at_now() -> Result<String, String> {
    manager::rfc3339_now()
}
