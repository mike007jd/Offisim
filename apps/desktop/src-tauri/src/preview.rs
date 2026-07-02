use serde::Serialize;
use std::cmp;
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::http::{header, Response, StatusCode};
use tauri::Runtime;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::builtin_tools::{
    ensure_inside_workspace, fs_op_error, fs_resolve_error, relativize_for_error,
    resolve_project_candidate, utf8_boundary_safe_string, workspace_roots,
};

pub const MAX_PREVIEW_TEXT_BYTES: u64 = 262_144;
pub const MAX_PREVIEW_BINARY_BYTES: u64 = 33_554_432;
const MIME_SNIFF_BYTES: u64 = 8 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPreviewMeta {
    pub file_name: String,
    pub mime_type: Option<String>,
    pub extension: Option<String>,
    pub byte_length: u64,
    pub modified_at: Option<String>,
    pub text: Option<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MediaPlan {
    pub status: StatusCode,
    pub start: u64,
    pub end: u64,
    pub content_length: u64,
    pub content_range: Option<String>,
}

async fn resolve_preview_path<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: &str,
    project_id: Option<&str>,
) -> Result<(PathBuf, Vec<PathBuf>), String> {
    let roots = workspace_roots(app, project_id).await?;
    let canonical = resolve_preview_path_for_roots(path, &roots)?;
    Ok((canonical, roots))
}

fn resolve_preview_path_for_roots(path: &str, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let candidate = resolve_project_candidate(path, None, roots)?;
    let canonical = candidate
        .canonicalize()
        .map_err(|err| fs_resolve_error("resolve project preview file", &candidate, err))?;
    ensure_inside_workspace(&canonical, roots)?;
    Ok(canonical)
}

fn extension_for_path(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.trim_start_matches('.').to_ascii_lowercase())
        .filter(|value| !value.is_empty())
}

fn system_time_to_rfc3339(value: SystemTime) -> Option<String> {
    let duration = value.duration_since(UNIX_EPOCH).ok()?;
    let secs = duration.as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let seconds_of_day = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    Some(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z"
    ))
}

fn civil_from_days(days_since_epoch: i64) -> (i32, u32, u32) {
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

fn sniff_mime(bytes: &[u8]) -> Option<String> {
    infer::get(bytes).map(|kind| kind.mime_type().to_string())
}

fn is_text_like_mime(mime_type: &str) -> bool {
    let mime = mime_type.to_ascii_lowercase();
    mime.starts_with("text/")
        || mime.ends_with("+json")
        || mime.ends_with("+xml")
        || matches!(
            mime.as_str(),
            "application/json"
                | "application/ld+json"
                | "application/xml"
                | "application/javascript"
                | "application/x-javascript"
                | "application/yaml"
                | "application/x-yaml"
                | "application/toml"
                | "application/x-toml"
                | "application/csv"
        )
}

fn replacement_ratio_is_text(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return true;
    }
    let text = String::from_utf8_lossy(bytes);
    let replacements = text.chars().filter(|ch| *ch == '\u{FFFD}').count();
    replacements == 0 || replacements.saturating_mul(100) < bytes.len()
}

fn text_from_bytes(bytes: &[u8], mime_type: Option<&str>) -> Option<String> {
    match mime_type {
        Some(mime) if is_text_like_mime(mime) => Some(utf8_boundary_safe_string(bytes.to_vec())),
        Some(_) => None,
        None if replacement_ratio_is_text(bytes) => {
            Some(String::from_utf8_lossy(bytes).into_owned())
        }
        None => None,
    }
}

