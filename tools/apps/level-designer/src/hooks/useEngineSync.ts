import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/useEditorStore.js';
import type { LightPlacement, PortalPlacement, ColliderData } from '../store/useEditorStore.js';

type Engine = ReturnType<typeof import('./useEngine.js').useEngine>;

/**
 * Subscribes to Zustand store changes for lights, NPCs, portals, and ambient
 * color, then calls the corresponding engine methods to keep the running
 * Vulkan engine in sync with the editor state.
 */
export function useEngineSync(engine: Engine) {
  const prevLightsRef = useRef<LightPlacement[]>([]);
  const prevPortalsRef = useRef<PortalPlacement[]>([]);
  const prevAmbientRef = useRef<[number, number, number, number]>([0.25, 0.28, 0.45, 1.0]);
  const prevCollidersRef = useRef<ColliderData[]>([]);

  useEffect(() => {
    // Initialize refs with current store state
    const state = useEditorStore.getState();
    prevLightsRef.current = state.lights;
    prevPortalsRef.current = state.portals;
    prevAmbientRef.current = state.ambientColor;
    prevCollidersRef.current = state.colliders;

    // Initial collider sync from engine
    void (async () => {
      if (!engine.isConnected()) return;
      const collidersResp = await engine.listColliders();
      if (collidersResp?.colliders) {
        const store = useEditorStore.getState();
        store.setColliders(collidersResp.colliders.map(c => ({
          id: c.id,
          name: c.name,
          position: c.position,
          rotation: c.rotation,
          shape: c.collider.shape as ColliderData['shape'],
          collision_mask: (c.collider.collision_mask as number) ?? 0xFFFFFFFF,
          is_trigger: (c.collider.is_trigger as boolean) ?? false,
          is_dynamic: (c.collider.is_dynamic as boolean) ?? false,
        })));
      }
    })();

    const unsub = useEditorStore.subscribe((state, prevState) => {
      if (!engine.isConnected()) return;

      // --- Ambient color sync ---
      if (state.ambientColor !== prevState.ambientColor) {
        const [r, g, b, a] = state.ambientColor;
        engine.setAmbient(r, g, b, a);
      }

      // --- Lights sync ---
      if (state.lights !== prevState.lights) {
        syncLights(engine, prevState.lights, state.lights);
      }

      // --- Portals sync ---
      if (state.portals !== prevState.portals) {
        syncPortals(engine, prevState.portals, state.portals);
      }

      // --- Colliders sync ---
      if (state.colliders !== prevState.colliders) {
        syncColliders(engine, prevState.colliders, state.colliders);
      }

      // --- Auto-enable wireframes when colliders layer is active ---
      if (state.activeLayer !== prevState.activeLayer) {
        if (state.activeLayer === 'colliders') {
          engine.setFeature('debug_colliders', true);
        } else if (prevState.activeLayer === 'colliders') {
          engine.setFeature('debug_colliders', false);
        }
      }
    });

    return unsub;
  }, [engine]);
}

function syncLights(
  engine: Engine,
  prev: LightPlacement[],
  next: LightPlacement[],
) {
  // Additions: new items at the end
  if (next.length > prev.length) {
    for (let i = prev.length; i < next.length; i++) {
      const l = next[i];
      engine.addLight({
        x: l.position[0],
        y: l.position[1],
        radius: l.radius,
        r: l.color[0],
        g: l.color[1],
        b: l.color[2],
        intensity: l.intensity,
        z: l.height,
      });
    }
  }

  // Removals: items were removed (shorter array)
  if (next.length < prev.length) {
    // Remove from the end to avoid index shifting
    for (let i = prev.length - 1; i >= next.length; i--) {
      engine.removeLight(i);
    }
  }

  // Updates: compare overlapping items
  const overlap = Math.min(prev.length, next.length);
  for (let i = 0; i < overlap; i++) {
    if (prev[i] !== next[i]) {
      engine.updateLight(i, {
        x: next[i].position[0],
        y: next[i].position[1],
        radius: next[i].radius,
        r: next[i].color[0],
        g: next[i].color[1],
        b: next[i].color[2],
        intensity: next[i].intensity,
        z: next[i].height,
      });
    }
  }
}

function syncPortals(
  engine: Engine,
  prev: PortalPlacement[],
  next: PortalPlacement[],
) {
  // Additions
  if (next.length > prev.length) {
    for (let i = prev.length; i < next.length; i++) {
      const p = next[i];
      engine.addPortal({
        x: p.position[0],
        y: p.position[1],
        width: p.size[0],
        height: p.size[1],
        target_scene: p.target_scene,
        spawn_x: p.spawn_position[0],
        spawn_y: p.spawn_position[1],
        spawn_facing: p.spawn_facing,
      });
    }
  }

  // Removals
  if (next.length < prev.length) {
    for (let i = prev.length - 1; i >= next.length; i--) {
      engine.removePortal(i);
    }
  }
}

async function syncColliders(
  engine: Engine,
  prev: ColliderData[],
  next: ColliderData[],
) {
  const prevIds = new Set(prev.map(c => c.id));
  const nextIds = new Set(next.map(c => c.id));

  // Additions
  for (const c of next) {
    if (!prevIds.has(c.id)) {
      await engine.addCollider({
        id: c.id,
        name: c.name,
        position: c.position,
        rotation: c.rotation,
        collider: {
          shape: c.shape,
          collision_mask: c.collision_mask,
          is_trigger: c.is_trigger,
          is_dynamic: c.is_dynamic,
        },
      });
    }
  }

  // Removals
  for (const c of prev) {
    if (!nextIds.has(c.id)) {
      await engine.removeCollider(c.id);
    }
  }

  // Updates (check by reference — Zustand immutable updates create new objects)
  for (const c of next) {
    if (prevIds.has(c.id)) {
      const prevC = prev.find(p => p.id === c.id);
      if (prevC && prevC !== c) {
        await engine.updateCollider(c.id, {
          position: c.position,
          rotation: c.rotation,
          collider: {
            shape: c.shape,
            collision_mask: c.collision_mask,
            is_trigger: c.is_trigger,
            is_dynamic: c.is_dynamic,
          },
        });
      }
    }
  }
}
