import React, { useState, useEffect, useMemo } from 'react';
import type { ViewDirection } from '@vulkan-game-tools/asset-types';
import { VIEW_DIRECTIONS, DIRECTION_TO_VIEW } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { DEFAULT_AI_CONFIG } from '../../store/types.js';
import { SAMPLER_NAMES, buildFramePrompt, buildNegativePrompt } from '../../lib/ai-generate.js';
import { NumericInput } from '../NumericInput.js';
import { useSelectedFrameIndices } from './FramePipelineGrid.js';

interface Props {
  animName: string;
}

export function PipelineControls({ animName }: Props) {
  const manifest = useSeuratStore((s) => s.manifest);
  const aiConfig = useSeuratStore((s) => s.aiConfig);
  const setAIConfig = useSeuratStore((s) => s.setAIConfig);
  const generatePass = useSeuratStore((s) => s.generatePass);
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
          <input type="range" min={1} max={5} step={0.5} value={aiConfig.pass1Cfg} onChange={(e) => setAIConfig({ pass1Cfg: parseFloat(e.target.value) })} style={{ flex: 1 }} />
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
  const revertInterpolation = useSeuratStore((s) => s.revertInterpolation);
  const interpProgress = useSeuratStore((s) => s.interpProgress);
  const [open, setOpen] = useState(false);

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
      {open && (
        <>
          <Row>
            <label style={styles.label}>Method</label>
            <select value={aiConfig.interpMethod} onChange={(e) => setAIConfig({ interpMethod: e.target.value as 'blend' | 'rife' })} style={{ ...styles.select, flex: 1 }}>
              <option value="blend">Canvas Blend</option>
              <option value="rife">RIFE (ComfyUI)</option>
            </select>
          </Row>
          <Row>
            <label style={styles.label}>Multiply</label>
            {[2, 3, 4].map((m) => (
              <button key={m} onClick={() => setAIConfig({ interpMultiplier: m })} style={{
                ...styles.clearBtn,
                background: aiConfig.interpMultiplier === m ? '#2a3a5a' : '#2a2a3a',
                color: aiConfig.interpMultiplier === m ? '#90b8f8' : '#888',
                border: aiConfig.interpMultiplier === m ? '1px solid #4a8af8' : '1px solid #444',
              }}>{m}x</button>
            ))}
          </Row>
          <div style={styles.statusText}>
            {hasPlaceholders
              ? `${anim.frames.filter((f) => f.keyframe !== false).length} keyframes + ${filledSlots.length}/${interpSlots.length} interp filled = ${totalFrames} total`
              : `${totalFrames} frames → ${totalFrames + (totalFrames - (anim.loop ? 0 : 1)) * (aiConfig.interpMultiplier - 1)} frames`
            }
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => interpolateAnimation(animName)} disabled={!hasPass2 || !!generating}
              style={{ ...styles.passBtn, borderColor: '#b080f0', color: '#c8a8f8', opacity: (!hasPass2 || generating) ? 0.5 : 1, flex: 1 }}>
              Interpolate
            </button>
            {hasInterpolated && (
              <button onClick={() => revertInterpolation(animName)} disabled={!!generating}
                style={{ ...styles.passBtn, borderColor: '#886', color: '#aa8', opacity: generating ? 0.5 : 1 }}>
                Revert
              </button>
            )}
          </div>
          {interpProgress && <div style={{ fontFamily: 'monospace', fontSize: 8, color: '#b080f0' }}>{interpProgress}</div>}
        </>
      )}
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
