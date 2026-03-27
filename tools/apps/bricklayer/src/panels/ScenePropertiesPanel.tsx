import React from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { Vec3Input } from '../components/Vec3Input.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type {
  StaticLight,
  NpcData,
  PortalData,
  PlacedObjectData,
  PlayerData,
  GsParticleEmitterData,
  GsAnimationGroupData,
} from '../store/types.js';
import { panelStyles } from '../styles/panel.js';

const styles = { ...panelStyles };

const facings = ['up', 'down', 'left', 'right'];

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

type LightType = 'point' | 'spot' | 'area';

function getLightType(light: StaticLight): LightType {
  if ((light.area_width ?? 0) > 0) return 'area';
  if ((light.cone_angle ?? 180) < 180) return 'spot';
  return 'point';
}

const lightTypeLabels: Record<LightType, string> = {
  point: 'Point Light',
  spot: 'Spot Light',
  area: 'Area Light',
};

const lightTypeDescriptions: Record<LightType, string> = {
  point: 'Emits light equally in all directions, like a light bulb.',
  spot: 'Projects light within a cone, like a flashlight or streetlamp.',
  area: 'Emits light from a rectangular surface, like a window or fluorescent panel.',
};

function LightProperties({ light }: { light: StaticLight }) {
  const update = useSceneStore((s) => s.updateLight);
  const remove = useSceneStore((s) => s.removeLight);
  const lightType = getLightType(light);

  const setLightType = (type: LightType) => {
    switch (type) {
      case 'point':
        update(light.id, {
          cone_angle: undefined, direction: undefined,
          area_width: undefined, area_height: undefined, area_normal: undefined,
        });
        break;
      case 'spot':
        update(light.id, {
          cone_angle: 45, direction: light.direction ?? [0, -1, 0],
          area_width: undefined, area_height: undefined, area_normal: undefined,
        });
        break;
      case 'area':
        update(light.id, {
          cone_angle: undefined, direction: undefined,
          area_width: light.area_width || 5, area_height: light.area_height || 3,
          area_normal: light.area_normal ?? [0, 0],
        });
        break;
    }
  };

  return (
    <div>
      <div style={{ ...styles.row, marginBottom: 12 }}>
        <span style={{ ...styles.label, flex: 1 }}>Light</span>
        <button style={styles.btnDanger} onClick={() => remove(light.id)}>Remove</button>
      </div>

      {/* Type selector */}
      <div style={styles.section}>
        <span style={styles.label}>Type</span>
        <select
          value={lightType}
          onChange={(e) => setLightType(e.target.value as LightType)}
          style={{
            padding: '4px 6px', background: '#2a2a4a', border: '1px solid #444',
            borderRadius: 4, color: '#ddd', fontSize: 13, width: '100%',
          }}
        >
          {(['point', 'spot', 'area'] as LightType[]).map((t) => (
            <option key={t} value={t}>{lightTypeLabels[t]}</option>
          ))}
        </select>
        <span style={{ fontSize: 10, color: '#666', marginTop: 4 }}>
          {lightTypeDescriptions[lightType]}
        </span>
      </div>

      {/* Common fields */}
      <div style={styles.section}>
        <span style={styles.label}>Position</span>
        <Vec3Input
          value={light.position}
          onChange={(v) => update(light.id, { position: v })}
        />
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

      {/* Spot light fields */}
      {lightType === 'spot' && (
        <>
          <div style={styles.section}>
            <span style={styles.label}>Cone Angle</span>
            <NumberInput
              step={5}
              min={1}
              max={179}
              value={light.cone_angle ?? 45}
              onChange={(v) => update(light.id, { cone_angle: Math.max(1, Math.min(179, v)) })}
              style={styles.input}
            />
          </div>
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
        </>
      )}

      {/* Area light fields */}
      {lightType === 'area' && (
        <>
          <div style={styles.section}>
            <span style={styles.label}>Area Size</span>
            <div style={styles.row}>
              <NumberInput
                label="W"
                step={0.5}
                min={0.1}
                value={light.area_width ?? 5}
                onChange={(v) => update(light.id, { area_width: Math.max(0.1, v) })}
                style={styles.input}
              />
              <NumberInput
                label="H"
                step={0.5}
                min={0.1}
                value={light.area_height ?? 3}
                onChange={(v) => update(light.id, { area_height: Math.max(0.1, v) })}
                style={styles.input}
              />
            </div>
          </div>
          <div style={styles.section}>
            <span style={styles.label}>Face Direction</span>
            <div style={styles.row}>
              <NumberInput
                label="X"
                step={0.1}
                value={light.area_normal?.[0] ?? 0}
                onChange={(v) => update(light.id, { area_normal: [v, light.area_normal?.[1] ?? 0] })}
                style={styles.input}
              />
              <NumberInput
                label="Z"
                step={0.1}
                value={light.area_normal?.[1] ?? 0}
                onChange={(v) => update(light.id, { area_normal: [light.area_normal?.[0] ?? 0, v] })}
                style={styles.input}
              />
            </div>
            <span style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
              XZ direction the light panel faces. Leave 0,0 for downward.
            </span>
          </div>
        </>
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
        <Vec3Input
          value={portal.position}
          onChange={(v) => update(portal.id, { position: v })}
        />
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

const GS_PRESETS: Record<string, Partial<GsParticleEmitterData>> = {
  dust_puff: {
    spawn_rate: 120, lifetime_min: 1, lifetime_max: 2.5,
    velocity_min: [-3, 1, -3], velocity_max: [3, 5, 3], acceleration: [0, -2, 0],
    color_start: [0.6, 0.55, 0.45], color_end: [0.5, 0.48, 0.4],
    scale_min: [0.1, 0.1, 0.1], scale_max: [0.3, 0.3, 0.3],
    scale_end_factor: 0.1, opacity_start: 0.4, opacity_end: 0, emission: 0,
    spawn_offset_min: [-2, 0, -2], spawn_offset_max: [2, 1, 2],
  },
  spark_shower: {
    spawn_rate: 40, lifetime_min: 0.3, lifetime_max: 0.8,
    velocity_min: [-4, 8, -4], velocity_max: [4, 15, 4], acceleration: [0, -15, 0],
    color_start: [0.8, 0.6, 0.3], color_end: [0.5, 0.2, 0],
    scale_min: [0.05, 0.05, 0.05], scale_max: [0.15, 0.15, 0.15],
    scale_end_factor: 0, opacity_start: 0.5, opacity_end: 0, emission: 0.8,
    spawn_offset_min: [-1, 0, -1], spawn_offset_max: [1, 1, 1],
  },
  magic_spiral: {
    spawn_rate: 50, lifetime_min: 1.5, lifetime_max: 3,
    velocity_min: [-2, 3, -2], velocity_max: [2, 6, 2], acceleration: [0, 0.5, 0],
    color_start: [0.4, 0.6, 1], color_end: [0.8, 0.3, 1],
    scale_min: [0.5, 0.5, 0.5], scale_max: [1, 1, 1],
    scale_end_factor: 0.3, opacity_start: 0.9, opacity_end: 0, emission: 0,
    spawn_offset_min: [-1, -0.5, -1], spawn_offset_max: [1, 0.5, 1],
  },
  fire: {
    spawn_rate: 80, lifetime_min: 0.4, lifetime_max: 1.2,
    velocity_min: [-1.5, 3, -1.5], velocity_max: [1.5, 8, 1.5], acceleration: [0, 1, 0],
    color_start: [1, 0.6, 0.1], color_end: [0.8, 0.1, 0],
    scale_min: [0.2, 0.2, 0.2], scale_max: [0.5, 0.5, 0.5],
    scale_end_factor: 0, opacity_start: 0.8, opacity_end: 0, emission: 1.5,
    spawn_offset_min: [-0.5, 0, -0.5], spawn_offset_max: [0.5, 0.5, 0.5],
  },
  smoke: {
    spawn_rate: 30, lifetime_min: 2, lifetime_max: 4,
    velocity_min: [-0.5, 1, -0.5], velocity_max: [0.5, 3, 0.5], acceleration: [0, 0.3, 0],
    color_start: [0.4, 0.4, 0.42], color_end: [0.3, 0.3, 0.32],
    scale_min: [0.3, 0.3, 0.3], scale_max: [0.8, 0.8, 0.8],
    scale_end_factor: 2, opacity_start: 0.5, opacity_end: 0, emission: 0,
    spawn_offset_min: [-1, 0, -1], spawn_offset_max: [1, 0.5, 1],
  },
  rain: {
    spawn_rate: 200, lifetime_min: 0.5, lifetime_max: 1,
    velocity_min: [-0.5, -20, -0.5], velocity_max: [0.5, -15, 0.5], acceleration: [0, 0, 0],
    color_start: [0.7, 0.75, 0.9], color_end: [0.5, 0.55, 0.8],
    scale_min: [0.02, 0.15, 0.02], scale_max: [0.03, 0.25, 0.03],
    scale_end_factor: 1, opacity_start: 0.4, opacity_end: 0.1, emission: 0,
    spawn_offset_min: [-15, 10, -15], spawn_offset_max: [15, 15, 15],
  },
  snow: {
    spawn_rate: 60, lifetime_min: 3, lifetime_max: 6,
    velocity_min: [-1, -2, -1], velocity_max: [1, -0.5, 1], acceleration: [0, -0.1, 0],
    color_start: [0.95, 0.95, 1], color_end: [0.9, 0.9, 0.95],
    scale_min: [0.05, 0.05, 0.05], scale_max: [0.15, 0.15, 0.15],
    scale_end_factor: 0.5, opacity_start: 0.7, opacity_end: 0, emission: 0,
    spawn_offset_min: [-12, 8, -12], spawn_offset_max: [12, 12, 12],
  },
  leaves: {
    spawn_rate: 15, lifetime_min: 3, lifetime_max: 6,
    velocity_min: [-2, -1.5, -2], velocity_max: [2, -0.5, 2], acceleration: [0, -0.3, 0],
    color_start: [0.4, 0.6, 0.15], color_end: [0.5, 0.35, 0.1],
    scale_min: [0.1, 0.02, 0.1], scale_max: [0.2, 0.04, 0.2],
    scale_end_factor: 0.8, opacity_start: 0.9, opacity_end: 0.2, emission: 0,
    spawn_offset_min: [-8, 5, -8], spawn_offset_max: [8, 10, 8],
  },
  fireflies: {
    spawn_rate: 8, lifetime_min: 3, lifetime_max: 7,
    velocity_min: [-0.5, -0.3, -0.5], velocity_max: [0.5, 0.5, 0.5], acceleration: [0, 0, 0],
    color_start: [0.8, 1, 0.3], color_end: [0.6, 0.9, 0.2],
    scale_min: [0.03, 0.03, 0.03], scale_max: [0.06, 0.06, 0.06],
    scale_end_factor: 0.5, opacity_start: 0.8, opacity_end: 0, emission: 1,
    spawn_offset_min: [-6, 0.5, -6], spawn_offset_max: [6, 4, 6],
  },
  steam: {
    spawn_rate: 40, lifetime_min: 0.5, lifetime_max: 1.5,
    velocity_min: [-0.8, 2, -0.8], velocity_max: [0.8, 5, 0.8], acceleration: [0, 0.5, 0],
    color_start: [0.9, 0.9, 0.92], color_end: [0.85, 0.85, 0.88],
    scale_min: [0.15, 0.15, 0.15], scale_max: [0.4, 0.4, 0.4],
    scale_end_factor: 2.5, opacity_start: 0.4, opacity_end: 0, emission: 0,
    spawn_offset_min: [-0.5, 0, -0.5], spawn_offset_max: [0.5, 0.3, 0.5],
  },
  waterfall_mist: {
    spawn_rate: 100, lifetime_min: 1, lifetime_max: 2.5,
    velocity_min: [-4, 0.5, -4], velocity_max: [4, 3, 4], acceleration: [0, -1, 0],
    color_start: [0.75, 0.8, 0.95], color_end: [0.7, 0.75, 0.9],
    scale_min: [0.1, 0.1, 0.1], scale_max: [0.3, 0.3, 0.3],
    scale_end_factor: 1.5, opacity_start: 0.35, opacity_end: 0, emission: 0,
    spawn_offset_min: [-3, -0.5, -3], spawn_offset_max: [3, 1, 3],
  },
};

function rgbToHex(c: [number, number, number]): string {
  return '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

function GsEmitterProperties({ emitter }: { emitter: GsParticleEmitterData }) {
  const update = useSceneStore((s) => s.updateGsEmitter);
  const remove = useSceneStore((s) => s.removeGsEmitter);

  const applyPreset = (name: string) => {
    const preset = GS_PRESETS[name];
    if (preset) {
      update(emitter.id, { ...preset, preset: name });
    } else {
      update(emitter.id, { preset: '' });
    }
  };

  return (
    <div>
      <div style={{ ...styles.row, marginBottom: 12 }}>
        <span style={{ ...styles.label, flex: 1 }}>Particle Emitter</span>
        <button style={styles.btnDanger} onClick={() => remove(emitter.id)}>Remove</button>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Preset</span>
        <select
          style={styles.select}
          value={emitter.preset}
          onChange={(e) => applyPreset(e.target.value)}
        >
          <option value="">Custom</option>
          <option value="dust_puff">Dust Puff</option>
          <option value="spark_shower">Spark Shower</option>
          <option value="magic_spiral">Magic Spiral</option>
          <option value="fire">Fire</option>
          <option value="smoke">Smoke</option>
          <option value="rain">Rain</option>
          <option value="snow">Snow</option>
          <option value="leaves">Leaves</option>
          <option value="fireflies">Fireflies</option>
          <option value="steam">Steam</option>
          <option value="waterfall_mist">Waterfall Mist</option>
        </select>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Position</span>
        <Vec3Input value={emitter.position} onChange={(v) => update(emitter.id, { position: v })} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Spawn Rate</span>
        <NumberInput value={emitter.spawn_rate} min={0} step={1}
          onChange={(v) => update(emitter.id, { spawn_rate: v })} style={styles.input} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Lifetime</span>
        <div style={styles.row}>
          <NumberInput label="Min" value={emitter.lifetime_min} min={0} step={0.1}
            onChange={(v) => update(emitter.id, { lifetime_min: v })} style={styles.input} />
          <NumberInput label="Max" value={emitter.lifetime_max} min={0} step={0.1}
            onChange={(v) => update(emitter.id, { lifetime_max: v })} style={styles.input} />
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Velocity Min</span>
        <Vec3Input value={emitter.velocity_min} onChange={(v) => update(emitter.id, { velocity_min: v })} />
      </div>
      <div style={styles.section}>
        <span style={styles.label}>Velocity Max</span>
        <Vec3Input value={emitter.velocity_max} onChange={(v) => update(emitter.id, { velocity_max: v })} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Acceleration</span>
        <Vec3Input value={emitter.acceleration} onChange={(v) => update(emitter.id, { acceleration: v })} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Spawn Offset Min</span>
        <Vec3Input value={emitter.spawn_offset_min} onChange={(v) => update(emitter.id, { spawn_offset_min: v })} />
      </div>
      <div style={styles.section}>
        <span style={styles.label}>Spawn Offset Max</span>
        <Vec3Input value={emitter.spawn_offset_max} onChange={(v) => update(emitter.id, { spawn_offset_max: v })} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Color</span>
        <div style={styles.row}>
          <span style={{ fontSize: 12 }}>Start</span>
          <input type="color" value={rgbToHex(emitter.color_start)}
            onChange={(e) => update(emitter.id, { color_start: hexToRgb(e.target.value) })}
            style={{ width: 40, height: 24, border: 'none', cursor: 'pointer' }} />
          <span style={{ fontSize: 12 }}>End</span>
          <input type="color" value={rgbToHex(emitter.color_end)}
            onChange={(e) => update(emitter.id, { color_end: hexToRgb(e.target.value) })}
            style={{ width: 40, height: 24, border: 'none', cursor: 'pointer' }} />
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Scale Min</span>
        <Vec3Input value={emitter.scale_min} onChange={(v) => update(emitter.id, { scale_min: v })} />
      </div>
      <div style={styles.section}>
        <span style={styles.label}>Scale Max</span>
        <Vec3Input value={emitter.scale_max} onChange={(v) => update(emitter.id, { scale_max: v })} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Scale End Factor</span>
        <NumberInput value={emitter.scale_end_factor} min={0} max={1} step={0.05}
          onChange={(v) => update(emitter.id, { scale_end_factor: v })} style={styles.input} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Opacity</span>
        <div style={styles.row}>
          <NumberInput label="Start" value={emitter.opacity_start} min={0} max={1} step={0.05}
            onChange={(v) => update(emitter.id, { opacity_start: v })} style={styles.input} />
          <NumberInput label="End" value={emitter.opacity_end} min={0} max={1} step={0.05}
            onChange={(v) => update(emitter.id, { opacity_end: v })} style={styles.input} />
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Emission</span>
        <NumberInput value={emitter.emission} min={0} step={0.1}
          onChange={(v) => update(emitter.id, { emission: v })} style={styles.input} />
        <span style={{ fontSize: 10, color: '#666' }}>
          {'> 0 = self-lit (bypasses scene lighting, triggers bloom)'}
        </span>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Burst Duration</span>
        <NumberInput value={emitter.burst_duration} min={0} step={0.1}
          onChange={(v) => update(emitter.id, { burst_duration: v })} style={styles.input} />
        <span style={{ fontSize: 10, color: '#666' }}>0 = continuous loop</span>
      </div>
    </div>
  );
}

const effectOptions = ['detach', 'float', 'orbit', 'dissolve', 'reform', 'pulse', 'vortex', 'wave', 'scatter'];
const effectDescriptions: Record<string, string> = {
  detach: 'Scatter outward with gravity, fade opacity',
  float: 'Drift upward with horizontal noise, shrink',
  orbit: 'Swirl around region center',
  dissolve: 'Shrink to zero, fade opacity',
  reform: 'Restore to original position and color',
  pulse: 'Scale oscillates rhythmically (crystals, magic)',
  vortex: 'Spiral inward/upward, tightening radius (tornado)',
  wave: 'Sinusoidal ripple propagating from center (shockwave)',
  scatter: 'Explosive outward burst (impacts, shattering)',
};

const defaultAnimParams = {
  rotations: 1, rotations_easing: 'linear' as const,
  expansion: 1, expansion_easing: 'linear' as const,
  height_rise: 0, height_easing: 'linear' as const,
  opacity_end: 0, opacity_easing: 'linear' as const,
  scale_end: 0, scale_easing: 'linear' as const,
  velocity: 1, gravity: [0, -9.8, 0] as [number, number, number],
  noise: 1, wave_speed: 5, pulse_frequency: 4,
};

const easingTypes = ['linear', 'quad', 'cubic', 'quart', 'quint', 'sine', 'expo', 'circ', 'back', 'elastic', 'bounce'];
const easingDirs = ['in', 'out', 'in_out'];
const easingDirLabels: Record<string, string> = { in: 'In', out: 'Out', in_out: 'In Out' };

function parseEasing(value: string): { type: string; dir: string } {
  if (value === 'linear') return { type: 'linear', dir: 'in' };
  for (const dir of ['in_out', 'out', 'in']) {
    if (value.startsWith(dir + '_')) return { type: value.slice(dir.length + 1), dir };
  }
  return { type: 'linear', dir: 'in' };
}

function composeEasing(type: string, dir: string): string {
  if (type === 'linear') return 'linear';
  return `${dir}_${type}`;
}

function ParamRow({ label, value, onChange, min, max, step, easing, onEasingChange, hint }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  easing?: string;
  onEasingChange?: (v: string) => void;
  hint?: string;
}) {
  const easingParts = easing ? parseEasing(easing) : null;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 11, minWidth: 60, color: '#aaa' }}>{label}</span>
        {hint && (
          <span style={{
            position: 'relative', fontSize: 9, color: '#666', cursor: 'help', width: 12, height: 12,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid #555', borderRadius: '50%', flexShrink: 0,
          }}
            onMouseEnter={(e) => {
              const tip = e.currentTarget.querySelector('[data-tip]') as HTMLElement;
              if (tip) tip.style.display = 'block';
            }}
            onMouseLeave={(e) => {
              const tip = e.currentTarget.querySelector('[data-tip]') as HTMLElement;
              if (tip) tip.style.display = 'none';
            }}
          >
            ?
            <span data-tip="" style={{
              display: 'none', position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
              marginBottom: 4, padding: '4px 8px', background: '#111', color: '#ccc', fontSize: 10,
              borderRadius: 4, whiteSpace: 'nowrap', zIndex: 100, boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              pointerEvents: 'none',
            }}>{hint}</span>
          </span>
        )}
        <NumberInput value={value} min={min} max={max} step={step ?? 0.1}
          onChange={onChange} style={{ flex: 1, maxWidth: 80, padding: '3px 5px', fontSize: 12 }} />
        {easingParts && onEasingChange && (
          <>
            <select
              style={{ width: 62, padding: '2px 2px', background: '#2a2a4a', border: '1px solid #444', borderRadius: 4, color: '#999', fontSize: 10 }}
              value={easingParts.type}
              onChange={(e) => onEasingChange(composeEasing(e.target.value, easingParts.dir))}
            >
              {easingTypes.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
            {easingParts.type !== 'linear' && (
              <select
                style={{ width: 46, padding: '2px 2px', background: '#2a2a4a', border: '1px solid #444', borderRadius: 4, color: '#999', fontSize: 10 }}
                value={easingParts.dir}
                onChange={(e) => onEasingChange(composeEasing(easingParts.type, e.target.value))}
              >
                {easingDirs.map((d) => <option key={d} value={d}>{easingDirLabels[d]}</option>)}
              </select>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function GsAnimationProperties({ anim }: { anim: GsAnimationGroupData }) {
  const update = useSceneStore((s) => s.updateGsAnimation);
  const remove = useSceneStore((s) => s.removeGsAnimation);

  // Ensure params exists (backward compat with old saved data)
  const params = anim.params ?? defaultAnimParams;

  return (
    <div>
      <div style={{ ...styles.row, marginBottom: 12 }}>
        <span style={{ ...styles.label, flex: 1 }}>GS Animation</span>
        <button style={styles.btnDanger} onClick={() => remove(anim.id)}>Remove</button>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Effect</span>
        <select
          style={styles.select}
          value={anim.effect}
          onChange={(e) => update(anim.id, { effect: e.target.value })}
        >
          {effectOptions.map((e) => <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>)}
        </select>
        <span style={{ fontSize: 10, color: '#666', marginTop: 4 }}>
          {effectDescriptions[anim.effect] ?? ''}
        </span>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Region Shape</span>
        <select
          style={styles.select}
          value={anim.shape}
          onChange={(e) => update(anim.id, { shape: e.target.value })}
        >
          <option value="sphere">Sphere</option>
          <option value="box">Box</option>
        </select>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Center</span>
        <Vec3Input value={anim.center} onChange={(v) => update(anim.id, { center: v })} />
      </div>

      {anim.shape === 'sphere' && (
        <div style={styles.section}>
          <span style={styles.label}>Radius</span>
          <NumberInput value={anim.radius} min={0.1} step={0.5}
            onChange={(v) => update(anim.id, { radius: v })} style={styles.input} />
        </div>
      )}

      {anim.shape === 'box' && (
        <div style={styles.section}>
          <span style={styles.label}>Half Extents</span>
          <Vec3Input value={anim.half_extents} step={0.5}
            onChange={(v) => update(anim.id, { half_extents: v })} />
        </div>
      )}

      <div style={styles.section}>
        <span style={styles.label}>Lifetime (seconds)</span>
        <NumberInput value={anim.lifetime} min={0.1} step={0.5}
          onChange={(v) => update(anim.id, { lifetime: v })} style={styles.input} />
      </div>

      <div style={styles.section}>
        <label style={{ fontSize: 12, color: '#ddd', display: 'flex', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={anim.loop}
            onChange={(e) => update(anim.id, { loop: e.target.checked })}
            style={styles.checkbox}
          />
          Loop (restart when finished)
        </label>
      </div>

      <div style={styles.section}>
        <label style={{ fontSize: 12, color: '#ddd', display: 'flex', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={anim.reform_enabled}
            onChange={(e) => update(anim.id, { reform_enabled: e.target.checked })}
            style={styles.checkbox}
          />
          Reform after effect (restore to original)
        </label>
      </div>

      {anim.reform_enabled && (
        <>
          <div style={styles.section}>
            <span style={styles.label}>Reform Lifetime</span>
            <NumberInput value={anim.reform_lifetime} min={0.1} step={0.5}
              onChange={(v) => update(anim.id, { reform_lifetime: v })} style={styles.input} />
          </div>
        </>
      )}

      <div style={{ marginTop: 8, marginBottom: 4 }}>
        <span style={styles.label}>Parameters</span>
      </div>

      <ParamRow label="Rotations" value={params.rotations} min={0} step={0.5}
        onChange={(v) => update(anim.id, { params: { ...params, rotations: v } })}
        easing={params.rotations_easing}
        onEasingChange={(v) => update(anim.id, { params: { ...params, rotations_easing: v as any } })} />
      <ParamRow label="Expansion" value={params.expansion} min={0} step={0.1}
        onChange={(v) => update(anim.id, { params: { ...params, expansion: v } })}
        easing={params.expansion_easing}
        onEasingChange={(v) => update(anim.id, { params: { ...params, expansion_easing: v as any } })}
        hint="1=none 2=double" />
      <ParamRow label="Height" value={params.height_rise} step={0.5}
        onChange={(v) => update(anim.id, { params: { ...params, height_rise: v } })}
        easing={params.height_easing}
        onEasingChange={(v) => update(anim.id, { params: { ...params, height_easing: v as any } })}
        hint="Y offset (units)" />
      <ParamRow label="Opacity" value={params.opacity_end} min={0} max={1} step={0.05}
        onChange={(v) => update(anim.id, { params: { ...params, opacity_end: v } })}
        easing={params.opacity_easing}
        onEasingChange={(v) => update(anim.id, { params: { ...params, opacity_easing: v as any } })}
        hint="0=gone 1=keep" />
      <ParamRow label="Scale" value={params.scale_end} min={0} max={1} step={0.05}
        onChange={(v) => update(anim.id, { params: { ...params, scale_end: v } })}
        easing={params.scale_easing}
        onEasingChange={(v) => update(anim.id, { params: { ...params, scale_easing: v as any } })}
        hint="0=vanish 1=keep" />
      <ParamRow label="Velocity" value={params.velocity} min={0} step={0.1}
        onChange={(v) => update(anim.id, { params: { ...params, velocity: v } })} />
      <ParamRow label="Noise" value={params.noise} min={0} step={0.1}
        onChange={(v) => update(anim.id, { params: { ...params, noise: v } })} />
      <ParamRow label="Wave Spd" value={params.wave_speed} min={0} step={0.5}
        onChange={(v) => update(anim.id, { params: { ...params, wave_speed: v } })} />
      <ParamRow label="Pulse Hz" value={params.pulse_frequency} min={0.1} step={0.5}
        onChange={(v) => update(anim.id, { params: { ...params, pulse_frequency: v } })} />

      <div style={{ marginTop: 4, marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: '#555' }}>Gravity</span>
      </div>
      <Vec3Input value={params.gravity}
        onChange={(v) => update(anim.id, { params: { ...params, gravity: v } })} />
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
  const gsParticleEmitters = useSceneStore((s) => s.gsParticleEmitters);
  const gsAnimations = useSceneStore((s) => s.gsAnimations);
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

  if (selectedEntity.type === 'gs_emitter') {
    const emitter = gsParticleEmitters.find((e) => e.id === selectedEntity.id);
    if (!emitter) return <div style={styles.empty}>Emitter not found</div>;
    return <GsEmitterProperties emitter={emitter} />;
  }

  if (selectedEntity.type === 'gs_animation') {
    const anim = gsAnimations.find((a) => a.id === selectedEntity.id);
    if (!anim) return <div style={styles.empty}>Animation not found</div>;
    return <GsAnimationProperties anim={anim} />;
  }

  if (selectedEntity.type === 'player') {
    return <PlayerProperties player={player} />;
  }

  return <div style={styles.empty}>Unknown entity type</div>;
}
