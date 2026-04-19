import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Viewport, getOrbitControls } from './viewport/Viewport.js';
import { MenuBar } from './panels/MenuBar.js';
import { MasterTree } from './panels/MasterTree.js';
import { hasFileSystemAccess, saveProject as saveProjectDir, saveProjectAsZip } from './lib/projectIO.js';
import {
  restoreProjectRoot,
  loadBridgePath,
  matchBridgePath,
} from '@gseurat/project-root';
import {
  DebugDumpRegistry,
  installDebugDumpGlobal,
  installDebugDumpKeyboard,
} from '@gseurat/debug-dump';
import { connectBridgeToPath } from './lib/bridgeConnection.js';
import { BricklayerEyesDumper } from './lib/debugDumper.js';
import { ScenePropertiesPanel } from './panels/ScenePropertiesPanel.js';
import { SettingsRightPanel } from './panels/SettingsRightPanel.js';
import { WorldPropertiesPanel } from './panels/WorldPropertiesPanel.js';
import { WorldViewport } from './viewport/WorldViewport.js';
import { useSceneStore } from './store/useSceneStore.js';
import { useWorldStore } from './store/useWorldStore.js';

// ── ResizeHandle ──

function ResizeHandle({
  side,
  onDrag,
}: {
  side: 'left' | 'right';
  onDrag: (delta: number) => void;
}) {
  const [hovering, setHovering] = useState(false);
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      lastX.current = e.clientX;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - lastX.current;
      lastX.current = e.clientX;
      onDrag(side === 'left' ? dx : -dx);
    },
    [onDrag, side],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => { setHovering(false); dragging.current = false; }}
      style={{
        width: 5,
        cursor: 'col-resize',
        background: hovering || dragging.current ? '#77f' : '#333',
        flexShrink: 0,
        transition: 'background 0.15s',
      }}
    />
  );
}

// ── GrabOverlay ──

function GrabOverlay() {
  const grabMode = useSceneStore((s) => s.grabMode);

  // Window-level listener — immune to R3F pointer capture
  useEffect(() => {
    if (!grabMode) return;

    const handleConfirm = (e: PointerEvent) => {
      if (e.button !== 0) return; // Only primary click
      const store = useSceneStore.getState();
      store.setGrabMode(false);
      store.setGrabOriginalPosition(null);
      store.setGrabAxisLock('free');
    };

    // Use capture phase to guarantee we get the event first
    window.addEventListener('pointerdown', handleConfirm, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', handleConfirm, { capture: true });
    };
  }, [grabMode]);

  if (!grabMode) return null;

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 10,
      cursor: 'move',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      paddingBottom: 12,
      pointerEvents: 'none',
    }}>
      <div style={{
        background: 'rgba(0,0,0,0.7)',
        color: '#ffcc00',
        padding: '4px 12px',
        borderRadius: 4,
        fontSize: 12,
        pointerEvents: 'none',
      }}>
        GRAB: Click to confirm, Esc to cancel, X/Y/Z = axis lock
      </div>
    </div>
  );
}

function OrbitLockIndicator() {
  const orbitLocked = useSceneStore((s) => s.orbitLocked);
  if (!orbitLocked) return null;

  return (
    <div style={{
      position: 'absolute',
      top: 8,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 10,
      pointerEvents: 'none',
    }}>
      <div style={{
        background: 'rgba(0,0,0,0.7)',
        color: '#88aaff',
        padding: '3px 10px',
        borderRadius: 4,
        fontSize: 11,
      }}>
        ORBIT LOCKED
      </div>
    </div>
  );
}

// ── App styles ──

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
  body: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  leftPanel: {
    background: '#1e1e3a',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    flexShrink: 0,
  },
  leftTop: {
    overflowY: 'auto',
    padding: 8,
    borderBottom: '1px solid #333',
    maxHeight: '40%',
  },
  leftContent: {
    flex: 1,
    overflowY: 'auto',
    padding: 12,
  },
  viewport: {
    flex: 1,
    position: 'relative',
    minWidth: 100,
  },
  rightPanel: {
    background: '#1e1e3a',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    flexShrink: 0,
  },
  rightContent: {
    flex: 1,
    overflowY: 'auto',
    padding: 12,
  },
};

// ── App ──

