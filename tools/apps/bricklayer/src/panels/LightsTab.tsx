import React from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type { StaticLight } from '../store/types.js';
import { panelStyles } from '../styles/panel.js';

const styles = { ...panelStyles };

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
        <span style={{ fontSize: 12, minWidth: 60 }}>Pos</span>
        <NumberInput
          label="X"
          value={light.position[0]}
          onChange={(v) => updateLight(light.id, { position: [v, light.position[1], light.position[2]] })}
          style={styles.input}
        />
        <NumberInput
          label="Y"
          value={light.position[1]}
          onChange={(v) => updateLight(light.id, { position: [light.position[0], v, light.position[2]] })}
          style={styles.input}
        />
        <NumberInput
          label="Z"
          value={light.position[2]}
          onChange={(v) => updateLight(light.id, { position: [light.position[0], light.position[1], v] })}
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
