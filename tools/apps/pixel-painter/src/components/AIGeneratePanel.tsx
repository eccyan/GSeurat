import React, { useState, useCallback, useRef } from 'react';
import { ComfyUIClient } from '@vulkan-game-tools/ai-providers';
import { usePainterStore, PixelData } from '../store/usePainterStore.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GenStatus =
  | { kind: 'idle' }
  | { kind: 'generating'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

// ---------------------------------------------------------------------------
// Downscale helper: nearest-neighbor to 16x16 RGBA
// ---------------------------------------------------------------------------

async function downscaleToPixelData(pngBytes: Uint8Array): Promise<PixelData> {
  const blob = new Blob([pngBytes], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load generated image'));
      img.src = url;
    });

    const offscreen = document.createElement('canvas');
    offscreen.width = 16;
    offscreen.height = 16;
    const ctx = offscreen.getContext('2d')!;
    ctx.imageSmoothingEnabled = false; // nearest-neighbor
    ctx.drawImage(img, 0, 0, 16, 16);
    const imgData = ctx.getImageData(0, 0, 16, 16);
    return new Uint8ClampedArray(imgData.data) as PixelData;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AIGeneratePanel() {
  const { applyAIPixels, editTarget, selectedTileCol, selectedTileRow, selectedFrameCol, selectedFrameRow } = usePainterStore();

  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('blurry, ugly, deformed, low quality, watermark');
  const [comfyUrl, setComfyUrl] = useState(import.meta.env.VITE_COMFYUI_URL || 'http://localhost:8188');
  const [steps, setSteps] = useState(20);
  const [seed, setSeed] = useState(-1); // -1 = random
  const [status, setStatus] = useState<GenStatus>({ kind: 'idle' });
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [pendingPixels, setPendingPixels] = useState<PixelData | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      setStatus({ kind: 'error', message: 'Please enter a prompt.' });
      return;
    }
    if (status.kind === 'generating') {
      abortControllerRef.current?.abort();
      setStatus({ kind: 'idle' });
      return;
    }

    setStatus({ kind: 'generating', message: 'Checking ComfyUI…' });
    setPreviewDataUrl(null);
    setPendingPixels(null);

    const client = new ComfyUIClient(comfyUrl);
    const check = await client.checkAvailability().catch(() => ({
      available: false,
      error: `Cannot reach ComfyUI at ${comfyUrl}. Start it with: python main.py --listen`,
    }));
    if (!check.available) {
      setStatus({ kind: 'error', message: check.error ?? 'ComfyUI unavailable' });
      return;
    }

    const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 31) : seed;

    // Build descriptive context for tile/sprite generation
    const target = editTarget === 'tileset'
      ? `16x16 pixel art tile, tile (${selectedTileCol},${selectedTileRow})`
      : `16x16 pixel art sprite frame, row ${selectedFrameRow} frame ${selectedFrameCol}`;

    const fullPrompt = `${prompt}, ${target}, pixel art, 16x16, clean edges, game asset`;
    const fullNegative = negativePrompt
      ? `${negativePrompt}, anti-aliasing, gradient, photorealistic`
      : 'anti-aliasing, gradient, photorealistic';

    setStatus({ kind: 'generating', message: 'Submitting to ComfyUI…' });

    try {
      const pngBytes = await client.generateImage(fullPrompt, {
        width: 512,
        height: 512,
        steps,
        seed: actualSeed,
      });

      setStatus({ kind: 'generating', message: 'Downscaling to 16×16…' });

      // Show full-res preview
      const blob = new Blob([pngBytes], { type: 'image/png' });
      const previewUrl = URL.createObjectURL(blob);
      setPreviewDataUrl(previewUrl);

      // Downscale to 16x16
      const pixels = await downscaleToPixelData(pngBytes);
      setPendingPixels(pixels);

      setStatus({ kind: 'success', message: `Generated! Seed: ${actualSeed}` });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setStatus({ kind: 'idle' });
      } else {
        setStatus({ kind: 'error', message: (err as Error).message ?? String(err) });
      }
    }
  }, [prompt, negativePrompt, comfyUrl, steps, seed, status, editTarget, selectedTileCol, selectedTileRow, selectedFrameCol, selectedFrameRow]);

  const handleApply = useCallback(() => {
    if (!pendingPixels) return;
    applyAIPixels(pendingPixels);
    setStatus({ kind: 'success', message: 'Applied to canvas!' });
  }, [pendingPixels, applyAIPixels]);

  const isGenerating = status.kind === 'generating';

  const statusColors: Record<GenStatus['kind'], string> = {
    idle: '#666',
    generating: '#90c0f0',
    success: '#70d870',
    error: '#e07070',
  };

  // Prompt presets for common tile/sprite types
  const PRESETS = [
    'stone floor tile, gray, rough texture',
    'brick wall tile, red-brown, medieval',
    'water tile, blue, animated waves',
    'lava tile, glowing orange, hot molten rock',
    'torch wall sconce, warm flickering flame',
    'player character, front-facing, RPG hero',
    'fantasy NPC guard, armored, facing south',
    'treasure chest, wooden, gold trim',
  ];

  return (
    <div style={styles.wrapper}>
      {/* Header */}
      <div style={styles.header}>
        AI Generate (Stable Diffusion)
      </div>

      <div style={styles.body}>
        {/* Target info */}
        <div style={styles.targetInfo}>
          Editing:{' '}
          <span style={styles.targetValue}>
            {editTarget === 'tileset'
              ? `Tileset tile (${selectedTileCol},${selectedTileRow})`
              : `Sprite row ${selectedFrameRow} frame ${selectedFrameCol}`}
          </span>
        </div>

        {/* Prompt */}
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Prompt</div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleGenerate(); }}
            placeholder="Describe the tile or sprite…"
            rows={3}
            style={styles.textarea}
          />
          <div style={styles.hint}>Ctrl+Enter to generate</div>
        </div>

        {/* Negative prompt */}
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Negative Prompt</div>
          <textarea
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            rows={2}
            style={styles.textarea}
          />
        </div>

        {/* Presets */}
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Quick Presets</div>
          <div style={styles.presets}>
            {PRESETS.map((preset, i) => (
              <button
                key={i}
                onClick={() => setPrompt(preset)}
                style={styles.presetBtn}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#555';
                  (e.currentTarget as HTMLButtonElement).style.color = '#bbb';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#333';
                  (e.currentTarget as HTMLButtonElement).style.color = '#777';
                }}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* Steps & seed */}
        <div style={styles.row}>
          <div style={styles.fieldHalf}>
            <div style={styles.fieldLabel}>Steps</div>
            <input
              type="number"
              min={5}
              max={100}
              value={steps}
              onChange={(e) => setSteps(parseInt(e.target.value) || 20)}
              style={styles.numberInput}
            />
          </div>
          <div style={styles.fieldHalf}>
            <div style={styles.fieldLabel}>Seed (-1=rand)</div>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(parseInt(e.target.value))}
              style={styles.numberInput}
            />
          </div>
        </div>

        {/* Advanced: ComfyUI URL */}
        <div style={styles.field}>
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            style={styles.advancedToggle}
          >
            <span>{showAdvanced ? '▼' : '▶'}</span>
            Advanced
          </button>
          {showAdvanced && (
            <div style={{ marginTop: 6 }}>
              <div style={styles.fieldLabel}>ComfyUI URL</div>
              <input
                type="text"
                value={comfyUrl}
                onChange={(e) => setComfyUrl(e.target.value)}
                style={styles.textInput}
              />
            </div>
          )}
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          style={{
            ...styles.generateBtn,
            background: isGenerating ? '#3a2a1a' : '#2a3a6a',
            borderColor: isGenerating ? '#7a4a1a' : '#4a6ab8',
            color: isGenerating ? '#e0a040' : '#90b8f8',
          }}
        >
          {isGenerating ? 'Cancel' : 'Generate'}
        </button>

        {/* Status */}
        {status.kind !== 'idle' && (
          <div style={{
            ...styles.statusBox,
            borderColor: `${statusColors[status.kind]}44`,
            color: statusColors[status.kind],
          }}>
            {status.kind === 'generating' && <span style={styles.spinner}>...</span>}
            {status.kind === 'success' && <span>OK </span>}
            {status.kind === 'error' && <span>ERR </span>}
            {(status as { message?: string }).message}
          </div>
        )}

        {/* Preview */}
        {previewDataUrl && (
          <div style={styles.previewSection}>
            <div style={styles.fieldLabel}>Generated Preview</div>
            <div style={styles.previewRow}>
              {/* Full-res preview */}
              <img
                src={previewDataUrl}
                alt="Generated"
                style={styles.previewFull}
              />
              {/* 16x16 preview */}
              {pendingPixels && (
                <canvas
                  ref={(canvas) => {
                    if (!canvas || !pendingPixels) return;
                    const ctx = canvas.getContext('2d')!;
                    const imgData = new ImageData(new Uint8ClampedArray(pendingPixels), 16, 16);
                    ctx.putImageData(imgData, 0, 0);
                  }}
                  width={16}
                  height={16}
                  style={styles.previewPixel}
                  title="16x16 nearest-neighbor downscale"
                />
              )}
            </div>

            {/* Apply button */}
            {pendingPixels && (
              <button
                onClick={handleApply}
                style={styles.applyBtn}
              >
                Apply to Canvas
              </button>
            )}
          </div>
        )}

        {/* Help text */}
        <div style={styles.helpText}>
          Requires ComfyUI running locally.<br />
          Install: <span style={{ color: '#4a7ad0' }}>github.com/comfyanonymous/ComfyUI</span><br />
          Workflow: default txt2img with SD v1.5
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    background: '#1e1e2e',
    borderTop: '1px solid #333',
    overflow: 'hidden',
  },
  header: {
    padding: '8px 10px',
    background: '#16162a',
    borderBottom: '1px solid #333',
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: 700,
    color: '#aaa',
    letterSpacing: '0.04em',
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  targetInfo: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#666',
  },
  targetValue: {
    color: '#90b8f8',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  fieldLabel: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  textarea: {
    background: '#1a1a2a',
    border: '1px solid #444',
    borderRadius: 3,
    color: '#ddd',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '5px 7px',
    resize: 'vertical',
    outline: 'none',
    lineHeight: 1.5,
  },
  hint: {
    fontFamily: 'monospace',
    fontSize: 8,
    color: '#444',
  },
  textInput: {
    background: '#1a1a2a',
    border: '1px solid #444',
    borderRadius: 3,
    color: '#aaa',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '4px 7px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  numberInput: {
    background: '#1a1a2a',
    border: '1px solid #444',
    borderRadius: 3,
    color: '#ddd',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '4px 7px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  row: {
    display: 'flex',
    gap: 8,
  },
  fieldHalf: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  presets: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  presetBtn: {
    background: 'transparent',
    border: '1px solid #333',
    borderRadius: 3,
    color: '#777',
    fontFamily: 'monospace',
    fontSize: 9,
    padding: '3px 6px',
    cursor: 'pointer',
    textAlign: 'left',
    lineHeight: 1.4,
  },
  advancedToggle: {
    background: 'transparent',
    border: 'none',
    color: '#666',
    fontFamily: 'monospace',
    fontSize: 10,
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  generateBtn: {
    width: '100%',
    padding: '8px 0',
    border: '1px solid',
    borderRadius: 5,
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  statusBox: {
    padding: '6px 8px',
    background: '#1a1a2a',
    border: '1px solid',
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 1.5,
  },
  spinner: {
    marginRight: 4,
    animation: 'none',
  },
  previewSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  previewRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-end',
  },
  previewFull: {
    width: 80,
    height: 80,
    imageRendering: 'pixelated',
    border: '1px solid #444',
    borderRadius: 2,
  },
  previewPixel: {
    width: 64,
    height: 64,
    imageRendering: 'pixelated',
    border: '1px solid #4a9ef8',
    borderRadius: 2,
  },
  applyBtn: {
    background: '#1a3a1a',
    border: '1px solid #3a7a3a',
    borderRadius: 4,
    color: '#70d870',
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: 600,
    padding: '6px 0',
    cursor: 'pointer',
    width: '100%',
  },
  helpText: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#444',
    lineHeight: 1.6,
    marginTop: 4,
  },
};
