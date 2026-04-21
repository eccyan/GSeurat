import { NumberInput } from '../../components/NumberInput.js';
import { Vec3Input } from '../../components/Vec3Input.js';
import { useSceneStore } from '../../store/useSceneStore.js';
import type { StaticLight } from '../../store/types.js';
import { panelStyles } from '../../styles/panel.js';
import { getLightType } from './utils.js';
import type { LightType } from './utils.js';
import { EntityHeader } from './EntityHeader.js';
import { TransformFields } from './TransformFields.js';

const styles = { ...panelStyles };

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

export function LightProperties({ light }: { light: StaticLight }) {
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
      <EntityHeader label="Light" onRemove={() => remove(light.id)} />

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
      <TransformFields
        position={light.position}
        onPositionChange={(v) => update(light.id, { position: v })}
      />

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
