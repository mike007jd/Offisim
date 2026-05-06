# Release Review Note — GitNexus Critical Scope

Date: 2026-05-06
Base reviewed: `96c9c851`
Current head reviewed: `adaf6de8`

## Decision

The GitNexus `critical` result for `96c9c851..adaf6de8` is a large-diff review signal, not a current uncommitted runtime blocker.

The release should be reviewed commit-by-commit instead of as one undifferentiated diff. The Markdown rendering dependency expansion was removed before commit and is not part of the shipped diff.

## Current GitNexus State

- `npx gitnexus analyze` refreshed the index successfully.
- `npx gitnexus status` reports indexed commit `adaf6de` and status `up-to-date`.
- `npx gitnexus detect-changes --scope compare --base-ref 96c9c851 --repo Offisim` reports:
  - 106 files
  - 153 symbols
  - 49 affected processes
  - risk level `critical`

## Commit Boundaries

- `cd59d931 chore: add GitNexus repo guidance`
  - Adds project-local GitNexus instructions and ignores the generated `.gitnexus` index directory.
- `7bd5fdb2 fix(release): harden desktop app metadata and launch`
  - Aligns desktop and launcher release versions to `1.0.0-rc.1`.
  - Removes desktop `unsafe-eval` from the release CSP.
  - Builds app-only desktop bundles for release verification.
  - Hardens macOS foreground/window restore behavior for release app validation.
- `d7484b29 fix(runtime): preserve boss summary evidence`
  - Removes company workspace root fallback from Tauri runtime workspace resolution.
  - Preserves boss summary outputs after step advancement.
  - Adds deterministic harness coverage for persisted step results and artifact-only outputs.
- `adaf6de8 chore: clean lint findings`
  - Cleans historical Biome/lint issues across UI, runtime, scripts, and doc-engine surfaces.
  - This commit is the main reason the file count remains large.

## Release Evidence

- `pnpm lint` passed.
- `pnpm typecheck` passed.
- `pnpm harness:deterministic` passed.
- `pnpm tokens:check && pnpm tokens:lint-hex` passed.
- `cargo test --workspace --no-run` passed in `apps/desktop/src-tauri`.
- `pnpm --filter @offisim/ui-office build` passed.
- `pnpm --filter @offisim/desktop build` passed.
- Release `.app` codesign verification passed.
- Computer Use attached to the exact release app at `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`; the app reached `READY` and showed `v1.0.0-rc.1`.

## Review Guidance

Treat the GitNexus `critical` result as a required review checklist item:

- Review `7bd5fdb2` for release metadata, CSP, and macOS window behavior.
- Review `d7484b29` for runtime workspace-root semantics and boss-summary completion evidence.
- Review `adaf6de8` as lint cleanup; focus on accidental behavior changes in files touched by formatting or analyzer fixes.
- Do not treat the removed Markdown rendering dependency as part of this release scope; `react-markdown`, `remark-gfm`, and `MarkdownContent` have no repository residue in the reviewed state.
