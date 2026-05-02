# Change: Polish 3D Art Direction For Production

## Why

The Office 3D scene has the correct runtime architecture, lighting SSOT, material abstraction, prefab dispatcher, and employee geometry SSOT, but the default visual read still contains placeholder-era treatment: a debug grid room, flat zone rectangles, sparse prefab detail, and character surfaces that bypass the material system. The result does not meet production visual quality for the primary Office surface.

## What Changes

- Add production 3D art-direction tokens to `Scene3DColors`.
- Introduce `scene-art-direction.ts` for room, camera, layer, and zone-opacity constants.
- Replace the debug `RoomShell` with a layered production room shell.
- Move internal and external employee visible surfaces through `SceneMaterial`.
- Add non-schema-breaking employee polish: shoes and hands.
- Add prefab details and visible template differentiation for key built-in prefab IDs.
- Use stable `THREE.PCFShadowMap` in both Office 3D and Appearance preview.

## Impact

- Touches `@offisim/ui-core` 3D color tokens and `@offisim/ui-office` scene rendering.
- No data model changes.
- No external asset or GLB dependency.
- Keeps the current project-updated material preset values, while fixing material control props so internal override fields are not forwarded to Three.js material nodes.
