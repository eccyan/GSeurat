import React, { useRef, useCallback, useEffect, useState } from 'react';
import { Canvas, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Grid, Html } from '@react-three/drei';
import * as THREE from 'three';
import { VoxelMesh } from './VoxelMesh.js';
import { GroundPlane } from './GroundPlane.js';
import { GhostVoxel } from './GhostVoxel.js';
import { LightGizmos } from './LightGizmos.js';
import { NpcMarkers } from './NpcMarkers.js';
import { PortalMarkers } from './PortalMarkers.js';
import { ObjectMarkers } from './ObjectMarkers.js';
import { PlayerMarker } from './PlayerMarker.js';
import { CollisionOverlay } from './CollisionOverlay.js';
import { useSceneStore } from '../store/useSceneStore.js';

// Module-level ref so App.tsx can access the orbit controls for F/Home keys
type OrbitControlsRef = {
  target: THREE.Vector3;
  object: THREE.Camera;
  update: () => void;
};
let orbitControlsRef: OrbitControlsRef | null = null;

export function getOrbitControls(): OrbitControlsRef | null {
  return orbitControlsRef;
}

/**
 * Transparent raycast plane for double-click teleport.
 * Covers a large area at Y=0.
 */
function TeleportPlane() {
  const { raycaster, pointer, camera } = useThree();
  const planeRef = useRef<THREE.Mesh>(null);

  const handleDoubleClick = useCallback(() => {
    if (!planeRef.current || !orbitControlsRef) return;
    if (useSceneStore.getState().orbitLocked || useSceneStore.getState().grabMode) return;

    raycaster.setFromCamera(pointer, camera);

    // Raycast against scene objects first, then fall back to ground plane
    const scene = planeRef.current.parent;
    if (!scene) return;

    const intersects = raycaster.intersectObjects(scene.children, true);
    if (intersects.length > 0) {
      const hit = intersects[0].point;
      orbitControlsRef.target.set(hit.x, hit.y, hit.z);
      orbitControlsRef.update();
    }
  }, [raycaster, pointer, camera]);

  return (
    <mesh
      ref={planeRef}
      position={[0, -0.01, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      visible={false}
      onDoubleClick={handleDoubleClick}
    >
      <planeGeometry args={[2000, 2000]} />
      <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
    </mesh>
  );
}

/**
 * Helper: get the 3D position and Y height of the currently grabbed entity.
 */
function getGrabbedEntityY(): number {
  const store = useSceneStore.getState();
  const sel = store.selectedEntity;
  if (!sel) return 0;

  if (sel.type === 'object') {
    const obj = store.placedObjects.find((o) => o.id === sel.id);
    return obj?.position[1] ?? 0;
  }
  if (sel.type === 'npc') {
    const npc = store.npcs.find((n) => n.id === sel.id);
    return npc?.position[1] ?? 0;
  }
  if (sel.type === 'light') {
    const light = store.staticLights.find((l) => l.id === sel.id);
    return light?.height ?? 0;
  }
  if (sel.type === 'player') {
    return store.player.position[1];
  }
  // portal: always Y=0
  return 0;
}

/**
 * Updates the grabbed entity's position in the store.
 */
function updateGrabbedEntity(x: number, y: number, z: number) {
  const store = useSceneStore.getState();
  const sel = store.selectedEntity;
  if (!sel) return;

  if (sel.type === 'object') {
    store.updatePlacedObject(sel.id, { position: [x, y, z] });
  } else if (sel.type === 'npc') {
    store.updateNpc(sel.id, { position: [x, y, z] });
  } else if (sel.type === 'light') {
    store.updateLight(sel.id, { position: [x, z], height: y });
  } else if (sel.type === 'portal') {
    store.updatePortal(sel.id, { position: [x, z] });
  } else if (sel.type === 'player') {
    store.updatePlayer({ position: [x, y, z] });
  }
}

/**
 * Blender-style grab plane: object follows mouse on XZ plane.
 * Hold Shift to adjust Y height via vertical mouse movement.
 * Click to confirm, Esc to cancel (handled in App.tsx).
 */
function GrabPlane() {
  const grabMode = useSceneStore((s) => s.grabMode);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const { camera, gl } = useThree();
  const [shiftHeld, setShiftHeld] = useState(false);
  const lastClientY = useRef(0);
  const currentY = useRef(0);
  const labelPos = useRef<[number, number, number]>([0, 0, 0]);
  const [labelText, setLabelText] = useState('');

  // Track Shift key
  useEffect(() => {
    if (!grabMode) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [grabMode]);

  // Initialize currentY when grab starts, clear label when grab ends
  useEffect(() => {
    if (grabMode) {
      currentY.current = getGrabbedEntityY();
    } else {
      setLabelText('');
    }
  }, [grabMode]);

  // Pointer tracking via window events for smooth grab
  // Uses window so the overlay div doesn't block pointermove
  useEffect(() => {
    if (!grabMode || !selectedEntity) return;

    const el = gl.domElement;
    const plane = new THREE.Plane();
    const raycaster = new THREE.Raycaster();
    const intersection = new THREE.Vector3();

    const onMove = (ev: PointerEvent) => {
      if (shiftHeld) {
        // Shift mode: vertical mouse movement adjusts Y
        const deltaY = (lastClientY.current - ev.clientY) * 0.05;
        lastClientY.current = ev.clientY;
        currentY.current = Math.round((currentY.current + deltaY) * 10) / 10;

        // Get current XZ from entity
        const store = useSceneStore.getState();
        const sel = store.selectedEntity;
        if (!sel) return;

        let cx = 0, cz = 0;
        if (sel.type === 'object') {
          const obj = store.placedObjects.find((o) => o.id === sel.id);
          if (obj) { cx = obj.position[0]; cz = obj.position[2]; }
        } else if (sel.type === 'npc') {
          const npc = store.npcs.find((n) => n.id === sel.id);
          if (npc) { cx = npc.position[0]; cz = npc.position[2]; }
        } else if (sel.type === 'light') {
          const light = store.staticLights.find((l) => l.id === sel.id);
          if (light) { cx = light.position[0]; cz = light.position[1]; }
        } else if (sel.type === 'portal') {
          const portal = store.portals.find((p) => p.id === sel.id);
          if (portal) { cx = portal.position[0]; cz = portal.position[1]; }
        } else if (sel.type === 'player') {
          cx = store.player.position[0]; cz = store.player.position[2];
        }

        updateGrabbedEntity(cx, currentY.current, cz);
        labelPos.current = [cx, currentY.current + 1.5, cz];
        setLabelText(`${cx.toFixed(1)}, Y:${currentY.current.toFixed(1)}, ${cz.toFixed(1)}`);
      } else {
        // Normal mode: XZ plane follow
        lastClientY.current = ev.clientY;
        const rect = el.getBoundingClientRect();
        const pointer = new THREE.Vector2(
          ((ev.clientX - rect.left) / rect.width) * 2 - 1,
          -((ev.clientY - rect.top) / rect.height) * 2 + 1,
        );
        plane.set(new THREE.Vector3(0, 1, 0), -currentY.current);
        raycaster.setFromCamera(pointer, camera);
        if (raycaster.ray.intersectPlane(plane, intersection)) {
          const sx = Math.round(intersection.x * 10) / 10;
          const sz = Math.round(intersection.z * 10) / 10;
          updateGrabbedEntity(sx, currentY.current, sz);
          labelPos.current = [sx, currentY.current + 1.5, sz];
          setLabelText(`${sx.toFixed(1)}, ${currentY.current.toFixed(1)}, ${sz.toFixed(1)}`);
        }
      }
    };

    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
    };
  }, [grabMode, selectedEntity, shiftHeld, camera, gl]);

  if (!grabMode || !labelText) return null;

  return (
    <Html position={labelPos.current} center>
      <div style={{
        background: 'rgba(0,0,0,0.8)',
        color: shiftHeld ? '#88aaff' : '#ffcc00',
        padding: '2px 6px',
        borderRadius: 4,
        fontSize: 11,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}>
        {labelText}
      </div>
    </Html>
  );
}

function SceneContent() {
  const gridWidth = useSceneStore((s) => s.gridWidth);
  const gridDepth = useSceneStore((s) => s.gridDepth);
  const showGrid = useSceneStore((s) => s.showGrid);
  const grabMode = useSceneStore((s) => s.grabMode);
  const orbitLocked = useSceneStore((s) => s.orbitLocked);
  const controlsRef = useRef<OrbitControlsRef | null>(null);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[20, 40, 30]} intensity={0.8} />
      <directionalLight position={[-10, 20, -20]} intensity={0.3} />

      {showGrid && (
        <Grid
          args={[gridWidth, gridDepth]}
          position={[gridWidth / 2 - 0.5, -0.5, gridDepth / 2 - 0.5]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#334"
          sectionSize={8}
          sectionThickness={1}
          sectionColor="#446"
          fadeDistance={200}
          infiniteGrid={false}
        />
      )}

      <VoxelMesh />
      <GroundPlane />
      <GhostVoxel />
      <LightGizmos />
      <NpcMarkers />
      <PortalMarkers />
      <ObjectMarkers />
      <PlayerMarker />
      <CollisionOverlay />
      <TeleportPlane />
      <GrabPlane />

      <OrbitControls
        ref={(r: OrbitControlsRef | null) => {
          controlsRef.current = r;
          orbitControlsRef = r;
        }}
        enabled={!grabMode && !orbitLocked}
        target={[gridWidth / 2, 0, gridDepth / 2]}
        makeDefault
        screenSpacePanning
        mouseButtons={{
          LEFT: 0,
          MIDDLE: 1,
          RIGHT: 2,
        }}
        touches={{
          ONE: 0,
          TWO: 1,
        }}
      />
    </>
  );
}

export function Viewport() {
  const gridWidth = useSceneStore((s) => s.gridWidth);
  const gridDepth = useSceneStore((s) => s.gridDepth);

  return (
    <Canvas
      camera={{ position: [gridWidth / 2, 30, gridDepth + 20], fov: 50 }}
      style={{ background: '#16162a' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <SceneContent />
    </Canvas>
  );
}
