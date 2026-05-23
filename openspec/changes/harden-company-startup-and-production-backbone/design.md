## Context

Offisim's current runtime already has a real graph/harness path, template materialization, employee state events, scene intents, project rows, SOP definitions, deliverable persistence, and asset manifest schemas. The current product gap is the contract between these production systems and the "AI company" concept: company creation does not produce a non-work startup lifecycle, no-provider mode is editable but not explicitly bounded, employee acting states are coupled to AI work states, SOP Run is still name-text driven, artifact intent is too narrow for common production requests, and manifest-supported asset kinds are not all materializable.

This design intentionally excludes concrete UI/UX redesign work. The future UI can choose any layout, visuals, copy, or animation style as long as it consumes the contracts defined here.

## Goals / Non-Goals

**Goals:**
- Define non-UI lifecycle events and state for company startup ceremony.
- Preserve truthfulness: no API key means no fake model output, fake task progress, fake employee execution, or fake demo run.
- Separate employee performance/acting state from AI execution state.
- Make the real graph's `pm_planner` phase visible to ceremony state consumers.
- Make SOP execution typed by SOP identity instead of text-only name matching.
- Broaden durable artifact intent for natural production prompts.
- Enforce project creation without a workspace folder.
- Extend asset materialization beyond employees and skills.

**Non-Goals:**
- No header, sidebar, empty-state, navigation, layout, spacing, theme, copy, or redesigned UX requirements.
- No Remotion/video implementation requirements. Explainer media can be designed later.
- No fake demo run, canned model transcript, or simulated employee output.
- No new model lane, SDK lane, or replacement harness.
- No paid/commercial marketplace requirements.

## Decisions

1. **Startup ceremony is an event/state contract, not a UI flow.**

   Company creation emits startup lifecycle events such as requested, started, completed, skipped, and failed. The state is scoped to a company and records whether the ceremony has been requested/completed. Renderers may animate it, but the contract never dictates layout or art direction.

   Alternative considered: encode startup as first-run UI state only. Rejected because it would be lost when UI is redesigned and would not be available to 3D/2D scene consumers, harness logs, or release verification.

2. **Providerless mode stays truthful.**

   Repos-only runtime may create and edit companies, employees, SOPs, projects, layouts, and assets. It may run startup ceremony and guide/explainer state. It must not enqueue graph work, create task progress, stream fake output, or mark first task/deliverable flags.

   Alternative considered: local demo run with canned outputs. Rejected because it undermines the product claim that Offisim is a real AI harness.

3. **Employee performance state is separate from `AgentState.state`.**

   `AgentState.state` remains business/runtime truth (`idle`, `executing`, `blocked`, etc.). A sibling performance layer describes acting states (`greet`, `sit`, `held`, `carried`, `drop-valid`, `drop-invalid`, `celebrate`, `settle`) and can be merged by renderers.

   Alternative considered: add these acting values to AI state. Rejected because being dragged or celebrating is not model execution and must not pollute task/routing logic.

4. **SOP Run carries typed identity.**

   A run request must carry `sopTemplateId` and a stable definition/version snapshot reference. Chat text may still display the user's intent, but runtime dispatch must not depend on parsing `Run the SOP: <name>`.

   Alternative considered: improve the text command parser. Rejected because names are mutable, duplicateable, and ambiguous.

5. **Artifact intent recognizes production objects, not just explicit file words.**

   The intent layer distinguishes read-only/local-file operations from durable artifact creation. Common production nouns such as report, plan, brief, PRD, JD, deck, checklist, analysis, and proposal can produce deliverables when the user asks to write/draft/create/produce them.

   Alternative considered: force the UI to add hidden "file" wording to starter prompts. Rejected because it hides a runtime contract bug and still fails for user-authored prompts.

6. **Asset materialization is kind-specific and transactional.**

   Employee and skill remain supported. SOP, company template, office layout, prefab, and bundle require explicit materializers, source identity, rollback IDs, and terminal install events. Bundle installation is all-or-error with rollback for already-created local entities.

   Alternative considered: store unsupported asset kinds as installed-package rows only. Rejected because it makes the asset ecosystem look installed while no production capability exists.

## Risks / Trade-offs

- [Risk] Startup ceremony events could be mistaken for real work events. Mitigation: event names and payloads are under `company.startup.*` and must not emit `task.*`, `plan.*`, `employee.state.changed`, or deliverable events.
- [Risk] Performance state may duplicate existing employee cue state. Mitigation: cues describe business-readable status bubbles; performance state describes acting/choreography semantics.
- [Risk] Typed SOP run touches existing chat and PM paths. Mitigation: preserve Boss/PM/dispatcher ownership, but pass typed metadata through run scope instead of text-only parsing.
- [Risk] Artifact intent could over-create files for analysis requests. Mitigation: require production verbs/nouns and keep read-only/local-file operation detection higher priority.
- [Risk] Bundle materialization can leave partial installs. Mitigation: collect created entity IDs and rollback on any failed child install.

## Migration Plan

1. Add shared event/payload types and deterministic harness scenarios before changing runtime behavior.
2. Implement company startup lifecycle and providerless no-fake-work guards.
3. Add performance state reducers and scene-intent bridges without changing concrete UI layout.
4. Patch `pm_planner` ceremony recognition.
5. Implement typed SOP run metadata and preserve existing chat-facing text as display only.
6. Broaden artifact intent and attach deliverables by run/task identity first.
7. Enforce null-workspace project creation against service/repo paths.
8. Add asset materializers kind by kind, then bundle transaction/rollback.
9. Run `openspec validate harden-company-startup-and-production-backbone --strict`, deterministic harness scenarios, relevant package builds, and release `.app` verification only for runtime behavior that is not tied to the future UI redesign.
