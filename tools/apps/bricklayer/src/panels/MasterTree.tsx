import React, { useState } from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { useSceneStore } from '../store/useSceneStore.js';
import { useWorldStore } from '../store/useWorldStore.js';
import { chunkGridKey } from '@gseurat/project-root';
import { switchScene } from '../lib/projectIO.js';
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
  world: '\u25C8',       // ◈
  terrain: '\u25A6',     // ▦
  collision: '\u25A9',   // ▩
  scene: '\u25C9',       // ◉
  objects: '\u25A3',     // ▣
  lights: '\u2600',      // ☀
  npcs: '\u263A',        // ☺
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
  camera: '\u25CE',      // ◎
  volume: '\u25A2',      // ▢
  trigger: '\u26A1',     // ⚡
  rail: '\u21C4',        // ⇄
  chunk: '\u25A6',       // ▦
  instance: '\u2B1A',    // ⬚
  streaming: '\u25C8',   // ◈
  portal: '\u27D0',      // ⟐
};

// ── Styles ──

const s = {
  tree: { fontSize: 12, userSelect: 'none' as const, padding: '4px 0' },
  heading: {
    fontSize: 10, color: '#666', textTransform: 'uppercase' as const,
    letterSpacing: 1.5, padding: '6px 8px 4px', fontWeight: 600 as const,
  },
  section: { marginBottom: 2 },
  sectionHeader: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    padding: '4px 6px',
    background: '#222',
    borderRadius: 3,
    marginBottom: 4,
    marginTop: 8,
    fontSize: 11,
    fontWeight: 700 as const,
    letterSpacing: 0.5,
    color: '#aaa',
  },
  sectionTitle: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
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
  muteBtn: {
    padding: '0 2px', border: 'none', background: 'transparent',
    color: '#666', cursor: 'pointer', fontSize: 8, fontWeight: 700, lineHeight: '1', flexShrink: 0,
  } as React.CSSProperties,
  emptyHint: { color: '#555', padding: '4px 8px', fontSize: 11 },
};

// ── TreeNode sub-component ──

