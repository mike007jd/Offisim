# Spacing and Tokens

Offisim exposes its design tokens as CSS variables on `:root` in
`apps/desktop/renderer/src/styles/tokens.css`. They all live under the `--off-*`
namespace. There is no `data-density` toggle and no per-density value set; the
token values are fixed.

## Spacing scale

A linear spacing ramp drives padding, gaps, and margins:

- `--off-sp-1`: 4px
- `--off-sp-2`: 6px
- `--off-sp-3`: 8px
- `--off-sp-4`: 10px
- `--off-sp-5`: 12px
- `--off-sp-6`: 14px
- `--off-sp-7`: 16px
- `--off-sp-8`: 20px
- `--off-sp-9`: 24px
- `--off-sp-10`: 28px

## Surfaces and ink

Backgrounds and text colors are layered so panels read against the shell:

- Backgrounds: `--off-bg`, `--off-surface-0`, `--off-surface-1`,
  `--off-surface-2`, `--off-surface-sunken`
- Text: `--off-ink-1` (primary) through `--off-ink-5` (faintest)
- Lines: `--off-line`, `--off-line-soft`, `--off-line-strong`

## Accent and status

- Accent: `--off-accent`, `--off-accent-strong`, `--off-accent-fg`,
  `--off-accent-surface`, `--off-accent-ring`
- Status: `--off-ok`, `--off-warn`, `--off-danger`, `--off-violet` (each paired
  with a `*-surface` tint)

## Radii

- `--off-r-2xs`: 4px
- `--off-r-xs`: 5px
- `--off-r-sm`: 7px
- `--off-r-md`: 9px
- `--off-r-lg`: 13px
- `--off-r-pill`: 999px
- `--off-r-round`: 50%
- `--off-r-full`: alias of `--off-r-pill`

## Elevation

`--off-elev-1`, `--off-elev-2`, `--off-elev-3` are the three shadow tiers.

## Type scale

Six distinct sizes back twelve aliased names so call sites stay stable
(`--off-fs-xs` 9px · `--off-fs-meta` 11px · `--off-fs-sm` 12px · `--off-fs-base`
13px · `--off-fs-lg` 15px · `--off-fs-xl` 19px). Fonts: `--off-font-sans`,
`--off-font-mono`.

## Usage

Reference tokens directly in CSS, for example
`padding: var(--off-sp-5)` or `border-radius: var(--off-r-md)`. When a value is
not covered by a token, prefer adding or reusing an `--off-*` token over a raw
literal so the system stays consistent.