async fn preview_meta_for_path(
    canonical: &Path,
    roots: &[PathBuf],
) -> Result<ProjectPreviewMeta, String> {
    let file = tokio::fs::File::open(canonical)
        .await
        .map_err(|err| fs_op_error("open project preview file", canonical, roots, err))?;
    let metadata = file
        .metadata()
        .await
        .map_err(|err| fs_op_error("stat project preview file", canonical, roots, err))?;
    let byte_length = metadata.len();
    let read_bytes = byte_length.min(MAX_PREVIEW_TEXT_BYTES);
    let mut reader = file.take(read_bytes);
    let mut buffer = Vec::with_capacity(read_bytes as usize);
    reader
        .read_to_end(&mut buffer)
        .await
        .map_err(|err| fs_op_error("read project preview file", canonical, roots, err))?;

    let sniff_len = cmp::min(buffer.len(), MIME_SNIFF_BYTES as usize);
    let mime_type = sniff_mime(&buffer[..sniff_len]);
    let text = text_from_bytes(&buffer, mime_type.as_deref());
    let truncated = text.is_some() && byte_length > MAX_PREVIEW_TEXT_BYTES;
    Ok(ProjectPreviewMeta {
        file_name: canonical
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
            .to_string(),
        mime_type,
        extension: extension_for_path(canonical),
        byte_length,
        modified_at: metadata.modified().ok().and_then(system_time_to_rfc3339),
        text,
        truncated,
    })
}

#[tauri::command]
pub async fn project_preview_meta<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    project_id: Option<String>,
) -> Result<ProjectPreviewMeta, String> {
    let (canonical, roots) = resolve_preview_path(&app, &path, project_id.as_deref()).await?;
    preview_meta_for_path(&canonical, &roots).await
}

pub(crate) async fn read_bounded_bytes(
    canonical: &Path,
    roots: &[PathBuf],
    max_bytes: u64,
) -> Result<Vec<u8>, String> {
    let file = tokio::fs::File::open(canonical)
        .await
        .map_err(|err| fs_op_error("open project binary preview file", canonical, roots, err))?;
    let total_size = file
        .metadata()
        .await
        .map_err(|err| fs_op_error("stat project binary preview file", canonical, roots, err))?
        .len();
    let read_bytes = total_size.min(max_bytes.min(MAX_PREVIEW_BINARY_BYTES));
    let mut reader = file.take(read_bytes);
    let mut buffer = Vec::with_capacity(read_bytes as usize);
    reader
        .read_to_end(&mut buffer)
        .await
        .map_err(|err| fs_op_error("read project binary preview file", canonical, roots, err))?;
    Ok(buffer)
}

#[tauri::command]
pub async fn project_read_file_bytes<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    project_id: Option<String>,
    max_bytes: Option<u32>,
) -> Result<tauri::ipc::Response, String> {
    let (canonical, roots) = resolve_preview_path(&app, &path, project_id.as_deref()).await?;
    let budget = max_bytes.map(u64::from).unwrap_or(MAX_PREVIEW_BINARY_BYTES);
    Ok(tauri::ipc::Response::new(
        read_bounded_bytes(&canonical, &roots, budget).await?,
    ))
}

fn parse_range_header(value: &str, file_len: u64) -> Result<(u64, u64), String> {
    let range = value
        .trim()
        .strip_prefix("bytes=")
        .ok_or_else(|| "unsupported range unit".to_string())?;
    let (raw_start, raw_end) = range
        .split_once('-')
        .ok_or_else(|| "invalid range shape".to_string())?;
    if file_len == 0 {
        return Err("range not satisfiable for empty file".to_string());
    }
    if raw_start.trim().is_empty() {
        let suffix_len = raw_end
            .trim()
            .parse::<u64>()
            .map_err(|_| "invalid suffix range".to_string())?;
        if suffix_len == 0 {
            return Err("empty suffix range".to_string());
        }
        let start = file_len.saturating_sub(suffix_len);
        return Ok((start, file_len - 1));
    }
    let start = raw_start
        .trim()
        .parse::<u64>()
        .map_err(|_| "invalid range start".to_string())?;
    if start >= file_len {
        return Err("range start is beyond file length".to_string());
    }
    let end = if raw_end.trim().is_empty() {
        file_len - 1
    } else {
        raw_end
            .trim()
            .parse::<u64>()
            .map_err(|_| "invalid range end".to_string())?
            .min(file_len - 1)
    };
    if end < start {
        return Err("range end is before range start".to_string());
    }
    Ok((start, end))
}

