import React, { useState, useCallback, useRef } from 'react';
import { ComfyUIClient } from '@vulkan-game-tools/ai-providers';
import { usePainterStore, PixelData, pixelDims } from '../store/usePainterStore.js';
import { buildFullPrompt, buildNegativePrompt, buildRowFramePrompts, downscaleToPixelData, pixelsToHeightmap, DEFAULT_NEGATIVE_PROMPT } from '../lib/ai-generate-helpers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GenStatus =
  | { kind: 'idle' }
  | { kind: 'generating'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

type GenMode = 'single' | 'row';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AIGeneratePanel() {
  const { applyAIPixels, applyRowPixels, editTarget, selectedTileCol, selectedTileRow, selectedFrameCol, selectedFrameRow, manifest, activeLayer, setHeightmapPixels, pushHistory, characterManifest } = usePainterStore();
  const { w: targetW, h: targetH } = pixelDims({ editTarget, manifest });

  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState(DEFAULT_NEGATIVE_PROMPT);
  const [comfyUrl, setComfyUrl] = useState(import.meta.env.VITE_COMFYUI_URL || 'http://localhost:8188');
  const [steps, setSteps] = useState(20);
  const [seed, setSeed] = useState(-1); // -1 = random
  const [cfgScale, setCfgScale] = useState(7);
  const [samplerName, setSamplerName] = useState('euler');
  const [status, setStatus] = useState<GenStatus>({ kind: 'idle' });
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [pendingPixels, setPendingPixels] = useState<PixelData | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loraName, setLoraName] = useState('PixelArtRedmond15V-PixelArt-PIXARFK');
  const [loraWeight, setLoraWeight] = useState(0.85);
  const [genMode, setGenMode] = useState<GenMode>('single');
  const [pendingFrames, setPendingFrames] = useState<PixelData[] | null>(null);
  const [stripPreviewUrl, setStripPreviewUrl] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Row info for row mode
  const currentRow = editTarget === 'spritesheet' ? selectedFrameRow : 0;
  const rowDef = manifest.spritesheet.rows.find((r) => r.row === currentRow);
  const canUseRowMode = editTarget === 'spritesheet' && !!rowDef;

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

    setStatus({ kind: 'generating', message: 'Checking ComfyUI...' });
    setPreviewDataUrl(null);
    setPendingPixels(null);

    const client = new ComfyUIClient(comfyUrl);
    const check = await client.checkAvailability().catch(() => ({
      available: false,
      error: `Cannot reach ComfyUI at ${comfyUrl}. Start it with: python main.py --cpu --listen`,
    }));
    if (!check.available) {
      setStatus({ kind: 'error', message: check.error ?? 'ComfyUI unavailable' });
      return;
    }

    const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 31) : seed;

    const col = editTarget === 'tileset' ? selectedTileCol : selectedFrameCol;
    const row = editTarget === 'tileset' ? selectedTileRow : selectedFrameRow;
    // Prepend concept style_prompt when a character is loaded
    const conceptPrefix = characterManifest?.concept?.style_prompt ?? '';
    const effectivePrompt = conceptPrefix ? `${conceptPrefix}, ${prompt}` : prompt;
    const fullPrompt = buildFullPrompt({ prompt: effectivePrompt, editTarget, manifest, col, row, targetW, targetH, activeLayer });
    const fullNegative = buildNegativePrompt(negativePrompt);

    setStatus({ kind: 'generating', message: 'Generating with ComfyUI...' });

    try {
      const loras = loraName.trim()
        ? [{ name: loraName.trim(), weight: loraWeight }]
        : [];

      const pngBytes = await client.generateImage(fullPrompt, {
        width: 512,
        height: 512,
        steps,
        seed: actualSeed,
        negativePrompt: fullNegative,
        cfgScale,
        samplerName,
        loras,
      });

      setStatus({ kind: 'generating', message: `Downscaling to ${targetW}x${targetH}...` });

      // Show full-res preview
      const blob = new Blob([pngBytes], { type: 'image/png' });
      const previewUrl = URL.createObjectURL(blob);
      setPreviewDataUrl(previewUrl);

      // Downscale to target dimensions
      const pixels = await downscaleToPixelData(pngBytes, targetW, targetH);
      setPendingPixels(pixels);

      setStatus({ kind: 'success', message: `Generated! Seed: ${actualSeed}` });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setStatus({ kind: 'idle' });
      } else {
        setStatus({ kind: 'error', message: (err as Error).message ?? String(err) });
      }
    }
  }, [prompt, negativePrompt, comfyUrl, steps, seed, cfgScale, samplerName, loraName, loraWeight, status, editTarget, selectedTileCol, selectedTileRow, selectedFrameCol, selectedFrameRow, targetW, targetH, manifest]);

  const handleApply = useCallback(() => {
    if (!pendingPixels) return;
    if (activeLayer === 'heightmap') {
      const hm = pixelsToHeightmap(pendingPixels, targetW, targetH);
      pushHistory();
      setHeightmapPixels(hm);
      setStatus({ kind: 'success', message: 'Applied heightmap to canvas!' });
    } else {
      applyAIPixels(pendingPixels);
      setStatus({ kind: 'success', message: 'Applied to canvas!' });
    }
  }, [pendingPixels, applyAIPixels, activeLayer, targetW, targetH, setHeightmapPixels, pushHistory]);

  const handleGenerateRow = useCallback(async () => {
    if (!prompt.trim()) {
      setStatus({ kind: 'error', message: 'Please enter a prompt.' });
      return;
    }
    if (!rowDef) {
      setStatus({ kind: 'error', message: 'No row definition found. Switch to spritesheet mode.' });
      return;
    }
    if (status.kind === 'generating') {
      abortControllerRef.current?.abort();
      setStatus({ kind: 'idle' });
      return;
    }

    setStatus({ kind: 'generating', message: 'Checking ComfyUI...' });
    setPreviewDataUrl(null);
    setPendingPixels(null);
    setPendingFrames(null);
    setStripPreviewUrl(null);

    const client = new ComfyUIClient(comfyUrl);
    const check = await client.checkAvailability().catch(() => ({
      available: false,
      error: `Cannot reach ComfyUI at ${comfyUrl}. Start it with: python main.py --cpu --listen`,
    }));
    if (!check.available) {
      setStatus({ kind: 'error', message: check.error ?? 'ComfyUI unavailable' });
      return;
    }

    const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 31) : seed;
    const frameCount = rowDef.frames;

    const framePrompts = buildRowFramePrompts({
      prompt,
      rowDef,
      frameWidth: targetW,
      frameHeight: targetH,
      activeLayer,
    });
    const fullNegative = buildNegativePrompt(negativePrompt);

    try {
      const loras = loraName.trim()
        ? [{ name: loraName.trim(), weight: loraWeight }]
        : [];

      const maxRetries = 3;
      const denoise = 0.4;
      const frames: PixelData[] = [];
      let referenceImageBytes: Uint8Array | null = null;

      for (let i = 0; i < frameCount; i++) {
        let pixels: PixelData | null = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          const isRef = i === 0 || !referenceImageBytes;
          setStatus({
            kind: 'generating',
            message: `${isRef ? 'Generating' : 'Varying'} frame ${i + 1}/${frameCount}${attempt > 0 ? ` (retry ${attempt})` : ''}...`,
          });
          try {
            let pngBytes: Uint8Array;
            const frameSeed = actualSeed + (attempt > 0 ? attempt * 1000 : 0);

            if (isRef) {
              pngBytes = await client.generateImage(framePrompts[i], {
                width: 512,
                height: 512,
                steps,
                seed: frameSeed,
                negativePrompt: fullNegative,
                cfgScale,
                samplerName,
                loras,
              });
            } else {
              pngBytes = await client.generateImg2Img(framePrompts[i], referenceImageBytes!, {
                width: 512,
                height: 512,
                steps,
                seed: frameSeed,
                negativePrompt: fullNegative,
                cfgScale,
                samplerName,
                loras,
                denoise,
              });
            }

            if (i === 0 && !referenceImageBytes) {
              referenceImageBytes = pngBytes;
            }

            const candidate = await downscaleToPixelData(pngBytes, targetW, targetH);
            let hasContent = false;
            for (let p = 0; p < candidate.length; p += 4) {
              if (candidate[p] > 0 || candidate[p + 1] > 0 || candidate[p + 2] > 0) {
                hasContent = true;
                break;
              }
            }
            if (!hasContent && attempt < maxRetries) {
              await new Promise((r) => setTimeout(r, 500));
              continue;
            }
            pixels = candidate;
            break;
          } catch (e) {
            if (attempt === maxRetries) throw e;
            await new Promise((r) => setTimeout(r, 500));
          }
        }
        frames.push(pixels!);
      }

      setPendingFrames(frames);
      setStripPreviewUrl(null);

      setStatus({ kind: 'success', message: `Generated ${frameCount} frames! Seed: ${actualSeed}` });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setStatus({ kind: 'idle' });
      } else {
        setStatus({ kind: 'error', message: (err as Error).message ?? String(err) });
      }
    }
  }, [prompt, negativePrompt, comfyUrl, steps, seed, cfgScale, samplerName, loraName, loraWeight, status, rowDef, targetW, targetH, activeLayer]);

  const handleApplyRow = useCallback(() => {
    if (!pendingFrames || !rowDef) return;
    applyRowPixels(rowDef.row, pendingFrames);
    setStatus({ kind: 'success', message: `Applied ${pendingFrames.length} frames to row ${rowDef.row}!` });
  }, [pendingFrames, rowDef, applyRowPixels]);

  const isGenerating = status.kind === 'generating';

  const statusColors: Record<GenStatus['kind'], string> = {
    idle: '#666',
    generating: '#90c0f0',
    success: '#70d870',
    error: '#e07070',
  };

  // Prompt presets for common tile/sprite types (pixel art style keywords)
  const PRESETS = [
    'stone floor tile, gray, rough texture, 16-bit, NES palette',
    'brick wall tile, red-brown, medieval, 8-bit, limited palette',
    'water tile, blue, animated waves, retro game, low-res',
    'lava tile, glowing orange, hot molten rock, 16-bit, SNES style',
    'torch wall sconce, warm flickering flame, pixel art, NES palette',
    'player character, front-facing, RPG hero, 16-bit, SNES sprite',
    'fantasy NPC guard, armored, facing south, 8-bit, retro',
    'treasure chest, wooden, gold trim, low-res, pixel art',
  ];

  return (
    <div style={styles.wrapper}>
      {/* Header */}
      <div style={styles.header}>
        AI Generate (ComfyUI)
      </div>

      <div style={styles.body}>
        {/* Target info */}
        <div style={styles.targetInfo}>
          Editing:{' '}
          <span style={styles.targetValue}>
            {editTarget === 'tileset'
              ? `Tileset tile (${selectedTileCol},${selectedTileRow})`
              : `Sprite row ${selectedFrameRow} frame ${selectedFrameCol}`}
            {activeLayer === 'heightmap' && ' (heightmap)'}
          </span>
        </div>

        {/* Mode toggle */}
        {canUseRowMode && (
          <div style={styles.modeToggle}>
            <button
              onClick={() => setGenMode('single')}
              style={{
                ...styles.modeBtn,
                ...(genMode === 'single' ? styles.modeBtnActive : {}),
              }}
            >
              Single
            </button>
            <button
              onClick={() => setGenMode('row')}
              style={{
                ...styles.modeBtn,
                ...(genMode === 'row' ? styles.modeBtnActive : {}),
              }}
            >
              Row
            </button>
          </div>
        )}

        {/* Row info */}
        {genMode === 'row' && rowDef && (
          <div style={styles.rowInfo}>
            Row {rowDef.row}: <span style={styles.targetValue}>{rowDef.label}</span>{' '}
            ({rowDef.frames} frames, {rowDef.state} {rowDef.direction})
          </div>
        )}

        {/* Prompt */}
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Prompt</div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleGenerate(); }}
            placeholder="Describe the tile or sprite..."
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

        {/* Advanced settings */}
        <div style={styles.field}>
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            style={styles.advancedToggle}
          >
            <span>{showAdvanced ? '\u25BC' : '\u25B6'}</span>
            Advanced
          </button>
          {showAdvanced && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>
                <div style={styles.fieldLabel}>ComfyUI URL</div>
                <input
                  type="text"
                  value={comfyUrl}
                  onChange={(e) => setComfyUrl(e.target.value)}
                  style={styles.textInput}
                />
              </div>
              <div>
                <div style={styles.fieldLabel}>LoRA Model (optional)</div>
                <div style={{ ...styles.row, marginTop: 3 }}>
                  <div style={{ flex: 2 }}>
                    <input
                      type="text"
                      value={loraName}
                      onChange={(e) => setLoraName(e.target.value)}
                      placeholder="e.g. PixelArtRedmond15V-PixelArt-PIXARFK"
                      style={styles.textInput}
                    />
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ ...styles.fieldLabel, fontSize: 8 }}>Weight: {loraWeight}</div>
                    <input
                      type="range"
                      min={0}
                      max={1.5}
                      step={0.05}
                      value={loraWeight}
                      onChange={(e) => setLoraWeight(parseFloat(e.target.value))}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
                <div style={{ ...styles.hint, marginTop: 2 }}>
                  Place .safetensors in ComfyUI/models/loras/
                </div>
              </div>
              <div style={styles.row}>
                <div style={styles.fieldHalf}>
                  <div style={styles.fieldLabel}>CFG Scale</div>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    step={0.5}
                    value={cfgScale}
                    onChange={(e) => setCfgScale(parseFloat(e.target.value) || 7)}
                    style={styles.numberInput}
                  />
                </div>
                <div style={styles.fieldHalf}>
                  <div style={styles.fieldLabel}>Sampler</div>
                  <select
                    value={samplerName}
                    onChange={(e) => setSamplerName(e.target.value)}
                    style={styles.selectInput}
                  >
                    <option value="euler">euler</option>
                    <option value="euler_ancestral">euler_ancestral</option>
                    <option value="dpmpp_2m">dpmpp_2m</option>
                    <option value="dpmpp_sde">dpmpp_sde</option>
                    <option value="ddim">ddim</option>
                    <option value="uni_pc">uni_pc</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Generate button */}
        <button
          onClick={genMode === 'row' && canUseRowMode ? handleGenerateRow : handleGenerate}
          style={{
            ...styles.generateBtn,
            background: isGenerating ? '#3a2a1a' : '#2a3a6a',
            borderColor: isGenerating ? '#7a4a1a' : '#4a6ab8',
            color: isGenerating ? '#e0a040' : '#90b8f8',
          }}
        >
          {isGenerating ? 'Cancel' : genMode === 'row' ? 'Generate Row' : 'Generate'}
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
                    const imgData = new ImageData(new Uint8ClampedArray(pendingPixels), targetW, targetH);
                    ctx.putImageData(imgData, 0, 0);
                  }}
                  width={targetW}
                  height={targetH}
                  style={styles.previewPixel}
                  title={`${targetW}x${targetH} nearest-neighbor downscale`}
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

        {/* Row frames preview */}
        {genMode === 'row' && pendingFrames && (
          <div style={styles.previewSection}>
            {pendingFrames && (
              <>
                <div style={styles.fieldLabel}>Generated Frames ({pendingFrames.length})</div>
                <div style={styles.frameRow}>
                  {pendingFrames.map((frame, i) => (
                    <canvas
                      key={i}
                      ref={(canvas) => {
                        if (!canvas) return;
                        const ctx = canvas.getContext('2d')!;
                        const imgData = new ImageData(new Uint8ClampedArray(frame), targetW, targetH);
                        ctx.putImageData(imgData, 0, 0);
                      }}
                      width={targetW}
                      height={targetH}
                      style={styles.frameThumb}
                      title={`Frame ${i}`}
                    />
                  ))}
                </div>
                <button
                  onClick={handleApplyRow}
                  style={styles.applyBtn}
                >
                  Apply to Row
                </button>
              </>
            )}
          </div>
        )}

        {/* Help text */}
        <div style={styles.helpText}>
          Requires ComfyUI running locally.<br />
          Model: SD 1.5 + PixelArtRedmond LoRA (weight 0.85).<br />
          Mac (MPS): python main.py --fp32-vae --listen --enable-cors-header '*'<br />
          Sampler: euler only (others produce poor results on MPS).
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
  selectInput: {
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
  modeToggle: {
    display: 'flex',
    gap: 0,
    borderRadius: 4,
    overflow: 'hidden',
    border: '1px solid #444',
  },
  modeBtn: {
    flex: 1,
    background: '#1a1a2a',
    border: 'none',
    color: '#666',
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: 600,
    padding: '5px 0',
    cursor: 'pointer',
  },
  modeBtnActive: {
    background: '#2a3a6a',
    color: '#90b8f8',
  },
  rowInfo: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#666',
  },
  stripPreview: {
    width: '100%',
    maxHeight: 60,
    imageRendering: 'pixelated' as const,
    border: '1px solid #444',
    borderRadius: 2,
    objectFit: 'contain' as const,
  },
  frameRow: {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap' as const,
  },
  frameThumb: {
    width: 48,
    height: 48,
    imageRendering: 'pixelated' as const,
    border: '1px solid #4a9ef8',
    borderRadius: 2,
  },
  helpText: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#444',
    lineHeight: 1.6,
    marginTop: 4,
  },
};
