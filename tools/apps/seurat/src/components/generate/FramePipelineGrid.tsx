import React, { useState, useEffect, useMemo } from 'react';
import type { PipelineStage, CharacterFrame, CharacterAnimation } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { PaintEditor } from '../shared/PaintEditor.js';
import { PoseCell } from '../shared/PoseCell.js';
import * as api from '../../lib/bridge-api.js';

/** Columns after the Pose column */
const PASS_COLUMNS: { key: PipelineStage; label: string }[] = [
  { key: 'pass1', label: 'Pass 1' },
  { key: 'pass1_edited', label: 'Edit' },
  { key: 'pass2', label: 'Pass 2' },
  { key: 'pass2_edited', label: 'Edit' },
  { key: 'pass3', label: 'Pass 3' },
];

/** All column keys including pose */
type ColumnKey = 'pose' | PipelineStage;

const ALL_COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: 'pose', label: 'Pose' },
  ...PASS_COLUMNS,
];

function stageBadgeColor(stage?: PipelineStage): string {
  switch (stage) {
    case 'pass1': return '#4a8af8';
    case 'pass1_edited': return '#f8c860';
    case 'pass2': return '#60c880';
    case 'pass2_edited': return '#f8c860';
    case 'pass3': return '#70d870';
    default: return '#444';
  }
}

function stageBadgeLabel(stage?: PipelineStage): string {
  switch (stage) {
    case 'pass1': return 'P1';
    case 'pass1_edited': return 'E1';
    case 'pass2': return 'P2';
    case 'pass2_edited': return 'E2';
    case 'pass3': return 'P3';
    default: return 'pending';
  }
}

/** A display-only frame: either a real manifest frame or a virtual interpolation placeholder */
interface DisplayFrame {
  /** The frame data from the manifest (null for virtual placeholders) */
  frame: CharacterFrame | null;
  /** Display index in the grid */
  displayIndex: number;
  /** Whether this is an interpolated (non-keyframe) slot */
  isInterpolated: boolean;
}

/**
 * Build the list of display frames. If the animation already has keyframe markers,
 * use frames as-is. Otherwise, expand based on interpMultiplier by inserting
 * virtual interpolation placeholders between each pair of keyframes.
 */
function buildDisplayFrames(anim: CharacterAnimation, interpMultiplier: number): DisplayFrame[] {
  const hasKeyframeMarkers = anim.frames.some((f) => f.keyframe === true || f.keyframe === false);

  if (hasKeyframeMarkers || interpMultiplier <= 1) {
    // Already has interpolation structure or no interpolation needed — use as-is
    return anim.frames.map((f) => ({
      frame: f,
      displayIndex: f.index,
      isInterpolated: f.keyframe === false,
    }));
  }

  // Old manifest without keyframe markers — insert virtual interp slots
  const result: DisplayFrame[] = [];
  const mult = Math.max(1, Math.round(interpMultiplier));
  for (let i = 0; i < anim.frames.length; i++) {
    const keyFrame = anim.frames[i];
    const displayIdx = i * mult;
    result.push({
      frame: keyFrame,
      displayIndex: displayIdx,
      isInterpolated: false,
    });
    // Insert (mult - 1) virtual placeholders after each keyframe.
    // For looping anims the last keyframe also gets slots (last→first interp).
    const addSlots = (i < anim.frames.length - 1) || anim.loop;
    if (addSlots) {
      for (let j = 1; j < mult; j++) {
        result.push({
          frame: null,
          displayIndex: displayIdx + j,
          isInterpolated: true,
        });
      }
    }
  }
  return result;
}

interface Props {
  animName: string;
}

