/**
 * OpenPose skeleton templates for sprite animation frames.
 *
 * Keypoints use normalized coordinates (0-1) relative to the frame.
 * Index mapping (OpenPose BODY_25 subset, 15 points):
 *   0: nose, 1: neck,
 *   2: r_shoulder, 3: r_elbow, 4: r_wrist,
 *   5: l_shoulder, 6: l_elbow, 7: l_wrist,
 *   8: mid_hip,
 *   9: r_hip, 10: r_knee, 11: r_ankle,
 *  12: l_hip, 13: l_knee, 14: l_ankle
 *
 * null means the keypoint is not visible (e.g. back-facing).
 */

type Keypoint = [number, number] | null;
type Pose = Keypoint[];

/** Limb connections: [startIdx, endIdx, color] */
const LIMBS: [number, number, string][] = [
  [0, 1, '#ff0000'],   // nose-neck
  [1, 2, '#ff5500'],   // neck-r_shoulder
  [2, 3, '#ffaa00'],   // r_shoulder-r_elbow
  [3, 4, '#ffff00'],   // r_elbow-r_wrist
  [1, 5, '#aaff00'],   // neck-l_shoulder
  [5, 6, '#55ff00'],   // l_shoulder-l_elbow
  [6, 7, '#00ff00'],   // l_elbow-l_wrist
  [1, 8, '#00ff55'],   // neck-mid_hip
  [8, 9, '#00ffaa'],   // mid_hip-r_hip
  [9, 10, '#00ffff'],  // r_hip-r_knee
  [10, 11, '#00aaff'], // r_knee-r_ankle
  [8, 12, '#0055ff'],  // mid_hip-l_hip
  [12, 13, '#0000ff'], // l_hip-l_knee
  [13, 14, '#5500ff'], // l_knee-l_ankle
];

// ---------------------------------------------------------------------------
// Base poses (facing down / south)
// ---------------------------------------------------------------------------

const IDLE_DOWN: Pose[] = [
  // Frame 0 — neutral standing
  [[0.50, 0.15], [0.50, 0.24], [0.38, 0.27], [0.34, 0.40], [0.33, 0.50],
   [0.62, 0.27], [0.66, 0.40], [0.67, 0.50], [0.50, 0.50],
   [0.43, 0.51], [0.43, 0.67], [0.43, 0.82],
   [0.57, 0.51], [0.57, 0.67], [0.57, 0.82]],
  // Frame 1 — slight exhale (arms down a bit)
  [[0.50, 0.15], [0.50, 0.24], [0.38, 0.28], [0.34, 0.41], [0.33, 0.52],
   [0.62, 0.28], [0.66, 0.41], [0.67, 0.52], [0.50, 0.51],
   [0.43, 0.52], [0.43, 0.67], [0.43, 0.82],
   [0.57, 0.52], [0.57, 0.67], [0.57, 0.82]],
  // Frame 2 — same as 0
  [[0.50, 0.15], [0.50, 0.24], [0.38, 0.27], [0.34, 0.40], [0.33, 0.50],
   [0.62, 0.27], [0.66, 0.40], [0.67, 0.50], [0.50, 0.50],
   [0.43, 0.51], [0.43, 0.67], [0.43, 0.82],
   [0.57, 0.51], [0.57, 0.67], [0.57, 0.82]],
  // Frame 3 — slight inhale (shoulders up a hair)
  [[0.50, 0.14], [0.50, 0.23], [0.38, 0.26], [0.34, 0.39], [0.33, 0.49],
   [0.62, 0.26], [0.66, 0.39], [0.67, 0.49], [0.50, 0.50],
   [0.43, 0.51], [0.43, 0.67], [0.43, 0.82],
   [0.57, 0.51], [0.57, 0.67], [0.57, 0.82]],
];

