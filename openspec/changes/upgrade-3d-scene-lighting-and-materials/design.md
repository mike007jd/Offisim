## Context

The 3D scene was assembled incrementally — geometry first, color
last, lighting tuned by single-light-tree experiments under the
production rig where dev shipped a different (no-shadow,
no-Environment) rig. This left four compounding issues that are
visible at the default camera position the moment a release `.app`
launches an empty office:

1. **Lighting** — one directional light at `[12, 25, 12]` with two
   small cool point lights and ambient fill. No hemisphere fill,
   so faces and surfaces facing away from the directional read as
   uniformly dark. No bounce / GI substitute, so non-key sides of
   tables and chairs flatten. `Environment preset='city'` (a
   sky-dominant HDRI with strong blue cast) only switches on in
   prod; dev iterates with `environmentPreset: null`. Shadow map
   is `1024² PCF-off` in prod, `512² shadows-off` in dev.
   `shadow-bias=-0.0005` is hardcoded.

2. **Materials** — every prefab uses `meshStandardMaterial` with
   one hex color and a single hand-picked `roughness`. There is
   no semantic `materialClass`, so `desk` (wood) and `furniture`
   (plastic frame) and `metal` (chair pole) all sit under the
   same numeric range and respond identically to light. Glass
   uses textbook `transmission=0.9, roughness=0.1` which produces
   a clear pane that reads as missing geometry. Inline hex
   literals under `prefabs/` (`#0c4a6e`, `#d97706`, `#f8fafc`,
   `#06b6d4`, `#f97316`, `#0c4a6e`, `#064e3b`, `#10b981`–`#6ee7b7`)
   bypass the `useSceneColors` token system the codebase otherwise
   honors.

3. **Performance fallback** — `SceneCanvas` only knows two states:
   3D works, or `crashCountRef` exceeded 2 and 2D is forced. A
   user with 18 fps spends the entire session at 18 fps because
   nothing crashed; a user with a 13-line stack trace crash gets
   demoted. Server rack renders 160 LED meshes + 72 vent slats per
   instance regardless of viewing distance.

4. **Dev iteration** — changing any lighting parameter requires
   editing `scene-performance-config.ts` or the inline JSX in
   `Office3DView.tsx` and triggering a rebuild. There is no
   in-app way to test "what does this scene look like with the
   shadow map at 2048 vs 512?" without committing.

The user's directive: pre-launch, no back-compat, single complete
delivery. All four are folded into one production-grade
lighting + materials + performance + dev-tooling pass.

## Goals / Non-Goals

**Goals:**
- One SSOT lighting rig (`SceneLightingRig`) consumed by Office3DView
  and any future 3D scene surface (Studio editor, market preview).
- Dev and prod render the same light tree; only shadow map size,
  Environment HDRI presence, and post-processing toggle between
  tiers. Dev iteration is faithful to ship.
- One material token system with explicit per-class PBR ranges
  (wood / metal / glass / leather / fabric / plastic). Prefab
  authors declare `materialClass`, never raw `roughness=` /
  `metalness=` literals.
- Color SSOT enforced — `useSceneColors()` is the only color
  source under `prefabs/`. Inline hex strings are forbidden by
  spec gate.
- FPS-driven graceful degradation with three intermediate tiers
  before the 2D fallback fires. ServerRack LOD reduces draw
  calls beyond 18 units.
- Glass reads as glass — visible tint, slight roughness, dust
  scatter — not as transmission of a transparent volume.
- Atmospheric depth — fog engages by the meeting zone (~10–14
  units from camera), softens far walls (~22–25 units).
- Dev hot-toggle panel for L/E/S/B/P shortcuts; production
  builds tree-shake it.

**Non-Goals:**
- A texture asset pipeline. Poly Haven HDR + albedo/normal/AO
  bundles are rejected for 1.0 (bundle bloat, loader complexity,
  asset license tracking). Procedural normals only, generated
  at runtime via `DataTexture`.
