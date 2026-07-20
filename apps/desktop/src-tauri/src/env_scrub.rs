//! Unified scrubbed child-process environment.
//!
//! Merges the common allowlist policy formerly duplicated by
//! `scrubbed_shell_env` (builtin_tools) and `scrubbed_git_env` (git). Callers
//! retain their lane-specific additions: Git opts into `SSH_AUTH_SOCK` for
//! ssh-agent-backed remotes, while ordinary shell execution keeps the minimal
//! base environment. Pinned variables such as `GIT_TERMINAL_PROMPT=0` also stay
//! at the Git call site.

use crate::redaction;

/// Scrub the process environment down to the shared base plus explicit
/// caller-owned additions.
pub fn scrubbed_child_env(extra_allowlist: &[&str]) -> Vec<(String, String)> {
    let mut allow = redaction::BASE_ENV_ALLOWLIST.to_vec();
    allow.extend_from_slice(extra_allowlist);
    redaction::scrub_env_to_allowlist(&allow)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrubbed_child_env_excludes_provider_secrets() {
        std::env::set_var("OPENAI_API_KEY", "sk-test-secret");
        std::env::set_var("ANTHROPIC_API_KEY", "sk-test-secret");
        let env = scrubbed_child_env(&[]);
        let keys = env.into_iter().map(|(key, _)| key).collect::<Vec<_>>();
        assert!(!keys.contains(&"OPENAI_API_KEY".to_string()));
        assert!(!keys.contains(&"ANTHROPIC_API_KEY".to_string()));
    }

    #[test]
    fn caller_owned_allowlist_additions_do_not_leak_into_the_base() {
        std::env::set_var("SSH_AUTH_SOCK", "/tmp/offisim-test-agent.sock");
        let base_keys = scrubbed_child_env(&[])
            .into_iter()
            .map(|(key, _)| key)
            .collect::<Vec<_>>();
        let git_keys = scrubbed_child_env(&["SSH_AUTH_SOCK"])
            .into_iter()
            .map(|(key, _)| key)
            .collect::<Vec<_>>();
        assert!(!base_keys.contains(&"SSH_AUTH_SOCK".to_string()));
        assert!(git_keys.contains(&"SSH_AUTH_SOCK".to_string()));
    }
}
