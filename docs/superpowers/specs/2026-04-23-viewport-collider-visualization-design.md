# Viewport Collider Visualization in Bricklayer — Design Spec

## Goal

Add wireframe collider overlays to Bricklayer's 3D viewport so level designers can see and click collision shapes (Box, Sphere, Capsule) directly in the editor without switching to Staging's F10 debug view.

## Architecture

A new `ColliderMarkers.tsx` React Three Fiber component renders Three.js wireframe geometry for every game object that has a `ColliderComponent`. It follows the established pattern of `CameraZoneMarkers.tsx` — `EdgesGeometry` wireframes, invisible hit meshes, color-coded by state, gated behind the existing `showGizmos` master toggle.

No new store state, bridge commands, or engine changes are needed. The existing `showCollision` boolean (already in `useSceneStore` but currently unwired) controls the global toggle. A new "Colliders" entry in MenuBar's View menu wires it up.

## 1. Visibility Rules

| `showCollision` | Object selected? | Has collider? | Visible? | Alpha |
|-----------------|-------------------|---------------|----------|-------|
| ON              | Yes               | Yes           | Yes      | 1.0   |
| ON              | No                | Yes           | Yes      | 0.3   |
| OFF             | Yes               | Yes           | Yes      | 1.0   |
| OFF             | No                | Yes           | No       | —     |

Gated behind `showGizmos` (master toggle) — if gizmos are off, no colliders render regardless of `showCollision`.

**Rationale:** When `showCollision` is ON, all colliders are faintly visible for spatial context (aligning adjacent objects). The selected object's collider is always bright. When OFF, only the selected object's collider shows so the designer knows what they're editing.

## 2. Shape Rendering

Each collider shape maps to Three.js geometry:

**Box:** `EdgesGeometry(BoxGeometry(2*hx, 2*hy, 2*hz))` — clean wireframe edges without face diagonals. Hit mesh: matching `BoxGeometry`.

**Sphere:** `EdgesGeometry(SphereGeometry(r, 24, 16))` — 24 longitude, 16 latitude for smooth appearance. Hit mesh: matching `SphereGeometry`.

**Capsule:** `EdgesGeometry(CapsuleGeometry(r, 2*half_height, 12, 8))` — Three.js native capsule geometry. Hit mesh: matching `CapsuleGeometry`.

**Semi-transparent fill:** Each shape also renders a faint solid mesh (alpha 0.04 unselected, 0.08 selected) for depth perception and intuitive click feel.

All geometries are memoized via `useMemo` keyed on shape parameters to avoid per-frame allocation.

## 3. Transform Stack

Collider wireframes must correctly compose the game object's Euler rotation with the collider's local quaternion rotation and offset:

```
<group position={obj.position} rotation={eulerFromDegrees(obj.rotation)}>
  <group quaternion={collider.local_rotation ?? [0, 0, 0, 1]}>
    <group position={collider.offset}>
      {/* EdgesGeometry wireframe */}
      {/* Invisible hit mesh */}
      {/* Semi-transparent fill */}
    </group>
  </group>
</group>
```

- **Outer group:** Game object world position + Euler rotation (degrees converted to radians via `THREE.MathUtils.degToRad`)
- **Middle group:** Collider `local_rotation` quaternion applied via `quaternion` prop (identity `[0,0,0,1]` when unset)
- **Inner group:** Collider `offset` as local translation

This matches the engine's transform composition order.

## 4. Color Scheme

| State                | Wireframe Color | Fill Color  |
|----------------------|-----------------|-------------|
| Solid — selected     | `#00ff44`       | `#00ff44` alpha 0.08 |
| Solid — unselected   | `#228833`       | `#228833` alpha 0.04 |
| Trigger — selected   | `#ff8800`       | `#ff8800` alpha 0.08 |
| Trigger — unselected | `#885500`       | `#885500` alpha 0.04 |

Green for physics colliders, orange for triggers — instantly distinguishable at a glance. Both distinct from cyan camera zones and blue game object cubes.

## 5. Hit Testing (Interactive)

Each collider renders an invisible solid mesh matching the collider's shape and dimensions. Clicking anywhere inside the volume selects the parent game object:

```typescript
<mesh onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
  <boxGeometry args={[2*hx, 2*hy, 2*hz]} />
  <meshBasicMaterial visible={false} />
</mesh>
```

This replaces the tiny 1.5-unit origin cube as the primary click target when colliders are visible, matching industry-standard editor behavior (Unity, Unreal).

The existing `GameObjectMarkers` cube remains for objects without colliders and when `showCollision` is off.

## 6. UI Toggle

Add a "Colliders" entry to the `viewItems` array in `MenuBar.tsx`, after "Object PLY":

```typescript
{
  label: `${useSceneStore.getState().showCollision ? '\u2713 ' : ''}Colliders`,
  action: () => {
    const s = useSceneStore.getState();
    s.setShowCollision(!s.showCollision);
  },
},
```

Uses the existing `showCollision` / `setShowCollision` store state (default `false`).

## 7. Component Integration

In `Viewport.tsx`'s `SceneContent`, add `<ColliderMarkers />` alongside the other marker components:

```typescript
<GameObjectMarkers />
<ColliderMarkers />    {/* new */}
<CameraZoneMarkers />
<LightGizmos />
```

## 8. Data Access

```typescript
const gameObjects = useSceneStore((s) => s.gameObjects);
const showCollision = useSceneStore((s) => s.showCollision);
const showGizmos = useSceneStore((s) => s.showGizmos);
const selectedEntity = useSceneStore((s) => s.selectedEntity);

// For each game object:
const collider = obj.components['ColliderComponent'] as Record<string, unknown> | undefined;
if (!collider) continue;

const shape = collider.shape as { type: string; half_extents?: number[]; radius?: number; half_height?: number };
const offset = (collider.offset as [number, number, number]) ?? [0, 0, 0];
const isTrigger = (collider.is_trigger as boolean) ?? false;
const localRotation = (collider.local_rotation as [number, number, number, number]) ?? [0, 0, 0, 1];
const isSelected = selectedEntity?.type === 'game_object' && selectedEntity.id === obj.id;
```

## Out of Scope

- **Collider editing via viewport gizmos** — resize handles, drag-to-move offset (future work)
- **Collision mask visualization** — bitmask layer coloring
- **Dynamic collider animation** — real-time physics preview
- **Multi-select collider operations** — batch editing

## Testing

- Toggle View > Colliders ON -> all game objects with `ColliderComponent` show green/orange wireframes
- Toggle OFF -> only selected object's collider visible
- Select `kcc_wall_a` -> bright green box wireframe at correct position/rotation
- Select `kcc_boulder_a` -> bright green sphere wireframe matching radius 1.2
- Select `kcc_pillar_a` -> bright green capsule wireframe matching r=0.5 h=1.5
- Click on a collider wireframe -> selects the parent game object
- Toggle `is_trigger` in ColliderEditor -> wireframe color changes to orange
- Toggle `showGizmos` OFF -> all collider wireframes disappear
- Type-check passes: `pnpm --filter bricklayer exec tsc --noEmit`
