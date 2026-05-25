# Offisim Working Notes

## Current Shape

Offisim is Tauri-only desktop plus the platform/registry backend. The desktop
renderer at `apps/desktop/renderer` owns the new UI framework and design-system
implementation.

New UI work must follow `Docs/UI_FRAMEWORK_STACK.md` and the design source under
`Docs/design`. The approved stack is React 19, Tailwind CSS v4, shadcn/ui,
assistant-ui, Motion for React (`motion/react`), lucide-react, TanStack Query,
Zustand, React Hook Form + Zod, dnd-kit, TanStack Virtual,
react-resizable-panels, cmdk, Sonner, and Recharts for small runtime charts.

Do not create a standalone web product or a shared visual UI package. Visual
components, styling, motion, assistant surface composition, and desktop layout
ownership stay inside `apps/desktop/renderer`.

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
