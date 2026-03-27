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
import { GsEmitterMarkers } from './GsEmitterMarkers.js';
import { GsAnimationMarkers } from './GsAnimationMarkers.js';
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
  if (sel.type === 'gs_emitter') {
    const em = store.gsParticleEmitters.find((e) => e.id === sel.id);
    return em?.position[1] ?? 0;
  }
  if (sel.type === 'gs_animation') {
    const anim = store.gsAnimations.find((a) => a.id === sel.id);
    return anim?.center[1] ?? 0;
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
  } else if (sel.type === 'gs_emitter') {
    store.updateGsEmitter(sel.id, { position: [x, y, z] });
  } else if (sel.type === 'gs_animation') {
    store.updateGsAnimation(sel.id, { center: [x, y, z] });
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
  const axisLock = useSceneStore((s) => s.grabAxisLock);
  const { camera, gl } = useThree();
  const [shiftHeld, setShiftHeld] = useState(false);
  const lastClientY = useRef(0);
  const currentPos = useRef<[number, number, number]>([0, 0, 0]);
  const labelPos = useRef<[number, number, number]>([0, 0, 0]);
  const [labelText, setLabelText] = useState('');

  // Track Shift key
  useEffect(() => {
    if (!grabMode) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true); };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [grabMode]);

  // Initialize position when grab starts
  useEffect(() => {
    if (grabMode) {
      const store = useSceneStore.getState();
      const pos = store.grabOriginalPosition;
      if (pos) currentPos.current = [...pos];
    } else {
      setLabelText('');
    }
  }, [grabMode]);

  // Pointer tracking
  useEffect(() => {
    if (!grabMode || !selectedEntity) return;

    const el = gl.domElement;
    const plane = new THREE.Plane();
    const raycaster = new THREE.Raycaster();
    const intersection = new THREE.Vector3();

    const onMove = (ev: PointerEvent) => {
      const store = useSceneStore.getState();
      const lock = store.grabAxisLock;

      if (shiftHeld && lock === 'free') {
        // Shift mode: vertical mouse movement adjusts Y (backward compat)
        const deltaY = (lastClientY.current - ev.clientY) * 0.05;
        lastClientY.current = ev.clientY;
        const newY = Math.round((currentPos.current[1] + deltaY) * 10) / 10;
        currentPos.current[1] = newY;
        updateGrabbedEntity(currentPos.current[0], newY, currentPos.current[2]);
        labelPos.current = [currentPos.current[0], newY + 1.5, currentPos.current[2]];
        setLabelText(`${currentPos.current[0].toFixed(1)}, Y:${newY.toFixed(1)}, ${currentPos.current[2].toFixed(1)}`);
        return;
      }

      lastClientY.current = ev.clientY;
      const rect = el.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);

      if (lock === 'free') {
        // Screen-aligned plane: perpendicular to camera view at entity distance
        const entityPos = new THREE.Vector3(currentPos.current[0], currentPos.current[1], currentPos.current[2]);
        const camDir = camera.getWorldDirection(new THREE.Vector3());
        plane.setFromNormalAndCoplanarPoint(camDir, entityPos);

        if (raycaster.ray.intersectPlane(plane, intersection)) {
          const sx = Math.round(intersection.x * 10) / 10;
          const sy = Math.round(intersection.y * 10) / 10;
          const sz = Math.round(intersection.z * 10) / 10;
          currentPos.current = [sx, sy, sz];
          updateGrabbedEntity(sx, sy, sz);
          labelPos.current = [sx, sy + 1.5, sz];
          setLabelText(`${sx.toFixed(1)}, ${sy.toFixed(1)}, ${sz.toFixed(1)}`);
        }
      } else {
        // Axis-locked: use camera-perpendicular plane containing the locked axis
        const entityPos = new THREE.Vector3(currentPos.current[0], currentPos.current[1], currentPos.current[2]);
        const camDir = camera.getWorldDirection(new THREE.Vector3());

        // Create a plane that contains the axis direction and faces the camera
        const axisDir = lock === 'x' ? new THREE.Vector3(1, 0, 0)
                      : lock === 'y' ? new THREE.Vector3(0, 1, 0)
                      : new THREE.Vector3(0, 0, 1);
        const planeNormal = new THREE.Vector3().crossVectors(axisDir, camDir).cross(axisDir).normalize();
        if (planeNormal.lengthSq() < 0.001) {
          // Camera is looking along the axis — use a fallback plane
          planeNormal.set(camDir.x, camDir.y, camDir.z);
        }
        plane.setFromNormalAndCoplanarPoint(planeNormal, entityPos);

        if (raycaster.ray.intersectPlane(plane, intersection)) {
          // Project intersection onto the axis through entity position
          const delta = intersection.clone().sub(entityPos);
          const projected = axisDir.clone().multiplyScalar(delta.dot(axisDir));
          const result = entityPos.clone().add(projected);
          const sx = Math.round(result.x * 10) / 10;
          const sy = Math.round(result.y * 10) / 10;
          const sz = Math.round(result.z * 10) / 10;
          currentPos.current = [sx, sy, sz];
          updateGrabbedEntity(sx, sy, sz);
          labelPos.current = [sx, sy + 1.5, sz];
          const axisLabel = lock.toUpperCase();
          setLabelText(`[${axisLabel}] ${sx.toFixed(1)}, ${sy.toFixed(1)}, ${sz.toFixed(1)}`);
        }
      }
    };

    window.addEventListener('pointermove', onMove);
    return () => { window.removeEventListener('pointermove', onMove); };
  }, [grabMode, selectedEntity, shiftHeld, camera, gl, axisLock]);

  if (!grabMode || !labelText) return null;

  const axisColors: Record<string, string> = { free: '#ffcc00', x: '#ff4444', y: '#44ff44', z: '#4488ff' };

  return (
    <Html position={labelPos.current} center>
      <div style={{
        background: 'rgba(0,0,0,0.8)',
        color: shiftHeld ? '#88aaff' : (axisColors[axisLock] ?? '#ffcc00'),
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
      <GsEmitterMarkers />
      <GsAnimationMarkers />
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
