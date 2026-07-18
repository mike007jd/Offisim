use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Output,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Runtime;
use tokio::process::Command;

const REPOSITORY: &str = "mike007jd/Offisim";
const EXPECTED_TEAM_ID: &str = "9MP925J67C";
const EXPECTED_AUTHORITY: &str = "Developer ID Application: Haosheng Li (9MP925J67C)";
const APPLICATION_PATH: &str = "/Applications/Offisim.app";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateStatus {
    status: &'static str,
    current_version: String,
    latest_version: Option<String>,
    release_name: Option<String>,
    release_tag: Option<String>,
    published_at: Option<String>,
    message: String,
    gh_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhRelease {
    tag_name: String,
    name: String,
    published_at: Option<String>,
    is_draft: bool,
    is_prerelease: bool,
    assets: Vec<GhAsset>,
}

#[derive(Debug, Deserialize)]
struct GhAsset {
    name: String,
    size: u64,
}

struct ReleaseCandidate {
    release: GhRelease,
    version: Version,
    version_text: String,
    archive_name: String,
    checksum_name: String,
}

#[tauri::command]
pub async fn app_update_check<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<AppUpdateStatus, String> {
    let current = app.package_info().version.to_string();
    let Some(gh) = locate_gh() else {
        return Ok(status(
            "gh-missing",
            &current,
            "GitHub CLI is not installed. Install it from cli.github.com, then sign in with `gh auth login`.",
            None,
            None,
        ));
    };
    if !gh_authenticated(&gh).await {
        return Ok(status(
            "gh-auth-required",
            &current,
            "GitHub CLI is installed but not signed in. Run `gh auth login` in Terminal; Offisim never reads or stores the token.",
            Some(&gh),
            None,
        ));
    }
    let candidate = match release_candidate(&gh).await {
        Ok(candidate) => candidate,
        Err(error) => {
            return Ok(status("unavailable", &current, &error, Some(&gh), None));
        }
    };
    let current_version = Version::parse(&current)
        .map_err(|error| format!("Current app version is invalid: {error}"))?;
    let state = if candidate.version > current_version {
        "available"
    } else {
        "current"
    };
    Ok(status(
        state,
        &current,
        if state == "available" {
            "A signed Offisim update is ready to install."
        } else {
            "Offisim is up to date."
        },
        Some(&gh),
        Some(&candidate),
    ))
}

#[tauri::command]
pub async fn app_update_install<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let gh = locate_gh().ok_or_else(|| {
        "GitHub CLI is not installed. Install it from https://cli.github.com/ and run `gh auth login`."
            .to_string()
    })?;
    if !gh_authenticated(&gh).await {
        return Err("GitHub CLI is not signed in. Run `gh auth login` in Terminal.".into());
    }
    let candidate = release_candidate(&gh).await?;
    let current = Version::parse(&app.package_info().version.to_string())
        .map_err(|error| format!("Current app version is invalid: {error}"))?;
    if candidate.version <= current {
        return Err("No newer Offisim release is available.".into());
    }
    assert_running_from_applications()?;

    let scratch = std::env::temp_dir().join(format!(
        "offisim-update-{}-{}",
        std::process::id(),
        now_unix_ms()
    ));
    fs::create_dir(&scratch).map_err(|error| format!("Create update staging: {error}"))?;
    let result = download_verify_and_install(&gh, &candidate, &scratch).await;
    let _ = fs::remove_dir_all(&scratch);
    result?;
    app.restart();
}

fn status(
    state: &'static str,
    current: &str,
    message: &str,
    gh: Option<&Path>,
    candidate: Option<&ReleaseCandidate>,
) -> AppUpdateStatus {
    AppUpdateStatus {
        status: state,
        current_version: current.to_string(),
        latest_version: candidate.map(|value| value.version_text.clone()),
        release_name: candidate.map(|value| value.release.name.clone()),
        release_tag: candidate.map(|value| value.release.tag_name.clone()),
        published_at: candidate.and_then(|value| value.release.published_at.clone()),
        message: message.to_string(),
        gh_path: gh.map(|path| path.to_string_lossy().to_string()),
    }
}

fn locate_gh() -> Option<PathBuf> {
    [
        "/opt/homebrew/bin/gh",
        "/usr/local/bin/gh",
        "/usr/bin/gh",
        "/opt/local/bin/gh",
    ]
    .into_iter()
    .map(PathBuf::from)
    .find(|path| path.is_file())
}

async fn gh_authenticated(gh: &Path) -> bool {
    run_gh(
        gh,
        &["auth", "status", "--active", "--hostname", "github.com"],
    )
    .await
    .is_ok_and(|output| output.status.success())
}

