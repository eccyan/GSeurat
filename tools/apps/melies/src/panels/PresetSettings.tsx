import React from 'react';
import { useVfxStore } from '../store/useVfxStore.js';
import { NumberInput } from '../components/NumberInput.js';
import { T, inputStyle, sectionLabel } from '../styles/theme.js';

export function PresetSettings() {
  const preset = useVfxStore((s) => {
    return s.presets.find((p) => p.id === s.selectedPresetId);
  });
  const updatePreset = useVfxStore((s) => s.updatePreset);

  if (!preset) {
    return (
      <div style={{
        width: 280, background: T.panel, borderLeft: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: T.textMuted, fontSize: 12, padding: 16, textAlign: 'center',
      }}>
        Select a VFX preset to edit its settings
      </div>
    );
  }

  return (
    <div style={{
      width: 280, background: T.panel, borderLeft: `1px solid ${T.border}`,
      overflowY: 'auto', padding: 12,
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        paddingBottom: 8, borderBottom: `1px solid ${T.border}`,
      }}>
        <span style={{ fontSize: 14 }}>&#9881;</span>
        <span style={{ fontSize: 11, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}>
          Preset Settings
        </span>
      </div>

      {/* Name */}
      <div>
        <label style={sectionLabel}>Name</label>
        <input
          type="text"
          value={preset.name}
          onChange={(e) => updatePreset(preset.id, { name: e.target.value })}
          style={inputStyle}
        />
      </div>

      {/* Duration */}
      <div>
        <label style={sectionLabel}>Duration (s)</label>
        <NumberInput
          value={preset.duration}
          min={0.1}
          step={0.5}
          onChange={(v) => updatePreset(preset.id, { duration: v })}
          style={{ ...inputStyle, width: 'auto' }}
        />
        <div style={{ marginTop: 4, fontSize: 9, color: T.textMuted }}>
          Total playback length for this VFX preset
        </div>
      </div>
    </div>
  );
}
