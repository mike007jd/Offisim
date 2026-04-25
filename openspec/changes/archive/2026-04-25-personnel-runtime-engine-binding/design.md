## Context

Offisim has two orthogonal "what runs the model" concepts that already coexist in `shared-types`:

1. **Provider execution lane** (`gateway` / `claude-agent-sdk` / `codex-agent-sdk` / `openai-agents-sdk`) — the leaf adapter Offisim's LangGraph-owned nodes use to call a model. Configured per provider binding in Settings → Provider. Spec: `agent-sdk-provider-lanes`.
2. **Employee runtime binding** (`provider` / `claude-engine` / `codex-engine`) — whether the *whole assigned employee task* is delegated to an external runtime (Claude Agent host or Codex Agent host) versus Offisim driving every employee turn through its own LangGraph employee node. Spec: `runtime-engine-adapter`.

The data plumbing is fully wired:
- `EmployeeRuntimeBinding`, `EngineId`, `RuntimePolicyConfig.employeeRuntimeDefault` in `shared-types`.
- `resolveEmployeeRuntimeBinding(employee, runtimePolicy)` in `core/engine/runtime-binding.ts` — A2A external → employee config → company default → `provider`.
- `useEmployeeEditor` already round-trips `runtimeBinding` through `parseConfigJson` / `buildConfigJson`.
- `useSettingsRuntimePolicy` already holds `employeeRuntimeDefault` state.
- `apps/web/src/lib/tauri-engine-adapters.ts` registers `claude_agent_execute` / `codex_agent_execute` Tauri sidecars as `EngineAdapter` implementations.

But two things are missing on the surface:
- `RuntimeTab` in PersonnelPage is a `PlaceholderTab` from C0.
- `SettingsRuntimeTab` does not render any control for `employeeRuntimeDefault`, so the company default is permanently `undefined` → resolver falls through to `{ mode: 'provider' }` for everyone.
- `apps/web/src/lib/tauri-runtime.ts` calls `createTauriEngineAdapterRegistry()` with no args → `enableProviderHostPreviewAdapters` defaults to `false` → registry returns an empty Map. Even on Tauri desktop, the adapters are not actually registered. So even if the UI existed and the user picked `claude-engine`, employee execution would fail closed at `runtimeCtx.engineAdapters.get(...)`.

This change closes all three gaps with the smallest surface that gives users a real, end-to-end working choice.

## Goals / Non-Goals

**Goals:**
- Personnel Runtime tab exposes a real binding control: shows the currently resolved binding, lets the user pick `Inherit company default` / `Provider gateway` / `Claude engine` / `Codex engine`, and saves through the existing form path.
- Company-level `employeeRuntimeDefault` has a UI in Settings → Runtime so the "Inherit" option in Personnel has a real source of truth users can edit.
- One shared `<RuntimeBindingControl>` primitive renders both surfaces; no duplicated select logic.
- The UI honestly reflects which engine adapters are actually registered in the active runtime — engine choices are disabled in browser-limited runtimes, available in trusted Tauri desktop runtime.
- After this change, picking `claude-engine` for an internal employee in desktop release actually routes the employee task through the Claude Agent sidecar, streams text into the chat bubble, and ends with a deliverable.
- External (A2A) employee Runtime tab renders a clear read-only lock card; engine binding is irrelevant for them.

**Non-Goals:**
- Engine internal tool execution telemetry is **not** wired in this change. Engine sidecars currently emit text/reasoning/run_completed; tool-started/tool-completed and engine handoff proposals are deferred to a follow-up.
- We do **not** introduce a new `EmployeeRuntimeBinding` shape or any DB migration. `engineId` stays `'codex-engine' | 'claude-engine'` per `shared-types`.
- We do **not** introduce a per-runtime UI capability matrix (e.g., "this provider preset supports claude-engine"); engine adapter availability is purely runtime-context-derived. Provider lane verification stays in `agent-sdk-provider-lanes`.
- We do **not** ship a CodexInstall / Claude-CLI auto-install flow. If the sidecar is missing on desktop, the existing engine-adapter error path surfaces it; reaching for the user to install Claude Code / Codex CLI is part of T2.4+ scope.
- The Profile tab does **not** gain a runtime control; the Runtime tab is the **single** SSOT surface for `runtimeBinding`. Profile keeps the rest of `useEmployeeEditor` form fields.

