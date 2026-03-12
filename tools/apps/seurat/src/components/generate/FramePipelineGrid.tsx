import React, { useState, useRef, useEffect } from 'react';
import type { PipelineStage, CharacterAnimation } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { PaintEditor } from '../shared/PaintEditor.js';
import { getPose } from '../../lib/pose-templates.js';
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

/** Limb connections for drawing pose skeletons (14-keypoint OpenPose format) */
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

/** Tiny canvas that draws a pose skeleton */
function PoseCell({ animName, frameIndex, size }: { animName: string; frameIndex: number; size: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseOverrides = useSeuratStore((s) => s.poseOverrides);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = size;
    canvas.height = size;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);

    const key = `${animName}:${frameIndex}`;
    const pose = poseOverrides[key] ?? getPose(animName, frameIndex);
    if (!pose) {
      ctx.fillStyle = '#333';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('N/A', size / 2, size / 2 + 3);
      return;
    }

    const lw = Math.max(1.5, size / 40);
    const dr = lw * 0.8;

    for (const [i, j, color] of LIMBS) {
      const a = pose[i];
      const b = pose[j];
      if (!a || !b) continue;
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a[0] * size, a[1] * size);
      ctx.lineTo(b[0] * size, b[1] * size);
      ctx.stroke();
    }

    for (const kp of pose) {
      if (!kp) continue;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(kp[0] * size, kp[1] * size, dr, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [animName, frameIndex, size, poseOverrides]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', borderRadius: 3, display: 'block' }}
    />
  );
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

  // Default to select-all when animation changes or loads
  const frameCount = manifest?.animations.find((a) => a.name === animName)?.frames.length ?? 0;
  useEffect(() => {
    if (frameCount > 0) selectAllFrames(frameCount);
  }, [animName, frameCount]);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    frameIndex: number;
    pass: PipelineStage;
  } | null>(null);

  if (!manifest) return <div style={styles.empty}>Select an animation.</div>;

  const anim = manifest.animations.find((a) => a.name === animName);
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
            checked={anim.frames.length > 0 && selectedFrames.size === anim.frames.length}
            ref={(el) => {
              if (el) el.indeterminate = selectedFrames.size > 0 && selectedFrames.size < anim.frames.length;
            }}
            onChange={() => {
              if (selectedFrames.size === anim.frames.length) clearFrameSelection();
              else selectAllFrames(anim.frames.length);
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
        {anim.frames.map((frame) => {
          const isSelected = selectedFrames.has(frame.index);
          const stage = frame.pipeline_stage;

          return (
            <div
              key={frame.index}
              data-testid={`pipeline-row-${frame.index}`}
              style={{
                ...styles.frameRow,
                gridTemplateColumns: `60px repeat(${colCount}, 1fr)`,
                background: isSelected ? '#1a2a3a' : undefined,
              }}
            >
              {/* Frame index + selection */}
              <div
                style={styles.frameIndexCell}
                onClick={() => toggleFrameSelection(frame.index)}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleFrameSelection(frame.index)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ margin: 0 }}
                />
                <span style={styles.frameIndexLabel}>f{frame.index}</span>
                <span style={{
                  ...styles.badge,
                  borderColor: stageBadgeColor(stage),
                  color: stageBadgeColor(stage),
                }}>
                  {stageBadgeLabel(stage)}
                </span>
              </div>

              {/* Pose cell */}
              <div style={styles.passCell}>
                <PoseCell animName={animName} frameIndex={frame.index} size={128} />
              </div>

              {/* Pass cells */}
              {PASS_COLUMNS.map((col) => {
                const passOrder: PipelineStage[] = ['pass1', 'pass1_edited', 'pass2', 'pass2_edited', 'pass3'];
                const passIdx = passOrder.indexOf(col.key);
                const stageIdx = stage ? passOrder.indexOf(stage) : -1;
                const hasImage = stageIdx >= passIdx;

                const isEditCol = col.key === 'pass1_edited' || col.key === 'pass2_edited';
                const showImage = isEditCol
                  ? (stage === col.key || (col.key === 'pass1_edited' && stageIdx > passIdx) || (col.key === 'pass2_edited' && stageIdx > passIdx))
                  : hasImage;

                let imageUrl: string | null = null;
                if (showImage) {
                  if (col.key === 'pass3' && frame.status === 'generated') {
                    imageUrl = api.frameThumbnailUrl(characterId, animName, frame.index);
                  } else if (isEditCol) {
                    // Always show the edited image in edit columns (the file persists on disk
                    // even after the pipeline advances past this stage)
                    imageUrl = api.passImageUrl(characterId, animName, frame.index, col.key);
                  } else {
                    imageUrl = api.passImageUrl(characterId, animName, frame.index, col.key);
                  }
                }

                return (
                  <div
                    key={col.key}
                    style={{
                      ...styles.passCell,
                      opacity: showImage ? 1 : 0.3,
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
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <span style={styles.cellEmpty}>--</span>
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
