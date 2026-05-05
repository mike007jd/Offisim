# Design: Production 3D Art Direction

## Direction

The scene should read as a refined, product-grade isometric AI office: calm operational command center, not toy diorama and not photoreal office. Geometry stays low-poly/procedural, but every visible surface needs a reason: floor bands guide scanning, zone rugs group work areas, wall panels add depth, furniture carries enough detail to avoid placeholder feel, and employees remain readable at the default camera.

## Architecture

- `packages/ui-core/src/tokens/colors-3d.ts` owns durable 3D color tokens.
- `packages/ui-office/src/components/scene/scene-art-direction.ts` owns room dimensions, camera preset, layer heights, and zone opacity policy.
- `packages/ui-office/src/components/scene/scene-room-shell.tsx` owns the production room shell.
- `SceneMaterial` remains the material abstraction for PBR-like surfaces.
- Prefab components remain procedural; template variation is expressed through scale/composition, not external assets.

## Decisions

1. **Procedural only**: It keeps bundle size, licensing, and web/desktop loading risk low while still allowing production polish.
2. **Layered floor instead of hard grid**: The grid remains as a subtle scale cue, but the visual hierarchy comes from floor bands, zone rugs, and furniture.
3. **Material system extends beyond prefabs**: Employee and brand bodies use `SceneMaterial` so they respond consistently to the refined lighting rig.
4. **PCF shadow parity**: Office and Appearance preview both use `THREE.PCFShadowMap`.
5. **Template differentiation without new schema**: Existing prefab IDs get visible differences through dispatcher-level composition and scale.

## Risks

- Scene detail can increase draw calls. Mitigation: keep shapes primitive, avoid external assets, and preserve existing LOD paths.
- Exact character geometry specs are strict. This change preserves public params and behavior while allowing additional non-breaking mesh detail.
