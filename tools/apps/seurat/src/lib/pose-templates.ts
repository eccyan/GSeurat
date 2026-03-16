/**
 * OpenPose skeleton templates for sprite animation frames.
 *
 * Keypoints use normalized coordinates (0-1) relative to the frame.
 * Index mapping (OpenPose 14-point, compatible with ControlNet v1.1):
 *   0: nose, 1: neck,
 *   2: r_shoulder, 3: r_elbow, 4: r_wrist,
 *   5: l_shoulder, 6: l_elbow, 7: l_wrist,
 *   8: r_hip, 9: r_knee, 10: r_ankle,
 *  11: l_hip, 12: l_knee, 13: l_ankle
 *
 * null means the keypoint is not visible (e.g. back-facing).
 */

type Keypoint = [number, number] | null;
type Pose = Keypoint[];

/** Keyframe stride per animation state.
 *  Poses are applied at frame indices 0, stride, 2*stride, etc.
 *  Frames in between are interpolated and get no pose (null). */
const KEYFRAME_STRIDE: Record<string, number> = {
  idle: 1,
  walk: 1,
  run: 4,
};

/** Limb connections: [startIdx, endIdx, color] */
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

// ---------------------------------------------------------------------------
// Base poses (facing down / south)
// ---------------------------------------------------------------------------

const IDLE_DOWN: Pose[] = [
  // Frame 0 — neutral standing
  [[0.50, 0.15], [0.50, 0.24], [0.38, 0.27], [0.34, 0.40], [0.33, 0.50],
   [0.62, 0.27], [0.66, 0.40], [0.67, 0.50],
   [0.43, 0.51], [0.43, 0.67], [0.43, 0.82],
   [0.57, 0.51], [0.57, 0.67], [0.57, 0.82]],
  // Frame 1 — slight exhale (arms down a bit)
  [[0.50, 0.15], [0.50, 0.24], [0.38, 0.28], [0.34, 0.41], [0.33, 0.52],
   [0.62, 0.28], [0.66, 0.41], [0.67, 0.52],
   [0.43, 0.52], [0.43, 0.67], [0.43, 0.82],
   [0.57, 0.52], [0.57, 0.67], [0.57, 0.82]],
  // Frame 2 — same as 0
  [[0.50, 0.15], [0.50, 0.24], [0.38, 0.27], [0.34, 0.40], [0.33, 0.50],
   [0.62, 0.27], [0.66, 0.40], [0.67, 0.50],
   [0.43, 0.51], [0.43, 0.67], [0.43, 0.82],
   [0.57, 0.51], [0.57, 0.67], [0.57, 0.82]],
  // Frame 3 — slight inhale (shoulders up a hair)
  [[0.50, 0.14], [0.50, 0.23], [0.38, 0.26], [0.34, 0.39], [0.33, 0.49],
   [0.62, 0.26], [0.66, 0.39], [0.67, 0.49],
   [0.43, 0.51], [0.43, 0.67], [0.43, 0.82],
   [0.57, 0.51], [0.57, 0.67], [0.57, 0.82]],
];