## Decisions

### Decision 1: Render binding inheritance as a tri-state, not as a separate "override" toggle

**Choice**: `<RuntimeBindingControl>` exposes a single segmented selector with values `inherit | provider | claude-engine | codex-engine`. Picking `inherit` writes `runtimeBinding: null` into the form (which `buildConfigJson` already serializes by *omitting* the field). The other three values each write a concrete `EmployeeRuntimeBinding`.

**Why**: Separate "Use company default" toggle + engine selector creates 2 controls with overlapping state and 4 invalid combinations to reason about. A single 4-way pick maps 1:1 to the resolver outcomes the user actually cares about, mirrors how Settings → Density already exposes `auto | comfortable | compact`, and keeps the form serializer trivial.

**Alternatives considered**:
- Toggle + select: rejected for the reason above.
- Hide the `inherit` row entirely when company default is `provider` (the resolver-equivalent state): rejected because it makes the inheritance source invisible — users would not know their employee will follow company-wide changes.

### Decision 2: `OffisimRuntimeContext` exposes `availableEngineAdapters: ReadonlySet<EngineId>`

**Choice**: After runtime init, the context publishes a frozen set derived from `runtimeCtx.engineAdapters?.keys()`. The Runtime tab and Settings runtime default control both consume it via a `useAvailableEngineAdapters()` hook. Engine choices not in the set render as `disabled` with a tooltip "Available on trusted desktop runtime".

**Why**: We already split runtime context into two halves (`OffisimRuntimeContext` + version bumper). Adding a derived adapter set there keeps the truth co-located with the rest of runtime capability surfacing. A separate "platform === tauri" gate would lie when (e.g.) an external evaluator turns engine adapters off in trusted runtime, or future runtimes register only one of the two.

**Alternatives considered**:
- Branch on `isTauri()`: rejected because UI capability should follow real adapter registration, not platform string.
- Block save when adapter unavailable: rejected because the field is also writable from Settings while no employee is selected; we want round-trip persistence even for the "provider" choice. Disabling specific options in the picker is enough.

### Decision 3: Flip `enableProviderHostPreviewAdapters: true` for Tauri runtime; keep browser empty

**Choice**: `apps/web/src/lib/tauri-runtime.ts` calls `createTauriEngineAdapterRegistry({ enableProviderHostPreviewAdapters: true })`. The flag's purpose changes from "hide adapters entirely" to "tag the surfaced binding as preview" — the UI shows a "Preview · limited tool telemetry" disclosure inside the binding card whenever the resolved binding is engine mode. Browser runtime continues to receive an empty Map.

**Why**: The current default is the wrong shape for a UI feature. Without flipping it, choosing `claude-engine` saves successfully but next employee task throws `Engine adapter "claude-engine" is unavailable in this runtime` — a broken loop that violates the Product Closure Bar in CLAUDE.md ("不要靠 fallback 假装完成"). The Anthropic / Codex sidecars already work for streaming text and reasoning; tool execution telemetry is the only honest gap, and a visible "preview" disclosure inside the control is the right UX.

**Alternatives considered**:
- Keep flag off, add UI anyway: rejected for the closure-bar reason.
- Keep flag off, ship a banner that says "Engine binding shown for preview only, has no runtime effect": rejected — that's worse than no UI; users would think a save did something.
- Remove the flag entirely: deferred. The flag remains because we expect a stricter "verified-engine-only" mode once adapters expose tool-event telemetry; that flag flip belongs to a follow-up change.

### Decision 4: Settings → Runtime tab gets exactly one new section, "Default employee runtime"

**Choice**: A new `<SurfaceCard>` in `SettingsRuntimeTab.tsx` that hosts `<RuntimeBindingControl scope="company" value={employeeRuntimeDefault} onChange={setEmployeeRuntimeDefault} />`. The control's `scope="company"` variant hides the `inherit` choice and adds a help line "Used when an employee picks 'Inherit company default'." Persistence flows through the existing `buildRuntimePolicy` save path; no new field on `RuntimePolicyConfig`.

