import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { ViewDirection } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import * as api from '../../lib/bridge-api.js';

const VIEW_ORDER: { view: ViewDirection; label: string }[] = [
  { view: 'front', label: 'Front' },
  { view: 'back',  label: 'Back' },
  { view: 'right', label: 'Right' },
  { view: 'left',  label: 'Left' },
];

/* ── Erase a circle of pixels ── */
function eraseCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

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

/* ── Full-size painting editor ── */
function PaintEditor({
  imageUrl,
  title,
  onSave,
  onClose,
}: {
  imageUrl: string;
  title: string;
  onSave: (pngBytes: Uint8Array) => Promise<void>;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const painting = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const [brushSize, setBrushSize] = useState(20);
  const [saving, setSaving] = useState(false);

  // Generate a circular brush cursor as a data URL
  const brushCursor = React.useMemo(() => {
    const size = brushSize;
    const half = size / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${half}" cy="${half}" r="${half - 1}" fill="none" stroke="white" stroke-width="1" opacity="0.8"/><circle cx="${half}" cy="${half}" r="${half - 1}" fill="none" stroke="black" stroke-width="1" opacity="0.4" stroke-dasharray="2,2"/></svg>`;
    const encoded = btoa(svg);
    return `url('data:image/svg+xml;base64,${encoded}') ${half} ${half}, crosshair`;
  }, [brushSize]);

  // Load image into canvas
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  const getCanvasPos = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const getRadius = useCallback(() => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return (brushSize / 2) * (canvas.width / rect.width);
  }, [brushSize]);

  const strokeLine = useCallback((ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, radius: number) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(dist / (radius * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      eraseCircle(ctx, x0 + dx * t, y0 + dy * t, radius);
    }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    painting.current = true;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const pos = getCanvasPos(e);
    eraseCircle(ctx, pos.x, pos.y, getRadius());
    lastPos.current = pos;
  }, [getCanvasPos, getRadius]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!painting.current) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const pos = getCanvasPos(e);
    const radius = getRadius();
    if (lastPos.current) {
      strokeLine(ctx, lastPos.current.x, lastPos.current.y, pos.x, pos.y, radius);
    } else {
      eraseCircle(ctx, pos.x, pos.y, radius);
    }
    lastPos.current = pos;
  }, [getCanvasPos, getRadius, strokeLine]);

  const handleMouseUp = useCallback(() => {
    painting.current = false;
    lastPos.current = null;
  }, []);

  const handleSave = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await onSave(bytes);
      onClose();
    } finally {
      setSaving(false);
    }
  }, [onSave, onClose]);

  return (
    <div style={styles.editorOverlay}>
      {/* Toolbar */}
      <div style={styles.editorToolbar}>
        <span style={styles.editorTitle}>{title}</span>
        <div style={styles.brushRow}>
          <span style={styles.editorLabel}>Brush</span>
          <input
            type="range"
            min={4}
            max={80}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            style={{ width: 120, height: 12 }}
          />
          <span style={styles.editorLabel}>{brushSize}px</span>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={handleSave} disabled={saving} style={styles.editorSaveBtn}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button onClick={onClose} style={styles.editorCloseBtn}>Cancel</button>
      </div>
      {/* Canvas area */}
      <div ref={containerRef} style={styles.editorCanvasWrap}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ ...styles.editorCanvas, cursor: brushCursor }}
        />
      </div>
    </div>
  );
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
  const [imgError, setImgError] = useState<Record<string, boolean>>({});

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

  return (
    <div style={styles.container}>
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
  /* ── Paint Editor ── */
  editorOverlay: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#0a0a14',
  },
  editorToolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 12px',
    background: '#12121e',
    borderBottom: '1px solid #2a2a3a',
    flexShrink: 0,
  },
  editorTitle: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: 600,
    color: '#ccc',
  },
  editorLabel: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#888',
    whiteSpace: 'nowrap' as const,
  },
  brushRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  editorSaveBtn: {
    background: '#1e3a2e',
    border: '1px solid #44aa44',
    borderRadius: 4,
    color: '#70d870',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '4px 14px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  editorCloseBtn: {
    background: '#2a1a1a',
    border: '1px solid #553333',
    borderRadius: 4,
    color: '#d88',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '4px 14px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  editorCanvasWrap: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'auto',
    padding: 16,
    // Checkerboard pattern to show transparency
    backgroundImage:
      'linear-gradient(45deg, #1a1a2a 25%, transparent 25%), ' +
      'linear-gradient(-45deg, #1a1a2a 25%, transparent 25%), ' +
      'linear-gradient(45deg, transparent 75%, #1a1a2a 75%), ' +
      'linear-gradient(-45deg, transparent 75%, #1a1a2a 75%)',
    backgroundSize: '16px 16px',
    backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
    backgroundColor: '#0e0e1a',
  },
  editorCanvas: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
    imageRendering: 'pixelated' as const,
    cursor: 'crosshair',
  },
};
