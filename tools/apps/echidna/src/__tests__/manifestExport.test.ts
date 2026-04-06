import { describe, it, expect } from 'vitest';
import { buildManifest } from '../lib/manifestExport.js';
import type { BodyPart, PoseData, AnimationClip } from '../store/types.js';

const mockParts: BodyPart[] = [
  { id: 'torso', name: 'torso', parent: null, joint: [0, 0, 0], voxelKeys: [] },
  { id: 'head', name: 'head', parent: 'torso', joint: [0, 4, 0], voxelKeys: [] },
  { id: 'left_arm', name: 'left_arm', parent: 'torso', joint: [-2, 3, 0], voxelKeys: [] },
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
    playbackMode: 'loop',
    keyframes: [
      { time: 0, poseName: 'idle', easing: 'step' as const },
      { time: 0.5, poseName: 'wave', easing: 'step' as const },
      { time: 1.0, poseName: 'idle', easing: 'step' as const },
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

    // 'step' easing is the default and should be omitted from output
    expect(clip.keyframes[0]).toEqual({ time: 0, pose: 'idle' });
    expect(clip.keyframes[1]).toEqual({ time: 0.5, pose: 'wave' });
    expect(clip.keyframes[2]).toEqual({ time: 1.0, pose: 'idle' });
  });

  it('omits easing field when easing is "step" (default)', () => {
    const manifest = buildManifest('char', 'char.ply', 1.0, mockParts, mockPoses, mockAnimations);
    const clip = manifest.animations['wave_anim'];
    for (const kf of clip.keyframes) {
      expect(kf).not.toHaveProperty('easing');
    }
  });

  it('includes easing field when easing is not "step"', () => {
    const anims: Record<string, AnimationClip> = {
      bounce_anim: {
        name: 'bounce_anim',
        duration: 1.0,
        playbackMode: 'loop',
        keyframes: [
          { time: 0, poseName: 'idle', easing: 'linear' as const },
          { time: 0.5, poseName: 'wave', easing: 'ease-in-out' as const },
          { time: 1.0, poseName: 'idle', easing: 'bounce' as const },
        ],
      },
    };
    const manifest = buildManifest('char', 'char.ply', 1.0, mockParts, mockPoses, anims);
    const clip = manifest.animations['bounce_anim'];

    expect(clip.keyframes[0].easing).toBe('linear');
    expect(clip.keyframes[1].easing).toBe('ease-in-out');
    expect(clip.keyframes[2].easing).toBe('bounce');
  });

  it('includes curve field when present on keyframe', () => {
    const curve: [number, number, number, number] = [0.25, 0.1, 0.25, 1.0];
    const anims: Record<string, AnimationClip> = {
      custom_anim: {
        name: 'custom_anim',
        duration: 1.0,
        playbackMode: 'loop',
        keyframes: [
          { time: 0, poseName: 'idle', easing: 'custom' as const, curve },
          { time: 1.0, poseName: 'wave', easing: 'step' as const },
        ],
      },
    };
    const manifest = buildManifest('char', 'char.ply', 1.0, mockParts, mockPoses, anims);
    const clip = manifest.animations['custom_anim'];

    expect(clip.keyframes[0].curve).toEqual(curve);
    expect(clip.keyframes[1]).not.toHaveProperty('curve');
  });

  it('includes parts field when present on keyframe', () => {
    const anims: Record<string, AnimationClip> = {
      partial_anim: {
        name: 'partial_anim',
        duration: 1.0,
        playbackMode: 'loop',
        keyframes: [
          { time: 0, poseName: 'idle', easing: 'linear' as const, parts: ['torso', 'head'] },
          { time: 1.0, poseName: 'wave', easing: 'step' as const },
        ],
      },
    };
    const manifest = buildManifest('char', 'char.ply', 1.0, mockParts, mockPoses, anims);
    const clip = manifest.animations['partial_anim'];

    expect(clip.keyframes[0].parts).toEqual(['torso', 'head']);
    expect(clip.keyframes[1]).not.toHaveProperty('parts');
  });

  it('sets looping: false when playbackMode is "once"', () => {
    const anims: Record<string, AnimationClip> = {
      oneshot: {
        name: 'oneshot',
        duration: 0.5,
        playbackMode: 'once',
        keyframes: [
          { time: 0, poseName: 'idle', easing: 'step' as const },
          { time: 0.5, poseName: 'wave', easing: 'step' as const },
        ],
      },
    };
    const manifest = buildManifest('char', 'char.ply', 1.0, mockParts, mockPoses, anims);
    expect(manifest.animations['oneshot'].looping).toBe(false);
  });

  it('sets looping: true when playbackMode is "loop"', () => {
    const anims: Record<string, AnimationClip> = {
      looping_anim: {
        name: 'looping_anim',
        duration: 1.0,
        playbackMode: 'loop',
        keyframes: [{ time: 0, poseName: 'idle', easing: 'step' as const }],
      },
    };
    const manifest = buildManifest('char', 'char.ply', 1.0, mockParts, mockPoses, anims);
    expect(manifest.animations['looping_anim'].looping).toBe(true);
  });

  it('sets looping: true when playbackMode is "ping-pong"', () => {
    const anims: Record<string, AnimationClip> = {
      pingpong_anim: {
        name: 'pingpong_anim',
        duration: 1.0,
        playbackMode: 'ping-pong',
        keyframes: [{ time: 0, poseName: 'idle', easing: 'step' as const }],
      },
    };
    const manifest = buildManifest('char', 'char.ply', 1.0, mockParts, mockPoses, anims);
    expect(manifest.animations['pingpong_anim'].looping).toBe(true);
  });
});
