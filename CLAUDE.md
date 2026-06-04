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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Offisim** (15015 symbols, 26114 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Offisim/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Offisim/clusters` | All functional areas |
| `gitnexus://repo/Offisim/processes` | All execution flows |
| `gitnexus://repo/Offisim/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
