import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getPose } from '../../lib/pose-templates.js';
import { useSeuratStore } from '../../store/useSeuratStore.js';

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

const CANVAS_SIZE = 256;
const HIT_RADIUS = 10;
const DOT_RADIUS = 5;
const LINE_WIDTH = 3;

interface Props {
  animName: string;
  frameIndex: number;
  title: string;
  onClose: () => void;
}

export function SinglePoseEditor({ animName, frameIndex, title, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseOverrides = useSeuratStore((s) => s.poseOverrides);
  const setPoseOverride = useSeuratStore((s) => s.setPoseOverride);
  const clearPoseOverride = useSeuratStore((s) => s.clearPoseOverride);

  const [dragging, setDragging] = useState<number | null>(null);
  const [hoveredKp, setHoveredKp] = useState<number | null>(null);

  const key = `${animName}:${frameIndex}`;
  const hasOverride = !!poseOverrides[key];

  const getPoseData = useCallback((): Keypoint[] | null => {
    return poseOverrides[key] ?? getPose(animName, frameIndex);
  }, [animName, frameIndex, poseOverrides, key]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const pose = getPoseData();
    if (!pose) {
      ctx.fillStyle = '#555';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No pose template', CANVAS_SIZE / 2, CANVAS_SIZE / 2);
      return;
    }

    // Draw limbs
    for (const [i, j, color] of LIMBS) {
      const a = pose[i];
      const b = pose[j];
      if (!a || !b) continue;
      ctx.strokeStyle = color;
      ctx.lineWidth = LINE_WIDTH;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a[0] * CANVAS_SIZE, a[1] * CANVAS_SIZE);
      ctx.lineTo(b[0] * CANVAS_SIZE, b[1] * CANVAS_SIZE);
      ctx.stroke();
    }

    // Draw keypoint dots
    for (let k = 0; k < pose.length; k++) {
      const kp = pose[k];
      if (!kp) continue;
      const isHovered = k === hoveredKp;
      ctx.fillStyle = isHovered ? '#ffff00' : '#ffffff';
      ctx.beginPath();
      ctx.arc(
        kp[0] * CANVAS_SIZE,
        kp[1] * CANVAS_SIZE,
        isHovered ? DOT_RADIUS + 2 : DOT_RADIUS,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw hovered keypoint name
    if (hoveredKp !== null) {
      const kp = pose[hoveredKp];
      if (kp) {
        ctx.fillStyle = '#ffff00';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(KP_NAMES[hoveredKp], kp[0] * CANVAS_SIZE + 8, kp[1] * CANVAS_SIZE - 6);
      }
    }
  }, [getPoseData, hoveredKp]);

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

  const findKeypoint = (pos: { x: number; y: number }): number | null => {
    const pose = getPoseData();
    if (!pose) return null;
    let closest: { idx: number; dist: number } | null = null;
    for (let k = 0; k < pose.length; k++) {
      const kp = pose[k];
      if (!kp) continue;
      const dx = kp[0] * CANVAS_SIZE - pos.x;
      const dy = kp[1] * CANVAS_SIZE - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < HIT_RADIUS && (!closest || dist < closest.dist)) {
        closest = { idx: k, dist };
      }
    }
    return closest?.idx ?? null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getCanvasPos(e);
    const hit = findKeypoint(pos);
    if (hit !== null) setDragging(hit);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pos = getCanvasPos(e);

    if (dragging !== null) {
      const pose = getPoseData();
      if (!pose) return;
      const nx = Math.max(0, Math.min(1, pos.x / CANVAS_SIZE));
      const ny = Math.max(0, Math.min(1, pos.y / CANVAS_SIZE));
      const newPose = pose.map((kp, i) =>
        i === dragging ? [nx, ny] as [number, number] : kp ? [...kp] as [number, number] : null,
      );
      setPoseOverride(animName, frameIndex, newPose);
      return;
    }

    setHoveredKp(findKeypoint(pos));
  };

  const handleMouseUp = () => setDragging(null);
  const handleMouseLeave = () => { setDragging(null); setHoveredKp(null); };

  return (
    <div style={styles.overlay}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <span style={styles.title}>{title}</span>
          {hasOverride && (
            <button onClick={() => clearPoseOverride(animName, frameIndex)} style={styles.resetBtn}>
              Reset
            </button>
          )}
          <button onClick={onClose} style={styles.closeBtn}>Close</button>
        </div>
        <div style={styles.hint}>Drag keypoints to adjust the pose</div>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          style={{
            borderRadius: 4,
            cursor: dragging !== null ? 'grabbing' : hoveredKp !== null ? 'grab' : 'default',
            width: CANVAS_SIZE,
            height: CANVAS_SIZE,
          }}
        />
        {hasOverride && (
          <div style={styles.overrideTag}>Modified</div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  panel: {
    background: '#111120',
    border: '1px solid #3a3a5a',
    borderRadius: 8,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    alignItems: 'center',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  title: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#aaa',
    fontWeight: 600,
    flex: 1,
  },
  hint: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#666',
    fontStyle: 'italic',
  },
  resetBtn: {
    background: '#2a2a3a',
    border: '1px solid #444',
    borderRadius: 3,
    color: '#f8a04a',
    fontFamily: 'monospace',
    fontSize: 9,
    padding: '2px 8px',
    cursor: 'pointer',
  },
  closeBtn: {
    background: '#2a1a1a',
    border: '1px solid #553333',
    borderRadius: 3,
    color: '#d88',
    fontFamily: 'monospace',
    fontSize: 9,
    padding: '2px 8px',
    cursor: 'pointer',
  },
  overrideTag: {
    fontFamily: 'monospace',
    fontSize: 8,
    color: '#f8a04a',
    fontWeight: 600,
  },
};
