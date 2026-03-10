import React, { useState, useEffect, useRef, useCallback } from 'react';

type BrushMode = 'erase' | 'draw';

const PALETTE_COLORS = [
  '#ffffff', '#000000', '#f5deb3', '#d2b48c', '#8b7355',
  '#ff6b6b', '#4ecdc4', '#45b7d1', '#f0c040', '#888888',
];

function brushCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  mode: BrushMode,
  color: string,
): void {
  ctx.save();
  if (mode === 'erase') {
    ctx.globalCompositeOperation = 'destination-out';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = color;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function PaintEditor({
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
  const [brushMode, setBrushMode] = useState<BrushMode>('erase');
  const [brushColor, setBrushColor] = useState('#ffffff');
  const [saving, setSaving] = useState(false);

  // Undo stack (stores ImageData snapshots)
  const undoStack = useRef<ImageData[]>([]);
  const MAX_UNDO = 20;

  const pushUndo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoStack.current.push(data);
    if (undoStack.current.length > MAX_UNDO) {
      undoStack.current.shift();
    }
  }, []);

  const popUndo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const data = undoStack.current.pop();
    if (data) {
      ctx.putImageData(data, 0, 0);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        popUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [popUndo]);

  // Brush cursor
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
      undoStack.current = [];
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
      brushCircle(ctx, x0 + dx * t, y0 + dy * t, radius, brushMode, brushColor);
    }
  }, [brushMode, brushColor]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    pushUndo();
    painting.current = true;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const pos = getCanvasPos(e);
    brushCircle(ctx, pos.x, pos.y, getRadius(), brushMode, brushColor);
    lastPos.current = pos;
  }, [getCanvasPos, getRadius, pushUndo, brushMode, brushColor]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!painting.current) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const pos = getCanvasPos(e);
    const radius = getRadius();
    if (lastPos.current) {
      strokeLine(ctx, lastPos.current.x, lastPos.current.y, pos.x, pos.y, radius);
    } else {
      brushCircle(ctx, pos.x, pos.y, radius, brushMode, brushColor);
    }
    lastPos.current = pos;
  }, [getCanvasPos, getRadius, strokeLine, brushMode, brushColor]);

  const handleMouseUp = useCallback(() => {
    painting.current = false;
    lastPos.current = null;
  }, []);

  const handleFlip = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    pushUndo();
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.putImageData(imgData, 0, 0);
    // putImageData ignores transforms, so we need to draw via temp canvas
    ctx.restore();
    // Use OffscreenCanvas workaround
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    const tmpCtx = tmp.getContext('2d')!;
    tmpCtx.putImageData(imgData, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
  }, [pushUndo]);

  const handleRotate = useCallback((direction: 'cw' | 'ccw') => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    pushUndo();
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    tmp.getContext('2d')!.putImageData(imgData, 0, 0);

    const oldW = canvas.width;
    const oldH = canvas.height;
    canvas.width = oldH;
    canvas.height = oldW;
    const newCtx = canvas.getContext('2d')!;
    newCtx.clearRect(0, 0, canvas.width, canvas.height);
    if (direction === 'cw') {
      newCtx.translate(canvas.width, 0);
      newCtx.rotate(Math.PI / 2);
    } else {
      newCtx.translate(0, canvas.height);
      newCtx.rotate(-Math.PI / 2);
    }
    newCtx.drawImage(tmp, 0, 0);
  }, [pushUndo]);

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

        {/* Mode toggle */}
        <div style={styles.modeGroup}>
          <button
            onClick={() => setBrushMode('erase')}
            style={{ ...styles.modeBtn, ...(brushMode === 'erase' ? styles.modeBtnActive : {}) }}
          >
            Erase
          </button>
          <button
            onClick={() => setBrushMode('draw')}
            style={{ ...styles.modeBtn, ...(brushMode === 'draw' ? styles.modeBtnActive : {}) }}
          >
            Draw
          </button>
        </div>

        {/* Color picker (only in draw mode) */}
        {brushMode === 'draw' && (
          <div style={styles.paletteRow}>
            {PALETTE_COLORS.map((c) => (
              <div
                key={c}
                onClick={() => setBrushColor(c)}
                style={{
                  ...styles.colorSwatch,
                  backgroundColor: c,
                  outline: c === brushColor ? '2px solid #f0c040' : 'none',
                }}
              />
            ))}
            <input
              type="color"
              value={brushColor}
              onChange={(e) => setBrushColor(e.target.value)}
              style={{ width: 20, height: 20, border: 'none', padding: 0, cursor: 'pointer' }}
            />
          </div>
        )}

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

        {/* Flip & Rotate */}
        <div style={styles.modeGroup}>
          <button onClick={handleFlip} style={styles.toolBtn} title="Flip Horizontal">Flip</button>
          <button onClick={() => handleRotate('ccw')} style={styles.toolBtn} title="Rotate 90 CCW">CCW</button>
          <button onClick={() => handleRotate('cw')} style={styles.toolBtn} title="Rotate 90 CW">CW</button>
        </div>

        {/* Undo */}
        <button onClick={popUndo} style={styles.toolBtn} title="Undo (Ctrl+Z)">Undo</button>

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

const styles: Record<string, React.CSSProperties> = {
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
    flexWrap: 'wrap',
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
  modeGroup: {
    display: 'flex',
    gap: 2,
  },
  modeBtn: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5a',
    borderRadius: 3,
    color: '#888',
    fontFamily: 'monospace',
    fontSize: 9,
    padding: '3px 8px',
    cursor: 'pointer',
  },
  modeBtnActive: {
    background: '#2a3a5a',
    borderColor: '#5a8af8',
    color: '#90b8f8',
  },
  paletteRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
  },
  colorSwatch: {
    width: 16,
    height: 16,
    borderRadius: 2,
    border: '1px solid #444',
    cursor: 'pointer',
  },
  toolBtn: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5a',
    borderRadius: 3,
    color: '#888',
    fontFamily: 'monospace',
    fontSize: 9,
    padding: '3px 8px',
    cursor: 'pointer',
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
