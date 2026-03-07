import React, { useEffect, useRef, useState } from 'react';
import type { CharacterAnimation } from '@vulkan-game-tools/asset-types';
import { frameThumbnailUrl } from '../../lib/bridge-api.js';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { getFrameAtTime } from '../../lib/frame-utils.js';

interface Props {
  characterId: string;
  clip: CharacterAnimation;
  currentTime: number;
  playbackState: 'stopped' | 'playing' | 'paused';
}

/**
 * Plays back animation from individual frame images (no spritesheet needed).
 * Loads each frame PNG from the bridge API and cycles through them.
 */
export function FramePreviewCanvas({ characterId, clip, currentTime, playbackState }: Props) {
  const frameRevision = useSeuratStore((s) => s.frameRevision);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef<(HTMLImageElement | null)[]>([]);
  const [loadedCount, setLoadedCount] = useState(0);
  const [canvasSize, setCanvasSize] = useState({ w: 400, h: 300 });

  const activeFrameIndex =
    playbackState === 'playing' || playbackState === 'paused'
      ? getFrameAtTime(clip, currentTime)
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

  // Load individual frame images
  useEffect(() => {
    const hasImages = clip.frames.some((f) => f.status !== 'pending' && f.status !== 'generating');
    if (!hasImages) {
      imagesRef.current = [];
      setLoadedCount(0);
      return;
    }

    const images: (HTMLImageElement | null)[] = new Array(clip.frames.length).fill(null);
    let loaded = 0;

    clip.frames.forEach((frame, i) => {
      if (frame.status === 'pending' || frame.status === 'generating') return;
      const img = new Image();
      img.onload = () => {
        images[i] = img;
        loaded++;
        imagesRef.current = [...images];
        setLoadedCount(loaded);
      };
      img.onerror = () => {
        loaded++;
        setLoadedCount(loaded);
      };
      img.src = frameThumbnailUrl(characterId, clip.name, frame.index);
    });
  }, [characterId, clip.name, clip.frames.map((f) => f.status).join(','), frameRevision]);

  // Draw
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

    // Background checkerboard
    ctx.fillStyle = '#0e0e1a';
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);
    const cSize = 8;
    for (let cy = 0; cy * cSize < canvasSize.h; cy++) {
      for (let cx = 0; cx * cSize < canvasSize.w; cx++) {
        ctx.fillStyle = (cx + cy) % 2 === 0 ? '#1a1a28' : '#222233';
        ctx.fillRect(cx * cSize, cy * cSize, cSize, cSize);
      }
    }

    const img = imagesRef.current[activeFrameIndex];
    if (img && img.complete && img.naturalWidth > 0) {
      // Scale up with pixel-perfect rendering
      const scale = Math.min(
        canvasSize.w / img.naturalWidth,
        canvasSize.h / img.naturalHeight,
        8,
      );
      const drawW = img.naturalWidth * scale;
      const drawH = img.naturalHeight * scale;
      const ox = Math.floor((canvasSize.w - drawW) / 2);
      const oy = Math.floor((canvasSize.h - drawH) / 2);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, ox, oy, drawW, drawH);

      // Frame label
      ctx.fillStyle = '#f0c040';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`f${activeFrameIndex}`, 8, 8);
    } else {
      ctx.fillStyle = '#444';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        loadedCount > 0 ? `Frame ${activeFrameIndex} not available` : 'No frames generated yet',
        canvasSize.w / 2,
        canvasSize.h / 2,
      );
    }
  }, [activeFrameIndex, loadedCount, canvasSize]);

  return (
    <div ref={containerRef} style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ display: 'block', imageRendering: 'pixelated' }} />
    </div>
  );
}
