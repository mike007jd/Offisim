use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncReadExt};

const MAX_STDERR_CHARS: usize = 1600;
pub const MAX_SIDECAR_OUTPUT_BYTES: usize = 1024 * 1024;
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

/// Read one newline-delimited frame without ever allocating past `max_bytes`.
/// An oversized frame is a protocol error; callers terminate the offending
/// sidecar instead of pretending a truncated JSON frame was valid.
pub async fn read_capped_line<R>(
    reader: &mut R,
    max_bytes: usize,
) -> std::io::Result<Option<Vec<u8>>>
where
    R: AsyncBufRead + Unpin,
{
    let mut line = Vec::with_capacity(max_bytes.min(8192));
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return Ok((!line.is_empty()).then_some(line));
        }
        let end = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        if line.len().saturating_add(end) > max_bytes {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("sidecar output line exceeded {max_bytes} byte limit"),
            ));
        }
        line.extend_from_slice(&available[..end]);
        reader.consume(end);
        if line.last() == Some(&b'\n') {
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            return Ok(Some(line));
        }
    }
}

/// Retain at most `max_bytes` and return immediately when the stream exceeds the
/// limit. The caller must terminate the sidecar; continuing would let a runaway
/// stderr producer consume CPU indefinitely even though memory is bounded.
pub async fn read_capped_to_end<R>(
    reader: &mut R,
    max_bytes: usize,
) -> std::io::Result<(Vec<u8>, bool)>
where
    R: AsyncRead + Unpin,
{
    let mut kept = Vec::with_capacity(max_bytes.min(8192));
    let mut chunk = [0_u8; 8192];
    let mut truncated = false;
    loop {
        let read = reader.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        let room = max_bytes.saturating_sub(kept.len());
        kept.extend_from_slice(&chunk[..read.min(room)]);
        truncated = read > room;
        if truncated {
            break;
        }
    }
    Ok((kept, truncated))
}

fn is_sensitive_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    SENSITIVE_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::BufReader;

    #[tokio::test]
    async fn capped_line_rejects_oversized_frame_without_growing_past_limit() {
        let input = vec![b'x'; MAX_SIDECAR_OUTPUT_BYTES + 1];
        let mut reader = BufReader::new(input.as_slice());
        let err = read_capped_line(&mut reader, MAX_SIDECAR_OUTPUT_BYTES)
            .await
            .unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
        assert!(err.to_string().contains("exceeded"));
    }

    #[tokio::test]
    async fn capped_stream_marks_truncation_and_retains_only_the_limit() {
        let input = vec![b'e'; MAX_SIDECAR_OUTPUT_BYTES + 4096];
        let mut reader = input.as_slice();
        let (kept, truncated) = read_capped_to_end(&mut reader, MAX_SIDECAR_OUTPUT_BYTES)
            .await
            .unwrap();
        assert!(truncated);
        assert_eq!(kept.len(), MAX_SIDECAR_OUTPUT_BYTES);
    }
}
