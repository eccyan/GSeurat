import type { BodyPart, PoseData, AnimationClip } from '../store/types.js';

// ── Manifest types ──

export interface ManifestBone {
  id: string;
  parent: string | null;
  joint: [number, number, number];
}

export interface ManifestKeyframe {
  time: number;
  pose: string;
  easing?: string;
  curve?: [number, number, number, number];
  parts?: string[];
}

export interface ManifestAnimationClip {
  duration: number;
  looping: boolean;
  root_motion?: boolean;
  keyframes: ManifestKeyframe[];
}

export interface CharacterManifest {
  name: string;
  ply_file: string;
  scale: number;
  bones: ManifestBone[];
  poses: Record<string, Record<string, [number, number, number]> & { root_position?: [number, number, number] }>;
  animations: Record<string, ManifestAnimationClip>;
}

// ── Builder ──

export function buildManifest(
  name: string,
  plyFile: string,
  scale: number,
  parts: BodyPart[],
  poses: Record<string, PoseData>,
  animations: Record<string, AnimationClip>,
): CharacterManifest {
  const bones: ManifestBone[] = parts.map((p) => ({
    id: p.id,
    parent: p.parent,
    joint: p.joint,
  }));

  const manifestPoses: Record<string, Record<string, [number, number, number]> & { root_position?: [number, number, number] }> = {};
  for (const [poseName, poseData] of Object.entries(poses)) {
    const manifestPose: Record<string, [number, number, number]> & { root_position?: [number, number, number] } = { ...poseData.rotations };
    if (
      poseData.rootPosition &&
      (poseData.rootPosition[0] !== 0 || poseData.rootPosition[1] !== 0 || poseData.rootPosition[2] !== 0)
    ) {
      manifestPose.root_position = poseData.rootPosition;
    }
    manifestPoses[poseName] = manifestPose;
  }

  const manifestAnimations: Record<string, ManifestAnimationClip> = {};
  for (const [animName, clip] of Object.entries(animations)) {
    const manifestClip: ManifestAnimationClip = {
      duration: clip.duration,
      looping: clip.playbackMode !== 'once',
      keyframes: clip.keyframes.map((kf) => {
        const manifestKf: ManifestKeyframe = {
          time: kf.time,
          pose: kf.poseName,
        };
        // Omit easing if it's the default ('step')
        if (kf.easing && kf.easing !== 'step') {
          manifestKf.easing = kf.easing;
        }
        if (kf.curve) {
          manifestKf.curve = kf.curve;
        }
        if (kf.parts) {
          manifestKf.parts = kf.parts;
        }
        return manifestKf;
      }),
    };
    if (clip.rootMotion) {
      manifestClip.root_motion = true;
    }
    manifestAnimations[animName] = manifestClip;
  }

  return {
    name,
    ply_file: plyFile,
    scale,
    bones,
    poses: manifestPoses,
    animations: manifestAnimations,
  };
}
