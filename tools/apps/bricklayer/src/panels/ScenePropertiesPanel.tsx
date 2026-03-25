import React from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type {
  StaticLight,
  NpcData,
  PortalData,
  PlacedObjectData,
  PlayerData,
} from '../store/types.js';

const styles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  input: {
    flex: 1, padding: '4px 6px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 13,
  },
  select: {
    flex: 1, padding: '4px 6px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 13,
  },
  btnDanger: {
    padding: '4px 10px', border: '1px solid #c33', borderRadius: 4,
    background: '#4a2020', color: '#faa', cursor: 'pointer', fontSize: 12,
  },
  empty: { fontSize: 12, color: '#666', textAlign: 'center' as const, paddingTop: 40 },
  checkbox: { marginRight: 4 },
};

const facings = ['up', 'down', 'left', 'right'];

function Vec3Input({
  value,
  onChange,
  step,
}: {
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
  step?: number;
}) {
  return (
    <div style={styles.row}>
      {['X', 'Y', 'Z'].map((axis, i) => (
        <React.Fragment key={axis}>
          <NumberInput
            label={axis}
            step={step ?? 0.1}
            value={value[i]}
            onChange={(v) => {
              const next = [...value] as [number, number, number];
              next[i] = v;
              onChange(next);
            }}
            style={{ ...styles.input, maxWidth: 55 }}
          />
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Per-entity property editors ──

function ObjectProperties({ obj }: { obj: PlacedObjectData }) {
  const update = useSceneStore((s) => s.updatePlacedObject);
  const remove = useSceneStore((s) => s.removePlacedObject);

  return (
    <div>
      <div style={{ ...styles.row, marginBottom: 12 }}>
        <span style={{ ...styles.label, flex: 1 }}>Placed Object</span>
        <button style={styles.btnDanger} onClick={() => remove(obj.id)}>Remove</button>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>PLY File</span>
        <input
          type="text"
          value={obj.ply_file}
          onChange={(e) => update(obj.id, { ply_file: e.target.value })}
          style={styles.input}
          placeholder="path/to/model.ply"
        />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Position</span>
        <Vec3Input value={obj.position} onChange={(v) => update(obj.id, { position: v })} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Rotation (deg)</span>
        <Vec3Input value={obj.rotation} onChange={(v) => update(obj.id, { rotation: v })} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Scale</span>
        <NumberInput
          step={0.1}
          value={obj.scale}
          onChange={(v) => update(obj.id, { scale: v })}
          style={{ ...styles.input, maxWidth: 80 }}
        />
      </div>

      <div style={styles.section}>
        <label style={{ fontSize: 12, color: '#ddd', display: 'flex', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={obj.is_static}
            onChange={(e) => update(obj.id, { is_static: e.target.checked })}
            style={styles.checkbox}
          />
          Static (merge into terrain)
        </label>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Character Manifest</span>
        <input
          type="text"
          value={obj.character_manifest}
          onChange={(e) => update(obj.id, { character_manifest: e.target.value })}
          style={styles.input}
          placeholder="character manifest JSON"
        />
      </div>
    </div>
  );
}

function LightProperties({ light }: { light: StaticLight }) {
  const update = useSceneStore((s) => s.updateLight);
  const remove = useSceneStore((s) => s.removeLight);

  return (
    <div>
      <div style={{ ...styles.row, marginBottom: 12 }}>
        <span style={{ ...styles.label, flex: 1 }}>Light</span>
        <button style={styles.btnDanger} onClick={() => remove(light.id)}>Remove</button>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Position</span>
        <div style={styles.row}>
          <NumberInput
            label="X"
            value={light.position[0]}
            onChange={(v) => update(light.id, { position: [v, light.position[1]] })}
            style={styles.input}
          />
          <NumberInput
            label="Z"
            value={light.position[1]}
            onChange={(v) => update(light.id, { position: [light.position[0], v] })}
            style={styles.input}
          />
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Radius</span>
        <NumberInput
          step={0.5}
          value={light.radius}
          onChange={(v) => update(light.id, { radius: v })}
          style={styles.input}
        />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Height</span>
        <NumberInput
          step={0.5}
          value={light.height}
          onChange={(v) => update(light.id, { height: v })}
          style={styles.input}
        />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Color</span>
        <input
          type="color"
          value={'#' + light.color.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}
          onChange={(e) => {
            const hex = e.target.value;
            update(light.id, {
              color: [
                parseInt(hex.slice(1, 3), 16) / 255,
                parseInt(hex.slice(3, 5), 16) / 255,
                parseInt(hex.slice(5, 7), 16) / 255,
              ],
            });
          }}
          style={{ width: 40, height: 24, border: 'none', cursor: 'pointer' }}
        />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Intensity</span>
        <NumberInput
          step={0.1}
          value={light.intensity}
          onChange={(v) => update(light.id, { intensity: v })}
          style={styles.input}
        />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Cone Angle</span>
        <NumberInput
          step={5}
          min={1}
          max={180}
          value={light.cone_angle ?? 180}
          onChange={(v) => {
            const angle = Math.max(1, Math.min(180, v));
            if (angle >= 180) {
              update(light.id, { cone_angle: undefined, direction: undefined });
            } else {
              update(light.id, {
                cone_angle: angle,
                direction: light.direction ?? [0, -1, 0],
              });
            }
          }}
          style={styles.input}
        />
      </div>

      {(light.cone_angle ?? 180) < 180 && (
        <div style={styles.section}>
          <span style={styles.label}>Direction</span>
          <div style={styles.row}>
            <NumberInput
              label="X"
              step={0.1}
              value={light.direction?.[0] ?? 0}
              onChange={(v) => update(light.id, { direction: [v, light.direction?.[1] ?? -1, light.direction?.[2] ?? 0] })}
              style={styles.input}
            />
            <NumberInput
              label="Y"
              step={0.1}
              value={light.direction?.[1] ?? -1}
              onChange={(v) => update(light.id, { direction: [light.direction?.[0] ?? 0, v, light.direction?.[2] ?? 0] })}
              style={styles.input}
            />
            <NumberInput
              label="Z"
              step={0.1}
              value={light.direction?.[2] ?? 0}
              onChange={(v) => update(light.id, { direction: [light.direction?.[0] ?? 0, light.direction?.[1] ?? -1, v] })}
              style={styles.input}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function NpcProperties({ npc }: { npc: NpcData }) {
  const update = useSceneStore((s) => s.updateNpc);
  const remove = useSceneStore((s) => s.removeNpc);

  return (
    <div>
      <div style={{ ...styles.row, marginBottom: 12 }}>
        <span style={{ ...styles.label, flex: 1 }}>NPC</span>
        <button style={styles.btnDanger} onClick={() => remove(npc.id)}>Remove</button>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Name</span>
        <input
          type="text"
          value={npc.name}
          onChange={(e) => update(npc.id, { name: e.target.value })}
          style={styles.input}
        />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Position</span>
        <Vec3Input value={npc.position} onChange={(v) => update(npc.id, { position: v })} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Facing</span>
        <select
          style={styles.select}
          value={npc.facing}
          onChange={(e) => update(npc.id, { facing: e.target.value })}
        >
          {facings.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Character ID</span>
        <input
          type="text"
          value={npc.character_id}
          onChange={(e) => update(npc.id, { character_id: e.target.value })}
          style={styles.input}
        />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Patrol</span>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 50 }}>Interval</span>
          <NumberInput
            step={0.1}
            value={npc.patrol_interval}
            onChange={(v) => update(npc.id, { patrol_interval: v })}
            style={styles.input}
          />
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 50 }}>Speed</span>
          <NumberInput
            step={0.1}
            value={npc.patrol_speed}
            onChange={(v) => update(npc.id, { patrol_speed: v })}
            style={styles.input}
          />
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Dialog ({npc.dialog.length} entries)</span>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Waypoints ({npc.waypoints.length})</span>
      </div>
    </div>
  );
}

function PortalProperties({ portal }: { portal: PortalData }) {
  const update = useSceneStore((s) => s.updatePortal);
  const remove = useSceneStore((s) => s.removePortal);

  return (
    <div>
      <div style={{ ...styles.row, marginBottom: 12 }}>
        <span style={{ ...styles.label, flex: 1 }}>Portal</span>
        <button style={styles.btnDanger} onClick={() => remove(portal.id)}>Remove</button>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Position</span>
        <div style={styles.row}>
          <NumberInput
            label="X"
            value={portal.position[0]}
            onChange={(v) => update(portal.id, { position: [v, portal.position[1]] })}
            style={styles.input}
          />
          <NumberInput
            label="Z"
            value={portal.position[1]}
            onChange={(v) => update(portal.id, { position: [portal.position[0], v] })}
            style={styles.input}
          />
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Size</span>
        <div style={styles.row}>
          <NumberInput
            label="W"
            value={portal.size[0]}
            onChange={(v) => update(portal.id, { size: [v, portal.size[1]] })}
            style={styles.input}
          />
          <NumberInput
            label="H"
            value={portal.size[1]}
            onChange={(v) => update(portal.id, { size: [portal.size[0], v] })}
            style={styles.input}
          />
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Target Scene</span>
        <input
          type="text"
          value={portal.target_scene}
          onChange={(e) => update(portal.id, { target_scene: e.target.value })}
          style={styles.input}
          placeholder="scene name"
        />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Spawn Position</span>
        <Vec3Input
          value={portal.spawn_position}
          onChange={(v) => update(portal.id, { spawn_position: v })}
        />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Spawn Facing</span>
        <select
          style={styles.select}
          value={portal.spawn_facing}
          onChange={(e) => update(portal.id, { spawn_facing: e.target.value })}
        >
          {facings.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
    </div>
  );
}

function PlayerProperties({ player }: { player: PlayerData }) {
  const update = useSceneStore((s) => s.updatePlayer);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <span style={styles.label}>Player Spawn</span>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Position</span>
        <Vec3Input value={player.position} onChange={(v) => update({ position: v })} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Facing</span>
        <select
          style={styles.select}
          value={player.facing}
          onChange={(e) => update({ facing: e.target.value })}
        >
          {facings.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Character ID</span>
        <input
          type="text"
          value={player.character_id}
          onChange={(e) => update({ character_id: e.target.value })}
          style={styles.input}
        />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Tint</span>
        <input
          type="color"
          value={'#' + player.tint.slice(0, 3).map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}
          onChange={(e) => {
            const hex = e.target.value;
            update({
              tint: [
                parseInt(hex.slice(1, 3), 16) / 255,
                parseInt(hex.slice(3, 5), 16) / 255,
                parseInt(hex.slice(5, 7), 16) / 255,
                player.tint[3],
              ],
            });
          }}
          style={{ width: 40, height: 24, border: 'none', cursor: 'pointer' }}
        />
      </div>
    </div>
  );
}

// ── Main component ──

export function ScenePropertiesPanel() {
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const placedObjects = useSceneStore((s) => s.placedObjects);
  const staticLights = useSceneStore((s) => s.staticLights);
  const npcs = useSceneStore((s) => s.npcs);
  const portals = useSceneStore((s) => s.portals);
  const player = useSceneStore((s) => s.player);

  if (!selectedEntity) {
    return <div style={styles.empty}>Select an entity in the scene tree</div>;
  }

  if (selectedEntity.type === 'object') {
    const obj = placedObjects.find((o) => o.id === selectedEntity.id);
    if (!obj) return <div style={styles.empty}>Object not found</div>;
    return <ObjectProperties obj={obj} />;
  }

  if (selectedEntity.type === 'light') {
    const light = staticLights.find((l) => l.id === selectedEntity.id);
    if (!light) return <div style={styles.empty}>Light not found</div>;
    return <LightProperties light={light} />;
  }

  if (selectedEntity.type === 'npc') {
    const npc = npcs.find((n) => n.id === selectedEntity.id);
    if (!npc) return <div style={styles.empty}>NPC not found</div>;
    return <NpcProperties npc={npc} />;
  }

  if (selectedEntity.type === 'portal') {
    const portal = portals.find((p) => p.id === selectedEntity.id);
    if (!portal) return <div style={styles.empty}>Portal not found</div>;
    return <PortalProperties portal={portal} />;
  }

  if (selectedEntity.type === 'player') {
    return <PlayerProperties player={player} />;
  }

  return <div style={styles.empty}>Unknown entity type</div>;
}