const WALK_DOWN: Pose[] = [
  // Frame 0 — right foot forward, left back
  [[0.50, 0.15], [0.50, 0.24], [0.38, 0.27], [0.32, 0.38], [0.30, 0.48],
   [0.62, 0.27], [0.68, 0.38], [0.70, 0.48],
   [0.43, 0.51], [0.40, 0.66], [0.38, 0.82],
   [0.57, 0.51], [0.58, 0.65], [0.60, 0.78]],
  // Frame 1 — passing (legs together, arms swapped)
  [[0.50, 0.15], [0.50, 0.24], [0.38, 0.27], [0.36, 0.40], [0.38, 0.50],
   [0.62, 0.27], [0.64, 0.40], [0.62, 0.50],
   [0.43, 0.51], [0.44, 0.67], [0.44, 0.82],
   [0.57, 0.51], [0.56, 0.67], [0.56, 0.82]],
  // Frame 2 — left foot forward, right back
  [[0.50, 0.15], [0.50, 0.24], [0.38, 0.27], [0.32, 0.38], [0.30, 0.48],
   [0.62, 0.27], [0.68, 0.38], [0.70, 0.48],
   [0.43, 0.51], [0.42, 0.65], [0.40, 0.78],
   [0.57, 0.51], [0.58, 0.66], [0.60, 0.82]],
  // Frame 3 — passing (other side)
  [[0.50, 0.15], [0.50, 0.24], [0.38, 0.27], [0.36, 0.40], [0.38, 0.50],
   [0.62, 0.27], [0.64, 0.40], [0.62, 0.50],
   [0.43, 0.51], [0.44, 0.67], [0.44, 0.82],
   [0.57, 0.51], [0.56, 0.67], [0.56, 0.82]],
];

const RUN_DOWN: Pose[] = [
  // Frame 0 — right leg forward stride, left back, arms pumping
  [[0.50, 0.16], [0.50, 0.25], [0.38, 0.28], [0.30, 0.36], [0.26, 0.44],
   [0.62, 0.28], [0.70, 0.36], [0.74, 0.44],
   [0.43, 0.51], [0.36, 0.64], [0.32, 0.80],
   [0.57, 0.51], [0.60, 0.62], [0.64, 0.72]],
  // Frame 1 — right foot contact, body lower
  [[0.50, 0.18], [0.50, 0.27], [0.38, 0.30], [0.32, 0.40], [0.30, 0.50],
   [0.62, 0.30], [0.68, 0.40], [0.70, 0.50],
   [0.43, 0.53], [0.40, 0.67], [0.40, 0.82],
   [0.57, 0.53], [0.58, 0.66], [0.58, 0.78]],
  // Frame 2 — left leg forward stride
  [[0.50, 0.16], [0.50, 0.25], [0.38, 0.28], [0.30, 0.36], [0.26, 0.44],
   [0.62, 0.28], [0.70, 0.36], [0.74, 0.44],
   [0.43, 0.51], [0.40, 0.62], [0.36, 0.72],
   [0.57, 0.51], [0.64, 0.64], [0.68, 0.80]],
  // Frame 3 — left foot contact
  [[0.50, 0.18], [0.50, 0.27], [0.38, 0.30], [0.32, 0.40], [0.30, 0.50],
   [0.62, 0.30], [0.68, 0.40], [0.70, 0.50],
   [0.43, 0.53], [0.42, 0.66], [0.42, 0.78],
   [0.57, 0.53], [0.58, 0.67], [0.58, 0.82]],
];

// ---------------------------------------------------------------------------
// Hand-crafted side-view poses (facing right)
// In side view: "far" limbs (left arm/leg from viewer's perspective) are
// hidden or overlap with near limbs. Nose is offset to show facing direction.
// ---------------------------------------------------------------------------

/** Side-view idle facing right: character stands in profile.
 *  Front leg (left/far) is at center, back leg (right/near) is pushed
 *  clearly BEHIND it so ControlNet reads one leg in front of the other.
 *  Back ankle x=0.34, front ankle x=0.52 — back leg trails behind front. */