- Replacing `meshStandardMaterial` with a custom shader. The PBR
  range of `MeshStandardMaterial` + `MeshPhysicalMaterial`
  covers all six classes adequately at the camera distance and
  resolution we render.
- An ML-driven lighting auto-tuner. Lighting tier choice is
  rule-based (FPS sampling) with explicit dev override.
- Replacing `Environment preset` with a hand-authored HDRI. drei
  presets cover indoor warm tones (`apartment`, `warehouse`,
  `lobby`) adequately; the `apartment` preset is the chosen
  baseline for 1.0.
- Per-employee shadow contact ambient occlusion (SSAO). It's an
  optional `tier='high'` post pass deferred to a follow-up
  unless trivially cheap. Initial 1.0 ships Vignette + DoF only
  at high tier.
- Migrating Studio editor or 2D canvas to this rig. They are
  separate surfaces with their own constraints (Studio uses an
  edit-friendly bright neutral rig; 2D canvas does not have
  lights). This change is scoped to Office3D.

## Decisions

### Decision 1: SSOT lighting lives in `scene-lighting-rig.tsx`, not in `theme/`

**Rationale**: lighting is a runtime React Three Fiber component
group (returns JSX with `hemisphereLight`, `directionalLight`,
`spotLight`, `Environment`, `fog`), not a static token table.
Putting it in `components/scene/` keeps it adjacent to its
consumers and lets it import three.js / drei / r3f freely. The
theme directory is for color tokens and material parameter SSOTs
(static data).

**Alternative considered**: split the rig into a config object
in `theme/` plus a thin React renderer in `components/scene/`.
Rejected — the rig has internal state (light refs for Color
lerp, FPS-tier-driven props), so the renderer is non-trivial
and the indirection adds cost without payoff.

### Decision 2: `tier='high' | 'medium' | 'low' | 'off'` is the lighting performance contract

Tier preset table:

| Tier   | Shadow map | Env HDRI    | Hemisphere intensity | Bounce spotlights | Post-processing |
|--------|------------|-------------|----------------------|-------------------|-----------------|
| high   | 2048²      | apartment   | 0.65                 | 2 (front + back)  | DoF + Vignette  |
| medium | 1024²      | apartment   | 0.55                 | 1 (front only)    | Vignette only   |
| low    | 512²       | (disabled)  | 0.35                 | 0                 | (disabled)      |
| off    | (no shadow)| (disabled)  | 0.25                 | 0                 | (disabled)      |

`directionalLight.intensity` stays `1.6` across all tiers (key
light is the most expensive thing visually to lose). `tier='off'`
is the FPS-fallback floor before 2D demotion.

**Rationale**: tier as a single named enum lets dev override
(`localStorage.offisim.scene.devOverride.tier`), FPS sampling
(`useScenePerformanceTier`), and the lighting rig itself read
one variable. Mapping each numeric concern (shadow size,
hemisphere intensity, etc.) to a discrete tier is cleaner than
a free-form config bag.

**Alternative**: per-feature toggles (`shadows: bool`, `env:
bool`, `post: bool`) without a unified tier name. Rejected —
combinatorial explosion (8 combos to test) and dev override
becomes 8 keys in localStorage instead of 1.

### Decision 3: Hemisphere is the dominant fill; AmbientStateLight is subordinate

Current architecture: `AmbientStateLight` renders a root
`<ambientLight>` whose color lerps to ceremony state
(`#ff9944` blocked, `#c4bfee` meeting, `#ffffff` active,
`#aabbcc` idle) at intensity 0.6–0.8. This is the dominant fill
and the reason backlit faces look uniformly dark — ambient
washes evenly with no directional component.

New architecture:
- `<hemisphereLight>` is the dominant fill, intensity per tier
  (0.25–0.65), `skyColor` warm (e.g. `#ffe9c8`),
  `groundColor` cool (e.g. `#1a2030`). This gives faces facing
  up a different tone than faces facing down — the cheapest
  approximation of bounced GI.
