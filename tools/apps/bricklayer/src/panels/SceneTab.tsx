import React from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { useSceneStore } from '../store/useSceneStore.js';
import { panelStyles } from '../styles/panel.js';

const styles = { ...panelStyles };

function colorToHex(c: [number, number, number, number]): string {
  return '#' + [c[0], c[1], c[2]].map((v) =>
    Math.round(v * 255).toString(16).padStart(2, '0')
  ).join('');
}

function hexToColor(hex: string, alpha: number): [number, number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b, alpha];
}

export function SceneTab() {
  const ambientColor = useSceneStore((s) => s.ambientColor);
  const setAmbientColor = useSceneStore((s) => s.setAmbientColor);
  const godRaysIntensity = useSceneStore((s) => s.godRaysIntensity);
  const setGodRaysIntensity = useSceneStore((s) => s.setGodRaysIntensity);
  const gridWidth = useSceneStore((s) => s.gridWidth);
  const gridDepth = useSceneStore((s) => s.gridDepth);
  const voxels = useSceneStore((s) => s.voxels);
  const dayNight = useSceneStore((s) => s.dayNight);
  const setDayNight = useSceneStore((s) => s.setDayNight);
  const collisionGridData = useSceneStore((s) => s.collisionGridData);

  return (
    <div>
      <div style={styles.section}>
        <span style={styles.label}>Scene Info</span>
        <div style={{ fontSize: 12, color: '#aaa' }}>
          Grid: {gridWidth} x {gridDepth} | Voxels: {voxels.size}
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Ambient Color</span>
        <div style={styles.row}>
          <input
            type="color"
            value={colorToHex(ambientColor)}
            onChange={(e) => setAmbientColor(hexToColor(e.target.value, ambientColor[3]))}
            style={{ width: 40, height: 28, border: 'none', cursor: 'pointer' }}
          />
          <span style={{ fontSize: 12, color: '#aaa' }}>
            [{ambientColor.map((v) => v.toFixed(2)).join(', ')}]
          </span>
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>God Rays (Volume Light)</span>
        <span style={{ fontSize: 10, color: '#666', marginBottom: 4 }}>
          Visible light shafts from scene lights through geometry. Set to 0 to disable.
        </span>
        <div style={styles.row}>
          <NumberInput
            step={0.1}
            min={0}
            max={5}
            value={godRaysIntensity}
            onChange={(v) => setGodRaysIntensity(Math.max(0, v))}
            style={styles.input}
          />
          <span style={{ fontSize: 11, color: godRaysIntensity > 0 ? '#8f8' : '#666', minWidth: 20 }}>
            {godRaysIntensity > 0 ? 'ON' : 'OFF'}
          </span>
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Day/Night Cycle</span>
        <label style={{ ...styles.row, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={dayNight.enabled}
            onChange={(e) => setDayNight({ enabled: e.target.checked })}
          />
          Enabled
        </label>
        {dayNight.enabled && (
          <>
            <div style={styles.row}>
              <span style={{ fontSize: 12, minWidth: 80 }}>Speed</span>
              <NumberInput
                step={0.1}
                value={dayNight.cycle_speed}
                onChange={(v) => setDayNight({ cycle_speed: v })}
                style={styles.input}
              />
            </div>
            <div style={styles.row}>
              <span style={{ fontSize: 12, minWidth: 80 }}>Initial Time</span>
              <NumberInput
                step={0.05}
                min={0}
                max={1}
                value={dayNight.initial_time}
                onChange={(v) => setDayNight({ initial_time: v })}
                style={styles.input}
              />
            </div>
            <span style={{ fontSize: 11, color: '#666' }}>
              {dayNight.keyframes.length} keyframes
            </span>
          </>
        )}
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Collision</span>
        <span style={{ fontSize: 12, color: '#aaa' }}>
          {collisionGridData
            ? `${collisionGridData.width}x${collisionGridData.height} grid (${collisionGridData.solid.filter(Boolean).length} solid)`
            : 'No grid — init in GS tab'}
        </span>
      </div>
    </div>
  );
}
