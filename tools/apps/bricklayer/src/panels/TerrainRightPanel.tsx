import React from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { useSceneStore } from '../store/useSceneStore.js';

const styles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  info: { fontSize: 12, color: '#aaa' },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  colorSwatch: {
    width: 20, height: 20, borderRadius: 3, border: '1px solid #666', flexShrink: 0,
  },
  input: { width: 60, padding: '3px 5px', fontSize: 12 },
};

export function TerrainRightPanel() {
  const voxels = useSceneStore((s) => s.voxels);
  const gridWidth = useSceneStore((s) => s.gridWidth);
  const gridDepth = useSceneStore((s) => s.gridDepth);
  const selectedVoxel = useSceneStore((s) => s.selectedVoxel);
  const yClipMin = useSceneStore((s) => s.yClipMin);
  const yClipMax = useSceneStore((s) => s.yClipMax);
  const mirrorX = useSceneStore((s) => s.mirrorX);
  const mirrorZ = useSceneStore((s) => s.mirrorZ);
  const setYClipMin = useSceneStore((s) => s.setYClipMin);
  const setYClipMax = useSceneStore((s) => s.setYClipMax);
  const setMirrorX = useSceneStore((s) => s.setMirrorX);
  const setMirrorZ = useSceneStore((s) => s.setMirrorZ);

  return (
    <div>
      {/* Terrain info */}
      <div style={styles.section}>
        <span style={styles.label}>Terrain Info</span>
        <span style={styles.info}>
          Grid: {gridWidth} x {gridDepth}
        </span>
        <span style={styles.info}>
          Voxels: {voxels.size.toLocaleString()}
        </span>
      </div>

      {/* Selected voxel info */}
      {selectedVoxel && (
        <div style={styles.section}>
          <span style={styles.label}>Selected Voxel</span>
          <span style={styles.info}>
            Position: ({selectedVoxel.x}, {selectedVoxel.y}, {selectedVoxel.z})
          </span>
          <div style={styles.row}>
            <span style={styles.info}>Color:</span>
            <div style={{
              ...styles.colorSwatch,
              background: `rgba(${selectedVoxel.color.join(',')})`,
            }} />
            <span style={{ fontSize: 11, color: '#777' }}>
              {selectedVoxel.color[0]}, {selectedVoxel.color[1]}, {selectedVoxel.color[2]}, {selectedVoxel.color[3]}
            </span>
          </div>
        </div>
      )}

      {/* Y-Clip */}
      <div style={styles.section}>
        <span style={styles.label}>Y-Clip</span>
        <div style={styles.row}>
          <NumberInput label="Min" value={yClipMin} min={0} max={yClipMax} onChange={setYClipMin} style={styles.input} />
          <NumberInput label="Max" value={yClipMax} min={yClipMin} max={255} onChange={setYClipMax} style={styles.input} />
        </div>
      </div>

      {/* Mirror */}
      <div style={styles.section}>
        <span style={styles.label}>Mirror</span>
        <label style={{ ...styles.row, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={mirrorX} onChange={(e) => setMirrorX(e.target.checked)} />
          Mirror X
        </label>
        <label style={{ ...styles.row, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={mirrorZ} onChange={(e) => setMirrorZ(e.target.checked)} />
          Mirror Z
        </label>
      </div>
    </div>
  );
}
