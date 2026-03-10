# Phase 7A: Pixel Visual Foundation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the AICS web shell from a generic dark-blue SaaS aesthetic into a distinctive retro pixel-art visual identity — new palette, pixel fonts, sharp-cornered components, and pixel-styled chrome.

**Architecture:** Bottom-up: CSS tokens → fonts → base UI components → layout chrome → feature panels. Each layer builds on the previous. All changes are in `apps/web/` (DOM styling) and `packages/renderer/` (scene tokens). No logic changes — purely visual.

**Tech Stack:** Tailwind CSS 4 (`@theme`), Google Fonts (Press Start 2P, Pixelify Sans, IBM Plex Mono), CVA (component variants), Radix UI primitives (unstyled)

**Design Reference:** `docs/plans/2026-03-10-phase7-pixel-openclaw-design.md` (Section 1.1–1.6)

---

## Pre-flight Checklist

Before starting ANY task, verify the repo builds cleanly:

```bash
cd /Users/haoshengli/Seafile/WebWorkSpace/Offisim
pnpm --filter @aics/web typecheck
pnpm --filter @aics/web build
```

Both must pass. If not, fix first.

---

## Task 1: Color System + Pixel CSS Foundation

Replace the current gray-blue Tailwind theme with the retro game palette from the design doc. Add pixel-specific CSS utilities and custom scrollbar styles.

**Files:**
- Modify: `apps/web/src/index.css`
- Modify: `apps/web/index.html`

**Step 1: Replace `@theme` tokens in `index.css`**

Replace the entire content of `apps/web/src/index.css` with:

```css
@import "tailwindcss";

/*
 * AICS Web Shell — Pixel Art Theme
 * Retro game palette inspired by SNES/GBA era.
 * Design ref: docs/plans/2026-03-10-phase7-pixel-openclaw-design.md §1.1
 */
@theme {
  /* ── Core palette ── */
  --color-ocean-deep:   #1a1c2c;
  --color-ocean-mid:    #333c57;
  --color-ocean-light:  #566c86;
  --color-sand:         #f4f4f4;
  --color-shell:        #8b9bb4;
  --color-lobster-red:  #e43b44;
  --color-coral-orange: #f77622;
  --color-kelp-green:   #3e8948;
  --color-sea-blue:     #3978a8;
  --color-abyss:        #0e071b;
  --color-pearl:        #ffffff;
  --color-foam:         #c0cbdc;

  /* ── Semantic aliases (maps old token names → new palette) ── */
  --color-surface:         #1a1c2c;
  --color-surface-light:   #333c57;
  --color-surface-lighter: #566c86;
  --color-border:          #566c86;
  --color-text-primary:    #f4f4f4;
  --color-text-secondary:  #8b9bb4;
  --color-text-muted:      #566c86;
  --color-accent:          #e43b44;
  --color-accent-hover:    #c42f38;
  --color-success:         #3e8948;
  --color-warning:         #f77622;
  --color-error:           #e43b44;
  --color-info:            #3978a8;

  /* ── Font families ── */
  --font-pixel-display: 'Press Start 2P', monospace;
  --font-pixel-body:    'Pixelify Sans', system-ui, sans-serif;
  --font-pixel-mono:    'IBM Plex Mono', monospace;
}

/* ── Base styles ── */
body {
  @apply bg-surface text-text-primary;
  font-family: var(--font-pixel-body);
  -webkit-font-smoothing: none;
  -moz-osx-font-smoothing: unset;
  text-rendering: optimizeSpeed;
  image-rendering: pixelated;
}

/* ── Pixel utility classes ── */
.font-pixel-display {
  font-family: var(--font-pixel-display);
}

.font-pixel-body {
  font-family: var(--font-pixel-body);
}

.font-pixel-mono {
  font-family: var(--font-pixel-mono);
}

/* ── Pixel border utilities ── */
.pixel-border {
  border: 2px solid var(--color-ocean-light);
  border-radius: 0;
}

.pixel-border-double {
  border: 2px solid var(--color-ocean-light);
  outline: 2px solid var(--color-abyss);
  outline-offset: 2px;
  border-radius: 0;
}

.pixel-inset {
  border: 2px solid;
  border-color: var(--color-abyss) var(--color-ocean-light) var(--color-ocean-light) var(--color-abyss);
  border-radius: 0;
}

/* ── Custom pixel scrollbar ── */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: var(--color-ocean-deep);
}

::-webkit-scrollbar-thumb {
  background: var(--color-ocean-light);
  border: 1px solid var(--color-ocean-mid);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--color-lobster-red);
}

::-webkit-scrollbar-corner {
  background: var(--color-ocean-deep);
}

/* Firefox scrollbar */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--color-ocean-light) var(--color-ocean-deep);
}

/* ── Pixel cursor blink for inputs ── */
@keyframes pixel-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.pixel-cursor::after {
  content: '▮';
  animation: pixel-blink 1s step-end infinite;
  color: var(--color-lobster-red);
}

/* ── Pixel press effect for buttons ── */
.pixel-press:active {
  transform: translate(2px, 2px);
  box-shadow: none !important;
}
```

