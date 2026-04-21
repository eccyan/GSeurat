/**
 * StagingCameraSync — bidirectional camera sync between Bricklayer and Staging.
 *
 * When stagingCameraLock is true:
 * - Sends Bricklayer's OrbitControls camera to Staging via sync_camera command (throttled 60Hz)
 * - Listens for camera_sync events from Staging and applies them to OrbitControls
 * - Uses source field for echo suppression
 */
import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { sendBridgeCommand, getBridgeClient } from '@gseurat/engine-client';
import { useSceneStore } from '../store/useSceneStore.js';
import { getOrbitControls } from './Viewport.js';
import type { CameraSyncEvent } from '@gseurat/engine-client';

const SEND_INTERVAL_MS = 16; // ~60 Hz

export function StagingCameraSync() {
  const locked = useSceneStore((s) => s.stagingCameraLock);
  const { camera } = useThree();
  const lastSendRef = useRef(0);
  const isRemoteUpdateRef = useRef(false);

  // Subscribe to camera_sync events when locked
  useEffect(() => {
    if (!locked) return;

    let off: (() => void) | null = null;
    let cancelled = false;

    // Await bridge connection before registering event handler.
    // sendBridgeCommand triggers async connect; getBridgeClient() may
    // return null if called immediately after.
    const setup = async () => {
      await sendBridgeCommand({ cmd: 'subscribe', events: ['camera_sync'] });
      if (cancelled) return;

      const client = getBridgeClient();
      if (!client) return;

      off = client.on('camera_sync', (data: unknown) => {
        const event = data as CameraSyncEvent;
        if (event.source === 'bricklayer') return; // Echo suppression

        const controls = getOrbitControls();
        if (!controls) return;

        isRemoteUpdateRef.current = true;
        camera.position.set(event.position[0], event.position[1], event.position[2]);
        controls.target.set(event.target[0], event.target[1], event.target[2]);
        controls.update();
        isRemoteUpdateRef.current = false;
      });
    };
    setup();

    return () => {
      cancelled = true;
      off?.();
      sendBridgeCommand({ cmd: 'unsubscribe' });
    };
  }, [locked, camera]);

  // Send camera state on each frame when locked
  useEffect(() => {
    if (!locked) return;

    let frameId: number;

    const sendLoop = () => {
      frameId = requestAnimationFrame(sendLoop);

      const now = performance.now();
      if (now - lastSendRef.current < SEND_INTERVAL_MS) return;
      if (isRemoteUpdateRef.current) return; // Don't echo back

      const controls = getOrbitControls();
      if (!controls) return;

      const pos = camera.position;
      const tgt = controls.target;

      lastSendRef.current = now;
      sendBridgeCommand({
        cmd: 'sync_camera',
        source: 'bricklayer',
        position: [pos.x, pos.y, pos.z],
        target: [tgt.x, tgt.y, tgt.z],
      });
    };

    frameId = requestAnimationFrame(sendLoop);
    return () => cancelAnimationFrame(frameId);
  }, [locked, camera]);

  return null; // Render nothing — pure side-effect component
}
