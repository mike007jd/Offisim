# Spacing Density

Offisim now exposes shared spacing tokens through CSS variables on `:root`.

## Tokens

Normal:
- `--sp-xs`: 4px
- `--sp-sm`: 8px
- `--sp-md`: 12px
- `--sp-lg`: 16px
- `--sp-xl`: 20px
- `--sp-xxl`: 24px
- `--sp-xxxl`: 32px

Compact:
- `--sp-xs`: 2px
- `--sp-sm`: 4px
- `--sp-md`: 8px
- `--sp-lg`: 12px
- `--sp-xl`: 16px
- `--sp-xxl`: 20px
- `--sp-xxxl`: 24px

Spacious:
- `--sp-xs`: 6px
- `--sp-sm`: 12px
- `--sp-md`: 16px
- `--sp-lg`: 20px
- `--sp-xl`: 28px
- `--sp-xxl`: 32px
- `--sp-xxxl`: 40px

## Tailwind Mapping

`apps/desktop/renderer/src/styles/index.css` maps these variables into Tailwind spacing tokens:
- `p-sp-sm`
- `px-sp-lg`
- `gap-sp-md`
- `mt-sp-xl`

When a component cannot express the layout cleanly with utility classes, use inline styles with the CSS variables directly, for example `style={{ padding: 'var(--sp-lg)' }}`.

## Migration Guide

Preferred replacements:
- `p-2` -> `p-sp-sm`
- `p-3` -> `p-sp-md`
- `p-4` -> `p-sp-lg`
- `gap-2` -> `gap-sp-sm`
- `gap-3` -> `gap-sp-md`
- `gap-4` -> `gap-sp-lg`

Avoid introducing half-step spacing values like:
- `p-0.5`
- `p-1.5`
- `gap-2.5`

## Verification Checklist

- Toggle density in Settings and confirm `data-density` changes on `document.documentElement`
- Check Studio panels respond through `SP.*` getters
- Check shell spacing in `AppLayout`, `Header`, `ChatDrawer`, `AgentPanel`, and `ChatPanel`
- Verify compact mode does not clip controls
- Verify spacious mode does not cause overflow in dialog layouts
