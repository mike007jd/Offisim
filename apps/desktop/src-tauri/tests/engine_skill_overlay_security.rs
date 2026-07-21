mod local_paths {
    use std::path::PathBuf;

    pub(crate) fn offisim_storage_dir(_name: &str) -> Result<PathBuf, String> {
        Err("vault paths are not used by this focused harness".into())
    }
}

#[path = "../src/engine_skill_overlay.rs"]
mod engine_skill_overlay;

#[cfg(unix)]
#[test]
fn overlay_root_replacement_fails_closed_without_writing_to_the_replacement() {
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::sync::{Arc, Mutex};

    let outside = std::env::temp_dir().join(format!(
        "offisim-overlay-replacement-outside-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&outside);
    fs::create_dir(&outside).unwrap();
    let replaced_paths = Arc::new(Mutex::new(None));
    let replaced_paths_from_hook = Arc::clone(&replaced_paths);
    let outside_from_hook = outside.clone();
    engine_skill_overlay::set_after_overlay_root_opened_hook(move |root| {
        let original = root.with_extension("opened");
        fs::rename(root, &original).unwrap();
        symlink(&outside_from_hook, root).unwrap();
        *replaced_paths_from_hook.lock().unwrap() = Some((root.to_path_buf(), original));
    });

    let result = engine_skill_overlay::materialize_engine_context_overlay(
        &[],
        engine_skill_overlay::EngineSkillOverlayKind::CodexHome,
        Some("trusted project experience"),
    );

    assert!(result.is_err(), "a replaced overlay root must fail closed");
    assert!(
        !outside.join("OFFISIM_PROJECT_EXPERIENCE.md").exists(),
        "descriptor-anchored writes must not reach the replacement"
    );
    if let Some((live, original)) = replaced_paths.lock().unwrap().take() {
        let _ = fs::remove_file(live);
        let _ = fs::remove_dir_all(original);
    }
    let _ = fs::remove_dir_all(outside);
}

#[cfg(unix)]
#[test]
fn overlay_descendant_replacement_fails_closed_without_writing_to_the_replacement() {
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::sync::{Arc, Mutex};

    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let source_root = std::env::temp_dir().join(format!(
        "offisim-overlay-replacement-source-{}-{suffix}",
        std::process::id()
    ));
    let outside = std::env::temp_dir().join(format!(
        "offisim-overlay-replacement-descendant-{}-{suffix}",
        std::process::id()
    ));
    let skill = source_root.join(".agents/skills/live/SKILL.md");
    fs::create_dir_all(skill.parent().unwrap()).unwrap();
    fs::write(&skill, "---\nname: live\ndescription: live\n---\ntrusted").unwrap();
    fs::create_dir(&outside).unwrap();
    let skills = engine_skill_overlay::resolve_engine_skill_paths(
        &source_root,
        None,
        Some(&[".agents/skills/live/SKILL.md".into()]),
    )
    .unwrap();
    let replaced_paths = Arc::new(Mutex::new(None));
    let replaced_paths_from_hook = Arc::clone(&replaced_paths);
    let outside_from_hook = outside.clone();
    engine_skill_overlay::set_after_overlay_skills_root_opened_hook(move |skills_root| {
        let original = skills_root.with_extension("opened");
        fs::rename(skills_root, &original).unwrap();
        symlink(&outside_from_hook, skills_root).unwrap();
        *replaced_paths_from_hook.lock().unwrap() = Some((skills_root.to_path_buf(), original));
    });

    let result = engine_skill_overlay::materialize_engine_context_overlay(
        &skills,
        engine_skill_overlay::EngineSkillOverlayKind::CodexHome,
        None,
    );

    assert!(
        result.is_err(),
        "a replaced overlay descendant must fail closed"
    );
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
    if let Some((live, original)) = replaced_paths.lock().unwrap().take() {
        let overlay_root = live.parent().unwrap().parent().unwrap().to_path_buf();
        let _ = fs::remove_file(live);
        let _ = fs::remove_dir_all(original);
        let _ = fs::remove_dir_all(overlay_root);
    }
    drop(skills);
    let _ = fs::remove_dir_all(source_root);
    let _ = fs::remove_dir_all(outside);
}
