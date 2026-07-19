//! Unified scrubbed child-process environment.
//!
//! Merges the former `scrubbed_shell_env` (builtin_tools) and the allowlist
//! half of `scrubbed_git_env` (git) into one policy. Per the structural
//! refactor contract, allowlist merging takes the UNION of both lanes: the
//! shared minimal base plus `SSH_AUTH_SOCK` (previously git-only, for
//! ssh-agent-backed remotes). Lane-specific pinned variables (such as git's
//! `GIT_TERMINAL_PROMPT=0`) stay at the call site.

use crate::redaction;

/// Scrub the process environment down to the union allowlist.
pub fn scrubbed_child_env() -> Vec<(String, String)> {
    let mut allow = redaction::BASE_ENV_ALLOWLIST.to_vec();
    allow.push("SSH_AUTH_SOCK");
    redaction::scrub_env_to_allowlist(&allow)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrubbed_child_env_excludes_provider_secrets() {
        std::env::set_var("OPENAI_API_KEY", "sk-test-secret");
        std::env::set_var("ANTHROPIC_API_KEY", "sk-test-secret");
        let env = scrubbed_child_env();
        let keys = env.into_iter().map(|(key, _)| key).collect::<Vec<_>>();
        assert!(!keys.contains(&"OPENAI_API_KEY".to_string()));
        assert!(!keys.contains(&"ANTHROPIC_API_KEY".to_string()));
    }
}
