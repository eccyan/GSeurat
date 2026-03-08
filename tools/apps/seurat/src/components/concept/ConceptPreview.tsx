import React, { useState, useEffect, useRef } from 'react';
import type { ViewDirection } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';

const VIEW_ORDER: { view: ViewDirection; label: string }[] = [
  { view: 'front', label: 'Front' },
  { view: 'back',  label: 'Back' },
  { view: 'right', label: 'Right' },
  { view: 'left',  label: 'Left' },
];

function ImageCell({
  url,
  alt,
  errorKey,
  imgError,
  setImgError,
}: {
  url: string | null;
  alt: string;
  errorKey: string;
  imgError: Record<string, boolean>;
  setImgError: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  return (
    <div style={styles.cell}>
      {url && !imgError[errorKey] ? (
        <img
          src={url}
          alt={alt}
          style={styles.cellImg}
          onError={() => setImgError((prev) => ({ ...prev, [errorKey]: true }))}
        />
      ) : (
        <div style={styles.cellPlaceholder}>—</div>
      )}
    </div>
  );
}

export function ConceptPreview() {
  const manifest = useSeuratStore((s) => s.manifest);
  const conceptImageUrl = useSeuratStore((s) => s.conceptImageUrl);
  const chibiImageUrl = useSeuratStore((s) => s.chibiImageUrl);
  const conceptViewUrls = useSeuratStore((s) => s.conceptViewUrls);
  const chibiViewUrls = useSeuratStore((s) => s.chibiViewUrls);
  const [imgError, setImgError] = useState<Record<string, boolean>>({});

  // Reset error state when image URLs change
  const prevUrls = useRef({ conceptImageUrl, chibiImageUrl });
  useEffect(() => {
    const prev = prevUrls.current;
    if (conceptImageUrl !== prev.conceptImageUrl || chibiImageUrl !== prev.chibiImageUrl) {
      setImgError({});
    }
    prevUrls.current = { conceptImageUrl, chibiImageUrl };
  }, [conceptImageUrl, chibiImageUrl]);

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

  return (
    <div style={styles.container}>
      {/* One row per direction */}
      {VIEW_ORDER.map(({ view, label }) => {
        const conceptUrl = conceptViewUrls[view] ?? (view === 'front' ? conceptImageUrl : null);
        const chibiUrl = chibiViewUrls[view] ?? (view === 'front' ? chibiImageUrl : null);
        const hasAny = !!conceptUrl || !!chibiUrl;

        return (
          <div key={view} style={styles.row}>
            <div style={styles.dirLabel}>{label}</div>
            <ImageCell
              url={conceptUrl}
              alt={`${label} concept`}
              errorKey={`concept_${view}`}
              imgError={imgError}
              setImgError={setImgError}
            />
            <ImageCell
              url={chibiUrl}
              alt={`${label} chibi`}
              errorKey={`chibi_${view}`}
              imgError={imgError}
              setImgError={setImgError}
            />
            {!hasAny && (
              <div style={styles.rowHint}>—</div>
            )}
          </div>
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
    width: 120,
    height: 120,
    background: '#0e0e1a',
    border: '1px solid #2a2a3a',
    borderRadius: 4,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
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
};
