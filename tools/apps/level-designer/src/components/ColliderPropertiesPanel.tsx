import React from 'react';
import { useEditorStore, type ColliderData } from '../store/useEditorStore.js';
import { eulerToQuat, quatToEuler } from '../utils/math-utils.js';

export function ColliderPropertiesPanel() {
  const colliders = useEditorStore((s) => s.colliders);
  const selectedColliderId = useEditorStore((s) => s.selectedColliderId);
  const updateCollider = useEditorStore((s) => s.updateCollider);

  const collider = colliders.find((c) => c.id === selectedColliderId);
  if (!collider) return null;

  const [pitch, yaw, roll] = quatToEuler(collider.rotation);

  const update = (partial: Partial<ColliderData>) => {
    updateCollider(collider.id, partial);
  };

  const updatePosition = (axis: number, value: number) => {
    const pos: [number, number, number] = [...collider.position];
    pos[axis] = value;
    update({ position: pos });
  };

  const updateRotation = (axis: number, valueDeg: number) => {
    const euler = [pitch, yaw, roll];
    euler[axis] = valueDeg;
    update({ rotation: eulerToQuat(euler[0], euler[1], euler[2]) });
  };

  const updateShapeType = (type: string) => {
    let shape: ColliderData['shape'];
    switch (type) {
      case 'box': shape = { type: 'box', half_extents: [1, 1, 1] }; break;
      case 'sphere': shape = { type: 'sphere', radius: 0.5 }; break;
      case 'capsule': shape = { type: 'capsule', radius: 0.3, half_height: 0.5 }; break;
      default: return;
    }
    update({ shape });
  };

  const labelStyle: React.CSSProperties = { fontSize: 11, color: '#aaa', marginBottom: 2 };
  const rowStyle: React.CSSProperties = { display: 'flex', gap: 4, marginBottom: 6 };
  const inputStyle: React.CSSProperties = {
    width: '100%', background: '#2a2a2a', color: '#ddd', border: '1px solid #555',
    borderRadius: 3, padding: '3px 6px', fontSize: 12,
  };

  return (
    <div style={{ padding: 8, fontSize: 12 }}>
      <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Collider Properties</div>

      {/* Name */}
      <div style={labelStyle}>Name</div>
      <input
        style={{ ...inputStyle, marginBottom: 6 }}
        value={collider.name}
        onChange={(e) => update({ name: e.target.value })}
      />

      {/* Position */}
      <div style={{ ...labelStyle, marginTop: 8 }}>Position</div>
      <div style={rowStyle}>
        {(['X', 'Y', 'Z'] as const).map((label, i) => (
          <div key={label} style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: '#888' }}>{label}</div>
            <input
              type="number" step="0.1" style={inputStyle}
              value={collider.position[i]}
              onChange={(e) => updatePosition(i, parseFloat(e.target.value) || 0)}
            />
          </div>
        ))}
      </div>

      {/* Rotation (Euler degrees) */}
      <div style={labelStyle}>Rotation (degrees)</div>
      <div style={rowStyle}>
        {(['Pitch', 'Yaw', 'Roll'] as const).map((label, i) => (
          <div key={label} style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: '#888' }}>{label}</div>
            <input
              type="number" step="1" style={inputStyle}
              value={Math.round([pitch, yaw, roll][i] * 10) / 10}
              onChange={(e) => updateRotation(i, parseFloat(e.target.value) || 0)}
            />
          </div>
        ))}
      </div>

      {/* Shape type */}
      <div style={labelStyle}>Shape</div>
      <select
        style={{ ...inputStyle, marginBottom: 6 }}
        value={collider.shape.type}
        onChange={(e) => updateShapeType(e.target.value)}
      >
        <option value="box">Box</option>
        <option value="sphere">Sphere</option>
        <option value="capsule">Capsule</option>
      </select>

      {/* Shape-specific params — capture narrowed shape in a local var to preserve TS narrowing in callbacks */}
      {collider.shape.type === 'box' && (() => {
        const boxShape = collider.shape as { type: 'box'; half_extents: [number, number, number] };
        return (
          <>
            <div style={labelStyle}>Half Extents</div>
            <div style={rowStyle}>
              {(['X', 'Y', 'Z'] as const).map((label, i) => (
                <div key={label} style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: '#888' }}>{label}</div>
                  <input
                    type="number" step="0.1" min="0" style={inputStyle}
                    value={boxShape.half_extents[i]}
                    onChange={(e) => {
                      const he: [number, number, number] = [...boxShape.half_extents];
                      he[i] = Math.max(0, parseFloat(e.target.value) || 0);
                      update({ shape: { type: 'box', half_extents: he } });
                    }}
                  />
                </div>
              ))}
            </div>
          </>
        );
      })()}

      {collider.shape.type === 'sphere' && (() => {
        const sphereShape = collider.shape as { type: 'sphere'; radius: number };
        return (
          <>
            <div style={labelStyle}>Radius</div>
            <input
              type="number" step="0.1" min="0" style={{ ...inputStyle, marginBottom: 6 }}
              value={sphereShape.radius}
              onChange={(e) =>
                update({ shape: { type: 'sphere', radius: Math.max(0, parseFloat(e.target.value) || 0) } })
              }
            />
          </>
        );
      })()}

      {collider.shape.type === 'capsule' && (() => {
        const capsuleShape = collider.shape as { type: 'capsule'; radius: number; half_height: number };
        return (
          <>
            <div style={labelStyle}>Radius</div>
            <input
              type="number" step="0.1" min="0" style={{ ...inputStyle, marginBottom: 6 }}
              value={capsuleShape.radius}
              onChange={(e) =>
                update({
                  shape: {
                    type: 'capsule',
                    radius: Math.max(0, parseFloat(e.target.value) || 0),
                    half_height: capsuleShape.half_height,
                  },
                })
              }
            />
            <div style={{ ...labelStyle, marginTop: 4 }}>Half Height</div>
            <input
              type="number" step="0.1" min="0" style={{ ...inputStyle, marginBottom: 6 }}
              value={capsuleShape.half_height}
              onChange={(e) =>
                update({
                  shape: {
                    type: 'capsule',
                    radius: capsuleShape.radius,
                    half_height: Math.max(0, parseFloat(e.target.value) || 0),
                  },
                })
              }
            />
          </>
        );
      })()}

      {/* Flags */}
      <div style={{ ...labelStyle, marginTop: 8 }}>Flags</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <input
          type="checkbox" checked={collider.is_trigger}
          onChange={(e) => update({ is_trigger: e.target.checked })}
        />
        Is Trigger
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <input
          type="checkbox" checked={collider.is_dynamic}
          onChange={(e) => update({ is_dynamic: e.target.checked })}
        />
        Is Dynamic
      </label>

      {/* Advanced (collapsed) */}
      <details style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 11, color: '#888', cursor: 'pointer' }}>Advanced</summary>
        <div style={{ ...labelStyle, marginTop: 4 }}>Collision Mask</div>
        <input
          type="number" style={{ ...inputStyle, marginTop: 2 }}
          value={collider.collision_mask}
          onChange={(e) => update({ collision_mask: parseInt(e.target.value) || 0 })}
        />
      </details>
    </div>
  );
}