async fn release_candidate(gh: &Path) -> Result<ReleaseCandidate, String> {
    let mut args = vec!["release", "view"];
    let test_tag = std::env::var("OFFISIM_UPDATE_TEST_TAG")
        .ok()
        .filter(|tag| !tag.trim().is_empty());
    if let Some(tag) = test_tag.as_deref() {
        args.push(tag);
    }
    args.extend([
        "--repo",
        REPOSITORY,
        "--json",
        "tagName,name,publishedAt,isDraft,isPrerelease,assets",
    ]);
    let output = run_gh(gh, &args).await?;
    if !output.status.success() {
        return Err(
            "Could not read the latest private GitHub release with the active gh login.".into(),
        );
    }
    let release: GhRelease = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("GitHub CLI returned invalid release metadata: {error}"))?;
    if test_tag.is_none() && (release.is_draft || release.is_prerelease) {
        return Err("The latest release is not a stable published release.".into());
    }

    let arch = release_arch();
    let prefix = "Offisim_";
    let suffix = format!("_{arch}.app.zip");
    let archive = release
        .assets
        .iter()
        .find(|asset| asset.name.starts_with(prefix) && asset.name.ends_with(&suffix))
        .ok_or_else(|| {
            format!(
                "Release {} has no Offisim macOS update asset.",
                release.tag_name
            )
        })?;
    if archive.size == 0 {
        return Err("The release update archive is empty.".into());
    }
    let version_text = archive
        .name
        .strip_prefix(prefix)
        .and_then(|value| value.strip_suffix(&suffix))
        .ok_or_else(|| "The release update asset name is invalid.".to_string())?
        .to_string();
    let version = Version::parse(&version_text)
        .map_err(|error| format!("Release update version is invalid: {error}"))?;
    let checksum_name = format!("{}.sha256", archive.name);
    if !release
        .assets
        .iter()
        .any(|asset| asset.name == checksum_name && asset.size > 0)
    {
        return Err("The release update archive has no SHA-256 sidecar.".into());
    }
    let archive_name = archive.name.clone();
    Ok(ReleaseCandidate {
        release,
        version,
        version_text,
        archive_name,
        checksum_name,
    })
}

async fn download_verify_and_install(
    gh: &Path,
    candidate: &ReleaseCandidate,
    scratch: &Path,
) -> Result<(), String> {
    let tag = candidate.release.tag_name.as_str();
    let destination = scratch.to_string_lossy().to_string();
    let output = run_gh(
        gh,
        &[
            "release",
            "download",
            tag,
            "--repo",
            REPOSITORY,
            "--pattern",
            &candidate.archive_name,
            "--pattern",
            &candidate.checksum_name,
            "--dir",
            &destination,
        ],
    )
    .await?;
    if !output.status.success() {
        return Err("GitHub CLI could not download the selected Offisim release assets.".into());
    }

    let archive = scratch.join(&candidate.archive_name);
    let checksum = scratch.join(&candidate.checksum_name);
    verify_checksum(&archive, &checksum)?;

    let extracted = scratch.join("extracted");
    fs::create_dir(&extracted)
        .map_err(|error| format!("Create update extraction folder: {error}"))?;
    run_checked(
        "/usr/bin/ditto",
        vec![
            OsString::from("-x"),
            OsString::from("-k"),
            archive.as_os_str().to_owned(),
            extracted.as_os_str().to_owned(),
        ],
        "Extract update archive",
    )
    .await?;
    let app = extracted.join("Offisim.app");
    assert_real_app_directory(&app)?;
    verify_distribution_app(&app, &candidate.version_text).await?;
    replace_app_bundle(&app).await
}

