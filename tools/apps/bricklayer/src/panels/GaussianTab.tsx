import React from 'react';
import { useSceneStore } from '../store/useSceneStore.js';

const styles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  input: {
    flex: 1, padding: '4px 6px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 13,
  },
};

export function GaussianTab() {
  const gs = useSceneStore((s) => s.gaussianSplat);
  const setGs = useSceneStore((s) => s.setGaussianSplat);

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
    </div>
  );
}
