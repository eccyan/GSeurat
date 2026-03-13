import React, { useRef, useEffect } from 'react';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { getPose } from '../../lib/pose-templates.js';

/** Limb connections for drawing pose skeletons (14-keypoint OpenPose format) */
const LIMBS: [number, number, string][] = [
  [0, 1, '#ff0000'],   // nose-neck
  [1, 2, '#ff5500'],   // neck-r_shoulder
  [2, 3, '#ffaa00'],   // r_shoulder-r_elbow
  [3, 4, '#ffff00'],   // r_elbow-r_wrist
  [1, 5, '#00ff00'],   // neck-l_shoulder
  [5, 6, '#00ff55'],   // l_shoulder-l_elbow
  [6, 7, '#00ffaa'],   // l_elbow-l_wrist
  [1, 8, '#00ffff'],   // neck-r_hip
  [8, 9, '#00aaff'],   // r_hip-r_knee
  [9, 10, '#0055ff'],  // r_knee-r_ankle
  [1, 11, '#0000ff'],  // neck-l_hip
  [11, 12, '#5500ff'], // l_hip-l_knee
  [12, 13, '#aa00ff'], // l_knee-l_ankle
];

interface PoseCellProps {
  animName: string;
  frameIndex: number;
  size: number;
  /** If true, skip checking poseOverrides from the store (used in concept preview) */
  staticPose?: boolean;
}

/** Tiny canvas that draws a pose skeleton */
export function PoseCell({ animName, frameIndex, size, staticPose }: PoseCellProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseOverrides = useSeuratStore((s) => s.poseOverrides);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = size;
    canvas.height = size;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);

    const key = `${animName}:${frameIndex}`;
    const pose = staticPose ? getPose(animName, frameIndex) : (poseOverrides[key] ?? getPose(animName, frameIndex));
    if (!pose) {
      ctx.fillStyle = '#333';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('N/A', size / 2, size / 2 + 3);
      return;
    }

    const lw = Math.max(1.5, size / 40);
    const dr = lw * 0.8;

    for (const [i, j, color] of LIMBS) {
      const a = pose[i];
      const b = pose[j];
      if (!a || !b) continue;
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a[0] * size, a[1] * size);
      ctx.lineTo(b[0] * size, b[1] * size);
      ctx.stroke();
    }

    for (const kp of pose) {
      if (!kp) continue;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(kp[0] * size, kp[1] * size, dr, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [animName, frameIndex, size, staticPose, poseOverrides]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', borderRadius: 3, display: 'block' }}
    />
  );
}
