import { describe, it, expect } from 'vitest';
import { buildManifest } from '../lib/manifestExport.js';
import type { BodyPart, PoseData, AnimationClip } from '../store/types.js';

const mockParts: BodyPart[] = [
  { id: 'torso', parent: null, joint: [0, 0, 0], voxelKeys: [] },
  { id: 'head', parent: 'torso', joint: [0, 4, 0], voxelKeys: [] },
  { id: 'left_arm', parent: 'torso', joint: [-2, 3, 0], voxelKeys: [] },
];

const mockPoses: Record<string, PoseData> = {
  idle: {
    rotations: {
      torso: [0, 0, 0],
      head: [5, 0, 0],
    },
  },
  wave: {
    rotations: {
      torso: [0, 0, 0],
      left_arm: [0, 0, 45],
    },
  },
};

const mockAnimations: Record<string, AnimationClip> = {
  wave_anim: {
    name: 'wave_anim',
    duration: 1.0,
    keyframes: [
      { time: 0, poseName: 'idle' },
      { time: 0.5, poseName: 'wave' },
      { time: 1.0, poseName: 'idle' },
    ],
  },
};

describe('buildManifest', () => {
  it('generates valid manifest structure with name, ply_file, and scale', () => {
    const manifest = buildManifest('my_char', 'my_char.ply', 1.5, mockParts, mockPoses, mockAnimations);

    expect(manifest.name).toBe('my_char');
    expect(manifest.ply_file).toBe('my_char.ply');
    expect(manifest.scale).toBe(1.5);
    expect(manifest).toHaveProperty('bones');
    expect(manifest).toHaveProperty('poses');
    expect(manifest).toHaveProperty('animations');
  });

  it('maps bones with correct id, parent, and joint from BodyParts', () => {
    const manifest = buildManifest('char', 'char.ply', 1.0, mockParts, {}, {});

    expect(manifest.bones).toHaveLength(3);

    const torso = manifest.bones.find((b) => b.id === 'torso');
    expect(torso).toBeDefined();
    expect(torso?.parent).toBeNull();
    expect(torso?.joint).toEqual([0, 0, 0]);

    const head = manifest.bones.find((b) => b.id === 'head');
    expect(head).toBeDefined();
    expect(head?.parent).toBe('torso');
    expect(head?.joint).toEqual([0, 4, 0]);

    const leftArm = manifest.bones.find((b) => b.id === 'left_arm');
    expect(leftArm).toBeDefined();
    expect(leftArm?.parent).toBe('torso');
    expect(leftArm?.joint).toEqual([-2, 3, 0]);
  });

  it('maps poses with per-bone rotation arrays from PoseData.rotations', () => {
    const manifest = buildManifest('char', 'char.ply', 1.0, mockParts, mockPoses, {});

    expect(manifest.poses).toHaveProperty('idle');
    expect(manifest.poses).toHaveProperty('wave');

    expect(manifest.poses['idle']['torso']).toEqual([0, 0, 0]);
    expect(manifest.poses['idle']['head']).toEqual([5, 0, 0]);

    expect(manifest.poses['wave']['torso']).toEqual([0, 0, 0]);
    expect(manifest.poses['wave']['left_arm']).toEqual([0, 0, 45]);
  });

  it('maps animations with keyframes using pose instead of poseName, and adds looping: true', () => {
    const manifest = buildManifest('char', 'char.ply', 1.0, mockParts, mockPoses, mockAnimations);

    expect(manifest.animations).toHaveProperty('wave_anim');

    const clip = manifest.animations['wave_anim'];
    expect(clip.duration).toBe(1.0);
    expect(clip.looping).toBe(true);
    expect(clip.keyframes).toHaveLength(3);

    expect(clip.keyframes[0]).toEqual({ time: 0, pose: 'idle' });
    expect(clip.keyframes[1]).toEqual({ time: 0.5, pose: 'wave' });
    expect(clip.keyframes[2]).toEqual({ time: 1.0, pose: 'idle' });
  });
});
