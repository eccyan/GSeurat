import { NumberInput } from '../../components/NumberInput.js';
import { Vec3Input } from '../../components/Vec3Input.js';
import { useSceneStore } from '../../store/useSceneStore.js';
import type { GsParticleEmitterData } from '../../store/types.js';
import { panelStyles } from '../../styles/panel.js';
import { rgbToHex, hexToRgb } from './utils.js';

const styles = { ...panelStyles };

const GS_PRESETS: Record<string, Partial<GsParticleEmitterData>> = {
  dust_puff: {
    spawn_rate: 120, lifetime_min: 1, lifetime_max: 2.5,
    velocity_min: [-3, 1, -3], velocity_max: [3, 5, 3], acceleration: [0, -2, 0],
    color_start: [0.6, 0.55, 0.45], color_end: [0.5, 0.48, 0.4],
    scale_min: [0.1, 0.1, 0.1], scale_max: [0.3, 0.3, 0.3],
    scale_end_factor: 0.1, opacity_start: 0.4, opacity_end: 0, emission: 0,
    spawn_region: { shape: "box", center: [0, 0.5, 0], half_extents: [2, 0.5, 2] },
  },
  spark_shower: {
    spawn_rate: 40, lifetime_min: 0.3, lifetime_max: 0.8,
    velocity_min: [-4, 8, -4], velocity_max: [4, 15, 4], acceleration: [0, -15, 0],
    color_start: [0.8, 0.6, 0.3], color_end: [0.5, 0.2, 0],
    scale_min: [0.05, 0.05, 0.05], scale_max: [0.15, 0.15, 0.15],
    scale_end_factor: 0, opacity_start: 0.5, opacity_end: 0, emission: 0.8,
    spawn_region: { shape: "box", center: [0, 0.5, 0], half_extents: [1, 0.5, 1] },
  },
  magic_spiral: {
    spawn_rate: 50, lifetime_min: 1.5, lifetime_max: 3,
    velocity_min: [-2, 3, -2], velocity_max: [2, 6, 2], acceleration: [0, 0.5, 0],
    color_start: [0.4, 0.6, 1], color_end: [0.8, 0.3, 1],
    scale_min: [0.5, 0.5, 0.5], scale_max: [1, 1, 1],
    scale_end_factor: 0.3, opacity_start: 0.9, opacity_end: 0, emission: 0,
    spawn_region: { shape: "box", half_extents: [1, 0.5, 1] },
  },
  fire: {
    spawn_rate: 80, lifetime_min: 0.4, lifetime_max: 1.2,
    velocity_min: [-1.5, 3, -1.5], velocity_max: [1.5, 8, 1.5], acceleration: [0, 1, 0],
    color_start: [1, 0.6, 0.1], color_end: [0.8, 0.1, 0],
    scale_min: [0.2, 0.2, 0.2], scale_max: [0.5, 0.5, 0.5],
    scale_end_factor: 0, opacity_start: 0.8, opacity_end: 0, emission: 1.5,
    spawn_region: { shape: "box", center: [0, 0.25, 0], half_extents: [0.5, 0.25, 0.5] },
  },
  smoke: {
    spawn_rate: 30, lifetime_min: 2, lifetime_max: 4,
    velocity_min: [-0.5, 1, -0.5], velocity_max: [0.5, 3, 0.5], acceleration: [0, 0.3, 0],
    color_start: [0.4, 0.4, 0.42], color_end: [0.3, 0.3, 0.32],
    scale_min: [0.3, 0.3, 0.3], scale_max: [0.8, 0.8, 0.8],
    scale_end_factor: 2, opacity_start: 0.5, opacity_end: 0, emission: 0,
    spawn_region: { shape: "box", center: [0, 0.25, 0], half_extents: [1, 0.25, 1] },
  },
  rain: {
    spawn_rate: 200, lifetime_min: 0.5, lifetime_max: 1,
    velocity_min: [-0.5, -20, -0.5], velocity_max: [0.5, -15, 0.5], acceleration: [0, 0, 0],
    color_start: [0.7, 0.75, 0.9], color_end: [0.5, 0.55, 0.8],
    scale_min: [0.02, 0.15, 0.02], scale_max: [0.03, 0.25, 0.03],
    scale_end_factor: 1, opacity_start: 0.4, opacity_end: 0.1, emission: 0,
    spawn_region: { shape: "box", center: [0, 12.5, 0], half_extents: [15, 2.5, 15] },
  },
  snow: {
    spawn_rate: 60, lifetime_min: 3, lifetime_max: 6,
    velocity_min: [-1, -2, -1], velocity_max: [1, -0.5, 1], acceleration: [0, -0.1, 0],
    color_start: [0.95, 0.95, 1], color_end: [0.9, 0.9, 0.95],
    scale_min: [0.05, 0.05, 0.05], scale_max: [0.15, 0.15, 0.15],
    scale_end_factor: 0.5, opacity_start: 0.7, opacity_end: 0, emission: 0,
    spawn_region: { shape: "box", center: [0, 10, 0], half_extents: [12, 2, 12] },
  },
  leaves: {
    spawn_rate: 15, lifetime_min: 3, lifetime_max: 6,
    velocity_min: [-2, -1.5, -2], velocity_max: [2, -0.5, 2], acceleration: [0, -0.3, 0],
    color_start: [0.4, 0.6, 0.15], color_end: [0.5, 0.35, 0.1],
    scale_min: [0.1, 0.02, 0.1], scale_max: [0.2, 0.04, 0.2],
    scale_end_factor: 0.8, opacity_start: 0.9, opacity_end: 0.2, emission: 0,
    spawn_region: { shape: "box", center: [0, 7.5, 0], half_extents: [8, 2.5, 8] },
  },
  fireflies: {
    spawn_rate: 8, lifetime_min: 3, lifetime_max: 7,
    velocity_min: [-0.5, -0.3, -0.5], velocity_max: [0.5, 0.5, 0.5], acceleration: [0, 0, 0],
    color_start: [0.8, 1, 0.3], color_end: [0.6, 0.9, 0.2],
    scale_min: [0.03, 0.03, 0.03], scale_max: [0.06, 0.06, 0.06],
    scale_end_factor: 0.5, opacity_start: 0.8, opacity_end: 0, emission: 1,
    spawn_region: { shape: "box", center: [0, 2.25, 0], half_extents: [6, 1.75, 6] },
  },
  steam: {
    spawn_rate: 40, lifetime_min: 0.5, lifetime_max: 1.5,
    velocity_min: [-0.8, 2, -0.8], velocity_max: [0.8, 5, 0.8], acceleration: [0, 0.5, 0],
    color_start: [0.9, 0.9, 0.92], color_end: [0.85, 0.85, 0.88],
    scale_min: [0.15, 0.15, 0.15], scale_max: [0.4, 0.4, 0.4],
    scale_end_factor: 2.5, opacity_start: 0.4, opacity_end: 0, emission: 0,
    spawn_region: { shape: "box", center: [0, 0.15, 0], half_extents: [0.5, 0.15, 0.5] },
  },
  waterfall_mist: {
    spawn_rate: 100, lifetime_min: 1, lifetime_max: 2.5,
    velocity_min: [-4, 0.5, -4], velocity_max: [4, 3, 4], acceleration: [0, -1, 0],
    color_start: [0.75, 0.8, 0.95], color_end: [0.7, 0.75, 0.9],
    scale_min: [0.1, 0.1, 0.1], scale_max: [0.3, 0.3, 0.3],
    scale_end_factor: 1.5, opacity_start: 0.35, opacity_end: 0, emission: 0,
    spawn_region: { shape: "box", center: [0, 0.25, 0], half_extents: [3, 0.75, 3] },
  },
};

