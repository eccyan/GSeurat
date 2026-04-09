import React, { useState } from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { Vec3Input } from '../components/Vec3Input.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type { CameraZoneRail } from '../store/types.js';
import { panelStyles } from '../styles/panel.js';

const styles = { ...panelStyles };

export function CameraRailEditor({ rail }: { rail: CameraZoneRail }) {
  useComponentRegistry('CameraRailEditor');
  const updateCameraRail = useSceneStore((s) => s.updateCameraRail);
  const removeCameraRail = useSceneStore((s) => s.removeCameraRail);
  const addRailControlPoint = useSceneStore((s) => s.addRailControlPoint);
  const removeRailControlPoint = useSceneStore((s) => s.removeRailControlPoint);
  const updateRailControlPoint = useSceneStore((s) => s.updateRailControlPoint);

  const [targetEnabled, setTargetEnabled] = useState(
    rail.target_points !== undefined && rail.target_points.length > 0,
  );

  const update = (patch: Partial<CameraZoneRail>) => updateCameraRail(rail.id, patch);

  const handleToggleTargets = (enabled: boolean) => {
    setTargetEnabled(enabled);
    if (!enabled) {
      update({ target_points: undefined });
    } else {
      update({ target_points: rail.target_points ?? [] });
    }
  };

  const removeTargetPoint = (index: number) => {
    const pts = (rail.target_points ?? []).filter((_, i) => i !== index);
    update({ target_points: pts });
  };

  const updateTargetPoint = (index: number, point: [number, number, number]) => {
    const pts = [...(rail.target_points ?? [])];
    pts[index] = point;
    update({ target_points: pts });
  };

  const addTargetPoint = () => {
    const pts = [...(rail.target_points ?? [])];
    pts.push([0, 0, 0]);
    update({ target_points: pts });
  };

  return (
    <div>
      <div style={{ ...styles.row, marginBottom: 12 }}>
        <span style={{ ...styles.label, flex: 1 }}>Camera Rail</span>
        <button style={styles.btnDanger} onClick={() => removeCameraRail(rail.id)}>Remove</button>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Name</span>
        <input
          type="text"
          value={rail.name}
          onChange={(e) => update({ name: e.target.value })}
          style={styles.input}
        />
      </div>

      {/* Control Points */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ ...styles.row, marginBottom: 4 }}>
          <span style={{ ...styles.label, flex: 1 }}>Control Points ({rail.control_points.length})</span>
          <button
            style={{ padding: '2px 8px', background: '#2a2a5a', border: '1px solid #444', borderRadius: 3, color: '#77f', cursor: 'pointer', fontSize: 12 }}
            onClick={() => addRailControlPoint(rail.id, [0, 0, 0])}
          >+ Add Point</button>
        </div>
        {rail.control_points.map((pt, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: '#666', minWidth: 18, textAlign: 'right' }}>{i + 1}</span>
            <div style={{ flex: 1 }}>
              <Vec3Input
                value={pt}
                onChange={(v) => updateRailControlPoint(rail.id, i, v)}
              />
            </div>
            <button
              style={{ padding: '0 4px', border: 'none', background: 'transparent', color: '#844', cursor: 'pointer', fontSize: 13, lineHeight: '1', flexShrink: 0 }}
              onClick={() => removeRailControlPoint(rail.id, i)}
            >&times;</button>
          </div>
        ))}
      </div>

      {/* Target Points */}
      <div style={styles.section}>
        <label style={{ fontSize: 12, color: '#ddd', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={targetEnabled}
            onChange={(e) => handleToggleTargets(e.target.checked)}
          />
          Use Target Points
        </label>
      </div>

      {targetEnabled && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ ...styles.row, marginBottom: 4 }}>
            <span style={{ ...styles.label, flex: 1 }}>Target Points ({(rail.target_points ?? []).length})</span>
            <button
              style={{ padding: '2px 8px', background: '#2a2a5a', border: '1px solid #444', borderRadius: 3, color: '#77f', cursor: 'pointer', fontSize: 12 }}
              onClick={addTargetPoint}
            >+ Add Point</button>
          </div>
          {(rail.target_points ?? []).map((pt, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: '#666', minWidth: 18, textAlign: 'right' }}>{i + 1}</span>
              <div style={{ flex: 1 }}>
                <Vec3Input
                  value={pt}
                  onChange={(v) => updateTargetPoint(i, v)}
                />
              </div>
              <button
                style={{ padding: '0 4px', border: 'none', background: 'transparent', color: '#844', cursor: 'pointer', fontSize: 13, lineHeight: '1', flexShrink: 0 }}
                onClick={() => removeTargetPoint(i)}
              >&times;</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