- `<ambientLight>` driven by `AmbientStateLight` is subordinate,
  intensity capped at `0.25`. Its job is the ceremony color
  accent (the orange shift when blocked, the lavender shift in
  meeting), not the primary fill.

**Rationale**: hemisphere gives directional gradient cheaply
(`O(1)` cost, no shadow map, no bounce computation), so faces
are readable from all sides. The ceremony color tint stays
because the ambient layer survives — it just stops being
dominant.

**Alternative**: light probes / IrradianceVolume. Rejected —
overengineered for this scale (single room, fixed camera
range). Hemisphere + Environment IBL covers the same
perceptual goal at trivial cost.

### Decision 4: Environment preset is `apartment` at all tiers (except `off`)

Drei's `<Environment preset>` catalog (`@react-three/drei` 9.x):
- `apartment` — warm interior lighting, soft window-side
  highlights, indoor ambience
- `warehouse` — cool industrial, tall ceiling, low ambient
- `lobby` — mixed warm + cool, hotel-lobby reflectivity
- `city` — sky-dominant, blue cast, outdoor

`apartment` is closest in IBL tone to a working office (warm
tungsten + soft sky bounce). It changes glass and metal
reflections from "blue-tinted" to "warm-tinted" — matches the
warm `directionalLight` (key light is `#fffaf0`-leaning) and
the warm `hemisphereLight.skyColor`.

**Rationale**: city preset reads as outdoor with strong blue
cast on metal/glass, undermining the "indoor" feel. apartment
preset reads as indoor warm, with metal reflecting golden
hints, glass picking up warm tint, leather and wood looking
natural. Tested informally with iframe-of-drei-preset-catalog
and visual judgment.

**Alternative**: hand-authored HDRI baked from a Blender room
render. Rejected for 1.0 — production overhead, license
tracking, bundle weight. drei preset is good enough to ship.

### Decision 5: Shadow map type is `THREE.PCFSoftShadowMap`; bias is computed not hardcoded

`gl.shadowMap.type = THREE.PCFSoftShadowMap` set on the Canvas
via `<Canvas onCreated={({ gl }) => { gl.shadowMap.type =
THREE.PCFSoftShadowMap; }}>`. (The current Canvas prop
`shadows={perfConfig.shadows}` accepts `'percentage'` which is
`PCFShadowMap`, not Soft.)

`shadow-bias` is hardcoded to `-0.0005` today. New helper
`computeShadowBias({ lightDistance, sceneScale })` returns
`-0.0005 - lightDistance * 0.00002 * sceneScale`. For our
default light at distance ≈ 28 units and `sceneScale=1`, it
returns roughly `-0.00106` — softer falloff, less shadow acne
on the desk surface.

**Rationale**: `PCFSoftShadowMap` smooths the shadow edge with
a small kernel; `PCFShadowMap` (drei `'percentage'`) does an
exact-edge sample. At 1024² over a 40-unit room, exact-edge
aliasing is visible. Soft kernel costs ~1.3× the sample budget
but the visual gain at the close-camera pose is worth it.

**Alternative**: `VSMShadowMap` (Variance shadow). Rejected —
known light bleed artifacts on inset geometry like the desk
underside.

### Decision 6: PBR via shader-only roughness/metalness layering, no asset textures

Material classes table:

| Class    | Material type           | Roughness    | Metalness | Transmission | IOR | Notes                           |
|----------|-------------------------|--------------|-----------|--------------|-----|---------------------------------|
| wood     | meshStandardMaterial    | 0.55 ± 0.10  | 0.0       | —            | —   | `envMapIntensity=0.6`           |
| metal    | meshStandardMaterial    | 0.22 ± 0.06  | 0.85      | —            | —   | `envMapIntensity=1.0`           |
| glass    | meshPhysicalMaterial    | 0.18         | 0.0       | 0.78         | 1.5 | tint via `color`, attenuation   |
| leather  | meshPhysicalMaterial    | 0.78 ± 0.05  | 0.05      | —            | —   | `clearcoat=0.25`, `clearcoatRoughness=0.6` |
| fabric   | meshStandardMaterial    | 0.92 ± 0.05  | 0.0       | —            | —   | `envMapIntensity=0.3`           |
| plastic  | meshStandardMaterial    | 0.45 ± 0.10  | 0.0       | —            | —   | `envMapIntensity=0.5`           |

