import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { ViewDirection } from '@vulkan-game-tools/asset-types';
import { VIEW_DIRECTIONS, DIRECTION_TO_VIEW } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { DEFAULT_AI_CONFIG } from '../../store/types.js';
import { SAMPLER_NAMES, buildFramePrompt, buildNegativePrompt } from '../../lib/ai-generate.js';
import { NumericInput } from '../NumericInput.js';
import { useSelectedFrameIndices } from './FramePipelineGrid.js';
import * as api from '../../lib/bridge-api.js';

interface Props {
  animName: string;
}

export function PipelineControls({ animName }: Props) {
  const manifest = useSeuratStore((s) => s.manifest);
  const aiConfig = useSeuratStore((s) => s.aiConfig);
  const setAIConfig = useSeuratStore((s) => s.setAIConfig);
  const generatePass = useSeuratStore((s) => s.generatePass);
  const clearEditedFrames = useSeuratStore((s) => s.clearEditedFrames);
  const cancelGeneration = useSeuratStore((s) => s.cancelGeneration);
  // generationJobs now displayed in StatusBar
  // Jobs are now displayed in the StatusBar
  const availableCheckpoints = useSeuratStore((s) => s.availableCheckpoints);
  const refreshComfyModels = useSeuratStore((s) => s.refreshComfyModels);
  const conceptViewUrls = useSeuratStore((s) => s.conceptViewUrls);
  const chibiViewUrls = useSeuratStore((s) => s.chibiViewUrls);
  const animRefOverride = useSeuratStore((s) => s.animRefOverride);
  const setAnimRefOverride = useSeuratStore((s) => s.setAnimRefOverride);
  const promptOverride = useSeuratStore((s) => s.promptOverride);
  const setPromptOverride = useSeuratStore((s) => s.setPromptOverride);

  const interpolateAnimation = useSeuratStore((s) => s.interpolateAnimation);
  const revertInterpolation = useSeuratStore((s) => s.revertInterpolation);
  const interpProgress = useSeuratStore((s) => s.interpProgress);

  const detectedPoseBytes = useSeuratStore((s) => s.detectedPoseBytes);
  const derivedAnimPoses = useSeuratStore((s) => s.derivedAnimPoses);
  const derivingAnimPoses = useSeuratStore((s) => s.derivingAnimPoses);
  const deriveAnimationPoses = useSeuratStore((s) => s.deriveAnimationPoses);

  const selectedIndices = useSelectedFrameIndices();

  const availableVaes = useSeuratStore((s) => s.availableVaes);

  const [generating, setGenerating] = useState<string | null>(null);
  const [ckptSearch, setCkptSearch] = useState('');
  const [ckptOpen, setCkptOpen] = useState(false);
  const [vaeOpen, setVaeOpen] = useState(false);
  const [vaeSearch, setVaeSearch] = useState('');

  useEffect(() => {
    if (availableCheckpoints.length === 0) refreshComfyModels();
  }, []);

  if (!manifest) return null;

  const anim = manifest.animations.find((a) => a.name === animName);
  if (!anim) return null;

  const filteredCkpts = ckptSearch
    ? availableCheckpoints.filter((c) => c.toLowerCase().includes(ckptSearch.toLowerCase()))
    : availableCheckpoints;

  const filteredVaes = vaeSearch
    ? availableVaes.filter((v) => v.toLowerCase().includes(vaeSearch.toLowerCase()))
    : availableVaes;

  // Count frames at each stage (all frames are first-class)
  const totalFrames = anim.frames.length;
  const stageCounts = {
    pass1: anim.frames.filter((f) => f.pipeline_stage && ['pass1', 'pass1_edited', 'pass2', 'pass2_edited', 'pass3'].includes(f.pipeline_stage)).length,
    pass2: anim.frames.filter((f) => f.pipeline_stage && ['pass2', 'pass2_edited', 'pass3'].includes(f.pipeline_stage)).length,
    pass3: anim.frames.filter((f) => f.pipeline_stage === 'pass3').length,
  };

  const handleRunPass = async (pass: 'pass1' | 'pass2' | 'pass3') => {
    if (selectedIndices.length === 0) return;
    setGenerating(pass);
    try {
      await generatePass(pass, animName, selectedIndices);
    } finally {
      setGenerating(null);
    }
  };

  const handleRunPassSelected = async (pass: 'pass1' | 'pass2' | 'pass3', frameIndex: number) => {
    setGenerating(pass);
    try {
      await generatePass(pass, animName, [frameIndex]);
    } finally {
      setGenerating(null);
    }
  };

  const derivedForAnim = derivedAnimPoses[animName];
  const derivedPoseCount = derivedForAnim?.length ?? 0;

  return (
    <div style={styles.container} data-testid="pipeline-controls">
      {/* Reference Direction */}
      {anim && (
        <div style={styles.section}>
          <div style={styles.subTitle}>Reference Direction</div>
          {(() => {
            const autoView = DIRECTION_TO_VIEW[anim.direction];
            const selected = animRefOverride[animName] ?? autoView;
            const conceptUrl = conceptViewUrls[selected];
            const chibiUrl = chibiViewUrls[selected];
            return (
              <Row>
                {conceptUrl && (
                  <img src={conceptUrl} alt="concept" style={styles.refThumb} />
                )}
                {chibiUrl && (
                  <img src={chibiUrl} alt="chibi" style={styles.refThumb} />
                )}
                <select
                  value={animRefOverride[animName] ?? 'auto'}
                  onChange={(e) => setAnimRefOverride(animName, e.target.value === 'auto' ? null : e.target.value as ViewDirection)}
                  style={{ ...styles.select, flex: 1 }}
                >
                  <option value="auto">Auto ({autoView})</option>
                  {VIEW_DIRECTIONS.map((v) => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}
                </select>
              </Row>
            );
          })()}
        </div>
      )}

      {/* Derive Poses */}
      <div style={styles.section}>
        <div style={styles.subTitle}>Derive Poses</div>
        <div style={styles.statusText}>
          {derivedPoseCount > 0 && detectedPoseBytes
            ? `${derivedPoseCount}/${anim.frames.length} poses derived`
            : derivedPoseCount > 0
              ? `${derivedPoseCount}/${anim.frames.length} poses (re-detect skeleton to update)`
              : detectedPoseBytes
                ? 'Anchor skeleton available'
                : 'Detect skeleton in Concept tab first'}
        </div>
        <button
          onClick={deriveAnimationPoses}
          disabled={!detectedPoseBytes || derivingAnimPoses}
          style={{
            ...styles.passBtn,
            borderColor: '#44aa44',
            color: '#70d870',
            opacity: (!detectedPoseBytes || derivingAnimPoses) ? 0.5 : 1,
          }}
        >
          {derivingAnimPoses ? 'Deriving...' : derivedPoseCount > 0 ? 'Re-derive Poses' : 'Derive Poses'}
        </button>
      </div>

      {/* Prompt */}
      <div style={styles.section}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={styles.subTitle}>Prompt</div>
          {promptOverride.trim() && (
            <button onClick={() => setPromptOverride('')} style={styles.clearBtn}>Reset</button>
          )}
        </div>
        <textarea
          value={promptOverride}
          onChange={(e) => setPromptOverride(e.target.value)}
          placeholder={buildFramePrompt(manifest, anim, 0)}
          rows={3}
          style={styles.promptTextarea}
        />
        <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#555' }}>
          {promptOverride.trim() ? 'Custom prompt active' : 'Empty = auto-generated per frame'}
        </div>
      </div>

      {/* Pass 1: Pose Generation */}
      <div style={styles.section}>
        <div style={styles.subTitle}>Pass 1 — Pose Generation</div>
        <div style={styles.statusText}>{stageCounts.pass1}/{totalFrames} frames</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            data-testid="run-pass1-btn"
            onClick={() => handleRunPass('pass1')}
            disabled={!!generating || selectedIndices.length === 0}
            style={{ ...styles.passBtn, borderColor: '#4a8af8', color: '#90b8f8', opacity: (generating || selectedIndices.length === 0) ? 0.5 : 1, flex: 1 }}
          >
            {generating === 'pass1' ? 'Running...' : `Run Pass 1 (${selectedIndices.length} sel)`}
          </button>
        </div>
        <Row>
          <label style={styles.label}>CFG</label>
          <input type="range" min={1} max={10} step={0.5} value={aiConfig.pass1Cfg} onChange={(e) => setAIConfig({ pass1Cfg: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={styles.valueLabel}>{aiConfig.pass1Cfg.toFixed(1)}</span>
          <ResetBtn field="pass1Cfg" current={aiConfig.pass1Cfg} onReset={(v) => setAIConfig({ pass1Cfg: v })} />
        </Row>
        <Row>
          <label style={styles.label}>IP Weight</label>
          <input type="range" min={0.1} max={1.0} step={0.05} value={aiConfig.ipAdapterWeight} onChange={(e) => setAIConfig({ ipAdapterWeight: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={styles.valueLabel}>{aiConfig.ipAdapterWeight.toFixed(2)}</span>
          <ResetBtn field="ipAdapterWeight" current={aiConfig.ipAdapterWeight} onReset={(v) => setAIConfig({ ipAdapterWeight: v })} />
        </Row>
        <Row>
          <label style={styles.label}>Pose Str</label>
          <input type="range" min={0.1} max={1.5} step={0.05} value={aiConfig.openPoseStrength} onChange={(e) => setAIConfig({ openPoseStrength: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={styles.valueLabel}>{aiConfig.openPoseStrength.toFixed(2)}</span>
          <ResetBtn field="openPoseStrength" current={aiConfig.openPoseStrength} onReset={(v) => setAIConfig({ openPoseStrength: v })} />
        </Row>
      </div>

      {/* Pass 2: Chibi Styling */}
      <div style={styles.section}>
        <div style={styles.subTitle}>Pass 2 — Chibi Styling</div>
        <div style={styles.statusText}>{stageCounts.pass2}/{totalFrames} frames</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            data-testid="run-pass2-btn"
            onClick={() => handleRunPass('pass2')}
            disabled={!!generating || stageCounts.pass1 === 0 || selectedIndices.length === 0}
            style={{ ...styles.passBtn, borderColor: '#60c880', color: '#90f8b8', opacity: (generating || stageCounts.pass1 === 0 || selectedIndices.length === 0) ? 0.5 : 1, flex: 1 }}
          >
            {generating === 'pass2' ? 'Running...' : `Run Pass 2 (${selectedIndices.length} sel)`}
          </button>
        </div>
        <Row>
          <label style={styles.label}>CFG</label>
          <input type="range" min={1} max={20} step={0.5} value={aiConfig.pass2Cfg} onChange={(e) => setAIConfig({ pass2Cfg: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={styles.valueLabel}>{aiConfig.pass2Cfg.toFixed(1)}</span>
          <ResetBtn field="pass2Cfg" current={aiConfig.pass2Cfg} onReset={(v) => setAIConfig({ pass2Cfg: v })} />
        </Row>
        <Row>
          <label style={styles.label}>Chibi Wt</label>
          <input type="range" min={0.1} max={1.0} step={0.05} value={aiConfig.chibiWeight} onChange={(e) => setAIConfig({ chibiWeight: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={styles.valueLabel}>{aiConfig.chibiWeight.toFixed(2)}</span>
          <ResetBtn field="chibiWeight" current={aiConfig.chibiWeight} onReset={(v) => setAIConfig({ chibiWeight: v })} />
        </Row>
        <Row>
          <label style={styles.label}>Denoise</label>
          <input type="range" min={0.2} max={0.8} step={0.05} value={aiConfig.chibiDenoise} onChange={(e) => setAIConfig({ chibiDenoise: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={styles.valueLabel}>{aiConfig.chibiDenoise.toFixed(2)}</span>
          <ResetBtn field="chibiDenoise" current={aiConfig.chibiDenoise} onReset={(v) => setAIConfig({ chibiDenoise: v })} />
        </Row>
      </div>

      {/* Interpolation (optional fallback — collapsed by default) */}
      <InterpCollapsible
        animName={animName} anim={anim} totalFrames={totalFrames}
        generating={generating} stageCounts={stageCounts}
      />

      {/* Pass 3: Pixelize */}
      <div style={styles.section}>
        <div style={styles.subTitle}>Pass 3 — Pixelize</div>
        <div style={styles.statusText}>{stageCounts.pass3}/{totalFrames} frames</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            data-testid="run-pass3-btn"
            onClick={() => handleRunPass('pass3')}
            disabled={!!generating || stageCounts.pass2 === 0 || selectedIndices.length === 0}
            style={{ ...styles.passBtn, borderColor: '#70d870', color: '#70d870', opacity: (generating || stageCounts.pass2 === 0 || selectedIndices.length === 0) ? 0.5 : 1, flex: 1 }}
          >
            {generating === 'pass3' ? 'Running...' : `Run Pass 3 (${selectedIndices.length} sel)`}
          </button>
        </div>
        <Row>
          <label style={styles.label}>Pixel Size</label>
          <input type="range" min={16} max={128} step={8} value={aiConfig.pixelDownscaleSize} onChange={(e) => setAIConfig({ pixelDownscaleSize: parseInt(e.target.value) })} style={{ flex: 1 }} />
          <span style={styles.valueLabel}>{aiConfig.pixelDownscaleSize}px</span>
          <ResetBtn field="pixelDownscaleSize" current={aiConfig.pixelDownscaleSize} onReset={(v) => setAIConfig({ pixelDownscaleSize: v })} />
        </Row>
        <Row>
          <label style={styles.label}>Output</label>
          <span style={styles.valueLabel}>
            {aiConfig.pixelDownscaleSize}px → {manifest.spritesheet.frame_width}x{manifest.spritesheet.frame_height}
          </span>
        </Row>
        <Row>
          <label style={styles.label}>Downscale</label>
          <select
            value={aiConfig.downscaleMethod}
            onChange={(e) => setAIConfig({ downscaleMethod: e.target.value })}
            style={{ flex: 1, fontSize: 10, fontFamily: 'monospace' }}
          >
            <option value="nearest-exact">nearest-exact</option>
            <option value="bilinear">bilinear</option>
          </select>
          <ResetBtn field="downscaleMethod" current={aiConfig.downscaleMethod} onReset={(v) => setAIConfig({ downscaleMethod: v })} />
        </Row>
      </div>

      {/* Cancel */}
      {generating && (
        <button onClick={cancelGeneration} style={styles.cancelBtn}>
          Cancel Generation
        </button>
      )}

      {/* ComfyUI Settings */}
      <div style={styles.section}>
        <div style={styles.subTitle}>ComfyUI Settings</div>
        <Row>
          <label style={styles.label}>URL</label>
          <input value={aiConfig.comfyUrl} onChange={(e) => setAIConfig({ comfyUrl: e.target.value })} style={styles.input} />
        </Row>
        <Row>
          <label style={styles.label}>Ckpt</label>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              value={aiConfig.checkpoint}
              onChange={(e) => { setAIConfig({ checkpoint: e.target.value }); setCkptSearch(e.target.value); }}
              onFocus={() => { setCkptOpen(true); setCkptSearch(''); }}
              onBlur={() => setTimeout(() => setCkptOpen(false), 200)}
              style={{ ...styles.input, width: '100%' }}
            />
            {ckptOpen && filteredCkpts.length > 0 && (
              <div style={styles.dropdown}>
                {filteredCkpts.slice(0, 15).map((c) => (
                  <div
                    key={c}
                    style={styles.dropdownItem}
                    onMouseDown={(e) => { e.preventDefault(); setAIConfig({ checkpoint: c }); setCkptOpen(false); }}
                  >
                    {c}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Row>
        <Row>
          <label style={styles.label}>VAE</label>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              value={aiConfig.vae}
              onChange={(e) => { setAIConfig({ vae: e.target.value }); setVaeSearch(e.target.value); }}
              onFocus={() => { setVaeOpen(true); setVaeSearch(''); }}
              onBlur={() => setTimeout(() => setVaeOpen(false), 200)}
              style={{ ...styles.input, width: '100%' }}
              placeholder="(none — use built-in)"
            />
            {vaeOpen && filteredVaes.length > 0 && (
              <div style={styles.dropdown}>
                {filteredVaes.slice(0, 15).map((v) => (
                  <div
                    key={v}
                    style={styles.dropdownItem}
                    onMouseDown={(e) => { e.preventDefault(); setAIConfig({ vae: v }); setVaeOpen(false); }}
                  >
                    {v}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Row>
        <Row>
          <label style={styles.label}>Steps</label>
          <NumericInput value={aiConfig.steps} onChange={(v) => setAIConfig({ steps: v })} integer min={1} max={100} fallback={20} style={{ ...styles.input, width: 50 }} />
          <ResetBtn field="steps" current={aiConfig.steps} onReset={(v) => setAIConfig({ steps: v })} />
        </Row>
        <Row>
          <label style={styles.label}>Seed</label>
          <NumericInput value={aiConfig.seed} onChange={(v) => setAIConfig({ seed: v })} integer min={-1} fallback={-1} style={{ ...styles.input, width: 80 }} />
          <ResetBtn field="seed" current={aiConfig.seed} onReset={(v) => setAIConfig({ seed: v })} />
          <span style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>-1=rng</span>
        </Row>
        <Row>
          <label style={styles.label}>Sampler</label>
          <select value={aiConfig.sampler} onChange={(e) => setAIConfig({ sampler: e.target.value })} style={styles.select}>
            {SAMPLER_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <ResetBtn field="sampler" current={aiConfig.sampler} onReset={(v) => setAIConfig({ sampler: v })} />
        </Row>
      </div>

      {/* LoRA */}
      <div style={styles.section}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={styles.subTitle}>LoRA</div>
          <button
            onClick={() => setAIConfig({ loras: [...aiConfig.loras, { name: '', weight: 0.8 }] })}
            style={styles.clearBtn}
          >
            +
          </button>
        </div>
        {aiConfig.loras.map((lora, i) => (
          <Row key={i}>
            <input
              value={lora.name}
              onChange={(e) => {
                const loras = [...aiConfig.loras];
                loras[i] = { ...loras[i], name: e.target.value };
                setAIConfig({ loras });
              }}
              style={{ ...styles.input, flex: 1 }}
              placeholder="lora_name"
            />
            <NumericInput
              value={lora.weight}
              onChange={(v) => {
                const loras = [...aiConfig.loras];
                loras[i] = { ...loras[i], weight: v };
                setAIConfig({ loras });
              }}
              style={{ ...styles.input, width: 40 }}
              step={0.1} min={0} max={2} fallback={0}
            />
            <button
              onClick={() => setAIConfig({ loras: aiConfig.loras.filter((_, j) => j !== i) })}
              style={styles.clearBtn}
            >
              x
            </button>
          </Row>
        ))}
      </div>

      {/* Export & Actions */}
      <div style={styles.section}>
        <div style={styles.subTitle}>Export</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => exportAnimationStrip(manifest!.character_id, animName, anim)}
            disabled={!anim || anim.frames.every((f) => f.status === 'pending')}
            style={{ ...styles.passBtn, borderColor: '#4ac8c8', color: '#90d8d8', opacity: (!anim || anim.frames.every((f) => f.status === 'pending')) ? 0.5 : 1, flex: 1 }}
          >
            Export Strip
          </button>
          <button
            onClick={() => exportAnimationAPNG(manifest!.character_id, animName, anim)}
            disabled={!anim || anim.frames.every((f) => f.status === 'pending')}
            style={{ ...styles.passBtn, borderColor: '#4ac8c8', color: '#90d8d8', opacity: (!anim || anim.frames.every((f) => f.status === 'pending')) ? 0.5 : 1, flex: 1 }}
          >
            APNG
          </button>
          <button
            onClick={() => exportAnimationGIF(manifest!.character_id, animName, anim)}
            disabled={!anim || anim.frames.every((f) => f.status === 'pending')}
            style={{ ...styles.passBtn, borderColor: '#4ac8c8', color: '#90d8d8', opacity: (!anim || anim.frames.every((f) => f.status === 'pending')) ? 0.5 : 1, flex: 1 }}
          >
            GIF
          </button>
          <button
            onClick={() => exportAnimationFrames(manifest!.character_id, animName, anim)}
            disabled={!anim || anim.frames.every((f) => f.status === 'pending')}
            style={{ ...styles.passBtn, borderColor: '#4ac8c8', color: '#90d8d8', opacity: (!anim || anim.frames.every((f) => f.status === 'pending')) ? 0.5 : 1, flex: 1 }}
          >
            Frames
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <button
            onClick={() => clearEditedFrames(animName, selectedIndices.length > 0 ? selectedIndices : anim.frames.map((f) => f.index))}
            disabled={!!generating}
            style={{ ...styles.passBtn, borderColor: '#886', color: '#aa8', opacity: generating ? 0.5 : 1, flex: 1 }}
          >
            Clear Edits ({selectedIndices.length > 0 ? `${selectedIndices.length} sel` : 'all'})
          </button>
        </div>
      </div>

      {/* Background Removal */}
      <div style={styles.section}>
        <Row>
          <label style={{ ...styles.label, minWidth: 'auto' }}>
            <input
              type="checkbox"
              checked={aiConfig.removeBackground}
              onChange={(e) => setAIConfig({ removeBackground: e.target.checked })}
            />
            {' '}Remove Background
          </label>
        </Row>
        {aiConfig.removeBackground && (
          <Row>
            <label style={styles.label}>Node</label>
            <input
              value={aiConfig.remBgNodeType}
              onChange={(e) => setAIConfig({ remBgNodeType: e.target.value })}
              style={styles.input}
              placeholder="BRIA_RMBG_Zho"
            />
          </Row>
        )}
      </div>

    </div>
  );
}

/** Download a blob as a file */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Load the best available pass image for a frame */
async function loadBestImage(characterId: string, animName: string, fi: number): Promise<HTMLImageElement | null> {
  const passes = ['pass3', 'pass2_edited', 'pass2', 'pass1_edited', 'pass1'] as const;
  for (const pass of passes) {
    try {
      const url = pass === 'pass3'
        ? api.frameThumbnailUrl(characterId, animName, fi)
        : api.passImageUrl(characterId, animName, fi, pass);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject();
        img.src = url;
      });
      return img;
    } catch { /* next */ }
  }
  return null;
}

/** Export animation as a horizontal sprite strip PNG */
async function exportAnimationStrip(
  characterId: string,
  animName: string,
  anim: { frames: Array<{ index: number; status: string }> } | undefined,
) {
  if (!anim) return;
  const imgs: (HTMLImageElement | null)[] = [];
  for (const frame of anim.frames) {
    imgs.push(await loadBestImage(characterId, animName, frame.index));
  }

  const validImgs = imgs.filter(Boolean) as HTMLImageElement[];
  if (validImgs.length === 0) return;

  const fw = validImgs[0].naturalWidth;
  const fh = validImgs[0].naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = fw * anim.frames.length;
  canvas.height = fh;
  const ctx = canvas.getContext('2d')!;

  for (let i = 0; i < anim.frames.length; i++) {
    const img = imgs[i];
    if (img) ctx.drawImage(img, i * fw, 0);
  }

  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `${animName}_strip.png`);
  }, 'image/png');
}

/** Export animation as an animated GIF */
async function exportAnimationGIF(
  characterId: string,
  animName: string,
  anim: { frames: Array<{ index: number; status: string; duration: number }> } | undefined,
) {
  if (!anim) return;

  const frameData: { canvas: HTMLCanvasElement; delayCs: number }[] = [];
  for (const frame of anim.frames) {
    const img = await loadBestImage(characterId, animName, frame.index);
    if (!img) continue;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    // White background for GIF (no transparency support in animation)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    frameData.push({ canvas, delayCs: Math.max(1, Math.round(frame.duration * 100)) });
  }

  if (frameData.length === 0) return;
  const blob = encodeGIF(frameData);
  downloadBlob(blob, `${animName}.gif`);
}

/** Minimal GIF89a encoder with median-cut color quantization */
function encodeGIF(frames: { canvas: HTMLCanvasElement; delayCs: number }[]): Blob {
  const w = frames[0].canvas.width;
  const h = frames[0].canvas.height;
  const parts: number[] = [];

  // Helper to write bytes
  const w8 = (v: number) => parts.push(v & 0xff);
  const w16 = (v: number) => { parts.push(v & 0xff); parts.push((v >> 8) & 0xff); };
  const wStr = (s: string) => { for (let i = 0; i < s.length; i++) parts.push(s.charCodeAt(i)); };

  // Header
  wStr('GIF89a');

  // Logical Screen Descriptor (no global color table — each frame has local)
  w16(w); w16(h);
  w8(0x00); // no GCT
  w8(0);    // bg color
  w8(0);    // pixel aspect ratio

  // Netscape looping extension
  w8(0x21); w8(0xff); w8(11);
  wStr('NETSCAPE2.0');
  w8(3); w8(1); w16(0); // loop forever
  w8(0);

  for (const { canvas, delayCs } of frames) {
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, w, h);
    const pixels = imgData.data;

    // Quantize to 256 colors using simple popularity
    const colorCount: Map<number, number> = new Map();
    for (let i = 0; i < pixels.length; i += 4) {
      // Reduce to 5-bit per channel for grouping
      const r = pixels[i] >> 3;
      const g = pixels[i + 1] >> 3;
      const b = pixels[i + 2] >> 3;
      const key = (r << 10) | (g << 5) | b;
      colorCount.set(key, (colorCount.get(key) ?? 0) + 1);
    }

    // Take top 256 colors
    const sorted = [...colorCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256);
    const palette: number[] = [];
    const paletteMap = new Map<number, number>();
    for (let i = 0; i < sorted.length; i++) {
      const [key] = sorted[i];
      const r = ((key >> 10) & 0x1f) << 3;
      const g = ((key >> 5) & 0x1f) << 3;
      const b = (key & 0x1f) << 3;
      palette.push(r, g, b);
      paletteMap.set(key, i);
    }
    // Pad palette to 256
    while (palette.length < 768) palette.push(0);

    // Map pixels to palette indices
    const indices = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = pixels[i * 4] >> 3;
      const g = pixels[i * 4 + 1] >> 3;
      const b = pixels[i * 4 + 2] >> 3;
      const key = (r << 10) | (g << 5) | b;
      indices[i] = paletteMap.get(key) ?? 0;
    }

    // Graphic Control Extension
    w8(0x21); w8(0xf9); w8(4);
    w8(0x00); // disposal: none, no transparency
    w16(delayCs);
    w8(0);    // transparent color (unused)
    w8(0);

    // Image Descriptor with local color table
    w8(0x2c);
    w16(0); w16(0); // position
    w16(w); w16(h);
    w8(0x87); // local color table, 256 colors (2^(7+1))

    // Local Color Table
    for (let i = 0; i < 768; i++) w8(palette[i]);

    // LZW compressed image data
    const minCodeSize = 8;
    w8(minCodeSize);
    const lzwData = lzwEncode(indices, minCodeSize);
    // Write in sub-blocks (max 255 bytes each)
    let pos = 0;
    while (pos < lzwData.length) {
      const blockSize = Math.min(255, lzwData.length - pos);
      w8(blockSize);
      for (let i = 0; i < blockSize; i++) parts.push(lzwData[pos++]);
    }
    w8(0); // block terminator
  }

  // Trailer
  w8(0x3b);

  return new Blob([new Uint8Array(parts)], { type: 'image/gif' });
}

/** LZW encoder for GIF */
function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  const maxCode = 4096;

  const output: number[] = [];
  let bits = 0;
  let bitCount = 0;

  function emit(code: number) {
    bits |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      output.push(bits & 0xff);
      bits >>= 8;
      bitCount -= 8;
    }
  }

  // Initialize code table
  let table = new Map<string, number>();
  function resetTable() {
    table = new Map();
    for (let i = 0; i < clearCode; i++) table.set(String(i), i);
    nextCode = eoiCode + 1;
    codeSize = minCodeSize + 1;
  }

  emit(clearCode);
  resetTable();

  let current = String(indices[0]);

  for (let i = 1; i < indices.length; i++) {
    const next = current + ',' + indices[i];
    if (table.has(next)) {
      current = next;
    } else {
      emit(table.get(current)!);
      if (nextCode < maxCode) {
        table.set(next, nextCode++);
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        emit(clearCode);
        resetTable();
      }
      current = String(indices[i]);
    }
  }

  emit(table.get(current)!);
  emit(eoiCode);

  // Flush remaining bits
  if (bitCount > 0) output.push(bits & 0xff);

  return new Uint8Array(output);
}

/** Export animation as an animated PNG (APNG) */
async function exportAnimationAPNG(
  characterId: string,
  animName: string,
  anim: { frames: Array<{ index: number; status: string; duration: number }> } | undefined,
) {
  if (!anim) return;

  // Collect frame PNGs as blobs
  const framePngs: { blob: Blob; delayMs: number }[] = [];
  for (const frame of anim.frames) {
    const img = await loadBestImage(characterId, animName, frame.index);
    if (!img) continue;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob) framePngs.push({ blob, delayMs: Math.round(frame.duration * 1000) });
  }

  if (framePngs.length === 0) return;

  // Build APNG from individual PNG frames
  const apngBlob = await buildAPNG(framePngs);
  downloadBlob(apngBlob, `${animName}.apng`);
}

/** Build an APNG from multiple PNG frame blobs */
async function buildAPNG(frames: { blob: Blob; delayMs: number }[]): Promise<Blob> {
  // Parse each PNG into chunks
  const allFrameChunks: { chunks: Map<string, Uint8Array[]>; width: number; height: number; idatData: Uint8Array }[] = [];

  for (const { blob } of frames) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const { chunks, width, height } = parsePNGChunks(buf);
    // Combine all IDAT chunks into one
    const idats = chunks.get('IDAT') ?? [];
    const totalLen = idats.reduce((s, c) => s + c.length, 0);
    const combined = new Uint8Array(totalLen);
    let off = 0;
    for (const c of idats) { combined.set(c, off); off += c.length; }
    allFrameChunks.push({ chunks, width, height, idatData: combined });
  }

  const { width, height } = allFrameChunks[0];
  const numFrames = frames.length;

  // Build output
  const parts: Uint8Array[] = [];

  // PNG signature
  parts.push(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

  // IHDR from first frame
  const ihdr = allFrameChunks[0].chunks.get('IHDR')![0];
  parts.push(makeChunk('IHDR', ihdr));

  // acTL (animation control)
  const actl = new Uint8Array(8);
  new DataView(actl.buffer).setUint32(0, numFrames, false);
  new DataView(actl.buffer).setUint32(4, 0, false); // num_plays: 0 = infinite
  parts.push(makeChunk('acTL', actl));

  let seq = 0;

  for (let i = 0; i < numFrames; i++) {
    const { idatData } = allFrameChunks[i];
    const delayMs = frames[i].delayMs;

    // fcTL (frame control)
    const fctl = new Uint8Array(26);
    const fv = new DataView(fctl.buffer);
    fv.setUint32(0, seq++, false);   // sequence_number
    fv.setUint32(4, width, false);   // width
    fv.setUint32(8, height, false);  // height
    fv.setUint32(12, 0, false);      // x_offset
    fv.setUint32(16, 0, false);      // y_offset
    fv.setUint16(20, delayMs, false); // delay_num
    fv.setUint16(22, 1000, false);   // delay_den
    fctl[24] = 0; // dispose_op: none
    fctl[25] = 0; // blend_op: source
    parts.push(makeChunk('fcTL', fctl));

    if (i === 0) {
      // First frame uses IDAT
      parts.push(makeChunk('IDAT', idatData));
    } else {
      // Subsequent frames use fdAT (sequence_number + data)
      const fdat = new Uint8Array(4 + idatData.length);
      new DataView(fdat.buffer).setUint32(0, seq++, false);
      fdat.set(idatData, 4);
      parts.push(makeChunk('fdAT', fdat));
    }
  }

  // IEND
  parts.push(makeChunk('IEND', new Uint8Array(0)));

  return new Blob(parts as BlobPart[], { type: 'image/apng' });
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const len = data.length;
  const buf = new Uint8Array(12 + len);
  const view = new DataView(buf.buffer);
  view.setUint32(0, len, false);
  buf[4] = type.charCodeAt(0);
  buf[5] = type.charCodeAt(1);
  buf[6] = type.charCodeAt(2);
  buf[7] = type.charCodeAt(3);
  buf.set(data, 8);
  // CRC32 over type + data
  const crc = crc32(buf.subarray(4, 8 + len));
  view.setUint32(8 + len, crc, false);
  return buf;
}

function parsePNGChunks(buf: Uint8Array): { chunks: Map<string, Uint8Array[]>; width: number; height: number } {
  const chunks = new Map<string, Uint8Array[]>();
  let pos = 8; // skip signature
  let width = 0, height = 0;
  while (pos < buf.length) {
    const view = new DataView(buf.buffer, buf.byteOffset + pos);
    const len = view.getUint32(0, false);
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (!chunks.has(type)) chunks.set(type, []);
    chunks.get(type)!.push(data);
    if (type === 'IHDR') {
      const dv = new DataView(data.buffer, data.byteOffset);
      width = dv.getUint32(0, false);
      height = dv.getUint32(4, false);
    }
    pos += 12 + len; // length(4) + type(4) + data(len) + crc(4)
  }
  return { chunks, width, height };
}

/** CRC32 lookup table */
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** Export individual frames as separate PNG downloads */
async function exportAnimationFrames(
  characterId: string,
  animName: string,
  anim: { frames: Array<{ index: number; status: string }> } | undefined,
) {
  if (!anim) return;
  for (const frame of anim.frames) {
    const img = await loadBestImage(characterId, animName, frame.index);
    if (!img) continue;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    await new Promise<void>((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, `${animName}_f${frame.index}.png`);
        resolve();
      }, 'image/png');
    });
  }
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>{children}</div>;
}

/** Collapsible interpolation section (optional fallback, collapsed by default) */
function InterpCollapsible({ animName, anim, totalFrames, generating, stageCounts }: {
  animName: string;
  anim: { frames: Array<{ keyframe?: boolean; status: string }>; loop: boolean };
  totalFrames: number;
  generating: string | null;
  stageCounts: { pass2: number };
}) {
  const aiConfig = useSeuratStore((s) => s.aiConfig);
  const setAIConfig = useSeuratStore((s) => s.setAIConfig);
  const interpolateAnimation = useSeuratStore((s) => s.interpolateAnimation);
  const interpolateOddFrames = useSeuratStore((s) => s.interpolateOddFrames);
  const revertInterpolation = useSeuratStore((s) => s.revertInterpolation);
  const interpProgress = useSeuratStore((s) => s.interpProgress);
  const [open, setOpen] = useState(false);
  const [startFrame, setStartFrame] = useState(0);
  const [endFrame, setEndFrame] = useState(totalFrames - 1);

  // Update end frame when totalFrames changes
  useEffect(() => {
    setEndFrame(totalFrames - 1);
  }, [totalFrames]);

  const hasPass2 = stageCounts.pass2 > 0;
  const hasPlaceholders = anim.frames.some((f) => f.keyframe === false);
  const interpSlots = anim.frames.filter((f) => f.keyframe === false);
  const filledSlots = interpSlots.filter((f) => f.status === 'generated');
  const hasInterpolated = filledSlots.length > 0;

  return (
    <div style={styles.section}>
      <button onClick={() => setOpen(!open)} style={{ ...styles.subTitle, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}>
        <span style={{ fontSize: 10, color: '#666' }}>{open ? '▾' : '▸'}</span>
        Interpolation (optional)
      </button>
      {open && (() => {
        const inBetween = Math.max(0, endFrame - startFrame - 1);
        const canInterp = endFrame > startFrame + 1;
        return (
          <>
            <Row>
              <label style={styles.label}>Method</label>
              <select value={aiConfig.interpMethod} onChange={(e) => setAIConfig({ interpMethod: e.target.value as 'blend' | 'rife' })} style={{ ...styles.select, flex: 1 }}>
                <option value="blend">Canvas Blend</option>
                <option value="rife">RIFE (ComfyUI)</option>
              </select>
            </Row>
            <Row>
              <label style={styles.label}>Start</label>
              <input type="number" min={0} max={totalFrames - 1} value={startFrame}
                onChange={(e) => setStartFrame(Math.max(0, Math.min(Number(e.target.value), totalFrames - 1)))}
                style={{ ...styles.select, width: 50, textAlign: 'center' as const }} />
              <label style={styles.label}>End</label>
              <input type="number" min={0} max={anim.loop ? totalFrames : totalFrames - 1} value={endFrame}
                onChange={(e) => setEndFrame(Math.max(0, Math.min(Number(e.target.value), anim.loop ? totalFrames : totalFrames - 1)))}
                style={{ ...styles.select, width: 50, textAlign: 'center' as const }} />
              {endFrame >= totalFrames && <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#b080f0' }}>=f0 loop</span>}
            </Row>
            <div style={styles.statusText}>
              {canInterp
                ? `f${startFrame} → ${inBetween} in-between → f${endFrame}`
                : 'Need at least 2 frames apart'}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => interpolateAnimation(animName, startFrame, endFrame)} disabled={!canInterp || !!generating}
                style={{ ...styles.passBtn, borderColor: '#b080f0', color: '#c8a8f8', opacity: (!canInterp || generating) ? 0.5 : 1, flex: 1 }}>
                Fill {inBetween} frames (f{startFrame}→f{endFrame})
              </button>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => interpolateOddFrames(animName)} disabled={!!generating}
                style={{ ...styles.passBtn, borderColor: '#b080f0', color: '#c8a8f8', opacity: generating ? 0.5 : 1, flex: 1 }}>
                Fill Odd Frames (f1, f3, f5...)
              </button>
            </div>
            {interpProgress && <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#b080f0' }}>{interpProgress}</div>}
          </>
        );
      })()}
    </div>
  );
}

/** Tiny reset button — visible only when current value differs from default. */
function ResetBtn<K extends keyof typeof DEFAULT_AI_CONFIG>({
  field,
  current,
  onReset,
}: {
  field: K;
  current: (typeof DEFAULT_AI_CONFIG)[K];
  onReset: (value: (typeof DEFAULT_AI_CONFIG)[K]) => void;
}) {
  const def = DEFAULT_AI_CONFIG[field];
  if (current === def) return null;
  return (
    <button
      title={`Reset to default (${def})`}
      onClick={() => onReset(def)}
      style={styles.resetBtn}
    >
      ↺
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  section: {
    background: '#131324',
    border: '1px solid #2a2a3a',
    borderRadius: 6,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  subTitle: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#777',
    fontWeight: 600,
  },
  statusText: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#888',
  },
  passBtn: {
    background: '#131324',
    border: '1px solid',
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '6px 12px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  cancelBtn: {
    background: '#2a1a1a',
    border: '1px solid #553333',
    borderRadius: 4,
    color: '#d88',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '6px 10px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  label: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#666',
    minWidth: 40,
  },
  valueLabel: {
    fontSize: 9,
    color: '#888',
    fontFamily: 'monospace',
  },
  input: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5a',
    borderRadius: 3,
    color: '#ddd',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '3px 6px',
    outline: 'none',
    flex: 1,
  },
  select: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5a',
    borderRadius: 3,
    color: '#ddd',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '3px 6px',
    outline: 'none',
  },
  clearBtn: {
    background: '#2a2a3a',
    border: '1px solid #444',
    borderRadius: 3,
    color: '#888',
    fontFamily: 'monospace',
    fontSize: 8,
    padding: '1px 6px',
    cursor: 'pointer',
  },
  resetBtn: {
    background: 'transparent',
    border: '1px solid #3a3a5a',
    borderRadius: 3,
    color: '#666',
    fontSize: 10,
    padding: '0px 3px',
    cursor: 'pointer',
    lineHeight: '14px',
    flexShrink: 0,
  },
  refThumb: {
    width: 24,
    height: 24,
    objectFit: 'contain',
    imageRendering: 'pixelated' as const,
    borderRadius: 2,
    border: '1px solid #333',
  },
  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    right: 0,
    maxHeight: 200,
    overflowY: 'auto' as const,
    background: '#1a1a2e',
    border: '1px solid #4a4a6a',
    borderRadius: 3,
    zIndex: 100,
  },
  dropdownItem: {
    padding: '4px 6px',
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#ccc',
    cursor: 'pointer',
    borderBottom: '1px solid #2a2a3a',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  promptTextarea: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5a',
    borderRadius: 3,
    color: '#ddd',
    fontFamily: 'monospace',
    fontSize: 9,
    padding: '4px 6px',
    outline: 'none',
    resize: 'vertical' as const,
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  jobRow: {
    display: 'flex',
    gap: 6,
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#aaa',
    padding: '1px 0',
  },
};
