import React from 'react';
import type { Section } from '../../store/types.js';
import { useSeuratStore } from '../../store/useSeuratStore.js';

const NAV_ITEMS: Array<{ section: Section; icon: string; label: string }> = [
  { section: 'dashboard', icon: 'D', label: 'Dash' },
  { section: 'concept', icon: 'C', label: 'Cncpt' },
  { section: 'generate', icon: 'G', label: 'Gen' },
  { section: 'review', icon: 'R', label: 'Review' },
  { section: 'animate', icon: 'A', label: 'Anim' },
  { section: 'atlas', icon: 'T', label: 'Atlas' },
  { section: 'manifest', icon: 'M', label: 'Mnfst' },
];

export function Sidebar() {
  const activeSection = useSeuratStore((s) => s.activeSection);
  const selectedCharacterId = useSeuratStore((s) => s.selectedCharacterId);
  const setActiveSection = useSeuratStore((s) => s.setActiveSection);

  return (
    <div style={styles.sidebar}>
      {NAV_ITEMS.map(({ section, icon, label }) => {
        const active = activeSection === section;
        const disabled = section !== 'dashboard' && !selectedCharacterId;
        return (
          <button
            key={section}
            onClick={() => !disabled && setActiveSection(section)}
            style={{
              ...styles.navBtn,
              background: active ? '#1e2a42' : 'transparent',
              borderLeft: active ? '3px solid #4a8af8' : '3px solid transparent',
              opacity: disabled ? 0.3 : 1,
              cursor: disabled ? 'default' : 'pointer',
            }}
            title={disabled ? 'Select a character first' : label}
          >
            <span style={styles.icon}>{icon}</span>
            <span style={styles.label}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 56,
    background: '#111120',
    borderRight: '1px solid #2a2a3a',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    paddingTop: 4,
    overflow: 'hidden',
  },
  navBtn: {
    border: 'none',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '8px 2px',
    gap: 2,
    color: '#999',
  },
  icon: {
    fontSize: 14,
    fontWeight: 700,
    fontFamily: 'monospace',
    color: '#90b8f8',
  },
  label: {
    fontSize: 8,
    fontFamily: 'monospace',
    color: '#666',
    letterSpacing: '0.02em',
  },
};
