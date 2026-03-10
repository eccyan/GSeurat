import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { ViewDirection } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { PaintEditor } from '../shared/PaintEditor.js';
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
}: {
  url: string | null;
  alt: string;
  errorKey: string;
  imgError: Record<string, boolean>;
  setImgError: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onClick: () => void;
}) {
  return (
    <div style={styles.cell} onClick={url ? onClick : undefined}>
      {url && !imgError[errorKey] ? (
        <img
          src={url}
          alt={alt}
          crossOrigin="anonymous"
          style={styles.cellImg}
          onError={() => setImgError((prev) => ({ ...prev, [errorKey]: true }))}
        />
      ) : (
        <div style={styles.cellPlaceholder}>—</div>
      )}
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
  const loadConceptViewUrls = useSeuratStore((s) => s.loadConceptViewUrls);
  const loadChibiViewUrls = useSeuratStore((s) => s.loadChibiViewUrls);
  const uploadConceptImageForView = useSeuratStore((s) => s.uploadConceptImageForView);
  const uploadChibiImageForView = useSeuratStore((s) => s.uploadChibiImageForView);
  const [imgError, setImgError] = useState<Record<string, boolean>>({});
  const [mirroring, setMirroring] = useState<string | null>(null);

  // Editor state: which image is being edited
  const [editing, setEditing] = useState<{
    url: string;
    title: string;
    type: 'concept' | 'chibi';
    view: ViewDirection;
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
      // Create a File object to reuse the existing upload-for-view store actions
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

  const handleSaveEdited = useCallback(async (pngBytes: Uint8Array) => {
    if (!manifest || !editing) return;
    const { type, view } = editing;
    if (type === 'concept') {
      await api.saveConceptImage(manifest.character_id, pngBytes, view);
      if (view === 'front') await api.saveConceptImage(manifest.character_id, pngBytes);
      loadConceptViewUrls();
    } else {
      await api.saveChibiImage(manifest.character_id, pngBytes, view);
      if (view === 'front') await api.saveChibiImage(manifest.character_id, pngBytes);
      loadChibiViewUrls();
    }
  }, [manifest, editing, loadConceptViewUrls, loadChibiViewUrls]);

  if (!manifest) {
    return (
      <div style={styles.empty}>Select a character to view concept art.</div>
    );
  }

  const hasConceptImage = manifest.concept.reference_images.length > 0;
  const hasChibiImage = !!manifest.chibi?.reference_image;

  if (!hasConceptImage && !hasChibiImage) {
    return (
      <div style={styles.empty}>No concept or chibi art yet. Generate or upload from the panel on the right.</div>
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
      {VIEW_ORDER.map(({ view, label }) => {
        const conceptUrl = conceptViewUrls[view] ?? (view === 'front' ? conceptImageUrl : null);
        const chibiUrl = chibiViewUrls[view] ?? (view === 'front' ? chibiImageUrl : null);
        const hasAny = !!conceptUrl || !!chibiUrl;

        return (
          <React.Fragment key={view}>
            <div style={styles.row}>
              <div style={styles.dirLabel}>{label}</div>
              <ImageCell
                url={conceptUrl}
                alt={`${label} concept`}
                errorKey={`concept_${view}`}
                imgError={imgError}
                setImgError={setImgError}
                onClick={() => conceptUrl && setEditing({ url: conceptUrl, title: `${label} Concept`, type: 'concept', view })}
              />
              <ImageCell
                url={chibiUrl}
                alt={`${label} chibi`}
                errorKey={`chibi_${view}`}
                imgError={imgError}
                setImgError={setImgError}
                onClick={() => chibiUrl && setEditing({ url: chibiUrl, title: `${label} Chibi`, type: 'chibi', view })}
              />
              {!hasAny && (
                <div style={styles.rowHint}>—</div>
              )}
            </div>
            {/* Mirror buttons between Right and Left rows */}
            {view === 'right' && (
              <div style={styles.mirrorRow}>
                <div style={styles.dirLabel} />
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
  },
  empty: {
    padding: 24,
    textAlign: 'center',
    color: '#555',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
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
  cell: {
    flex: 1,
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
  rowHint: {
    fontFamily: 'monospace',
    fontSize: 8,
    color: '#444',
  },
  mirrorRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  mirrorBtnGroup: {
    flex: 1,
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