const IDLE_RIGHT: Pose[] = [
  // Frame 0 — neutral standing
  //   nose,         neck,         r_shoulder,   r_elbow,      r_wrist,
  //   l_shoulder,   l_elbow,      l_wrist,
  //   r_hip,        r_knee,       r_ankle,      (back leg — behind)
  //   l_hip,        l_knee,       l_ankle       (front leg — forward)
  [[0.52, 0.09], [0.49, 0.17], [0.42, 0.19], [0.38, 0.28], [0.38, 0.37],
   [0.54, 0.19], [0.52, 0.28], [0.52, 0.37],
   [0.44, 0.38], [0.40, 0.54], [0.34, 0.72],
   [0.50, 0.38], [0.50, 0.54], [0.52, 0.72]],
  // Frame 1 — slight exhale (shoulders/arms drop a hair)
  [[0.52, 0.09], [0.49, 0.17], [0.42, 0.20], [0.38, 0.29], [0.38, 0.38],
   [0.54, 0.20], [0.52, 0.29], [0.52, 0.38],
   [0.44, 0.39], [0.40, 0.54], [0.34, 0.72],
   [0.50, 0.39], [0.50, 0.54], [0.52, 0.72]],
  // Frame 2 — same as 0
  [[0.52, 0.09], [0.49, 0.17], [0.42, 0.19], [0.38, 0.28], [0.38, 0.37],
   [0.54, 0.19], [0.52, 0.28], [0.52, 0.37],
   [0.44, 0.38], [0.40, 0.54], [0.34, 0.72],
   [0.50, 0.38], [0.50, 0.54], [0.52, 0.72]],
  // Frame 3 — slight inhale (head/shoulders rise a hair)
  [[0.52, 0.08], [0.49, 0.16], [0.42, 0.18], [0.38, 0.27], [0.38, 0.36],
   [0.54, 0.18], [0.52, 0.27], [0.52, 0.36],
   [0.44, 0.38], [0.40, 0.54], [0.34, 0.72],
   [0.50, 0.38], [0.50, 0.54], [0.52, 0.72]],
];

/** Side-view walk facing right: arms and legs swing forward/back.
 *  Based on reference images: wider stride (~0.30 ankle spread), stronger arm pump,
 *  tighter profile width, contralateral arm–leg swing. */
const WALK_RIGHT: Pose[] = [
  // Frame 0 — right leg forward, left arm forward (contact)
  //   nose,         neck,         r_shoulder,   r_elbow,      r_wrist,
  //   l_shoulder,   l_elbow,      l_wrist,
  //   r_hip,        r_knee,       r_ankle,
  //   l_hip,        l_knee,       l_ankle
  [[0.52, 0.10], [0.49, 0.18], [0.44, 0.20], [0.36, 0.28], [0.32, 0.36],
   [0.54, 0.20], [0.60, 0.26], [0.64, 0.34],
   [0.45, 0.39], [0.54, 0.56], [0.60, 0.74],
   [0.51, 0.39], [0.42, 0.56], [0.36, 0.74]],
  // Frame 1 — passing (legs together, arms neutral)
  [[0.52, 0.10], [0.49, 0.18], [0.44, 0.20], [0.44, 0.30], [0.46, 0.40],
   [0.54, 0.20], [0.52, 0.30], [0.50, 0.40],
   [0.45, 0.39], [0.47, 0.56], [0.47, 0.74],
   [0.51, 0.39], [0.49, 0.56], [0.49, 0.74]],
  // Frame 2 — left leg forward, right arm forward (contact)
  [[0.52, 0.10], [0.49, 0.18], [0.44, 0.20], [0.52, 0.26], [0.58, 0.34],
   [0.54, 0.20], [0.46, 0.28], [0.40, 0.36],
   [0.45, 0.39], [0.40, 0.56], [0.34, 0.74],
   [0.51, 0.39], [0.56, 0.56], [0.62, 0.74]],
  // Frame 3 — passing (other side)
  [[0.52, 0.10], [0.49, 0.18], [0.44, 0.20], [0.52, 0.30], [0.50, 0.40],
   [0.54, 0.20], [0.44, 0.30], [0.46, 0.40],
   [0.45, 0.39], [0.49, 0.56], [0.49, 0.74],
   [0.51, 0.39], [0.47, 0.56], [0.47, 0.74]],
];

/** Side-view run facing right: 4-frame loop with exaggerated poses.
 *  Cycle: R-contact → aerial(L) → L-contact → aerial(R) → loop
 *  Key: big leg spread at contact, tucked legs at aerial, strong arm pump, body lean shifts. */
