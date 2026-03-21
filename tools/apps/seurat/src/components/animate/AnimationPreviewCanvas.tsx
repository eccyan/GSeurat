import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CharacterAnimation } from '@gseurat/asset-types';
import type { SpritesheetConfig } from '@gseurat/asset-types';
import { getFrameAtTime } from '../../lib/frame-utils.js';

interface Props {
  spriteSheetUrl: string | null;
  spritesheet: SpritesheetConfig;
  clip: CharacterAnimation | null;
  currentTime: number;
  playbackState: 'stopped' | 'playing' | 'paused';
  selectedFrameIndex: number;
}

function drawSpriteSheet(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  spritesheet: SpritesheetConfig,
  clip: CharacterAnimation,
  activeFrameIndex: number,
  canvasW: number,
  canvasH: number,
) {
  ctx.clearRect(0, 0, canvasW, canvasH);

  // Background
  ctx.fillStyle = '#0e0e1a';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Checkerboard
  const cSize = 8;
  for (let cy = 0; cy * cSize < canvasH; cy++) {
    for (let cx = 0; cx * cSize < canvasW; cx++) {
      ctx.fillStyle = (cx + cy) % 2 === 0 ? '#1a1a28' : '#222233';
      ctx.fillRect(cx * cSize, cy * cSize, cSize, cSize);
    }
  }

  if (!img.complete || img.naturalWidth === 0) return;

  const { frame_width, frame_height, columns } = spritesheet;
  const sheetW = img.naturalWidth;
  const sheetH = img.naturalHeight;
  const rows = Math.ceil(sheetH / frame_height);

  const scale = Math.min(canvasW / sheetW, canvasH / sheetH, 3);
  const drawW = sheetW * scale;
  const drawH = sheetH * scale;
  const ox = Math.floor((canvasW - drawW) / 2);
  const oy = Math.floor((canvasH - drawH) / 2);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, ox, oy, drawW, drawH);

  // Grid
  ctx.strokeStyle = '#ffffff18';
  ctx.lineWidth = 1;
  const tw = frame_width * scale;
  const th = frame_height * scale;
  for (let c = 0; c <= columns; c++) {
    ctx.beginPath();
    ctx.moveTo(ox + c * tw, oy);
    ctx.lineTo(ox + c * tw, oy + rows * th);
    ctx.stroke();
  }
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath();
    ctx.moveTo(ox, oy + r * th);
    ctx.lineTo(ox + columns * tw, oy + r * th);
    ctx.stroke();
  }

  // Dim non-clip tiles
  const clipTileSet = new Set(clip.frames.map((f) => f.tile_id));
  const totalRows = Math.ceil(sheetH / frame_height);
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < columns; c++) {
      const tileId = r * columns + c;
      if (!clipTileSet.has(tileId)) {
        ctx.fillStyle = '#00000088';
        ctx.fillRect(ox + c * tw, oy + r * th, tw, th);
      }
    }
  }

  // Clip frame highlights
  clip.frames.forEach((f, fi) => {
    const col = f.tile_id % columns;
    const row = Math.floor(f.tile_id / columns);
    if (fi !== activeFrameIndex) {
      ctx.fillStyle = '#4488cc33';
      ctx.fillRect(ox + col * tw + 1, oy + row * th + 1, tw - 2, th - 2);
    }
  });

  // Active frame
  if (activeFrameIndex >= 0 && activeFrameIndex < clip.frames.length) {
    const tileId = clip.frames[activeFrameIndex].tile_id;
    const col = tileId % columns;
    const row = Math.floor(tileId / columns);
    ctx.strokeStyle = '#f0c040';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + col * tw + 1, oy + row * th + 1, tw - 2, th - 2);
    ctx.fillStyle = '#f0c04022';
    ctx.fillRect(ox + col * tw + 1, oy + row * th + 1, tw - 2, th - 2);

    ctx.fillStyle = '#f0c040';
    ctx.font = `bold ${Math.max(8, Math.floor(th * 0.35))}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(activeFrameIndex), ox + col * tw + tw / 2, oy + row * th + th / 2);
  }
}

export function AnimationPreviewCanvas({
  spriteSheetUrl,
  spritesheet,
  clip,
  currentTime,
  playbackState,
  selectedFrameIndex,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ w: 400, h: 300 });

  const activeFrameIndex = clip
    ? playbackState === 'playing' || playbackState === 'paused'
      ? getFrameAtTime(clip, currentTime)
      : selectedFrameIndex
    : 0;

  // Observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setCanvasSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load sprite sheet
  useEffect(() => {
    if (!spriteSheetUrl) {
      imgRef.current = null;
      setImgLoaded(false);
      return;
    }
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgLoaded(true);
    };
    img.onerror = () => setImgLoaded(false);
    img.src = spriteSheetUrl;
  }, [spriteSheetUrl]);

  // Redraw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.w * dpr;
    canvas.height = canvasSize.h * dpr;
    canvas.style.width = `${canvasSize.w}px`;
    canvas.style.height = `${canvasSize.h}px`;
    ctx.scale(dpr, dpr);

    if (imgRef.current && imgLoaded && clip) {
      drawSpriteSheet(ctx, imgRef.current, spritesheet, clip, activeFrameIndex, canvasSize.w, canvasSize.h);
    } else {
      ctx.clearRect(0, 0, canvasSize.w, canvasSize.h);
      ctx.fillStyle = '#0e0e1a';
      ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);
      const cSize = 8;
      for (let cy = 0; cy * cSize < canvasSize.h; cy++) {
        for (let cx = 0; cx * cSize < canvasSize.w; cx++) {
          ctx.fillStyle = (cx + cy) % 2 === 0 ? '#1a1a28' : '#222233';
          ctx.fillRect(cx * cSize, cy * cSize, cSize, cSize);
        }
      }
      ctx.fillStyle = '#444';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        clip ? 'Load or assemble a sprite sheet' : 'Select a clip to preview',
        canvasSize.w / 2,
        canvasSize.h / 2,
      );
    }
  }, [imgLoaded, spritesheet, clip, activeFrameIndex, canvasSize]);

  return (
    <div ref={containerRef} style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ display: 'block', imageRendering: 'pixelated' }} />
    </div>
  );
}
