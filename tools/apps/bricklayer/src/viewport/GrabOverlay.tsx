import React, { useCallback, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../store/useSceneStore.js';

const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _raycaster = new THREE.Raycaster();
const _intersection = new THREE.Vector3();
const _pointer = new THREE.Vector2();

export function GrabOverlay() {
  const grabMode = useSceneStore((s) => s.grabMode);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const { camera, gl } = useThree();
  const tracking = useRef(false);

  // Start tracking on mount when grabMode is active
  useFrame(() => {
    if (!grabMode || !selectedEntity) return;

    if (!tracking.current) {
      tracking.current = true;

      // Determine the Y height for the grab plane
      const store = useSceneStore.getState();
      let y = 0;
      if (selectedEntity.type === 'object') {
        const obj = store.placedObjects.find((o) => o.id === selectedEntity.id);
        if (obj) y = obj.position[1];
      } else if (selectedEntity.type === 'npc') {
        const npc = store.npcs.find((n) => n.id === selectedEntity.id);
        if (npc) y = npc.position[1];
      } else if (selectedEntity.type === 'light') {
        const light = store.staticLights.find((l) => l.id === selectedEntity.id);
        if (light) y = light.height;
      } else if (selectedEntity.type === 'player') {
        y = store.player.position[1];
      }
      _plane.set(new THREE.Vector3(0, 1, 0), -y);

      const el = gl.domElement;

      const onMove = (ev: PointerEvent) => {
        const rect = el.getBoundingClientRect();
        _pointer.set(
          ((ev.clientX - rect.left) / rect.width) * 2 - 1,
          -((ev.clientY - rect.top) / rect.height) * 2 + 1,
        );
        _raycaster.setFromCamera(_pointer, camera);
        if (_raycaster.ray.intersectPlane(_plane, _intersection)) {
          const sx = Math.round(_intersection.x * 10) / 10;
          const sz = Math.round(_intersection.z * 10) / 10;
          const store = useSceneStore.getState();
          const sel = store.selectedEntity;
          if (!sel) return;

          if (sel.type === 'object') {
            store.updatePlacedObject(sel.id, { position: [sx, y, sz] });
          } else if (sel.type === 'npc') {
            store.updateNpc(sel.id, { position: [sx, y, sz] });
          } else if (sel.type === 'portal') {
            store.updatePortal(sel.id, { position: [sx, sz] });
          } else if (sel.type === 'light') {
            store.updateLight(sel.id, { position: [sx, sz] });
          } else if (sel.type === 'player') {
            store.updatePlayer({ position: [sx, y, sz] });
          }
        }
      };

      const onClick = () => {
        // Confirm position, exit grab mode
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('click', onClick);
        tracking.current = false;
        useSceneStore.getState().setGrabMode(false);
      };

      el.addEventListener('pointermove', onMove);
      el.addEventListener('click', onClick);
    }
  });

  // Clean up if grab mode is turned off externally (e.g., Escape)
  useFrame(() => {
    if (!grabMode && tracking.current) {
      tracking.current = false;
    }
  });

  if (!grabMode || !selectedEntity) return null;

  // Render nothing visible — we just need the useFrame hooks above
  return null;
}
