import React, { useState } from 'react';
import { useSceneStore } from '../store/useSceneStore.js';
import { getOrbitControls } from '../viewport/Viewport.js';
import type { NavigationNode, SettingsCategory } from '../store/types.js';

/** Get the orbit controls target as a rounded [x, z] pair */
function getCameraTarget(): { xz: [number, number]; xyz: [number, number, number] } {
  const controls = getOrbitControls();
  if (!controls) return { xz: [0, 0], xyz: [0, 0, 0] };
  const t = controls.target;
  return {
    xz: [Math.round(t.x * 10) / 10, Math.round(t.z * 10) / 10],
    xyz: [Math.round(t.x * 10) / 10, Math.round(t.y * 10) / 10, Math.round(t.z * 10) / 10],
  };
}

// ── Icons ──

const icons: Record<string, string> = {
  terrain: '\u25A6',     // ▦
  collision: '\u25A9',   // ▩
  scene: '\u25C9',       // ◉
  objects: '\u25A3',     // ▣
  lights: '\u2600',      // ☀
  npcs: '\u263A',        // ☺
  portals: '\u29C9',     // ⧉
  emitters: '\u2728',     // ✨
  animations: '\u21BB',   // ↻
  player: '\u2666',      // ♦
  settings: '\u2699',    // ⚙
  gs_camera: '\u25CE',   // ◎
  ambient: '\u2601',     // ☁
  weather: '\u2602',     // ☂
  day_night: '\u263D',   // ☽
  vfx: '\u2605',         // ★
  backgrounds: '\u25A1', // □
  file: '\u25C7',        // ◇
};

// ── Styles ──

const s = {
  tree: { fontSize: 12, userSelect: 'none' as const, padding: '4px 0' },
  heading: {
    fontSize: 10, color: '#666', textTransform: 'uppercase' as const,
    letterSpacing: 1.5, padding: '6px 8px 4px', fontWeight: 600 as const,
  },
  section: { marginBottom: 2 },
  indent: {
    marginLeft: 10,
    paddingLeft: 8,
    borderLeft: '1px solid #2a2a4a',
  },
  node: {
    padding: '4px 8px',
    cursor: 'pointer',
    borderRadius: 3,
    color: '#999',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    overflow: 'hidden',
    marginBottom: 1,
    transition: 'background 0.1s, color 0.1s',
  } as React.CSSProperties,
  nodeHover: { background: '#252550', color: '#ccc' },
  nodeActive: { background: '#2e2e5a', color: '#fff', boxShadow: 'inset 3px 0 0 #77f' },
  icon: { fontSize: 12, width: 16, textAlign: 'center' as const, opacity: 0.7, flexShrink: 0 },
  arrow: { fontSize: 9, width: 10, textAlign: 'center' as const, color: '#555', flexShrink: 0 },
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, flex: 1, minWidth: 0 },
  count: { fontSize: 10, color: '#555', marginLeft: 2 },
  addBtn: {
    marginLeft: 'auto', padding: '0 3px', border: 'none', background: 'transparent',
    color: '#77f', cursor: 'pointer', fontSize: 13, lineHeight: '1', flexShrink: 0,
    borderRadius: 3,
  } as React.CSSProperties,
  removeBtn: {
    padding: '0 3px', border: 'none', background: 'transparent',
    color: '#844', cursor: 'pointer', fontSize: 11, lineHeight: '1', flexShrink: 0,
    borderRadius: 3,
  } as React.CSSProperties,
};

// ── TreeNode sub-component ──

function TreeNode({
  icon, label, isActive, onClick, arrow, count, actions, children, isOpen,
}: {
  icon?: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
  arrow?: string;
  count?: number;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  isOpen?: boolean;
}) {
  const [hover, setHover] = useState(false);

  return (
    <>
      <div
        style={{
          ...s.node,
          ...(hover && !isActive ? s.nodeHover : {}),
          ...(isActive ? s.nodeActive : {}),
        }}
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {arrow !== undefined && <span style={s.arrow}>{arrow}</span>}
        {icon && <span style={s.icon}>{icon}</span>}
        <span style={s.label}>{label}</span>
        {count !== undefined && <span style={s.count}>({count})</span>}
        {actions}
      </div>
      {isOpen && children && <div style={s.indent}>{children}</div>}
    </>
  );
}

