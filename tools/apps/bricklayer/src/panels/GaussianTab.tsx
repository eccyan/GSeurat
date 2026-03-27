import React, { useState } from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { useSceneStore } from '../store/useSceneStore.js';
import { panelStyles } from '../styles/panel.js';

const styles: Record<string, React.CSSProperties> = { ...panelStyles, info: { fontSize: 11, color: '#aaa' } };

export function GaussianTab() {
  const gs = useSceneStore((s) => s.gaussianSplat);
  const setGs = useSceneStore((s) => s.setGaussianSplat);
  const collisionGridData = useSceneStore((s) => s.collisionGridData);
  const initCollisionGrid = useSceneStore((s) => s.initCollisionGrid);
  const navZoneNames = useSceneStore((s) => s.navZoneNames);
  const addNavZoneName = useSceneStore((s) => s.addNavZoneName);
  const removeNavZoneName = useSceneStore((s) => s.removeNavZoneName);

  const [gridW, setGridW] = useState(32);
  const [gridH, setGridH] = useState(32);
  const [cellSize, setCellSize] = useState(1.0);
  const [newZoneName, setNewZoneName] = useState('');

  return (
    <div>
      <div style={styles.section}>
        <span style={styles.label}>Camera</span>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 50 }}>Pos</span>
          {[0, 1, 2].map((i) => (
            <NumberInput
              key={i}
              step={0.5}
              value={gs.camera.position[i]}
              onChange={(v) => {
                const pos = [...gs.camera.position] as [number, number, number];
                pos[i] = v;
                setGs({ camera: { ...gs.camera, position: pos } });
              }}
              style={{ ...styles.input, maxWidth: 55 }}
            />
          ))}
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 50 }}>Target</span>
          {[0, 1, 2].map((i) => (
            <NumberInput
              key={i}
              step={0.5}
              value={gs.camera.target[i]}
              onChange={(v) => {
                const tgt = [...gs.camera.target] as [number, number, number];
                tgt[i] = v;
                setGs({ camera: { ...gs.camera, target: tgt } });
              }}
              style={{ ...styles.input, maxWidth: 55 }}
            />
          ))}
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 50 }}>FOV</span>
          <NumberInput
            step={1}
            value={gs.camera.fov}
            onChange={(v) => setGs({ camera: { ...gs.camera, fov: v } })}
            style={styles.input}
          />
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Render</span>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 50 }}>Width</span>
          <NumberInput
            value={gs.render_width}
            onChange={(v) => setGs({ render_width: v })}
            style={styles.input}
          />
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 50 }}>Height</span>
          <NumberInput
            value={gs.render_height}
            onChange={(v) => setGs({ render_height: v })}
            style={styles.input}
          />
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 50 }}>Scale</span>
          <NumberInput
            step={0.1}
            value={gs.scale_multiplier}
            onChange={(v) => setGs({ scale_multiplier: v })}
            style={styles.input}
          />
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Background</span>
        <input
          type="text"
          value={gs.background_image}
          onChange={(e) => setGs({ background_image: e.target.value })}
          style={styles.input}
          placeholder="image path"
        />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Parallax</span>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 80 }}>Azimuth</span>
          <NumberInput
            step={1}
            value={gs.parallax.azimuth_range}
            onChange={(v) => setGs({ parallax: { ...gs.parallax, azimuth_range: v } })}
            style={styles.input}
          />
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 80 }}>Elev Min</span>
          <NumberInput
            step={1}
            value={gs.parallax.elevation_min}
            onChange={(v) => setGs({ parallax: { ...gs.parallax, elevation_min: v } })}
            style={{ ...styles.input, maxWidth: 60 }}
          />
          <span style={{ fontSize: 12, minWidth: 30 }}>Max</span>
          <NumberInput
            step={1}
            value={gs.parallax.elevation_max}
            onChange={(v) => setGs({ parallax: { ...gs.parallax, elevation_max: v } })}
            style={{ ...styles.input, maxWidth: 60 }}
          />
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 80 }}>Distance</span>
          <NumberInput
            step={0.5}
            value={gs.parallax.distance_range}
            onChange={(v) => setGs({ parallax: { ...gs.parallax, distance_range: v } })}
            style={styles.input}
          />
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 80 }}>Strength</span>
          <NumberInput
            step={0.1}
            value={gs.parallax.parallax_strength}
            onChange={(v) => setGs({ parallax: { ...gs.parallax, parallax_strength: v } })}
            style={styles.input}
          />
        </div>
      </div>

      {/* ── Collision Grid ── */}
      <div style={styles.section}>
        <span style={styles.label}>Collision Grid</span>
        {!collisionGridData ? (
          <>
            <div style={styles.row}>
              <span style={{ fontSize: 12, minWidth: 50 }}>Width</span>
              <NumberInput value={gridW} min={1}
                onChange={(v) => setGridW(v)}
                style={{ ...styles.input, maxWidth: 60 }} />
              <span style={{ fontSize: 12, minWidth: 50 }}>Height</span>
              <NumberInput value={gridH} min={1}
                onChange={(v) => setGridH(v)}
                style={{ ...styles.input, maxWidth: 60 }} />
            </div>
            <div style={styles.row}>
              <span style={{ fontSize: 12, minWidth: 50 }}>Cell</span>
              <NumberInput value={cellSize} step={0.1} min={0.1}
                onChange={(v) => setCellSize(v)}
                style={{ ...styles.input, maxWidth: 60 }} />
            </div>
            <button style={styles.btn} onClick={() => initCollisionGrid(gridW, gridH, cellSize)}>
              Init Grid
            </button>
          </>
        ) : (
          <>
            <span style={styles.info}>
              {collisionGridData.width} x {collisionGridData.height} (cell {collisionGridData.cell_size}) &mdash;{' '}
              {collisionGridData.solid.filter(Boolean).length} solid /{' '}
              {collisionGridData.solid.length - collisionGridData.solid.filter(Boolean).length} walkable
            </span>
            <span style={styles.info}>
              Enable &quot;Collision&quot; overlay in viewport to paint cells.
            </span>
          </>
        )}
      </div>

      {/* ── Nav Zones ── */}
      {collisionGridData && (
        <div style={styles.section}>
          <span style={styles.label}>Nav Zones</span>
          {navZoneNames.map((name, i) => (
            <div key={i} style={styles.row}>
              <span style={{ fontSize: 12, flex: 1 }}>#{i + 1}: {name}</span>
              <button style={{ ...styles.btn, padding: '2px 6px' }}
                onClick={() => removeNavZoneName(i)}>x</button>
            </div>
          ))}
          <div style={styles.row}>
            <input type="text" value={newZoneName} placeholder="zone name"
              onChange={(e) => setNewZoneName(e.target.value)}
              style={styles.input} />
            <button style={styles.btn}
              onClick={() => { if (newZoneName.trim()) { addNavZoneName(newZoneName.trim()); setNewZoneName(''); } }}>
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