const RUN_RIGHT: Pose[] = [
  // Frame 0 — Right foot contact: right leg far forward, left leg far back, torso leaning forward
  //   nose, neck, r_shoulder, r_elbow, r_wrist, l_shoulder, l_elbow, l_wrist,
  //   r_hip, r_knee, r_ankle, l_hip, l_knee, l_ankle
  [[0.58, 0.10], [0.52, 0.22], [0.48, 0.22], [0.60, 0.15], [0.66, 0.10],
   [0.56, 0.22], [0.38, 0.30], [0.32, 0.38],
   [0.50, 0.44], [0.64, 0.58], [0.72, 0.74],
   [0.50, 0.44], [0.34, 0.56], [0.24, 0.70]],
  // Frame 1 — Aerial (left leading): body high, left knee driven up+forward, right leg trailing behind
  [[0.56, 0.06], [0.50, 0.16], [0.46, 0.16], [0.36, 0.22], [0.30, 0.28],
   [0.54, 0.16], [0.62, 0.10], [0.68, 0.06],
   [0.48, 0.36], [0.40, 0.44], [0.34, 0.56],
   [0.52, 0.36], [0.62, 0.44], [0.70, 0.54]],
  // Frame 2 — Left foot contact: left leg far forward, right leg far back, torso leaning forward
  [[0.58, 0.10], [0.52, 0.22], [0.48, 0.22], [0.38, 0.30], [0.32, 0.38],
   [0.56, 0.22], [0.60, 0.15], [0.66, 0.10],
   [0.50, 0.44], [0.34, 0.56], [0.24, 0.70],
   [0.50, 0.44], [0.64, 0.58], [0.72, 0.74]],
  // Frame 3 — Aerial (right leading): body high, right knee driven up+forward, left leg trailing behind
  [[0.56, 0.06], [0.50, 0.16], [0.46, 0.16], [0.62, 0.10], [0.68, 0.06],
   [0.54, 0.16], [0.36, 0.22], [0.30, 0.28],
   [0.48, 0.36], [0.62, 0.44], [0.70, 0.54],
   [0.52, 0.36], [0.40, 0.44], [0.34, 0.56]],
];

// ---------------------------------------------------------------------------
// Derive other directions from base poses
// ---------------------------------------------------------------------------

/** Mirror X for left facing (flip right-facing poses) */
function mirrorX(pose: Pose): Pose {
  return pose.map((kp) => (kp ? [1 - kp[0], kp[1]] : null));
}

/** For "up" (back-facing): hide the nose, keep body same shape */
function toUp(pose: Pose): Pose {
  const p = [...pose];
  p[0] = null; // nose hidden from behind
  return p;
}

function buildDirections(
  downPoses: Pose[],
  rightPoses: Pose[],
): Record<string, Pose[]> {
  return {
    down: downPoses,
    up: downPoses.map(toUp),
    right: rightPoses,
    left: rightPoses.map(mirrorX),
  };
}

const IDLE_POSES = buildDirections(IDLE_DOWN, IDLE_RIGHT);
const WALK_POSES = buildDirections(WALK_DOWN, WALK_RIGHT);
const RUN_POSES = buildDirections(RUN_DOWN, RUN_RIGHT);

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

  // Keyframe stride: how many frame indices apart each pose keyframe is.
  // For run animations, keyframes are at 0, 4, 8, 12 (stride 4) with
  // interpolated frames in between. Other states use stride 1.
  const stride = KEYFRAME_STRIDE[state] ?? 1;
  if (frameIndex % stride !== 0) return null;
  const poseIndex = (frameIndex / stride) % dirPoses.length;
  return dirPoses[poseIndex];
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

  // Thin lines (3-4px at 512) match OpenPose ControlNet expectations.
  // Thicker lines merge adjacent limbs into blobs the ControlNet can't parse.
  const lineWidth = Math.max(2, Math.round(Math.min(width, height) / 128));
  const dotRadius = Math.max(3, Math.round(Math.min(width, height) / 85));

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

  const lineWidth = Math.max(2, Math.round(Math.min(frameWidth, frameHeight) / 128));
  const dotRadius = Math.max(3, Math.round(Math.min(frameWidth, frameHeight) / 85));

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

