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

Do not add renderer-root outer margin, padding, gutter, fake black frame, or
`calc(100% - 16px)` shell sizing. WebView content must sit flush to the drawable
area; spacing belongs inside panels, rails, and toolbar regions.

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

## AI Runtime Policy (hard rule)

- Pi Agent is the only active runtime. Offisim must not restore a provider/model
  catalog, runtime provider profiles, Claude/Codex sidecars, or OpenAI Agents SDK
  lane as the main execution path.
- Settings may only express Pi Agent account/runtime/model config state,
  including safe summaries and entry points for Pi-owned `~/.pi/agent/auth.json`
  and `models.json`.
- Any future Claude/Codex return must be a mutually exclusive runtime-engine
  replacement with independent release `.app` evidence, not a provider lane
  inside Pi Agent.

## Prelaunch / Vibe-Coding Debt Guard

- Current stage: Offisim is confirmed prelaunch: no real users, production data,
  or historical compatibility contract. Do not add migrations, compatibility,
  fallback, or minimal patches for old local state.
- Even after a large cleanup, the clean state is still only the prelaunch
  baseline, not a post-launch compatibility contract. Future agents must not
  reintroduce production migration, historical compatibility, rollout, or
  fallback debt just because the project was previously cleaned.
- Prelaunch does not mean MVP shortcuts. Complete the requested product behavior
  directly and verify it; do not ship "temporary", "minimal viable", or
  "we'll migrate later" patches as completion.
- When touching `legacy`, `compat`, `fallback`, `migration`, `backfill`,
  `rollout`, `temporary`, or `post-launch` surfaces, classify the boundary first.
  Real local data, external contracts, security, Pi wire, MCP, package formats,
  deep links, and project-file sandboxing default to retain; false production
  assumptions go through the prelaunch convergence loop and the smallest
  appropriate child loop.
- Local SQLite fact: the current `LOCAL_SCHEMA_VERSION` lives in
  `apps/desktop/src-tauri/src/local_db.rs` (single truth source — do not restate
  the number in docs); fresh databases apply the
  current baseline `schema.sql`. `packages/db-local/src/migrations/` intentionally
  contains no historical migration SQL. Old local databases are disposable
  prelaunch artifacts and should be deleted/rebuilt, not upgraded.
- Policy source: `Docs/architecture/2026-07-02-prelaunch-vibe-debt-policy.md`.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Offisim** (12856 symbols, 27448 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

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