**Step 2: Add Google Fonts to `index.html`**

Add the font preconnect and stylesheet links in the `<head>` of `apps/web/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Company Simulator</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Pixelify+Sans:wght@400;500;600;700&family=Press+Start+2P&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 3: Verify**

```bash
pnpm --filter @aics/web typecheck
pnpm --filter @aics/web build
```

Both must pass. The app will look different immediately (new colors, new font) but components will be progressively updated in subsequent tasks.

**Step 4: Commit**

```bash
git add apps/web/src/index.css apps/web/index.html
git commit -m "feat(web): pixel art color system + fonts + CSS foundation

Replace gray-blue Tailwind theme with retro game palette (ocean-deep,
lobster-red, kelp-green, etc.). Add Press Start 2P, Pixelify Sans,
IBM Plex Mono via Google Fonts. Add pixel utility classes (.pixel-border,
.pixel-inset, .pixel-press) and custom pixel scrollbar."
```

---

## Task 2: Pixel Button + Badge Components

Restyle the two most-used components with pixel aesthetics: sharp corners, 2px borders, press effect.

**Files:**
- Modify: `apps/web/src/components/ui/button.tsx`
- Modify: `apps/web/src/components/ui/badge.tsx`

**Step 1: Rewrite button variants in `button.tsx`**

Replace the `buttonVariants` definition (lines 6-30) with pixel-styled variants. Keep the component structure identical — only change CSS classes:

```typescript
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors pixel-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border-2 border-lobster-red bg-lobster-red text-pearl shadow-[2px_2px_0px_0px] shadow-abyss hover:bg-coral-orange hover:border-coral-orange',
        destructive:
          'border-2 border-error bg-error text-pearl shadow-[2px_2px_0px_0px] shadow-abyss hover:bg-error/80',
        outline:
          'border-2 border-ocean-light bg-transparent text-sand shadow-[2px_2px_0px_0px] shadow-abyss hover:bg-ocean-mid',
        secondary:
          'border-2 border-ocean-light bg-ocean-mid text-sand shadow-[2px_2px_0px_0px] shadow-abyss hover:bg-surface-lighter',
        ghost:
          'border-2 border-transparent hover:bg-ocean-mid hover:border-ocean-light',
        link:
          'text-sea-blue underline-offset-4 hover:underline border-0',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-10 px-8',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);
