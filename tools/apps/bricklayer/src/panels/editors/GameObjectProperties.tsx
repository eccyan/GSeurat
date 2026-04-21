import React from 'react';
import { NumberInput } from '../../components/NumberInput.js';
import { Vec3Input } from '../../components/Vec3Input.js';
import { useSceneStore } from '../../store/useSceneStore.js';
import type { GameObjectData, PbdConfig } from '../../store/types.js';
import { panelStyles } from '../../styles/panel.js';
import { ComponentEditor } from './ComponentEditor.js';
import { EntityHeader } from './EntityHeader.js';
import { TransformFields } from './TransformFields.js';

const styles = { ...panelStyles };

const defaultPbdConfig: PbdConfig = {
  mode: 'wind_sway',
  sway_threshold: 0.7,
  wind_direction: [1, 0, 0],
  wind_strength: 0.06,
  wind_frequency: 0.8,
  gravity: [0, -9.8, 0],
  damping: 0.98,
  ground_y: -1000,
  bounce: 0.3,
  pinned: false,
  constraints: [],
};

export function GameObjectProperties({ obj }: { obj: GameObjectData }) {
  const update = useSceneStore((s) => s.updateGameObject);
  const remove = useSceneStore((s) => s.removeGameObject);
  const componentSchemas = useSceneStore((s) => s.componentSchemas);

  const attachedNames = Object.keys(obj.components);
  const availableSchemas = componentSchemas.filter((s) => !attachedNames.includes(s.name));

  return (
    <div>
      <EntityHeader label="Game Object" onRemove={() => remove(obj.id)} />

      <div style={styles.section}>
        <span style={styles.label}>Name</span>
        <input
          type="text"
          value={obj.name}
          onChange={(e) => update(obj.id, { name: e.target.value })}
          style={styles.input}
        />
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

      <TransformFields
        position={obj.position}
        onPositionChange={(v) => update(obj.id, { position: v })}
        rotation={obj.rotation}
        onRotationChange={(v) => update(obj.id, { rotation: v })}
      />

      <div style={styles.section}>
        <span style={styles.label}>Scale</span>
        <NumberInput
          step={0.1}
          value={obj.scale}
          onChange={(v) => update(obj.id, { scale: v })}
          style={{ ...styles.input, maxWidth: 80 }}
        />
      </div>

      {/* PBD Physics */}
      {obj.ply_file && (
        <div style={{ ...styles.section, marginTop: 16 }}>
          <div style={{ ...styles.row, marginBottom: 8 }}>
            <span style={{ ...styles.label, flex: 1 }}>PBD Physics</span>
            <select
              style={{ ...styles.select, maxWidth: 120 }}
              value={obj.pbd?.mode ?? 'none'}
              onChange={(e) => {
                const mode = e.target.value;
                if (mode === 'none') {
                  update(obj.id, { pbd: undefined });
                } else {
                  update(obj.id, {
                    pbd: { ...defaultPbdConfig, mode: mode as 'wind_sway' | 'physics' },
                  });
                }
              }}
            >
              <option value="none">None</option>
              <option value="wind_sway">Wind Sway</option>
              <option value="physics">Physics</option>
            </select>
          </div>

          {obj.pbd?.mode === 'wind_sway' && (
            <>
              <div style={styles.section}>
                <span style={styles.label}>Sway Threshold</span>
                <NumberInput
                  step={0.05}
                  value={obj.pbd.sway_threshold}
                  onChange={(v) => update(obj.id, { pbd: { ...obj.pbd!, sway_threshold: v } })}
                  style={{ ...styles.input, maxWidth: 80 }}
                />
              </div>
              <div style={styles.section}>
                <span style={styles.label}>Wind Direction</span>
                <Vec3Input
                  value={obj.pbd.wind_direction}
                  onChange={(v) => update(obj.id, { pbd: { ...obj.pbd!, wind_direction: v } })}
                />
              </div>
              <div style={styles.section}>
                <span style={styles.label}>Wind Strength</span>
                <NumberInput
                  step={0.01}
                  value={obj.pbd.wind_strength}
                  onChange={(v) => update(obj.id, { pbd: { ...obj.pbd!, wind_strength: v } })}
                  style={{ ...styles.input, maxWidth: 80 }}
                />
              </div>
              <div style={styles.section}>
                <span style={styles.label}>Wind Frequency</span>
                <NumberInput
                  step={0.1}
                  value={obj.pbd.wind_frequency}
                  onChange={(v) => update(obj.id, { pbd: { ...obj.pbd!, wind_frequency: v } })}
                  style={{ ...styles.input, maxWidth: 80 }}
                />
              </div>
            </>
          )}

          {obj.pbd?.mode === 'physics' && (
            <>
              <div style={styles.section}>
                <span style={styles.label}>Gravity</span>
                <Vec3Input
                  value={obj.pbd.gravity}
                  onChange={(v) => update(obj.id, { pbd: { ...obj.pbd!, gravity: v } })}
                />
              </div>
              <div style={styles.section}>
                <span style={styles.label}>Damping</span>
                <NumberInput
                  step={0.01}
                  value={obj.pbd.damping}
                  onChange={(v) => update(obj.id, { pbd: { ...obj.pbd!, damping: v } })}
                  style={{ ...styles.input, maxWidth: 80 }}
                />
              </div>
              <div style={styles.section}>
                <span style={styles.label}>Ground Y</span>
                <NumberInput
                  step={1}
                  value={obj.pbd.ground_y}
                  onChange={(v) => update(obj.id, { pbd: { ...obj.pbd!, ground_y: v } })}
                  style={{ ...styles.input, maxWidth: 80 }}
                />
              </div>
              <div style={styles.section}>
                <span style={styles.label}>Bounce</span>
                <NumberInput
                  step={0.05}
                  value={obj.pbd.bounce}
                  onChange={(v) => update(obj.id, { pbd: { ...obj.pbd!, bounce: v } })}
                  style={{ ...styles.input, maxWidth: 80 }}
                />
              </div>
              <div style={styles.section}>
                <span style={styles.label}>
                  <input
                    type="checkbox"
                    checked={obj.pbd.pinned}
                    onChange={(e) => update(obj.id, { pbd: { ...obj.pbd!, pinned: e.target.checked } })}
                  />{' '}Pinned
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Components */}
      <div style={{ ...styles.section, marginTop: 16 }}>
        <div style={{ ...styles.row, marginBottom: 8 }}>
          <span style={{ ...styles.label, flex: 1 }}>Components</span>
          {availableSchemas.length > 0 && (
            <select
              style={{ ...styles.select, maxWidth: 140 }}
              value=""
              onChange={(e) => {
                const name = e.target.value;
                if (!name) return;
                const schema = componentSchemas.find((s) => s.name === name);
                if (!schema) return;
                const defaults: Record<string, unknown> = {};
                for (const field of schema.fields) {
                  if (field.default !== undefined) defaults[field.name] = field.default;
                }
                update(obj.id, {
                  components: { ...obj.components, [name]: defaults },
                });
              }}
            >
              <option value="">+ Add Component</option>
              {availableSchemas.map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
          )}
        </div>

        {attachedNames.map((name) => {
          const schema = componentSchemas.find((s) => s.name === name);
          if (!schema) {
            return (
              <div key={name} style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                {name} (no schema)
              </div>
            );
          }
          return (
            <ComponentEditor
              key={name}
              schema={schema}
              data={obj.components[name]}
              onChange={(field, value) => {
                update(obj.id, {
                  components: {
                    ...obj.components,
                    [name]: { ...obj.components[name], [field]: value },
                  },
                });
              }}
              onRemove={() => {
                const { [name]: _, ...rest } = obj.components;
                update(obj.id, { components: rest });
              }}
            />
          );
        })}

        {attachedNames.length === 0 && (
          <span style={{ fontSize: 11, color: '#555' }}>No components attached</span>
        )}
      </div>
    </div>
  );
}
