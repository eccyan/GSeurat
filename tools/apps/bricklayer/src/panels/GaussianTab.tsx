import React, { useState } from 'react';
import { useSceneStore } from '../store/useSceneStore.js';

const styles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  input: {
    flex: 1, padding: '4px 6px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 13,
  },
  btn: {
    padding: '4px 10px', background: '#3a3a6a', border: '1px solid #555',
    borderRadius: 4, color: '#ddd', fontSize: 12, cursor: 'pointer',
  },
  info: { fontSize: 11, color: '#aaa' },
};

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
            <input
              key={i}
              type="number"
              step={0.5}
              value={gs.camera.position[i]}
              onChange={(e) => {
                const pos = [...gs.camera.position] as [number, number, number];
                pos[i] = Number(e.target.value);
                setGs({ camera: { ...gs.camera, position: pos } });
              }}
              style={{ ...styles.input, maxWidth: 55 }}
            />
          ))}
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 50 }}>Target</span>
          {[0, 1, 2].map((i) => (
            <input
              key={i}
              type="number"
              step={0.5}
              value={gs.camera.target[i]}
              onChange={(e) => {
                const tgt = [...gs.camera.target] as [number, number, number];
                tgt[i] = Number(e.target.value);
                setGs({ camera: { ...gs.camera, target: tgt } });
              }}
              style={{ ...styles.input, maxWidth: 55 }}
            />
          ))}
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 50 }}>FOV</span>
          <input
            type="number"
            step={1}
            value={gs.camera.fov}
            onChange={(e) => setGs({ camera: { ...gs.camera, fov: Number(e.target.value) } })}
            style={styles.input}
          />
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Render</span>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 50 }}>Width</span>
          <input
            type="number"
            value={gs.render_width}
            onChange={(e) => setGs({ render_width: Number(e.target.value) })}
            style={styles.input}
          />
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 50 }}>Height</span>
          <input
            type="number"
            value={gs.render_height}
            onChange={(e) => setGs({ render_height: Number(e.target.value) })}
            style={styles.input}
          />
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 50 }}>Scale</span>
          <input
            type="number"
            step={0.1}
            value={gs.scale_multiplier}
            onChange={(e) => setGs({ scale_multiplier: Number(e.target.value) })}
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
          <input
            type="number"
            step={1}
            value={gs.parallax.azimuth_range}
            onChange={(e) => setGs({ parallax: { ...gs.parallax, azimuth_range: Number(e.target.value) } })}
            style={styles.input}
          />
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 80 }}>Elev Min</span>
          <input
            type="number"
            step={1}
            value={gs.parallax.elevation_min}
            onChange={(e) => setGs({ parallax: { ...gs.parallax, elevation_min: Number(e.target.value) } })}
            style={{ ...styles.input, maxWidth: 60 }}
          />
          <span style={{ fontSize: 12, minWidth: 30 }}>Max</span>
          <input
            type="number"
            step={1}
            value={gs.parallax.elevation_max}
            onChange={(e) => setGs({ parallax: { ...gs.parallax, elevation_max: Number(e.target.value) } })}
            style={{ ...styles.input, maxWidth: 60 }}
          />
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 80 }}>Distance</span>
          <input
            type="number"
            step={0.5}
            value={gs.parallax.distance_range}
            onChange={(e) => setGs({ parallax: { ...gs.parallax, distance_range: Number(e.target.value) } })}
            style={styles.input}
          />
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 80 }}>Strength</span>
          <input
            type="number"
            step={0.1}
            value={gs.parallax.parallax_strength}
            onChange={(e) => setGs({ parallax: { ...gs.parallax, parallax_strength: Number(e.target.value) } })}
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
              <input type="number" value={gridW} min={1}
                onChange={(e) => setGridW(Math.max(1, Number(e.target.value)))}
                style={{ ...styles.input, maxWidth: 60 }} />
              <span style={{ fontSize: 12, minWidth: 50 }}>Height</span>
              <input type="number" value={gridH} min={1}
                onChange={(e) => setGridH(Math.max(1, Number(e.target.value)))}
                style={{ ...styles.input, maxWidth: 60 }} />
            </div>
            <div style={styles.row}>
              <span style={{ fontSize: 12, minWidth: 50 }}>Cell</span>
              <input type="number" value={cellSize} step={0.1} min={0.1}
                onChange={(e) => setCellSize(Math.max(0.1, Number(e.target.value)))}
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