The `± 0.10` ranges are the spec; concrete defaults shipped:
- wood = 0.55
- metal = 0.22 (laptop chassis), 0.30 (chair leg pole)
- leather = 0.78
- fabric = 0.92
- plastic = 0.45

`scene-materials.ts` exports `MATERIAL_PRESETS: Record<MaterialClass,
MaterialPreset>` plus a hook `useMaterial(materialClass, color,
overrides?)` that returns a memoized JSX material element.
Variance within a class is achieved via the third-arg
`overrides` (small +/- on roughness / metalness) — never inline
literals.

Procedural normal map: a single 256×256 grayscale noise texture
generated at module init via `OffscreenCanvas` (or `HTMLCanvasElement`
fallback) and applied to glass (subtle dust scatter, normalScale
0.05) and the desk (very subtle wood grain, normalScale 0.08).
No file fetch.

**Rationale**: at our camera distance (~28 units to scene
center, never closer than ~5 to any surface), high-resolution
albedo textures are imperceptible. Roughness / metalness
layering by class is the dominant perceptual cue. Shipping
without an asset pipeline saves 40+ MB and avoids HDRI/license
overhead. Procedural normals add the missing micro-surface
detail glass and wood need to read as those materials.

**Alternative considered**: poly haven CC0 PBR bundles
(`Wood043`, `Metal044`, `Glass002`). Rejected for 1.0 — bundle
weight 40+ MB, loader complexity, asynchronous-init render
flicker. May revisit post-launch.

### Decision 7: ServerRack LOD threshold 16/20 with hysteresis

`useFrame((state) => { distance = state.camera.position.distanceTo(rackCenter) })`
gates rendering of the 160-LED grid + 18-vent-slat layer.
- Distance `< 16` → live mesh grid renders
- Distance `≥ 20` → live mesh grid hidden, baked emissive
  texture renders on the front panel
- Distance in `[16, 20)` → previous decision retained
  (hysteresis to prevent oscillation at boundary)

Baked texture: 256×128 emissive front-panel composite drawn
once at component mount via `OffscreenCanvas`. Each LED is a
2px × 2px filled circle in the LED color (cyan/green/blue per
existing `(rowIndex + ledIndex) % 3` rule); each vent is a
6px × 2px filled rect. Total cost: one `Texture` upload at
mount, one `Plane` mesh at runtime.

**Rationale**: 160 + 72 individual mesh draws per server-rack
instance is the largest per-prefab draw count in the scene. At
distance > 18 units, LED detail is invisible to the eye but
each draw still costs a state change. Texture replacement
keeps the visual silhouette (lit front panel) while collapsing
to a single draw. Hysteresis (16/20) avoids texture/mesh swap
oscillation as the camera orbits at a static distance.

**Alternative**: instanced LED rendering (one
`InstancedMesh<circleGeometry>`). Rejected — saves ~60% of
draw calls but adds buffer-update complexity for the color
variation; the texture-LOD approach saves 100% at far distance
and the close-pose case isn't draw-call bound.

### Decision 8: FPS sampling window is 60 frames; tier transitions are sticky

`useScenePerformanceTier()` samples frame-time deltas in a
ring buffer of the last 60 frames (~1 second at 60 fps). On
each frame:
- Compute `avgFps = 60 * 1000 / sum(frameTimes)`
- Map `avgFps` to candidate tier:
  - ≥ 50 fps → high
  - 30–49 fps → medium
  - 15–29 fps → low
  - < 15 fps → flag for downgrade

