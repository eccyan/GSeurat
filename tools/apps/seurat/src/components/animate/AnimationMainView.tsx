import React, { useState } from 'react';
import type { CharacterFrame } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { AnimationPreviewCanvas } from './AnimationPreviewCanvas.js';
import { FramePreviewCanvas } from './FramePreviewCanvas.js';
import { ClipTimeline } from './ClipTimeline.js';
import { FrameCell } from '../review/FrameCell.js';
import { FrameDetailModal } from '../review/FrameDetailModal.js';
import { PosePreview } from './PosePreview.js';

interface Props {
  animName: string;
}

export function AnimationMainView({ animName }: Props) {
  const manifest = useSeuratStore((s) => s.manifest);
  const spriteSheetUrl = useSeuratStore((s) => s.spriteSheetUrl);
  const loadSpriteSheet = useSeuratStore((s) => s.loadSpriteSheet);
  const playbackState = useSeuratStore((s) => s.playbackState);
  const currentTime = useSeuratStore((s) => s.currentTime);
  const selectClip = useSeuratStore((s) => s.selectClip);

  const [detailFrame, setDetailFrame] = useState<{ animName: string; frame: CharacterFrame } | null>(null);
  const topAreaRef = React.useRef<HTMLDivElement>(null);
  const [topHeight, setTopHeight] = React.useState(0);

  // Observe top area height → square preview width
  React.useEffect(() => {
    const el = topAreaRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setTopHeight(Math.floor(entries[0].contentRect.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-select clip when animName changes
  React.useEffect(() => {
    selectClip(animName);
  }, [animName]);

  if (!manifest) {
    return <div style={styles.empty}>Select an animation.</div>;
  }

  const clip = manifest.animations.find((a) => a.name === animName) ?? null;

  if (!clip) {
    return <div style={styles.empty}>Animation "{animName}" not found.</div>;
  }

  const filteredFrames = clip.frames;

  const hasGeneratedFrames = clip.frames.some((f) => f.status !== 'pending' && f.status !== 'generating');
  const useFramePreview = !spriteSheetUrl && hasGeneratedFrames;

  return (
    <div style={styles.container}>
      {/* Top area: square preview (left) + timeline (right) */}
      <div ref={topAreaRef} style={styles.topArea}>
        {/* Square preview — width = height */}
        <div style={{
          ...styles.previewSquare,
          width: topHeight > 0 ? topHeight : '50%',
          minWidth: topHeight > 0 ? topHeight : '50%',
        }}>
          {!spriteSheetUrl && !hasGeneratedFrames && (
            <div style={styles.loadOverlay}>
              <button onClick={loadSpriteSheet} style={styles.loadBtn}>Load Sprite Sheet</button>
            </div>
          )}
          {useFramePreview ? (
            <FramePreviewCanvas
              characterId={manifest.character_id}
              clip={clip}
              currentTime={currentTime}
              playbackState={playbackState}
            />
          ) : (
            <AnimationPreviewCanvas
              spriteSheetUrl={spriteSheetUrl}
              spritesheet={manifest.spritesheet}
              clip={clip}
              currentTime={currentTime}
              playbackState={playbackState}
              selectedFrameIndex={0}
            />
          )}
        </div>

        {/* Timeline — fills remaining width */}
        <div style={styles.timelineSide}>
          <ClipTimeline clip={clip} />
        </div>
      </div>

      {/* Frame review grid */}
      <div style={styles.reviewGrid}>
        <div style={styles.gridHeader}>
          <span style={styles.animLabel}>{clip.name}</span>
          <span style={{ fontSize: 9, color: '#555', fontFamily: 'monospace' }}>
            {filteredFrames.length} frames
          </span>
        </div>
        <div style={styles.framesRow}>
          {filteredFrames.map((frame) => (
            <FrameCell
              key={frame.index}
              frame={frame}
              animName={clip.name}
              characterId={manifest.character_id}
              onClick={() => setDetailFrame({ animName: clip.name, frame })}
            />
          ))}
        </div>
      </div>

      {/* Pose skeleton preview */}
      <div style={{ padding: '0 12px 12px' }}>
        <PosePreview animName={animName} frameCount={clip.frames.length} />
      </div>

      {detailFrame && (
        <FrameDetailModal
          frame={detailFrame.frame}
          animName={detailFrame.animName}
          characterId={manifest.character_id}
          onClose={() => setDetailFrame(null)}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  empty: {
    padding: 24,
    color: '#555',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  topArea: {
    flex: '1 1 50%',
    display: 'flex',
    flexDirection: 'row',
    overflow: 'hidden',
    borderBottom: '1px solid #2a2a3a',
  },
  previewSquare: {
    height: '100%',
    overflow: 'hidden',
    display: 'flex',
    position: 'relative',
    borderRight: '1px solid #2a2a3a',
    flexShrink: 0,
  },
  timelineSide: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  loadOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  loadBtn: {
    background: '#1e3a6e',
    border: '1px solid #4a8af8',
    borderRadius: 4,
    color: '#90b8f8',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '8px 16px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  reviewGrid: {
    flex: '0 0 auto',
    padding: 12,
    overflowY: 'auto',
    maxHeight: 200,
  },
  gridHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  animLabel: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#aaa',
    fontWeight: 600,
  },
  framesRow: {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap',
  },
};