```

**Key changes from current:**
- Removed all `rounded-*` (sharp pixel corners)
- Added `pixel-press` class (active push effect from CSS)
- Added `shadow-[2px_2px_0px_0px] shadow-abyss` (pixel drop shadow)
- Primary = lobster-red (brand accent)
- Secondary = ocean-mid
- Ghost = transparent with border on hover

**Step 2: Rewrite badge variants in `badge.tsx`**

Replace the `badgeVariants` definition (lines 5-23) with pixel-styled variants:

```typescript
const badgeVariants = cva(
  'inline-flex items-center border-2 px-2 py-0.5 text-xs font-semibold font-pixel-mono transition-colors',
  {
    variants: {
      variant: {
        default: 'border-lobster-red bg-lobster-red/20 text-lobster-red',
        secondary: 'border-ocean-light bg-ocean-mid text-shell',
        success: 'border-kelp-green bg-kelp-green/20 text-kelp-green',
        warning: 'border-coral-orange bg-coral-orange/20 text-coral-orange',
        error: 'border-lobster-red bg-lobster-red/20 text-lobster-red',
        info: 'border-sea-blue bg-sea-blue/20 text-sea-blue',
        outline: 'border-ocean-light text-shell',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);
```

**Key changes:**
- Removed `rounded-full` (no pill shapes — pixel aesthetic)
- Added `font-pixel-mono` for monospace badge text
- `border-2` instead of `border` (thicker pixel border)
- All colors use new palette tokens

**Step 3: Verify**

```bash
pnpm --filter @aics/web typecheck
pnpm --filter @aics/web build
```

**Step 4: Commit**

```bash
git add apps/web/src/components/ui/button.tsx apps/web/src/components/ui/badge.tsx
git commit -m "feat(web): pixel-styled Button + Badge components

Sharp corners, 2px borders, pixel drop shadow, press-down active
effect. Primary button uses lobster-red. Badge uses monospace font."
```

---

## Task 3: Pixel Card + Alert + Progress Components

Restyle Card (double-line pixel border), Alert (pixel border with icon), and Progress (pixel bar).

**Files:**
- Modify: `apps/web/src/components/ui/card.tsx`
- Modify: `apps/web/src/components/ui/alert.tsx`
- Modify: `apps/web/src/components/ui/progress.tsx`

**Step 1: Rewrite `card.tsx`**

Replace Card's className (line 8). Keep the component structure + forwardRef + displayName:

```typescript
// Card — line 8 className:
'border-2 border-ocean-light bg-ocean-mid shadow-[2px_2px_0px_0px] shadow-abyss/50'

// CardHeader — line 17 className (no changes needed, keep 'flex flex-col gap-1.5 p-4')

// CardTitle — line 25 className:
'font-semibold leading-none tracking-tight font-pixel-body'

// CardContent — line 33 className (no changes needed, keep 'p-4 pt-0')
```

**Key changes:**
- Removed `rounded-lg` → sharp corners
- Removed `shadow-sm` → pixel shadow `shadow-[2px_2px_0px_0px]`
- `bg-surface-light` → `bg-ocean-mid` (same hex, explicit palette name)
- `border-border` → `border-ocean-light` (explicit palette name)

**Step 2: Rewrite `alert.tsx` variants**

Replace `alertVariants` base and variants (lines 5-19):

```typescript
const alertVariants = cva(
  'relative w-full border-2 px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-current [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        default: 'border-ocean-light bg-ocean-mid text-sand',
        destructive: 'border-lobster-red bg-lobster-red/10 text-lobster-red [&>svg]:text-lobster-red',
        warning: 'border-coral-orange bg-coral-orange/10 text-coral-orange [&>svg]:text-coral-orange',
        success: 'border-kelp-green bg-kelp-green/10 text-kelp-green [&>svg]:text-kelp-green',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);
```

**Key changes:**
- Removed `rounded-lg`
- `border` → `border-2`
- All colors use new palette tokens

**Step 3: Rewrite `progress.tsx`**

Replace the Progress component's className values (lines 23-31):

```typescript
// Outer track — line 23-26 className:
'relative h-2 w-full overflow-hidden bg-ocean-mid border border-ocean-light'

// Inner bar — line 29-31 className:
'h-full bg-lobster-red transition-all duration-300 ease-in-out'
```

**Key changes:**
- Removed `rounded-full` from both track and bar (sharp pixel edges)
- `bg-surface-lighter` → `bg-ocean-mid` (darker track)
- `bg-accent` → `bg-lobster-red` (brand color for progress)

**Step 4: Verify + Commit**

```bash
pnpm --filter @aics/web typecheck && pnpm --filter @aics/web build
git add apps/web/src/components/ui/card.tsx apps/web/src/components/ui/alert.tsx apps/web/src/components/ui/progress.tsx
git commit -m "feat(web): pixel-styled Card, Alert, Progress components

Double-line Card borders, sharp-cornered Alert variants, pixel
Progress bar with lobster-red fill."
```

---

## Task 4: Pixel Input + Textarea + Select Components

Restyle form inputs with inset pixel border (dark top-left, light bottom-right for depth illusion).

**Files:**
- Modify: `apps/web/src/components/ui/input.tsx`
- Modify: `apps/web/src/components/ui/textarea.tsx`
- Modify: `apps/web/src/components/ui/select.tsx`

**Step 1: Rewrite `input.tsx` className**

Replace Input's className (line 10):

```typescript
'flex h-9 w-full border-2 border-t-abyss border-l-abyss border-b-ocean-light border-r-ocean-light bg-ocean-deep px-3 py-1 text-sm text-sand placeholder:text-shell focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lobster-red disabled:cursor-not-allowed disabled:opacity-50'
```

**Key changes:**
- Removed `rounded-md` → sharp corners
- Inset border: dark on top-left (`border-t-abyss border-l-abyss`), light on bottom-right (`border-b-ocean-light border-r-ocean-light`)
- Focus ring = lobster-red
- `bg-surface-light` → `bg-ocean-deep` (deeper inset appearance)

**Step 2: Rewrite `textarea.tsx` className**

Replace Textarea's className (line 9):

```typescript
'flex min-h-[60px] w-full border-2 border-t-abyss border-l-abyss border-b-ocean-light border-r-ocean-light bg-ocean-deep px-3 py-2 text-sm text-sand placeholder:text-shell focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lobster-red disabled:cursor-not-allowed disabled:opacity-50'
```

Same inset border pattern as Input.

**Step 3: Rewrite `select.tsx` classNames**

Replace SelectTrigger className (line 17):

```typescript
'flex h-9 w-full items-center justify-between gap-2 border-2 border-ocean-light bg-ocean-mid px-3 py-2 text-sm text-sand placeholder:text-shell focus:outline-none focus:ring-2 focus:ring-lobster-red disabled:cursor-not-allowed disabled:opacity-50'
```

Replace SelectContent className (lines 37-39):

```typescript
'relative z-50 max-h-96 min-w-[8rem] overflow-hidden border-2 border-ocean-light bg-ocean-mid text-sand shadow-[4px_4px_0px_0px] shadow-abyss'
```

Replace SelectItem className (line 66):

```typescript
'relative flex w-full cursor-default select-none items-center py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-ocean-deep data-[disabled]:pointer-events-none data-[disabled]:opacity-50'
```

**Key changes for all Select parts:**
- Removed all `rounded-*`
- Pixel drop shadow on dropdown
- Focus highlight = ocean-deep
- Consistent palette tokens

**Step 4: Verify + Commit**

```bash
pnpm --filter @aics/web typecheck && pnpm --filter @aics/web build
git add apps/web/src/components/ui/input.tsx apps/web/src/components/ui/textarea.tsx apps/web/src/components/ui/select.tsx
git commit -m "feat(web): pixel-styled Input, Textarea, Select components

Inset pixel border (dark top-left, light bottom-right) for depth
illusion. Sharp corners, lobster-red focus ring."
```

---

## Task 5: Pixel Dialog + Tabs + ScrollArea Components

Restyle overlay/container components. Fix Tabs' undefined token references.

**Files:**
- Modify: `apps/web/src/components/ui/dialog.tsx`
- Modify: `apps/web/src/components/ui/tabs.tsx`
- Modify: `apps/web/src/components/ui/scroll-area.tsx`

**Step 1: Rewrite `dialog.tsx` classNames**

Replace DialogOverlay className (line 18):

```typescript
'fixed inset-0 z-50 bg-abyss/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'
```

Replace DialogContent className (lines 34-35):

```typescript
'fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] border-2 border-ocean-light bg-ocean-deep p-6 shadow-[4px_4px_0px_0px] shadow-abyss'
```

Replace DialogClose className (line 41):

```typescript
'absolute right-4 top-4 opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-lobster-red'
```

Replace DialogTitle className (line 59):

```typescript
'text-lg font-semibold leading-none font-pixel-body text-sand'
```

**Key changes:**
- Removed all `rounded-*`
- Overlay uses `bg-abyss/80` (darkest, pixel feel)
- Content: pixel border + drop shadow
- Focus ring = lobster-red
- Title uses pixel body font

**Step 2: Rewrite `tabs.tsx` classNames — FIX BROKEN TOKENS**

The current tabs.tsx references undefined tokens (`bg-muted`, `text-muted-foreground`, `ring-offset-background`, `bg-background`, `text-foreground`, `ring-ring`). Replace ALL of them.

Replace TabsList className (line 15):

```typescript
'inline-flex h-9 items-center justify-center bg-ocean-mid p-1 text-shell border-b-2 border-ocean-light'
```

Replace TabsTrigger className (line 30):

```typescript
'inline-flex items-center justify-center whitespace-nowrap px-3 py-1 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lobster-red disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-ocean-deep data-[state=active]:text-sand data-[state=active]:border-b-2 data-[state=active]:border-lobster-red'
```

Replace TabsContent className (line 45):

```typescript
'mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lobster-red'
```

**Key changes:**
- Fixed all undefined token references
- Removed all `rounded-*`
- Active tab: ocean-deep bg + lobster-red bottom border
- Focus ring uses lobster-red

**Step 3: Rewrite `scroll-area.tsx` classNames**

Replace ScrollBar className for vertical (line 32):

```typescript
orientation === 'vertical' && 'h-full w-2 border-l border-l-ocean-light p-0'
```

Replace ScrollBar className for horizontal (line 33):

```typescript
orientation === 'horizontal' && 'h-2 flex-col border-t border-t-ocean-light p-0'
```

Replace ScrollAreaThumb className (line 38):

```typescript
'relative flex-1 bg-ocean-light hover:bg-lobster-red'
```

**Key changes:**
- Removed `rounded-full` from thumb (sharp pixel thumb)
- Width `w-2` (8px, matching custom scrollbar)
- Hover = lobster-red (matching custom scrollbar)

**Step 4: Verify + Commit**

```bash
pnpm --filter @aics/web typecheck && pnpm --filter @aics/web build
git add apps/web/src/components/ui/dialog.tsx apps/web/src/components/ui/tabs.tsx apps/web/src/components/ui/scroll-area.tsx
git commit -m "feat(web): pixel-styled Dialog, Tabs, ScrollArea components

Fix Tabs undefined token references. Sharp-cornered Dialog with pixel
drop shadow. Pixel scrollbar thumb with lobster-red hover."
```

---

## Task 6: Header + StatusBar Pixel Redesign

Transform the app chrome with pixel fonts and retro styling.

**Files:**
- Modify: `apps/web/src/components/layout/Header.tsx`
- Modify: `apps/web/src/components/layout/StatusBar.tsx`

**Step 1: Rewrite `Header.tsx`**

Replace the entire return JSX of the Header component (lines 13-27):

```tsx
export function Header({ providerName, onOpenSettings, onFileImport }: HeaderProps) {
  return (
    <header className="flex h-12 items-center justify-between border-b-2 border-ocean-light bg-ocean-deep px-4">
      <div className="flex items-center gap-3">
        <h1 className="font-pixel-display text-[10px] text-lobster-red tracking-wider">
          AICS
        </h1>
        <span className="text-xs text-shell font-pixel-body">AI Company Simulator</span>
        {providerName && <Badge variant="secondary">{providerName}</Badge>}
      </div>
      <div className="flex items-center gap-2">
        <FileImportTrigger onFileSelect={onFileImport} />
        <Button variant="ghost" size="icon" onClick={onOpenSettings}>
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
```

**Key changes:**
- "AICS" in Press Start 2P at 10px (pixel display font, tiny and crisp)
- "AI Company Simulator" as subtitle in Pixelify Sans
- AICS text = lobster-red (brand color)
- Border: `border-b-2 border-ocean-light` (thicker pixel border)

**Step 2: Rewrite `StatusBar.tsx`**

Replace the return JSX of StatusBar (lines 39-52):

```tsx
  return (
    <footer className="flex h-8 items-center justify-between border-t-2 border-ocean-light bg-ocean-deep px-4 font-pixel-mono text-[10px] text-shell">
      <div className="flex items-center gap-4">
        <Badge variant={statusVariant} className="text-[10px] px-1.5 py-0">
          {runStatus}
        </Badge>
        {modelName && <span>MODEL: {modelName}</span>}
      </div>
      <div className="flex items-center gap-4">
        {totalTokens > 0 && <span>TKN: {totalTokens.toLocaleString()}</span>}
        {lastLatencyMs != null && <span>LAT: {lastLatencyMs}ms</span>}
      </div>
    </footer>
  );
```

**Key changes:**
- `font-pixel-mono text-[10px]` — monospace pixel data readout
- Labels uppercased: "MODEL:", "TKN:", "LAT:" (retro terminal feel)
- `text-shell` (muted secondary text)
- `border-t-2 border-ocean-light` (thicker pixel border)

**Step 3: Verify + Commit**

```bash
pnpm --filter @aics/web typecheck && pnpm --filter @aics/web build
git add apps/web/src/components/layout/Header.tsx apps/web/src/components/layout/StatusBar.tsx
git commit -m "feat(web): pixel-styled Header + StatusBar

Press Start 2P title, monospace status readout with retro labels.
Thicker pixel borders on app chrome."
```

---

## Task 7: AppLayout + ChatDrawer Pixel Styling

Update the layout container and chat drawer toggle bar to match the pixel theme.

**Files:**
- Modify: `apps/web/src/components/layout/AppLayout.tsx`
- Modify: `apps/web/src/components/chat/ChatDrawer.tsx`

**Step 1: Read and update `AppLayout.tsx`**

Update the sidebar border classes and overall grid:

In the left aside, replace:
```
border-r border-border
```
with:
```
border-r-2 border-ocean-light
```

In the right aside, replace:
```
border-l border-border
```
with:
```
border-l-2 border-ocean-light
```

**Step 2: Rewrite `ChatDrawer.tsx`**

Replace the entire return JSX (lines 11-33). Keep the component shell and state logic:

```tsx
  return (
    <div className="border-t-2 border-ocean-light bg-ocean-deep">
      {/* Toggle bar — always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-center gap-1 py-1.5 font-pixel-mono text-[10px] text-shell hover:bg-ocean-mid hover:text-sand transition-colors"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        <span>{open ? 'HIDE CHAT' : 'SHOW CHAT'}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
      </button>

      {/* Collapsible content area */}
      <div
        className="transition-[max-height] duration-300 ease-in-out overflow-hidden"
        style={{ maxHeight: open ? '50vh' : '0px' }}
      >
        {open && <div className="h-[50vh] overflow-hidden">{children}</div>}
      </div>
    </div>
  );
```

**Key changes:**
- `bg-background` → `bg-ocean-deep` (fix undefined token)
- `text-muted-foreground` → `text-shell` (fix undefined token)
- `hover:bg-accent/50` → `hover:bg-ocean-mid` (pixel hover)
- `font-pixel-mono text-[10px]` — monospace toggle text
- Labels uppercased: "HIDE CHAT" / "SHOW CHAT" (retro feel)

**Step 3: Verify + Commit**

```bash
pnpm --filter @aics/web typecheck && pnpm --filter @aics/web build
git add apps/web/src/components/layout/AppLayout.tsx apps/web/src/components/chat/ChatDrawer.tsx
git commit -m "feat(web): pixel-styled AppLayout borders + ChatDrawer

Thicker 2px pixel borders on sidebars. Monospace toggle bar with
retro uppercase labels. Fix undefined token references."
```

---

## Task 8: Chat Components Pixel Styling

Restyle message bubbles, streaming indicator, and chat input with pixel aesthetic.

**Files:**
- Modify: `apps/web/src/components/chat/MessageBubble.tsx`
- Modify: `apps/web/src/components/chat/StreamingBubble.tsx`
- Modify: `apps/web/src/components/chat/ChatInput.tsx`

**Step 1: Rewrite `MessageBubble.tsx`**

Replace the inner div className (lines 13-16):

```tsx
export function MessageBubble({ role, content }: MessageBubbleProps) {
  const isUser = role === 'user';
  return (
    <div data-role={role} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] border-2 px-4 py-2 text-sm whitespace-pre-wrap',
          isUser
            ? 'border-lobster-red bg-lobster-red/20 text-sand'
            : 'border-ocean-light bg-ocean-mid text-sand',
        )}
      >
        {content}
      </div>
    </div>
  );
}
```

**Key changes:**
- Removed `rounded-lg` → sharp pixel corners
- User bubble: lobster-red border + subtle red bg
- Assistant bubble: ocean-light border + ocean-mid bg

**Step 2: Rewrite `StreamingBubble.tsx`**

Read the file first, then replace the return JSX. The streaming cursor should use pixel-style blink:

```tsx
export function StreamingBubble({ content, isStreaming }: StreamingBubbleProps) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] border-2 border-ocean-light bg-ocean-mid px-4 py-2 text-sm text-sand whitespace-pre-wrap">
        {content || '\u00A0'}
        {isStreaming && (
          <span className="inline-block w-2 h-4 ml-0.5 bg-lobster-red animate-pulse" />
        )}
      </div>
    </div>
  );
}
```

**Key changes:**
- Removed `rounded-lg`
- Pixel border + ocean-mid bg
- Cursor: `bg-lobster-red` (brand color), no `rounded-sm`

**Step 3: Update `ChatInput.tsx`**

Replace the outer div className (line 30):

```tsx
<div className="flex items-end gap-2 border-t-2 border-ocean-light p-3">
```

**Key change:** `border-t` → `border-t-2` (thicker pixel border)

**Step 4: Verify + Commit**

```bash
pnpm --filter @aics/web typecheck && pnpm --filter @aics/web build
git add apps/web/src/components/chat/MessageBubble.tsx apps/web/src/components/chat/StreamingBubble.tsx apps/web/src/components/chat/ChatInput.tsx
git commit -m "feat(web): pixel-styled chat bubbles + input

