## Why

Offisim already has a real AI harness, company templates, employees, SOPs, project state, and 3D scene plumbing, but the product backbone around company startup, providerless readiness, SOP execution, artifacts, and reusable production assets is not yet contractual enough to support the "AI company" concept without fake demo behavior.

This change deliberately excludes concrete UI/UX redesign requirements. UI can be redesigned separately; this proposal locks the non-UI contracts that the future UI must consume.

## What Changes

- Add a provider-independent company startup ceremony backbone: company creation emits durable startup lifecycle events and a per-company ceremony state without claiming real work happened.
- Add a no-provider readiness contract: without API credentials, Offisim remains browsable/editable and may run startup/explainer ceremony state, but MUST NOT run fake demo work, fake model output, fake task progress, or fake employee execution.
- Add an employee performance state backbone for non-work acting states such as greet, sit, held, carried, valid-drop, invalid-drop, celebrate, and settle. These are scene/performance semantics, not layout or visual style requirements.
- Repair scene ceremony event coverage so the real graph's `pm_planner` node is treated as planning wherever ceremony phase state is derived.
- Change SOP Run from text-command dispatch to typed SOP identity dispatch while keeping Boss/PM/dispatcher ownership of execution.
- Tighten artifact creation intent so common production prompts like reports, plans, briefs, PRDs, job descriptions, and decks can become durable deliverables without requiring the user to say "file" or "export".
- Make project creation without a workspace folder a hard product contract, not just a dormant spec statement.
- Add an asset materialization backbone for SOPs, company templates, office layouts, prefabs, and bundles so production assets can be installed/exported/reused beyond employee and skill assets.

## Capabilities

### New Capabilities

- `company-startup-ceremony-backbone`: company lifecycle events, persisted startup ceremony state, providerless readiness boundaries, and no-fake-work rules after company creation.
- `employee-performance-state-backbone`: semantic character/performance state model consumed by 3D/2D renderers and drag/drop orchestration without prescribing UI layout or art direction.
- `asset-materialization-backbone`: install/export/materialization contracts for SOP, company template, office layout, prefab, and bundle assets.

### Modified Capabilities

- `company-creation-flow`: exclude UI layout changes from this change, and add non-UI creation lifecycle requirements for startup ceremony initiation and providerless readiness.
- `scene-orchestrator-boundaries`: add startup ceremony phase/event boundaries and align planning phase detection with the real `pm_planner` graph node.
- `sop-run-surface`: replace name-only text dispatch with typed SOP run identity while preserving the existing runtime ownership path.
- `deliverable-artifact-handoff`: expand artifact intent and matching rules so natural production tasks create durable deliverables and attach them to the correct run.
- `project-workspace-binding`: reinforce that `workspace_root = null` is a valid creation path and must not block the project lifecycle.

## Impact

- Affected runtime/event surfaces: company creation services, onboarding/store flags, runtime event types, scene intent dispatch, ceremony phase derivation, movement/performance state, SOP run command path, deliverable intent detection, project creation flow, install-core materialization, manifest export/import.
- Affected validation: deterministic harness scenarios for providerless company creation, no-fake-work guarantees, startup lifecycle events, `pm_planner` planning phase, typed SOP dispatch, artifact intent, project creation without folder, and asset materialization.
- Out of scope: concrete UI layout, redesigned side rails, header/nav decisions, visual styling, copy tone, Remotion/explainer implementation, paid/commercial flows, marketplace monetization, and release visual QA for the future redesigned UI.
