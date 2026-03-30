import React from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { Vec3Input } from '../components/Vec3Input.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type { GsParticleEmitterData } from '../store/types.js';
import { emitterPresets } from '../data/emitterPresets.js';
import { panelStyles } from '../styles/panel.js';

const styles: Record<string, React.CSSProperties> = {
  ...panelStyles,
  sectionLabel: { fontSize: 10, color: '#666', marginTop: 4 },
};

function rgbToHex(c: [number, number, number]): string {
  return '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

function EmitterEditor({ emitter }: { emitter: GsParticleEmitterData }) {
  const updateGsEmitter = useSceneStore((s) => s.updateGsEmitter);
  const removeGsEmitter = useSceneStore((s) => s.removeGsEmitter);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  const isSelected = selectedEntity?.type === 'gs_emitter' && selectedEntity.id === emitter.id;

  const applyPreset = (name: string) => {
    const preset = emitterPresets[name];
    if (preset) {
      updateGsEmitter(emitter.id, { ...preset, preset: name });
    } else {
      updateGsEmitter(emitter.id, { preset: '' });
    }
  };

  return (
    <div
      style={{ ...styles.item, ...(isSelected ? styles.itemSelected : {}) }}
      onClick={() => setSelectedEntity({ type: 'gs_emitter', id: emitter.id })}
    >
      <div style={styles.row}>
        <span style={{ fontSize: 13, flex: 1 }}>Emitter</span>
        <button style={styles.btnDanger} onClick={(e) => { e.stopPropagation(); removeGsEmitter(emitter.id); }}>
          Remove
        </button>
      </div>

      {/* Preset */}
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 70 }}>Preset</span>
        <select style={styles.select} value={emitter.preset} onChange={(e) => applyPreset(e.target.value)}>
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

      {/* Position */}
      <Vec3Input label="Position" value={emitter.position}
        onChange={(v) => updateGsEmitter(emitter.id, { position: v })} style={styles.input} />

      {/* Spawn */}
      <span style={styles.sectionLabel}>Spawn</span>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 70 }}>Rate</span>
        <NumberInput value={emitter.spawn_rate} min={0} step={1}
          onChange={(v) => updateGsEmitter(emitter.id, { spawn_rate: v })} style={styles.input} />
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 70 }}>Life</span>
        <NumberInput value={emitter.lifetime_min} min={0} step={0.1}
          onChange={(v) => updateGsEmitter(emitter.id, { lifetime_min: v })} style={styles.input} />
        <NumberInput value={emitter.lifetime_max} min={0} step={0.1}
          onChange={(v) => updateGsEmitter(emitter.id, { lifetime_max: v })} style={styles.input} />
      </div>
      {/* Spawn Region */}
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 70 }}>Region</span>
        <select style={styles.select}
          value={emitter.spawn_region?.shape ?? 'sphere'}
          onChange={(e) => updateGsEmitter(emitter.id, {
            spawn_region: { ...emitter.spawn_region, shape: e.target.value },
          })}>
          <option value="sphere">Sphere</option>
          <option value="box">Box</option>
        </select>
      </div>
      <Vec3Input label="Center" value={emitter.spawn_region?.center ?? [0, 0, 0]}
        onChange={(v) => updateGsEmitter(emitter.id, {
          spawn_region: { ...emitter.spawn_region, center: v },
        })} style={styles.input} />
      {(emitter.spawn_region?.shape ?? 'sphere') === 'sphere' ? (
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 70 }}>Radius</span>
          <NumberInput value={emitter.spawn_region?.radius ?? 1} min={0} step={0.5}
            onChange={(v) => updateGsEmitter(emitter.id, {
              spawn_region: { ...emitter.spawn_region, radius: v },
            })} style={styles.input} />
        </div>
      ) : (
        <Vec3Input label="Extents" value={emitter.spawn_region?.half_extents ?? [1, 1, 1]}
          onChange={(v) => updateGsEmitter(emitter.id, {
            spawn_region: { ...emitter.spawn_region, half_extents: v },
          })} style={styles.input} />
      )}

      {/* Motion */}
      <span style={styles.sectionLabel}>Motion</span>
      <Vec3Input label="Vel Min" value={emitter.velocity_min}
        onChange={(v) => updateGsEmitter(emitter.id, { velocity_min: v })} style={styles.input} />
      <Vec3Input label="Vel Max" value={emitter.velocity_max}
        onChange={(v) => updateGsEmitter(emitter.id, { velocity_max: v })} style={styles.input} />
      <Vec3Input label="Accel" value={emitter.acceleration}
        onChange={(v) => updateGsEmitter(emitter.id, { acceleration: v })} style={styles.input} />

      {/* Appearance */}
      <span style={styles.sectionLabel}>Appearance</span>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 70 }}>Color Start</span>
        <input type="color" value={rgbToHex(emitter.color_start)}
          onChange={(e) => updateGsEmitter(emitter.id, { color_start: hexToRgb(e.target.value) })} />
        <span style={{ fontSize: 12, minWidth: 50 }}>End</span>
        <input type="color" value={rgbToHex(emitter.color_end)}
          onChange={(e) => updateGsEmitter(emitter.id, { color_end: hexToRgb(e.target.value) })} />
      </div>
      <Vec3Input label="Scale Min" value={emitter.scale_min}
        onChange={(v) => updateGsEmitter(emitter.id, { scale_min: v })} style={styles.input} />
      <Vec3Input label="Scale Max" value={emitter.scale_max}
        onChange={(v) => updateGsEmitter(emitter.id, { scale_max: v })} style={styles.input} />
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 70 }}>Scale End</span>
        <NumberInput value={emitter.scale_end_factor} min={0} max={1} step={0.05}
          onChange={(v) => updateGsEmitter(emitter.id, { scale_end_factor: v })} style={styles.input} />
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 70 }}>Opacity</span>
        <NumberInput value={emitter.opacity_start} min={0} max={1} step={0.05}
          onChange={(v) => updateGsEmitter(emitter.id, { opacity_start: v })} style={styles.input} />
        <NumberInput value={emitter.opacity_end} min={0} max={1} step={0.05}
          onChange={(v) => updateGsEmitter(emitter.id, { opacity_end: v })} style={styles.input} />
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 70 }}>Emission</span>
        <NumberInput value={emitter.emission} min={0} step={0.1}
          onChange={(v) => updateGsEmitter(emitter.id, { emission: v })} style={styles.input} />
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 70 }}>Burst Dur</span>
        <NumberInput value={emitter.burst_duration} min={0} step={0.1}
          onChange={(v) => updateGsEmitter(emitter.id, { burst_duration: v })} style={styles.input} />
      </div>
    </div>
  );
}

export function GsEmittersTab() {
  const emitters = useSceneStore((s) => s.gsParticleEmitters);
  const addGsEmitter = useSceneStore((s) => s.addGsEmitter);

  return (
    <div>
      <div style={{ ...styles.row, marginBottom: 12 }}>
        <span style={{ ...styles.label, flex: 1 }}>GS Particle Emitters ({emitters.length})</span>
        <button style={styles.btn} onClick={() => addGsEmitter()}>+ Add</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {emitters.map((e) => <EmitterEditor key={e.id} emitter={e} />)}
      </div>
    </div>
  );
}