Sharp-cornered message bubbles with pixel borders. User messages
use lobster-red accent, assistant uses ocean-mid. Pixel cursor blink."
```

---

## Task 9: EventLog + AgentPanel Pixel Styling

Restyle the right sidebar (event log) and left sidebar (agent panel) with pixel aesthetic.

**Files:**
- Modify: `apps/web/src/components/events/EventLog.tsx`
- Modify: `apps/web/src/components/events/EventItem.tsx`
- Modify: `apps/web/src/components/agents/AgentPanel.tsx`
- Modify: `apps/web/src/components/agents/AgentCard.tsx`

**Step 1: Update `EventLog.tsx` heading**

Read the file first. Update the heading class:

Replace the `<h2>` className from:
```
text-xs font-semibold uppercase tracking-wider text-text-muted p-3 pb-1
```
to:
```
font-pixel-display text-[8px] uppercase tracking-wider text-shell p-3 pb-1
```

**Step 2: Update `EventItem.tsx` styling**

The EventItem is already minimal. Update text styling:

Replace `text-text-primary` with `text-sand` and `text-text-muted` with `text-shell` in the component. Also change the icon colors:

```typescript
const iconColor = isError ? 'text-lobster-red' : isEntered ? 'text-sea-blue' : 'text-kelp-green';
```

**Key changes:**
- Error: `text-error` → `text-lobster-red`
- Started: `text-info` → `text-sea-blue`
- Completed: `text-success` → `text-kelp-green`

**Step 3: Update `AgentPanel.tsx` heading**

Read the file first. Update the heading class:

Replace the `<h2>` className from:
```
text-xs font-semibold uppercase tracking-wider text-text-muted
```
to:
```
font-pixel-display text-[8px] uppercase tracking-wider text-shell
```

**Step 4: Update `AgentCard.tsx` styling**

Replace state variants to use new palette token names (the hex values are the same, just more explicit):

Update the agent name div class:
```
text-sm font-medium
```
to:
```
text-sm font-medium text-sand
```

Update the role label div class:
```
text-xs text-text-muted
```
to:
```
text-xs text-shell font-pixel-mono
```

The state variants map is fine — it references badge variants which are already updated.

**Step 5: Verify + Commit**

```bash
pnpm --filter @aics/web typecheck && pnpm --filter @aics/web build
git add apps/web/src/components/events/EventLog.tsx apps/web/src/components/events/EventItem.tsx apps/web/src/components/agents/AgentPanel.tsx apps/web/src/components/agents/AgentCard.tsx
git commit -m "feat(web): pixel-styled EventLog + AgentPanel

