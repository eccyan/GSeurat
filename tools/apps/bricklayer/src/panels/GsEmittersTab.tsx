import React from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type { GsParticleEmitterData } from '../store/types.js';

const PRESETS: Record<string, Partial<GsParticleEmitterData>> = {
  dust_puff: {
    spawn_rate: 120, lifetime_min: 1, lifetime_max: 2.5,
    velocity_min: [-3, 1, -3], velocity_max: [3, 5, 3],
    acceleration: [0, -2, 0],
    color_start: [0.6, 0.55, 0.45], color_end: [0.5, 0.48, 0.4],
    scale_min: [0.1, 0.1, 0.1], scale_max: [0.3, 0.3, 0.3],
    scale_end_factor: 0.1, opacity_start: 0.4, opacity_end: 0, emission: 0,
    spawn_offset_min: [-2, 0, -2], spawn_offset_max: [2, 1, 2],
  },
  spark_shower: {
    spawn_rate: 40, lifetime_min: 0.3, lifetime_max: 0.8,
    velocity_min: [-4, 8, -4], velocity_max: [4, 15, 4],
    acceleration: [0, -15, 0],
    color_start: [0.8, 0.6, 0.3], color_end: [0.5, 0.2, 0],
    scale_min: [0.05, 0.05, 0.05], scale_max: [0.15, 0.15, 0.15],
    scale_end_factor: 0, opacity_start: 0.5, opacity_end: 0, emission: 0.8,
    spawn_offset_min: [-1, 0, -1], spawn_offset_max: [1, 1, 1],
  },
  magic_spiral: {
    spawn_rate: 50, lifetime_min: 1.5, lifetime_max: 3,
    velocity_min: [-2, 3, -2], velocity_max: [2, 6, 2],
    acceleration: [0, 0.5, 0],
    color_start: [0.4, 0.6, 1], color_end: [0.8, 0.3, 1],
    scale_min: [0.5, 0.5, 0.5], scale_max: [1, 1, 1],
    scale_end_factor: 0.3, opacity_start: 0.9, opacity_end: 0, emission: 0,
    spawn_offset_min: [-1, -0.5, -1], spawn_offset_max: [1, 0.5, 1],
  },
};

const styles: Record<string, React.CSSProperties> = {
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  input: {
    flex: 1, padding: '4px 6px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 13,
  },
  btn: {
    padding: '4px 10px', border: '1px solid #555', borderRadius: 4,
    background: '#3a3a6a', color: '#ddd', cursor: 'pointer', fontSize: 12,
  },
  btnDanger: {
    padding: '4px 10px', border: '1px solid #c33', borderRadius: 4,
    background: '#4a2020', color: '#faa', cursor: 'pointer', fontSize: 12,
  },
  item: {
    padding: 8, border: '1px solid #444', borderRadius: 4, background: '#22223a',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  itemSelected: { borderColor: '#77f' },
  select: {
    flex: 1, padding: '4px 6px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 13,
  },
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

function Vec3Input({ label, value, onChange, style }: {
  label: string;
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
  style: React.CSSProperties;
}) {
  return (
    <div style={styles.row}>
      <span style={{ fontSize: 12, minWidth: 70 }}>{label}</span>
      <NumberInput value={value[0]} onChange={(v) => onChange([v, value[1], value[2]])} step={0.1} style={style} />
      <NumberInput value={value[1]} onChange={(v) => onChange([value[0], v, value[2]])} step={0.1} style={style} />
      <NumberInput value={value[2]} onChange={(v) => onChange([value[0], value[1], v])} step={0.1} style={style} />
    </div>
  );
}

function EmitterEditor({ emitter }: { emitter: GsParticleEmitterData }) {
  const updateGsEmitter = useSceneStore((s) => s.updateGsEmitter);
  const removeGsEmitter = useSceneStore((s) => s.removeGsEmitter);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  const isSelected = selectedEntity?.type === 'gs_emitter' && selectedEntity.id === emitter.id;

  const applyPreset = (name: string) => {
    const preset = PRESETS[name];
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
      <Vec3Input label="Offset Min" value={emitter.spawn_offset_min}
        onChange={(v) => updateGsEmitter(emitter.id, { spawn_offset_min: v })} style={styles.input} />
      <Vec3Input label="Offset Max" value={emitter.spawn_offset_max}
        onChange={(v) => updateGsEmitter(emitter.id, { spawn_offset_max: v })} style={styles.input} />

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