const WALK_DOWN: Pose[] = [
  // Frame 0 — right foot forward, left back
  [[0.50, 0.15], [0.50, 0.24], [0.38, 0.27], [0.32, 0.38], [0.30, 0.48],
   [0.62, 0.27], [0.68, 0.38], [0.70, 0.48], [0.50, 0.50],
   [0.43, 0.51], [0.40, 0.66], [0.38, 0.82],
   [0.57, 0.51], [0.58, 0.65], [0.60, 0.78]],
  // Frame 1 — passing (legs together, arms swapped)
  [[0.50, 0.15], [0.50, 0.24], [0.38, 0.27], [0.36, 0.40], [0.38, 0.50],
   [0.62, 0.27], [0.64, 0.40], [0.62, 0.50], [0.50, 0.50],
   [0.43, 0.51], [0.44, 0.67], [0.44, 0.82],
   [0.57, 0.51], [0.56, 0.67], [0.56, 0.82]],
  // Frame 2 — left foot forward, right back
  [[0.50, 0.15], [0.50, 0.24], [0.38, 0.27], [0.32, 0.38], [0.30, 0.48],
   [0.62, 0.27], [0.68, 0.38], [0.70, 0.48], [0.50, 0.50],
   [0.57, 0.51], [0.58, 0.66], [0.60, 0.82],
   [0.43, 0.51], [0.42, 0.65], [0.40, 0.78]],
  // Frame 3 — passing (other side)
  [[0.50, 0.15], [0.50, 0.24], [0.38, 0.27], [0.36, 0.40], [0.38, 0.50],
   [0.62, 0.27], [0.64, 0.40], [0.62, 0.50], [0.50, 0.50],
   [0.43, 0.51], [0.44, 0.67], [0.44, 0.82],
   [0.57, 0.51], [0.56, 0.67], [0.56, 0.82]],
];

const RUN_DOWN: Pose[] = [
  // Frame 0 — right leg forward stride, left back, arms pumping
  [[0.50, 0.16], [0.50, 0.25], [0.38, 0.28], [0.30, 0.36], [0.26, 0.44],
   [0.62, 0.28], [0.70, 0.36], [0.74, 0.44], [0.50, 0.50],
   [0.43, 0.51], [0.36, 0.64], [0.32, 0.80],
   [0.57, 0.51], [0.60, 0.62], [0.64, 0.72]],
  // Frame 1 — right foot contact, body lower
  [[0.50, 0.18], [0.50, 0.27], [0.38, 0.30], [0.32, 0.40], [0.30, 0.50],
   [0.62, 0.30], [0.68, 0.40], [0.70, 0.50], [0.50, 0.52],
   [0.43, 0.53], [0.40, 0.67], [0.40, 0.82],
   [0.57, 0.53], [0.58, 0.66], [0.58, 0.78]],
  // Frame 2 — left leg forward stride
  [[0.50, 0.16], [0.50, 0.25], [0.38, 0.28], [0.30, 0.36], [0.26, 0.44],
   [0.62, 0.28], [0.70, 0.36], [0.74, 0.44], [0.50, 0.50],
   [0.57, 0.51], [0.64, 0.64], [0.68, 0.80],
   [0.43, 0.51], [0.40, 0.62], [0.36, 0.72]],
  // Frame 3 — left foot contact
  [[0.50, 0.18], [0.50, 0.27], [0.38, 0.30], [0.32, 0.40], [0.30, 0.50],
   [0.62, 0.30], [0.68, 0.40], [0.70, 0.50], [0.50, 0.52],
   [0.57, 0.53], [0.58, 0.67], [0.58, 0.82],
   [0.43, 0.53], [0.42, 0.66], [0.42, 0.78]],
];

// ---------------------------------------------------------------------------
// Derive other directions by transforming the "down" poses
// ---------------------------------------------------------------------------

/** Mirror X for left/right facing (swap left↔right body sides) */
function mirrorX(pose: Pose): Pose {
  return pose.map((kp) => (kp ? [1 - kp[0], kp[1]] : null));
}

/** Swap left/right body parts (indices 2-4 ↔ 5-7, 9-11 ↔ 12-14) */
function swapSides(pose: Pose): Pose {
  const p = [...pose];
  // Swap arms
  [p[2], p[5]] = [p[5], p[2]];
  [p[3], p[6]] = [p[6], p[3]];
  [p[4], p[7]] = [p[7], p[4]];
  // Swap legs
  [p[9], p[12]] = [p[12], p[9]];
  [p[10], p[13]] = [p[13], p[10]];
  [p[11], p[14]] = [p[14], p[11]];
  return p;
}

/** For "up" (back-facing): hide the nose, keep body same shape */
function toUp(pose: Pose): Pose {
  const p = [...pose];
  p[0] = null; // nose hidden from behind
  return p;
}

/** For "right" facing: compress X range, shift body right */
function toRight(pose: Pose): Pose {
  return pose.map((kp) => {
    if (!kp) return null;
    // Compress to side view: narrow X spread, shift slightly
    const cx = 0.5;
    const nx = cx + (kp[0] - cx) * 0.3 + 0.05;
    return [nx, kp[1]];
  });
}

