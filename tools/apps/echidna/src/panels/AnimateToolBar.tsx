import React, { useMemo } from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { useCharacterStore } from '../store/useCharacterStore.js';
import type { ToolType, VoxelKey } from '../store/types.js';

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
  actionBtn: {
    padding: '6px 10px', borderWidth: 1, borderStyle: 'solid' as const,
    borderColor: '#555', borderRadius: 4, background: '#3a3a6a', color: '#ddd',
    cursor: 'pointer', fontSize: 13, textAlign: 'center' as const,
  },
  actionBtnPrimary: {
    background: '#4a4a8a', borderColor: '#77f', color: '#fff',
  },
  actionBtnDisabled: {
    opacity: 0.4, cursor: 'not-allowed',
  },
  countDisplay: {
    fontSize: 12, color: '#aaa',
    padding: '4px 8px', background: '#16162a', borderRadius: 4,
    textAlign: 'center' as const,
  },
};

export function AnimateToolBar() {
  useComponentRegistry('AnimateToolBar');
  const activeTool = useCharacterStore((s) => s.activeTool);
  const setTool = useCharacterStore((s) => s.setTool);
  const parts = useCharacterStore((s) => s.asset?.characterParts ?? []);
  const selectedPart = useCharacterStore((s) => s.selectedPart);
  const setSelectedPart = useCharacterStore((s) => s.setSelectedPart);
  const boxSelection = useCharacterStore((s) => s.boxSelection);
  const lassoSelection = useCharacterStore((s) => s.lassoSelection);
  const assignVoxelsToPart = useCharacterStore((s) => s.assignVoxelsToPart);
  const unassignVoxelsFromPart = useCharacterStore((s) => s.unassignVoxelsFromPart);
  const setBoxSelection = useCharacterStore((s) => s.setBoxSelection);
  const setLassoSelection = useCharacterStore((s) => s.setLassoSelection);
  const pushUndo = useCharacterStore((s) => s.pushUndo);

  const hasBones = parts.length > 0;

  const selection = useMemo<VoxelKey[]>(() => {
    const s = new Set<VoxelKey>();
    if (boxSelection) for (const k of boxSelection) s.add(k);
    if (lassoSelection) for (const k of lassoSelection) s.add(k);
    return Array.from(s);
  }, [boxSelection, lassoSelection]);

  const selectionCount = selection.length;
  const canCommit = selectionCount > 0 && selectedPart !== null;
  const canClear = selectionCount > 0;

  const clearSelection = () => {
    setBoxSelection(null);
    setLassoSelection(null);
  };

  const handleAssign = () => {
    if (!canCommit || !selectedPart) return;
    pushUndo();
    assignVoxelsToPart(selection, selectedPart);
    clearSelection();
  };

  const handleUnassign = () => {
    if (!canCommit || !selectedPart) return;
    pushUndo();
    unassignVoxelsFromPart(selection, selectedPart);
    clearSelection();
  };

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

      <div style={styles.section}>
        <span style={styles.label}>Selection</span>
        <div style={styles.countDisplay}>
          {selectionCount === 0 ? 'No selection' : `${selectionCount} voxels selected`}
        </div>
        <button
          style={{
            ...styles.actionBtn,
            ...styles.actionBtnPrimary,
            ...(!canCommit ? styles.actionBtnDisabled : {}),
          }}
          onClick={handleAssign}
          disabled={!canCommit}
        >
          Assign to Bone
        </button>
        <button
          style={{
            ...styles.actionBtn,
            ...(!canCommit ? styles.actionBtnDisabled : {}),
          }}
          onClick={handleUnassign}
          disabled={!canCommit}
        >
          Unassign
        </button>
        <button
          style={{
            ...styles.actionBtn,
            ...(!canClear ? styles.actionBtnDisabled : {}),
          }}
          onClick={clearSelection}
          disabled={!canClear}
        >
          Clear Selection
        </button>
      </div>
    </div>
  );
}
