import React, { useState, useCallback } from 'react';
import type { PipelineStage, CharacterAnimation } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { PaintEditor } from '../shared/PaintEditor.js';
import * as api from '../../lib/bridge-api.js';

const PASS_COLUMNS: { key: PipelineStage; label: string }[] = [
  { key: 'pass1', label: 'Pass 1' },
  { key: 'pass1_edited', label: 'Edit' },
  { key: 'pass2', label: 'Pass 2' },
  { key: 'pass2_edited', label: 'Edit' },
  { key: 'pass3', label: 'Pass 3' },
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
    default: return '--';
  }
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

  const [selectedFrames, setSelectedFrames] = useState<Set<number>>(new Set());
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

  const handleCellClick = (frameIndex: number, pass: PipelineStage) => {
    const frame = anim.frames.find((f) => f.index === frameIndex);
    if (!frame) return;

    // Determine if this cell has an image
    const stage = frame.pipeline_stage;
    const passOrder: PipelineStage[] = ['pass1', 'pass1_edited', 'pass2', 'pass2_edited', 'pass3'];
    const passIdx = passOrder.indexOf(pass);
    const stageIdx = stage ? passOrder.indexOf(stage) : -1;

    if (stageIdx < passIdx) return; // No image for this pass yet

    // For edited stages, use the edited image; for pass stages, use the pass image
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

  const toggleFrameSelection = (frameIndex: number) => {
    setSelectedFrames((prev) => {
      const next = new Set(prev);
      if (next.has(frameIndex)) next.delete(frameIndex);
      else next.add(frameIndex);
      return next;
    });
  };

  const getSelectedIndices = (): number[] => {
    if (selectedFrames.size === 0) return anim.frames.map((f) => f.index);
    return Array.from(selectedFrames).sort();
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
    <div style={styles.container}>
      {/* Header row */}
      <div style={styles.headerRow}>
        <div style={styles.frameLabel}>Frame</div>
        {PASS_COLUMNS.map((col) => (
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
              style={{
                ...styles.frameRow,
                background: isSelected ? '#1a2a3a' : undefined,
              }}
            >
              {/* Frame index + selection */}
              <div
                style={styles.frameIndexCell}
                onClick={() => toggleFrameSelection(frame.index)}
              >
                <span style={styles.frameIndexLabel}>f{frame.index}</span>
                <span style={{
                  ...styles.badge,
                  borderColor: stageBadgeColor(stage),
                  color: stageBadgeColor(stage),
                }}>
                  {stageBadgeLabel(stage)}
                </span>
              </div>

              {/* Pass cells */}
              {PASS_COLUMNS.map((col) => {
                const passOrder: PipelineStage[] = ['pass1', 'pass1_edited', 'pass2', 'pass2_edited', 'pass3'];
                const passIdx = passOrder.indexOf(col.key);
                const stageIdx = stage ? passOrder.indexOf(stage) : -1;
                const hasImage = stageIdx >= passIdx;

                // For edited columns, only show if the actual stage is edited
                const isEditCol = col.key === 'pass1_edited' || col.key === 'pass2_edited';
                const showImage = isEditCol
                  ? (stage === col.key || (col.key === 'pass1_edited' && stageIdx > passIdx) || (col.key === 'pass2_edited' && stageIdx > passIdx))
                  : hasImage;

                let imageUrl: string | null = null;
                if (showImage) {
                  if (col.key === 'pass3' && frame.status === 'generated') {
                    imageUrl = api.frameThumbnailUrl(characterId, animName, frame.index);
                  } else if (isEditCol) {
                    // Show the base pass image if no explicit edit exists
                    const basePass = col.key === 'pass1_edited' ? 'pass1' : 'pass2';
                    imageUrl = stage === col.key
                      ? api.passImageUrl(characterId, animName, frame.index, col.key)
                      : api.passImageUrl(characterId, animName, frame.index, basePass);
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
  return [];
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
    display: 'flex',
    alignItems: 'center',
    padding: '6px 8px',
    borderBottom: '1px solid #2a2a3a',
    background: '#111120',
    flexShrink: 0,
  },
  frameLabel: {
    width: 60,
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: 600,
    color: '#666',
    flexShrink: 0,
  },
  colHeader: {
    flex: 1,
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
    display: 'flex',
    alignItems: 'center',
    padding: '4px 8px',
    borderBottom: '1px solid #1a1a2a',
    minHeight: 60,
  },
  frameIndexCell: {
    width: 60,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    cursor: 'pointer',
    flexShrink: 0,
  },
  frameIndexLabel: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: 600,
    color: '#aaa',
  },
  badge: {
    fontFamily: 'monospace',
    fontSize: 8,
    padding: '1px 4px',
    borderRadius: 3,
    border: '1px solid',
  },
  passCell: {
    flex: 1,
    aspectRatio: '1',
    maxWidth: 80,
    maxHeight: 80,
    margin: '0 2px',
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
