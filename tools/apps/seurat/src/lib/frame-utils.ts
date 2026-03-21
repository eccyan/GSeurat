import type { CharacterManifest, CharacterAnimation } from '@gseurat/asset-types';

export interface TileUV {
  u: number;
  v: number;
  w: number;
  h: number;
}

export function tileUVs(
  tileId: number,
  columns: number,
  frameWidth: number,
  frameHeight: number,
): TileUV {
  const col = tileId % columns;
  const row = Math.floor(tileId / columns);
  return {
    u: col * frameWidth,
    v: row * frameHeight,
    w: frameWidth,
    h: frameHeight,
  };
}

export function getClipDuration(anim: CharacterAnimation): number {
  return anim.frames.reduce((s, f) => s + f.duration, 0);
}

export function getFrameAtTime(anim: CharacterAnimation, time: number): number {
  let t = 0;
  for (let i = 0; i < anim.frames.length; i++) {
    t += anim.frames[i].duration;
    if (time < t) return i;
  }
  return Math.max(0, anim.frames.length - 1);
}

export function getSheetDimensions(manifest: CharacterManifest): {
  width: number;
  height: number;
} {
  const { frame_width, frame_height, columns } = manifest.spritesheet;
  const rows = manifest.animations.length;
  return {
    width: columns * frame_width,
    height: rows * frame_height,
  };
}
