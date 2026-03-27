# Docs / Start Here

This folder is the fast entrypoint for humans and AI agents.

If you are new to the repository, read in this order:

1. `/README.md`
2. `/spec/PROJECT_CONSTITUTION.md`
3. the rest of `/spec`
4. `/Docs/02_contracts_and_schemas/`
5. `/Docs/04_runtime_experience/` when the task touches office scene, motion, install trust presentation, or rich runtime feedback
6. `/Docs/03_migrations/` when the task touches persistence

## Folder guide

- `00_start_here/` — entrypoint and reading guide
- `02_contracts_and_schemas/` — machine-readable contracts and current schema snapshots
- `03_migrations/` — extracted migration sequences for local runtime and platform registry
- `04_runtime_experience/` — game-grade presentation docs for the non-game runtime

## Canonical files

- OpenAPI: `02_contracts_and_schemas/offisim_openapi.yaml`
- Install State Machine: `02_contracts_and_schemas/offisim_install_state_machine.md`
- Manifest Schema: `02_contracts_and_schemas/offisim_manifest.schema.json`
- Runtime Experience GDD: `04_runtime_experience/OFFISIM_RUNTIME_EXPERIENCE_GDD.md`
- Scene State Matrix: `04_runtime_experience/SCENE_STATE_MATRIX.md`
- Animation Backlog: `04_runtime_experience/ANIMATION_BACKLOG.md`

## Notes

- Contract files in `02_contracts_and_schemas/` should stay aligned with the mounted routes and Drizzle schema; when they drift, code wins.
- `03_migrations/` should only contain migration sequences and migration READMEs.
- Scene/animation implementation should read the GDD first, then the state matrix, then the backlog.
