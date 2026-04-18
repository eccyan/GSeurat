import React from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type { MorphEasing } from '../store/types.js';
import { panelStyles } from '../styles/panel.js';

/// Adding a new easing: extend MorphEasing in store/types.ts, then add an
/// option here. The type coupling keeps the two in lockstep.
const MORPH_EASINGS: readonly MorphEasing[] = ['linear', 'ease_in_out'];

const styles: Record<string, React.CSSProperties> = { ...panelStyles, info: { fontSize: 11, color: '#aaa' } };

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

      {/* ── Morph Pair (optional) ── */}
      <div style={styles.section}>
        <span style={styles.label}>Morph Pair (optional)</span>
        <span style={styles.info}>
          Second PLY blended with the active cloud at runtime by the
          game&apos;s SceneManager. Engine parses but does not load the pair PLY.
        </span>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 80 }}>Pair PLY</span>
          <input
            type="text"
            value={gs.morphPairPly}
            placeholder="assets/maps/library_past.ply"
            onChange={(e) => setGs({ morphPairPly: e.target.value })}
            style={styles.input}
          />
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 80 }}>Duration (s)</span>
          <NumberInput
            value={gs.morphDuration}
            onChange={(v) => setGs({ morphDuration: v })}
            min={0.01}
            step={0.05}
            style={styles.input}
          />
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 80 }}>Default blend</span>
          <NumberInput
            value={gs.morphDefaultBlend}
            onChange={(v) => setGs({ morphDefaultBlend: v })}
            min={0}
            max={1}
            step={0.05}
            style={styles.input}
          />
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 80 }}>Easing</span>
          <select
            value={gs.morphEasing}
            onChange={(e) =>
              setGs({ morphEasing: e.target.value as MorphEasing })
            }
            style={styles.select}
          >
            {MORPH_EASINGS.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </div>
      </div>

    </div>
  );
}