/** Convenience mapping: concept view directions → idle animation name + frame index */
export const CONCEPT_VIEW_POSES: Record<string, { animName: string; frameIndex: number }> = {
  front: { animName: 'idle_down', frameIndex: 0 },
  back:  { animName: 'idle_up',   frameIndex: 0 },
  right: { animName: 'idle_right', frameIndex: 0 },
  left:  { animName: 'idle_left',  frameIndex: 0 },
};

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

// ---------------------------------------------------------------------------
// Extract keypoints from a DWPreprocessor skeleton image and derive
// directional poses by combining detected proportions with template shapes.
// ---------------------------------------------------------------------------

interface PixelCluster {
  x: number;
  y: number;
  count: number;
}

/**
 * Extract approximate keypoint positions from a rendered pose skeleton image.
 * Scans for bright pixel clusters (keypoint dots) on dark background.
 * Returns normalized [x, y] positions sorted top-to-bottom.
 */
export async function extractKeypointsFromPoseImage(
  imageBytes: Uint8Array,
): Promise<Keypoint[]> {
  const blob = new Blob([imageBytes as BlobPart], { type: 'image/png' });
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imgData;

  // Build a density map: for each pixel, count bright neighbors in a small radius.
  // Keypoint dots are dense circles; limb lines are thin and have low density.
  const cellSize = Math.max(4, Math.round(width / 64));
  const gridW = Math.ceil(width / cellSize);
  const gridH = Math.ceil(height / cellSize);
  const densityGrid = new Float32Array(gridW * gridH);

  // Count bright pixels per grid cell
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const i = (py * width + px) * 4;
      const brightness = data[i] + data[i + 1] + data[i + 2];
      if (brightness > 150) {
        const gx = Math.floor(px / cellSize);
        const gy = Math.floor(py / cellSize);
        densityGrid[gy * gridW + gx]++;
      }
    }
  }

  // Find local density maxima — these are keypoint dot centers.
  // A cell is a local max if its density exceeds all 8 neighbors.
  const dotThreshold = cellSize * cellSize * 0.15; // at least 15% of cell is bright
  const clusters: PixelCluster[] = [];

  for (let gy = 1; gy < gridH - 1; gy++) {
    for (let gx = 1; gx < gridW - 1; gx++) {
      const d = densityGrid[gy * gridW + gx];
      if (d < dotThreshold) continue;

      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++) {
        for (let dx = -1; dx <= 1 && isMax; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (densityGrid[(gy + dy) * gridW + (gx + dx)] > d) isMax = false;
        }
      }

      if (isMax) {
        clusters.push({
          x: (gx + 0.5) * cellSize / width,
          y: (gy + 0.5) * cellSize / height,
          count: d,
        });
      }
    }
  }

  // Merge clusters that are very close (within 2 cells)
  const merged: PixelCluster[] = [];
  const used = new Set<number>();
  for (let i = 0; i < clusters.length; i++) {
    if (used.has(i)) continue;
    let cx = clusters[i].x * clusters[i].count;
    let cy = clusters[i].y * clusters[i].count;
    let total = clusters[i].count;
    used.add(i);

    for (let j = i + 1; j < clusters.length; j++) {
      if (used.has(j)) continue;
      const dx = (clusters[i].x - clusters[j].x) * width;
      const dy = (clusters[i].y - clusters[j].y) * height;
      if (Math.sqrt(dx * dx + dy * dy) < cellSize * 2.5) {
        cx += clusters[j].x * clusters[j].count;
        cy += clusters[j].y * clusters[j].count;
        total += clusters[j].count;
        used.add(j);
      }
    }

    merged.push({ x: cx / total, y: cy / total, count: total });
  }

  // Sort by Y position (top to bottom)
  merged.sort((a, b) => a.y - b.y);

  console.log(`[PoseExtract] Found ${merged.length} keypoint clusters from density grid (${gridW}x${gridH} cells)`);

  // Take top 14 by density if too many
  let keypoints: PixelCluster[];
  if (merged.length > 14) {
    keypoints = [...merged].sort((a, b) => b.count - a.count).slice(0, 14);
    keypoints.sort((a, b) => a.y - b.y);
  } else {
    keypoints = merged;
  }

  // Map to our 14-point format based on vertical position heuristics:
  // 0:nose, 1:neck, 2:r_shoulder, 3:r_elbow, 4:r_wrist,
  // 5:l_shoulder, 6:l_elbow, 7:l_wrist,
  // 8:r_hip, 9:r_knee, 10:r_ankle, 11:l_hip, 12:l_knee, 13:l_ankle
  //
  // Group by approximate Y-bands:
  //   head (0-1), shoulders (2,5), elbows (3,6), wrists (4,7),
  //   hips (8,11), knees (9,12), ankles (10,13)
  const result: Keypoint[] = Array(14).fill(null);
  if (keypoints.length < 5) return result; // too few to map

  // Group clusters into Y-bands
  const bands: PixelCluster[][] = [];
  let currentBand: PixelCluster[] = [keypoints[0]];
  const bandThreshold = 0.06; // 6% of image height

  for (let i = 1; i < keypoints.length; i++) {
    if (keypoints[i].y - currentBand[0].y < bandThreshold) {
      currentBand.push(keypoints[i]);
    } else {
      bands.push(currentBand);
      currentBand = [keypoints[i]];
    }
  }
  bands.push(currentBand);

  // Assign bands to body parts (top to bottom)
  let bandIdx = 0;

  // Head band: 1-2 points (nose, neck)
  if (bandIdx < bands.length) {
    const head = bands[bandIdx];
    if (head.length >= 2) {
      head.sort((a, b) => a.y - b.y);
      result[0] = [head[0].x, head[0].y]; // nose
      result[1] = [head[1].x, head[1].y]; // neck
    } else {
      result[0] = [head[0].x, head[0].y]; // nose
    }
    bandIdx++;
  }

  // If nose/neck were in same band, next might be neck or shoulders
  if (result[1] === null && bandIdx < bands.length) {
    const band = bands[bandIdx];
    if (band.length === 1) {
      result[1] = [band[0].x, band[0].y]; // neck
      bandIdx++;
    }
  }

  // Shoulders: 2 points at similar Y, left/right of center
  if (bandIdx < bands.length) {
    const band = bands[bandIdx];
    band.sort((a, b) => a.x - b.x);
    if (band.length >= 2) {
      result[2] = [band[0].x, band[0].y]; // r_shoulder (leftmost = right in image)
      result[5] = [band[band.length - 1].x, band[band.length - 1].y]; // l_shoulder
    } else if (band.length === 1) {
      result[2] = [band[0].x, band[0].y];
      result[5] = [band[0].x, band[0].y];
    }
    bandIdx++;
  }

  // Elbows: 2 points
  if (bandIdx < bands.length) {
    const band = bands[bandIdx];
    band.sort((a, b) => a.x - b.x);
    if (band.length >= 2) {
      result[3] = [band[0].x, band[0].y]; // r_elbow
      result[6] = [band[band.length - 1].x, band[band.length - 1].y]; // l_elbow
    } else {
      result[3] = [band[0].x, band[0].y];
      result[6] = [band[0].x, band[0].y];
    }
    bandIdx++;
  }

  // Wrists or Hips — if many bands remain, next is wrists; if few, skip to hips
  const remainingBands = bands.length - bandIdx;
  if (remainingBands >= 4) {
    // Wrists
    if (bandIdx < bands.length) {
      const band = bands[bandIdx];
      band.sort((a, b) => a.x - b.x);
      result[4] = [band[0].x, band[0].y]; // r_wrist
      result[7] = [band[band.length - 1].x, band[band.length - 1].y]; // l_wrist
      bandIdx++;
    }
  }

  // Hips: 2 points
  if (bandIdx < bands.length) {
    const band = bands[bandIdx];
    band.sort((a, b) => a.x - b.x);
    if (band.length >= 2) {
      result[8] = [band[0].x, band[0].y]; // r_hip
      result[11] = [band[band.length - 1].x, band[band.length - 1].y]; // l_hip
    } else {
      result[8] = [band[0].x, band[0].y];
      result[11] = [band[0].x, band[0].y];
    }
    bandIdx++;
  }

  // Knees: 2 points
  if (bandIdx < bands.length) {
    const band = bands[bandIdx];
    band.sort((a, b) => a.x - b.x);
    if (band.length >= 2) {
      result[9] = [band[0].x, band[0].y]; // r_knee
      result[12] = [band[band.length - 1].x, band[band.length - 1].y]; // l_knee
    } else {
      result[9] = [band[0].x, band[0].y];
      result[12] = [band[0].x, band[0].y];
    }
    bandIdx++;
  }

  // Ankles: 2 points
  if (bandIdx < bands.length) {
    const band = bands[bandIdx];
    band.sort((a, b) => a.x - b.x);
    if (band.length >= 2) {
      result[10] = [band[0].x, band[0].y]; // r_ankle
      result[13] = [band[band.length - 1].x, band[band.length - 1].y]; // l_ankle
    } else {
      result[10] = [band[0].x, band[0].y];
      result[13] = [band[0].x, band[0].y];
    }
  }

  // Fill any missing wrists from elbows (shifted down)
  if (!result[4] && result[3]) result[4] = [result[3][0], result[3][1] + 0.08];
  if (!result[7] && result[6]) result[7] = [result[6][0], result[6][1] + 0.08];

  return result;
}

