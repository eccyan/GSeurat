import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getPose } from '../../lib/pose-templates.js';
import { useSeuratStore } from '../../store/useSeuratStore.js';

interface Props {
  animName: string;
  frameCount: number;
}

type Keypoint = [number, number] | null;

const LIMBS: [number, number, string][] = [
  [0, 1, '#ff0000'],
  [1, 2, '#ff5500'],
  [2, 3, '#ffaa00'],
  [3, 4, '#ffff00'],
  [1, 5, '#00ff00'],
  [5, 6, '#00ff55'],
  [6, 7, '#00ffaa'],
  [1, 8, '#00ffff'],
  [8, 9, '#00aaff'],
  [9, 10, '#0055ff'],
  [1, 11, '#0000ff'],
  [11, 12, '#5500ff'],
  [12, 13, '#aa00ff'],
];

const KP_NAMES = [
  'nose', 'neck', 'r_shoulder', 'r_elbow', 'r_wrist',
  'l_shoulder', 'l_elbow', 'l_wrist',
  'r_hip', 'r_knee', 'r_ankle', 'l_hip', 'l_knee', 'l_ankle',
];

const CELL = 128;
const HIT_RADIUS = 8;

export function PosePreview({ animName, frameCount }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseOverrides = useSeuratStore((s) => s.poseOverrides);
  const setPoseOverride = useSeuratStore((s) => s.setPoseOverride);
  const clearPoseOverride = useSeuratStore((s) => s.clearPoseOverride);
  const clearAllPoseOverrides = useSeuratStore((s) => s.clearAllPoseOverrides);

  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [hoveredKp, setHoveredKp] = useState<number | null>(null);

  const getEffectivePose = useCallback((frameIndex: number): Keypoint[] | null => {
    const key = `${animName}:${frameIndex}`;
    return poseOverrides[key] ?? getPose(animName, frameIndex);
  }, [animName, poseOverrides]);

  const poses = Array.from({ length: frameCount }, (_, i) => getEffectivePose(i));
  const hasPoses = poses.some((p) => p !== null);

  const hasAnyOverride = Object.keys(poseOverrides).some((k) => k.startsWith(`${animName}:`));

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = CELL * frameCount;
    canvas.width = w;
    canvas.height = CELL;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, CELL);

    const lineWidth = 3;
    const dotRadius = 4;

    for (let f = 0; f < frameCount; f++) {
      const pose = poses[f];
      if (!pose) continue;
      const ox = f * CELL;

      // Highlight selected frame
      if (f === selectedFrame) {
        ctx.fillStyle = '#1a1a3a';
        ctx.fillRect(ox, 0, CELL, CELL);
        ctx.strokeStyle = '#4a8af8';
        ctx.lineWidth = 2;
        ctx.strokeRect(ox + 1, 1, CELL - 2, CELL - 2);
      }

      // Draw limbs
      for (const [i, j, color] of LIMBS) {
        const a = pose[i];
        const b = pose[j];
        if (!a || !b) continue;
        ctx.strokeStyle = f === selectedFrame ? color : `${color}88`;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ox + a[0] * CELL, a[1] * CELL);
        ctx.lineTo(ox + b[0] * CELL, b[1] * CELL);
        ctx.stroke();
      }

      // Draw keypoint dots
      for (let k = 0; k < pose.length; k++) {
        const kp = pose[k];
        if (!kp) continue;
        const isHovered = f === selectedFrame && k === hoveredKp;
        const isActive = f === selectedFrame;
        ctx.fillStyle = isHovered ? '#ffff00' : isActive ? '#ffffff' : '#ffffff88';
        ctx.beginPath();
        ctx.arc(ox + kp[0] * CELL, kp[1] * CELL, isHovered ? dotRadius + 2 : dotRadius, 0, Math.PI * 2);
        ctx.fill();
        if (isActive) {
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Frame label
      ctx.fillStyle = f === selectedFrame ? '#aaa' : '#555';
      ctx.font = '9px monospace';
      ctx.fillText(`f${f}`, ox + 3, 10);

      // Override indicator
      if (poseOverrides[`${animName}:${f}`]) {
        ctx.fillStyle = '#f8a04a';
        ctx.fillText('*', ox + CELL - 10, 10);
      }
    }

    // Draw hovered keypoint name
    if (selectedFrame !== null && hoveredKp !== null) {
      const pose = poses[selectedFrame];
      const kp = pose?.[hoveredKp];
      if (kp) {
        const ox = selectedFrame * CELL;
        ctx.fillStyle = '#ffff00';
        ctx.font = '8px monospace';
        ctx.fillText(KP_NAMES[hoveredKp], ox + kp[0] * CELL + 6, kp[1] * CELL - 4);
      }
    }
  }, [poses, selectedFrame, hoveredKp, frameCount, animName, poseOverrides]);

  useEffect(() => { draw(); }, [draw]);

  const getCanvasPos = (e: React.MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const findKeypoint = (pos: { x: number; y: number }): { frame: number; kpIdx: number } | null => {
    const frame = Math.floor(pos.x / CELL);
    if (frame < 0 || frame >= frameCount) return null;
    const pose = poses[frame];
    if (!pose) return null;
    const ox = frame * CELL;

    let closest: { kpIdx: number; dist: number } | null = null;
    for (let k = 0; k < pose.length; k++) {
      const kp = pose[k];
      if (!kp) continue;
      const dx = (ox + kp[0] * CELL) - pos.x;
      const dy = (kp[1] * CELL) - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < HIT_RADIUS && (!closest || dist < closest.dist)) {
        closest = { kpIdx: k, dist };
      }
    }
    return closest ? { frame, kpIdx: closest.kpIdx } : null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getCanvasPos(e);
    const frame = Math.floor(pos.x / CELL);
    if (frame < 0 || frame >= frameCount) return;

    setSelectedFrame(frame);

    const hit = findKeypoint(pos);
    if (hit && hit.frame === frame) {
      setDragging(hit.kpIdx);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pos = getCanvasPos(e);

    if (dragging !== null && selectedFrame !== null) {
      const pose = poses[selectedFrame];
      if (!pose) return;
      const ox = selectedFrame * CELL;
      const nx = Math.max(0, Math.min(1, (pos.x - ox) / CELL));
      const ny = Math.max(0, Math.min(1, pos.y / CELL));
      const newPose = pose.map((kp, i) =>
        i === dragging ? [nx, ny] as [number, number] : kp ? [...kp] as [number, number] : null
      );
      setPoseOverride(animName, selectedFrame, newPose);
      return;
    }

    // Hover detection
    const hit = findKeypoint(pos);
    if (hit && hit.frame === selectedFrame) {
      setHoveredKp(hit.kpIdx);
    } else {
      setHoveredKp(null);
    }
  };

  const handleMouseUp = () => {
    setDragging(null);
  };

  const handleMouseLeave = () => {
    setDragging(null);
    setHoveredKp(null);
  };

  if (!hasPoses) {
    return (
      <div style={styles.noPose}>
        No pose template for "{animName}"
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.label}>Pose Skeletons</span>
        <span style={styles.sub}>{frameCount} frames</span>
        <span style={styles.hint}>
          {selectedFrame !== null ? `f${selectedFrame} selected — drag keypoints to edit` : 'click a frame to edit'}
        </span>
        {selectedFrame !== null && poseOverrides[`${animName}:${selectedFrame}`] && (
          <button
            onClick={() => clearPoseOverride(animName, selectedFrame)}
            style={styles.resetBtn}
          >
            Reset f{selectedFrame}
          </button>
        )}
        {hasAnyOverride && (
          <button
            onClick={() => clearAllPoseOverrides(animName)}
            style={styles.resetBtn}
          >
            Reset All
          </button>
        )}
      </div>
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{
          borderRadius: 4,
          cursor: dragging !== null ? 'grabbing' : hoveredKp !== null ? 'grab' : 'default',
          maxWidth: '100%',
        }}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  label: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#aaa',
    fontWeight: 600,
  },
  sub: {
    fontSize: 9,
    color: '#555',
    fontFamily: 'monospace',
  },
  hint: {
    fontSize: 8,
    color: '#666',
    fontFamily: 'monospace',
    fontStyle: 'italic',
  },
  noPose: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#555',
    padding: '4px 0',
  },
  resetBtn: {
    background: '#2a2a3a',
    border: '1px solid #444',
    borderRadius: 3,
    color: '#888',
    fontFamily: 'monospace',
    fontSize: 8,
    padding: '1px 6px',
    cursor: 'pointer',
  },
};
