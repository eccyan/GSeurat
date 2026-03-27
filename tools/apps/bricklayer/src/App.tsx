import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Viewport, getOrbitControls } from './viewport/Viewport.js';
import { MenuBar } from './panels/MenuBar.js';
import { ImportDialog } from './panels/ImportDialog.js';
import { ProjectTree } from './panels/ProjectTree.js';
import { hasFileSystemAccess, saveProject as saveProjectDir, saveProjectAsZip } from './lib/projectIO.js';
import { TerrainLeftPanel } from './panels/TerrainLeftPanel.js';
import { CollisionLeftPanel } from './panels/CollisionLeftPanel.js';
import { TerrainRightPanel } from './panels/TerrainRightPanel.js';
import { ScenePropertiesPanel } from './panels/ScenePropertiesPanel.js';
import { SettingsRightPanel } from './panels/SettingsRightPanel.js';
import { useSceneStore } from './store/useSceneStore.js';
import type { ToolType } from './store/types.js';

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

// ── Mode tabs ──

const modeTabsStyles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    borderBottom: '1px solid #333',
    flexShrink: 0,
  },
  tab: {
    flex: 1,
    padding: '8px 4px',
    border: 'none',
    background: 'transparent',
    color: '#888',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
    textAlign: 'center',
    letterSpacing: 1,
  },
  tabActive: {
    color: '#fff',
    borderBottom: '2px solid #77f',
    background: '#2a2a4a',
  },
};

// ── Keyboard shortcuts ──

