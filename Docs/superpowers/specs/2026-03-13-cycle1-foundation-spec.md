# Cycle 1: Foundation Completion Spec

**Date:** 2026-03-13
**Status:** Approved
**Scope:** Desktop migration, 2 AI-native company templates, 3 UI package extractions

---

## 1. Desktop Migration v11-v13

### Problem
`apps/desktop/src-tauri/src/lib.rs` registers migrations only up to v10. Tables created by migrations 011-013 (sop_templates, office_layouts, library_documents) do not exist in the desktop SQLite database. SOP, layout, and library features silently fail or crash on desktop — the declared 1.0 reference environment.

### Solution
Register migrations 011, 012, 013 in the Tauri migration array. The SQL files already exist in `packages/db-local/src/migrations/`. No schema changes needed.

### Files
- `apps/desktop/src-tauri/src/lib.rs` — add 3 migration entries

---

## 2. Company Templates (AI-Native)

### Design Philosophy
Templates showcase three distinct AI collaboration paradigms:
- **R&D Company** (existing) — traditional org structure mapped to AI (onboarding friendly)
- **Content Studio** (new) — Generate-Critique pattern (AI review loops)
- **Product Team** (new) — Spec-Driven pattern (ambiguity → precision pipeline)

### 2.1 Content Studio

```
id: 'content-studio'
name: 'Content Studio'
description: 'AI content factory with research-draft-review-optimize pipeline. Showcases the Generate-Critique collaboration pattern.'
icon: '📝'
layoutPreset: 'rd-office'
```

#### Employees (4)

| Name | role_slug | Department | Persona Focus | CharacterConfig |
|------|-----------|------------|---------------|-----------------|
| Dana Rivera | `analyst` | PROD | Deep research, fact verification, source gathering. Produces structured research briefs. | skinColor: 0xf5d0b0, hairColor: 0x8b4513, hairStyle: 'long', clothingColor: 0xf59e0b, clothingAccent: 0xd97706, bodyType: 'normal', gender: 'feminine' |
| Leo Zhang | `developer` | DEV | Turns research into polished prose. Adapts tone, structure, and format to target audience. | skinColor: 0xe8c4a0, hairColor: 0x1a1a2e, hairStyle: 'short', clothingColor: 0x3b82f6, clothingAccent: 0x2563eb, bodyType: 'normal', gender: 'masculine' |
| Priya Sharma | `pm` | PROD | Quality auditor. Reviews drafts for accuracy, logic gaps, style consistency. Outputs structured critique with actionable revisions. | skinColor: 0xd2a882, hairColor: 0x1c1c1c, hairStyle: 'braids', clothingColor: 0xec4899, clothingAccent: 0xdb2777, bodyType: 'slim', gender: 'feminine' |
| Marco Rossi | `frontend` | DEV | SEO optimization, format adaptation, distribution readiness. Transforms reviewed content into publishable assets. | skinColor: 0xfce4c8, hairColor: 0x6b3a2a, hairStyle: 'curly', clothingColor: 0x14b8a6, clothingAccent: 0x0d9488, bodyType: 'stocky', gender: 'masculine' |

#### SOP: Content Pipeline

```
steps:
  research:
    label: "Research & Briefing"
    role_slug: analyst
    instruction: "Investigate the topic thoroughly. Gather facts, sources, data points, and competing perspectives. Output a structured research brief with key findings, verified facts, and suggested angles."
    output_key: research_brief
    dependencies: []

  draft:
    label: "Content Drafting"
    role_slug: developer
    instruction: "Using the research brief, write a complete draft. Match the target audience's reading level and expectations. Structure with clear sections, compelling opening, and actionable conclusion."
    output_key: content_draft
    dependencies: [research]

  review:
    label: "Quality Critique"
    role_slug: pm
    instruction: "Critically review the draft against the research brief. Check factual accuracy, logical flow, style consistency, and completeness. Output a structured critique: list specific issues with line references, rate overall quality 1-5, and provide concrete revision instructions. If quality < 3, the revision instructions should be detailed enough for the writer to fix without further guidance."
    output_key: review_report
    dependencies: [draft]

  optimize:
    label: "Optimize & Publish"
    role_slug: frontend
    instruction: "Apply the review feedback to polish the content. Optimize for SEO (titles, headers, meta descriptions, keyword density). Adapt format for target platform. Output the final publishable asset."
    output_key: final_content
    dependencies: [review]
```

### 2.2 Product Team

```
id: 'product-team'
name: 'Product Team'
description: 'AI development squad with specify-design-implement-review pipeline. Showcases the Spec-Driven collaboration pattern.'
icon: '🚀'
layoutPreset: 'rd-office'
```

#### Employees (4)

