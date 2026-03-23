import React from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type { StaticLight } from '../store/types.js';

const styles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
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
  itemSelected: {
    borderColor: '#77f',
  },
};

function LightEditor({ light }: { light: StaticLight }) {
  const updateLight = useSceneStore((s) => s.updateLight);
  const removeLight = useSceneStore((s) => s.removeLight);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  const isSelected = selectedEntity?.type === 'light' && selectedEntity.id === light.id;

  return (
    <div
      style={{ ...styles.item, ...(isSelected ? styles.itemSelected : {}) }}
      onClick={() => setSelectedEntity({ type: 'light', id: light.id })}
    >
      <div style={styles.row}>
        <span style={{ fontSize: 13, flex: 1 }}>Light</span>
        <button style={styles.btnDanger} onClick={(e) => { e.stopPropagation(); removeLight(light.id); }}>
          Remove
        </button>
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 60 }}>Pos X</span>
        <NumberInput
          value={light.position[0]}
          onChange={(v) => updateLight(light.id, { position: [v, light.position[1]] })}
          style={styles.input}
        />
        <NumberInput
          label="Z"
          value={light.position[1]}
          onChange={(v) => updateLight(light.id, { position: [light.position[0], v] })}
          style={styles.input}
        />
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 60 }}>Radius</span>
        <NumberInput
          step={0.5}
          value={light.radius}
          onChange={(v) => updateLight(light.id, { radius: v })}
          style={styles.input}
        />
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 60 }}>Height</span>
        <NumberInput
          step={0.5}
          value={light.height}
          onChange={(v) => updateLight(light.id, { height: v })}
          style={styles.input}
        />
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 60 }}>Color</span>
        <input
          type="color"
          value={'#' + light.color.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}
          onChange={(e) => {
            const hex = e.target.value;
            updateLight(light.id, {
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
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 60 }}>Intensity</span>
        <NumberInput
          step={0.1}
          value={light.intensity}
          onChange={(v) => updateLight(light.id, { intensity: v })}
          style={styles.input}
        />
      </div>
    </div>
  );
}

export function LightsTab() {
  const lights = useSceneStore((s) => s.staticLights);
  const addLight = useSceneStore((s) => s.addLight);

  return (
    <div>
      <div style={{ ...styles.row, marginBottom: 12 }}>
        <span style={{ ...styles.label, flex: 1 }}>Static Lights ({lights.length})</span>
        <button style={styles.btn} onClick={() => addLight()}>+ Add</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lights.map((l) => <LightEditor key={l.id} light={l} />)}
      </div>
    </div>
  );
}
