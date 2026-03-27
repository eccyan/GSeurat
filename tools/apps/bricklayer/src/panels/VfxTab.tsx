import React from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type { EmitterConfig } from '../store/types.js';
import { panelStyles } from '../styles/panel.js';

const styles = { ...panelStyles };

function EmitterEditor({
  label,
  emitter,
  onChange,
}: {
  label: string;
  emitter: EmitterConfig;
  onChange: (e: EmitterConfig) => void;
}) {
  return (
    <div style={styles.section}>
      <span style={styles.label}>{label}</span>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 80 }}>Spawn Rate</span>
        <NumberInput
          value={emitter.spawn_rate}
          onChange={(v) => onChange({ ...emitter, spawn_rate: v })}
          style={styles.input}
        />
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 80 }}>Lifetime</span>
        <NumberInput
          step={0.1}
          value={emitter.particle_lifetime_min}
          onChange={(v) => onChange({ ...emitter, particle_lifetime_min: v })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
        <span style={{ fontSize: 12 }}>-</span>
        <NumberInput
          step={0.1}
          value={emitter.particle_lifetime_max}
          onChange={(v) => onChange({ ...emitter, particle_lifetime_max: v })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 80 }}>Size</span>
        <NumberInput
          step={0.1}
          value={emitter.size_min}
          onChange={(v) => onChange({ ...emitter, size_min: v })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
        <span style={{ fontSize: 12 }}>-</span>
        <NumberInput
          step={0.1}
          value={emitter.size_max}
          onChange={(v) => onChange({ ...emitter, size_max: v })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 80 }}>End Scale</span>
        <NumberInput
          step={0.1}
          value={emitter.size_end_scale}
          onChange={(v) => onChange({ ...emitter, size_end_scale: v })}
          style={styles.input}
        />
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 80 }}>Tile</span>
        <input
          type="text"
          value={emitter.tile}
          onChange={(e) => onChange({ ...emitter, tile: e.target.value })}
          style={styles.input}
        />
      </div>
    </div>
  );
}

export function VfxTab() {
  const torchEmitter = useSceneStore((s) => s.torchEmitter);
  const setTorchEmitter = useSceneStore((s) => s.setTorchEmitter);
  const torchPositions = useSceneStore((s) => s.torchPositions);
  const addTorchPosition = useSceneStore((s) => s.addTorchPosition);
  const removeTorchPosition = useSceneStore((s) => s.removeTorchPosition);
  const footstepEmitter = useSceneStore((s) => s.footstepEmitter);
  const setFootstepEmitter = useSceneStore((s) => s.setFootstepEmitter);
  const npcAuraEmitter = useSceneStore((s) => s.npcAuraEmitter);
  const setNpcAuraEmitter = useSceneStore((s) => s.setNpcAuraEmitter);

  return (
    <div>
      <EmitterEditor label="Torch Emitter" emitter={torchEmitter} onChange={setTorchEmitter} />

      <div style={styles.section}>
        <div style={{ ...styles.row, marginBottom: 4 }}>
          <span style={{ ...styles.label, flex: 1 }}>Torch Positions ({torchPositions.length})</span>
          <button style={styles.btn} onClick={() => addTorchPosition([0, 0])}>+ Add</button>
        </div>
        {torchPositions.map(([x, z], i) => (
          <div key={i} style={styles.row}>
            <NumberInput
              value={x}
              onChange={(v) => {
                const next = [...torchPositions] as [number, number][];
                next[i] = [v, z];
                useSceneStore.getState().setTorchPositions(next);
              }}
              style={{ ...styles.input, maxWidth: 60 }}
            />
            <NumberInput
              value={z}
              onChange={(v) => {
                const next = [...torchPositions] as [number, number][];
                next[i] = [x, v];
                useSceneStore.getState().setTorchPositions(next);
              }}
              style={{ ...styles.input, maxWidth: 60 }}
            />
            <button style={styles.btnDanger} onClick={() => removeTorchPosition(i)}>X</button>
          </div>
        ))}
      </div>

      <EmitterEditor label="Footstep Emitter" emitter={footstepEmitter} onChange={setFootstepEmitter} />
      <EmitterEditor label="NPC Aura Emitter" emitter={npcAuraEmitter} onChange={setNpcAuraEmitter} />
    </div>
  );
}
