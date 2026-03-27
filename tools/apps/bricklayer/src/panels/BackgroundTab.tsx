import React from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type { BackgroundLayer } from '../store/types.js';
import { panelStyles } from '../styles/panel.js';

const styles = { ...panelStyles };

function LayerEditor({ layer }: { layer: BackgroundLayer }) {
  const updateLayer = useSceneStore((s) => s.updateBackgroundLayer);
  const removeLayer = useSceneStore((s) => s.removeBackgroundLayer);

  return (
    <div style={styles.item}>
      <div style={styles.row}>
        <input
          type="text"
          value={layer.texture}
          onChange={(e) => updateLayer(layer.id, { texture: e.target.value })}
          style={{ ...styles.input, fontWeight: 600 }}
          placeholder="texture name"
        />
        <button style={styles.btnDanger} onClick={() => removeLayer(layer.id)}>Remove</button>
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 60 }}>Z</span>
        <NumberInput
          step={0.1}
          value={layer.z}
          onChange={(v) => updateLayer(layer.id, { z: v })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
        <NumberInput
          label="Parallax"
          step={0.1}
          value={layer.parallax_factor}
          onChange={(v) => updateLayer(layer.id, { parallax_factor: v })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 60 }}>Size</span>
        <NumberInput
          value={layer.quad_width}
          onChange={(v) => updateLayer(layer.id, { quad_width: v })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
        <span style={{ fontSize: 11 }}>x</span>
        <NumberInput
          value={layer.quad_height}
          onChange={(v) => updateLayer(layer.id, { quad_height: v })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 60 }}>UV Rep</span>
        <NumberInput
          step={0.1}
          value={layer.uv_repeat_x}
          onChange={(v) => updateLayer(layer.id, { uv_repeat_x: v })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
        <span style={{ fontSize: 11 }}>x</span>
        <NumberInput
          step={0.1}
          value={layer.uv_repeat_y}
          onChange={(v) => updateLayer(layer.id, { uv_repeat_y: v })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
      </div>
      <label style={{ ...styles.row, fontSize: 13, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={layer.wall}
          onChange={(e) => updateLayer(layer.id, { wall: e.target.checked })}
        />
        Wall Mode
        {layer.wall && (
          <NumberInput
            step={0.1}
            value={layer.wall_y_offset}
            onChange={(v) => updateLayer(layer.id, { wall_y_offset: v })}
            style={{ ...styles.input, maxWidth: 60 }}
          />
        )}
      </label>
    </div>
  );
}

export function BackgroundTab() {
  const layers = useSceneStore((s) => s.backgroundLayers);
  const addLayer = useSceneStore((s) => s.addBackgroundLayer);

  return (
    <div>
      <div style={{ ...styles.row, marginBottom: 12 }}>
        <span style={{ ...styles.label, flex: 1 }}>Layers ({layers.length})</span>
        <button style={styles.btn} onClick={addLayer}>+ Add</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {layers.map((l) => <LayerEditor key={l.id} layer={l} />)}
      </div>
    </div>
  );
}
