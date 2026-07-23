# Office Performance V2 — final release evidence

## Result

- Conclusion status: **PASS / GO**
- Source commit: `0780eca301a71075d1eaf225f080c2346c46618a`
- Branch: `main`
- Verification window: `2026-07-23 22:03–22:33 NZST`
- Runtime target: `/private/tmp/offisim-actions.Nrs0p4/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`
- Final executable SHA-256: `3323401c727a09b4e45c32fb61adc3395948f5331a19c3dc8bbef0511347e8e6`
- Signature: `Developer ID Application: Haosheng Li (9MP925J67C)`
- Strict codesign: **PASS** (`codesign --verify --deep --strict`)
- Notarization: **SKIPPED** — no `APPLE_ID`/app-password/team tuple or App Store Connect API key tuple was available. No notarization attempt was made.
- Agent: `gpt-5.6-sol`
- Reasoning effort: `medium`
- Access: `full access`

## Release scenarios

| # | Scenario | Result | Evidence and observed result |
|---|---|---|---|
| A | Default office camera overview | **PASS** | `01-default-office-camera.jpeg` shows the default 3D camera with the meeting room, library, rest area, server room, desks, and employees in one readable composition. |
| B | Active run rhythm for at least 60 seconds | **PASS** | `02-active-run-t00.jpeg`, `03-active-run-t30.jpeg`, and `04-active-run-t60.jpeg`. A real Codex CLI lane remained `WORKING` for more than 60 seconds and naturally returned `QA_DONE`. Thirteen Computer Use samples at five-second intervals showed continuous actor/work-state progression with no freeze, black frame, layout jump, or position discontinuity. |
| C | Idle employee rest-area sequence | **PASS** | `06-rest-area-entry.jpeg` → `07-rest-area-transit.jpeg` → `08-rest-area-activity.jpeg` shows an idle employee entering the rest area, traversing it, and reaching the water-cooler activity point. |
| D | Local chatter sequence and readability | **PASS** | `09-chatter-turn-1.jpeg` and `10-chatter-turn-2.jpeg` show the paired local exchange “Coffee run?” → “Spiritually, yes.” Both bubbles are fully readable, use a normal bounded width, and do not clip text. |
| E | Reduced motion preserves information with static presentation | **PASS** | `11-reduced-motion-setting-on.jpeg` confirms macOS Reduce Motion was on. `12-reduced-motion-static-t00.jpeg` and `13-reduced-motion-static-t01.jpeg` keep the same “Spiritually, yes.” bubble, actor positions, poses, and facial presentation. `magick compare -metric AE -fuzz 2%` reported `0 (0)` differing pixels. Reduce Motion was restored to off afterward. |
| F | At least three representative body/head variants | **PASS** | `05-representative-character-variants.jpeg` shows more than three distinct silhouettes, including the large round companion-like body/head, spiky-haired compact character, rounded dark-haired character, and multiple distinct hair/body combinations without mesh or pose corruption. |
| G | Final rebuilt artifact launch smoke | **PASS** | After all required gates rebuilt the bundle, the old process was quit and the exact final `.app` path was relaunched. `14-final-rebuilt-app-smoke.jpeg` shows the healthy company picker with the expected 8-person QA company. |

## Required gates

All gates from `Docs/roadmap/2026-07-23-office-performance-v2.md` passed on the source commit above:

- `pnpm harness:dramaturgy-modes` — 16/16
- `pnpm harness:office-ambient-p5` — 78/78
- `pnpm harness:scene-cue` — 87/87
- `pnpm harness:character-actions-p3` — PASS, 24 real GLB clips
- `pnpm harness:character-clip-map` — PASS, 92,160 deterministic states
- `pnpm harness:office-diorama-p6` — 60/60
- `pnpm harness:office-scene-quality` — 68/68
- `pnpm typecheck` — 23/23 tasks
- `pnpm lint` — 0 errors; warning ratchet 232/232
- `pnpm validate` — PASS
- `pnpm build` — 13/13 tasks; final release `.app` rebuilt and signed

`CI=true pnpm install` also completed with the lockfile unchanged and dependencies already current.

## Test-state notes

- The real run used the existing sanitized `Performance QA` company and `Performance Live Verify` project.
- A local empty project named `Chatter Release Verify`, backed by `/tmp/offisim-chatter-live-verify.vg0RRw`, was created to remove recent-delivery suppression and verify chatter/reduced-motion behavior without production or private data.
- Office presentation mode and macOS Reduce Motion were restored to their original values. No code, production data, credentials, PR state, deployment, or notarization state was changed.
- File hashes are recorded in `evidence-manifest.json`.
