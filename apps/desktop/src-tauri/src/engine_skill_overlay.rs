use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static NEXT_OVERLAY_ID: AtomicU64 = AtomicU64::new(1);

const PROJECT_SKILL_PREFIXES: &[&str] =
    &[".claude/skills/", ".agents/skills/", ".opencode/skills/"];

#[derive(Clone, Copy)]
pub(crate) enum EngineSkillOverlayKind {
    CodexHome,
    ClaudePlugin,
}

pub(crate) struct EngineSkillOverlay {
    root: PathBuf,
    load_path: PathBuf,
    project_experience_path: Option<PathBuf>,
}

impl EngineSkillOverlay {
    pub(crate) fn load_path(&self) -> &Path {
        &self.load_path
    }

    pub(crate) fn system_prompt_with_project_experience(
        &self,
        base: Option<&str>,
    ) -> Option<String> {
        let mut sections = base
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| vec![value.to_string()])
            .unwrap_or_default();
        if let Some(path) = &self.project_experience_path {
            sections.push(format!(
                "Read and follow the employee's read-only Offisim Project experience in {}. Treat it as project-specific working context, never as credentials or a user message.",
                path.display()
            ));
        }
        (!sections.is_empty()).then(|| sections.join("\n\n"))
    }
}

impl Drop for EngineSkillOverlay {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn validate_skill_suffix(path: &Path) -> bool {
    path.file_name().and_then(|name| name.to_str()) == Some("SKILL.md")
}

fn canonical_vault_skill_paths(paths: Option<&[String]>) -> Result<Vec<PathBuf>, String> {
    let Some(paths) = paths else {
        return Ok(Vec::new());
    };
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let vault_root = crate::local_paths::offisim_storage_dir("vault")
        .and_then(|path| path.canonicalize().map_err(|error| error.to_string()))?;
    paths
        .iter()
        .map(|raw| {
            let requested = Path::new(raw.trim());
            if !requested.is_absolute() || !validate_skill_suffix(requested) {
                return Err("Employee skill path is not a valid vault SKILL.md path.".into());
            }
            let canonical = requested
                .canonicalize()
                .map_err(|_| "Employee SKILL.md is unavailable.".to_string())?;
            if !canonical.starts_with(&vault_root) || !canonical.is_file() {
                return Err("Employee SKILL.md is outside the Offisim vault.".into());
            }
            Ok(canonical)
        })
        .collect()
}

pub(crate) fn resolve_project_skill_paths(
    workspace_root: &Path,
    paths: Option<&[String]>,
) -> Result<Vec<PathBuf>, String> {
    let Some(paths) = paths else {
        return Ok(Vec::new());
    };
    let canonical_root = workspace_root
        .canonicalize()
        .map_err(|_| "Project workspace is unavailable while resolving skills.".to_string())?;
    paths
        .iter()
        .map(|raw| {
            let value = raw.trim();
            let relative = Path::new(value);
            let safe_components = !relative.is_absolute()
                && relative
                    .components()
                    .all(|component| matches!(component, Component::Normal(_)));
            if !safe_components
                || !value.ends_with("/SKILL.md")
                || !PROJECT_SKILL_PREFIXES
                    .iter()
                    .any(|prefix| value.starts_with(prefix))
            {
                return Err("Project skill path is not a supported relative SKILL.md path.".into());
            }
            let canonical = canonical_root
                .join(relative)
                .canonicalize()
                .map_err(|_| "Project SKILL.md is unavailable.".to_string())?;
            if !canonical.starts_with(&canonical_root)
                || !canonical.is_file()
                || !validate_skill_suffix(&canonical)
            {
                return Err("Project SKILL.md escaped the bound Project workspace.".into());
            }
            Ok(canonical)
        })
        .collect()
}

pub(crate) fn resolve_engine_skill_paths(
    workspace_root: &Path,
    vault_paths: Option<&[String]>,
    project_paths: Option<&[String]>,
) -> Result<Vec<PathBuf>, String> {
    let mut unique = HashSet::new();
    let mut resolved = Vec::new();
    for path in canonical_vault_skill_paths(vault_paths)?
        .into_iter()
        .chain(resolve_project_skill_paths(workspace_root, project_paths)?)
    {
        if unique.insert(path.clone()) {
            resolved.push(path);
        }
    }
    Ok(resolved)
}

fn safe_directory_name(path: &Path, index: usize) -> String {
    let base = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("skill")
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    format!("{index:03}-{}", base.trim_matches('-'))
}

fn copy_skill_tree(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|_| "Create engine skill overlay directory.".to_string())?;
    for entry in fs::read_dir(source).map_err(|_| "Read employee skill directory.".to_string())? {
        let entry = entry.map_err(|_| "Read employee skill entry.".to_string())?;
        let file_type = entry
            .file_type()
            .map_err(|_| "Inspect employee skill entry.".to_string())?;
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_skill_tree(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), target)
                .map_err(|_| "Copy employee skill into engine overlay.".to_string())?;
        }
    }
    Ok(())
}