pub(crate) fn plan_media_response(
    file_len: u64,
    range_header: Option<&str>,
) -> Result<MediaPlan, String> {
    if let Some(range) = range_header.filter(|value| !value.trim().is_empty()) {
        let (start, end) = parse_range_header(range, file_len)?;
        let content_length = end - start + 1;
        return Ok(MediaPlan {
            status: StatusCode::PARTIAL_CONTENT,
            start,
            end,
            content_length,
            content_range: Some(format!("bytes {start}-{end}/{file_len}")),
        });
    }
    let end = file_len.saturating_sub(1);
    Ok(MediaPlan {
        status: StatusCode::OK,
        start: 0,
        end,
        content_length: file_len,
        content_range: None,
    })
}

fn query_param(uri: &tauri::http::Uri, name: &str) -> Option<String> {
    uri.query().and_then(|query| {
        url::form_urlencoded::parse(query.as_bytes()).find_map(|(key, value)| {
            if key == name {
                Some(value.into_owned())
            } else {
                None
            }
        })
    })
}

fn text_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

async fn sniff_mime_for_file(path: &Path) -> Option<String> {
    let mut file = tokio::fs::File::open(path).await.ok()?;
    let mut buffer = vec![0; MIME_SNIFF_BYTES as usize];
    let bytes = file.read(&mut buffer).await.ok()?;
    buffer.truncate(bytes);
    sniff_mime(&buffer)
}

async fn media_response_for_request<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: tauri::http::Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let Some(path) = query_param(request.uri(), "path") else {
        return text_response(StatusCode::BAD_REQUEST, "missing path query parameter");
    };
    let project_id = query_param(request.uri(), "projectId");
    let range_header = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let (canonical, roots) = match resolve_preview_path(&app, &path, project_id.as_deref()).await {
        Ok(value) => value,
        Err(err) if err.contains("outside bound project workspaces") => {
            return text_response(StatusCode::FORBIDDEN, &err);
        }
        Err(err) => return text_response(StatusCode::NOT_FOUND, &err),
    };
    let metadata = match tokio::fs::metadata(&canonical).await {
        Ok(value) => value,
        Err(err) => {
            return text_response(
                StatusCode::NOT_FOUND,
                &fs_op_error("stat project media file", &canonical, &roots, err),
            );
        }
    };
    let plan = match plan_media_response(metadata.len(), range_header.as_deref()) {
        Ok(value) => value,
        Err(err) => return text_response(StatusCode::RANGE_NOT_SATISFIABLE, &err),
    };

    let mut file = match tokio::fs::File::open(&canonical).await {
        Ok(value) => value,
        Err(err) => {
            return text_response(
                StatusCode::NOT_FOUND,
                &fs_op_error("open project media file", &canonical, &roots, err),
            );
        }
    };
    if let Err(err) = file.seek(SeekFrom::Start(plan.start)).await {
        return text_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &fs_op_error("seek project media file", &canonical, &roots, err),
        );
    }
    let mut reader = file.take(plan.content_length);
    let mut body = Vec::with_capacity(plan.content_length as usize);
    if let Err(err) = reader.read_to_end(&mut body).await {
        return text_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &fs_op_error("read project media file", &canonical, &roots, err),
        );
    }

    let mut builder = Response::builder()
        .status(plan.status)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, body.len().to_string());
    if let Some(mime) = sniff_mime_for_file(&canonical).await {
        builder = builder.header(header::CONTENT_TYPE, mime);
    }
    if let Some(content_range) = plan.content_range {
        builder = builder.header(header::CONTENT_RANGE, content_range);
    }
    builder.body(body).unwrap_or_else(|_| {
        text_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!(
                "build media response failed: {}",
                relativize_for_error(&canonical, &roots)
            ),
        )
    })
}