export function GsEmitterProperties({ emitter }: { emitter: GsParticleEmitterData }) {
  const update = useSceneStore((s) => s.updateGsEmitter);
  const remove = useSceneStore((s) => s.removeGsEmitter);

  const applyPreset = (name: string) => {
    const preset = GS_PRESETS[name];
    if (preset) {
      update(emitter.id, { ...preset, preset: name });
    } else {
      update(emitter.id, { preset: '' });
    }
  };

  return (
    <div>
      <div style={{ ...styles.row, marginBottom: 12 }}>
        <span style={{ ...styles.label, flex: 1 }}>Particle Emitter</span>
        <button style={styles.btnDanger} onClick={() => remove(emitter.id)}>Remove</button>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Preset</span>
        <select
          style={styles.select}
          value={emitter.preset}
          onChange={(e) => applyPreset(e.target.value)}
        >
          <option value="">Custom</option>
          <option value="dust_puff">Dust Puff</option>
          <option value="spark_shower">Spark Shower</option>
          <option value="magic_spiral">Magic Spiral</option>
          <option value="fire">Fire</option>
          <option value="smoke">Smoke</option>
          <option value="rain">Rain</option>
          <option value="snow">Snow</option>
          <option value="leaves">Leaves</option>
          <option value="fireflies">Fireflies</option>
          <option value="steam">Steam</option>
          <option value="waterfall_mist">Waterfall Mist</option>
        </select>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Position</span>
        <Vec3Input value={emitter.position} onChange={(v) => update(emitter.id, { position: v })} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Spawn Rate</span>
        <NumberInput value={emitter.spawn_rate} min={0} step={1}
          onChange={(v) => update(emitter.id, { spawn_rate: v })} style={styles.input} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Lifetime</span>
        <div style={styles.row}>
          <NumberInput label="Min" value={emitter.lifetime_min} min={0} step={0.1}
            onChange={(v) => update(emitter.id, { lifetime_min: v })} style={styles.input} />
          <NumberInput label="Max" value={emitter.lifetime_max} min={0} step={0.1}
            onChange={(v) => update(emitter.id, { lifetime_max: v })} style={styles.input} />
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Velocity Min</span>
        <Vec3Input value={emitter.velocity_min} onChange={(v) => update(emitter.id, { velocity_min: v })} />
      </div>
      <div style={styles.section}>
        <span style={styles.label}>Velocity Max</span>
        <Vec3Input value={emitter.velocity_max} onChange={(v) => update(emitter.id, { velocity_max: v })} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Acceleration</span>
        <Vec3Input value={emitter.acceleration} onChange={(v) => update(emitter.id, { acceleration: v })} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Spawn Region</span>
        <select
          style={styles.select}
          value={emitter.spawn_region?.shape ?? 'sphere'}
          onChange={(e) => update(emitter.id, {
            spawn_region: { ...emitter.spawn_region, shape: e.target.value },
          })}
        >
          <option value="sphere">Sphere</option>
          <option value="box">Box</option>
        </select>
      </div>

      {(emitter.spawn_region?.shape ?? 'sphere') === 'sphere' ? (
        <div style={styles.section}>
          <span style={styles.label}>Radius</span>
          <NumberInput value={emitter.spawn_region?.radius ?? 1} min={0} step={0.5}
            onChange={(v) => update(emitter.id, {
              spawn_region: { ...emitter.spawn_region, radius: v },
            })} style={styles.input} />
        </div>
      ) : (
        <div style={styles.section}>
          <span style={styles.label}>Half Extents</span>
          <Vec3Input value={emitter.spawn_region?.half_extents ?? [1, 1, 1]} step={0.5}
            onChange={(v) => update(emitter.id, {
              spawn_region: { ...emitter.spawn_region, half_extents: v },
            })} />
        </div>
      )}

      <div style={styles.section}>
        <span style={styles.label}>Center Offset</span>
        <Vec3Input value={emitter.spawn_region?.center ?? [0, 0, 0]}
          onChange={(v) => update(emitter.id, {
            spawn_region: { ...emitter.spawn_region, center: v },
          })} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Color</span>
        <div style={styles.row}>
          <span style={{ fontSize: 12 }}>Start</span>
          <input type="color" value={rgbToHex(emitter.color_start)}
            onChange={(e) => update(emitter.id, { color_start: hexToRgb(e.target.value) })}
            style={{ width: 40, height: 24, border: 'none', cursor: 'pointer' }} />
          <span style={{ fontSize: 12 }}>End</span>
          <input type="color" value={rgbToHex(emitter.color_end)}
            onChange={(e) => update(emitter.id, { color_end: hexToRgb(e.target.value) })}
            style={{ width: 40, height: 24, border: 'none', cursor: 'pointer' }} />
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Scale Min</span>
        <Vec3Input value={emitter.scale_min} onChange={(v) => update(emitter.id, { scale_min: v })} />
      </div>
      <div style={styles.section}>
        <span style={styles.label}>Scale Max</span>
        <Vec3Input value={emitter.scale_max} onChange={(v) => update(emitter.id, { scale_max: v })} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Scale End Factor</span>
        <NumberInput value={emitter.scale_end_factor} min={0} max={1} step={0.05}
          onChange={(v) => update(emitter.id, { scale_end_factor: v })} style={styles.input} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Opacity</span>
        <div style={styles.row}>
          <NumberInput label="Start" value={emitter.opacity_start} min={0} max={1} step={0.05}
            onChange={(v) => update(emitter.id, { opacity_start: v })} style={styles.input} />
          <NumberInput label="End" value={emitter.opacity_end} min={0} max={1} step={0.05}
            onChange={(v) => update(emitter.id, { opacity_end: v })} style={styles.input} />
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Emission</span>
        <NumberInput value={emitter.emission} min={0} step={0.1}
          onChange={(v) => update(emitter.id, { emission: v })} style={styles.input} />
        <span style={{ fontSize: 10, color: '#666' }}>
          {'> 0 = self-lit (bypasses scene lighting, triggers bloom)'}
        </span>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Burst Duration</span>
        <NumberInput value={emitter.burst_duration} min={0} step={0.1}
          onChange={(v) => update(emitter.id, { burst_duration: v })} style={styles.input} />
        <span style={{ fontSize: 10, color: '#666' }}>0 = continuous loop</span>
      </div>

      {/* Spline Path */}
      <div style={styles.section}>
        <span style={styles.label}>Spline Path</span>
        <select
          style={styles.select}
          value={emitter.spline?.mode ?? 'none'}
          onChange={(e) => {
            const mode = e.target.value;
            if (mode === 'none') {
              update(emitter.id, { spline: undefined });
            } else {
              const pts = emitter.spline?.control_points?.length
                ? emitter.spline.control_points
                : [[0, 0, 0], [0, 5, 0]] as [number, number, number][];
              update(emitter.id, {
                spline: {
                  ...emitter.spline,
                  mode: mode as 'emitter_path' | 'particle_path',
                  control_points: pts,
                },
              });
            }
          }}
        >
          <option value="none">None</option>
          <option value="emitter_path">Emitter Path</option>
          <option value="particle_path">Particle Path</option>
        </select>
      </div>

      {emitter.spline && (
        <>
          {emitter.spline.control_points.map((pt, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <span style={{ fontSize: 10, color: '#666', minWidth: 18, flexShrink: 0 }}>P{i}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Vec3Input value={pt} step={0.5}
                  onChange={(v) => {
                    const pts = [...emitter.spline!.control_points];
                    pts[i] = v;
                    update(emitter.id, {
                      spline: { ...emitter.spline!, control_points: pts },
                    });
                  }} />
              </div>
              <button
                onClick={() => {
                  if (emitter.spline!.control_points.length <= 2) return;
                  const pts = emitter.spline!.control_points.filter((_, idx) => idx !== i);
                  update(emitter.id, {
                    spline: { ...emitter.spline!, control_points: pts },
                  });
                }}
                disabled={emitter.spline!.control_points.length <= 2}
                style={{
                  background: 'transparent', border: 'none', color: '#666',
                  cursor: emitter.spline!.control_points.length <= 2 ? 'not-allowed' : 'pointer',
                  fontSize: 14, padding: '0 2px', flexShrink: 0,
                  opacity: emitter.spline!.control_points.length <= 2 ? 0.3 : 0.7,
                }}
              >
                x
              </button>
            </div>
          ))}
          <button
            onClick={() => {
              const pts = emitter.spline!.control_points;
              const last = pts[pts.length - 1];
              const prev = pts[pts.length - 2] ?? last;
              const next: [number, number, number] = [
                last[0] + (last[0] - prev[0]),
                last[1] + (last[1] - prev[1]),
                last[2] + (last[2] - prev[2]),
              ];
              update(emitter.id, {
                spline: { ...emitter.spline!, control_points: [...pts, next] },
              });
            }}
            style={{
              background: '#1a1a2e', border: '1px solid #333', borderRadius: 3,
              color: '#999', fontSize: 11, padding: '4px 10px', cursor: 'pointer',
              margin: '4px 0 4px 12px',
            }}
          >
            + Add Point
          </button>

          {emitter.spline.mode === 'emitter_path' && (
            <div style={styles.section}>
              <span style={styles.label}>Emitter Speed</span>
              <NumberInput value={emitter.spline.emitter_speed ?? 1} min={0} step={0.1}
                onChange={(v) => update(emitter.id, {
                  spline: { ...emitter.spline!, emitter_speed: v },
                })} style={styles.input} />
              <span style={{ fontSize: 10, color: '#666' }}>cycles/sec along spline</span>
            </div>
          )}

          {emitter.spline.mode === 'particle_path' && (
            <>
              <div style={styles.section}>
                <span style={styles.label}>Path Spread</span>
                <NumberInput value={emitter.spline.path_spread ?? 0} min={0} step={0.1}
                  onChange={(v) => update(emitter.id, {
                    spline: { ...emitter.spline!, path_spread: v },
                  })} style={styles.input} />
              </div>
              <div style={{ ...styles.section, display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox"
                  checked={emitter.spline.align_to_tangent ?? false}
                  onChange={(e) => update(emitter.id, {
                    spline: { ...emitter.spline!, align_to_tangent: e.target.checked },
                  })} />
                <span style={{ fontSize: 12, color: '#ccc' }}>Align to tangent</span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
