# Docs / Start Here

This folder is the fast entrypoint for humans and AI agents.

If you are new to the repository, read in this order:

1. `/README.md`
2. `/AGENTS.md` (or `/CLAUDE.md`, `/GEMINI.md` depending on tool)
3. `/spec/PROJECT_CONSTITUTION.md`
4. the rest of `/spec`
5. `/Docs/02_contracts_and_schemas/`
6. `/Docs/01_current_specs/`
7. `/Docs/04_runtime_experience/` when the task touches office scene, motion, install trust presentation, or rich runtime feedback
8. `/Docs/03_migrations/` when the task touches persistence

## Folder guide

- `00_start_here/` — entrypoint, audit notes, and file index
- `01_current_specs/` — current PRD, Tech Stack, and Asset/Schema spec
- `02_contracts_and_schemas/` — machine-readable contracts and canonical schema files
- `03_migrations/` — extracted migration sequences for local runtime and platform registry
- `04_runtime_experience/` — game-grade presentation docs for the non-game runtime

## Canonical files

- PRD: `01_current_specs/AI_Company_Simulator_PRD_v1.6_updated.docx`
- Tech Stack: `01_current_specs/AI_Company_Simulator_TechStack_v1.5_updated.docx`
- Asset & Schema Spec: `01_current_specs/AI_Company_Simulator_Asset_and_Schema_Spec_v0.1.docx`
- OpenAPI: `02_contracts_and_schemas/aics_openapi.yaml`
- Install State Machine: `02_contracts_and_schemas/aics_install_state_machine.md`
- Manifest Schema: `02_contracts_and_schemas/aics_manifest.schema.json`
- Runtime Experience GDD: `04_runtime_experience/AICS_RUNTIME_EXPERIENCE_GDD.md`
- Scene State Matrix: `04_runtime_experience/SCENE_STATE_MATRIX.md`
- Animation Backlog: `04_runtime_experience/ANIMATION_BACKLOG.md`

## Notes

- Contract files in `02_contracts_and_schemas/` are canonical.
- `03_migrations/` should only contain migration sequences and migration READMEs.
- Scene/animation implementation should read the GDD first, then the state matrix, then the backlog.
