mod local_paths {
    use std::path::PathBuf;

    pub(crate) fn offisim_storage_dir(_name: &str) -> Result<PathBuf, String> {
        Err("vault paths are not used by this focused harness".into())
    }
}

#[path = "../src/engine_skill_overlay.rs"]
mod engine_skill_overlay;
