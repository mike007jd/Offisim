use image::codecs::webp::WebPDecoder;
use image::ImageDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
#[cfg(unix)]
use std::ffi::CString;
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{Cursor, ErrorKind, Read};
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd};
use std::path::{Path, PathBuf};

const MANIFEST_NAME: &str = "pet.json";
const SPRITESHEET_NAME: &str = "spritesheet.webp";
const EXPECTED_WIDTH: u32 = 1_536;
const EXPECTED_HEIGHT: u32 = 1_872;
const ATLAS_COLUMNS: usize = 8;
const ATLAS_ROWS: usize = 9;
const CELL_WIDTH: usize = 192;
const CELL_HEIGHT: usize = 208;
const FRAME_COUNTS: [usize; ATLAS_ROWS] = [6, 8, 8, 4, 5, 8, 6, 6, 6];
const MAX_MANIFEST_BYTES: u64 = 16 * 1_024;
const MAX_SPRITESHEET_BYTES: u64 = 16 * 1_024 * 1_024;
const MAX_CONFIG_BYTES: u64 = 1_024 * 1_024;
const MAX_ID_BYTES: usize = 64;
const MAX_DISPLAY_NAME_CHARS: usize = 120;
const MAX_DESCRIPTION_CHARS: usize = 1_000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPetMetadata {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub width: u32,
    pub height: u32,
    pub version: String,
    pub byte_size: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvalidCodexPetEntry {
    pub folder: String,
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexPetCatalog {
    pub source_path: String,
    pub pets: Vec<CodexPetMetadata>,
    pub invalid_entries: Vec<InvalidCodexPetEntry>,
    pub selected_pet_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PetManifest {
    id: String,
    #[serde(rename = "displayName")]
    display_name: String,
    description: String,
    #[serde(rename = "spritesheetPath")]
    spritesheet_path: String,
}

struct PetsLocation {
    codex_home: PathBuf,
    display_path: PathBuf,
    root: Option<PathBuf>,
}

struct ValidatedPet {
    metadata: CodexPetMetadata,
    spritesheet_bytes: Vec<u8>,
}

#[derive(Debug)]
struct PetEntryError {
    code: &'static str,
    message: String,
}

type PetEntryResult<T> = Result<T, PetEntryError>;

impl PetEntryError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn invalid(self, folder: String) -> InvalidCodexPetEntry {
        InvalidCodexPetEntry {
            folder,
            code: self.code.to_string(),
            message: self.message,
        }
    }

    fn command_message(self) -> String {
        format!("{}: {}", self.code, self.message)
    }
}

fn configured_codex_home() -> Result<PathBuf, String> {
    let configured = std::env::var_os("CODEX_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))
        .ok_or_else(|| "cannot resolve CODEX_HOME or the user home directory".to_string())?;
    if configured.is_absolute() {
        Ok(configured)
    } else {
        std::env::current_dir()
            .map(|current| current.join(configured))
            .map_err(|error| format!("resolve relative CODEX_HOME: {error}"))
    }
}

fn pets_location() -> Result<PetsLocation, String> {
    let codex_home = configured_codex_home()?;
    let display_path = codex_home.join("pets");
    let metadata = match fs::symlink_metadata(&display_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok(PetsLocation {
                codex_home,
                display_path,
                root: None,
            });
        }
        Err(error) => return Err(format!("inspect Codex pets directory: {error}")),
    };
    if metadata.file_type().is_symlink() {
        return Err("Codex pets directory must not be a symlink".to_string());
    }
    if !metadata.is_dir() {
        return Err("Codex pets path is not a directory".to_string());
    }
    let root = fs::canonicalize(&display_path)
        .map_err(|error| format!("resolve Codex pets directory: {error}"))?;
    Ok(PetsLocation {
        codex_home,
        display_path: root.clone(),
        root: Some(root),
    })
}

fn is_valid_pet_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ID_BYTES
        && value.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

fn validate_text(value: &str, field: &str, max_chars: usize) -> PetEntryResult<()> {
    if value.is_empty() || value.trim() != value {
        return Err(PetEntryError::new(
            "invalid-manifest",
            format!("{field} must be non-empty and have no surrounding whitespace"),
        ));
    }
    if value.chars().count() > max_chars || value.chars().any(char::is_control) {
        return Err(PetEntryError::new(
            "invalid-manifest",
            format!("{field} contains unsupported text"),
        ));
    }
    Ok(())
}

fn open_readonly_no_follow(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    options.open(path)
}

#[cfg(unix)]
fn open_directory_no_follow(path: &Path) -> std::io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;

    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
}

#[cfg(unix)]
fn open_child_no_follow(parent: &File, name: &str, directory: bool) -> std::io::Result<File> {
    let name = CString::new(name)
        .map_err(|_| std::io::Error::new(ErrorKind::InvalidInput, "path contains NUL"))?;
    let mut flags = libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK;
    if directory {
        flags |= libc::O_DIRECTORY;
    }
    let descriptor = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
    if descriptor < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

#[cfg(unix)]
fn child_is_symlink(parent: &File, name: &str) -> bool {
    let Ok(name) = CString::new(name) else {
        return false;
    };
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    let result = unsafe {
        libc::fstatat(
            parent.as_raw_fd(),
            name.as_ptr(),
            stat.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    if result != 0 {
        return false;
    }
    let mode = unsafe { stat.assume_init() }.st_mode;
    mode & libc::S_IFMT == libc::S_IFLNK
}

#[cfg(not(unix))]
fn open_directory_no_follow(_path: &Path) -> std::io::Result<File> {
    Err(std::io::Error::new(
        ErrorKind::Unsupported,
        "Codex pet packages require descriptor-relative filesystem access",
    ))
}

#[cfg(not(unix))]
fn open_child_no_follow(_parent: &File, _name: &str, _directory: bool) -> std::io::Result<File> {
    Err(std::io::Error::new(
        ErrorKind::Unsupported,
        "Codex pet packages require descriptor-relative filesystem access",
    ))
}

#[cfg(not(unix))]
fn child_is_symlink(_parent: &File, _name: &str) -> bool {
    false
}

fn open_pet_package(root: &Path, folder_id: &str) -> PetEntryResult<File> {
    let root_handle = open_directory_no_follow(root).map_err(|error| {
        PetEntryError::new(
            "path-escape",
            format!("open Codex pets directory without following links: {error}"),
        )
    })?;
    let package = open_child_no_follow(&root_handle, folder_id, true).map_err(|error| {
        let code = if child_is_symlink(&root_handle, folder_id) {
            "symlink"
        } else {
            "invalid-entry"
        };
        PetEntryError::new(
            code,
            format!("open pet folder without following links: {error}"),
        )
    })?;
    let metadata = package.metadata().map_err(|error| {
        PetEntryError::new("invalid-entry", format!("inspect open pet folder: {error}"))
    })?;
    if !metadata.is_dir() {
        return Err(PetEntryError::new(
            "invalid-entry",
            "pet entry is not a directory",
        ));
    }
    Ok(package)
}

fn open_pet_regular_file(
    package: &File,
    name: &str,
    label: &str,
) -> PetEntryResult<(File, Metadata)> {
    let file = open_child_no_follow(package, name, false).map_err(|error| {
        let code = classify_pet_file_open_error(package, name, &error);
        PetEntryError::new(
            code,
            format!("open {label} without following links: {error}"),
        )
    })?;
    let metadata = file.metadata().map_err(|error| {
        PetEntryError::new("read-failed", format!("inspect open {label}: {error}"))
    })?;
    if !metadata.is_file() {
        return Err(PetEntryError::new(
            "invalid-file",
            format!("{label} is not a regular file"),
        ));
    }
    Ok((file, metadata))
}

fn classify_pet_file_open_error(
    package: &File,
    name: &str,
    error: &std::io::Error,
) -> &'static str {
    if child_is_symlink(package, name) {
        "symlink"
    } else if error.raw_os_error() == Some(libc::ENOENT) {
        "missing-file"
    } else {
        "read-failed"
    }
}

fn read_open_pet_file(
    mut file: File,
    metadata: &Metadata,
    limit: u64,
    label: &str,
) -> PetEntryResult<Vec<u8>> {
    if metadata.len() > limit {
        return Err(PetEntryError::new(
            "file-too-large",
            format!("{label} exceeds the {limit}-byte limit"),
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.by_ref()
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| PetEntryError::new("read-failed", format!("read {label}: {error}")))?;
    if bytes.len() as u64 > limit {
        return Err(PetEntryError::new(
            "file-too-large",
            format!("{label} exceeds the {limit}-byte limit"),
        ));
    }
    Ok(bytes)
}

fn read_limited_file(
    path: &Path,
    metadata: &Metadata,
    limit: u64,
    label: &str,
) -> PetEntryResult<Vec<u8>> {
    if metadata.len() > limit {
        return Err(PetEntryError::new(
            "file-too-large",
            format!("{label} exceeds the {limit}-byte limit"),
        ));
    }
    let file = open_readonly_no_follow(path)
        .map_err(|error| PetEntryError::new("read-failed", format!("open {label}: {error}")))?;
    let opened_metadata = file.metadata().map_err(|error| {
        PetEntryError::new("read-failed", format!("inspect open {label}: {error}"))
    })?;
    if !opened_metadata.is_file() || opened_metadata.len() > limit {
        return Err(PetEntryError::new(
            "file-too-large",
            format!("{label} changed while it was being opened"),
        ));
    }
    let mut bytes = Vec::with_capacity(opened_metadata.len() as usize);
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| PetEntryError::new("read-failed", format!("read {label}: {error}")))?;
    if bytes.len() as u64 > limit {
        return Err(PetEntryError::new(
            "file-too-large",
            format!("{label} exceeds the {limit}-byte limit"),
        ));
    }
    Ok(bytes)
}

fn version_for(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn unused_atlas_cells_are_transparent(pixels: &[u8]) -> bool {
    FRAME_COUNTS.iter().enumerate().all(|(row, frame_count)| {
        (*frame_count..ATLAS_COLUMNS).all(|column| {
            let x_start = column * CELL_WIDTH;
            let y_start = row * CELL_HEIGHT;
            (y_start..y_start + CELL_HEIGHT).all(|y| {
                (x_start..x_start + CELL_WIDTH)
                    .all(|x| pixels[(y * EXPECTED_WIDTH as usize + x) * 4 + 3] == 0)
            })
        })
    })
}

fn validate_webp(bytes: &[u8]) -> PetEntryResult<(u32, u32)> {
    let decoder = WebPDecoder::new(Cursor::new(bytes)).map_err(|error| {
        PetEntryError::new(
            "invalid-webp",
            format!("decode spritesheet header: {error}"),
        )
    })?;
    if decoder.has_animation() {
        return Err(PetEntryError::new(
            "animated-webp",
            "spritesheet must be a static WebP atlas",
        ));
    }
    let dimensions = decoder.dimensions();
    if dimensions != (EXPECTED_WIDTH, EXPECTED_HEIGHT) {
        return Err(PetEntryError::new(
            "invalid-dimensions",
            format!(
                "spritesheet must be {EXPECTED_WIDTH}x{EXPECTED_HEIGHT}, got {}x{}",
                dimensions.0, dimensions.1
            ),
        ));
    }
    if !decoder.color_type().has_alpha() {
        return Err(PetEntryError::new(
            "missing-alpha",
            "spritesheet must preserve transparent unused atlas cells",
        ));
    }
    let decoded_bytes = usize::try_from(decoder.total_bytes()).map_err(|_| {
        PetEntryError::new("invalid-webp", "decoded spritesheet size is unsupported")
    })?;
    let mut pixels = vec![0_u8; decoded_bytes];
    decoder.read_image(&mut pixels).map_err(|error| {
        PetEntryError::new(
            "invalid-webp",
            format!("decode spritesheet pixels: {error}"),
        )
    })?;
    if !unused_atlas_cells_are_transparent(&pixels) {
        return Err(PetEntryError::new(
            "opaque-unused-cells",
            "unused atlas cells must remain fully transparent",
        ));
    }
    Ok(dimensions)
}

fn validate_package(root: &Path, folder_id: &str) -> PetEntryResult<ValidatedPet> {
    if !is_valid_pet_id(folder_id) {
        return Err(PetEntryError::new(
            "invalid-id",
            "pet folder id must be a lowercase ASCII slug",
        ));
    }
    let package = open_pet_package(root, folder_id)?;
    let (manifest_file, manifest_metadata) =
        open_pet_regular_file(&package, MANIFEST_NAME, MANIFEST_NAME)?;
    if manifest_metadata.len() > MAX_MANIFEST_BYTES {
        return Err(PetEntryError::new(
            "manifest-too-large",
            format!("pet.json exceeds {MAX_MANIFEST_BYTES} bytes"),
        ));
    }
    let manifest_bytes = read_open_pet_file(
        manifest_file,
        &manifest_metadata,
        MAX_MANIFEST_BYTES,
        MANIFEST_NAME,
    )?;
    let manifest: PetManifest = serde_json::from_slice(&manifest_bytes).map_err(|error| {
        PetEntryError::new("invalid-manifest", format!("parse pet.json: {error}"))
    })?;
    if manifest.id != folder_id || !is_valid_pet_id(&manifest.id) {
        return Err(PetEntryError::new(
            "invalid-id",
            "manifest id must match its lowercase pet folder id",
        ));
    }
    validate_text(
        &manifest.display_name,
        "displayName",
        MAX_DISPLAY_NAME_CHARS,
    )?;
    validate_text(&manifest.description, "description", MAX_DESCRIPTION_CHARS)?;
    if manifest.spritesheet_path != SPRITESHEET_NAME {
        return Err(PetEntryError::new(
            "path-escape",
            "spritesheetPath must be exactly spritesheet.webp",
        ));
    }

    let (spritesheet_file, spritesheet_metadata) =
        open_pet_regular_file(&package, SPRITESHEET_NAME, SPRITESHEET_NAME)?;
    if spritesheet_metadata.len() > MAX_SPRITESHEET_BYTES {
        return Err(PetEntryError::new(
            "spritesheet-too-large",
            format!("spritesheet exceeds {MAX_SPRITESHEET_BYTES} bytes"),
        ));
    }
    let spritesheet_bytes = read_open_pet_file(
        spritesheet_file,
        &spritesheet_metadata,
        MAX_SPRITESHEET_BYTES,
        SPRITESHEET_NAME,
    )?;
    let (width, height) = validate_webp(&spritesheet_bytes)?;
    let version = version_for(&spritesheet_bytes);
    Ok(ValidatedPet {
        metadata: CodexPetMetadata {
            id: manifest.id,
            display_name: manifest.display_name,
            description: manifest.description,
            width,
            height,
            version,
            byte_size: spritesheet_metadata.len(),
        },
        spritesheet_bytes,
    })
}

fn parse_selected_pet(config: &str, valid_ids: &HashSet<&str>) -> Option<String> {
    let mut in_desktop = false;
    let mut selected = None;
    for raw_line in config.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') {
            in_desktop = line == "[desktop]";
            continue;
        }
        if !in_desktop {
            continue;
        }
        let Some((key, raw_value)) = line.split_once('=') else {
            continue;
        };
        if key.trim() != "selected-avatar-id" {
            continue;
        }
        let value = raw_value.trim();
        let parsed = if let Some(rest) = value.strip_prefix('"') {
            rest.split_once('"').and_then(|(value, suffix)| {
                (suffix.trim().is_empty() || suffix.trim().starts_with('#')).then_some(value)
            })
        } else if let Some(rest) = value.strip_prefix('\'') {
            rest.split_once('\'').and_then(|(value, suffix)| {
                (suffix.trim().is_empty() || suffix.trim().starts_with('#')).then_some(value)
            })
        } else {
            None
        };
        let Some(id) = parsed.and_then(|value| value.strip_prefix("custom:")) else {
            continue;
        };
        if is_valid_pet_id(id) && valid_ids.contains(id) {
            selected = Some(id.to_string());
        }
    }
    selected
}

fn selected_pet_id(codex_home: &Path, pets: &[CodexPetMetadata]) -> Option<String> {
    let path = codex_home.join("config.toml");
    let metadata = fs::symlink_metadata(&path).ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > MAX_CONFIG_BYTES
    {
        return None;
    }
    let bytes = read_limited_file(&path, &metadata, MAX_CONFIG_BYTES, "config.toml").ok()?;
    let config = std::str::from_utf8(&bytes).ok()?;
    let valid_ids: HashSet<_> = pets.iter().map(|pet| pet.id.as_str()).collect();
    parse_selected_pet(config, &valid_ids)
}

fn list_catalog_at(location: PetsLocation) -> Result<CodexPetCatalog, String> {
    let mut pets = Vec::new();
    let mut invalid_entries = Vec::new();
    if let Some(root) = &location.root {
        let entries =
            fs::read_dir(root).map_err(|error| format!("read Codex pets directory: {error}"))?;
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    invalid_entries.push(InvalidCodexPetEntry {
                        folder: "<unreadable>".to_string(),
                        code: "read-failed".to_string(),
                        message: format!("read directory entry: {error}"),
                    });
                    continue;
                }
            };
            let folder = match entry.file_name().into_string() {
                Ok(folder) => folder,
                Err(_) => {
                    invalid_entries.push(InvalidCodexPetEntry {
                        folder: "<non-utf8>".to_string(),
                        code: "invalid-id".to_string(),
                        message: "pet folder id must be valid UTF-8".to_string(),
                    });
                    continue;
                }
            };
            if folder.starts_with('.') {
                continue;
            }
            match validate_package(root, &folder) {
                Ok(validated) => pets.push(validated.metadata),
                Err(error) => invalid_entries.push(error.invalid(folder)),
            }
        }
    }
    pets.sort_by(|left, right| left.id.cmp(&right.id));
    invalid_entries.sort_by(|left, right| left.folder.cmp(&right.folder));
    let selected_pet_id = selected_pet_id(&location.codex_home, &pets);
    Ok(CodexPetCatalog {
        source_path: location.display_path.to_string_lossy().into_owned(),
        pets,
        invalid_entries,
        selected_pet_id,
    })
}

