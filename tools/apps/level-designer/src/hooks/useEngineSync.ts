import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/useEditorStore.js';
import type { LightPlacement, PortalPlacement } from '../store/useEditorStore.js';

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

  useEffect(() => {
    // Initialize refs with current store state
    const state = useEditorStore.getState();
    prevLightsRef.current = state.lights;
    prevPortalsRef.current = state.portals;
    prevAmbientRef.current = state.ambientColor;

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