/**
 * Derive directional pose skeletons from detected front-view keypoints.
 * Combines the character's actual y-proportions with template x-positions
 * for each direction. Returns rendered PNG bytes for each direction.
 */
export async function deriveDirectionalPoses(
  detectedFrontKeypoints: Keypoint[],
): Promise<Record<string, Uint8Array>> {
  // Get the template poses for each direction
  const directions: Record<string, { animName: string; frameIndex: number }> = {
    front: { animName: 'idle_down', frameIndex: 0 },
    back:  { animName: 'idle_up',   frameIndex: 0 },
    right: { animName: 'idle_right', frameIndex: 0 },
    left:  { animName: 'idle_left',  frameIndex: 0 },
  };

  const result: Record<string, Uint8Array> = {};

  for (const [dir, def] of Object.entries(directions)) {
    const templatePose = getPose(def.animName, def.frameIndex);
    if (!templatePose) continue;

    // For front view, use detected keypoints directly
    if (dir === 'front') {
      const frontPose = detectedFrontKeypoints.map((kp) =>
        kp ? [...kp] as [number, number] : null,
      );
      result[dir] = await renderPoseToPng(frontPose, 512, 512);
      continue;
    }

    // For other directions: template x-coords + detected y-coords
    const derivedPose: Pose = templatePose.map((templateKp, i) => {
      const detectedKp = detectedFrontKeypoints[i];
      if (!templateKp) return null;
      if (!detectedKp) return templateKp ? [...templateKp] as [number, number] : null;

      // Use template's x (defines direction) + detected y (defines proportions)
      return [templateKp[0], detectedKp[1]] as [number, number];
    });

    // For back view, hide the nose
    if (dir === 'back') {
      derivedPose[0] = null;
    }

    result[dir] = await renderPoseToPng(derivedPose, 512, 512);
  }

  return result;
}
