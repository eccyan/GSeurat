import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { ViewDirection } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { PaintEditor } from '../shared/PaintEditor.js';
import { PoseCell } from '../shared/PoseCell.js';
import { SinglePoseEditor } from '../shared/SinglePoseEditor.js';
import { CONCEPT_VIEW_POSES } from '../../lib/pose-templates.js';
import * as api from '../../lib/bridge-api.js';

const VIEW_ORDER: { view: ViewDirection; label: string }[] = [
  { view: 'front', label: 'Front' },
  { view: 'back',  label: 'Back' },
  { view: 'right', label: 'Right' },
  { view: 'left',  label: 'Left' },
];

/* ── Small thumbnail cell — click to open editor ── */
function ImageCell({
  url,
  alt,
  errorKey,
  imgError,
  setImgError,
  onClick,
  generating,
  exists,
}: {
  url: string | null;
  alt: string;
  errorKey: string;
  imgError: Record<string, boolean>;
  setImgError: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onClick: () => void;
  generating?: boolean;
  exists?: boolean;
}) {
  const borderColor = generating ? '#8a4af8' : exists ? '#44aa44' : '#2a2a3a';
  return (
    <div style={{ ...styles.cell, borderColor }} onClick={url ? onClick : undefined}>
      {generating && (
        <div style={styles.spinner}>...</div>
      )}
      {url && !imgError[errorKey] && !generating ? (
        <img
          src={url}
          alt={alt}
          crossOrigin="anonymous"
          style={styles.cellImg}
          onError={() => setImgError((prev) => ({ ...prev, [errorKey]: true }))}
        />
      ) : !generating ? (
        <div style={styles.cellPlaceholder}>—</div>
      ) : null}
    </div>
  );
}

/** Flip an image horizontally via OffscreenCanvas, returns PNG bytes. */
async function mirrorImage(sourceUrl: string): Promise<Uint8Array> {
  const resp = await fetch(sourceUrl);
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const outBlob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await outBlob.arrayBuffer());
}

