use rand::RngCore;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, MetadataExt};
use std::{
    ffi::OsString,
    fs::{self, DirBuilder},
    io::Read,
    path::{Path, PathBuf},
    process::Output,
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

struct UpdateScratch(PathBuf);

impl UpdateScratch {
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for UpdateScratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
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

    download_verify_and_install(&gh, &candidate).await?;
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
    assert_release_tag_matches_version(&release.tag_name, &version_text)?;
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

fn assert_release_tag_matches_version(tag_name: &str, version_text: &str) -> Result<(), String> {
    let expected_tag = format!("v{version_text}");
    if tag_name != expected_tag {
        return Err(format!(
            "Release tag {tag_name} does not match update asset version {version_text}."
        ));
    }
    Ok(())
}

async fn download_verify_and_install(
    gh: &Path,
    candidate: &ReleaseCandidate,
) -> Result<(), String> {
    let scratch = create_update_scratch()?;
    let scratch_path = scratch.path();
    let tag = candidate.release.tag_name.as_str();
    let destination = scratch_path.to_string_lossy().to_string();
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
    assert_private_update_directory(scratch_path)?;

    let archive = scratch_path.join(&candidate.archive_name);
    let checksum = scratch_path.join(&candidate.checksum_name);
    verify_checksum(&archive, &checksum)?;

    let extracted = scratch_path.join("extracted");
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
    replace_app_bundle(&app, &candidate.version_text).await
}

fn create_update_scratch() -> Result<UpdateScratch, String> {
    let temp_root = fs::canonicalize(std::env::temp_dir())
        .map_err(|error| format!("Resolve update staging root: {error}"))?;
    let root_metadata = fs::symlink_metadata(&temp_root)
        .map_err(|error| format!("Inspect update staging root: {error}"))?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Err("The update staging root is not a real directory.".into());
    }

    for _ in 0..16 {
        let mut random = [0_u8; 16];
        rand::thread_rng().fill_bytes(&mut random);
        let path = temp_root.join(format!("offisim-update-{}", hex::encode(random)));
        let mut builder = DirBuilder::new();
        #[cfg(unix)]
        builder.mode(0o700);
        match builder.create(&path) {
            Ok(()) => {
                if let Err(error) = assert_private_update_directory(&path) {
                    let _ = fs::remove_dir(&path);
                    return Err(error);
                }
                return Ok(UpdateScratch(path));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Create update staging: {error}")),
        }
    }
    Err("Could not allocate a private update staging directory.".into())
}

fn assert_private_update_directory(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Inspect update staging directory: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("The update staging directory is not a real directory.".into());
    }
    #[cfg(unix)]
    if metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o077 != 0 {
        return Err("The update staging directory is not private to the current user.".into());
    }
    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("Resolve update staging directory: {error}"))?;
    if canonical != path {
        return Err("The update staging directory changed while the update was prepared.".into());
    }
    Ok(())
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
        "/usr/bin/xcrun",
        vec![
            OsString::from("stapler"),
            OsString::from("validate"),
            app.as_os_str().to_owned(),
        ],
        "Verify update notarization ticket",
    )
    .await?;
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
    for key in ["CFBundleShortVersionString", "CFBundleVersion"] {
        let version = run_checked(
            "/usr/bin/plutil",
            vec![
                OsString::from("-extract"),
                OsString::from(key),
                OsString::from("raw"),
                OsString::from("-o"),
                OsString::from("-"),
                plist.as_os_str().to_owned(),
            ],
            &format!("Read update {key}"),
        )
        .await?;
        if String::from_utf8_lossy(&version.stdout).trim() != expected_version {
            return Err(format!(
                "The update bundle {key} does not match its release asset."
            ));
        }
    }
    Ok(())
}

async fn replace_app_bundle(candidate: &Path, expected_version: &str) -> Result<(), String> {
    let target = Path::new(APPLICATION_PATH);
    assert_real_app_directory(target)?;
    let applications = target
        .parent()
        .ok_or_else(|| "Resolve /Applications directory".to_string())?;
    let suffix = format!("{}-{}", std::process::id(), now_unix_ms());
    let staged = applications.join(format!(".Offisim.update-{suffix}.app"));
    let previous = applications.join(format!(".Offisim.previous-{suffix}.app"));
    let stage_result = run_checked(
        "/usr/bin/ditto",
        vec![
            candidate.as_os_str().to_owned(),
            staged.as_os_str().to_owned(),
        ],
        "Stage update in /Applications",
    )
    .await;
    cleanup_staged_result(&staged, stage_result)?;
    if let Err(error) = assert_real_app_directory(&staged) {
        let _ = fs::remove_dir_all(&staged);
        return Err(error);
    }
    if let Err(error) = verify_distribution_app(&staged, expected_version).await {
        let _ = fs::remove_dir_all(&staged);
        return Err(error);
    }
    install_staged_app(target, &staged, &previous)?;
    if let Err(error) = verify_distribution_app(target, expected_version).await {
        let rejected = applications.join(format!(".Offisim.rejected-{suffix}.app"));
        if let Err(move_error) = fs::rename(target, &rejected) {
            return Err(format!(
                "The installed update failed final verification and could not be isolated for rollback: {error}; {move_error}"
            ));
        }
        if let Err(restore_error) = fs::rename(&previous, target) {
            let _ = fs::rename(&rejected, target);
            return Err(format!(
                "The installed update failed final verification and automatic rollback failed: {error}; {restore_error}"
            ));
        }
        let _ = fs::remove_dir_all(&rejected);
        return Err(format!(
            "The installed update failed final verification and was rolled back: {error}"
        ));
    }
    let _ = fs::remove_dir_all(&previous);
    Ok(())
}