fn load_pet_bytes_at(root: &Path, pet_id: &str, expected_version: &str) -> Result<Vec<u8>, String> {
    if !is_valid_pet_id(pet_id) {
        return Err("invalid-id: pet id must be a lowercase ASCII slug".to_string());
    }
    let validated = validate_package(root, pet_id).map_err(PetEntryError::command_message)?;
    if expected_version != validated.metadata.version {
        return Err("version-mismatch: Codex pet changed; refresh the catalog".to_string());
    }
    Ok(validated.spritesheet_bytes)
}

#[tauri::command(async)]
pub fn codex_pets_list() -> Result<CodexPetCatalog, String> {
    list_catalog_at(pets_location()?)
}

#[tauri::command(async)]
pub fn codex_pet_load(
    pet_id: String,
    expected_version: String,
) -> Result<tauri::ipc::Response, String> {
    let location = pets_location()?;
    let root = location
        .root
        .ok_or_else(|| "not-found: Codex pets directory does not exist".to_string())?;
    let bytes = load_pet_bytes_at(&root, &pet_id, &expected_version)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::codecs::webp::WebPEncoder;
    use image::ExtendedColorType;
    use rand::RngCore;
    use std::sync::OnceLock;

    struct TempTree(PathBuf);

    impl TempTree {
        fn new() -> Self {
            let mut suffix = [0_u8; 8];
            rand::thread_rng().fill_bytes(&mut suffix);
            let path = std::env::temp_dir().join(format!(
                "offisim-codex-pets-{}-{}",
                std::process::id(),
                u64::from_le_bytes(suffix)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn pets(&self) -> PathBuf {
            self.0.join("pets")
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn encode_webp(width: u32, height: u32, marker: u8) -> Vec<u8> {
        let mut pixels = vec![0_u8; width as usize * height as usize * 4];
        pixels[..4].copy_from_slice(&[marker, 17, 29, 255]);
        let mut bytes = Vec::new();
        WebPEncoder::new_lossless(&mut bytes)
            .encode(&pixels, width, height, ExtendedColorType::Rgba8)
            .unwrap();
        bytes
    }

    fn valid_webp() -> Vec<u8> {
        static VALID: OnceLock<Vec<u8>> = OnceLock::new();
        VALID
            .get_or_init(|| encode_webp(EXPECTED_WIDTH, EXPECTED_HEIGHT, 11))
            .clone()
    }

    fn opaque_rgba_webp() -> Vec<u8> {
        let pixels = vec![255_u8; EXPECTED_WIDTH as usize * EXPECTED_HEIGHT as usize * 4];
        let mut bytes = Vec::new();
        WebPEncoder::new_lossless(&mut bytes)
            .encode(
                &pixels,
                EXPECTED_WIDTH,
                EXPECTED_HEIGHT,
                ExtendedColorType::Rgba8,
            )
            .unwrap();
        bytes
    }

    fn append_chunk(output: &mut Vec<u8>, fourcc: &[u8; 4], data: &[u8]) {
        output.extend_from_slice(fourcc);
        output.extend_from_slice(&u32::try_from(data.len()).unwrap().to_le_bytes());
        output.extend_from_slice(data);
        if data.len() & 1 == 1 {
            output.push(0);
        }
    }

    fn animated_webp() -> Vec<u8> {
        let frame = valid_webp();
        let mut body = Vec::new();
        let mut vp8x = vec![0_u8; 10];
        vp8x[0] = 0x02;
        vp8x[4..7].copy_from_slice(&(EXPECTED_WIDTH - 1).to_le_bytes()[..3]);
        vp8x[7..10].copy_from_slice(&(EXPECTED_HEIGHT - 1).to_le_bytes()[..3]);
        append_chunk(&mut body, b"VP8X", &vp8x);
        append_chunk(&mut body, b"ANIM", &[0, 0, 0, 0, 0, 0]);
        let mut frame_data = vec![0_u8; 16];
        frame_data[6..9].copy_from_slice(&(EXPECTED_WIDTH - 1).to_le_bytes()[..3]);
        frame_data[9..12].copy_from_slice(&(EXPECTED_HEIGHT - 1).to_le_bytes()[..3]);
        frame_data[12..15].copy_from_slice(&100_u32.to_le_bytes()[..3]);
        frame_data.extend_from_slice(&frame[12..]);
        append_chunk(&mut body, b"ANMF", &frame_data);
        let mut bytes = Vec::with_capacity(12 + body.len());
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&u32::try_from(body.len() + 4).unwrap().to_le_bytes());
        bytes.extend_from_slice(b"WEBP");
        bytes.extend_from_slice(&body);
        bytes
    }

    fn write_pet(root: &Path, id: &str) -> PathBuf {
        let package = root.join(id);
        fs::create_dir_all(&package).unwrap();
        fs::write(
            package.join(MANIFEST_NAME),
            format!(
                r#"{{"id":"{id}","displayName":"Pet {id}","description":"A test pet.","spritesheetPath":"spritesheet.webp"}}"#
            ),
        )
        .unwrap();
        fs::write(package.join(SPRITESHEET_NAME), valid_webp()).unwrap();
        package
    }

    #[test]
    fn validates_complete_static_webp_and_rejects_animation() {
        assert_eq!(
            validate_webp(&valid_webp()).unwrap(),
            (EXPECTED_WIDTH, EXPECTED_HEIGHT)
        );
        let error = validate_webp(&animated_webp()).unwrap_err();
        assert_eq!(error.code, "animated-webp");
    }

    #[test]
    fn rejects_truncated_payload_wrong_dimensions_and_invalid_transparency() {
        let valid = valid_webp();
        assert!(validate_webp(&valid[..30]).is_err());
        assert!(validate_webp(b"not webp").is_err());
        assert_eq!(
            validate_webp(&encode_webp(192, 208, 7)).unwrap_err().code,
            "invalid-dimensions"
        );
        let mut rgb = Vec::new();
        WebPEncoder::new_lossless(&mut rgb)
            .encode(
                &vec![0_u8; EXPECTED_WIDTH as usize * EXPECTED_HEIGHT as usize * 3],
                EXPECTED_WIDTH,
                EXPECTED_HEIGHT,
                ExtendedColorType::Rgb8,
            )
            .unwrap();
        assert_eq!(validate_webp(&rgb).unwrap_err().code, "missing-alpha");
        assert_eq!(
            validate_webp(&opaque_rgba_webp()).unwrap_err().code,
            "opaque-unused-cells"
        );
    }

    #[test]
    fn catalog_keeps_valid_pets_and_reports_bad_packages() {
        let tree = TempTree::new();
        let root = tree.pets();
        fs::create_dir_all(&root).unwrap();
        write_pet(&root, "good-pet");
        write_pet(&root, "Bad Pet");
        fs::write(root.join("plain-file"), b"not a package").unwrap();
        fs::write(
            tree.0.join("config.toml"),
            "[desktop]\nselected-avatar-id = \"custom:good-pet\"\n",
        )
        .unwrap();
        let catalog = list_catalog_at(PetsLocation {
            codex_home: tree.0.clone(),
            display_path: root.clone(),
            root: Some(fs::canonicalize(&root).unwrap()),
        })
        .unwrap();
        assert_eq!(catalog.pets.len(), 1);
        assert_eq!(catalog.pets[0].id, "good-pet");
        assert_eq!(catalog.selected_pet_id.as_deref(), Some("good-pet"));
        assert_eq!(catalog.invalid_entries.len(), 2);
        assert!(catalog
            .invalid_entries
            .iter()
            .any(|entry| entry.code == "invalid-id"));
    }

    #[test]
    fn manifest_is_strict_and_cannot_escape_the_package() {
        let tree = TempTree::new();
        let root = tree.pets();
        fs::create_dir_all(&root).unwrap();
        let package = write_pet(&root, "safe-pet");
        fs::write(
            package.join(MANIFEST_NAME),
            r#"{"id":"safe-pet","displayName":"Safe","description":"Safe.","spritesheetPath":"../outside.webp"}"#,
        )
        .unwrap();
        let error = validate_package(&fs::canonicalize(&root).unwrap(), "safe-pet")
            .err()
            .unwrap();
        assert_eq!(error.code, "path-escape");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_packages_and_spritesheets() {
        use std::os::unix::fs::symlink;

        let tree = TempTree::new();
        let root = tree.pets();
        fs::create_dir_all(&root).unwrap();
        let real = write_pet(&root, "real-pet");
        symlink(&real, root.join("linked-pet")).unwrap();
        let error = validate_package(&fs::canonicalize(&root).unwrap(), "linked-pet")
            .err()
            .unwrap();
        assert_eq!(error.code, "symlink");

        let package = write_pet(&root, "sheet-link");
        let outside = tree.0.join("outside.webp");
        fs::write(&outside, valid_webp()).unwrap();
        fs::remove_file(package.join(SPRITESHEET_NAME)).unwrap();
        symlink(outside, package.join(SPRITESHEET_NAME)).unwrap();
        let error = validate_package(&fs::canonicalize(&root).unwrap(), "sheet-link")
            .err()
            .unwrap();
        assert_eq!(error.code, "symlink");
    }

    #[cfg(unix)]
    #[test]
    fn opened_package_handle_is_not_redirected_by_path_replacement() {
        let tree = TempTree::new();
        let root = tree.pets();
        fs::create_dir_all(&root).unwrap();
        let package = write_pet(&root, "stable-pet");
        let canonical_root = fs::canonicalize(&root).unwrap();
        let root_handle = open_directory_no_follow(&canonical_root).unwrap();
        let package_handle = open_child_no_follow(&root_handle, "stable-pet", true).unwrap();

        let moved = root.join("moved-original");
        fs::rename(&package, &moved).unwrap();
        let replacement = write_pet(&root, "stable-pet");
        fs::write(
            replacement.join(MANIFEST_NAME),
            r#"{"id":"stable-pet","displayName":"Replacement","description":"Replacement.","spritesheetPath":"spritesheet.webp"}"#,
        )
        .unwrap();

        let (manifest, metadata) =
            open_pet_regular_file(&package_handle, MANIFEST_NAME, MANIFEST_NAME).unwrap();
        let bytes =
            read_open_pet_file(manifest, &metadata, MAX_MANIFEST_BYTES, MANIFEST_NAME).unwrap();
        let original: PetManifest = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(original.display_name, "Pet stable-pet");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_fifo_pet_files_without_blocking() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;

        let tree = TempTree::new();
        let root = tree.pets();
        fs::create_dir_all(&root).unwrap();
        let package = root.join("fifo-pet");
        fs::create_dir(&package).unwrap();
        let manifest = package.join(MANIFEST_NAME);
        let manifest = CString::new(manifest.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(manifest.as_ptr(), 0o600) }, 0);

        let error = validate_package(&fs::canonicalize(&root).unwrap(), "fifo-pet")
            .err()
            .unwrap();
        assert_eq!(error.code, "invalid-file");
    }

    #[cfg(unix)]
    #[test]
    fn only_enoent_is_reported_as_a_missing_pet_file() {
        let tree = TempTree::new();
        let root = tree.pets();
        fs::create_dir_all(&root).unwrap();
        let package = write_pet(&root, "error-pet");
        let package = open_directory_no_follow(&package).unwrap();

        let missing = open_pet_regular_file(&package, "absent.webp", "missing sprite")
            .err()
            .unwrap();
        assert_eq!(missing.code, "missing-file");

        let permission_denied = std::io::Error::from_raw_os_error(libc::EACCES);
        assert_eq!(
            classify_pet_file_open_error(&package, "absent.webp", &permission_denied),
            "read-failed"
        );
    }

    #[test]
    fn rejects_oversized_manifest_and_spritesheet_before_reading() {
        let tree = TempTree::new();
        let root = tree.pets();
        fs::create_dir_all(&root).unwrap();
        let package = write_pet(&root, "large-pet");
        File::create(package.join(MANIFEST_NAME))
            .unwrap()
            .set_len(MAX_MANIFEST_BYTES + 1)
            .unwrap();
        let error = validate_package(&fs::canonicalize(&root).unwrap(), "large-pet")
            .err()
            .unwrap();
        assert_eq!(error.code, "manifest-too-large");

        fs::write(
            package.join(MANIFEST_NAME),
            r#"{"id":"large-pet","displayName":"Large","description":"Large.","spritesheetPath":"spritesheet.webp"}"#,
        )
        .unwrap();
        File::create(package.join(SPRITESHEET_NAME))
            .unwrap()
            .set_len(MAX_SPRITESHEET_BYTES + 1)
            .unwrap();
        let error = validate_package(&fs::canonicalize(&root).unwrap(), "large-pet")
            .err()
            .unwrap();
        assert_eq!(error.code, "spritesheet-too-large");
    }

    #[test]
    fn load_revalidates_expected_version_and_returns_exact_webp_bytes() {
        let tree = TempTree::new();
        let root = tree.pets();
        fs::create_dir_all(&root).unwrap();
        let package = write_pet(&root, "load-pet");
        let root = fs::canonicalize(root).unwrap();
        let validated = validate_package(&root, "load-pet").unwrap();
        let bytes = load_pet_bytes_at(&root, "load-pet", &validated.metadata.version).unwrap();
        assert_eq!(bytes, fs::read(package.join(SPRITESHEET_NAME)).unwrap());
        assert!(load_pet_bytes_at(&root, "load-pet", "stale").is_err());
    }

    #[test]
    fn content_version_changes_for_equal_length_bytes() {
        assert_ne!(version_for(b"same-size-a"), version_for(b"same-size-b"));
    }

    #[test]
    fn selected_pet_only_accepts_valid_custom_id_in_desktop_section() {
        let ids = HashSet::from(["papaluo"]);
        assert_eq!(
            parse_selected_pet(
                "selected-avatar-id = \"custom:outside\"\n[desktop]\nselected-avatar-id = \"custom:papaluo\"\n",
                &ids,
            ),
            Some("papaluo".to_string())
        );
        assert_eq!(
            parse_selected_pet(
                "[desktop]\nselected-avatar-id = \"custom:../papaluo\"\n",
                &ids,
            ),
            None
        );
        assert_eq!(
            parse_selected_pet("[other]\nselected-avatar-id = \"custom:papaluo\"\n", &ids,),
            None
        );
    }
}