Press Start 2P section headings, monospace role labels, retro
palette icon colors. Consistent pixel aesthetic across sidebars."
```

---

## Task 10: PlanProgressPanel + SceneCanvas + EmptyState Pixel Styling

Update remaining visible components.

**Files:**
- Modify: `apps/web/src/components/plan/PlanProgressPanel.tsx`
- Modify: `apps/web/src/components/scene/SceneCanvas.tsx`
- Modify: `apps/web/src/components/error/EmptyState.tsx` (if exists)
- Modify: `apps/web/src/components/error/ErrorBanner.tsx` (if exists)

**Step 1: Update `PlanProgressPanel.tsx`**

Read the file first. Key class replacements throughout the component:

- Section heading: change `text-xs font-semibold uppercase tracking-wider text-text-muted` → `font-pixel-display text-[8px] uppercase tracking-wider text-shell`
- Border: `border-border` → `border-ocean-light`, all `border-*` to `border-*-2`
- Background: `bg-surface-light/50` → `bg-ocean-mid/50`
- Text: `text-text-primary` → `text-sand`, `text-text-muted` → `text-shell`
- Active step pulse: keep `animate-pulse`
- Active step color: use `text-lobster-red` for active indicator

**Step 2: Update `SceneCanvas.tsx`**

Replace background color:
```
bg-slate-50
```
to:
```
bg-ocean-deep
```

This aligns the PixiJS container background with the app's dark pixel theme. The actual scene will be redrawn in Phase 7B, but the container should match now.

**Step 3: Update `EmptyState.tsx` and `ErrorBanner.tsx`**

Read both files. Apply consistent palette changes:
- Backgrounds: use `ocean-mid` or `ocean-deep`
- Text: `text-sand` / `text-shell`
- Error colors: `lobster-red`
- Borders: `border-2 border-ocean-light`
- Remove any `rounded-*` classes

**Step 4: Verify + Commit**

```bash
pnpm --filter @aics/web typecheck && pnpm --filter @aics/web build
git add apps/web/src/components/plan/PlanProgressPanel.tsx apps/web/src/components/scene/SceneCanvas.tsx apps/web/src/components/error/
git commit -m "feat(web): pixel-styled PlanProgress, SceneCanvas, error states

