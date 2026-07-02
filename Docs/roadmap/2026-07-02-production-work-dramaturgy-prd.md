# Production Work Dramaturgy PRD

## Current Time Baseline
- Checked at: 2026-07-02 12:31 NZST.
- Scope: post-cleanup Offisim desktop Office scene, deterministic dramaturgy projection, 2D/3D work theater, character asset pipeline.
- Status: production-grade next-stage PRD. This supersedes the open items in `2026-07-01-parallel-work-dramaturgy-prd.md`; it does not change Pi Agent runtime ownership.

## Current Baseline
The first parallel-work dramaturgy slice is now a real baseline, not a future wish:

- `SceneBeat` already carries `visual`, `flow`, `artifact`, and `resource` intent.
- `ArtifactIntent` preserves `path`.
- `EmployeeWorkloadProjection` already has `workloadSummary`.
- grouped workload chips already support small / medium / large concurrency.
- blocked/resource/failure/approval issues already outrank ordinary work in workload summary and dominant selection.
- terminal failed child runs can remain visible while their issue beat is live.
- 2D and 3D already share `projectOfficeStaging`.
- 2D and 3D delivery shelves already expose the latest claimable artifact.
- current characters are procedural `BlockCharacter` meshes with a layered `CharacterPerformanceState`, but no production asset contract.

This means the next stage is not "add more chips." The next stage is a production work-theater system: a renderer contract, visual grammar, asset spec, and verification standard.

## Product Decision
Offisim should be a fact-driven work theater, not a profession-animation pack and not a swarm roster.

- Employee remains the stable visible identity.
- Agent runs remain temporary work instances.
- Sub-agent volume is shown as grouped workload, flow, exceptions, and delivered outputs.
- Work is staged from facts: run tree, beat intent, workload summary, artifact/resource state.
- The scene may be expressive, but no model or agent writes animation commands.
- Character models are assets used by the renderer; Meshy/Tripo must not become app runtime dependencies.

## What Changes From The Previous PRD
The previous PRD correctly defined the identity boundary and parallel workload display. After cleanup and implementation, the remaining gap has moved:

- old gap: "Can the UI show many runs under one employee?"
- new gap: "Can the Office scene read as a high-quality operating theater under high concurrency?"

Therefore the new requirements are:

1. formalize a render-agnostic `SceneCue` layer above `SceneBeat` / `workloadSummary`.
2. make fan-out, fan-in, blocked state, approval, artifacts, and recovery visually legible as a system.
3. replace ad hoc procedural character visuals with a production character asset pipeline.
4. preserve the current deterministic facts and harnesses.
5. verify in release `.app`, not just dev renderer screenshots.

## Dramaturgy Renderer Contract
Add a renderer-facing cue contract. It should be derived, not persisted.

`SceneBeat` remains the semantic source. `EmployeeWorkloadProjection` remains the workload source. A new scene-level projection should resolve them into renderable cues:

- actor cue: employee id, stable identity, current performance, issue state, workload tier.
- flow cue: fan-out, fan-in, tool route, approval route, artifact route, recovery route.
- delivery cue: claimable artifacts, count, recency, target action.
- resource cue: token/budget/context/permission/runtime/tool issue hierarchy.
- concurrency cue: active count, grouped distribution, top issue, overflow drilldown.
- camera/attention cue: optional focus target for active thread or severe issue.

The renderer contract is the boundary where 2D canvas, 3D scene, and future visual tests align. Individual components should not each re-derive their own interpretation of a beat.

## Work Theater Language
The visual language should be generic and operational:

- fan-out: one employee emits controlled work packets into parallel lanes, not dozens of bodies.
- fan-in: completion and review converge toward the owner or delivery area.
- artifact: output lands in a clear delivery surface with claim/open action.
- approval: route to the user with a waiting state that cannot be confused with ordinary work.
- blocked: actor, bubble, and route all show the issue; normal work animation must not dominate it.
- recovery: after issue resolution, the route should visibly return to normal work without celebration.
- idle/rest: quiet, legible, and not visually competing with active work.

Motion is bounded. It communicates state transfer and urgency; it must not become decorative motion.

## Character Model Direction
Current procedural characters are useful as fallback and debugging assets, but they should not be the production look.

Production direction:

- stylized desk-scale employee avatars, not realistic humans.
- one canonical rig and animation vocabulary shared by all employees.
- swappable hair, clothing, accent, skin, and accessory variants.
- props attach to known sockets: document, laptop, terminal, package, pointer/tablet.
- faces can remain texture/decal based for readability at small scale.
- silhouettes must be readable from the current office camera distance.
- role differences come from color/accent/accessory and performance flavor, not separate professions or task-specific bodies.
- `BlockCharacter` stays as deterministic fallback when an asset fails to load.

The target look is polished low-poly / toy-like office operators: simple enough for dense 3D, much better than block primitives, and consistent with a HUD-style desktop product.

## Meshy / Tripo Assessment
Checked current public sources on 2026-07-02:

