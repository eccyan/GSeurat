import React from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { Vec3Input } from '../components/Vec3Input.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type { StaticLight } from '../store/types.js';
import { panelStyles } from '../styles/panel.js';

const styles: Record<string, React.CSSProperties> = {
  ...panelStyles,
  sectionLabel: { fontSize: 10, color: '#666', marginTop: 4 },
};

type LightType = 'point' | 'spot' | 'area';

function getLightType(light: StaticLight): LightType {
  if ((light.area_width ?? 0) > 0 && (light.area_height ?? 0) > 0) return 'area';
  if ((light.cone_angle ?? 180) < 180) return 'spot';
  return 'point';
}

function LightEditor({ light }: { light: StaticLight }) {
  const updateLight = useSceneStore((s) => s.updateLight);
  const removeLight = useSceneStore((s) => s.removeLight);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);

  const isSelected = selectedEntity?.type === 'light' && selectedEntity.id === light.id;
  const lightType = getLightType(light);

  const setLightType = (type: LightType) => {
    switch (type) {
      case 'point':
        updateLight(light.id, {
          cone_angle: undefined, direction: undefined,
          area_width: undefined, area_height: undefined, area_normal: undefined,
        });
        break;
      case 'spot':
        updateLight(light.id, {
          cone_angle: 45, direction: light.direction ?? [0, -1, 0],
          area_width: undefined, area_height: undefined, area_normal: undefined,
        });
        break;
      case 'area':
        updateLight(light.id, {
          cone_angle: undefined, direction: undefined,
          area_width: light.area_width || 5, area_height: light.area_height || 3,
          area_normal: light.area_normal ?? [0, 0],
        });
        break;
    }
  };

  return (
    <div
      style={{ ...styles.item, ...(isSelected ? styles.itemSelected : {}) }}
      onClick={() => setSelectedEntity({ type: 'light', id: light.id })}
    >
      <div style={styles.row}>
        <span style={{ fontSize: 13, flex: 1 }}>Light</span>
        <select style={{ ...styles.select, width: 70, fontSize: 11 }}
          value={lightType}
          onChange={(e) => setLightType(e.target.value as LightType)}
          onClick={(e) => e.stopPropagation()}>
          <option value="point">Point</option>
          <option value="spot">Spot</option>
          <option value="area">Area</option>
        </select>
        <button style={styles.btnDanger} onClick={(e) => { e.stopPropagation(); removeLight(light.id); }}>
          Remove
        </button>
      </div>

      {/* Position */}
      <Vec3Input label="Position" value={light.position}
        onChange={(v) => updateLight(light.id, { position: v })} style={styles.input} />

      {/* Common */}
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 60 }}>Radius</span>
        <NumberInput step={0.5} value={light.radius}
          onChange={(v) => updateLight(light.id, { radius: v })} style={styles.input} />
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
        <span style={{ fontSize: 12, minWidth: 50 }}>Intensity</span>
        <NumberInput step={0.1} value={light.intensity}
          onChange={(v) => updateLight(light.id, { intensity: v })} style={styles.input} />
      </div>

      {/* Spot light */}
      {lightType === 'spot' && (
        <>
          <span style={styles.sectionLabel}>Spot</span>
          <div style={styles.row}>
            <span style={{ fontSize: 12, minWidth: 60 }}>Cone</span>
            <NumberInput step={5} min={1} max={179}
              value={light.cone_angle ?? 45}
              onChange={(v) => updateLight(light.id, { cone_angle: Math.max(1, Math.min(179, v)) })}
              style={styles.input} />
          </div>
          <Vec3Input label="Direction" value={light.direction ?? [0, -1, 0]}
            onChange={(v) => updateLight(light.id, { direction: v })} style={styles.input} />
        </>
      )}

      {/* Area light */}
      {lightType === 'area' && (
        <>
          <span style={styles.sectionLabel}>Area</span>
          <div style={styles.row}>
            <span style={{ fontSize: 12, minWidth: 60 }}>Size</span>
            <NumberInput label="W" step={0.5} min={0.1}
              value={light.area_width ?? 5}
              onChange={(v) => updateLight(light.id, { area_width: Math.max(0.1, v) })}
              style={styles.input} />
            <NumberInput label="H" step={0.5} min={0.1}
              value={light.area_height ?? 3}
              onChange={(v) => updateLight(light.id, { area_height: Math.max(0.1, v) })}
              style={styles.input} />
          </div>
          <div style={styles.row}>
            <span style={{ fontSize: 12, minWidth: 60 }}>Normal</span>
            <NumberInput label="X" step={0.1}
              value={light.area_normal?.[0] ?? 0}
              onChange={(v) => updateLight(light.id, { area_normal: [v, light.area_normal?.[1] ?? 0] })}
              style={styles.input} />
            <NumberInput label="Z" step={0.1}
              value={light.area_normal?.[1] ?? 0}
              onChange={(v) => updateLight(light.id, { area_normal: [light.area_normal?.[0] ?? 0, v] })}
              style={styles.input} />
          </div>
        </>
      )}
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