const toolKeys: Record<string, ToolType> = {
  v: 'place',
  b: 'paint',
  e: 'erase',
  // G is now grab in scene mode, fill in terrain mode
  x: 'extrude',
  i: 'eyedropper',
  s: 'select',
};

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
  const [showImport, setShowImport] = useState(false);
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(320);

  const mode = useSceneStore((s) => s.mode);
  const activeNode = useSceneStore((s) => s.activeNode);

  const handleLeftDrag = useCallback((delta: number) => {
    setLeftWidth((w) => Math.max(160, Math.min(500, w + delta)));
  }, []);

  const handleRightDrag = useCallback((delta: number) => {
    setRightWidth((w) => Math.max(200, Math.min(600, w + delta)));
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

      if (meta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        store.undo();
        return;
      }
      if (meta && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        store.redo();
        return;
      }

      // Escape: cancel grab mode
      if (e.key === 'Escape' && store.grabMode) {
        // Restore original position
        if (store.grabOriginalPosition && store.selectedEntity) {
          const pos = store.grabOriginalPosition;
          const sel = store.selectedEntity;
          if (sel.type === 'object') store.updatePlacedObject(sel.id, { position: pos });
          else if (sel.type === 'npc') store.updateNpc(sel.id, { position: pos });
          else if (sel.type === 'light') store.updateLight(sel.id, { position: pos });
          else if (sel.type === 'portal') store.updatePortal(sel.id, { position: pos });
          else if (sel.type === 'gs_emitter') store.updateGsEmitter(sel.id, { position: pos });
          else if (sel.type === 'gs_animation') store.updateGsAnimation(sel.id, { center: pos });
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

      // G key: grab in scene mode, fill in terrain mode
      if (e.key.toLowerCase() === 'g' && !meta) {
        if (store.mode === 'scene' && store.selectedEntity) {
          e.preventDefault();
          // Start grab mode
          const sel = store.selectedEntity;
          let pos: [number, number, number] | null = null;
          if (sel.type === 'object') {
            const obj = store.placedObjects.find((o) => o.id === sel.id);
            if (obj) pos = [...obj.position];
          } else if (sel.type === 'npc') {
            const npc = store.npcs.find((n) => n.id === sel.id);
            if (npc) pos = [...npc.position];
          } else if (sel.type === 'light') {
            const light = store.staticLights.find((l) => l.id === sel.id);
            if (light) pos = [...light.position];
          } else if (sel.type === 'portal') {
            const portal = store.portals.find((p) => p.id === sel.id);
            if (portal) pos = [...portal.position];
          } else if (sel.type === 'gs_emitter') {
            const em = store.gsParticleEmitters.find((e) => e.id === sel.id);
            if (em) pos = [...em.position];
          } else if (sel.type === 'gs_animation') {
            const anim = store.gsAnimations.find((a) => a.id === sel.id);
            if (anim) pos = [...anim.center];
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
        // Fall through to tool shortcut for terrain mode
        store.setTool('fill');
        return;
      }

      const tool = toolKeys[e.key.toLowerCase()];
      if (tool && !store.grabMode) {
        store.setTool(tool);
        return;
      }

      // T key: toggle X-ray mode (voxels transparent + click-through)
      if (e.key.toLowerCase() === 't' && !meta) {
        store.setXrayMode(!store.xrayMode);
        return;
      }

      if (e.key === '[') {
        store.setBrushSize(store.brushSize - 1);
      } else if (e.key === ']') {
        store.setBrushSize(store.brushSize + 1);
      }

      // F key: frame selected entity
      if (e.key.toLowerCase() === 'f' && !meta && store.mode === 'scene' && store.selectedEntity) {
        const controls = getOrbitControls();
        if (!controls) return;

        const sel = store.selectedEntity;
        let pos: [number, number, number] | null = null;

        if (sel.type === 'object') {
          const obj = store.placedObjects.find((o) => o.id === sel.id);
          if (obj) pos = obj.position;
        } else if (sel.type === 'npc') {
          const npc = store.npcs.find((n) => n.id === sel.id);
          if (npc) pos = npc.position;
        } else if (sel.type === 'portal') {
          const portal = store.portals.find((p) => p.id === sel.id);
          if (portal) pos = [...portal.position];
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

      // Shift: lock orbit in terrain mode for drawing
      if (e.key === 'Shift' && (store.mode === 'terrain' || store.activeNode?.kind === 'collision')) {
        store.setOrbitLocked(true);
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

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        useSceneStore.getState().setOrbitLocked(false);
      }
    };

    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Determine which contextual panel to show in left below ProjectTree
  const isCollisionMode = activeNode?.kind === 'collision';
  const showTerrainTools = !isCollisionMode && (mode === 'terrain' || (activeNode?.kind === 'terrain'));
  const showCollisionTools = isCollisionMode;
  // Determine right panel content
  const rightContent = (() => {
    if (activeNode?.kind === 'settings_category' || mode === 'settings') return <SettingsRightPanel />;
    if (activeNode?.kind === 'scene_item' || activeNode?.kind === 'player' || (mode === 'scene')) return <ScenePropertiesPanel />;
    if (activeNode?.kind === 'collision') return <TerrainRightPanel />;
    return <TerrainRightPanel />;
  })();

  return (
    <div style={styles.root}>
      <MenuBar onImport={() => setShowImport(true)} />
      <div style={styles.body}>
        {/* Left panel */}
        <div style={{ ...styles.leftPanel, width: leftWidth }}>
          {/* Project tree at top */}
          <div style={styles.leftTop}>
            <ProjectTree />
          </div>
          {/* Contextual tools below */}
          <div style={styles.leftContent}>
            {showTerrainTools && <TerrainLeftPanel />}
            {showCollisionTools && <CollisionLeftPanel />}
          </div>
        </div>

        <ResizeHandle side="left" onDrag={handleLeftDrag} />

        {/* Center viewport */}
        <div style={styles.viewport}>
          <Viewport />
          <GrabOverlay />
          <OrbitLockIndicator />
        </div>

        <ResizeHandle side="right" onDrag={handleRightDrag} />

        {/* Right panel */}
        <div style={{ ...styles.rightPanel, width: rightWidth }}>
          <div style={styles.rightContent}>
            {rightContent}
          </div>
        </div>
      </div>
      {showImport && <ImportDialog onClose={() => setShowImport(false)} />}
    </div>
  );
}
