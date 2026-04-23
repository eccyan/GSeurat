import React from 'react';
import { NumberInput } from '../../components/NumberInput.js';
import { Vec3Input } from '../../components/Vec3Input.js';
import { panelStyles } from '../../styles/panel.js';

const styles = { ...panelStyles };

interface ColliderEditorProps {
  data: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
  onRemove: () => void;
}

const DEFAULT_SHAPES: Record<string, unknown> = {
  box: { type: 'box', half_extents: [0.5, 0.5, 0.5] },
  sphere: { type: 'sphere', radius: 0.5 },
  capsule: { type: 'capsule', radius: 0.3, half_height: 0.5 },
};

export function ColliderEditor({ data, onChange, onRemove }: ColliderEditorProps) {
  const shape = data.shape as Record<string, unknown> | undefined;
  const shapeType = (shape?.type as string) ?? 'box';

  const updateShape = (patch: Record<string, unknown>) => {
    onChange('shape', { ...shape, ...patch });
  };

  return (
    <div style={{ border: '1px solid #333', borderRadius: 4, marginBottom: 8, background: '#1a1a2e' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
          borderBottom: '1px solid #333',
        }}
      >
        <span style={{ fontSize: 12, color: '#ccc', flex: 1 }}>ColliderComponent</span>
        <button
          style={{
            padding: '0 4px', border: 'none', background: 'transparent',
            color: '#844', cursor: 'pointer', fontSize: 13, lineHeight: '1',
          }}
          onClick={onRemove}
        >&times;</button>
      </div>
      <div style={{ padding: '6px 8px' }}>
        <div style={styles.section}>
          <span style={styles.label}>Shape</span>
          <select
            style={styles.select}
            value={shapeType}
            onChange={(e) => onChange('shape', DEFAULT_SHAPES[e.target.value])}
          >
            <option value="box">Box</option>
            <option value="sphere">Sphere</option>
            <option value="capsule">Capsule</option>
          </select>
        </div>

        {shapeType === 'box' && (
          <div style={styles.section}>
            <span style={styles.label}>Half Extents</span>
            <Vec3Input
              value={(shape?.half_extents as [number, number, number]) ?? [0.5, 0.5, 0.5]}
              onChange={(v) => updateShape({ half_extents: v.map((c) => Math.max(0.01, c)) })}
            />
          </div>
        )}

        {(shapeType === 'sphere' || shapeType === 'capsule') && (
          <div style={styles.section}>
            <span style={styles.label}>Radius</span>
            <NumberInput
              value={(shape?.radius as number) ?? 0.5}
              min={0.01}
              step={0.1}
              onChange={(v) => updateShape({ radius: v })}
              style={styles.input}
            />
          </div>
        )}

        {shapeType === 'capsule' && (
          <div style={styles.section}>
            <span style={styles.label}>Half Height</span>
            <NumberInput
              value={(shape?.half_height as number) ?? 0.5}
              min={0.01}
              step={0.1}
              onChange={(v) => updateShape({ half_height: v })}
              style={styles.input}
            />
          </div>
        )}

        <div style={styles.section}>
          <span style={styles.label}>Offset</span>
          <Vec3Input
            value={(data.offset as [number, number, number]) ?? [0, 0, 0]}
            onChange={(v) => onChange('offset', v)}
          />
        </div>

        <div style={styles.section}>
          <label style={{ fontSize: 12, color: '#ddd', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={(data.is_trigger as boolean) ?? false}
              onChange={(e) => onChange('is_trigger', e.target.checked)}
            />
            Is Trigger
          </label>
        </div>

        <div style={styles.section}>
          <label style={{ fontSize: 12, color: '#ddd', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={(data.is_dynamic as boolean) ?? false}
              onChange={(e) => onChange('is_dynamic', e.target.checked)}
            />
            Is Dynamic
          </label>
        </div>
      </div>
    </div>
  );
}
