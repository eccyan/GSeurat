import React from 'react';
import { useSceneStore } from '../store/useSceneStore.js';
import type { SettingsCategory } from '../store/types.js';

const categories: { id: SettingsCategory; label: string }[] = [
  { id: 'gs_camera', label: 'GS Camera & Render' },
  { id: 'ambient', label: 'Ambient & Lighting' },
  { id: 'weather', label: 'Weather' },
  { id: 'day_night', label: 'Day/Night Cycle' },
  { id: 'vfx', label: 'Particles (VFX)' },
  { id: 'backgrounds', label: 'Backgrounds' },
];

const styles: Record<string, React.CSSProperties> = {
  item: {
    display: 'block',
    width: '100%',
    padding: '8px 12px',
    border: 'none',
    borderRadius: 4,
    background: 'transparent',
    color: '#aaa',
    cursor: 'pointer',
    fontSize: 13,
    textAlign: 'left' as const,
    marginBottom: 2,
  },
  itemActive: {
    background: '#3a3a6a',
    color: '#fff',
  },
};

export function SettingsLeftPanel() {
  const selected = useSceneStore((s) => s.selectedSettingsCategory);
  const setSelected = useSceneStore((s) => s.setSelectedSettingsCategory);

  return (
    <div>
      {categories.map((cat) => (
        <button
          key={cat.id}
          style={{
            ...styles.item,
            ...(selected === cat.id ? styles.itemActive : {}),
          }}
          onClick={() => setSelected(cat.id)}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
}