Tier transitions are sticky: a downgrade fires immediately on
boundary cross; an upgrade requires 90 consecutive frames
(~1.5 s) above the higher boundary to avoid oscillation.

`< 15 fps` does not immediately drop to 2D — it sets `tier='off'`
first, gives the user 3 seconds at the floor lighting tier, and
only then triggers `force2D=true` in `SceneCanvas` if the FPS
hasn't recovered.

**Rationale**: hysteresis on upgrade prevents the rig flapping
between high and medium when fps wobbles around 50. Immediate
downgrade is intentional — when fps drops, the user wants
relief immediately, not after 1.5 s of stutter.

**Alternative**: PID-style averaging across longer windows.
Rejected — overcomplex for the signal we're filtering. 60-frame
moving window with sticky upgrade is well-known and correct.

### Decision 9: Dev override panel persists to localStorage

`<DevLightingPanel />` mounts only when `import.meta.env.DEV`.
Keyboard handlers:
- `L` cycles tier (high → medium → low → off → high)
- `E` toggles Environment HDRI
- `S` toggles shadows
- `B` cycles hemisphere intensity (0.4 / 0.6 / 0.8 / 1.0)
- `P` toggles post-processing

State persisted under `localStorage.offisim.scene.devOverride.{tier,env,shadows,hemi,post}`.
When any override is set, `useScenePerformanceTier()` returns
the override instead of the FPS-derived tier. A small fixed-
position badge top-right reads "DEV: tier=medium · hemi=0.6 ·
post=off · [Reset]" so the override is visible.

**Rationale**: dev iteration on lighting is a short-loop visual
task; reload-edit-rebuild adds 30-60 s per iteration. Hot
toggle keeps the loop sub-second. Production tree-shakes the
panel because the entire file is wrapped in
`if (import.meta.env.DEV)`.

**Alternative**: a Leva-based dev UI. Rejected — adds 80 KB
gzipped just for the dev panel, and we'd want to tree-shake it
anyway. Custom React component is fine.

### Decision 10: Fog near/far are `[20, 120]` and `RoomShell` uses the same `bg` color

Current: `fog={[#020617, 40, 100]}`, room walls `#1e293b`,
floor `#020617`. Near-fog plane at 40 units puts atmosphere
beyond the back wall (room is 30 deep, default camera 28 from
center) — fog never meaningfully engages.

New: `fog={[#020617, 20, 120]}`. Near plane at 20 units puts
the meeting zone (z ≈ -8 to -12) in the fog start band so far
elements gently soften. Far plane at 120 keeps clipping
generous. Floor stays `#020617`; walls move to a token
(`sc.wallShell`, default `#1c2538`) and use `materialClass='plastic'`.

**Rationale**: fog is the cheapest atmospheric depth cue. Near
plane needs to be inside the visible scene depth range, not
beyond the back wall. The numeric choice (20/120) matches the
camera frustum at the default OrbitControls pose (camera at
`[0, 22, 28]`, target `[0, 0, 2]`, near distance from camera
to scene center ≈ 26).

## Risks / Trade-offs

[Risk] Hemisphere fill at intensity 0.65 may wash out the
ceremony-state ambient color (orange when blocked, lavender
when meeting), which currently uses intensity 0.6–0.8 as the
dominant fill.
→ Mitigation: the ceremony ambient layer drops to max
intensity 0.25 (subordinate). Ceremony color reads as a tint
on top of the hemisphere fill, not as the fill itself. Live
verify: trigger a meeting ceremony, confirm the lavender
"meeting" tint is still visible on faces and walls, just less
saturated. Acceptance: the meeting tint is recognizably present
but doesn't override the directional light's warm key.

[Risk] PCF soft shadows + 2048² shadow map at high tier may
push fps under 50 on integrated GPUs (Intel iGPU,
AMD Vega APU).
→ Mitigation: tier auto-downgrades to medium (1024²) under 50
fps; the FPS-driven tier change is the safety net. Live verify:
launch on Intel MBA M1 vs i9 + iGPU, confirm tier defaults to
high on M1 and stabilizes at medium on iGPU.