export function FramePipelineGrid({ animName }: Props) {
  const manifest = useSeuratStore((s) => s.manifest);
  const frameRevision = useSeuratStore((s) => s.frameRevision);
  const saveEditedFrame = useSeuratStore((s) => s.saveEditedFrame);
  const copyFrame = useSeuratStore((s) => s.copyFrame);
  const pasteFrame = useSeuratStore((s) => s.pasteFrame);
  const clipboard = useSeuratStore((s) => s.clipboard);
  const interpMultiplier = useSeuratStore((s) => s.aiConfig.interpMultiplier);

  const [editing, setEditing] = useState<{
    animName: string;
    frameIndex: number;
    pass: PipelineStage;
    imageUrl: string;
  } | null>(null);

  const selectedFrames = useSeuratStore((s) => s.selectedFrames);
  const toggleFrameSelection = useSeuratStore((s) => s.toggleFrameSelection);
  const selectAllFrames = useSeuratStore((s) => s.selectAllFrames);
  const clearFrameSelection = useSeuratStore((s) => s.clearFrameSelection);

  const anim = manifest?.animations.find((a) => a.name === animName);
  const displayFrames = useMemo(
    () => anim ? buildDisplayFrames(anim, interpMultiplier) : [],
    [anim, interpMultiplier],
  );

  // Clear selection when animation changes or loads
  const frameCount = displayFrames.length;
  useEffect(() => {
    clearFrameSelection();
  }, [animName, frameCount]);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    frameIndex: number;
    pass: PipelineStage;
  } | null>(null);

  if (!manifest) return <div style={styles.empty}>Select an animation.</div>;
  if (!anim) return <div style={styles.empty}>Animation "{animName}" not found.</div>;

  const characterId = manifest.character_id;
  const colCount = ALL_COLUMNS.length; // 6 (pose + 5 passes)

  const handleCellClick = (frameIndex: number, pass: PipelineStage) => {
    const frame = anim.frames.find((f) => f.index === frameIndex);
    if (!frame) return;

    const stage = frame.pipeline_stage;
    const passOrder: PipelineStage[] = ['pass1', 'pass1_edited', 'pass2', 'pass2_edited', 'pass3'];
    const passIdx = passOrder.indexOf(pass);
    const stageIdx = stage ? passOrder.indexOf(stage) : -1;

    if (stageIdx < passIdx) return;

    let imageUrl: string;
    if (pass === 'pass3' && frame.status === 'generated') {
      imageUrl = api.frameThumbnailUrl(characterId, animName, frameIndex);
    } else {
      imageUrl = api.passImageUrl(characterId, animName, frameIndex, pass);
    }

    setEditing({ animName, frameIndex, pass, imageUrl });
  };

  const handleContextMenu = (e: React.MouseEvent, frameIndex: number, pass: PipelineStage) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, frameIndex, pass });
  };

  const handleSaveEdited = async (pngBytes: Uint8Array) => {
    if (!editing) return;
    await saveEditedFrame(editing.animName, editing.frameIndex, editing.pass, pngBytes);
  };

  // If editing, show PaintEditor
  if (editing) {
    return (
      <PaintEditor
        imageUrl={editing.imageUrl}
        title={`${animName} f${editing.frameIndex} - ${editing.pass}`}
        onSave={handleSaveEdited}
        onClose={() => setEditing(null)}
      />
    );
  }

  return (
    <div style={styles.container} data-testid="pipeline-grid">
      {/* Header row — uses CSS grid to match cell columns */}
      <div style={{ ...styles.headerRow, gridTemplateColumns: `60px repeat(${colCount}, 1fr)` }}>
        <div style={styles.frameLabel}>
          <input
            type="checkbox"
            checked={displayFrames.length > 0 && selectedFrames.size === displayFrames.length}
            ref={(el) => {
              if (el) el.indeterminate = selectedFrames.size > 0 && selectedFrames.size < displayFrames.length;
            }}
            onChange={() => {
              if (selectedFrames.size === displayFrames.length) clearFrameSelection();
              else selectAllFrames(displayFrames.length);
            }}
            style={{ marginRight: 4 }}
          />
          All
        </div>
        {ALL_COLUMNS.map((col) => (
          <div key={col.key} style={styles.colHeader}>{col.label}</div>
        ))}
      </div>

      {/* Frame rows */}
      <div style={styles.scrollArea}>
        {displayFrames.map((df) => {
          const { frame, displayIndex, isInterpolated } = df;
          const isSelected = selectedFrames.has(displayIndex);
          const stage = frame?.pipeline_stage;
          const isVirtual = frame === null; // no manifest entry yet

          return (
            <div
              key={displayIndex}
              data-testid={`pipeline-row-${displayIndex}`}
              style={{
                ...styles.frameRow,
                gridTemplateColumns: `60px repeat(${colCount}, 1fr)`,
                background: isSelected ? '#1a2a3a' : undefined,
                opacity: isInterpolated ? 0.6 : 1,
              }}
            >
              {/* Frame index + selection */}
              <div
                style={styles.frameIndexCell}
                onClick={() => toggleFrameSelection(displayIndex)}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleFrameSelection(displayIndex)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ margin: 0 }}
                />
                <span style={styles.frameIndexLabel}>f{displayIndex}</span>
                <span style={{
                  ...styles.badge,
                  borderColor: isInterpolated ? '#b080f0' : stageBadgeColor(stage),
                  color: isInterpolated ? '#b080f0' : stageBadgeColor(stage),
                }}>
                  {isInterpolated ? 'interp' : stageBadgeLabel(stage)}
                </span>
              </div>

              {/* Pose cell — only keyframes have poses; interpolated frames are derived from pixels */}
              <div style={{
                ...styles.passCell,
                opacity: (isVirtual || isInterpolated) ? 0.15 : 1,
              }}>
                {(isVirtual || isInterpolated) ? (
                  <span style={styles.cellEmpty}>~</span>
                ) : (
                  <PoseCell animName={animName} frameIndex={frame!.index} size={128} />
                )}
              </div>

              {/* Pass cells */}
              {PASS_COLUMNS.map((col) => {
                if (isVirtual) {
                  // Virtual placeholder — no manifest frame, show empty placeholder
                  return (
                    <div key={col.key} style={{ ...styles.passCell, opacity: 0.15 }}>
                      <span style={styles.cellEmpty}>~</span>
                    </div>
                  );
                }

                const passOrder: PipelineStage[] = ['pass1', 'pass1_edited', 'pass2', 'pass2_edited', 'pass3'];
                const passIdx = passOrder.indexOf(col.key);
                const stageIdx = stage ? passOrder.indexOf(stage) : -1;
                const hasImage = stageIdx >= passIdx;

                const isEditCol = col.key === 'pass1_edited' || col.key === 'pass2_edited';

                // Interpolated frames: show pass2 image in pass2 and pass2_edited columns,
                // pass3 when pixelized. Skip pass1/pass1_edited (not generated for interp).
                let showImage: boolean;
                if (isInterpolated) {
                  if (col.key === 'pass2' || col.key === 'pass2_edited') {
                    showImage = stage === 'pass2' || stage === 'pass2_edited' || stage === 'pass3';
                  } else if (col.key === 'pass3') {
                    showImage = stage === 'pass3';
                  } else {
                    showImage = false;
                  }
                } else {
                  showImage = isEditCol
                    ? (stage === col.key || (col.key === 'pass1_edited' && stageIdx > passIdx) || (col.key === 'pass2_edited' && stageIdx > passIdx))
                    : hasImage;
                }

                let imageUrl: string | null = null;
                if (showImage) {
                  if (col.key === 'pass3' && frame.status === 'generated') {
                    imageUrl = api.frameThumbnailUrl(characterId, animName, frame.index, frameRevision);
                  } else if (isInterpolated && col.key === 'pass2_edited') {
                    // Interpolated frames don't have a separate edited file —
                    // show the pass2 image (which was derived from edited keyframes)
                    imageUrl = api.passImageUrl(characterId, animName, frame.index, 'pass2', frameRevision);
                  } else if (isEditCol) {
                    imageUrl = api.passImageUrl(characterId, animName, frame.index, col.key, frameRevision);
                  } else {
                    imageUrl = api.passImageUrl(characterId, animName, frame.index, col.key, frameRevision);
                  }
                }

                return (
                  <div
                    key={col.key}
                    style={{
                      ...styles.passCell,
                      opacity: showImage ? 1 : (isInterpolated ? 0.15 : 0.3),
                      cursor: showImage ? 'pointer' : 'default',
                    }}
                    onClick={() => showImage && handleCellClick(frame.index, col.key)}
                    onContextMenu={(e) => showImage && handleContextMenu(e, frame.index, col.key)}
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={`f${frame.index} ${col.key}`}
                        style={styles.cellImg}
                        loading="lazy"
                      />
                    ) : (
                      <span style={styles.cellEmpty}>{isInterpolated ? '~' : '--'}</span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div style={styles.contextOverlay} onClick={() => setContextMenu(null)} />
          <div style={{ ...styles.contextMenu, left: contextMenu.x, top: contextMenu.y }}>
            <div
              style={styles.contextItem}
              onClick={() => {
                copyFrame(animName, contextMenu.frameIndex, contextMenu.pass);
                setContextMenu(null);
              }}
            >
              Copy
            </div>
            <div
              style={{
                ...styles.contextItem,
                opacity: clipboard ? 1 : 0.4,
              }}
              onClick={() => {
                if (clipboard) {
                  pasteFrame(animName, contextMenu.frameIndex, contextMenu.pass);
                }
                setContextMenu(null);
              }}
            >
              Paste {clipboard ? `(from ${clipboard.animName} f${clipboard.frameIndex})` : ''}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Exported helper for RightPane to get selected indices
export function useSelectedFrameIndices(): number[] {
  const selectedFrames = useSeuratStore((s) => s.selectedFrames);
  return Array.from(selectedFrames).sort((a, b) => a - b);
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    background: '#0e0e1a',
  },
  empty: {
    padding: 24,
    color: '#555',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  headerRow: {
    display: 'grid',
    alignItems: 'center',
    padding: '6px 8px',
    borderBottom: '1px solid #2a2a3a',
    background: '#111120',
    flexShrink: 0,
    gap: 4,
  },
  frameLabel: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: 600,
    color: '#666',
  },
  colHeader: {
    textAlign: 'center',
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: 600,
    color: '#888',
  },
  scrollArea: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  frameRow: {
    display: 'grid',
    alignItems: 'center',
    padding: '4px 8px',
    borderBottom: '1px solid #1a1a2a',
    gap: 4,
  },
  frameIndexCell: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    cursor: 'pointer',
  },
  frameIndexLabel: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: 600,
    color: '#aaa',
  },
  badge: {
    fontFamily: 'monospace',
    fontSize: 7,
    padding: '1px 4px',
    borderRadius: 3,
    border: '1px solid',
  },
  passCell: {
    aspectRatio: '1',
    background: '#0a0a14',
    border: '1px solid #2a2a3a',
    borderRadius: 4,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellImg: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    imageRendering: 'pixelated' as const,
  },
  cellEmpty: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#333',
  },
  contextOverlay: {
    position: 'fixed' as const,
    inset: 0,
    zIndex: 999,
  },
  contextMenu: {
    position: 'fixed' as const,
    zIndex: 1000,
    background: '#1a1a2e',
    border: '1px solid #4a4a6a',
    borderRadius: 4,
    padding: 4,
    minWidth: 140,
  },
  contextItem: {
    padding: '6px 10px',
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#ccc',
    cursor: 'pointer',
    borderRadius: 3,
  },
};
