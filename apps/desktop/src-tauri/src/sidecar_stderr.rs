const MAX_STDERR_CHARS: usize = 1600;
const SENSITIVE_MARKERS: &[&str] = &[
    "api_key",
    "apikey",
    "authorization",
    "bearer ",
    "token",
    "secret",
    "password",
    "credential",
    "cookie",
    "session",
    "openai_api_key",
    "anthropic_api_key",
];

pub fn sanitized_stderr(stderr_bytes: &[u8]) -> Option<String> {
    let raw = String::from_utf8_lossy(stderr_bytes);
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut output = String::new();
    for line in trimmed.lines() {
        let rendered = if is_sensitive_line(line) {
            "[redacted sensitive stderr line]"
        } else {
            line.trim()
        };
        if output.chars().count() + rendered.chars().count() + 1 > MAX_STDERR_CHARS {
            if !output.is_empty() {
                output.push('\n');
            }
            output.push_str("[stderr truncated]");
            break;
        }
        if !output.is_empty() {
            output.push('\n');
        }
        output.push_str(rendered);
    }

    Some(output)
}

fn is_sensitive_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    SENSITIVE_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
}