| Name | role_slug | Department | Persona Focus | CharacterConfig |
|------|-----------|------------|---------------|-----------------|
| Ava Mitchell | `pm` | PROD | Turns vague requirements into precise specs. Defines acceptance criteria, edge cases, constraints. | skinColor: 0xf0d5c0, hairColor: 0x4a3728, hairStyle: 'ponytail', clothingColor: 0x8b5cf6, clothingAccent: 0x7c3aed, bodyType: 'normal', gender: 'feminine' |
| Noah Kim | `backend` | DEV | System architect. Designs data models, APIs, component boundaries. Outputs technical design docs with interface contracts. | skinColor: 0xe8c8a0, hairColor: 0x2c1810, hairStyle: 'short', clothingColor: 0x059669, clothingAccent: 0x047857, bodyType: 'stocky', gender: 'masculine' |
| Elena Volkov | `fullstack` | DEV | Implementation specialist. Writes production-grade code from design docs. Focuses on correctness and test coverage. | skinColor: 0xfce4c8, hairColor: 0xc0392b, hairStyle: 'bob', clothingColor: 0x0ea5e9, clothingAccent: 0x0284c7, bodyType: 'slim', gender: 'feminine' |
| Raj Patel | `analyst` | PROD | Code reviewer and quality gate. Reviews implementation against spec and design. Finds bugs, security issues, performance problems. Outputs structured review with severity ratings. | skinColor: 0xd4a574, hairColor: 0x1c1c1c, hairStyle: 'spiky', clothingColor: 0xf97316, clothingAccent: 0xea580c, bodyType: 'normal', gender: 'masculine' |

#### SOP: Build Cycle

```
steps:
  specify:
    label: "Requirements Specification"
    role_slug: pm
    instruction: "Analyze the request and produce a precise specification. Define: functional requirements, acceptance criteria, edge cases, out-of-scope items, and constraints. Use structured format with numbered requirements."
    output_key: spec_doc
    dependencies: []

  design:
    label: "Technical Design"
    role_slug: backend
    instruction: "Design the technical solution based on the spec. Define: architecture, data models, API contracts, component boundaries, and error handling strategy. Output a design document with interface definitions."
    output_key: design_doc
    dependencies: [specify]

  implement:
    label: "Implementation"
    role_slug: fullstack
    instruction: "Implement the solution following the design document exactly. Write production-quality code with proper error handling and test coverage. Output the implementation with inline documentation for non-obvious decisions."
    output_key: implementation
    dependencies: [design]

  review:
    label: "Code Review"
    role_slug: analyst
    instruction: "Review the implementation against both the spec and design docs. Check: correctness vs spec, adherence to design, error handling, edge cases, security, performance. Output a structured review with issues categorized by severity (critical/major/minor) and specific fix suggestions."
    output_key: review_report
    dependencies: [implement]
```

---

## 3. UI Package Extraction

### 3.1 Strategy

Full extraction in one pass. After extraction:
- `apps/web` becomes a thin shell: AppLayout + runtime context + route wiring
- `apps/market` becomes a thin shell: Next.js pages + data fetching + layout

### 3.2 @aics/ui-core — Shared Atomic Components

**Source:** `apps/web/src/components/ui/`

**Components to extract:**
- Button, Badge, Card (CardHeader, CardTitle, CardDescription, CardContent, CardFooter)
- Dialog (DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter)
- Input, Label, Textarea, Select
- Tabs (TabsList, TabsTrigger, TabsContent)
- Separator, ScrollArea, Tooltip
- Popover, Sheet, Progress, Switch, Avatar

**Utilities to extract:**
- `lib/utils.ts` → `cn()` function (clsx + tailwind-merge)
- Tailwind preset with AICS design tokens (colors, fonts, spacing)
- CSS variables file (`globals.css` token definitions)

**Package structure:**
```
packages/ui-core/
  src/
    components/    — all atomic components
    lib/           — cn(), helpers
    styles/        — CSS variables, tailwind preset
    index.ts       — barrel export
  package.json     — deps: react, clsx, tailwind-merge, class-variance-authority
  tsconfig.json
  tailwind.preset.js
```

**Consumer changes:**
- `apps/web`: all `@/components/ui/*` imports → `@aics/ui-core`
- `apps/market`: duplicate shadcn components removed, import from `@aics/ui-core`

### 3.3 @aics/ui-office — Office Runtime Components

**Source:** `apps/web/src/components/` (non-ui subdirectories) + `apps/web/src/hooks/`

**Components to extract:**

| Category | Components |
|----------|-----------|
| Agent system | AgentPanel, AgentCard, AgentEditForm |
| Chat system | ChatPanel, ChatInput, StreamingBubble, ChatDrawer |
| Task system | TaskDashboard, TaskCard |
| Dashboard | BossDashboard |
| Events | EventLog |
| Outputs | PitchHall |
| Settings | SettingsDialog, ProviderConfigForm, McpConnectionManager |
| Wizard | CompanyCreationWizard, InterviewWizard |
| Install | InstallDialog, ManifestReview, BindingForm, InstallProgress |
| Scene | SceneCanvas (DOM wrapper for renderer) |
| Panels | LibraryPanel, ServerRoomPanel, OfficeEditor |
| Layout | StatusBar, AppHeader |

