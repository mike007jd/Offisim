# Phase 7: Pixel Art Visual Overhaul + OpenClaw Agent Federation — Design

> **Goal:** Transform AICS from a generic gray scaffold into a distinctive pixel-art
> product, and enable users to invite any OpenClaw lobster (local skill import + remote
> Gateway federation) to join their AI company.

**Architecture:** Two parallel tracks — pixel visual system (renderer + DOM) and
OpenClaw integration (skill parser + Gateway WebSocket client). Connected by the
lobster character system that bridges both.

**Tech Stack:** PixiJS 8 (procedural pixel graphics), GSAP 3 (animation), Tailwind CSS
(pixel theme), OpenClaw Gateway Protocol v3 (WebSocket), Press Start 2P / Pixelify
Sans (pixel fonts)

---

## Part 1: Pixel Art Visual System

### 1.1 Color System — Retro Game Palette

Replace the current gray-scale system with a unified limited palette inspired by
SNES/GBA era games. One palette serves BOTH the DOM chrome and the PixiJS scene.

| Token | Hex | Role |
|-------|-----|------|
| `ocean-deep` | `#1a1c2c` | Primary background (DOM) |
| `ocean-mid` | `#333c57` | Panel/card background |
| `ocean-light` | `#566c86` | Borders, muted text |
| `sand` | `#f4f4f4` | Primary text |
| `shell` | `#8b9bb4` | Secondary text |
| `lobster-red` | `#e43b44` | Brand accent, CTAs |
| `coral-orange` | `#f77622` | Warnings, highlights |
| `kelp-green` | `#3e8948` | Success states |
| `sea-blue` | `#3978a8` | Info, links |
| `abyss` | `#0e071b` | Deep shadows, overlays |
| `pearl` | `#ffffff` | Bright highlights |
| `foam` | `#c0cbdc` | Subtle borders, dividers |

Scene-specific tokens derive from the same palette (floor tiles use `ocean-mid`,
desks use `ocean-light`, etc.) ensuring visual cohesion between DOM and canvas.

### 1.2 Typography — Pixel Font Hierarchy

| Level | Font | Usage |
|-------|------|-------|
| Display/H1 | **Press Start 2P** (Google Fonts) | Header title, dialog titles |
| H2-H4 | **Pixelify Sans** (Google Fonts) | Panel headings, section titles |
| Body | **Pixelify Sans** (weight 400) | Chat messages, event log, descriptions |
| Data/Mono | **IBM Plex Mono** at pixel sizes | Token counts, latency, code |

All text rendering uses `font-smooth: never` + `text-rendering: optimizeSpeed` to
preserve pixel crispness. Font sizes snap to multiples of 2px.

### 1.3 UI Components — Pixel Aesthetic

**Buttons:**
- 2px solid pixel border (no border-radius)
- Press effect: translate(2px, 2px) + shadow removal on :active
- Three variants: primary (lobster-red), secondary (ocean-mid), ghost (border only)

**Cards/Panels:**
- Double-line pixel border (outer: dark, inner: light, 2px gap)
- No border-radius (sharp corners everywhere)
- No box-shadow (depth via border color difference)

**Inputs:**
- Inset pixel border (dark top-left, light bottom-right for depth illusion)
- Pixel cursor blink animation

**Scrollbars:**
- Custom 8px wide pixel-style scrollbar
- Track: ocean-deep, thumb: ocean-light, hover: lobster-red

**Icons:**
- Replace lucide-react with custom 16×16 pixel icon set (or a pixel icon pack)
- Fallback: keep lucide but render at small size + pixelate

### 1.4 Office Scene — Pixel Tilemap

**Rendering approach:** PixiJS `Graphics` API → low-resolution `RenderTexture` (scene
rendered at 1/4 resolution) → scaled up with `scaleMode: 'nearest'` → instant pixel
art feel.

**Floor:**
- 16×16 pixel tiles in a repeating pattern
- Department zones use subtle color variations (engineering=blue-tint, design=pink-tint)
- Grid lines visible at 1px

**Furniture (procedurally drawn):**
- Desk: 16×8px rectangle, darker surface, lighter legs
- Monitor: 8×6px rectangle on 2px stand, screen glow effect
- Chair: 6×8px shape
- Decorative: pixel plant (4×8px), pixel whiteboard (12×8px)

**Lighting:**
- Subtle ambient gradient (lighter center, darker edges)
- Monitor screens emit tiny glow (2px halo)

### 1.5 Lobster Character System — Parametric Pixel Generation

Each lobster is procedurally generated at 32×32 pixels using PixiJS `Graphics`:

**Body structure:**
- Torso: 10×8 ellipse (main color)
- Tail: 6×4 fan shape
- Claws: 2× 4×3 pincers
- Eyes: 2× 2×2 dots (white + 1px black pupil)
- Antennae: 2× 1px lines (3px tall)
- Legs: 4× 1px lines under body

**Parameterization (from agent metadata):**
- `hue`: body color derived from hash of agent name/ID
- `saturation`: varies by role type
- `accessory`: role indicator
  - Manager: tiny pixel tie (2×3px)
  - Developer: pixel glasses (4×2px)
  - Designer: pixel beret (4×3px)
  - Remote agent: antenna glow + 🌐 badge

**Animation frames (procedural, not sprite sheets):**
- **Idle** (2 frames): body bobs up/down 1px, claws rest
- **Walking** (4 frames): legs alternate, body sways, claws swing
- **Working** (3 frames): claws tap on desk, typing effect
- **Thinking** (2 frames): thought bubble appears, eyes look up
- **Meeting** (2 frames): faces other lobster, claws gesture
- **Error** (2 frames): sweat drop, red tint flash

GSAP drives smooth transitions between states and movement between positions.
Frame animation uses `requestAnimationFrame` cycling through procedural redraws.

### 1.6 DOM ↔ Scene Visual Bridge

To prevent the "two different apps" feel:
- Scene background uses same `ocean-deep` base as DOM
- Panel borders use same pixel double-line style
- Agent cards in the sidebar show mini pixel lobster portraits (16×16)
- Status colors are shared between scene state ring and DOM badges
- Chat messages from lobster employees show their pixel portrait as avatar

---

## Part 2: OpenClaw Integration

### 2.1 Layer 1 — Local Skill Import

**Purpose:** Import an OpenClaw SKILL.md as a local AICS employee. The skill's
instructions become the employee's persona, and AICS's own LLM executes the work.

**New modules:**

```
packages/install-core/src/
  openclaw/
    skill-parser.ts        — Parse SKILL.md YAML frontmatter + body
    skill-to-employee.ts   — Map skill → AICS employee definition
    skill-validator.ts     — Validate requirements vs local environment
```

**SkillParser output:**
```typescript
interface ParsedSkill {
  name: string;
  description: string;
  instructions: string;          // Markdown body
  requirements: {
    bins?: string[];             // Required binaries
    env?: string[];              // Required env vars
    config?: string[];           // Required config paths
  };
  metadata: {
    emoji?: string;
    homepage?: string;
    os?: string[];
    userInvocable?: boolean;
  };
}
```

**Mapping to AICS Employee:**
```
skill.name         → employee.name
skill.description  → employee.persona_json.expertise
skill.instructions → employee.persona_json.systemPrompt
skill.emoji        → lobster accessory hint
skill requirements → install bindings (Phase 6 system)
```

**Import flow:**
1. User drags SKILL.md folder (or .zip/.aicspkg containing it) into AICS
2. SkillParser extracts metadata + instructions
3. SkillValidator checks requirements against local environment
4. User reviews in InstallDialog (reuse Phase 6 UI) — sees skill name, description,
   requirements, and a preview of the generated pixel lobster
5. On confirm: creates employee row, generates lobster appearance, adds to scene
6. The employee uses AICS's own LLM but with the skill's instructions as its persona

### 2.2 Layer 2 — Remote Gateway Federation

**Purpose:** Connect to a running OpenClaw Gateway and invite the remote agent to
join the AICS company as an employee. Tasks are forwarded via WebSocket; the remote
agent's own LLM does the work.

**New modules:**

```
packages/core/src/gateway/
  openclaw-client.ts       — WebSocket client (Protocol v3)
  openclaw-auth.ts         — Token/device-key auth handler
  remote-employee.ts       — Adapts remote agent to Employee interface

apps/web/src/components/invite/
  InviteDialog.tsx         — UI for entering Gateway URL + token
  RemoteLobsterCard.tsx    — Agent card with connection status indicator
```

**OpenClawGatewayClient:**
```typescript
class OpenClawGatewayClient {
  constructor(url: string, token: string)

  connect(): Promise<AgentInfo>        // WS connect → challenge → hello-ok
  disconnect(): void
  sendMessage(text: string): Promise<string>  // chat.send → await response
  onEvent(handler: (event) => void): void     // subscribe to event stream
  get status(): 'connecting' | 'connected' | 'disconnected' | 'error'
  get agentInfo(): AgentInfo | null
}
```

