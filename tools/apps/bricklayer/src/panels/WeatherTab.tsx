import React from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { useSceneStore } from '../store/useSceneStore.js';

const styles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  input: { flex: 1, padding: '3px 5px', fontSize: 12 },
  select: {
    flex: 1, padding: '4px 6px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 13,
  },
};

export function WeatherTab() {
  const weather = useSceneStore((s) => s.weather);
  const setWeather = useSceneStore((s) => s.setWeather);

  return (
    <div>
      <div style={styles.section}>
        <label style={{ ...styles.row, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={weather.enabled}
            onChange={(e) => setWeather({ enabled: e.target.checked })}
          />
          Weather Enabled
        </label>
      </div>

      {weather.enabled && (
        <>
          <div style={styles.section}>
            <span style={styles.label}>Type</span>
            <select
              style={styles.select}
              value={weather.type}
              onChange={(e) => setWeather({ type: e.target.value })}
            >
              <option value="rain">Rain</option>
              <option value="snow">Snow</option>
              <option value="ash">Ash</option>
              <option value="leaves">Leaves</option>
            </select>
          </div>

          <div style={styles.section}>
            <span style={styles.label}>Ambient Override</span>
            <div style={styles.row}>
              <input
                type="color"
                value={'#' + weather.ambient_override.slice(0, 3).map((v) =>
                  Math.round(v * 255).toString(16).padStart(2, '0')
                ).join('')}
                onChange={(e) => {
                  const hex = e.target.value;
                  setWeather({
                    ambient_override: [
                      parseInt(hex.slice(1, 3), 16) / 255,
                      parseInt(hex.slice(3, 5), 16) / 255,
                      parseInt(hex.slice(5, 7), 16) / 255,
                      weather.ambient_override[3],
                    ],
                  });
                }}
                style={{ width: 40, height: 24, border: 'none', cursor: 'pointer' }}
              />
            </div>
          </div>

          <div style={styles.section}>
            <span style={styles.label}>Fog</span>
            <div style={styles.row}>
              <span style={{ fontSize: 12, minWidth: 60 }}>Density</span>
              <NumberInput
                step={0.01}
                value={weather.fog_density}
                onChange={(v) => setWeather({ fog_density: v })}
                style={styles.input}
              />
            </div>
            <div style={styles.row}>
              <span style={{ fontSize: 12, minWidth: 60 }}>Color</span>
              <input
                type="color"
                value={'#' + weather.fog_color.map((v) =>
                  Math.round(v * 255).toString(16).padStart(2, '0')
                ).join('')}
                onChange={(e) => {
                  const hex = e.target.value;
                  setWeather({
                    fog_color: [
                      parseInt(hex.slice(1, 3), 16) / 255,
                      parseInt(hex.slice(3, 5), 16) / 255,
                      parseInt(hex.slice(5, 7), 16) / 255,
                    ],
                  });
                }}
                style={{ width: 40, height: 24, border: 'none', cursor: 'pointer' }}
              />
            </div>
          </div>

          <div style={styles.section}>
            <span style={styles.label}>Transition Speed</span>
            <NumberInput
              step={0.1}
              value={weather.transition_speed}
              onChange={(v) => setWeather({ transition_speed: v })}
              style={styles.input}
            />
          </div>

          <div style={styles.section}>
            <span style={styles.label}>Emitter</span>
            <div style={styles.row}>
              <span style={{ fontSize: 12, minWidth: 80 }}>Spawn Rate</span>
              <NumberInput
                value={weather.emitter.spawn_rate}
                onChange={(v) => setWeather({ emitter: { ...weather.emitter, spawn_rate: v } })}
                style={styles.input}
              />
            </div>
            <div style={styles.row}>
              <span style={{ fontSize: 12, minWidth: 80 }}>Lifetime</span>
              <NumberInput
                step={0.1}
                value={weather.emitter.particle_lifetime_min}
                onChange={(v) => setWeather({ emitter: { ...weather.emitter, particle_lifetime_min: v } })}
                style={{ ...styles.input, maxWidth: 60 }}
              />
              <span style={{ fontSize: 12 }}>-</span>
              <NumberInput
                step={0.1}
                value={weather.emitter.particle_lifetime_max}
                onChange={(v) => setWeather({ emitter: { ...weather.emitter, particle_lifetime_max: v } })}
                style={{ ...styles.input, maxWidth: 60 }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