/** For "left" facing: mirror of right */
function toLeft(pose: Pose): Pose {
  return mirrorX(toRight(pose));
}

function derivePoses(downPoses: Pose[]): Record<string, Pose[]> {
  return {
    down: downPoses,
    up: downPoses.map(toUp),
    right: downPoses.map(toRight),
    left: downPoses.map(toLeft),
  };
}

const IDLE_POSES = derivePoses(IDLE_DOWN);
const WALK_POSES = derivePoses(WALK_DOWN);
const RUN_POSES = derivePoses(RUN_DOWN);

const POSE_MAP: Record<string, Record<string, Pose[]>> = {
  idle: IDLE_POSES,
  walk: WALK_POSES,
  run: RUN_POSES,
};

/**
 * Look up the pose skeleton for a given animation name and frame index.
 * Animation names follow the pattern: `{state}_{direction}` e.g. "walk_down".
 * Returns null if no pose template exists for this animation.
 */
export function getPose(animName: string, frameIndex: number): Pose | null {
  // Parse "state_direction" from animation name
  const parts = animName.split('_');
  if (parts.length < 2) return null;

  const state = parts[0]; // idle, walk, run
  const dirRaw = parts.slice(1).join('_'); // down, up, left, right

  // Map direction aliases
  const dirMap: Record<string, string> = {
    down: 'down', south: 'down', s: 'down',
    up: 'up', north: 'up', n: 'up',
    right: 'right', east: 'right', e: 'right',
    left: 'left', west: 'left', w: 'left',
  };
  const dir = dirMap[dirRaw.toLowerCase()];
  if (!dir) return null;

  const statePoses = POSE_MAP[state];
  if (!statePoses) return null;

  const dirPoses = statePoses[dir];
  if (!dirPoses || dirPoses.length === 0) return null;

  return dirPoses[frameIndex % dirPoses.length];
}

/**
 * Render a pose skeleton to a PNG image (black background, colored limbs).
 * Returns PNG bytes suitable for uploading to ComfyUI.
 */
export async function renderPoseToPng(
  pose: Pose,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;

  // Black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  const lineWidth = Math.max(2, Math.round(Math.min(width, height) / 30));
  const dotRadius = lineWidth * 0.8;

  // Draw limbs
  for (const [i, j, color] of LIMBS) {
    const a = pose[i];
    const b = pose[j];
    if (!a || !b) continue;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a[0] * width, a[1] * height);
    ctx.lineTo(b[0] * width, b[1] * height);
    ctx.stroke();
  }

  // Draw keypoint dots
  for (const kp of pose) {
    if (!kp) continue;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(kp[0] * width, kp[1] * height, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Render a tiled strip of pose skeletons for a full animation row.
 * Each frame's skeleton is rendered side by side.
 */
export async function renderPoseStripToPng(
  poses: Pose[],
  frameWidth: number,
  frameHeight: number,
): Promise<Uint8Array> {
  const totalWidth = frameWidth * poses.length;
  const canvas = new OffscreenCanvas(totalWidth, frameHeight);
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, totalWidth, frameHeight);

  const lineWidth = Math.max(2, Math.round(Math.min(frameWidth, frameHeight) / 30));
  const dotRadius = lineWidth * 0.8;

  for (let f = 0; f < poses.length; f++) {
    const pose = poses[f];
    const offsetX = f * frameWidth;

    // Draw limbs
    for (const [i, j, color] of LIMBS) {
      const a = pose[i];
      const b = pose[j];
      if (!a || !b) continue;

      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(offsetX + a[0] * frameWidth, a[1] * frameHeight);
      ctx.lineTo(offsetX + b[0] * frameWidth, b[1] * frameHeight);
      ctx.stroke();
    }

    // Draw keypoint dots
    for (const kp of pose) {
      if (!kp) continue;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(offsetX + kp[0] * frameWidth, kp[1] * frameHeight, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Get all pose frames for an animation, or null if no template exists.
 */
export function getAnimationPoses(animName: string, frameCount: number): Pose[] | null {
  const poses: Pose[] = [];
  for (let i = 0; i < frameCount; i++) {
    const pose = getPose(animName, i);
    if (!pose) return null;
    poses.push(pose);
  }
  return poses;
}
