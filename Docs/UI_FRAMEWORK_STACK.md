# Offisim UI Framework Stack

Last updated: 2026-07-13

This is the source of truth for new Offisim desktop UI work. The canonical
design source is `Docs/design/.v3-dna-brief.md` plus the Office V3 specimen.
Other HTML prototypes with a visible superseded banner are historical reference
only; current production code and the active task package own their behavior.

## Product Direction

Offisim UI is a dense desktop workbench, not a SaaS dashboard or marketing surface. The canonical design language is the V3 DNA in `Docs/design/.v3-dna-brief.md`: evidence-dense game HUD, unified shell, chip grammar, caps labels, compact cards, no bell-count chrome, no Office right-rail tabs, and no generic hero surfaces.

The product shell is engine-neutral: Offisim owns the GUI, assistant-ui skin, 3D work theater, account/model selection, and archive surfaces. The selected native engine owns execution, credentials, native sessions, compaction, global memory, tools, and its stream protocol. API and Codex are release-verified complete engines; Claude must not appear supported until its complete engine adapter passes release verification.

## Ownership

All new UI framework code lives under `apps/desktop/renderer`.

Do not recreate a shared UI package for the new app. Shared packages may expose typed runtime/data contracts, but visual components, styling, motion, assistant surface composition, and desktop layout ownership stay with the desktop renderer.

## Approved 2026 Stack

| Layer | Decision | Rule |
| --- | --- | --- |
| App runtime | React 19 + Vite inside Tauri v2 | Desktop renderer only; no standalone web product. |
| Styling | Tailwind CSS v4 | CSS-first token architecture; no JS-centric Tailwind config as the design source. |
| Components | shadcn/ui | Local copied components only; wrap into Offisim grammar before business use. |
| Assistant surface | assistant-ui | Use ExternalStoreRuntime-style projection over the production `DesktopAgentRuntime` event gateway; do not recreate engine stream parsing, draft filtering, or transport routing in the UI. |
| Motion | Motion for React | Package `motion`, imports from `motion/react`; do not use older animation package names for new work. |
| Icons | lucide-react | Use through an Offisim icon wrapper with fixed sizes and tooltips. |
| Server/async state | TanStack Query | Tauri commands, platform API, loading/error/cache/invalidation. |
| UI state | Zustand | Workspace, selected ids, rail state, panels, density, ephemeral UI only. |
| Forms | React Hook Form + Zod | Settings, Market publish, employee config, MCP config, install/confirm flows. |
| Virtualization | TanStack Virtual | Activity log, chat history, Market listings, long file/event lists. |
| Panels | react-resizable-panels | Split panes and rail resizing; do not hand-roll splitter state. |
| Command UI | cmdk | Command palette, slash command, quick switcher. |
| Toasts | Sonner | Behavior layer only; visual skin must match V3 `.icard` grammar. |
| Charts | Recharts | Small runtime/cost/usage charts only; avoid chart-library-driven visual language. |
| 3D scene | three + @react-three/fiber | Scene layer only (Office 3D scene, Studio editor under `surfaces/office/scene` and `surfaces/studio`); never for general UI chrome. |
| 3D scene helpers | @react-three/drei + @react-three/postprocessing | Scene-layer helpers/IBL/post effects only. Scene palette lives in `scene-colors.ts` / `scene-art-direction.ts` with explicit `raw-hex-allowed` exemptions — a parallel track to CSS tokens that must be synced manually on theme changes. |

## Character Assets

Character assets. Office characters render from source-controlled, meshopt-compressed glTF assets in apps/desktop/renderer/src/assets/characters/ (CC0: Quaternius Universal Base Characters + Universal Animation Library 1/2, Kenney Furniture Kit, KayKit Furniture Bits — see LICENSES.md), built deterministically by scripts/build-character-assets.mjs from a dev-machine raw directory (CHARACTER_ASSETS_RAW_DIR) and gated under 25 MB. Loading goes through surfaces/office/scene/character/character-assets.ts, which wires three's locally bundled meshopt decoder into GLTFLoader — drei's useGLTF is intentionally not used because it embeds a CDN DRACO decoder URL, and release bundles must contain no CDN references. Animation selection is a pure total mapping (clip-map.ts) from CharacterPerformanceState onto a neutral clip scheme, locked by harness:character-clip-map against the emitted manifest.

## Architecture Layers

1. `styles/`: `tokens.css`, Tailwind v4 entry, motion variables, density variables, global focus and reduced-motion rules.
2. `design-system/primitives/`: shadcn-copied primitives, kept close to upstream but styled through tokens.
3. `design-system/grammar/`: Offisim V3 grammar components: chip bar, caps label, status pill, card block, field row, dialog shell, popover shell.
4. `design-system/shell/`: titlebar, topbar, scope bar, workspace nav, iconbar, app frame.
5. `assistant/`: assistant-ui runtime adapter, Thread skin, Composer skin, message parts, tool approval, run records, attachments.
6. `surfaces/`: Office, Workspace, Market, Personnel, Settings, Activity, Lifecycle, States. Surfaces compose grammar; they do not define new chrome.
7. `runtime/desktop-agent-runtime.ts`: the single production engine gateway. It forwards composer turns to the selected complete engine adapter and projects neutral events to UI/3D state; provider transport and secrets stay outside renderer product surfaces.

## Hard Rules

- Raw colors, radii, shadows, font sizes, and spacing tokens only live in token files.
- No non-approved animation framework, component suite, or CSS-in-JS layer for the desktop renderer without a new architecture decision.
- No default shadcn visual language leaking directly into product surfaces.
- No assistant-ui default thread skin in the product; use assistant-ui primitives/runtime with Offisim V3 rail grammar.
- Settings uses AI Accounts, Models, Usage, and Cost language. Do not expose Pi Agent, OAuth, auth-file paths, SDK lane badges, registry internals, or runtime implementation names as the primary product model. API accounts show tokens/cost; subscriptions show only provider-native Usage. Model records require exact id/source/checkedAt, while selectors lead with friendly names.
- No native select arrow chrome; use the V3 custom select/combobox skin.
- No `--fs-2xl` or routine `--r-xl` equivalents outside explicitly approved dialog hero cases.
- No `transition-all` as a motion system. Motion behavior must be named and centralized.
- Long lists must virtualize before they can be treated as production-ready.
- Forms must be schema-backed before they can be treated as production-ready.
- Any future drag/drop must first add an approved dependency decision plus keyboard path and visible state feedback before it can be treated as production-ready.

## Validation Gates

Renderer framework work must pass:

- `pnpm --filter @offisim/desktop-renderer typecheck`
- `pnpm --filter @offisim/desktop-renderer build`
- `pnpm --filter @offisim/desktop build` before release verification
- scans for banned UI frameworks and stale package names
- scans for old provider/catalog/SDK lane surfaces
- scans for raw visual values outside token files
- scans for native select chrome and forbidden V3 DNA violations

Release proof remains the exact current worktree `.app` with Computer Use interaction when the task changes user-visible desktop behavior.
