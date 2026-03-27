import React from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { useSceneStore } from '../store/useSceneStore.js';
import { GaussianTab } from './GaussianTab.js';
import { SceneTab } from './SceneTab.js';
import { WeatherTab } from './WeatherTab.js';
import { VfxTab } from './VfxTab.js';
import { BackgroundTab } from './BackgroundTab.js';

const styles: Record<string, React.CSSProperties> = {
  heading: {
    fontSize: 11,
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottom: '1px solid #333',
  },
};

export function SettingsRightPanel() {
  const category = useSceneStore((s) => s.selectedSettingsCategory);

  return (
    <div>
      {category === 'gs_camera' && (
        <>
          <div style={styles.heading}>GS Camera & Render</div>
          <GaussianTab />
        </>
      )}

      {category === 'ambient' && (
        <>
          <div style={styles.heading}>Ambient & Lighting</div>
          <SceneTab />
        </>
      )}

      {category === 'weather' && (
        <>
          <div style={styles.heading}>Weather</div>
          <WeatherTab />
        </>
      )}

      {category === 'day_night' && (
        <>
          <div style={styles.heading}>Day/Night Cycle</div>
          <DayNightSettings />
        </>
      )}

      {category === 'vfx' && (
        <>
          <div style={styles.heading}>Particles (VFX)</div>
          <VfxTab />
        </>
      )}

      {category === 'backgrounds' && (
        <>
          <div style={styles.heading}>Backgrounds</div>
          <BackgroundTab />
        </>
      )}
    </div>
  );
}

// Extracted day/night section from SceneTab for standalone use
function DayNightSettings() {
  const dayNight = useSceneStore((s) => s.dayNight);
  const setDayNight = useSceneStore((s) => s.setDayNight);

  const inputStyle: React.CSSProperties = { flex: 1, padding: '3px 5px', fontSize: 12 };
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
  const section: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 };

  return (
    <div style={section}>
      <label style={{ ...row, fontSize: 13, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={dayNight.enabled}
          onChange={(e) => setDayNight({ enabled: e.target.checked })}
        />
        Enabled
      </label>
      {dayNight.enabled && (
        <>
          <div style={row}>
            <span style={{ fontSize: 12, minWidth: 80 }}>Speed</span>
            <NumberInput
              step={0.1}
              value={dayNight.cycle_speed}
              onChange={(v) => setDayNight({ cycle_speed: v })}
              style={inputStyle}
            />
          </div>
          <div style={row}>
            <span style={{ fontSize: 12, minWidth: 80 }}>Initial Time</span>
            <NumberInput
              step={0.05}
              min={0}
              max={1}
              value={dayNight.initial_time}
              onChange={(v) => setDayNight({ initial_time: v })}
              style={inputStyle}
            />
          </div>
          <span style={{ fontSize: 11, color: '#666' }}>
            {dayNight.keyframes.length} keyframes
          </span>
        </>
      )}
    </div>
  );
}