Consistent pixel theme across all remaining components. Dark scene
canvas background. Retro section headings."
```

---

## Task 11: Renderer Token Update

Update the PixiJS scene color tokens to match the new retro palette.

**Files:**
- Modify: `packages/renderer/src/tokens/colors.ts`

**Step 1: Update `SCENE_COLORS` in `colors.ts`**

Replace the SCENE_COLORS constant (lines 20-27):

```typescript
/** Floor / furniture palette — retro pixel theme */
export const SCENE_COLORS = {
  floor:       0x333c57,  /* ocean-mid */
  floorBorder: 0x566c86,  /* ocean-light */
  desk:        0x566c86,  /* ocean-light */
  deskBorder:  0x8b9bb4,  /* shell */
  text:        0xf4f4f4,  /* sand */
  textLight:   0x8b9bb4,  /* shell */
} as const;
```

**Key changes:**
- Floor: `0xf1f5f9` (light gray) → `0x333c57` (ocean-mid, dark)
- Desk: `0xe2e8f0` → `0x566c86` (ocean-light)
- Text: `0x334155` (dark) → `0xf4f4f4` (sand, light — inverted for dark bg)
- All values now match the DOM palette

The STATE_COLORS (lines 4-17) can remain as-is for now — those are functionally correct and will be refined in Phase 7B when the lobster character system is built.

**Step 2: Verify**

```bash
pnpm --filter @aics/renderer typecheck
pnpm --filter @aics/renderer build
pnpm --filter @aics/renderer test
```

All 17 existing tests must pass.

**Step 3: Commit**

```bash
git add packages/renderer/src/tokens/colors.ts
git commit -m "feat(renderer): update scene colors to retro pixel palette

