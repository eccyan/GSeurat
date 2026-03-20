import React from 'react';
import { useSceneStore } from '../store/useSceneStore.js';
import type { InspectorTab } from '../store/types.js';
import { SceneTab } from './SceneTab.js';
import { LightsTab } from './LightsTab.js';
import { WeatherTab } from './WeatherTab.js';
import { VfxTab } from './VfxTab.js';
import { EntitiesTab } from './EntitiesTab.js';
import { BackgroundTab } from './BackgroundTab.js';
import { GaussianTab } from './GaussianTab.js';

const tabs: { id: InspectorTab; label: string }[] = [
  { id: 'scene', label: 'Scene' },
  { id: 'lights', label: 'Lights' },
  { id: 'weather', label: 'Weather' },
  { id: 'vfx', label: 'VFX' },
  { id: 'entities', label: 'Entities' },
  { id: 'backgrounds', label: 'BG' },
  { id: 'gaussian', label: 'GS' },
];

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 320,
    background: '#1e1e3a',
    borderLeft: '1px solid #333',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid #333',
    flexShrink: 0,
  },
  tab: {
    flex: 1,
    padding: '6px 4px',
    border: 'none',
    background: 'transparent',
    color: '#888',
    cursor: 'pointer',
    fontSize: 11,
    textAlign: 'center' as const,
  },
  tabActive: {
    color: '#fff',
    borderBottom: '2px solid #77f',
    background: '#2a2a4a',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: 12,
  },
};

export function Inspector() {
  const inspectorTab = useSceneStore((s) => s.inspectorTab);
  const setInspectorTab = useSceneStore((s) => s.setInspectorTab);

  return (
    <div style={styles.container}>
      <div style={styles.tabs}>
        {tabs.map((t) => (
          <button
            key={t.id}
            style={{ ...styles.tab, ...(inspectorTab === t.id ? styles.tabActive : {}) }}
            onClick={() => setInspectorTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={styles.content}>
        {inspectorTab === 'scene' && <SceneTab />}
        {inspectorTab === 'lights' && <LightsTab />}
        {inspectorTab === 'weather' && <WeatherTab />}
        {inspectorTab === 'vfx' && <VfxTab />}
        {inspectorTab === 'entities' && <EntitiesTab />}
        {inspectorTab === 'backgrounds' && <BackgroundTab />}
        {inspectorTab === 'gaussian' && <GaussianTab />}
      </div>
    </div>
  );
}
