## Why

Office scene currently shows employee state and ceremony-level progress, but it does not make live work legible at employee level. Users need the office to read like a real-time business stage: who received work, who is using tools, who is waiting, who handed off, who is blocked, and who is reporting.

## What Changes

- Introduce a unified employee performance cue model driven only by real runtime events and scene intents.
- Add per-employee action bubbles with short templated copy, priority, TTL, source event identity, and safe truncation.
- Expand 3D employee presentation with action-specific bubbles, work feedback, waiting/blocked/reporting emphasis, and handoff/dispatch lines tied to existing movement and flow-line systems.
- Expand the 2D fallback with equivalent per-employee bubble/badge information so business truth is preserved when 3D is unavailable.
- Add cleanup behavior for abort, company switch, view switch, drag, stale cues, and long-running work.
- Keep model transport unchanged: presentation consumes existing Offisim runtime events and scene intents only; it does not introduce an SDK lane or freeform roleplay copy.

## Capabilities

### New Capabilities
- `employee-performance-cues`: Defines the runtime-to-scene cue contract for employee actions, bubbles, priorities, TTL, privacy-safe text, 3D rendering, 2D fallback, and cleanup.

### Modified Capabilities
- `scene-orchestrator-boundaries`: The orchestrator gains a sibling employee presentation state while keeping ceremony state boundaries intact.
- `office-2d-canvas-viewport`: The 2D canvas snapshot and layer contract adds employee bubble data while preserving the existing draw pipeline.
- `scene-3d-performance-fallback`: 3D-to-2D fallback must preserve employee performance cue meaning, not only render employees.

## Impact

- Affected UI runtime: `packages/ui-office/src/runtime/scene-intents.ts`, `scene-intent-dispatcher.ts`, and scene presentation hooks.
- Affected scene rendering: `packages/ui-office/src/components/scene/**` for 3D employee markers, 3D flow lines, 2D snapshot data, and 2D canvas layers.
- Affected specs and verification: OpenSpec change artifacts, strict validation, `@offisim/ui-office` build, desktop release build, and release `.app` live verification.
