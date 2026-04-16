import React from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { useCharacterStore } from '../store/useCharacterStore.js';
import type { ToolType } from '../store/types.js';

const tools: { id: ToolType; label: string; key: string }[] = [
  { id: 'orbit', label: 'Orbit', key: 'Q' },
  { id: 'assign_part', label: 'Assign Part', key: 'A' },
  { id: 'box_select', label: 'Box Select', key: 'S' },
  { id: 'lasso_select', label: 'Lasso', key: 'L' },
];

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#1e1e3a',
    borderBottom: '1px solid #333',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  section: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: {
    fontSize: 11, color: '#888', textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  toolBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 10px', borderWidth: 1, borderStyle: 'solid' as const,
    borderColor: '#444', borderRadius: 4, background: '#2a2a4a', color: '#ddd',
    cursor: 'pointer', fontSize: 13,
  },
  toolBtnActive: { background: '#4a4a8a', borderColor: '#77f' },
  shortcut: { fontSize: 11, color: '#777' },
  select: {
    padding: '6px 8px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 13,
  },
  selectDisabled: { opacity: 0.5, cursor: 'not-allowed' },
};

export function AnimateToolBar() {
  useComponentRegistry('AnimateToolBar');
  const activeTool = useCharacterStore((s) => s.activeTool);
  const setTool = useCharacterStore((s) => s.setTool);
  const parts = useCharacterStore((s) => s.asset?.characterParts ?? []);
  const selectedPart = useCharacterStore((s) => s.selectedPart);
  const setSelectedPart = useCharacterStore((s) => s.setSelectedPart);
  const hasBones = parts.length > 0;

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <span style={styles.label}>Tools</span>
        {tools.map((t) => (
          <button
            key={t.id}
            style={{ ...styles.toolBtn, ...(activeTool === t.id ? styles.toolBtnActive : {}) }}
            onClick={() => setTool(t.id)}
          >
            {t.label}
            <span style={styles.shortcut}>{t.key}</span>
          </button>
        ))}
      </div>
      <div style={styles.section}>
        <span style={styles.label}>Target Bone</span>
        <select
          style={{ ...styles.select, ...(!hasBones ? styles.selectDisabled : {}) }}
          value={selectedPart ?? ''}
          onChange={(e) => setSelectedPart(e.target.value || null)}
          disabled={!hasBones}
        >
          {!hasBones && <option value="">No bones</option>}
          {hasBones && <option value="">(none)</option>}
          {parts.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
