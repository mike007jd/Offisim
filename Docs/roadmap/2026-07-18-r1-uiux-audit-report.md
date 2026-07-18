# R1 full-surface UI/UX audit closeout

Date: 2026-07-18 NZST

Truth source: `Docs/roadmap/2026-07-18-usability-polish-round.md` R1

Runtime oracle: this worktree's packaged release `Offisim.app`

## Result

| Measure | Count |
|---|---:|
| Findings reviewed | 58 |
| Confirmed | 45 |
| Fixed | 45 |
| Rejected after verification | 13 |

All confirmed findings were repaired at their owning layout, state, or presentation boundary. The audit covered Office Game View, Board, Timeline, Review Stage, Compare drafts, Conversation, Personnel including Experience, Market, Studio, Settings AI Accounts, and Loops at wide and narrow window sizes.

## Remediation groups

- Shared grammar: removed the radius-token cycle, restored caps/status hierarchy, unified state actions, and added hygiene gates.
- Office: replaced fixed rails with synchronized resizable panels, restored compact priority, humanized player-facing projections, added actionable empty states, and made Review/Compare presentation ownership reversible.
- Personnel: stabilized the roster, restored the roadmap-defined Experience tab, added honest experience summaries, shared dirty-form leave protection, and consistent tab semantics.
- Market: made failure, retry, installed fallback, and connection recovery one coherent state flow.
- Studio: added responsive panel ownership, explicit loading/overflow feedback, and room/furniture language.
- Settings: made API providers and subscription tools equal-level sections, preserved unknown/error accounting states, and removed fake zeros and orchestration jargon.
- Loops: stopped empty drafts from creating database rows, preserved meaningful drafts, compacted first-run guidance, and fixed narrow cascade ownership.

Three defects were found only in the packaged-app regression pass and fixed before closeout: retired Office `grid-area` placement pushed the stage below the viewport; Experience had drifted to “Lessons”; and the compact Office topbar clipped its secondary usage summary with Compare open.

## Rejected scope

The 13 rejected candidates were not reproducible current defects or were separate framework/performance programs: broad primitive rewrites, Scene drag-kernel replacement, unreproduced thread context loss, large-dataset virtualization, review-column enhancement, unavailable Market provenance, and an unreproduced provider-form failure. Detailed IDs and reasons are recorded in the external evidence `REQUIREMENTS.md`.

## Verification

- Renderer typecheck: pass.
- Renderer production build: pass; existing chunk-size advisory only.
- Node release lane: pass, 4 gates green; production audit found no known vulnerabilities.
- Desktop release build: pass; packaged and ad-hoc signed at `apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`. Notarization is intentionally outside R1 and remains owned by R2.
- Packaged-app live verification: pass across every requested surface and both audited widths, including dirty-form feedback and multi-tab compact pressure.

Evidence: `~/.dev-dispatch/evidence/offisim/r1-uiux-2026-07-18/`. The user's original `~/.offisim` profile was restored after verification; the deterministic audit profile is retained under `99-test-profile/`.