fn remove_update_artifact(path: &Path) -> std::io::Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

fn cleanup_staged_result<T>(staged: &Path, result: Result<T, String>) -> Result<T, String> {
    result.map_err(|error| match remove_update_artifact(staged) {
        Ok(()) => error,
        Err(cleanup_error) => format!(
            "{error} Partial staged update cleanup failed; the artifact remains at {}: {cleanup_error}",
            staged.display()
        ),
    })
}

fn install_staged_app(target: &Path, staged: &Path, previous: &Path) -> Result<(), String> {
    install_staged_app_using(target, staged, previous, |from, to| fs::rename(from, to))
}

fn install_staged_app_using<F>(
    target: &Path,
    staged: &Path,
    previous: &Path,
    mut rename: F,
) -> Result<(), String>
where
    F: FnMut(&Path, &Path) -> std::io::Result<()>,
{
    if let Err(error) = rename(target, previous) {
        return cleanup_staged_result(staged, Err(format!("Move current Offisim aside: {error}")));
    }
    if let Err(install_error) = rename(staged, target) {
        return match rename(previous, target) {
            Ok(()) => cleanup_staged_result(
                staged,
                Err(format!(
                    "Install updated Offisim: {install_error}. The previous verified app was restored."
                )),
            ),
            Err(rollback_error) => cleanup_staged_result(
                staged,
                Err(format!(
                    "CRITICAL: installing the updated Offisim failed ({install_error}) and automatic rollback failed ({rollback_error}). The previous verified app remains recoverable at {}.",
                    previous.display()
                )),
            ),
        };
    }
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
    // Canonical clock is i64 (non-negative in practice); this lane keeps u128.
    crate::time_util::now_unix_ms() as u128
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
        assert!(assert_release_tag_matches_version(&release.tag_name, "1.2.3").is_ok());
    }

    #[test]
    fn update_release_tag_must_match_asset_version_exactly() {
        assert!(assert_release_tag_matches_version("v1.2.3", "1.2.3").is_ok());
        assert!(assert_release_tag_matches_version("v1.2.4", "1.2.3").is_err());
        assert!(assert_release_tag_matches_version("1.2.3", "1.2.3").is_err());
    }

    #[test]
    fn application_target_is_exact_and_not_home_relative() {
        assert_eq!(APPLICATION_PATH, "/Applications/Offisim.app");
        assert!(!Path::new(APPLICATION_PATH).starts_with(dirs::home_dir().unwrap()));
    }

    #[test]
    fn update_scratch_is_random_private_and_removed_on_drop() {
        let path = {
            let scratch = create_update_scratch().unwrap();
            let path = scratch.path().to_path_buf();
            assert_private_update_directory(&path).unwrap();
            path
        };
        assert!(!path.exists());
    }

    #[test]
    fn failed_staging_removes_partial_update_artifact() {
        let scratch = create_update_scratch().unwrap();
        let staged = scratch.path().join(".Offisim.update-test.app");
        fs::create_dir(&staged).unwrap();
        fs::write(staged.join("partial"), b"partial update").unwrap();

        let error = cleanup_staged_result::<()>(&staged, Err("ditto failed".into())).unwrap_err();

        assert_eq!(error, "ditto failed");
        assert!(!staged.exists());
    }

    #[test]
    fn failed_install_restores_previous_app_and_cleans_staged_copy() {
        let scratch = create_update_scratch().unwrap();
        let target = scratch.path().join("Offisim.app");
        let staged = scratch.path().join("staged.app");
        let previous = scratch.path().join("previous.app");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("marker"), b"previous verified app").unwrap();
        fs::create_dir(&staged).unwrap();

        let mut calls = 0;
        let error = install_staged_app_using(&target, &staged, &previous, |from, to| {
            calls += 1;
            if calls == 2 {
                Err(std::io::Error::other("injected install failure"))
            } else {
                fs::rename(from, to)
            }
        })
        .unwrap_err();

        assert!(error.contains("previous verified app was restored"));
        assert_eq!(
            fs::read(target.join("marker")).unwrap(),
            b"previous verified app"
        );
        assert!(!staged.exists());
        assert!(!previous.exists());
    }

    #[test]
    fn rollback_failure_is_critical_and_preserves_previous_app_path() {
        let scratch = create_update_scratch().unwrap();
        let target = scratch.path().join("Offisim.app");
        let staged = scratch.path().join("staged.app");
        let previous = scratch.path().join("previous.app");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("marker"), b"previous verified app").unwrap();
        fs::create_dir(&staged).unwrap();

        let mut calls = 0;
        let error = install_staged_app_using(&target, &staged, &previous, |from, to| {
            calls += 1;
            match calls {
                1 => fs::rename(from, to),
                2 => Err(std::io::Error::other("injected install failure")),
                _ => Err(std::io::Error::other("injected rollback failure")),
            }
        })
        .unwrap_err();

        assert!(error.contains("CRITICAL"));
        assert!(error.contains("automatic rollback failed"));
        assert!(error.contains(&previous.display().to_string()));
        assert_eq!(
            fs::read(previous.join("marker")).unwrap(),
            b"previous verified app"
        );
        assert!(!staged.exists());
        assert!(!target.exists());
    }
}