**Hooks to extract:**

| Hook | Purpose |
|------|---------|
| useScene | SceneManager lifecycle |
| useAgentStates | Employee state tracking |
| useDashboardMetrics | Token/cost/task aggregation |
| useLibrary | Library CRUD |
| useRackSlot | Rack/Slot CRUD |
| useCompanyCreation | Template materialization |
| useOfficeLayout | Layout CRUD |
| useChatStream | Streaming chat |
| useProviderConfig | LLM provider settings |

**Package structure:**
```
packages/ui-office/
  src/
    components/
      agent/       — AgentPanel, AgentCard, AgentEditForm
      chat/        — ChatPanel, ChatInput, StreamingBubble
      task/        — TaskDashboard, TaskCard
      dashboard/   — BossDashboard
      events/      — EventLog
      outputs/     — PitchHall
      settings/    — SettingsDialog, ProviderConfigForm
      wizard/      — CompanyCreationWizard, InterviewWizard
      install/     — InstallDialog, ManifestReview, BindingForm
      scene/       — SceneCanvas
      panels/      — LibraryPanel, ServerRoomPanel, OfficeEditor
      layout/      — StatusBar, AppHeader
    hooks/         — all extracted hooks
    index.ts       — barrel export
  package.json     — deps: @aics/ui-core, @aics/renderer, @aics/shared-types, react
  tsconfig.json
```

**Context dependency:** ui-office components consume `useAicsRuntime()` context. The context provider (`AicsRuntimeProvider`) stays in `apps/web` since it wires platform-specific repos (browser vs Tauri). Components accept the runtime values via React context — the provider is the app's responsibility, the consumer is the package's.

### 3.4 @aics/ui-market — Market Components

**Source:** `apps/market/src/components/`

**Components to extract:**

| Component | Purpose |
|-----------|---------|
| ListingCard | Package listing card |
| ListingGrid | Grid layout for listings |
| CreatorBadge | Creator identity badge |
| CreatorCard | Creator profile card |
| RatingStars | Star rating display |
| ReviewList | Review list with ratings |
| VersionTable | Package version history |
| PermissionsPanel | Permission review display |
| InstallButton | Deep-link install trigger |
| SearchFilters | Type/risk/sort filters |
| CategoryNav | Category navigation |

**Package structure:**
```
packages/ui-market/
  src/
    components/
      listing/     — ListingCard, ListingGrid
      creator/     — CreatorBadge, CreatorCard
      review/      — RatingStars, ReviewList
      package/     — VersionTable, PermissionsPanel
      install/     — InstallButton
      search/      — SearchFilters, CategoryNav
    index.ts
  package.json     — deps: @aics/ui-core, @aics/shared-types, react
  tsconfig.json
```

---

## 4. Build & Integration

### Dependency Graph (post-extraction)
```
@aics/ui-core        ← no AICS deps (only react + tailwind utils)
@aics/ui-office      ← @aics/ui-core, @aics/renderer, @aics/shared-types
@aics/ui-market      ← @aics/ui-core, @aics/shared-types
apps/web             ← @aics/ui-office (thin shell)
apps/market          ← @aics/ui-market (thin shell)
apps/desktop         ← apps/web (webview) + Tauri native
```

### Build Order
1. `@aics/ui-core` (no deps)
2. `@aics/ui-office` + `@aics/ui-market` (parallel, both depend on ui-core)
3. `apps/web` + `apps/market` (parallel, thin shells)

### Validation
- `pnpm -r build` — all packages compile
- `pnpm -r typecheck` — no type errors
- `pnpm --filter @aics/renderer test` — renderer tests pass (unchanged)
- `pnpm --filter @aics/core test` — core tests pass (new templates)
- `pnpm --filter web dev` — web app renders correctly
- `pnpm --filter market dev` — market app renders correctly
- Template materialization E2E: select Content Studio → create → verify 4 employees in correct zones

---

## 5. Success Criteria

1. Desktop app can create sop_templates, office_layouts, library_documents tables without error
2. Company creation wizard shows 3 template cards (R&D, Content Studio, Product Team)
3. Content Studio creates 4 employees with correct roles and runs Content Pipeline SOP
4. Product Team creates 4 employees with correct roles and runs Build Cycle SOP
5. `apps/web/src/components/` contains only AppLayout and thin wrappers
6. `apps/market/src/components/` contains only page-level composition
7. All imports resolve to `@aics/ui-core`, `@aics/ui-office`, or `@aics/ui-market`
8. Full build + typecheck + tests pass