/* ── Main preview ── */
export function ConceptPreview() {
  const manifest = useSeuratStore((s) => s.manifest);
  const conceptImageUrl = useSeuratStore((s) => s.conceptImageUrl);
  const chibiImageUrl = useSeuratStore((s) => s.chibiImageUrl);
  const conceptViewUrls = useSeuratStore((s) => s.conceptViewUrls);
  const chibiViewUrls = useSeuratStore((s) => s.chibiViewUrls);
  const hasConceptBase = useSeuratStore((s) => s.hasConceptBase);
  const conceptPoseCurrentView = useSeuratStore((s) => s.conceptPoseCurrentView);
  const detectedPoseUrl = useSeuratStore((s) => s.detectedPoseUrl);
  const detectedViewPoseUrls = useSeuratStore((s) => s.detectedViewPoseUrls);
  const detectingPose = useSeuratStore((s) => s.detectingPose);
  const detectConceptPose = useSeuratStore((s) => s.detectConceptPose);
  const loadConceptViewUrls = useSeuratStore((s) => s.loadConceptViewUrls);
  const loadChibiViewUrls = useSeuratStore((s) => s.loadChibiViewUrls);
  const uploadConceptImageForView = useSeuratStore((s) => s.uploadConceptImageForView);
  const uploadChibiImageForView = useSeuratStore((s) => s.uploadChibiImageForView);
  const [imgError, setImgError] = useState<Record<string, boolean>>({});
  const [mirroring, setMirroring] = useState<string | null>(null);

  // Pose editor state
  const [editingPose, setEditingPose] = useState<{ animName: string; frameIndex: number; title: string } | null>(null);

  // Editor state: which image is being edited
  const [editing, setEditing] = useState<{
    url: string;
    title: string;
    type: 'concept' | 'chibi';
    view: ViewDirection | 'base';
  } | null>(null);

  // Reset error state when image URLs change
  const prevUrls = useRef({ conceptImageUrl, chibiImageUrl });
  useEffect(() => {
    const prev = prevUrls.current;
    if (conceptImageUrl !== prev.conceptImageUrl || chibiImageUrl !== prev.chibiImageUrl) {
      setImgError({});
    }
    prevUrls.current = { conceptImageUrl, chibiImageUrl };
  }, [conceptImageUrl, chibiImageUrl]);

  const handleMirror = useCallback(async (
    type: 'concept' | 'chibi',
    fromView: ViewDirection,
    toView: ViewDirection,
  ) => {
    if (!manifest) return;
    const key = `${type}_${fromView}_to_${toView}`;
    setMirroring(key);
    try {
      const fromUrl = type === 'concept'
        ? (conceptViewUrls[fromView] ?? (fromView === 'front' ? conceptImageUrl : null))
        : (chibiViewUrls[fromView] ?? (fromView === 'front' ? chibiImageUrl : null));
      if (!fromUrl) return;
      const flipped = await mirrorImage(fromUrl);
      const file = new File([flipped as BlobPart], `${type}_${toView}.png`, { type: 'image/png' });
      if (type === 'concept') {
        await uploadConceptImageForView(file, toView);
      } else {
        await uploadChibiImageForView(file, toView);
      }
    } finally {
      setMirroring(null);
    }
  }, [manifest, conceptViewUrls, chibiViewUrls, conceptImageUrl, chibiImageUrl, uploadConceptImageForView, uploadChibiImageForView]);

  const loadConceptImage = useSeuratStore((s) => s.loadConceptImage);

  const handleSaveEdited = useCallback(async (pngBytes: Uint8Array) => {
    if (!manifest || !editing) return;
    const { type, view } = editing;
    if (view === 'base') {
      // Saving the identity anchor (concept.png)
      await api.saveConceptImage(manifest.character_id, pngBytes);
      loadConceptImage();
      return;
    }
    if (type === 'concept') {
      await api.saveConceptImage(manifest.character_id, pngBytes, view);
      if (view === 'front') await api.saveConceptImage(manifest.character_id, pngBytes);
      loadConceptViewUrls();
    } else {
      await api.saveChibiImage(manifest.character_id, pngBytes, view);
      if (view === 'front') await api.saveChibiImage(manifest.character_id, pngBytes);
      loadChibiViewUrls();
    }
  }, [manifest, editing, loadConceptImage, loadConceptViewUrls, loadChibiViewUrls]);

  if (!manifest) {
    return (
      <div style={styles.empty}>Select a character to view concept art.</div>
    );
  }

  // If editing, show the paint editor full-screen
  if (editing) {
    return (
      <PaintEditor
        imageUrl={editing.url}
        title={editing.title}
        onSave={handleSaveEdited}
        onClose={() => setEditing(null)}
      />
    );
  }

  const rightConceptUrl = conceptViewUrls.right ?? null;
  const rightChibiUrl = chibiViewUrls.right ?? null;
  const leftConceptUrl = conceptViewUrls.left ?? null;
  const leftChibiUrl = chibiViewUrls.left ?? null;

  return (
    <div style={styles.container}>
      {/* ── Top: Identity Anchor ── */}
      <div style={styles.anchorSection}>
        <div style={styles.anchorLabel}>Concept</div>
        <div style={styles.anchorRow}>
          {hasConceptBase && conceptImageUrl ? (
            <div
              style={styles.anchorImageWrap}
              onClick={() => setEditing({ url: conceptImageUrl, title: 'Concept', type: 'concept', view: 'base' })}
            >
              <img
                src={conceptImageUrl}
                alt="Identity concept"
                crossOrigin="anonymous"
                style={styles.anchorImg}
                onError={() => setImgError((prev) => ({ ...prev, anchor: true }))}
              />
            </div>
          ) : (
            <div style={styles.anchorPlaceholder}>
              Generate or upload a concept image
            </div>
          )}

          {/* Detected pose skeleton */}
          {detectedPoseUrl ? (
            <div style={styles.anchorPoseWrap}>
              <img src={detectedPoseUrl} alt="Detected pose" style={styles.anchorImg} />
            </div>
          ) : hasConceptBase ? (
            <div
              style={{ ...styles.anchorPlaceholder, cursor: detectingPose ? 'wait' : 'pointer' }}
              onClick={!detectingPose ? detectConceptPose : undefined}
            >
              {detectingPose ? 'Detecting...' : 'Detect Pose'}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Bottom: Directional Views Grid ── */}
      <div style={styles.gridHeader}>
        <div style={styles.dirLabel} />
        <div style={styles.colLabel}>Template</div>
        <div style={styles.colLabel}>Detected</div>
        <div style={styles.colLabel}>Concept</div>
        <div style={styles.colLabel}>Chibi</div>
      </div>

      {VIEW_ORDER.map(({ view, label }) => {
        const conceptUrl = conceptViewUrls[view] ?? null;
        const chibiUrl = chibiViewUrls[view] ?? (view === 'front' ? chibiImageUrl : null);
        const poseDef = CONCEPT_VIEW_POSES[view];
        const hasConceptView = !!conceptUrl;
        const detectedViewUrl = detectedViewPoseUrls[view];

        return (
          <React.Fragment key={view}>
            <div style={styles.row}>
              <div style={styles.dirLabel}>{label}</div>

              {/* Template pose cell — click to edit */}
              <div
                style={styles.poseWrap}
                onClick={() => poseDef && setEditingPose({ animName: poseDef.animName, frameIndex: poseDef.frameIndex, title: `${label} Pose` })}
              >
                {poseDef && (
                  <PoseCell
                    animName={poseDef.animName}
                    frameIndex={poseDef.frameIndex}
                    size={128}
                  />
                )}
              </div>

              {/* Detected pose from generated view */}
              <div style={{ ...styles.poseWrap, borderColor: detectedViewUrl ? '#6a6a8a' : '#1a1a2a' }}>
                {detectedViewUrl ? (
                  <img src={detectedViewUrl} alt={`${label} detected`} style={styles.cellImg} />
                ) : (
                  <div style={styles.cellPlaceholder}>—</div>
                )}
              </div>

              {/* Concept view */}
              <ImageCell
                url={conceptUrl}
                alt={`${label} concept`}
                errorKey={`concept_${view}`}
                imgError={imgError}
                setImgError={setImgError}
                onClick={() => conceptUrl && setEditing({ url: conceptUrl, title: `${label} Concept`, type: 'concept', view })}
                generating={conceptPoseCurrentView === view}
                exists={hasConceptView}
              />

              {/* Chibi view */}
              <ImageCell
                url={chibiUrl}
                alt={`${label} chibi`}
                errorKey={`chibi_${view}`}
                imgError={imgError}
                setImgError={setImgError}
                onClick={() => chibiUrl && setEditing({ url: chibiUrl, title: `${label} Chibi`, type: 'chibi', view })}
                exists={!!chibiUrl}
              />
            </div>

            {/* Mirror buttons between Right and Left rows */}
            {view === 'right' && (
              <div style={styles.mirrorRow}>
                <div style={styles.dirLabel} />
                <div style={styles.mirrorSpacer} />
                <div style={styles.mirrorBtnGroup}>
                  <button
                    style={{ ...styles.mirrorBtn, opacity: rightConceptUrl ? 1 : 0.3 }}
                    disabled={!rightConceptUrl || !!mirroring}
                    onClick={() => handleMirror('concept', 'right', 'left')}
                    title="Mirror Right concept → Left"
                  >
                    {mirroring === 'concept_right_to_left' ? '...' : 'R → L'}
                  </button>
                  <button
                    style={{ ...styles.mirrorBtn, opacity: leftConceptUrl ? 1 : 0.3 }}
                    disabled={!leftConceptUrl || !!mirroring}
                    onClick={() => handleMirror('concept', 'left', 'right')}
                    title="Mirror Left concept → Right"
                  >
                    {mirroring === 'concept_left_to_right' ? '...' : 'L → R'}
                  </button>
                </div>
                <div style={styles.mirrorBtnGroup}>
                  <button
                    style={{ ...styles.mirrorBtn, opacity: rightChibiUrl ? 1 : 0.3 }}
                    disabled={!rightChibiUrl || !!mirroring}
                    onClick={() => handleMirror('chibi', 'right', 'left')}
                    title="Mirror Right chibi → Left"
                  >
                    {mirroring === 'chibi_right_to_left' ? '...' : 'R → L'}
                  </button>
                  <button
                    style={{ ...styles.mirrorBtn, opacity: leftChibiUrl ? 1 : 0.3 }}
                    disabled={!leftChibiUrl || !!mirroring}
                    onClick={() => handleMirror('chibi', 'left', 'right')}
                    title="Mirror Left chibi → Right"
                  >
                    {mirroring === 'chibi_left_to_right' ? '...' : 'L → R'}
                  </button>
                </div>
              </div>
            )}
          </React.Fragment>
        );
      })}

      {/* Pose editor overlay */}
      {editingPose && (
        <SinglePoseEditor
          animName={editingPose.animName}
          frameIndex={editingPose.frameIndex}
          title={editingPose.title}
          onClose={() => setEditingPose(null)}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 16,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    overflowY: 'auto',
    position: 'relative',
  },
  empty: {
    padding: 24,
    textAlign: 'center',
    color: '#555',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  /* Identity anchor */
  anchorSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  anchorLabel: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: 600,
    color: '#aaa',
  },
  anchorRow: {
    display: 'flex',
    gap: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  anchorImageWrap: {
    width: 160,
    height: 160,
    background: '#0e0e1a',
    border: '2px solid #44aa44',
    borderRadius: 6,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  anchorPoseWrap: {
    width: 160,
    height: 160,
    background: '#000',
    border: '2px solid #4a4a6a',
    borderRadius: 6,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  anchorImg: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    imageRendering: 'pixelated' as const,
  },
  anchorPlaceholder: {
    width: 160,
    height: 160,
    background: '#0e0e1a',
    border: '2px dashed #333',
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#555',
    textAlign: 'center',
    padding: 12,
  },
  /* Grid header */
  gridHeader: {
    display: 'grid',
    gridTemplateColumns: '40px 1fr 1fr 1fr 1fr',
    gap: 8,
    alignItems: 'center',
  },
  colLabel: {
    textAlign: 'center',
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: 600,
    color: '#888',
  },
  /* Direction rows */
  row: {
    display: 'grid',
    gridTemplateColumns: '40px 1fr 1fr 1fr 1fr',
    gap: 8,
    alignItems: 'center',
  },
  dirLabel: {
    width: 40,
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: 600,
    color: '#aaa',
    textAlign: 'right',
    flexShrink: 0,
  },
  poseWrap: {
    aspectRatio: '1',
    background: '#0a0a14',
    border: '1px solid #2a2a3a',
    borderRadius: 4,
    overflow: 'hidden',
    cursor: 'pointer',
  },
  cell: {
    aspectRatio: '1',
    minWidth: 0,
    background: '#0e0e1a',
    border: '1px solid #2a2a3a',
    borderRadius: 4,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    position: 'relative',
  },
  cellImg: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    imageRendering: 'pixelated' as const,
  },
  cellPlaceholder: {
    fontFamily: 'monospace',
    fontSize: 14,
    color: '#333',
  },
  spinner: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#8a4af8',
    animation: 'pulse 1s infinite',
  },
  /* Mirror */
  mirrorRow: {
    display: 'grid',
    gridTemplateColumns: '40px 1fr 1fr 1fr 1fr',
    gap: 8,
    alignItems: 'center',
  },
  mirrorSpacer: {},
  mirrorBtnGroup: {
    display: 'flex',
    justifyContent: 'center',
    gap: 4,
  },
  mirrorBtn: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5a',
    borderRadius: 3,
    color: '#8a8aaa',
    fontFamily: 'monospace',
    fontSize: 8,
    padding: '2px 8px',
    cursor: 'pointer',
    fontWeight: 600,
  },
};
