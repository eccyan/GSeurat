import React from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { NumberInput } from '../components/NumberInput.js';
import { Vec3Input } from '../components/Vec3Input.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type { CameraZoneTrigger } from '../store/types.js';
import { panelStyles } from '../styles/panel.js';

const styles = { ...panelStyles };

export function CameraTriggerEditor({ trigger }: { trigger: CameraZoneTrigger }) {
  useComponentRegistry('CameraTriggerEditor');
  const updateCameraTrigger = useSceneStore((s) => s.updateCameraTrigger);
  const removeCameraTrigger = useSceneStore((s) => s.removeCameraTrigger);
  const cameraVolumes = useSceneStore((s) => s.cameraVolumes);

  const update = (patch: Partial<CameraZoneTrigger>) => updateCameraTrigger(trigger.id, patch);

  const shapeType = trigger.shape.type;

  return (
    <div>
      <div style={{ ...styles.row, marginBottom: 12 }}>
        <span style={{ ...styles.label, flex: 1 }}>Camera Trigger</span>
        <button style={styles.btnDanger} onClick={() => removeCameraTrigger(trigger.id)}>Remove</button>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Shape Type</span>
        <select
          style={styles.select}
          value={shapeType}
          onChange={(e) => {
            const newType = e.target.value;
            update({
              shape: newType === 'sphere'
                ? { type: 'sphere', center: trigger.shape.center, radius: (trigger.shape as any).radius ?? 5 }
                : { type: 'aabb', center: trigger.shape.center, half_extents: (trigger.shape as any).half_extents ?? [5, 5, 5] },
            });
          }}
        >
          <option value="aabb">AABB</option>
          <option value="sphere">Sphere</option>
        </select>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Center</span>
        <Vec3Input
          value={trigger.shape.center}
          onChange={(v) => update({ shape: { ...trigger.shape, center: v } })}
        />
      </div>

      {shapeType === 'aabb' && (
        <div style={styles.section}>
          <span style={styles.label}>Half Extents</span>
          <Vec3Input
            value={(trigger.shape as any).half_extents ?? [5, 5, 5]}
            onChange={(v) => update({ shape: { ...trigger.shape, half_extents: v } as any })}
          />
        </div>
      )}

      {shapeType === 'sphere' && (
        <div style={styles.section}>
          <span style={styles.label}>Radius</span>
          <NumberInput
            value={(trigger.shape as any).radius ?? 5}
            min={0.1}
            step={0.5}
            onChange={(v) => update({ shape: { ...trigger.shape, radius: v } as any })}
            style={styles.input}
          />
        </div>
      )}

      <div style={styles.section}>
        <span style={styles.label}>From Zone</span>
        <select
          style={styles.select}
          value={trigger.from_zone ?? ''}
          onChange={(e) => update({ from_zone: e.target.value || undefined })}
        >
          <option value="">Any</option>
          {cameraVolumes.map((v) => (
            <option key={v.id} value={v.id}>{v.name || v.id}</option>
          ))}
        </select>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>To Zone</span>
        <select
          style={styles.select}
          value={trigger.to_zone}
          onChange={(e) => update({ to_zone: e.target.value })}
        >
          <option value="">(none)</option>
          {cameraVolumes.map((v) => (
            <option key={v.id} value={v.id}>{v.name || v.id}</option>
          ))}
        </select>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Blend Override</span>
        <NumberInput
          value={trigger.blend_override}
          step={0.1}
          onChange={(v) => update({ blend_override: v })}
          style={styles.input}
        />
        <span style={{ fontSize: 10, color: '#666', marginTop: 2 }}>-1 = use volume default</span>
      </div>
    </div>
  );
}
