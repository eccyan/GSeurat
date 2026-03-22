import React, { useState } from 'react';
import { useCharacterStore } from '../store/useCharacterStore.js';

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 280,
    background: '#1e1e3a',
    borderLeft: '1px solid #333',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    overflowY: 'auto',
  },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  input: {
    flex: 1, padding: '4px 6px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 13,
  },
  numInput: {
    width: 50, padding: '2px 4px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 12, textAlign: 'center' as const,
  },
  btn: {
    padding: '4px 10px', border: '1px solid #555', borderRadius: 4,
    background: '#3a3a6a', color: '#ddd', cursor: 'pointer', fontSize: 12,
  },
  btnDanger: {
    padding: '4px 10px', border: '1px solid #844', borderRadius: 4,
    background: '#4a2a2a', color: '#ddd', cursor: 'pointer', fontSize: 12,
  },
};

function BoneProperties() {
  const parts = useCharacterStore((s) => s.characterParts);
  const selectedPart = useCharacterStore((s) => s.selectedPart);
  const updatePartJoint = useCharacterStore((s) => s.updatePartJoint);
  const setPartParent = useCharacterStore((s) => s.setPartParent);

  const currentPart = parts.find((p) => p.id === selectedPart) ?? null;
  if (!currentPart) return null;

  return (
    <div style={styles.section}>
      <div style={styles.label}>Bone: {currentPart.id}</div>

      <div style={styles.row}>
        <span style={{ color: '#888', fontSize: 11, width: 40 }}>Parent:</span>
        <select
          style={{ ...styles.input, flex: 1 }}
          value={currentPart.parent ?? ''}
          onChange={(e) => setPartParent(currentPart.id, e.target.value || null)}
        >
          <option value="">(root)</option>
          {parts
            .filter((p) => p.id !== currentPart.id)
            .map((p) => (
              <option key={p.id} value={p.id}>{p.id}</option>
            ))}
        </select>
      </div>

      <div style={styles.row}>
        <span style={{ color: '#888', fontSize: 11, width: 40 }}>Joint:</span>
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <React.Fragment key={axis}>
            <span style={{ color: '#666', fontSize: 10 }}>{axis}</span>
            <input
              type="number"
              style={styles.numInput}
              value={currentPart.joint[i]}
              onChange={(e) => {
                const j: [number, number, number] = [...currentPart.joint];
                j[i] = Number(e.target.value);
                updatePartJoint(currentPart.id, j);
              }}
            />
          </React.Fragment>
        ))}
      </div>

      <div style={{ color: '#666', fontSize: 10 }}>
        {currentPart.voxelKeys.length} voxels assigned
      </div>
    </div>
  );
}

function KeyframeEditor() {
  const parts = useCharacterStore((s) => s.characterParts);
  const selectedAnimation = useCharacterStore((s) => s.selectedAnimation);
  const animations = useCharacterStore((s) => s.animations);
  const playbackTime = useCharacterStore((s) => s.playbackTime);
  const characterPoses = useCharacterStore((s) => s.characterPoses);
  const addKeyframe = useCharacterStore((s) => s.addKeyframe);
  const removeKeyframe = useCharacterStore((s) => s.removeKeyframe);
  const updatePoseRotation = useCharacterStore((s) => s.updatePoseRotation);
  const addPose = useCharacterStore((s) => s.addPose);

  const [newPoseName, setNewPoseName] = useState('');

  if (!selectedAnimation) return null;
  const clip = animations[selectedAnimation];
  if (!clip) return null;

  // Find currently selected keyframe (closest to playback time)
  const currentKf = clip.keyframes.find((kf) => Math.abs(kf.time - playbackTime) < 0.01);
  const currentPose = currentKf ? characterPoses[currentKf.poseName] : null;

  return (
    <div style={styles.section}>
      <div style={styles.label}>Keyframes: {selectedAnimation}</div>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
        Duration: {clip.duration}s | {clip.keyframes.length} keyframes
      </div>

      {/* Add keyframe */}
      <div style={styles.row}>
        <select
          style={{ ...styles.input, flex: 1 }}
          value={newPoseName}
          onChange={(e) => setNewPoseName(e.target.value)}
        >
          <option value="">Select pose...</option>
          {Object.keys(characterPoses).map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <button
          style={styles.btn}
          onClick={() => {
            if (!newPoseName) return;
            addKeyframe(selectedAnimation, { time: playbackTime, poseName: newPoseName });
          }}
        >
          + KF
        </button>
      </div>

      {/* Quick create pose + keyframe */}
      <div style={styles.row}>
        <input
          style={styles.input}
          placeholder="new pose name"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const val = (e.target as HTMLInputElement).value.trim();
              if (!val) return;
              addPose(val);
              addKeyframe(selectedAnimation, { time: playbackTime, poseName: val });
              (e.target as HTMLInputElement).value = '';
            }
          }}
        />
      </div>

      {/* Keyframe list */}
      {clip.keyframes.map((kf, i) => (
        <div key={i} style={{
          ...styles.row,
          background: currentKf === kf ? '#3a3a6a' : 'transparent',
          borderRadius: 4,
          padding: '2px 4px',
        }}>
          <span style={{ color: '#aaa', fontSize: 11, flex: 1 }}>
            t={kf.time.toFixed(2)}s - {kf.poseName}
          </span>
          <button
            style={{ ...styles.btnDanger, padding: '1px 4px', fontSize: 10 }}
            onClick={() => removeKeyframe(selectedAnimation, i)}
          >
            X
          </button>
        </div>
      ))}

      {/* Per-bone rotations for current keyframe */}
      {currentPose && currentKf && (
        <div style={{ marginTop: 8 }}>
          <div style={styles.label}>Pose: {currentKf.poseName}</div>
          {parts.map((part) => {
            const rot = currentPose.rotations[part.id] ?? [0, 0, 0];
            return (
              <div key={part.id} style={{ marginBottom: 4 }}>
                <div style={{ color: '#aaa', fontSize: 11, marginBottom: 2 }}>{part.id}</div>
                <div style={styles.row}>
                  {(['X', 'Y', 'Z'] as const).map((axis, j) => (
                    <React.Fragment key={axis}>
                      <span style={{ color: '#666', fontSize: 10 }}>{axis}</span>
                      <input
                        type="number"
                        style={styles.numInput}
                        value={rot[j]}
                        onChange={(e) => {
                          const r: [number, number, number] = [...rot];
                          r[j] = Number(e.target.value);
                          updatePoseRotation(currentKf.poseName, part.id, r);
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

export function AnimateRightPanel() {
  return (
    <div style={styles.container}>
      <BoneProperties />
      <KeyframeEditor />
    </div>
  );
}
