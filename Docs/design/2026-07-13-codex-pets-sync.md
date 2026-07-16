# Codex Pets Sync

Checked at: 2026-07-13 AEST

## Product contract

Offisim does not own or bundle pet artwork. It reads valid packages from
`${CODEX_HOME:-~/.codex}/pets`, follows Codex's current `custom:<id>` selection on first use, and
then persists only the selected pet id in Offisim. It never writes to Codex config or pet files.

The companion remains an ambient office projection. It cannot run AI work, mutate projects,
messages, permissions, or runs, and it never becomes a second runtime beside the
selected AI engine.

## Package contract

Each immediate child directory must contain:

- `pet.json` with a safe id equal to the directory name, display name, description, and the exact
  relative path `spritesheet.webp`.
- A regular, non-symlink WebP file contained by that pet directory.
- A `1536 × 1872` atlas arranged as 8 columns × 9 rows of `192 × 208` cells.

The dedicated Tauri catalog command validates paths, file type, size, a complete static WebP decode,
dimensions, alpha, and fully transparent unused atlas cells. Content identity is a SHA-256 digest,
which is revalidated when the selected sheet is loaded. One bad package is reported as an invalid
catalog entry and does not hide valid pets. The selected sheet is returned through binary IPC and
held in one revocable renderer Blob URL; no general home-directory filesystem permission is exposed.

## Animation mapping

The row and timing contract follows the Codex `hatch-pet` animation specification:

| Row | Codex state | Office projection |
| --- | --- | --- |
| 0 | idle | quiet/rest and reduced-motion first frame |
| 1 | running-right | rightward route movement |
| 2 | running-left | leftward route movement |
| 3 | waving | ambient pause/greeting |
| 4 | jumping | delivery/success celebration |
| 5 | failed | blocked, failure, or resource pressure |
| 6 | waiting | approval wait |
| 7 | running | reserved Codex generic locomotion |
| 8 | review | active work observation |

2D crops the exact top-left cell. 3D uses the equivalent WebGL bottom-left texture offset. Neither
renderer mirrors directional rows. Reduced motion fixes the pet to row 0, column 0 and stops pet
animation scheduling.

## Current machine evidence

The source catalog contained four valid packages when checked: `bubu`, `chub`, `papaluo`, and
`tongtong`. Codex's selected avatar was `custom:papaluo`. This inventory is runtime evidence, not a
committed asset list; later installs and removals are picked up by **Sync pets**.

Format references:

- Codex local skill: `~/.codex/skills/hatch-pet/references/animation-rows.md`
- WebP RIFF container: <https://developers.google.com/speed/webp/docs/riff_container>
- Tauri v2 command bridge: <https://v2.tauri.app/develop/calling-rust/>