**Why**: The pair (Personnel Runtime tab + Settings Default) is the minimum that makes "inherit" meaningful. Without the Settings half, Personnel's "inherit" choice is a renamed "provider" — confusing and undiscoverable when the team wants to change defaults.

**Alternatives considered**:
- Defer Settings half to a separate change: rejected because it leaves the inheritance UX broken until then.
- Inline company default control inside Personnel tab itself ("change company default from here"): rejected — Settings is the documented home for runtime policy in `settings-controller-boundaries`.

### Decision 5: External employee branch is a read-only lock card, not a hidden tab

**Choice**: When `employee.is_external === 1`, the Runtime tab renders a single read-only card stating: "External A2A peer — engine binding does not apply. Routing is handled by the brand's A2A endpoint." No selector, no save button.

**Why**: Hiding the tab would break tab-count invariants in `personnel-workspace-surface` (six tabs always visible). A locked card is consistent with how the Profile tab handles external employees in C0/C1 and is honest about the resolver's first-priority A2A branch.

### Decision 6: Tasks tab and Skills tab unchanged

**Choice**: Skills remains a placeholder shell; only Runtime de-placeholders. The `personnel-workspace-surface` "Appearance, Runtime, Skills tabs are placeholder shells" requirement is replaced (MODIFIED) with one that calls out only Skills.

**Why**: Skills lives behind T2.x roadmap work and isn't part of this change.

## Risks / Trade-offs

- [Engine sidecar tool telemetry is partial today] → Mitigation: persistent "Preview · limited tool telemetry" disclosure inside the binding card whenever resolved binding is engine mode; documented in spec as known limitation; no claim of feature parity with provider mode in copy.
- [Flipping registry default could surface adapter setup gaps on user machines] → Mitigation: existing engine-adapter resolver already throws a typed error when adapter binary is missing; Personnel Runtime card surfaces the error inline rather than killing the runtime. Verify this on desktop release before archive.
- [`RuntimeBindingControl` copy-coupling between Personnel and Settings risks drift] → Mitigation: shared primitive in `ui-office/src/components/runtime/`; both consumers pass scope-specific copy via a single `scope: 'employee' | 'company'` prop with the help text resolved inside the component.
- [Users may expect engine mode to "feel different" but get same chat bubbles] → Mitigation: copy explicitly states "delegates the entire task to {Claude|Codex} runtime" in the help line, plus the preview disclosure. Not a runtime-behavior change in this PR.
- [Browser-only users see the engine options as permanently disabled and may think the feature is broken] → Mitigation: tooltip "Available on trusted desktop runtime" + a single sentence in Settings → Runtime section that engine binding is desktop-only. Honest, non-marketing copy.

## Migration Plan

- No DB migration. No on-disk format change.
- Existing employees with `runtimeBinding` already in `config_json` keep their value (it was always parseable but never UI-set). Existing `RuntimePolicyConfig` documents without `employeeRuntimeDefault` continue to resolve to `provider`.
- After deploy, opening Personnel → Runtime tab on any existing employee shows resolved binding `Provider gateway (inherited from company default)`. No data needs to be backfilled.
- Rollback: revert the file changes; data shape is unchanged so no cleanup is needed.

## Open Questions

- Should the binding selector remember whether the user previously chose `inherit` even after the company default changes? (Current decision: yes — `runtimeBinding: null` in `config_json` *is* the "inherit" record. No follow-up needed.)
- Should we expose adapter-level health (e.g., "Claude sidecar found / not found") inline in the picker? Deferred — current resolver throws on first task; if the desktop verify shows the error UX is too late, we add a passive ping in a follow-up.
- Eventually `agent-sdk-provider-lanes` may want to disable engine binding when the active provider preset doesn't advertise the matching agent SDK lane (e.g., a non-Anthropic preset paired with `claude-engine`). Not in scope; provider lane and employee engine remain orthogonal per spec.