export function App() {
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(320);

  const activeNode = useSceneStore((s) => s.activeNode);
  const editingContext = useWorldStore((s) => s.editingContext);

  const handleLeftDrag = useCallback((delta: number) => {
    setLeftWidth((w) => Math.max(160, Math.min(500, w + delta)));
  }, []);

  const handleRightDrag = useCallback((delta: number) => {
    setRightWidth((w) => Math.max(200, Math.min(600, w + delta)));
  }, []);

  // Debug dump: register eyes dumper + install triggers (Ctrl+Shift+D / console)
  useEffect(() => {
    const registry = DebugDumpRegistry.getInstance();
    registry.setSource('bricklayer');
    const dumper = new BricklayerEyesDumper();
    registry.register(dumper);
    installDebugDumpGlobal();
    installDebugDumpKeyboard();
    return () => { registry.unregister(dumper); };
  }, []);

  // Bootstrap (Phase 0.1 #2): on first load, restore the previously-used
  // FSAPI project handle from IDB and, if a cached bridge path is on file
  // for that handle, automatically POST it so the engine can resolve
  // relative asset paths without the user re-typing on every reload.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const handle = await restoreProjectRoot('bricklayer');
        if (cancelled || !handle) return;
        // Don't clobber a handle the user has already picked manually in
        // the same session.
        if (!useSceneStore.getState().projectHandle) {
          useSceneStore.getState().setProjectHandle(handle);
          useSceneStore.getState().setProjectName(handle.name);
          console.info(`[bricklayer] Restored project root: ${handle.name}`);
        }
        // Auto-apply cached bridge path if it matches this handle.
        const cached = await loadBridgePath('bricklayer');
        if (cancelled) return;
        const path = matchBridgePath(cached, handle.name);
        if (!path) return;
        const result = await connectBridgeToPath(path);
        if (cancelled) return;
        if (result.ok) {
          useSceneStore.getState().setBridgeConnectedPath(result.activeProjectDir);
          console.info(`[bricklayer] Bridge auto-connected: ${result.activeProjectDir}`);
        } else {
          console.warn(`[bricklayer] Bridge auto-connect failed: ${result.error}`);
        }
      } catch (e) {
        console.warn('[bricklayer] Bootstrap failed:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      const store = useSceneStore.getState();
      const meta = e.metaKey || e.ctrlKey;

      // Ctrl/Cmd+S: save project
      if (meta && e.key === 's') {
        e.preventDefault();
        (async () => {
          try {
            if (store.projectHandle) {
              await saveProjectDir(store.projectHandle);
              store.markClean();
            } else if (hasFileSystemAccess()) {
              // No handle — handled by MenuBar's Save flow
            } else {
              const blob = await saveProjectAsZip();
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `${store.projectName || 'project'}.zip`;
              a.click();
              URL.revokeObjectURL(a.href);
              store.markClean();
            }
          } catch (err) {
            alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        })();
        return;
      }

      // Escape: cancel grab mode
      if (e.key === 'Escape' && store.grabMode) {
        // Restore original position
        if (store.grabOriginalPosition && store.selectedEntity) {
          const pos = store.grabOriginalPosition;
          const sel = store.selectedEntity;
          if (sel.type === 'game_object') store.updateGameObject(sel.id, { position: pos });
          else if (sel.type === 'light') store.updateLight(sel.id, { position: pos });
          else if (sel.type === 'gs_emitter') store.updateGsEmitter(sel.id, { position: pos });
          else if (sel.type === 'gs_animation') store.updateGsAnimation(sel.id, { center: pos });
          else if (sel.type === 'vfx_instance') store.updateVfxInstance(sel.id, { position: pos });
          else if (sel.type === 'player') store.updatePlayer({ position: pos });
        }
        store.setGrabMode(false);
        store.setGrabOriginalPosition(null);
        store.setGrabAxisLock('free');
        return;
      }

      // X/Y/Z keys during grab: toggle axis lock (ignore key repeat)
      if (store.grabMode && !meta && !e.repeat) {
        const key = e.key.toLowerCase();
        if (key === 'x' || key === 'y' || key === 'z') {
          e.preventDefault();
          store.setGrabAxisLock(store.grabAxisLock === key ? 'free' : key as 'x' | 'y' | 'z');
          return;
        }
      }

      // G key: grab when a scene entity is selected
      if (e.key.toLowerCase() === 'g' && !meta && store.selectedEntity) {
        e.preventDefault();
        const sel = store.selectedEntity;
        let pos: [number, number, number] | null = null;
        if (sel.type === 'game_object') {
          const obj = store.gameObjects.find((o) => o.id === sel.id);
          if (obj) pos = [...obj.position];
        } else if (sel.type === 'light') {
          const light = store.staticLights.find((l) => l.id === sel.id);
          if (light) pos = [...light.position];
        } else if (sel.type === 'gs_emitter') {
          const em = store.gsParticleEmitters.find((e) => e.id === sel.id);
          if (em) pos = [...em.position];
        } else if (sel.type === 'gs_animation') {
          const anim = store.gsAnimations.find((a) => a.id === sel.id);
          if (anim) pos = [...anim.center];
        } else if (sel.type === 'vfx_instance') {
          const vfx = store.vfxInstances.find((v) => v.id === sel.id);
          if (vfx) pos = [...vfx.position];
        } else if (sel.type === 'player') {
          pos = [...store.player.position];
        }
        if (pos) {
          store.setGrabOriginalPosition(pos);
          store.setGrabAxisLock('free');
          store.setGrabMode(true);
        }
        return;
      }

      // F key: frame selected entity
      if (e.key.toLowerCase() === 'f' && !meta && store.selectedEntity) {
        const controls = getOrbitControls();
        if (!controls) return;

        const sel = store.selectedEntity;
        let pos: [number, number, number] | null = null;

        if (sel.type === 'game_object') {
          const obj = store.gameObjects.find((o) => o.id === sel.id);
          if (obj) pos = obj.position;
        } else if (sel.type === 'light') {
          const light = store.staticLights.find((l) => l.id === sel.id);
          if (light) pos = [...light.position];
        } else if (sel.type === 'player') {
          pos = store.player.position;
        }

        if (pos) {
          controls.target.set(pos[0], pos[1], pos[2]);
          controls.update();
        }
        return;
      }

      // H key: reset camera to home (default view)
      if (e.key.toLowerCase() === 'h' && !meta) {
        const controls = getOrbitControls();
        if (!controls) return;

        controls.target.set(store.gridWidth / 2, 0, store.gridDepth / 2);
        controls.object.position.set(
          store.gridWidth / 2,
          30,
          store.gridDepth + 20,
        );
        controls.update();
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, []);

  // Determine right panel content
  const rightContent = (() => {
    const worldSel = useWorldStore.getState().selectedEntity;
    // World-level entities (streaming volume, portal) always show world properties
    if (worldSel && (worldSel.type === 'streaming_volume' || worldSel.type === 'portal')) {
      return <WorldPropertiesPanel />;
    }
    // When editing a chunk/instance, show scene-appropriate panels
    if (editingContext) {
      if (activeNode?.kind === 'settings_category') return <SettingsRightPanel />;
      return <ScenePropertiesPanel />;
    }
    // World view (no editing context)
    return <WorldPropertiesPanel />;
  })();

  return (
    <div style={styles.root}>
      <MenuBar />
      <div style={styles.body}>
        {/* Left panel */}
        <div data-panel-id="left-panel" style={{ ...styles.leftPanel, width: leftWidth }}>
          <div style={{ overflowY: 'auto', padding: 8, flex: 1 }}>
            <MasterTree />
          </div>
        </div>

        <ResizeHandle side="left" onDrag={handleLeftDrag} />

        {/* Center viewport */}
        <div data-panel-id="viewport" style={styles.viewport}>
          {editingContext ? (
            <>
              <Viewport />
              <GrabOverlay />
              <OrbitLockIndicator />
            </>
          ) : (
            <Canvas
              camera={{ position: [128, 80, 128], fov: 50 }}
              style={{ background: '#16162a', width: '100%', height: '100%' }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <WorldViewport />
            </Canvas>
          )}
        </div>

        <ResizeHandle side="right" onDrag={handleRightDrag} />

        {/* Right panel */}
        <div data-panel-id="right-panel" style={{ ...styles.rightPanel, width: rightWidth }}>
          <div style={styles.rightContent}>
            {rightContent}
          </div>
        </div>
      </div>
    </div>
  );
}