- Meshy has an official MCP server and API path. Official docs describe MCP tools for text-to-3D, image-to-3D, multi-image-to-3D, refine, task check, and download, with `MESHY_API_KEY` authentication. Meshy text-to-3D is a preview-then-refine workflow.
- Meshy also publishes an open-source `meshy-3d-agent` skill pack that describes model, texture, rig-character, animation, and preparation workflows.
- Tripo has an official MCP repo, but it is marked alpha and currently focuses on Tripo API plus Blender addon integration.
- Tripo's API product page emphasizes text/image/multi-image 3D, animation, stylization, and post-processing.

Decision:

- Use Meshy first for offline asset exploration because its MCP/API path is more direct for agent-driven generation.
- Use Tripo second as a comparison lane for Blender-assisted art direction and high-detail variants.
- Do not integrate either as a runtime dependency inside Offisim.
- Do not put Meshy/Tripo API keys into the app.
- Do not let generated assets bypass review, optimization, license metadata, or deterministic bundling.

The production pipeline is: concept sheet -> generated candidate GLB -> human/agent art review -> retopo/optimize -> canonical rig/animation check -> checked-in asset pack -> release `.app` verification.

## Asset Pipeline Requirements
Create a first-party character asset pipeline before replacing `BlockCharacter`.

Minimum asset manifest:

- asset id and version.
- source generator or artist source.
- license/source URL.
- triangle budget.
- texture sizes.
- material count.
- rig type and required bones/sockets.
- animation clips included.
- LOD availability.
- fallback asset id.

Minimum runtime support:

- load GLB assets through the existing Three/drei stack.
- cache assets per employee appearance profile.
- bind `CharacterPerformanceState` to animation clips or procedural overlays.
- preserve reduced-motion by freezing/choosing static clips.
- retain `BlockCharacter` fallback.
- fail closed: missing asset means fallback character, not broken Office scene.

Minimum art budgets:

- one base body mesh.
- 6-8 hair variants.
- 4-6 clothing silhouettes.
- 8-12 accessory/prop meshes.
- 5 expression decals.
- initial animation set: idle, sit, walk, type, read, inspect-terminal, write-board, handoff, wait/worried, celebrate.

## Program Animation Requirements
The current procedural rig is too embedded in `BlockCharacter`. The production renderer should separate:

- semantic performance state: already `CharacterPerformanceState`.
- animation resolver: maps performance to clip/procedural layer.
- asset renderer: GLB/mesh rendering.
- overlay renderer: workload bubble, issue marker, delivery/flow cues.

This keeps animation generic. Developer, designer, reviewer, and researcher do not need unique animation packs; they use the same action vocabulary with different props, accents, and tempo.

Do not introduce a new animation framework. Use the approved stack: Three/R3F/drei for 3D, Motion for React where DOM overlay motion is needed, and deterministic frame logic where 3D state needs it.

## High-Concurrency Requirements
At high concurrency the scene should read like an operations console:

- one visible body per employee.
- `xN` remains the primary density signal.
- grouped distribution remains the bubble default.
- flow lanes aggregate by target and issue type.
- fan-out/fan-in should visually bundle, not draw a line per child after the noise cap.
- drilldown is inspection only, not worker management.
- severe issue count can claim visual priority over ordinary work count.
- delivery shelf shows recent outputs and an overflow/history action.

The scene must support the mental model "one employee can command many temporary runs" without making those runs feel like new staff.

## UI / UX Quality Bar
The Office scene must feel production-grade:

- no nested cards in scene overlays.
- no text overflow in labels, chips, badges, or delivery shelf.
- no large decorative animations that cover work state.
- issue markers should be legible from the default camera.
- flow and packets must be visible but not noisy.
- role/color variants must avoid one-note palette clusters.
- 2D and 3D must agree on workload, artifact, resource, and drilldown state.
- reduced-motion must keep all state visible.

## Suggested Implementation Sequence
1. Mark the 2026-07-01 parallel-work PRD as Wave 1 baseline and reference this PRD for next-stage work.
2. Add the render-agnostic scene cue projection and harness it.
3. Move flow/delivery/resource visual interpretation to the shared cue projection.
4. Upgrade fan-out/fan-in rendering with grouped lanes and recency/priority scoring.
5. Define the character asset manifest and runtime loader with `BlockCharacter` fallback.
6. Produce one production-style character asset pack candidate through Meshy first, then compare a Tripo/Blender candidate.
7. Bind `CharacterPerformanceState` to asset clips/procedural overlays.
8. Run 2D/3D visual verification in release `.app`, including high-concurrency, blocked, approval, artifact, and reduced-motion scenes.

## Verification Plan
- `pnpm harness:beat-composer`
- `pnpm harness:conversation-run-controller`
- `pnpm harness:office-projection`
- `pnpm harness:dramaturgy-stress`
- new scene-cue harness for fan-out/fan-in/resource/artifact grouping.
- renderer typecheck and build.
- `pnpm validate`
- release `.app` Computer Use verification for 2D and 3D Office scene.
- screenshot/canvas evidence for: idle, 1 run, 3 runs, 58 runs, blocked, approval, artifact delivery, reduced-motion.
- asset validation for GLB size/material/texture/animation/manifest constraints before bundling.

## Final Requirement Statement
Offisim's next dramaturgy phase should turn the current fact-driven workload display into a production work theater: one stable employee body, many temporary run instances, grouped operational signals, organized work flow, claimable output delivery, prioritized exceptions, and polished stylized character assets generated offline and bundled deterministically.
