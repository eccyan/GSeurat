import React, { useState } from 'react';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { AnimationPreviewCanvas } from '../animate/AnimationPreviewCanvas.js';
import { FramePreviewCanvas } from '../animate/FramePreviewCanvas.js';
import { ClipTimeline } from '../animate/ClipTimeline.js';

export function BottomPane() {
  const treeSelection = useSeuratStore((s) => s.treeSelection);
  const manifest = useSeuratStore((s) => s.manifest);
  const spriteSheetUrl = useSeuratStore((s) => s.spriteSheetUrl);
  const playbackState = useSeuratStore((s) => s.playbackState);
  const currentTime = useSeuratStore((s) => s.currentTime);
  const selectClip = useSeuratStore((s) => s.selectClip);

  const [collapsed, setCollapsed] = useState(false);

  const animName = treeSelection.kind === 'animation' ? treeSelection.animName : null;

  // Auto-select clip (must be before any early returns)
  React.useEffect(() => {
    if (animName) selectClip(animName);
  }, [animName]);

  if (treeSelection.kind !== 'animation' || !manifest) return null;

  const clip = manifest.animations.find((a) => a.name === animName);
  if (!clip) return null;

  const hasGeneratedFrames = clip.frames.some((f) => f.status !== 'pending' && f.status !== 'generating');
  const useFramePreview = !spriteSheetUrl && hasGeneratedFrames;

  return (
    <div data-testid="bottom-pane" style={{
      ...styles.container,
      height: collapsed ? 30 : 240,
    }}>
      {/* Toggle handle */}
      <div
        style={styles.handle}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span style={styles.handleLabel}>
          {collapsed ? '\u25B2' : '\u25BC'} Animation Preview
        </span>
        <span style={styles.handleInfo}>
          {clip.name} ({clip.frames.length} frames)
        </span>
      </div>

      {!collapsed && (
        <div style={styles.content}>
          {/* Preview area */}
          <div style={styles.preview}>
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

          {/* Timeline */}
          <div style={styles.timeline}>
            <ClipTimeline clip={clip} />
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    borderTop: '1px solid #2a2a3a',
    background: '#111120',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    overflow: 'hidden',
    transition: 'height 0.2s ease',
  },
  handle: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '6px 12px',
    background: '#161628',
    cursor: 'pointer',
    flexShrink: 0,
    borderBottom: '1px solid #2a2a3a',
    userSelect: 'none',
  },
  handleLabel: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: 600,
    color: '#888',
  },
  handleInfo: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#555',
  },
  content: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  preview: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    borderRight: '1px solid #2a2a3a',
  },
  timeline: {
    width: 300,
    flexShrink: 0,
    overflow: 'hidden',
  },
};