**Protocol flow:**
```
AICS                          Remote OpenClaw Gateway
  |                                    |
  |--- ws://host:18789 connect ------->|
  |<--- connect.challenge (nonce) -----|
  |--- connect (operator, token) ----->|
  |<--- hello-ok (deviceToken) --------|
  |                                    |
  |--- req: chat.send("task...") ----->|
  |<--- event: agent.thinking ---------|
  |<--- event: agent.tool.call --------|
  |<--- res: chat.response ------------|
  |                                    |
  |--- ping (every 15s) -------------->|
  |<--- pong --------------------------|
```

**RemoteEmployee adapter:**
- Implements the same Employee interface as local employees
- `execute(task)` → forwards via `client.sendMessage()` → returns response
- Status mapped: remote agent thinking → lobster "thinking" state in scene
- Connection loss → lobster shows ⚠️ disconnected state, auto-reconnect

**UI: InviteDialog:**
- Step 1: Enter Gateway URL + authentication token
- Step 2: Connection test (show agent name, skills, status)
- Step 3: Confirm → create RemoteEmployee → pixel lobster appears with 🌐 badge
- Step 4: Connected! Remote lobster now receives tasks alongside local employees

### 2.3 Security Design

| Concern | Mitigation |
|---------|------------|
| Token exposure | Stored in localStorage (browser) / encrypted SQLite (Tauri), never sent to our servers |
| MITM | Enforce wss:// in production; ws:// only for localhost |
| Remote agent trust | User explicitly approves each connection; remote agent cannot access local files/MCP |
| Task leakage | Only task text + responses flow through WS; no raw company data exposed |
| Connection hijack | Device pairing + token rotation per OpenClaw protocol |

---

## Part 3: Implementation Phases

### Phase 7A: Pixel Visual Foundation (can start immediately)
1. Color system + CSS custom properties
2. Pixel fonts integration
3. Pixel UI components (button, card, panel, input, scrollbar)
4. Header + StatusBar redesign
5. Chat panel + Event log pixel styling

### Phase 7B: Pixel Scene Overhaul
1. Tilemap floor system (replace gray rectangles)
2. Procedural pixel furniture
3. Procedural pixel lobster generator (replace circle avatars)
4. Lobster animation system (idle, walk, work, think, meet, error)
5. Scene lighting + department zones
6. DOM ↔ Scene integration (mini portraits, shared colors)

### Phase 7C: OpenClaw Local Import
1. SkillParser (YAML frontmatter + Markdown body)
2. SkillValidator (requirements checking)
3. SkillToEmployee mapper
4. Import UI (extend InstallDialog for SKILL.md input)
5. Integration tests

### Phase 7D: OpenClaw Remote Federation
1. OpenClawGatewayClient (WebSocket Protocol v3)
2. Auth handler (token + device pairing)
3. RemoteEmployee adapter
4. InviteDialog UI
5. Connection status in scene (🌐 badge, disconnect handling)
6. Integration tests

### Phase 7E: Polish + Integration
1. Full E2E test: import skill → create lobster → assign task → see result
2. Full E2E test: invite remote → connect → assign task → see response
3. Performance profiling (many lobsters in scene)
4. Accessibility pass on pixel UI
5. Documentation

---

## Key Design Decisions

1. **Procedural pixel art, no external assets** — All graphics generated via PixiJS
   Graphics API at low resolution, scaled with nearest-neighbor. No artist needed.
2. **Full pixel aesthetic** — DOM UI also pixel-styled (pixel fonts, sharp corners,
   pixel borders). Not a "pixel scene + modern UI" hybrid.
3. **Two-layer OpenClaw integration** — Local import (use our LLM) vs remote federation
   (use their LLM). Covers both offline and connected use cases.
4. **Operator role for federation** — AICS connects as an Operator to remote Gateway,
   the simplest integration path with full chat capability.
5. **Reuse Phase 6 install system** — Local skill import flows through the existing
   state machine, compatibility checks, and binding system.
6. **Shared color palette** — One retro game palette serves DOM, scene, and lobster
   generation. No more visual split between "web part" and "game part".

---

## References

- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [OpenClaw Gateway Protocol](https://docs.openclaw.ai/gateway/protocol)
- [OpenClaw Remote Access](https://docs.openclaw.ai/gateway/remote)
- [OpenClaw Skills Docs](https://docs.openclaw.ai/tools/skills)
- [OpenClaw Architecture Deep Dive](https://deepwiki.com/openclaw/openclaw)
- [OpenClaw 中文部署教程](https://zhuanlan.zhihu.com/p/2014017982444091141)
- [SCMP: OpenClaw Fever in China](https://www.scmp.com/tech/tech-trends/article/3345865/openclaw-fever-why-china-rushing-raise-lobster)
