import React, { useState } from 'react';
import { Vec3Input, useComponentRegistry } from '@gseurat/ui-kit';
import { useCharacterStore } from '../store/useCharacterStore.js';
import type { EasingType } from '../store/types.js';

const easingOptions: { value: EasingType; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in-out', label: 'Ease In/Out' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'elastic', label: 'Elastic' },
  { value: 'step', label: 'Step' },
  { value: 'custom', label: 'Custom' },
];

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    background: '#1e1e3a',
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
  const autoCenterJoint = useCharacterStore((s) => s.autoCenterJoint);
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
        <button
          style={{ padding: '2px 6px', fontSize: 10, background: '#3a3a5a', color: '#aaa', borderWidth: 1, borderStyle: 'solid', borderColor: '#555', borderRadius: 3, cursor: 'pointer' }}
          title="Center joint at voxel centroid"
          onClick={() => autoCenterJoint(currentPart.id)}
        >
          Auto
        </button>
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
  const updateKeyframeEasing = useCharacterStore((s) => s.updateKeyframeEasing);
  const updateAnimationDuration = useCharacterStore((s) => s.updateAnimationDuration);
  const updatePoseRotation = useCharacterStore((s) => s.updatePoseRotation);
  const updatePoseRootPosition = useCharacterStore((s) => s.updatePoseRootPosition);
  const addPose = useCharacterStore((s) => s.addPose);

  const [newPoseName, setNewPoseName] = useState('');

  if (!selectedAnimation) return null;
  const clip = animations[selectedAnimation];
  if (!clip) return null;

  // Find the active keyframe: the last keyframe at or before playback time,
  // or exact match within tolerance. Falls back to the first keyframe.
  const currentKf = (() => {
    const exact = clip.keyframes.find((kf) => Math.abs(kf.time - playbackTime) < 0.01);
    if (exact) return exact;
    // Find last keyframe at or before current time
    let best = clip.keyframes[0] ?? null;
    for (const kf of clip.keyframes) {
      if (kf.time <= playbackTime + 0.01) best = kf;
    }
    return best;
  })();
  const currentPose = currentKf ? characterPoses[currentKf.poseName] : null;

  return (
    <div style={styles.section}>
      <div style={styles.label}>Keyframes: {selectedAnimation}</div>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
        Duration:
        <input
          type="number"
          style={{ width: 50, padding: '1px 4px', background: '#2a2a4a', borderWidth: 1, borderStyle: 'solid', borderColor: '#444', borderRadius: 3, color: '#ddd', fontSize: 11 }}
          value={clip.duration}
          step={0.1}
          min={0.1}
          onChange={(e) => updateAnimationDuration(selectedAnimation!, Math.max(0.1, Number(e.target.value)))}
        />
        s | {clip.keyframes.length} keyframes
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
            addKeyframe(selectedAnimation, { time: playbackTime, poseName: newPoseName, easing: 'linear' });
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
              addKeyframe(selectedAnimation, { time: playbackTime, poseName: val, easing: 'linear' });
              (e.target as HTMLInputElement).value = '';
            }
          }}
        />
      </div>

      {/* Keyframe list */}
      {clip.keyframes.map((kf, i) => (
        <div key={i} style={{
          ...styles.row,
          flexWrap: 'wrap',
          background: currentKf === kf ? '#3a3a6a' : 'transparent',
          borderRadius: 4,
          padding: '2px 4px',
          gap: 4,
        }}>
          <span style={{ color: '#aaa', fontSize: 11, flex: 1, minWidth: 80 }}>
            t={kf.time.toFixed(2)}s - {kf.poseName}
          </span>
          <select
            style={{
              padding: '1px 4px',
              background: '#2a2a4a',
              border: '1px solid #444',
              borderRadius: 4,
              color: '#ddd',
              fontSize: 11,
              cursor: 'pointer',
            }}
            value={kf.easing}
            onChange={(e) => updateKeyframeEasing(selectedAnimation, i, e.target.value as EasingType)}
          >
            {easingOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            style={{ ...styles.btnDanger, padding: '1px 4px', fontSize: 10 }}
            onClick={() => removeKeyframe(selectedAnimation, i)}
          >
            X
          </button>
        </div>
      ))}

      {/* Root Position — shown when current clip has rootMotion enabled */}
      {currentPose && currentKf && clip?.rootMotion && (
        <div style={{ marginTop: 8, borderTop: '1px solid #333', paddingTop: 8 }}>
          <div style={styles.label}>Root Position</div>
          <Vec3Input
            value={currentPose.rootPosition ?? [0, 0, 0]}
            onChange={(v) => updatePoseRootPosition(currentKf.poseName, v)}
            step={0.1}
          />
        </div>
      )}

      {/* Per-bone rotations for current keyframe */}
      {currentPose && currentKf && (
        <div style={{ marginTop: 8 }}>
          <div style={styles.label}>Pose: {currentKf.poseName}</div>
          {parts.map((part) => {
            const rot: [number, number, number] = currentPose.rotations[part.id] ?? [0, 0, 0];
            return (
              <div key={part.id} style={{ marginBottom: 4 }}>
                <div style={{ color: '#aaa', fontSize: 11, marginBottom: 2 }}>{part.id}</div>
                <Vec3Input
                  value={rot}
                  onChange={(v) => updatePoseRotation(currentKf.poseName, part.id, v)}
                  step={1}
                  min={-180}
                  max={180}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AnimateRightPanel() {
  useComponentRegistry('AnimateRightPanel');
  return (
    <div style={styles.container}>
      <BoneProperties />
      <KeyframeEditor />
    </div>
  );
}