Dark floor (ocean-mid), lighter furniture (ocean-light), light text
(sand). Matches DOM pixel theme for visual cohesion."
```

---

## Task 12: Full Verification + Settings Dialog Polish

Final pass: ensure all packages build, typecheck, and test. Fix any remaining components that reference old tokens.

**Files:**
- Modify: `apps/web/src/components/settings/SettingsDialog.tsx` (likely needs token updates)
- Modify: `apps/web/src/components/install/InstallDialog.tsx` (likely needs token updates)
- Modify: `apps/web/src/components/install/FileImportTrigger.tsx` (likely needs token updates)
- Modify: any other files found by grep for old token patterns

**Step 1: Search for remaining old token references**

```bash
cd /Users/haoshengli/Seafile/WebWorkSpace/Offisim
grep -rn 'bg-background\|text-foreground\|text-muted-foreground\|ring-offset-background\|ring-ring\|bg-muted\|rounded-lg\|rounded-md\|rounded-full\|rounded-sm' apps/web/src/components/ --include="*.tsx" --include="*.ts"
```

Fix every hit by replacing with the pixel palette equivalents:
- `bg-background` → `bg-ocean-deep`
- `text-foreground` → `text-sand`
- `text-muted-foreground` → `text-shell`
- `ring-offset-background` → (remove, not needed with pixel focus)
- `ring-ring` → `ring-lobster-red`
- `bg-muted` → `bg-ocean-mid`
- `rounded-lg` / `rounded-md` / `rounded-full` / `rounded-sm` → remove (sharp corners)

Exception: do NOT remove `rounded-[inherit]` from ScrollArea Viewport — that's a Radix passthrough.

**Step 2: Update SettingsDialog + InstallDialog**

Read both files. Apply the standard pixel treatment:
- Remove `rounded-*`
- Replace undefined tokens with palette equivalents
- Add `border-2` where `border` exists
- Use pixel fonts for headings

**Step 3: Full verification suite**

```bash
# All packages
pnpm --filter @aics/web typecheck
pnpm --filter @aics/renderer typecheck
pnpm --filter @aics/core typecheck
pnpm turbo run typecheck