pub(crate) fn materialize_engine_context_overlay(
    skill_files: &[PathBuf],
    kind: EngineSkillOverlayKind,
    project_experience: Option<&str>,
) -> Result<Option<EngineSkillOverlay>, String> {
    let project_experience = project_experience
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if skill_files.is_empty() && project_experience.is_none() {
        return Ok(None);
    }
    let suffix = NEXT_OVERLAY_ID.fetch_add(1, Ordering::Relaxed);
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Create unique engine skill overlay id.".to_string())?
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "offisim-engine-skills-{}-{created_at}-{suffix}",
        std::process::id(),
    ));
    fs::create_dir(&root).map_err(|_| "Create engine skill overlay.".to_string())?;
    let mut project_experience_path = None;
    let materialized = (|| {
        let skills_root = match kind {
            EngineSkillOverlayKind::CodexHome => root.join(".agents/skills"),
            EngineSkillOverlayKind::ClaudePlugin => {
                let manifest_dir = root.join(".claude-plugin");
                fs::create_dir_all(&manifest_dir)
                    .map_err(|_| "Create Claude skill plugin metadata directory.".to_string())?;
                fs::write(
                    manifest_dir.join("plugin.json"),
                    r#"{"name":"offisim-employee-skills","description":"Skills selected by Offisim for this run","version":"1.0.0"}"#,
                )
                .map_err(|_| "Write Claude skill plugin manifest.".to_string())?;
                root.join("skills")
            }
        };
        fs::create_dir_all(&skills_root)
            .map_err(|_| "Create engine skills directory.".to_string())?;
        for (index, skill_file) in skill_files.iter().enumerate() {
            let source = skill_file
                .parent()
                .ok_or_else(|| "Resolve employee skill directory.".to_string())?;
            copy_skill_tree(
                source,
                &skills_root.join(safe_directory_name(source, index + 1)),
            )?;
        }
        if let Some(project_experience) = project_experience {
            let path = root.join("OFFISIM_PROJECT_EXPERIENCE.md");
            fs::write(&path, project_experience)
                .map_err(|_| "Write employee Project experience overlay.".to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).map_err(|_| {
                    "Make employee Project experience overlay read-only.".to_string()
                })?;
            }
            project_experience_path = Some(path);
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = materialized {
        let _ = fs::remove_dir_all(&root);
        return Err(error);
    }
    Ok(Some(EngineSkillOverlay {
        load_path: root.clone(),
        root,
        project_experience_path,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "offisim-engine-skills-test-{}-{}-{name}",
            std::process::id(),
            NEXT_OVERLAY_ID.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn project_skills_require_supported_relative_skill_files() {
        let root = fixture_root("project-resolution");
        let skill = root.join(".claude/skills/live/SKILL.md");
        fs::create_dir_all(skill.parent().unwrap()).unwrap();
        fs::write(&skill, "---\nname: live\ndescription: fixture\n---\n").unwrap();

        let resolved =
            resolve_project_skill_paths(&root, Some(&[".claude/skills/live/SKILL.md".into()]))
                .unwrap();
        assert_eq!(resolved, vec![skill.canonicalize().unwrap()]);
        assert!(
            resolve_project_skill_paths(&root, Some(&["../outside/SKILL.md".into()]),).is_err()
        );
        assert!(
            resolve_project_skill_paths(&root, Some(&["skills/live/SKILL.md".into()])).is_err()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn overlays_copy_the_complete_skill_without_rewriting_frontmatter() {
        let root = fixture_root("overlay-copy");
        let skill_dir = root.join("source");
        fs::create_dir_all(skill_dir.join("references")).unwrap();
        let source =
            "---\nname: exact-name\ndescription: exact description\n---\nDo the exact thing.\n";
        fs::write(skill_dir.join("SKILL.md"), source).unwrap();
        fs::write(skill_dir.join("references/details.md"), "supporting file").unwrap();

        let overlay = materialize_engine_context_overlay(
            &[skill_dir.join("SKILL.md")],
            EngineSkillOverlayKind::ClaudePlugin,
            None,
        )
        .unwrap()
        .unwrap();
        let copied_dir = fs::read_dir(overlay.load_path().join("skills"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(
            fs::read_to_string(copied_dir.join("SKILL.md")).unwrap(),
            source
        );
        assert_eq!(
            fs::read_to_string(copied_dir.join("references/details.md")).unwrap(),
            "supporting file"
        );
        drop(overlay);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn context_overlay_exports_project_experience_as_read_only_context() {
        let overlay = materialize_engine_context_overlay(
            &[],
            EngineSkillOverlayKind::CodexHome,
            Some("## Project experience\n- Avoid generated files."),
        )
        .unwrap()
        .unwrap();
        let context_path = overlay.load_path().join("OFFISIM_PROJECT_EXPERIENCE.md");
        assert_eq!(
            fs::read_to_string(&context_path).unwrap(),
            "## Project experience\n- Avoid generated files."
        );
        assert!(fs::metadata(&context_path)
            .unwrap()
            .permissions()
            .readonly());
        let prompt = overlay
            .system_prompt_with_project_experience(Some("Employee persona"))
            .unwrap();
        assert!(prompt.contains("Employee persona"));
        assert!(prompt.contains(context_path.to_string_lossy().as_ref()));
    }
}