[Risk] `Environment preset='apartment'` IBL may produce overly
warm reflections on metal that conflict with the existing cool
LED indicators (cyan / blue / green).
→ Mitigation: `envMapIntensity=1.0` for metal class but the
LED colors are unaffected (LEDs use `meshBasicMaterial` —
unlit, no environment sample). Glass picks up warm tint via
new `attenuationColor`, which is intentional. Live verify:
confirm LED grid still pops cyan/green at default tier.

[Risk] Procedural noise normal map adds a `DataTexture` upload
per material that uses it (glass, desk surface). Could spike
GPU memory if many instances exist.
→ Mitigation: `DataTexture` is generated once at module init
and shared across all material instances. Total cost: 256 ×
256 × 4 bytes = 256 KB per shared texture. Two such textures
(glass, desk) = 512 KB. Below noise.

[Risk] LOD swap on ServerRack at 16/20 boundary could flicker
during smooth orbit at exactly 18 units.
→ Mitigation: hysteresis (cross down at 16, cross up at 20).
The component remembers its last decision and only swaps when
the new threshold is crossed in the relevant direction. Live
verify: orbit slowly through the 18-unit boundary; no flicker.

[Risk] Removing `getOffice3DPerformanceConfig` and inlining
tier-driven light props could leave a dangling import elsewhere.
→ Mitigation: spec gate task includes `grep -rn "getOffice3DPerformanceConfig"
packages/` returning zero. The function is genuinely deleted, no
alias.

[Risk] Dev panel keyboard handlers could clash with existing
shortcuts (`F2` for PerformanceHUD, `Esc` for drag cancel).
→ Mitigation: chosen keys (`L`, `E`, `S`, `B`, `P`) are
unbound elsewhere in scene-related components. The panel
listens at `document` level but exits early if `import.meta.env.PROD`.
Verified by grep across `packages/ui-office/src/**` for
`addEventListener('keydown'`.

[Risk] Post-processing pipeline (`@react-three/postprocessing`)
adds ~80 KB gzipped to the scene chunk.
→ Mitigation: dynamic import gated on `tier='high' || tier='medium'`,
so users on `low` / `off` tiers never load it. Initial bundle
unaffected; lazy chunk loads after first frame at high/medium.

[Trade-off] The 6-class material system requires every prefab
edit to choose a class. Authors can no longer "just pick a
roughness." This is intentional — class enforcement is the
SSOT discipline.
→ Acceptable. The escape hatch (`overrides` arg to
`useMaterial`) covers ±0.10 variance within a class. If a
material truly needs a new class (silk / brushed-metal / etc.),
that's a spec amendment, not an inline literal.

[Trade-off] `apartment` Environment preset baked HDRI is
embedded in `@react-three/drei` (~250 KB compressed). Already
present in dev; prod adds the cost only on tiers that load
Environment.
→ Acceptable. Negligible vs the value (IBL on metal/glass
across the scene).

## Migration Plan

Pre-launch — no migration. The change deletes
`getOffice3DPerformanceConfig` outright, replaces it with
`useScenePerformanceTier()` + `<SceneLightingRig tier=>`,
removes inline material literals across `prefabs/`, and adds
the missing color tokens to `useSceneColors`. Existing
checkpointed runtime state has no scene-rendering fields, so
no graph-state migration is required.

Tauri release verification rebuild required: any file under
`packages/ui-office/src/components/scene/` change requires
`pnpm --filter @offisim/ui-office build` followed by
`pnpm --filter @offisim/desktop build` per the CLAUDE.md
"release desktop verification with new UI dist" rule.

Web build: `pnpm --filter @offisim/web build` picks up the
material system + lighting rig automatically. dev mode
benefits from `optimizeDeps.force` already in place, so the
new `@react-three/postprocessing` dep doesn't require a manual
optimize-deps clear.
