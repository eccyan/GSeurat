import React, { useState } from 'react';
import { useSceneStore } from '../store/useSceneStore.js';
import type { NavigationNode, SettingsCategory } from '../store/types.js';

const styles: Record<string, React.CSSProperties> = {
  tree: { fontSize: 12, userSelect: 'none' },
  node: {
    padding: '3px 6px',
    cursor: 'pointer',
    borderRadius: 3,
    color: '#aaa',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  nodeActive: { background: '#3a3a6a', color: '#fff' },
  indent: { paddingLeft: 16 },
  indent2: { paddingLeft: 32 },
  arrow: { fontSize: 10, width: 12, textAlign: 'center' as const, color: '#888' },
  count: { fontSize: 10, color: '#666', marginLeft: 4 },
  addBtn: {
    marginLeft: 'auto',
    padding: '0 4px',
    border: 'none',
    background: 'transparent',
    color: '#77f',
    cursor: 'pointer',
    fontSize: 14,
    lineHeight: '1',
  },
  removeBtn: {
    marginLeft: 'auto',
    padding: '0 4px',
    border: 'none',
    background: 'transparent',
    color: '#c66',
    cursor: 'pointer',
    fontSize: 12,
    lineHeight: '1',
  },
  heading: {
    fontSize: 11,
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    padding: '8px 0 4px',
    borderBottom: '1px solid #333',
    marginBottom: 4,
  },
};

function nodesEqual(a: NavigationNode | null, b: NavigationNode): boolean {
  if (!a) return false;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'terrain': return b.kind === 'terrain' && a.terrainId === b.terrainId;
    case 'collision': return b.kind === 'collision' && a.terrainId === b.terrainId;
    case 'scene': return b.kind === 'scene';
    case 'scene_category': return b.kind === 'scene_category' && a.category === b.category;
    case 'scene_item': return b.kind === 'scene_item' && a.entityType === b.entityType && a.entityId === b.entityId;
    case 'player': return b.kind === 'player';
    case 'settings': return b.kind === 'settings';
    case 'settings_category': return b.kind === 'settings_category' && a.category === b.category;
  }
}

