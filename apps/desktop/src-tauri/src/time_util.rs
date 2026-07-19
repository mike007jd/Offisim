//! Shared time and stable-hash primitives.
//!
//! Single source of truth for the civil-date math, unix-millisecond clock
//! reads, and RFC 3339 formatting previously copy-pasted into `preview.rs`,
//! `git.rs`, `codex_agent_host/manager.rs`, `browser_session.rs`,
//! `startup_safety.rs`, `app_update.rs`, and `task_workspace_binding.rs`.
//! Callers adapt the canonical `i64` millisecond clock to their local width
//! and error type; error-message text stays at the call site.

use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

/// Howard Hinnant civil-from-days algorithm (canonical copy: `preview.rs`).
/// Converts days since the unix epoch to a proleptic Gregorian (year, month,
/// day).
pub fn civil_from_days(days_since_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    (year as i32, month as u32, day as u32)
}

/// Milliseconds since the unix epoch, or an error when the system clock is
/// unreadable/out of range. Callers wrap the error into their own type.
pub fn try_now_unix_ms() -> Result<i64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("Read system clock: {err}"))?
        .as_millis();
    i64::try_from(millis).map_err(|_| "System clock is out of range.".to_string())
}

/// Canonical clock read: milliseconds since the unix epoch as `i64`, falling
/// back to 0 when the clock is unreadable (pre-epoch). Callers needing another
/// width convert at the call site.
pub fn now_unix_ms() -> i64 {
    try_now_unix_ms().unwrap_or(0)
}

/// Format unix seconds as a second-precision RFC 3339 UTC timestamp
/// (canonical copy: `codex_agent_host/manager.rs`).
pub fn rfc3339_from_unix(seconds: i64) -> String {
    let days = seconds.div_euclid(86_400);
    let second_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = second_of_day / 3_600;
    let minute = (second_of_day % 3_600) / 60;
    let second = second_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Stable hex-encoded SHA-256 of a seed string (canonical copy:
/// `codex_agent_host/manager.rs`).
pub fn stable_hex(seed: &str) -> String {
    hex::encode(Sha256::digest(seed.as_bytes()))
}