pub fn serve_media<R: Runtime>(
    app: tauri::AppHandle<R>,
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    tauri::async_runtime::spawn(async move {
        let response = media_response_for_request(app, request).await;
        responder.respond(response);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "offisim-preview-{label}-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[tokio::test]
    async fn meta_reports_mime_for_png_magic_bytes() {
        let workspace = TestDir::new("png");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let file = root.join("image.png");
        fs::write(
            &file,
            [
                0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1A, b'\n', 0, 0, 0, 0,
            ],
        )
        .expect("write png");

        let meta = preview_meta_for_path(&file, std::slice::from_ref(&root))
            .await
            .expect("preview meta");

        assert_eq!(meta.mime_type.as_deref(), Some("image/png"));
        assert_eq!(meta.extension.as_deref(), Some("png"));
        assert!(meta.text.is_none());
    }

    #[tokio::test]
    async fn meta_returns_text_for_utf8_source() {
        let workspace = TestDir::new("text");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let file = root.join("main.rs");
        fs::write(&file, "fn main() {}\n").expect("write text");

        let meta = preview_meta_for_path(&file, std::slice::from_ref(&root))
            .await
            .expect("preview meta");

        assert_eq!(meta.file_name, "main.rs");
        assert_eq!(meta.text.as_deref(), Some("fn main() {}\n"));
        assert!(!meta.truncated);
    }

    #[tokio::test]
    async fn meta_truncates_text_at_budget() {
        let workspace = TestDir::new("truncate");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let file = root.join("large.txt");
        fs::write(&file, vec![b'a'; MAX_PREVIEW_TEXT_BYTES as usize + 10]).expect("write text");

        let meta = preview_meta_for_path(&file, std::slice::from_ref(&root))
            .await
            .expect("preview meta");

        assert_eq!(
            meta.text.as_ref().map(String::len),
            Some(MAX_PREVIEW_TEXT_BYTES as usize)
        );
        assert!(meta.truncated);
    }

    #[test]
    fn meta_rejects_out_of_workspace_path() {
        let workspace = TestDir::new("workspace");
        let outside = TestDir::new("outside");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let outside_file = outside.path.join("secret.txt");
        fs::write(&outside_file, "secret").expect("write outside");

        let err = resolve_preview_path_for_roots(
            &outside_file.to_string_lossy(),
            std::slice::from_ref(&root),
        )
        .expect_err("outside file must fail");

        assert!(err.contains("outside bound project workspaces"));
    }

    #[tokio::test]
    async fn bytes_clamps_to_binary_budget() {
        let workspace = TestDir::new("bytes");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let file = root.join("blob.bin");
        fs::write(&file, [1, 2, 3, 4, 5]).expect("write bytes");

        let bytes = read_bounded_bytes(&file, std::slice::from_ref(&root), 3)
            .await
            .expect("read bytes");

        assert_eq!(bytes, vec![1, 2, 3]);
    }

    #[test]
    fn bytes_rejects_out_of_workspace_path() {
        let workspace = TestDir::new("workspace");
        let outside = TestDir::new("outside");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let outside_file = outside.path.join("blob.bin");
        fs::write(&outside_file, [1, 2, 3]).expect("write outside");

        let err = resolve_preview_path_for_roots(
            &outside_file.to_string_lossy(),
            std::slice::from_ref(&root),
        )
        .expect_err("outside file must fail");

        assert!(err.contains("outside bound project workspaces"));
    }

    #[test]
    fn range_parses_and_clamps() {
        let plan = plan_media_response(100, Some("bytes=10-500")).expect("range plan");

        assert_eq!(plan.status, StatusCode::PARTIAL_CONTENT);
        assert_eq!(plan.start, 10);
        assert_eq!(plan.end, 99);
        assert_eq!(plan.content_length, 90);
        assert_eq!(plan.content_range.as_deref(), Some("bytes 10-99/100"));
    }

    #[test]
    fn range_serves_full_when_absent() {
        let plan = plan_media_response(12, None).expect("range plan");

        assert_eq!(plan.status, StatusCode::OK);
        assert_eq!(plan.start, 0);
        assert_eq!(plan.end, 11);
        assert_eq!(plan.content_length, 12);
        assert!(plan.content_range.is_none());
    }

    #[test]
    fn media_rejects_out_of_workspace() {
        let workspace = TestDir::new("workspace");
        let outside = TestDir::new("outside");
        let root = workspace.path.canonicalize().expect("canonical workspace");
        let outside_file = outside.path.join("movie.mp4");
        fs::write(&outside_file, [1, 2, 3]).expect("write outside");

        let err = resolve_preview_path_for_roots(
            &outside_file.to_string_lossy(),
            std::slice::from_ref(&root),
        )
        .expect_err("outside media file must fail");

        assert!(err.contains("outside bound project workspaces"));
    }
}