# Tests
pnpm --filter @aics/renderer test
pnpm --filter @aics/core test

# Build
pnpm --filter @aics/web build

# Lint
pnpm --filter @aics/web lint
```

ALL must pass.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(web): polish remaining components + full pixel consistency

Fix all remaining undefined token references. Remove rounded corners
from Settings, Install, and FileImport dialogs. Full typecheck and
build verification."
```

---

## Cross-Reference: Files Modified Per Task

| Task | Files | Scope |
|------|-------|-------|
| 1 | index.css, index.html | Foundation |
| 2 | button.tsx, badge.tsx | UI Base |
| 3 | card.tsx, alert.tsx, progress.tsx | UI Base |
| 4 | input.tsx, textarea.tsx, select.tsx | UI Base |
| 5 | dialog.tsx, tabs.tsx, scroll-area.tsx | UI Base |
| 6 | Header.tsx, StatusBar.tsx | Layout Chrome |
| 7 | AppLayout.tsx, ChatDrawer.tsx | Layout Chrome |
| 8 | MessageBubble.tsx, StreamingBubble.tsx, ChatInput.tsx | Chat |
| 9 | EventLog.tsx, EventItem.tsx, AgentPanel.tsx, AgentCard.tsx | Sidebars |
| 10 | PlanProgressPanel.tsx, SceneCanvas.tsx, EmptyState.tsx, ErrorBanner.tsx | Misc |
| 11 | colors.ts (renderer) | Scene |
| 12 | SettingsDialog.tsx, InstallDialog.tsx, FileImportTrigger.tsx, + grep cleanup | Polish |

**Zero logic changes.** All modifications are purely visual (CSS classes, font references, color tokens). Component props, hooks, state, and event handling are untouched.

---

## Key Decisions

1. **Semantic aliases preserved** — `surface`, `accent`, `text-primary` etc. still work in Tailwind. Old code compiles fine. New code can use palette names directly (`ocean-deep`, `lobster-red`).
2. **Google Fonts via `<link>`** — Simplest approach. No npm font packages. Works in both browser and Tauri webview.
3. **No new dependencies** — Pure CSS + font changes. No new npm packages needed.
4. **`font-pixel-display` as CSS class** — Not a Tailwind font-family token (Tailwind 4 `@theme` doesn't support `--font-*` for `font-*` utility). Using explicit CSS class instead.
5. **`-webkit-font-smoothing: none`** — Disables sub-pixel antialiasing for crisper pixel fonts. May look rough on high-DPI screens — revisit in Phase 7E polish.
6. **Progressive enhancement** — After Task 1, the app already looks different (new colors). Each subsequent task refines individual components. The app is functional at every step.

---

## Final Verification

```bash
pnpm turbo run typecheck
pnpm --filter @aics/renderer test
pnpm --filter @aics/core test
pnpm --filter @aics/web build
```

Visual: Open `pnpm --filter @aics/web dev`, check all panels render with pixel aesthetic.
