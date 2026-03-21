import React from 'react';
import { useSceneStore } from '../store/useSceneStore.js';
import type { BackgroundLayer } from '../store/types.js';

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
};

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
        <input
          type="number"
          step={0.1}
          value={layer.z}
          onChange={(e) => updateLayer(layer.id, { z: Number(e.target.value) })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
        <span style={{ fontSize: 12, minWidth: 60 }}>Parallax</span>
        <input
          type="number"
          step={0.1}
          value={layer.parallax_factor}
          onChange={(e) => updateLayer(layer.id, { parallax_factor: Number(e.target.value) })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 60 }}>Size</span>
        <input
          type="number"
          value={layer.quad_width}
          onChange={(e) => updateLayer(layer.id, { quad_width: Number(e.target.value) })}
          style={{ ...styles.input, maxWidth: 60 }}
          placeholder="W"
        />
        <span style={{ fontSize: 11 }}>x</span>
        <input
          type="number"
          value={layer.quad_height}
          onChange={(e) => updateLayer(layer.id, { quad_height: Number(e.target.value) })}
          style={{ ...styles.input, maxWidth: 60 }}
          placeholder="H"
        />
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 60 }}>UV Rep</span>
        <input
          type="number"
          step={0.1}
          value={layer.uv_repeat_x}
          onChange={(e) => updateLayer(layer.id, { uv_repeat_x: Number(e.target.value) })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
        <span style={{ fontSize: 11 }}>x</span>
        <input
          type="number"
          step={0.1}
          value={layer.uv_repeat_y}
          onChange={(e) => updateLayer(layer.id, { uv_repeat_y: Number(e.target.value) })}
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
          <input
            type="number"
            step={0.1}
            value={layer.wall_y_offset}
            onChange={(e) => updateLayer(layer.id, { wall_y_offset: Number(e.target.value) })}
            style={{ ...styles.input, maxWidth: 60 }}
            placeholder="Y offset"
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