// ── Helpers ──

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

const settingsCategories: { id: SettingsCategory; label: string; icon: string }[] = [
  { id: 'gs_camera', label: 'GS Camera', icon: icons.gs_camera },
  { id: 'ambient', label: 'Ambient', icon: icons.ambient },
  { id: 'weather', label: 'Weather', icon: icons.weather },
  { id: 'day_night', label: 'Day/Night', icon: icons.day_night },
  { id: 'vfx', label: 'VFX', icon: icons.vfx },
  { id: 'backgrounds', label: 'Backgrounds', icon: icons.backgrounds },
];

// ── Main component ──

export function ProjectTree() {
  const projectName = useSceneStore((st) => st.projectName);
  const activeNode = useSceneStore((st) => st.activeNode);
  const setActiveNode = useSceneStore((st) => st.setActiveNode);
  const placedObjects = useSceneStore((st) => st.placedObjects);
  const staticLights = useSceneStore((st) => st.staticLights);
  const npcs = useSceneStore((st) => st.npcs);
  const portals = useSceneStore((st) => st.portals);
  const addLight = useSceneStore((st) => st.addLight);
  const addNpc = useSceneStore((st) => st.addNpc);
  const addPortal = useSceneStore((st) => st.addPortal);
  const gsParticleEmitters = useSceneStore((st) => st.gsParticleEmitters);
  const addPlacedObject = useSceneStore((st) => st.addPlacedObject);
  const removePlacedObject = useSceneStore((st) => st.removePlacedObject);
  const removeLight = useSceneStore((st) => st.removeLight);
  const removeNpc = useSceneStore((st) => st.removeNpc);
  const removePortal = useSceneStore((st) => st.removePortal);
  const gsAnimations = useSceneStore((st) => st.gsAnimations);
  const addGsEmitter = useSceneStore((st) => st.addGsEmitter);
  const removeGsEmitter = useSceneStore((st) => st.removeGsEmitter);
  const addGsAnimation = useSceneStore((st) => st.addGsAnimation);
  const removeGsAnimation = useSceneStore((st) => st.removeGsAnimation);
  const collisionGridData = useSceneStore((st) => st.collisionGridData);

  const [sceneOpen, setSceneOpen] = useState(true);
  const [objOpen, setObjOpen] = useState(true);
  const [lightOpen, setLightOpen] = useState(true);
  const [npcOpen, setNpcOpen] = useState(true);
  const [portalOpen, setPortalOpen] = useState(true);
  const [emitterOpen, setEmitterOpen] = useState(true);
  const [animOpen, setAnimOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const click = (node: NavigationNode) => {
    setActiveNode(node);
    const store = useSceneStore.getState();
    if (node.kind === 'terrain' || node.kind === 'collision') {
      store.setMode('terrain');
      if (node.kind === 'collision') store.setShowCollision(true);
    } else if (node.kind === 'scene' || node.kind === 'scene_category' || node.kind === 'scene_item' || node.kind === 'player') {
      store.setMode('scene');
      if (node.kind === 'scene_item') store.setSelectedEntity({ type: node.entityType, id: node.entityId });
      else if (node.kind === 'player') store.setSelectedEntity({ type: 'player', id: 'player' });
    } else if (node.kind === 'settings' || node.kind === 'settings_category') {
      store.setMode('settings');
      if (node.kind === 'settings_category') store.setSelectedSettingsCategory(node.category);
    }
  };

  const isActive = (node: NavigationNode) => nodesEqual(activeNode, node);

  const addBtn = (onClick: (e: React.MouseEvent) => void) => (
    <button style={s.addBtn} onClick={(e) => { e.stopPropagation(); onClick(e); }}>+</button>
  );

  const removeBtn = (onClick: () => void) => (
    <button style={s.removeBtn} onClick={(e) => { e.stopPropagation(); onClick(); }}>&times;</button>
  );

  return (
    <div style={s.tree}>
      <div style={s.heading}>{projectName}</div>

      {/* Terrain */}
      <TreeNode
        icon={icons.terrain} label="Terrain"
        isActive={isActive({ kind: 'terrain', terrainId: 'main' })}
        onClick={() => click({ kind: 'terrain', terrainId: 'main' })}
      />

      {/* Collision (child of terrain) */}
      <div style={s.indent}>
        <TreeNode
          icon={icons.collision}
          label={collisionGridData ? 'Collision' : 'Collision (none)'}
          isActive={isActive({ kind: 'collision', terrainId: 'main' })}
          onClick={() => click({ kind: 'collision', terrainId: 'main' })}
        />
      </div>

      {/* Scene */}
      <div style={{ marginTop: 6 }}>
        <TreeNode
          icon={icons.scene} label="Scene"
          arrow={sceneOpen ? '\u25BE' : '\u25B8'}
          isActive={isActive({ kind: 'scene' })}
          onClick={() => { setSceneOpen(!sceneOpen); click({ kind: 'scene' }); }}
          isOpen={sceneOpen}
        >
          {/* Objects */}
          <TreeNode
            icon={icons.objects} label="Objects" count={placedObjects.length}
            arrow={objOpen ? '\u25BE' : '\u25B8'}
            isActive={isActive({ kind: 'scene_category', category: 'objects' })}
            onClick={() => { setObjOpen(!objOpen); click({ kind: 'scene_category', category: 'objects' }); }}
            actions={addBtn(() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.ply';
              input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                addPlacedObject(file.name, file, getCameraTarget().xyz);
                const handle = useSceneStore.getState().projectHandle;
                if (handle) {
                  const { importAssetToProject } = await import('../lib/projectIO.js');
                  await importAssetToProject(handle, file);
                }
              };
              input.click();
            })}
            isOpen={objOpen}
          >
            {placedObjects.map((obj) => (
              <TreeNode
                key={obj.id}
                icon={icons.file}
                label={obj.ply_file || obj.id.slice(0, 12)}
                isActive={isActive({ kind: 'scene_item', entityType: 'object', entityId: obj.id })}
                onClick={() => click({ kind: 'scene_item', entityType: 'object', entityId: obj.id })}
                actions={removeBtn(() => removePlacedObject(obj.id))}
              />
            ))}
          </TreeNode>

          {/* Lights */}
          <TreeNode
            icon={icons.lights} label="Lights" count={staticLights.length}
            arrow={lightOpen ? '\u25BE' : '\u25B8'}
            isActive={isActive({ kind: 'scene_category', category: 'lights' })}
            onClick={() => { setLightOpen(!lightOpen); click({ kind: 'scene_category', category: 'lights' }); }}
            actions={addBtn(() => addLight(getCameraTarget().xyz))}
            isOpen={lightOpen}
          >
            {staticLights.map((l, i) => (
              <TreeNode
                key={l.id}
                icon={icons.lights}
                label={`Light ${i + 1}`}
                isActive={isActive({ kind: 'scene_item', entityType: 'light', entityId: l.id })}
                onClick={() => click({ kind: 'scene_item', entityType: 'light', entityId: l.id })}
                actions={removeBtn(() => removeLight(l.id))}
              />
            ))}
          </TreeNode>

          {/* NPCs */}
          <TreeNode
            icon={icons.npcs} label="NPCs" count={npcs.length}
            arrow={npcOpen ? '\u25BE' : '\u25B8'}
            isActive={isActive({ kind: 'scene_category', category: 'npcs' })}
            onClick={() => { setNpcOpen(!npcOpen); click({ kind: 'scene_category', category: 'npcs' }); }}
            actions={addBtn(() => addNpc(getCameraTarget().xyz))}
            isOpen={npcOpen}
          >
            {npcs.map((n) => (
              <TreeNode
                key={n.id}
                icon={icons.npcs}
                label={n.name || n.id.slice(0, 12)}
                isActive={isActive({ kind: 'scene_item', entityType: 'npc', entityId: n.id })}
                onClick={() => click({ kind: 'scene_item', entityType: 'npc', entityId: n.id })}
                actions={removeBtn(() => removeNpc(n.id))}
              />
            ))}
          </TreeNode>

          {/* Portals */}
          <TreeNode
            icon={icons.portals} label="Portals" count={portals.length}
            arrow={portalOpen ? '\u25BE' : '\u25B8'}
            isActive={isActive({ kind: 'scene_category', category: 'portals' })}
            onClick={() => { setPortalOpen(!portalOpen); click({ kind: 'scene_category', category: 'portals' }); }}
            actions={addBtn(() => addPortal(getCameraTarget().xyz))}
            isOpen={portalOpen}
          >
            {portals.map((p, i) => (
              <TreeNode
                key={p.id}
                icon={icons.portals}
                label={p.target_scene || `Portal ${i + 1}`}
                isActive={isActive({ kind: 'scene_item', entityType: 'portal', entityId: p.id })}
                onClick={() => click({ kind: 'scene_item', entityType: 'portal', entityId: p.id })}
                actions={removeBtn(() => removePortal(p.id))}
              />
            ))}
          </TreeNode>

          {/* Emitters */}
          <TreeNode
            icon={icons.emitters} label="Emitters" count={gsParticleEmitters.length}
            arrow={emitterOpen ? '\u25BE' : '\u25B8'}
            isActive={isActive({ kind: 'scene_category', category: 'emitters' as any })}
            onClick={() => { setEmitterOpen(!emitterOpen); click({ kind: 'scene_category', category: 'emitters' as any }); }}
            actions={addBtn(() => addGsEmitter(getCameraTarget().xyz))}
            isOpen={emitterOpen}
          >
            {gsParticleEmitters.map((e, i) => (
              <TreeNode
                key={e.id}
                icon={icons.emitters}
                label={e.preset || `Emitter ${i + 1}`}
                isActive={isActive({ kind: 'scene_item', entityType: 'gs_emitter', entityId: e.id })}
                onClick={() => click({ kind: 'scene_item', entityType: 'gs_emitter', entityId: e.id })}
                actions={removeBtn(() => removeGsEmitter(e.id))}
              />
            ))}
          </TreeNode>

          {/* Animations */}
          <TreeNode
            icon={icons.animations} label="Animations" count={gsAnimations.length}
            arrow={animOpen ? '\u25BE' : '\u25B8'}
            isActive={isActive({ kind: 'scene_category', category: 'animations' as any })}
            onClick={() => { setAnimOpen(!animOpen); click({ kind: 'scene_category', category: 'animations' as any }); }}
            actions={addBtn(() => addGsAnimation(getCameraTarget().xyz))}
            isOpen={animOpen}
          >
            {gsAnimations.map((a, i) => (
              <TreeNode
                key={a.id}
                icon={icons.animations}
                label={`${a.effect.charAt(0).toUpperCase() + a.effect.slice(1)} ${i + 1}`}
                isActive={isActive({ kind: 'scene_item', entityType: 'gs_animation', entityId: a.id })}
                onClick={() => click({ kind: 'scene_item', entityType: 'gs_animation', entityId: a.id })}
                actions={removeBtn(() => removeGsAnimation(a.id))}
              />
            ))}
          </TreeNode>

          {/* Player */}
          <TreeNode
            icon={icons.player} label="Player"
            isActive={isActive({ kind: 'player' })}
            onClick={() => click({ kind: 'player' })}
          />
        </TreeNode>
      </div>

      {/* Settings */}
      <div style={{ marginTop: 6 }}>
        <TreeNode
          icon={icons.settings} label="Settings"
          arrow={settingsOpen ? '\u25BE' : '\u25B8'}
          isActive={isActive({ kind: 'settings' })}
          onClick={() => { setSettingsOpen(!settingsOpen); click({ kind: 'settings' }); }}
          isOpen={settingsOpen}
        >
          {settingsCategories.map((cat) => (
            <TreeNode
              key={cat.id}
              icon={cat.icon}
              label={cat.label}
              isActive={isActive({ kind: 'settings_category', category: cat.id })}
              onClick={() => click({ kind: 'settings_category', category: cat.id })}
            />
          ))}
        </TreeNode>
      </div>
    </div>
  );
}
