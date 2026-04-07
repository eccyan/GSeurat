import React, { useRef, useCallback, useEffect, useState } from 'react';
import { Canvas, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Grid, Html } from '@react-three/drei';
import * as THREE from 'three';
import { VoxelMesh } from './VoxelMesh.js';
import { GroundPlane } from './GroundPlane.js';
import { GhostVoxel } from './GhostVoxel.js';
import { LightGizmos } from './LightGizmos.js';
import { GameObjectMarkers } from './GameObjectMarkers.js';
import { PortalMarkers } from './PortalMarkers.js';
import { GsEmitterMarkers } from './GsEmitterMarkers.js';
import { GsEmitterParticles } from './GsEmitterParticles.js';
import { GsAnimationMarkers } from './GsAnimationMarkers.js';
import { VfxInstanceMarkers } from './VfxInstanceMarkers.js';
import { VfxRenderer } from './VfxRenderer.js';
import { PlayerMarker } from './PlayerMarker.js';
import { CameraZoneMarkers } from './CameraZoneMarkers.js';
import { CameraRailMarkers } from './CameraRailMarkers.js';
import { CameraFrustumGizmo } from './CameraFrustumGizmo.js';
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

  if (sel.type === 'game_object') {
    const obj = store.gameObjects.find((o) => o.id === sel.id);
    return obj?.position[1] ?? 0;
  }
  if (sel.type === 'light') {
    const light = store.staticLights.find((l) => l.id === sel.id);
    return light?.position[1] ?? 0;
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
  if (sel.type === 'vfx_instance') {
    const vfx = store.vfxInstances.find((v) => v.id === sel.id);
    return vfx?.position[1] ?? 0;
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

  if (sel.type === 'game_object') {
    store.updateGameObject(sel.id, { position: [x, y, z] });
  } else if (sel.type === 'light') {
    store.updateLight(sel.id, { position: [x, y, z] });
  } else if (sel.type === 'portal') {
    store.updatePortal(sel.id, { position: [x, y, z] });
  } else if (sel.type === 'gs_emitter') {
    store.updateGsEmitter(sel.id, { position: [x, y, z] });
  } else if (sel.type === 'gs_animation') {
    store.updateGsAnimation(sel.id, { center: [x, y, z] });
  } else if (sel.type === 'vfx_instance') {
    store.updateVfxInstance(sel.id, { position: [x, y, z] });
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
  const currentPos = useRef<[number, number, number]>([0, 0, 0]);
  const grabOffset = useRef<THREE.Vector3 | null>(null);
  const labelPos = useRef<[number, number, number]>([0, 0, 0]);
  const [labelText, setLabelText] = useState('');

  // Initialize position when grab starts
  useEffect(() => {
    if (grabMode) {
      const store = useSceneStore.getState();
      const pos = store.grabOriginalPosition;
      if (pos) currentPos.current = [...pos];
      grabOffset.current = null;  // will be computed on first move
    } else {
      setLabelText('');
      grabOffset.current = null;
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

      const rect = el.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);

      // Compute grab plane at entity position
      const entityPos = new THREE.Vector3(currentPos.current[0], currentPos.current[1], currentPos.current[2]);
      const camDir = camera.getWorldDirection(new THREE.Vector3());

      if (lock === 'free') {
        // Screen-aligned plane at entity distance
        plane.setFromNormalAndCoplanarPoint(camDir, entityPos);

        if (raycaster.ray.intersectPlane(plane, intersection)) {
          // On first move, compute offset so entity doesn't jump to cursor
          if (!grabOffset.current) {
            grabOffset.current = intersection.clone().sub(entityPos);
          }
          const adjusted = intersection.clone().sub(grabOffset.current);
          const sx = Math.round(adjusted.x * 10) / 10;
          const sy = Math.round(adjusted.y * 10) / 10;
          const sz = Math.round(adjusted.z * 10) / 10;
          currentPos.current = [sx, sy, sz];
          updateGrabbedEntity(sx, sy, sz);
          labelPos.current = [sx, sy + 1.5, sz];
          setLabelText(`X:${sx.toFixed(1)}  Y:${sy.toFixed(1)}  Z:${sz.toFixed(1)}`);
        }
      } else {
        // Axis-locked: plane containing the axis, facing the camera
        const axisDir = lock === 'x' ? new THREE.Vector3(1, 0, 0)
                      : lock === 'y' ? new THREE.Vector3(0, 1, 0)
                      : new THREE.Vector3(0, 0, 1);
        const planeNormal = new THREE.Vector3().crossVectors(axisDir, camDir).cross(axisDir).normalize();
        if (planeNormal.lengthSq() < 0.001) {
          planeNormal.set(camDir.x, camDir.y, camDir.z);
        }
        plane.setFromNormalAndCoplanarPoint(planeNormal, entityPos);

        if (raycaster.ray.intersectPlane(plane, intersection)) {
          // On first move, compute offset along axis
          if (!grabOffset.current) {
            grabOffset.current = intersection.clone().sub(entityPos);
          }
          const adjusted = intersection.clone().sub(grabOffset.current);
          // Project onto axis through original entity position
          const origPos = new THREE.Vector3(...(useSceneStore.getState().grabOriginalPosition ?? [0, 0, 0]));
          const delta = adjusted.clone().sub(origPos);
          const projected = axisDir.clone().multiplyScalar(delta.dot(axisDir));
          const result = origPos.clone().add(projected);
          const sx = Math.round(result.x * 10) / 10;
          const sy = Math.round(result.y * 10) / 10;
          const sz = Math.round(result.z * 10) / 10;
          currentPos.current = [sx, sy, sz];
          updateGrabbedEntity(sx, sy, sz);
          labelPos.current = [sx, sy + 1.5, sz];
          const axisLabel = lock.toUpperCase();
          const val = lock === 'x' ? sx : lock === 'y' ? sy : sz;
          setLabelText(`${axisLabel}: ${val.toFixed(1)}`);
        }
      }
    };

    // Reset offset when axis lock changes so entity doesn't jump
    grabOffset.current = null;

    window.addEventListener('pointermove', onMove);
    return () => { window.removeEventListener('pointermove', onMove); };
  }, [grabMode, selectedEntity, camera, gl, axisLock]);

  if (!grabMode || !labelText) return null;

  const axisColors: Record<string, string> = { free: '#ffcc00', x: '#ff4444', y: '#44ff44', z: '#4488ff' };

  return (
    <Html position={labelPos.current} center>
      <div style={{
        background: 'rgba(0,0,0,0.8)',
        color: axisColors[axisLock] ?? '#ffcc00',
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
  const possessVolumeId = useSceneStore((s) => s.possessVolumeId);
  const cameraVolumes = useSceneStore((s) => s.cameraVolumes);
  const cameraRails = useSceneStore((s) => s.cameraRails);
  const controlsRef = useRef<OrbitControlsRef | null>(null);

  // Compute possess mode camera constraints
  const possessData = React.useMemo(() => {
    if (!possessVolumeId) return null;
    const volume = cameraVolumes.find((v) => v.id === possessVolumeId);
    if (!volume) return null;

    const { params, shape } = volume;
    const center = shape.center;
    const offset = params.offset ?? [0, 5, -10];
    const orbitDist = params.orbit_distance ?? 10;

    // Compute camera position based on mode (same logic as CameraFrustumGizmo)
    let camPos: [number, number, number];
    switch (params.mode) {
      case 'fixed_point': {
        if (params.fixed_position) {
          camPos = [...params.fixed_position] as [number, number, number];
        } else {
          camPos = [center[0] + offset[0], center[1] + offset[1], center[2] + offset[2] + orbitDist];
        }
        break;
      }
      case 'rail_follow':
      case 'cinematic_rail': {
        if (params.rail_id) {
          const rail = cameraRails.find((r) => r.id === params.rail_id);
          if (rail && rail.control_points.length > 0) {
            camPos = [...rail.control_points[0]] as [number, number, number];
            break;
          }
        }
        camPos = [center[0] + offset[0], center[1] + offset[1], center[2] + offset[2] + orbitDist];
        break;
      }
      case 'side_scroll': {
        camPos = [center[0] + offset[0], center[1] + offset[1], center[2] + offset[2]];
        break;
      }
      default: {
        // free_look: center + offset + orbit at orbit_distance
        camPos = [center[0] + offset[0], center[1] + offset[1], center[2] + offset[2] + orbitDist];
        break;
      }
    }

    // Convert pitch/yaw limits from degrees to polar/azimuth angles for OrbitControls
    // OrbitControls polar: 0 = top, π/2 = equator, π = bottom
    // pitch in degrees: 0 = horizon, positive = up, negative = down
    // polar = π/2 - pitch_in_radians
    const pitchMinRad = (params.pitch_min ?? -60) * Math.PI / 180;
    const pitchMaxRad = (params.pitch_max ?? 10) * Math.PI / 180;
    const minPolar = Math.PI / 2 - pitchMaxRad;
    const maxPolar = Math.PI / 2 - pitchMinRad;

    const minAzimuth = (params.yaw_min ?? -180) * Math.PI / 180;
    const maxAzimuth = (params.yaw_max ?? 180) * Math.PI / 180;

    return {
      target: center as [number, number, number],
      camPos,
      minPolar,
      maxPolar,
      minAzimuth,
      maxAzimuth,
    };
  }, [possessVolumeId, cameraVolumes, cameraRails]);

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
      <GameObjectMarkers />
      <PortalMarkers />
      <GsEmitterMarkers />
      <GsEmitterParticles />
      <GsAnimationMarkers />
      <VfxInstanceMarkers />
      <VfxRenderer />
      <PlayerMarker />
      <CameraZoneMarkers />
      <CameraRailMarkers />
      <CameraFrustumGizmo />
      <CollisionOverlay />
      <TeleportPlane />
      <GrabPlane />

      {possessData ? (
        <>
          <OrbitControls
            ref={(r: OrbitControlsRef | null) => {
              controlsRef.current = r;
              orbitControlsRef = r;
            }}
            enabled={!grabMode}
            target={possessData.target}
            minPolarAngle={possessData.minPolar}
            maxPolarAngle={possessData.maxPolar}
            minAzimuthAngle={possessData.minAzimuth}
            maxAzimuthAngle={possessData.maxAzimuth}
            enableDamping
            dampingFactor={0.1}
            makeDefault
            screenSpacePanning={false}
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
          {/* Banner rendered outside Canvas in Viewport() wrapper */}
        </>
      ) : (
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
      )}
    </>
  );
}

export function Viewport() {
  const gridWidth = useSceneStore((s) => s.gridWidth);
  const gridDepth = useSceneStore((s) => s.gridDepth);
  const possessVolumeId = useSceneStore((s) => s.possessVolumeId);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        camera={{ position: [gridWidth / 2, 30, gridDepth + 20], fov: 50 }}
        style={{ background: '#16162a' }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <SceneContent />
      </Canvas>
      {possessVolumeId && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          background: 'rgba(0,0,0,0.75)', color: '#00ffff',
          textAlign: 'center', padding: '8px 0', fontSize: '14px', fontWeight: 'bold',
          letterSpacing: '1px', zIndex: 10, pointerEvents: 'none',
        }}>
          PREVIEW MODE — Press Escape to exit
        </div>
      )}
    </div>
  );
}
