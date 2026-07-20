//! Shared secret-redaction scan mechanism for tool/shell/git output and the
//! shared base env-scrub allowlist.
//!
//! This module owns the ONE token-scan-and-redact loop plus the ONE base
//! environment allowlist. Each caller passes its exact policy as parameters so
//! the *mechanism* lives here while behavior stays per-caller:
//!
//! - `builtin_tools` shell output keeps its policy: no URL-credential
//!   redaction, no `secret` keyword.
//! - `git` output keeps its stricter policy: URL-credential redaction on +
//!   the extra `secret` keyword.
//!
//! Policies are NOT unified into a superset — `redact_secret_tokens` is given
//! `redact_url_creds` and `extra_keywords` explicitly so the strict and lenient
//! callers remain byte-for-byte identical to their previous in-file copies.

/// Minimal base allowlist of environment variables both the shell and git
/// scrubbers retain. Lane-specific additions such as Git's `SSH_AUTH_SOCK`
/// remain owned by each caller in `crate::env_scrub`.
pub(crate) const BASE_ENV_ALLOWLIST: &[&str] = &[
    "PATH", "HOME", "USER", "LANG", "TERM", "TMPDIR", "LC_ALL", "LC_CTYPE",
];

/// Collect the allowlisted environment variables that are currently set,
/// preserving the order of `allow`. Used by both the shell and git env
/// scrubbers (git passes an extended allowlist).
pub(crate) fn scrub_env_to_allowlist(allow: &[&str]) -> Vec<(String, String)> {
    allow
        .iter()
        .filter_map(|key| {
            std::env::var(key)
                .ok()
                .map(|value| ((*key).to_string(), value))
        })
        .collect()
}

/// Redact a URL embedded `user:pass@host` credential prefix in a single
/// whitespace-delimited token. Returns the token unchanged when no
/// scheme/`@`-before-path credential is present. Internal to the scan loop
/// below; enabled only when the caller passes `redact_url_creds: true`.
fn redact_url_credentials(token: &str) -> String {
    let Some(scheme_idx) = token.find("://") else {
        return token.to_string();
    };
    let credential_start = scheme_idx + 3;
    let Some(relative_at) = token[credential_start..].find('@') else {
        return token.to_string();
    };
    let at_idx = credential_start + relative_at;
    let first_path_idx = token[credential_start..]
        .find('/')
        .map(|idx| credential_start + idx)
        .unwrap_or(token.len());
    if at_idx > first_path_idx {
        return token.to_string();
    }
    format!(
        "{}[REDACTED]{}",
        &token[..credential_start],
        &token[at_idx..]
    )
}

/// Scan `text` token-by-token (split on inclusive whitespace) and replace any
/// secret-shaped bare token with `[REDACTED]`.
///
/// Policy is supplied by the caller, not unified here:
/// - `redact_url_creds`: when true, each token first has any embedded
///   `scheme://user:pass@host` credential redacted (git policy). When false the
///   token is scanned as-is (shell policy).
/// - `extra_keywords`: additional lowercase substrings (beyond the always-on
///   `api_key` / `token`) that mark a >=24-char bare token as secret. git passes
///   `["secret"]`; shell passes `&[]`.
///
/// The always-on detection — `bare.len() >= 24` AND (`sk-` prefix OR `offisim_`
/// prefix OR contains `api_key` OR contains `token`) — is identical to both
/// original in-file loops.
pub(crate) fn redact_secret_tokens(
    text: &str,
    redact_url_creds: bool,
    extra_keywords: &[&str],
) -> String {
    let mut redacted = String::new();
    for token in text.split_inclusive(char::is_whitespace) {
        // git scrubs URL credentials before the keyword scan; shell does not.
        let scanned = if redact_url_creds {
            redact_url_credentials(token)
        } else {
            token.to_string()
        };
        let bare =
            scanned.trim_matches(|ch: char| !ch.is_ascii_alphanumeric() && ch != '_' && ch != '-');
        let lower = bare.to_ascii_lowercase();
        let looks_secret = bare.len() >= 24
            && (bare.starts_with("sk-")
                || bare.starts_with("offisim_")
                || lower.contains("api_key")
                || lower.contains("token")
                || extra_keywords.iter().any(|keyword| lower.contains(keyword)));
        if looks_secret {
            redacted.push_str(scanned.replace(bare, "[REDACTED]").as_str());
        } else {
            redacted.push_str(&scanned);
        }
    }
    redacted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_allowlist_is_the_shared_eight() {
        assert_eq!(
            BASE_ENV_ALLOWLIST,
            &["PATH", "HOME", "USER", "LANG", "TERM", "TMPDIR", "LC_ALL", "LC_CTYPE"]
        );
    }

    #[test]
    fn shell_policy_matches_legacy_behavior() {
        // No url-cred redaction, no `secret` keyword.
        let out = redact_secret_tokens(
            "ok sk-test_abcdefghijklmnopqrstuvwxyz offisim_token_abcdefghijklmnopqrstuvwxyz",
            false,
            &[],
        );
        assert!(out.contains("[REDACTED]"));
        assert!(!out.contains("sk-test_abcdefghijklmnopqrstuvwxyz"));
        assert!(!out.contains("offisim_token_abcdefghijklmnopqrstuvwxyz"));
    }

    #[test]
    fn shell_policy_does_not_redact_secret_keyword_or_url_creds() {
        // A bare token whose only secret signal is the `secret` keyword must
        // pass through under the shell policy (extra_keywords empty).
        let out = redact_secret_tokens("my_secret_value_aaaaaaaaaaaaaaa", false, &[]);
        assert_eq!(out, "my_secret_value_aaaaaaaaaaaaaaa");
        // URL credentials are NOT redacted under shell policy.
        let url = "https://user:pass@github.com/acme/repo.git";
        assert_eq!(redact_secret_tokens(url, false, &[]), url);
    }

    #[test]
    fn git_policy_matches_legacy_behavior() {
        let out = redact_secret_tokens(
            "remote https://ghp_abcdefghijklmnopqrstuvwxyz123456@github.com/acme/repo.git\nsk-abcdefghijklmnopqrstuvwxyz123456\n",
            true,
            &["secret"],
        );
        assert!(!out.contains("ghp_abcdefghijklmnopqrstuvwxyz123456"));
        assert!(!out.contains("sk-abcdefghijklmnopqrstuvwxyz123456"));
        assert!(out.contains("https://[REDACTED]@github.com/acme/repo.git"));
    }
}
