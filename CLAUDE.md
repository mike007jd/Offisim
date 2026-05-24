# Offisim Working Notes

## Current Shape

Offisim is Tauri-only desktop plus the platform/registry backend. The desktop
renderer at `apps/desktop/renderer` is now a clean React mount point for the
incoming design system.

The old UI framework has been removed:

- no `packages/ui-office`
- no `packages/ui-core`
- no Tailwind/shadcn renderer setup
- no old desktop renderer shell, workspace router, office shell, or UI hooks

Do not restore those packages, aliases, generated theme CSS, old component
trees, or old release instructions. New UI work should build from the renderer
mount point and the design source under `Docs/design`.

## Build And Verification

- Renderer only: `pnpm --filter @offisim/desktop-renderer typecheck && pnpm --filter @offisim/desktop-renderer build`
- Desktop release: `pnpm --filter @offisim/desktop build`
- Desktop live verification must use the exact release `.app` path from the
  current worktree: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Dev webviews, localhost browser checks, and bundle-id launches are not release
  verification.

## Runtime Boundaries

- Core runtime, model transport, local tools, SQLite, install contracts, and
  platform APIs remain outside the UI cleanup.
- Project workspace file browsing must continue to go through the sandboxed
  Tauri commands `project_list_dir`, `project_read_file`, and
  `project_read_file_preview`.
- Model/tool execution must continue through the Offisim harness/gateway path;
  external A2A and unverified model transports must not masquerade as local
  tool executors.
