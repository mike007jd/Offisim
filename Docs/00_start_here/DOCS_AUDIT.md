# Docs Audit

**Bundle status:** reviewed and normalized  
**Version:** v2  
**Scope:** repo-level guidance files, specs, contracts, migrations, runtime-experience docs

## What was checked

- folder structure under root, `spec/`, and `Docs/`
- entrypoint files for AI tools (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`)
- start-here documentation and file index
- references to contracts and runtime-experience docs
- duplicate and stale files

## Problems found in the incoming archive

1. No root `README.md`, which made first-read onboarding weaker for AI agents.
2. Agent entry files referenced `/contracts/...`, but the actual contract files live under `Docs/02_contracts_and_schemas/`.
3. `Docs/00_start_here/README.md` referenced non-existent `04_archive/` and `05_original_inputs/` folders.
4. `Docs/00_start_here/FILE_INDEX.txt` included stale entries and duplicate contract references.
5. `Docs/AICS_RUNTIME_EXPERIENCE_GDD.md` was correct content-wise but sat as a loose file instead of being grouped with related runtime-experience docs.
6. The bundle was missing the implementation companions needed after the GDD: a scene-state matrix and an animation backlog.
7. The incoming archive included macOS artifact files (`__MACOSX`, `.DS_Store`, `._*`).
8. `Docs/03_migrations/` contained duplicate copies of OpenAPI and install-state-machine files that are already canonical under `Docs/02_contracts_and_schemas/`.

## Actions taken

- added a root `README.md`
- normalized all AI-entry files to the real folder layout
- created `Docs/04_runtime_experience/`
- moved `AICS_RUNTIME_EXPERIENCE_GDD.md` into that folder
- added `SCENE_STATE_MATRIX.md`
- added `ANIMATION_BACKLOG.md`
- removed duplicate non-migration files from `Docs/03_migrations/`
- removed macOS archive junk
- refreshed `Docs/00_start_here/README.md`
- regenerated `Docs/00_start_here/FILE_INDEX.txt`

## Current recommended structure

- root guidance in `/README.md` and AI entry files
- rules in `/spec`
- machine-readable contracts in `Docs/02_contracts_and_schemas`
- migrations in `Docs/03_migrations`
- scene / animation / presentation docs in `Docs/04_runtime_experience`

## Remaining note

The docs are now coherent enough for AI task decomposition and repo bootstrapping.
The next most useful additions, if needed, would be:

- a renderer package README once code exists
- an app/package-level ownership map once the monorepo skeleton is created
