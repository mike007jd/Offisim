# Codex office companion state sheet

Checked at 2026-07-13 AEST. The final companion is an ambient diegetic pet. It is not an employee, assistant, model/provider, tool, or second runtime; Pi Agent remains the only runtime engine.

## Asset contract

- Source: `apps/desktop/renderer/src/assets/companion/codex-companion-state-sheet.png`
- Format: RGBA PNG, 1536×1024, 4×2 cells, 384×512 per state, transparent corners.
- Production uses one atlas texture in both 2D and 3D. Eight cropped PNGs are retained as review/reference artifacts and verified against `manifest.json`.
- Visual direction: compact white/warm-gray toy robot, charcoal face screen, cyan eyes, one coral accent; orthographic three-quarter view sized for the V3 office diorama.

| Cell | State | Projected meaning |
| --- | --- | --- |
| 0,0 | idle | Quiet office / reduced-motion neutral pose |
| 1,0 | run | Deterministic roam and short run segments |
| 2,0 | inspect | Approval waiting |
| 3,0 | celebrate | Artifact delivery or successful/happy performance |
| 0,1 | concerned | Failure, blocked work, or resource strain |
| 1,1 | rest | Long quiet interval / sleep alias |
| 2,1 | pause | Route endpoints and brief observation |
| 3,1 | work-watch | Work starting or active work |

Priority is fixed: failure/resource > approval > delivery/success > active work > quiet. The projection is read-only and returns only serializable presentation instructions.

## Motion and interaction budget

- One companion maximum. 2D uses the atlas in the existing canvas and never registers a hit target. 3D uses one unlit billboard sprite with raycasting disabled, no shadow, no light, and no post-processing.
- Routes are seeded by `companyId::projectId::codex-companion-v1`, use the existing office pathfinder, and are recomputed only when a discrete route segment, cue priority, or geometry revision changes.
- 2D is capped near 12 fps while roaming; static reaction/focus/reduced-motion poses schedule no animation loop. 3D inherits the existing full-view loop and 4 fps PiP demand driver.
- Focus mode and `prefers-reduced-motion` keep a stable safe position with no travel or bob. Event meaning may still choose a static semantic pose.
- The Game View preference is persisted locally and can hide the pet. No companion surface accepts pointer or keyboard input.

## Generation prompt

Built-in `image_gen` was asked for one original, consistent eight-pose 4×2 game sprite sheet on a uniform green chroma background: idle, run, inspect, celebrate, concerned, rest, pause, and work-watch. The subject was constrained to the same compact robot identity and scale in every cell, with no text, furniture, shadows, watermark, or extra character. The chroma background was removed locally with the installed imagegen helper and the alpha result was validated before slicing.