fn verify_checksum(archive: &Path, sidecar: &Path) -> Result<(), String> {
    let expected_body =
        fs::read_to_string(sidecar).map_err(|error| format!("Read update checksum: {error}"))?;
    let expected = expected_body
        .split_whitespace()
        .next()
        .filter(|value| value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit()))
        .ok_or_else(|| "The update SHA-256 sidecar is invalid.".to_string())?;
    let mut file =
        fs::File::open(archive).map_err(|error| format!("Read update archive: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Hash update archive: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual = hex::encode(hasher.finalize());
    if !actual.eq_ignore_ascii_case(expected) {
        return Err("The downloaded update failed SHA-256 verification.".into());
    }
    Ok(())
}

async fn verify_distribution_app(app: &Path, expected_version: &str) -> Result<(), String> {
    run_checked(
        "/usr/bin/codesign",
        vec![
            OsString::from("--verify"),
            OsString::from("--deep"),
            OsString::from("--strict"),
            OsString::from("--verbose=2"),
            app.as_os_str().to_owned(),
        ],
        "Verify update code signature",
    )
    .await?;
    let details = run_checked(
        "/usr/bin/codesign",
        vec![
            OsString::from("-dv"),
            OsString::from("--verbose=4"),
            app.as_os_str().to_owned(),
        ],
        "Read update code signature",
    )
    .await?;
    let details = String::from_utf8_lossy(&details.stderr);
    if !details.contains(&format!("TeamIdentifier={EXPECTED_TEAM_ID}"))
        || !details.contains(&format!("Authority={EXPECTED_AUTHORITY}"))
    {
        return Err("The update is not signed by the expected Offisim Developer ID.".into());
    }
    run_checked(
        "/usr/sbin/spctl",
        vec![
            OsString::from("-a"),
            OsString::from("-vv"),
            OsString::from("--type"),
            OsString::from("exec"),
            app.as_os_str().to_owned(),
        ],
        "Verify update notarization",
    )
    .await?;
    let plist = app.join("Contents/Info.plist");
    let version = run_checked(
        "/usr/bin/plutil",
        vec![
            OsString::from("-extract"),
            OsString::from("CFBundleShortVersionString"),
            OsString::from("raw"),
            OsString::from("-o"),
            OsString::from("-"),
            plist.as_os_str().to_owned(),
        ],
        "Read update version",
    )
    .await?;
    if String::from_utf8_lossy(&version.stdout).trim() != expected_version {
        return Err("The update bundle version does not match its release asset.".into());
    }
    Ok(())
}

async fn replace_app_bundle(candidate: &Path) -> Result<(), String> {
    let target = Path::new(APPLICATION_PATH);
    assert_real_app_directory(target)?;
    let applications = target
        .parent()
        .ok_or_else(|| "Resolve /Applications directory".to_string())?;
    let suffix = format!("{}-{}", std::process::id(), now_unix_ms());
    let staged = applications.join(format!(".Offisim.update-{suffix}.app"));
    let previous = applications.join(format!(".Offisim.previous-{suffix}.app"));
    run_checked(
        "/usr/bin/ditto",
        vec![
            candidate.as_os_str().to_owned(),
            staged.as_os_str().to_owned(),
        ],
        "Stage update in /Applications",
    )
    .await?;
    assert_real_app_directory(&staged)?;
    fs::rename(target, &previous)
        .map_err(|error| format!("Move current Offisim aside: {error}"))?;
    if let Err(error) = fs::rename(&staged, target) {
        let _ = fs::rename(&previous, target);
        let _ = fs::remove_dir_all(&staged);
        return Err(format!("Install updated Offisim: {error}"));
    }
    let _ = fs::remove_dir_all(&previous);
    Ok(())
}

fn assert_running_from_applications() -> Result<(), String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("Resolve running Offisim executable: {error}"))?;
    if !executable.starts_with(format!("{APPLICATION_PATH}/Contents/MacOS/")) {
        return Err(
            "Updates can only be installed when Offisim is running from /Applications.".into(),
        );
    }
    Ok(())
}

fn assert_real_app_directory(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Inspect {}: {error}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!("{} is not a real app directory.", path.display()));
    }
    if !path.join("Contents/Info.plist").is_file() || !path.join("Contents/MacOS").is_dir() {
        return Err(format!(
            "{} is not a complete macOS app bundle.",
            path.display()
        ));
    }
    Ok(())
}

async fn run_gh(gh: &Path, args: &[&str]) -> Result<Output, String> {
    let mut command = Command::new(gh);
    command.args(args);
    command.env_clear();
    for (key, value) in crate::redaction::scrub_env_to_allowlist(&[
        "HOME", "USER", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR",
    ]) {
        command.env(key, value);
    }
    command.env("NO_COLOR", "1");
    command
        .output()
        .await
        .map_err(|error| format!("Launch GitHub CLI: {error}"))
}

async fn run_checked(executable: &str, args: Vec<OsString>, label: &str) -> Result<Output, String> {
    let output = Command::new(executable)
        .args(args)
        .output()
        .await
        .map_err(|error| format!("{label}: {error}"))?;
    if !output.status.success() {
        return Err(format!("{label} failed with status {}.", output.status));
    }
    Ok(output)
}

fn release_arch() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        "x86_64" => "x86_64",
        other => other,
    }
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_asset_version_is_semver_and_arch_specific() {
        let release = GhRelease {
            tag_name: "v1.2.3".into(),
            name: "Offisim 1.2.3".into(),
            published_at: Some("2026-07-18T00:00:00Z".into()),
            is_draft: false,
            is_prerelease: false,
            assets: vec![GhAsset {
                name: format!("Offisim_1.2.3_{}.app.zip", release_arch()),
                size: 42,
            }],
        };
        let suffix = format!("_{}.app.zip", release_arch());
        let version = release.assets[0]
            .name
            .strip_prefix("Offisim_")
            .and_then(|name| name.strip_suffix(&suffix))
            .and_then(|name| Version::parse(name).ok());
        assert_eq!(version, Some(Version::new(1, 2, 3)));
    }

    #[test]
    fn application_target_is_exact_and_not_home_relative() {
        assert_eq!(APPLICATION_PATH, "/Applications/Offisim.app");
        assert!(!Path::new(APPLICATION_PATH).starts_with(dirs::home_dir().unwrap()));
    }
}
