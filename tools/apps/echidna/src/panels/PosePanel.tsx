import React, { useState } from 'react';
import { useCharacterStore } from '../store/useCharacterStore.js';

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 12 },
  section: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  input: {
    flex: 1, padding: '4px 6px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 13,
  },
  btn: {
    padding: '4px 10px', border: '1px solid #555', borderRadius: 4,
    background: '#3a3a6a', color: '#ddd', cursor: 'pointer', fontSize: 12,
  },
  btnDanger: {
    padding: '4px 10px', border: '1px solid #844', borderRadius: 4,
    background: '#4a2a2a', color: '#ddd', cursor: 'pointer', fontSize: 12,
  },
  poseItem: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '4px 8px', borderRadius: 4, fontSize: 12,
  },
  poseSelected: { background: '#3a3a6a' },
  numInput: {
    width: 50, padding: '2px 4px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 12, textAlign: 'center' as const,
  },
};

export function PosePanel() {
  const parts = useCharacterStore((s) => s.asset?.characterParts ?? []);
  const poses = useCharacterStore((s) => s.asset?.characterPoses ?? {});
  const selectedPose = useCharacterStore((s) => s.selectedPose);
  const setSelectedPose = useCharacterStore((s) => s.setSelectedPose);
  const addPose = useCharacterStore((s) => s.addPose);
  const removePose = useCharacterStore((s) => s.removePose);
  const updatePoseRotation = useCharacterStore((s) => s.updatePoseRotation);
  const previewPose = useCharacterStore((s) => s.previewPose);
  const setPreviewPose = useCharacterStore((s) => s.setPreviewPose);

  const [newPoseName, setNewPoseName] = useState('');

  const currentPose = selectedPose ? poses[selectedPose] : null;

  return (
    <div style={styles.container}>
      {/* Pose list */}
      <div style={styles.section}>
        <div style={styles.label}>Poses</div>
        <div style={{ border: '1px solid #333', borderRadius: 4, padding: 4, maxHeight: 150, overflowY: 'auto' }}>
          {Object.keys(poses).length === 0 ? (
            <div style={{ color: '#666', fontSize: 11, padding: 4 }}>No poses defined</div>
          ) : (
            Object.keys(poses).map((name) => (
              <div
                key={name}
                style={{
                  ...styles.poseItem,
                  ...(selectedPose === name ? styles.poseSelected : {}),
                }}
              >
                <span
                  style={{ color: '#ddd', cursor: 'pointer', flex: 1 }}
                  onClick={() => setSelectedPose(name)}
                >
                  {name}
                </span>
                <button
                  style={{ ...styles.btnDanger, padding: '2px 6px', fontSize: 10 }}
                  onClick={() => removePose(name)}
                >
                  X
                </button>
              </div>
            ))
          )}
        </div>
        <div style={styles.row}>
          <input
            style={styles.input}
            value={newPoseName}
            onChange={(e) => setNewPoseName(e.target.value)}
            placeholder="pose name"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newPoseName.trim()) {
                addPose(newPoseName.trim());
                setNewPoseName('');
              }
            }}
          />
          <button
            style={styles.btn}
            onClick={() => {
              if (newPoseName.trim()) {
                addPose(newPoseName.trim());
                setNewPoseName('');
              }
            }}
          >
            + Add
          </button>
        </div>
      </div>

      {/* Pose editor */}
      {currentPose && selectedPose && (
        <div style={styles.section}>
          <div style={styles.label}>Pose: {selectedPose}</div>
          <div style={styles.row}>
            <label style={{ color: '#ddd', fontSize: 12 }}>
              <input
                type="checkbox"
                checked={previewPose}
                onChange={(e) => setPreviewPose(e.target.checked)}
              />
              {' '}Preview
            </label>
          </div>
          {parts.map((part) => {
            const rot = currentPose.rotations[part.id] ?? [0, 0, 0];
            return (
              <div key={part.id} style={{ marginBottom: 4 }}>
                <div style={{ color: '#aaa', fontSize: 11, marginBottom: 2 }}>{part.id}</div>
                <div style={styles.row}>
                  {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                    <React.Fragment key={axis}>
                      <span style={{ color: '#666', fontSize: 10 }}>{axis}</span>
                      <input
                        type="number"
                        style={styles.numInput}
                        value={rot[i]}
                        onChange={(e) => {
                          const r: [number, number, number] = [...rot];
                          r[i] = Number(e.target.value);
                          updatePoseRotation(selectedPose, part.id, r);
                        }}
                      />
                    </React.Fragment>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
