# ColliderComponent Editor in Bricklayer — Design Spec

## Goal

Add a custom `ColliderEditor` panel to Bricklayer so level designers can create, modify, and remove primitive colliders (Box, Sphere, Capsule) on game objects without editing raw JSON. Includes UI-level input validation to prevent degenerate geometry from corrupting the engine's BVH.

## Architecture

The ColliderEditor is a bespoke React component rendered inline within `GameObjectProperties.tsx` when a game object has a `ColliderComponent`. It follows the pattern of `CameraVolumeEditor.tsx` — a dedicated panel with conditional field groups based on a discriminant (shape type).

No new bridge commands, store actions, or C++ engine changes are needed. Collider data flows through the existing game object component system: Zustand store -> 2s debounced auto-sync -> `load_scene_json`/`update_scene_data` -> engine `collider_from_json` -> `mark_dirty()` -> `rebuild_cache()`.

## 1. ColliderEditor Component

**File:** `tools/apps/bricklayer/src/panels/editors/ColliderEditor.tsx`

**Props:**
```typescript
interface ColliderEditorProps {
  data: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
  onRemove: () => void;
}
```

**UI layout:**

```
ColliderComponent                              [x]
├── Shape Type   [Box ▾]
├── Half Extents [3.0] [2.0] [0.4]   ← Box only
├── Radius       [0.5]               ← Sphere/Capsule only
├── Half Height  [0.5]               ← Capsule only
├── Offset       [0.0] [2.0] [0.0]
├── ☐ Is Trigger
└── ☐ Is Dynamic
```

**Shape type dropdown:**
- Box -> shows Half Extents (Vec3Input)
- Sphere -> shows Radius (NumberInput)
- Capsule -> shows Radius + Half Height (NumberInput each)

When shape type changes, the `shape` field is replaced entirely with new defaults:
- Box: `{ type: "box", half_extents: [0.5, 0.5, 0.5] }`
- Sphere: `{ type: "sphere", radius: 0.5 }`
- Capsule: `{ type: "capsule", radius: 0.3, half_height: 0.5 }`

**Common fields** (always visible):
- `offset`: Vec3Input, default [0, 0, 0]
- `is_trigger`: checkbox, default false
- `is_dynamic`: checkbox, default false

**Omitted from UI** (advanced, JSON-only):
- `collision_mask` (uint32 bitmask — too specialized for general use)
- `local_rotation` (quaternion — game object rotation already handles this)

## 2. GameObjectProperties Integration

**File:** `tools/apps/bricklayer/src/panels/editors/GameObjectProperties.tsx`

In the component rendering loop, when the component key is `"ColliderComponent"`, render `<ColliderEditor>` instead of the generic `<ComponentEditor>`. The ColliderEditor receives the same `data`/`onChange`/`onRemove` props that the generic editor uses.

```typescript
if (componentName === 'ColliderComponent') {
  return <ColliderEditor data={componentData} onChange={...} onRemove={...} />;
}
// else: generic ComponentEditor with schema
```

## 3. Data Flow

```
ColliderEditor (React)
  └── onChange("shape", { type: "box", half_extents: [3, 2, 0.4] })
        └── updateGameObjectComponent(objId, "ColliderComponent", patch)
              └── Zustand store update
                    └── 2s debounced auto-sync (MenuBar.tsx)
                          └── exportSceneJson() includes components.ColliderComponent
                                └── load_scene_json / update_scene_data (bridge)
                                      └── engine: collider_from_json -> mark_dirty()
                                            └── next frame: rebuild_cache() + rebuild_bvh()
```

No new bridge commands. The existing bulk scene sync carries collider data as part of game object components. The `update_collider` bridge command exists but remains unused by Bricklayer — it's available for future granular sync optimization if the 2s debounce proves insufficient.

## 4. Input Validation

All numeric inputs use `NumberInput` with `min={0.01}`:
- **Half Extents**: each axis >= 0.01 (prevents zero-volume AABB)
- **Radius**: >= 0.01 (prevents degenerate sphere/capsule)
- **Half Height**: >= 0.01 (prevents capsule collapsing to sphere)

The `NumberInput` component in `@gseurat/ui-kit` already rejects NaN on text commit (`parseFloat` + `isNaN` check) and clamps via `min`/`max` props. No additional validation layer needed.

**Engine safety:** If malformed data somehow reaches the engine (e.g., hand-edited JSON), `compute_aabb()` will produce a degenerate but non-crashing AABB. The BVH handles zero-volume nodes without crashing — they simply don't intersect anything.

## 5. Component Export

**File:** `tools/apps/bricklayer/src/panels/editors/index.ts`

Export `ColliderEditor` from the editors index.

No changes to `sceneExport.ts` — game object components are already exported as-is via the generic `obj.components` spread in `exportSceneJson()`.

## Out of Scope

- **Collision mask editor** — bitmask UI is complex; mask defaults to `0xFFFFFFFF` (collide with everything)
- **Wireframe debug toggle** — Staging already has F10 wireframe; no Bricklayer control needed
- **Granular `update_collider` bridge command** — bulk sync is sufficient for editor use
- **Viewport collider visualization** — 2D projected wireframes in Bricklayer's canvas (future work)
- **Collider duplication/templates** — copy-paste from existing game objects works via the generic system

## Testing

- Select a game object with `ColliderComponent` -> ColliderEditor renders instead of generic ComponentEditor
- Change shape type Box -> Sphere -> Capsule -> fields update correctly
- Edit radius/extents -> values persist in store, appear in exported JSON
- Set radius to 0 -> clamped to 0.01
- Type NaN in a field -> reverts to previous value
- Auto-sync to Staging -> collider appears in wireframe debug (F10)
- Remove ColliderComponent -> generic "Add Component" flow can re-add it
