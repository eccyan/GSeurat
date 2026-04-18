# PLY Point Cloud Reference Layers

**Date:** 2026-04-18
**Goal:** Display PLY files as read-only point cloud references in the Bricklayer viewport, for both game objects and terrain.

## Components

### PlyPointCloud.tsx (shared)
- Props: `plyPath`, `projectHandle`, `visible`, `pointSize?`, `opacity?`
- Loads binary PLY from FSAPI, parses position + color (SH DC or RGB fallback)
- Renders as `<points>` with ShaderMaterial
- Caches parsed geometry

### GameObjectMarkers.tsx (enhancement)
- When `ply_file` is set and `showObjectPly` is true, render `<PlyPointCloud>` at object position/rotation/scale
- Keep wireframe cube as fallback when no PLY or toggle off

### TerrainPlyReference.tsx (new)
- Path derived from `projectName`: `assets/maps/<slug>.ply`
- Renders at world origin
- Controlled by `showTerrainPly` toggle

## Store Changes (useSceneStore)
- `showTerrainPly: boolean` (default `false`)
- `showObjectPly: boolean` (default `true`)
- `setShowTerrainPly`, `setShowObjectPly` setters

## UI Changes
- View menu: "Terrain PLY" and "Object PLY" toggles
- Viewport.tsx: add `<TerrainPlyReference />`