export function ProjectTree() {
  const projectName = useSceneStore((s) => s.projectName);
  const activeNode = useSceneStore((s) => s.activeNode);
  const setActiveNode = useSceneStore((s) => s.setActiveNode);
  const placedObjects = useSceneStore((s) => s.placedObjects);
  const staticLights = useSceneStore((s) => s.staticLights);
  const npcs = useSceneStore((s) => s.npcs);
  const portals = useSceneStore((s) => s.portals);
  const addLight = useSceneStore((s) => s.addLight);
  const addNpc = useSceneStore((s) => s.addNpc);
  const addPortal = useSceneStore((s) => s.addPortal);
  const addPlacedObject = useSceneStore((s) => s.addPlacedObject);
  const removePlacedObject = useSceneStore((s) => s.removePlacedObject);
  const removeLight = useSceneStore((s) => s.removeLight);
  const removeNpc = useSceneStore((s) => s.removeNpc);
  const removePortal = useSceneStore((s) => s.removePortal);
  const collisionGridData = useSceneStore((s) => s.collisionGridData);

  const [sceneOpen, setSceneOpen] = useState(true);
  const [objOpen, setObjOpen] = useState(true);
  const [lightOpen, setLightOpen] = useState(true);
  const [npcOpen, setNpcOpen] = useState(true);
  const [portalOpen, setPortalOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const click = (node: NavigationNode) => {
    setActiveNode(node);
    // Also update mode and selectedEntity for backward compat
    const store = useSceneStore.getState();
    if (node.kind === 'terrain' || node.kind === 'collision') {
      store.setMode('terrain');
      if (node.kind === 'collision') store.setShowCollision(true);
    } else if (node.kind === 'scene' || node.kind === 'scene_category' || node.kind === 'scene_item' || node.kind === 'player') {
      store.setMode('scene');
      if (node.kind === 'scene_item') {
        store.setSelectedEntity({ type: node.entityType, id: node.entityId });
      } else if (node.kind === 'player') {
        store.setSelectedEntity({ type: 'player', id: 'player' });
      }
    } else if (node.kind === 'settings' || node.kind === 'settings_category') {
      store.setMode('settings');
      if (node.kind === 'settings_category') {
        store.setSelectedSettingsCategory(node.category);
      }
    }
  };

  const isActive = (node: NavigationNode) => nodesEqual(activeNode, node);

  const settingsCategories: { id: SettingsCategory; label: string }[] = [
    { id: 'gs_camera', label: 'GS Camera' },
    { id: 'ambient', label: 'Ambient' },
    { id: 'weather', label: 'Weather' },
    { id: 'day_night', label: 'Day/Night' },
    { id: 'vfx', label: 'VFX' },
    { id: 'backgrounds', label: 'Backgrounds' },
  ];

  return (
    <div style={styles.tree}>
      {/* Project name */}
      <div style={styles.heading}>{projectName}</div>

      {/* Terrain */}
      <div
        style={{ ...styles.node, ...(isActive({ kind: 'terrain', terrainId: 'main' }) ? styles.nodeActive : {}) }}
        onClick={() => click({ kind: 'terrain', terrainId: 'main' })}
      >
        Terrain
      </div>
      <div
        style={{
          ...styles.node,
          ...styles.indent,
          ...(isActive({ kind: 'collision', terrainId: 'main' }) ? styles.nodeActive : {}),
        }}
        onClick={() => click({ kind: 'collision', terrainId: 'main' })}
      >
        Collision
        {!collisionGridData && <span style={styles.count}>(none)</span>}
      </div>

      {/* Scene */}
      <div
        style={{ ...styles.node, ...(isActive({ kind: 'scene' }) ? styles.nodeActive : {}), marginTop: 8 }}
        onClick={() => { setSceneOpen(!sceneOpen); click({ kind: 'scene' }); }}
      >
        <span style={styles.arrow}>{sceneOpen ? '\u25BE' : '\u25B8'}</span>
        Scene
      </div>

      {sceneOpen && (
        <>
          {/* Objects */}
          <div style={{ ...styles.indent }}>
            <div
              style={{ ...styles.node, ...(isActive({ kind: 'scene_category', category: 'objects' }) ? styles.nodeActive : {}) }}
              onClick={() => { setObjOpen(!objOpen); click({ kind: 'scene_category', category: 'objects' }); }}
            >
              <span style={styles.arrow}>{objOpen ? '\u25BE' : '\u25B8'}</span>
              Objects
              <span style={styles.count}>({placedObjects.length})</span>
              <button style={styles.addBtn} onClick={(e) => {
                e.stopPropagation();
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.ply';
                input.onchange = () => {
                  const file = input.files?.[0];
                  if (file) addPlacedObject(file.name);
                };
                input.click();
              }}>+</button>
            </div>
            {objOpen && (
              <div style={styles.indent}>
                {placedObjects.map((obj) => (
                  <div
                    key={obj.id}
                    style={{ ...styles.node, ...(isActive({ kind: 'scene_item', entityType: 'object', entityId: obj.id }) ? styles.nodeActive : {}) }}
                    onClick={() => click({ kind: 'scene_item', entityType: 'object', entityId: obj.id })}
                  >
                    {obj.ply_file || obj.id.slice(0, 12)}
                    <button style={styles.removeBtn} onClick={(e) => { e.stopPropagation(); removePlacedObject(obj.id); }}>&times;</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Lights */}
          <div style={{ ...styles.indent }}>
            <div
              style={{ ...styles.node, ...(isActive({ kind: 'scene_category', category: 'lights' }) ? styles.nodeActive : {}) }}
              onClick={() => { setLightOpen(!lightOpen); click({ kind: 'scene_category', category: 'lights' }); }}
            >
              <span style={styles.arrow}>{lightOpen ? '\u25BE' : '\u25B8'}</span>
              Lights
              <span style={styles.count}>({staticLights.length})</span>
              <button style={styles.addBtn} onClick={(e) => { e.stopPropagation(); addLight(); }}>+</button>
            </div>
            {lightOpen && (
              <div style={styles.indent}>
                {staticLights.map((l) => (
                  <div
                    key={l.id}
                    style={{ ...styles.node, ...(isActive({ kind: 'scene_item', entityType: 'light', entityId: l.id }) ? styles.nodeActive : {}) }}
                    onClick={() => click({ kind: 'scene_item', entityType: 'light', entityId: l.id })}
                  >
                    {l.id.slice(0, 12)}
                    <button style={styles.removeBtn} onClick={(e) => { e.stopPropagation(); removeLight(l.id); }}>&times;</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* NPCs */}
          <div style={{ ...styles.indent }}>
            <div
              style={{ ...styles.node, ...(isActive({ kind: 'scene_category', category: 'npcs' }) ? styles.nodeActive : {}) }}
              onClick={() => { setNpcOpen(!npcOpen); click({ kind: 'scene_category', category: 'npcs' }); }}
            >
              <span style={styles.arrow}>{npcOpen ? '\u25BE' : '\u25B8'}</span>
              NPCs
              <span style={styles.count}>({npcs.length})</span>
              <button style={styles.addBtn} onClick={(e) => { e.stopPropagation(); addNpc(); }}>+</button>
            </div>
            {npcOpen && (
              <div style={styles.indent}>
                {npcs.map((n) => (
                  <div
                    key={n.id}
                    style={{ ...styles.node, ...(isActive({ kind: 'scene_item', entityType: 'npc', entityId: n.id }) ? styles.nodeActive : {}) }}
                    onClick={() => click({ kind: 'scene_item', entityType: 'npc', entityId: n.id })}
                  >
                    {n.name || n.id.slice(0, 12)}
                    <button style={styles.removeBtn} onClick={(e) => { e.stopPropagation(); removeNpc(n.id); }}>&times;</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Portals */}
          <div style={{ ...styles.indent }}>
            <div
              style={{ ...styles.node, ...(isActive({ kind: 'scene_category', category: 'portals' }) ? styles.nodeActive : {}) }}
              onClick={() => { setPortalOpen(!portalOpen); click({ kind: 'scene_category', category: 'portals' }); }}
            >
              <span style={styles.arrow}>{portalOpen ? '\u25BE' : '\u25B8'}</span>
              Portals
              <span style={styles.count}>({portals.length})</span>
              <button style={styles.addBtn} onClick={(e) => { e.stopPropagation(); addPortal(); }}>+</button>
            </div>
            {portalOpen && (
              <div style={styles.indent}>
                {portals.map((p) => (
                  <div
                    key={p.id}
                    style={{ ...styles.node, ...(isActive({ kind: 'scene_item', entityType: 'portal', entityId: p.id }) ? styles.nodeActive : {}) }}
                    onClick={() => click({ kind: 'scene_item', entityType: 'portal', entityId: p.id })}
                  >
                    {p.target_scene || p.id.slice(0, 12)}
                    <button style={styles.removeBtn} onClick={(e) => { e.stopPropagation(); removePortal(p.id); }}>&times;</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Player */}
          <div style={{ ...styles.indent }}>
            <div
              style={{ ...styles.node, ...(isActive({ kind: 'player' }) ? styles.nodeActive : {}) }}
              onClick={() => click({ kind: 'player' })}
            >
              Player
            </div>
          </div>
        </>
      )}

      {/* Settings */}
      <div
        style={{ ...styles.node, ...(isActive({ kind: 'settings' }) ? styles.nodeActive : {}), marginTop: 8 }}
        onClick={() => { setSettingsOpen(!settingsOpen); click({ kind: 'settings' }); }}
      >
        <span style={styles.arrow}>{settingsOpen ? '\u25BE' : '\u25B8'}</span>
        Settings
      </div>
      {settingsOpen && (
        <div style={styles.indent}>
          {settingsCategories.map((cat) => (
            <div
              key={cat.id}
              style={{ ...styles.node, ...(isActive({ kind: 'settings_category', category: cat.id }) ? styles.nodeActive : {}) }}
              onClick={() => click({ kind: 'settings_category', category: cat.id })}
            >
              {cat.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