function TreeNode({
  icon, label, isActive, onClick, arrow, count, actions, children, isOpen, dimmed,
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
  dimmed?: boolean;
}) {
  const [hover, setHover] = useState(false);

  return (
    <>
      <div
        style={{
          ...s.node,
          ...(hover && !isActive ? s.nodeHover : {}),
          ...(isActive ? s.nodeActive : {}),
          ...(dimmed ? { opacity: 0.4 } : {}),
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
    case 'scene': return b.kind === 'scene';
    case 'scene_category': return b.kind === 'scene_category' && a.category === b.category;
    case 'scene_item': return b.kind === 'scene_item' && a.entityType === b.entityType && a.entityId === b.entityId;
    case 'player': return b.kind === 'player';
    case 'settings': return b.kind === 'settings';
    case 'settings_category': return b.kind === 'settings_category' && a.category === b.category;
    case 'world': return b.kind === 'world';
    case 'world_category': return b.kind === 'world_category' && a.category === b.category;
    case 'world_item': return b.kind === 'world_item' && a.entityType === b.entityType && a.entityId === b.entityId;
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

// ── Scene children (shared by chunks and instances) ──

function SceneChildren({
  activeNode,
  click,
  isActive,
}: {
  activeNode: NavigationNode | null;
  click: (node: NavigationNode) => void;
  isActive: (node: NavigationNode) => boolean;
}) {
  const gameObjects = useSceneStore((st) => st.gameObjects);
  const addGameObject = useSceneStore((st) => st.addGameObject);
  const removeGameObject = useSceneStore((st) => st.removeGameObject);
  const staticLights = useSceneStore((st) => st.staticLights);
  const addLight = useSceneStore((st) => st.addLight);
  const removeLight = useSceneStore((st) => st.removeLight);
  const gsParticleEmitters = useSceneStore((st) => st.gsParticleEmitters);
  const addGsEmitter = useSceneStore((st) => st.addGsEmitter);
  const updateGsEmitter = useSceneStore((st) => st.updateGsEmitter);
  const removeGsEmitter = useSceneStore((st) => st.removeGsEmitter);
  const gsAnimations = useSceneStore((st) => st.gsAnimations);
  const addGsAnimation = useSceneStore((st) => st.addGsAnimation);
  const updateGsAnimation = useSceneStore((st) => st.updateGsAnimation);
  const removeGsAnimation = useSceneStore((st) => st.removeGsAnimation);
  const vfxInstances = useSceneStore((st) => st.vfxInstances);
  const addVfxInstance = useSceneStore((st) => st.addVfxInstance);
  const updateVfxInstance = useSceneStore((st) => st.updateVfxInstance);
  const removeVfxInstance = useSceneStore((st) => st.removeVfxInstance);
  const cameraVolumes = useSceneStore((st) => st.cameraVolumes);
  const cameraTriggers = useSceneStore((st) => st.cameraTriggers);
  const cameraRails = useSceneStore((st) => st.cameraRails);
  const addCameraVolume = useSceneStore((st) => st.addCameraVolume);
  const addCameraTrigger = useSceneStore((st) => st.addCameraTrigger);
  const addCameraRail = useSceneStore((st) => st.addCameraRail);
  const removeCameraVolume = useSceneStore((st) => st.removeCameraVolume);
  const removeCameraTrigger = useSceneStore((st) => st.removeCameraTrigger);
  const removeCameraRail = useSceneStore((st) => st.removeCameraRail);
  const importCameraZonesJson = useSceneStore((st) => st.importCameraZonesJson);

  const [sceneOpen, setSceneOpen] = useState(true);
  const [gameObjOpen, setGameObjOpen] = useState(true);
  const [lightOpen, setLightOpen] = useState(true);
  const [emitterOpen, setEmitterOpen] = useState(true);
  const [animOpen, setAnimOpen] = useState(true);
  const [vfxOpen, setVfxOpen] = useState(true);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [camVolOpen, setCamVolOpen] = useState(true);
  const [camTrigOpen, setCamTrigOpen] = useState(true);
  const [camRailOpen, setCamRailOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const addBtn = (onClick: (e: React.MouseEvent) => void) => (
    <button style={s.addBtn} onClick={(e) => { e.stopPropagation(); onClick(e); }}>+</button>
  );

  const removeBtn = (onClick: () => void) => (
    <button style={s.removeBtn} onClick={(e) => { e.stopPropagation(); onClick(); }}>&times;</button>
  );

  const handleImportTrajectory = async () => {
    try {
      const [fileHandle] = await (window as any).showOpenFilePicker({
        types: [{ description: 'JSON files', accept: { 'application/json': ['.json'] } }],
        multiple: false,
      });
      const file = await fileHandle.getFile();
      const text = await file.text();
      const data = JSON.parse(text) as Record<string, unknown>;
      if (!data.camera_zones) {
        alert('Invalid file: missing "camera_zones" key.');
        return;
      }
      importCameraZonesJson(data);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('Failed to import camera zones JSON:', err);
        alert('Failed to import camera zones JSON. See console for details.');
      }
    }
  };

  return (
    <>
      {/* Scene */}
      <div>
        <TreeNode
          icon={icons.scene} label="Scene"
          arrow={sceneOpen ? '\u25BE' : '\u25B8'}
          isActive={isActive({ kind: 'scene' })}
          onClick={() => { setSceneOpen(!sceneOpen); click({ kind: 'scene' }); }}
          isOpen={sceneOpen}
        >
          {/* Game Objects */}
          <TreeNode
            icon={icons.objects} label="Game Objects" count={gameObjects.length}
            arrow={gameObjOpen ? '\u25BE' : '\u25B8'}
            isActive={isActive({ kind: 'scene_category', category: 'objects' })}
            onClick={() => { setGameObjOpen(!gameObjOpen); click({ kind: 'scene_category', category: 'objects' }); }}
            actions={addBtn(() => addGameObject(getCameraTarget().xyz))}
            isOpen={gameObjOpen}
          >
            {gameObjects.map((obj) => (
              <TreeNode
                key={obj.id}
                icon={icons.objects}
                label={obj.name || obj.id.slice(0, 12)}
                isActive={isActive({ kind: 'scene_item', entityType: 'game_object', entityId: obj.id })}
                onClick={() => click({ kind: 'scene_item', entityType: 'game_object', entityId: obj.id })}
                actions={removeBtn(() => removeGameObject(obj.id))}
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
                dimmed={e.muted}
                actions={<>
                  <button style={{ ...s.muteBtn, color: e.muted ? '#f44' : undefined }} title={e.muted ? 'Unmute' : 'Mute'}
                    onClick={(ev) => { ev.stopPropagation(); updateGsEmitter(e.id, { muted: !e.muted }); }}>M</button>
                  {removeBtn(() => removeGsEmitter(e.id))}
                </>}
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
                dimmed={a.muted}
                actions={<>
                  <button style={{ ...s.muteBtn, color: a.muted ? '#f44' : undefined }} title={a.muted ? 'Unmute' : 'Mute'}
                    onClick={(ev) => { ev.stopPropagation(); updateGsAnimation(a.id, { muted: !a.muted }); }}>M</button>
                  {removeBtn(() => removeGsAnimation(a.id))}
                </>}
              />
            ))}
          </TreeNode>

          {/* VFX Instances */}
          <TreeNode
            icon={icons.vfx} label="VFX Instances" count={vfxInstances.length}
            arrow={vfxOpen ? '\u25BE' : '\u25B8'}
            isActive={isActive({ kind: 'scene_category', category: 'vfx_instances' as any })}
            onClick={() => { setVfxOpen(!vfxOpen); click({ kind: 'scene_category', category: 'vfx_instances' as any }); }}
            actions={<button style={s.addBtn} title="Import .vfx.json" onClick={(e) => {
              e.stopPropagation();
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.vfx.json,.json';
              input.onchange = () => {
                const file = input.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const text = reader.result as string;
                    const data = JSON.parse(text);
                    const rawElements = data.elements ?? data.layers ?? [];
                    const preset = {
                      name: data.name ?? 'Unnamed VFX',
                      duration: data.duration as number | undefined,
                      category: data.category as string | undefined,
                      elements: rawElements.map((el: Record<string, unknown>) => ({
                        name: (el.name as string) ?? 'Unnamed',
                        type: (el.type as string) ?? 'emitter',
                        position: el.position as [number, number, number] | undefined,
                        start: el.start as number | undefined,
                        duration: el.duration as number | undefined,
                        loop: el.loop as boolean | undefined,
                        ply_file: el.ply_file as string | undefined,
                        scale: el.scale as number | undefined,
                        emitter: el.emitter,
                        animation: el.animation,
                        region: el.region,
                        light: el.light,
                      })),
                    };
                    const safeName = preset.name.replace(/\s+/g, '_').toLowerCase();
                    const target = getCameraTarget();
                    addVfxInstance({
                      id: `vfx_${Date.now()}`,
                      name: preset.name,
                      vfx_file: `assets/vfx/${safeName}.vfx.json`,
                      vfx_preset: preset,
                      position: target.xyz,
                      rotation_y: 0,
                      radius: 5,
                      trigger: 'auto',
                      loop: true,
                    });
                  } catch (err) {
                    console.error('Failed to parse .vfx.json:', err);
                  }
                };
                reader.readAsText(file);
              };
              input.click();
            }}>+</button>}
            isOpen={vfxOpen}
          >
            {vfxInstances.map((v) => (
              <TreeNode
                key={v.id}
                icon={icons.vfx}
                label={v.name}
                isActive={isActive({ kind: 'scene_item', entityType: 'vfx_instance', entityId: v.id })}
                onClick={() => click({ kind: 'scene_item', entityType: 'vfx_instance', entityId: v.id })}
                dimmed={v.muted}
                actions={<>
                  <button style={{ ...s.muteBtn, color: v.muted ? '#f44' : undefined }} title={v.muted ? 'Unmute' : 'Mute'}
                    onClick={(ev) => { ev.stopPropagation(); updateVfxInstance(v.id, { muted: !v.muted }); }}>M</button>
                  {removeBtn(() => removeVfxInstance(v.id))}
                </>}
              />
            ))}
          </TreeNode>

          {/* Camera Zones */}
          <TreeNode
            icon={icons.camera} label="Camera" count={cameraVolumes.length + cameraTriggers.length + cameraRails.length}
            arrow={cameraOpen ? '\u25BE' : '\u25B8'}
            isActive={isActive({ kind: 'scene_category', category: 'camera_zones' as any })}
            onClick={() => { setCameraOpen(!cameraOpen); click({ kind: 'scene_category', category: 'camera_zones' as any }); }}
            actions={<button style={s.addBtn} title="Import camera zones JSON" onClick={(e) => { e.stopPropagation(); handleImportTrajectory(); }}>{'\u2191'}</button>}
            isOpen={cameraOpen}
          >
            {/* Volumes */}
            <TreeNode
              icon={icons.volume} label="Volumes" count={cameraVolumes.length}
              arrow={camVolOpen ? '\u25BE' : '\u25B8'}
              isActive={false}
              onClick={() => setCamVolOpen(!camVolOpen)}
              actions={addBtn(() => addCameraVolume(getCameraTarget().xyz))}
              isOpen={camVolOpen}
            >
              {cameraVolumes.map((v) => (
                <TreeNode
                  key={v.id}
                  icon={icons.volume}
                  label={v.name || v.id.slice(0, 12)}
                  isActive={isActive({ kind: 'scene_item', entityType: 'camera_volume', entityId: v.id })}
                  onClick={() => click({ kind: 'scene_item', entityType: 'camera_volume', entityId: v.id })}
                  actions={removeBtn(() => removeCameraVolume(v.id))}
                />
              ))}
            </TreeNode>

            {/* Triggers */}
            <TreeNode
              icon={icons.trigger} label="Triggers" count={cameraTriggers.length}
              arrow={camTrigOpen ? '\u25BE' : '\u25B8'}
              isActive={false}
              onClick={() => setCamTrigOpen(!camTrigOpen)}
              actions={addBtn(() => addCameraTrigger(getCameraTarget().xyz))}
              isOpen={camTrigOpen}
            >
              {cameraTriggers.map((t) => (
                <TreeNode
                  key={t.id}
                  icon={icons.trigger}
                  label={`${t.from_zone ? t.from_zone : '*'} \u2192 ${t.to_zone}`}
                  isActive={isActive({ kind: 'scene_item', entityType: 'camera_trigger', entityId: t.id })}
                  onClick={() => click({ kind: 'scene_item', entityType: 'camera_trigger', entityId: t.id })}
                  actions={removeBtn(() => removeCameraTrigger(t.id))}
                />
              ))}
            </TreeNode>

            {/* Rails */}
            <TreeNode
              icon={icons.rail} label="Rails" count={cameraRails.length}
              arrow={camRailOpen ? '\u25BE' : '\u25B8'}
              isActive={false}
              onClick={() => setCamRailOpen(!camRailOpen)}
              actions={addBtn(() => addCameraRail())}
              isOpen={camRailOpen}
            >
              {cameraRails.map((r) => (
                <TreeNode
                  key={r.id}
                  icon={icons.rail}
                  label={r.name || r.id.slice(0, 12)}
                  isActive={isActive({ kind: 'scene_item', entityType: 'camera_rail', entityId: r.id })}
                  onClick={() => click({ kind: 'scene_item', entityType: 'camera_rail', entityId: r.id })}
                  actions={removeBtn(() => removeCameraRail(r.id))}
                />
              ))}
            </TreeNode>
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
    </>
  );
}

// ── Main component ──

export function MasterTree() {
  useComponentRegistry('MasterTree');

  const projectName = useSceneStore((st) => st.projectName);
  const activeNode = useSceneStore((st) => st.activeNode);
  const setActiveNode = useSceneStore((st) => st.setActiveNode);

  const manifest = useWorldStore((st) => st.manifest);
  const worldSelectedEntity = useWorldStore((st) => st.selectedEntity);
  const setWorldSelectedEntity = useWorldStore((st) => st.setSelectedEntity);
  const setEditingContext = useWorldStore((st) => st.setEditingContext);
  const editingContext = useWorldStore((st) => st.editingContext);
  const addChunk = useWorldStore((st) => st.addChunk);
  const removeChunk = useWorldStore((st) => st.removeChunk);
  const addStreamingVolume = useWorldStore((st) => st.addStreamingVolume);
  const removeStreamingVolume = useWorldStore((st) => st.removeStreamingVolume);
  const addInstance = useWorldStore((st) => st.addInstance);
  const removeInstance = useWorldStore((st) => st.removeInstance);
  const addPortal = useWorldStore((st) => st.addPortal);
  const removePortal = useWorldStore((st) => st.removePortal);

  const click = (node: NavigationNode) => {
    setActiveNode(node);
    const store = useSceneStore.getState();
    if (node.kind === 'scene_item') {
      store.setSelectedEntity({ type: node.entityType, id: node.entityId });
    } else if (node.kind === 'player') {
      store.setSelectedEntity({ type: 'player', id: 'player' });
    } else if (node.kind === 'settings_category') {
      store.setSelectedSettingsCategory(node.category);
    }
  };

  const isActive = (node: NavigationNode) => nodesEqual(activeNode, node);

  // ── Chunk/Instance expand/collapse handlers ──

  const handleExpandChunk = async (gridKey: string, sceneFile: string) => {
    const ctx = useWorldStore.getState().editingContext;
    // Already expanded -- collapse
    if (ctx?.type === 'chunk' && ctx.gridKey === gridKey) {
      useWorldStore.getState().setEditingContext(null);
      return;
    }
    // Switch to this chunk's scene
    const handle = useSceneStore.getState().projectHandle;
    if (handle && sceneFile) {
      await switchScene(handle, sceneFile);
    }
    // Set terrain PLY from chunk manifest
    const chunk = manifest.chunks.find((c) => chunkGridKey(c.grid) === gridKey);
    useSceneStore.getState().setTerrainPlyFile(chunk?.ply_file ?? '');
    useWorldStore.getState().setEditingContext({ type: 'chunk', gridKey, sceneFile });
  };

  const handleExpandInstance = async (id: string, sceneFile: string) => {
    const ctx = useWorldStore.getState().editingContext;
    if (ctx?.type === 'instance' && ctx.id === id) {
      useWorldStore.getState().setEditingContext(null);
      return;
    }
    const handle = useSceneStore.getState().projectHandle;
    if (handle && sceneFile) {
      await switchScene(handle, sceneFile);
    }
    // Set terrain PLY from instance manifest
    const inst = manifest.instances.find((i) => i.id === id);
    useSceneStore.getState().setTerrainPlyFile(inst?.ply_file ?? '');
    useWorldStore.getState().setEditingContext({ type: 'instance', id, sceneFile });
  };

  const handleAddChunk = () => {
    const usedKeys = new Set(manifest.chunks.map((c) => chunkGridKey(c.grid)));
    let grid: [number, number, number] = [0, 0, 0];
    outer: for (let z = 0; z < 64; z++) {
      for (let x = 0; x < 64; x++) {
        const key = chunkGridKey([x, 0, z]);
        if (!usedKeys.has(key)) {
          grid = [x, 0, z];
          break outer;
        }
      }
    }
    addChunk(grid);
    setWorldSelectedEntity({ type: 'chunk', id: chunkGridKey(grid) });
  };

  const isChunkExpanded = (gridKey: string) =>
    editingContext?.type === 'chunk' && editingContext.gridKey === gridKey;

  const isInstanceExpanded = (id: string) =>
    editingContext?.type === 'instance' && editingContext.id === id;

  return (
    <div style={s.tree}>
      <div style={s.heading}>{projectName} / WORLD</div>

      {/* ── Chunks ── */}
      <div style={s.sectionHeader}>
        <span style={s.sectionTitle}>
          <span>{icons.chunk}</span>
          <span>Chunks</span>
        </span>
        <button style={s.addBtn} onClick={handleAddChunk} title="Add chunk">+</button>
      </div>
      {manifest.chunks.map((chunk) => {
        const key = chunkGridKey(chunk.grid);
        const expanded = isChunkExpanded(key);
        const isWorldSel = worldSelectedEntity?.type === 'chunk' && worldSelectedEntity.id === key;
        const chunkLabel = chunk.scene_file
          ? `[${chunk.grid[0]}, ${chunk.grid[1]}, ${chunk.grid[2]}] ${chunk.scene_file.replace(/^assets\/scenes\//, '').replace(/\.json$/, '')}`
          : `[${chunk.grid[0]}, ${chunk.grid[1]}, ${chunk.grid[2]}]`;
        return (
          <div key={key}>
            <TreeNode
              icon={icons.chunk}
              label={chunkLabel}
              arrow={expanded ? '\u25BE' : '\u25B8'}
              isActive={isWorldSel}
              onClick={() => {
                setWorldSelectedEntity({ type: 'chunk', id: key });
                handleExpandChunk(key, chunk.scene_file ?? '');
              }}
              actions={
                <button
                  style={s.removeBtn}
                  onClick={(e) => { e.stopPropagation(); removeChunk(key); }}
                  title="Remove chunk"
                >&times;</button>
              }
              isOpen={expanded}
            >
              <SceneChildren activeNode={activeNode} click={click} isActive={isActive} />
            </TreeNode>
          </div>
        );
      })}
      {manifest.chunks.length === 0 && (
        <div style={s.emptyHint}>No chunks</div>
      )}

      {/* ── Instances ── */}
      <div style={s.sectionHeader}>
        <span style={s.sectionTitle}>
          <span>{icons.instance}</span>
          <span>Instances</span>
        </span>
        <button
          style={s.addBtn}
          onClick={() => addInstance('New Instance', '')}
          title="Add instance"
        >+</button>
      </div>
      {manifest.instances.map((inst) => {
        const expanded = isInstanceExpanded(inst.id);
        const isWorldSel = worldSelectedEntity?.type === 'instance' && worldSelectedEntity.id === inst.id;
        return (
          <div key={inst.id}>
            <TreeNode
              icon={icons.instance}
              label={inst.display_name || inst.id}
              arrow={expanded ? '\u25BE' : '\u25B8'}
              isActive={isWorldSel}
              onClick={() => {
                setWorldSelectedEntity({ type: 'instance', id: inst.id });
                handleExpandInstance(inst.id, inst.scene_file);
              }}
              actions={
                <button
                  style={s.removeBtn}
                  onClick={(e) => { e.stopPropagation(); removeInstance(inst.id); }}
                  title="Remove instance"
                >&times;</button>
              }
              isOpen={expanded}
            >
              <SceneChildren activeNode={activeNode} click={click} isActive={isActive} />
            </TreeNode>
          </div>
        );
      })}
      {manifest.instances.length === 0 && (
        <div style={s.emptyHint}>No instances</div>
      )}

      {/* ── Streaming Volumes ── */}
      <div style={s.sectionHeader}>
        <span style={s.sectionTitle}>
          <span>{icons.streaming}</span>
          <span>Streaming Volumes</span>
        </span>
        <button style={s.addBtn} onClick={addStreamingVolume} title="Add streaming volume">+</button>
      </div>
      {manifest.streaming_volumes.map((sv) => {
        const isWorldSel = worldSelectedEntity?.type === 'streaming_volume' && worldSelectedEntity.id === sv.id;
        return (
          <div
            key={sv.id}
            style={{
              ...s.node,
              ...(isWorldSel ? s.nodeActive : {}),
            }}
            onClick={() => { setEditingContext(null); setWorldSelectedEntity({ type: 'streaming_volume', id: sv.id }); }}
          >
            <span style={s.icon}>{icons.streaming}</span>
            <span style={s.label}>{sv.id}</span>
            <button
              style={s.removeBtn}
              onClick={(e) => { e.stopPropagation(); removeStreamingVolume(sv.id); }}
              title="Remove streaming volume"
            >&times;</button>
          </div>
        );
      })}
      {manifest.streaming_volumes.length === 0 && (
        <div style={s.emptyHint}>No streaming volumes</div>
      )}

      {/* ── Portals ── */}
      <div style={s.sectionHeader}>
        <span style={s.sectionTitle}>
          <span>{icons.portal}</span>
          <span>Portals</span>
        </span>
        <button style={s.addBtn} onClick={addPortal} title="Add portal">+</button>
      </div>
      {manifest.portals.map((portal) => {
        const isWorldSel = worldSelectedEntity?.type === 'portal' && worldSelectedEntity.id === portal.id;
        return (
          <div
            key={portal.id}
            style={{
              ...s.node,
              ...(isWorldSel ? s.nodeActive : {}),
            }}
            onClick={() => { setEditingContext(null); setWorldSelectedEntity({ type: 'portal', id: portal.id }); }}
          >
            <span style={s.icon}>{icons.portal}</span>
            <span style={s.label}>{portal.display_name || portal.id}</span>
            <button
              style={s.removeBtn}
              onClick={(e) => { e.stopPropagation(); removePortal(portal.id); }}
              title="Remove portal"
            >&times;</button>
          </div>
        );
      })}
      {manifest.portals.length === 0 && (
        <div style={s.emptyHint}>No portals</div>
      )}
    </div>
  );
}
