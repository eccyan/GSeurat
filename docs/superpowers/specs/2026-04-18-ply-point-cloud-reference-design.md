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
- Path from `terrainPlyFile` store value, sourced from `world.json` chunk/instance `ply_file`
- Renders at world origin in PLY capture space (no coordinate transform)
- Opaque with depth write enabled
- Controlled by `showTerrainPly` toggle

## Store Changes (useSceneStore)
- `showTerrainPly: boolean` (default `false`)
- `showObjectPly: boolean` (default `true`)
- `terrainPlyFile: string` (set from world manifest when switching scenes)
- `setShowTerrainPly`, `setShowObjectPly`, `setTerrainPlyFile` setters

## Schema Changes (project-root)
- `WorldInstance` gains optional `ply_file?: string`
- `WorldChunk` already has `ply_file: string`
- Terrain PLY path is owned by `world.json`, not derived from project name

## UI Changes
- View menu: "Terrain PLY" and "Object PLY" toggles
- Instance editor: "PLY File" text field in WorldPropertiesPanel
- Viewport.tsx: add `<TerrainPlyReference />`

## Coordinate Spaces
PLY files are in capture space (from Echidna/3DGS training), game objects are in engine world space. These are independent coordinate systems — the PLY renders at its native coordinates as a visual reference.
