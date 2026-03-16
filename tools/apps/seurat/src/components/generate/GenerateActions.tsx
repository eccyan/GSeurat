import React, { useState, useEffect } from 'react';
import type { ViewDirection } from '@vulkan-game-tools/asset-types';
import { VIEW_DIRECTIONS, DIRECTION_TO_VIEW } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { DEFAULT_AI_CONFIG } from '../../store/types.js';
import { SAMPLER_NAMES } from '../../lib/ai-generate.js';
import { NumericInput } from '../NumericInput.js';

interface Props {
  animName: string;
}

export function GenerateActions({ animName }: Props) {
  const manifest = useSeuratStore((s) => s.manifest);
  const aiConfig = useSeuratStore((s) => s.aiConfig);
  const setAIConfig = useSeuratStore((s) => s.setAIConfig);
  const generationJobs = useSeuratStore((s) => s.generationJobs);
  const clearCompletedJobs = useSeuratStore((s) => s.clearCompletedJobs);
  const generateFrames = useSeuratStore((s) => s.generateFrames);
  const cancelGeneration = useSeuratStore((s) => s.cancelGeneration);
  const availableCheckpoints = useSeuratStore((s) => s.availableCheckpoints);
  const refreshComfyModels = useSeuratStore((s) => s.refreshComfyModels);
  const chibiViewUrls = useSeuratStore((s) => s.chibiViewUrls);
  const animRefOverride = useSeuratStore((s) => s.animRefOverride);
  const setAnimRefOverride = useSeuratStore((s) => s.setAnimRefOverride);
  const conceptViewUrls = useSeuratStore((s) => s.conceptViewUrls);
  const [generating, setGenerating] = useState(false);
  const [ckptSearch, setCkptSearch] = useState('');
  const [ckptOpen, setCkptOpen] = useState(false);

  useEffect(() => {
    if (availableCheckpoints.length === 0) refreshComfyModels();
  }, []);

  if (!manifest) return null;

  const filteredCkpts = ckptSearch
    ? availableCheckpoints.filter((c) => c.toLowerCase().includes(ckptSearch.toLowerCase()))
    : availableCheckpoints;

  const hasConceptImage = manifest.concept.reference_images.length > 0;
  const hasChibiImage = !!manifest.chibi?.reference_image;
  const anim = manifest.animations.find((a) => a.name === animName);
  const frameCount = anim?.frames.length ?? 0;

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateFrames('row', animName);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.sectionTitle}>Generation</div>

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
              placeholder="v1-5-pruned-emaonly.safetensors"
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
                {filteredCkpts.length > 15 && (
                  <div style={{ ...styles.dropdownItem, color: '#555' }}>...{filteredCkpts.length - 15} more</div>
                )}
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
        {/* Denoise only used in non-IP-Adapter modes (img2img / ControlNet) */}
        {!aiConfig.useIPAdapter && (
          <Row>
            <label style={styles.label}>Denoise</label>
            <input type="range" min={0.1} max={1.0} step={0.05} value={aiConfig.denoise} onChange={(e) => setAIConfig({ denoise: parseFloat(e.target.value) })} style={{ flex: 1 }} />
            <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>{aiConfig.denoise.toFixed(2)}</span>
            <ResetBtn field="denoise" current={aiConfig.denoise} onReset={(v) => setAIConfig({ denoise: v })} />
          </Row>
        )}
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
              step={0.1}
              min={0}
              max={2}
              fallback={0}
            />
            <button
              onClick={() => {
                const loras = aiConfig.loras.filter((_, j) => j !== i);
                setAIConfig({ loras });
              }}
              style={styles.clearBtn}
            >
              x
            </button>
          </Row>
        ))}
      </div>

      {/* ControlNet */}
      <div style={styles.section}>
        <div style={styles.subTitle}>ControlNet</div>
        <Row>
          <label style={styles.label}>Model</label>
          <input
            value={aiConfig.controlNetModel}
            onChange={(e) => setAIConfig({ controlNetModel: e.target.value })}
            style={styles.input}
            placeholder="control_v11f1e_sd15_tile"
          />
        </Row>
        <Row>
          <label style={styles.label}>Strength</label>
          <input type="range" min={0} max={1.5} step={0.05} value={aiConfig.controlStrength} onChange={(e) => setAIConfig({ controlStrength: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>{aiConfig.controlStrength.toFixed(2)}</span>
          <ResetBtn field="controlStrength" current={aiConfig.controlStrength} onReset={(v) => setAIConfig({ controlStrength: v })} />
        </Row>
        <div style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>
          Tiles concept art and uses ControlNet to keep character consistent across frames. Clear model name to disable.
        </div>
      </div>

      {/* IP-Adapter + OpenPose */}
      <div style={styles.section}>
        <div style={styles.subTitle}>IP-Adapter + OpenPose</div>
        <Row>
          <label style={styles.label}>IP Weight</label>
          <input type="range" min={0.1} max={1.0} step={0.05} value={aiConfig.ipAdapterWeight} onChange={(e) => setAIConfig({ ipAdapterWeight: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>{aiConfig.ipAdapterWeight.toFixed(2)}</span>
          <ResetBtn field="ipAdapterWeight" current={aiConfig.ipAdapterWeight} onReset={(v) => setAIConfig({ ipAdapterWeight: v })} />
        </Row>
        <Row>
          <label style={styles.label}>Preset</label>
          <select value={aiConfig.ipAdapterPreset} onChange={(e) => setAIConfig({ ipAdapterPreset: e.target.value })} style={styles.select}>
            {['LIGHT - SD1.5 only (low strength)', 'STANDARD (medium strength)', 'VIT-G (medium strength)', 'PLUS (high strength)', 'PLUS FACE (portraits)', 'FULL FACE - SD1.5 only (portraits stronger)'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <ResetBtn field="ipAdapterPreset" current={aiConfig.ipAdapterPreset} onReset={(v) => setAIConfig({ ipAdapterPreset: v })} />
        </Row>
        <Row>
          <label style={styles.label}>Pose Model</label>
          <input
            value={aiConfig.openPoseModel}
            onChange={(e) => setAIConfig({ openPoseModel: e.target.value })}
            style={styles.input}
            placeholder="control_v11p_sd15_openpose"
          />
        </Row>
        <Row>
          <label style={styles.label}>Pose Str</label>
          <input type="range" min={0.1} max={1.5} step={0.05} value={aiConfig.openPoseStrength} onChange={(e) => setAIConfig({ openPoseStrength: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>{aiConfig.openPoseStrength.toFixed(2)}</span>
          <ResetBtn field="openPoseStrength" current={aiConfig.openPoseStrength} onReset={(v) => setAIConfig({ openPoseStrength: v })} />
        </Row>
        <Row>
          <label style={styles.label}>IPA Range</label>
          <input type="range" min={0.0} max={1.0} step={0.05} value={aiConfig.ipAdapterStartAt} onChange={(e) => setAIConfig({ ipAdapterStartAt: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>{aiConfig.ipAdapterStartAt.toFixed(2)}</span>
          <ResetBtn field="ipAdapterStartAt" current={aiConfig.ipAdapterStartAt} onReset={(v) => setAIConfig({ ipAdapterStartAt: v })} />
          <span style={{ fontSize: 9, color: '#666', fontFamily: 'monospace' }}>-</span>
          <input type="range" min={0.0} max={1.0} step={0.05} value={aiConfig.ipAdapterEndAt} onChange={(e) => setAIConfig({ ipAdapterEndAt: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>{aiConfig.ipAdapterEndAt.toFixed(2)}</span>
          <ResetBtn field="ipAdapterEndAt" current={aiConfig.ipAdapterEndAt} onReset={(v) => setAIConfig({ ipAdapterEndAt: v })} />
        </Row>
        <Row>
          <label style={{ ...styles.label, minWidth: 'auto' }}>
            <input
              type="checkbox"
              checked={aiConfig.consistentSeed}
              onChange={(e) => setAIConfig({ consistentSeed: e.target.checked })}
            />
            {' '}Consistent seed
          </label>
          <span style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>same seed for all frames (pose drives variation)</span>
        </Row>
        <div style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>
          IPA Range: when IP-Adapter applies during denoising (early=identity, late=details).
        </div>
      </div>

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
              <>
                <Row>
                  {conceptUrl && (
                    <img src={conceptUrl} alt="concept" style={{ width: 24, height: 24, objectFit: 'contain', imageRendering: 'pixelated' as const, borderRadius: 2, border: '1px solid #333' }} />
                  )}
                  {chibiUrl && (
                    <img src={chibiUrl} alt="chibi" style={{ width: 24, height: 24, objectFit: 'contain', imageRendering: 'pixelated' as const, borderRadius: 2, border: '1px solid #333' }} />
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
                <div style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>
                  Selects which concept + chibi direction to use as reference.
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Chibi Pass */}
      <div style={styles.section}>
        <div style={styles.subTitle}>Chibi Pass</div>
        <div style={{ fontSize: 8, color: '#555', fontFamily: 'monospace', marginBottom: 2 }}>
          Pass 2 converts posed character to chibi style using chibi reference image.
        </div>
        <Row>
          <label style={styles.label}>Chibi Wt</label>
          <input type="range" min={0.1} max={1.0} step={0.05} value={aiConfig.chibiWeight} onChange={(e) => setAIConfig({ chibiWeight: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>{aiConfig.chibiWeight.toFixed(2)}</span>
          <ResetBtn field="chibiWeight" current={aiConfig.chibiWeight} onReset={(v) => setAIConfig({ chibiWeight: v })} />
        </Row>
        <Row>
          <label style={styles.label}>Chibi Den</label>
          <input type="range" min={0.2} max={0.8} step={0.05} value={aiConfig.chibiDenoise} onChange={(e) => setAIConfig({ chibiDenoise: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>{aiConfig.chibiDenoise.toFixed(2)}</span>
          <ResetBtn field="chibiDenoise" current={aiConfig.chibiDenoise} onReset={(v) => setAIConfig({ chibiDenoise: v })} />
        </Row>
        <div style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>
          Lower = closer to posed concept, higher = more chibi style.
        </div>
      </div>

      {/* Pixelize */}
      <div style={styles.section}>
        <div style={styles.subTitle}>Pixelize</div>
        <Row>
          <label style={styles.label}>Pixel Size</label>
          <input type="range" min={16} max={128} step={8} value={aiConfig.pixelDownscaleSize} onChange={(e) => setAIConfig({ pixelDownscaleSize: parseInt(e.target.value) })} style={{ flex: 1 }} />
          <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>{aiConfig.pixelDownscaleSize}px</span>
          <ResetBtn field="pixelDownscaleSize" current={aiConfig.pixelDownscaleSize} onReset={(v) => setAIConfig({ pixelDownscaleSize: v })} />
        </Row>
        <div style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>
          Pass 3 downscales to {aiConfig.pixelDownscaleSize}px then upscales back to {manifest.spritesheet.frame_width}x{manifest.spritesheet.frame_height} for crisp pixel art.
        </div>
      </div>

      {/* Downscale */}
      <div style={styles.section}>
        <div style={styles.subTitle}>Downscale</div>
        <Row>
          <label style={styles.label}>Gen Size</label>
          <span style={{ fontSize: 9, color: '#aaa', fontFamily: 'monospace' }}>512 x 512</span>
        </Row>
        <Row>
          <label style={styles.label}>Output</label>
          <span style={{ fontSize: 9, color: '#aaa', fontFamily: 'monospace' }}>
            {manifest.spritesheet.frame_width} x {manifest.spritesheet.frame_height}
          </span>
        </Row>
        <Row>
          <label style={styles.label}>Method</label>
          <select
            value={aiConfig.downscaleMethod}
            onChange={(e) => setAIConfig({ downscaleMethod: e.target.value })}
            style={{ flex: 1, fontSize: 10, fontFamily: 'monospace' }}
          >
            <option value="nearest-exact">nearest-exact</option>
            <option value="bilinear">bilinear</option>
            <option value="area">area</option>
            <option value="bicubic">bicubic</option>
            <option value="bislerp">bislerp</option>
            <option value="lanczos">lanczos</option>
          </select>
          <ResetBtn field="downscaleMethod" current={aiConfig.downscaleMethod} onReset={(v) => setAIConfig({ downscaleMethod: v })} />
        </Row>
      </div>

      {/* AnimateDiff */}
      <div style={styles.section}>
        <Row>
          <label style={{ ...styles.label, minWidth: 'auto' }}>
            <input
              type="checkbox"
              checked={aiConfig.useAnimateDiff}
              onChange={(e) => setAIConfig({ useAnimateDiff: e.target.checked })}
            />
            {' '}AnimateDiff
          </label>
        </Row>
        {aiConfig.useAnimateDiff && (
          <>
            <Row>
              <label style={styles.label}>Motion</label>
              <input
                value={aiConfig.motionModel}
                onChange={(e) => setAIConfig({ motionModel: e.target.value })}
                style={styles.input}
                placeholder="mm_sd_v15_v2.ckpt"
              />
            </Row>
            <Row>
              <label style={styles.label}>Frames</label>
              <NumericInput value={aiConfig.animFrameCount} onChange={(v) => setAIConfig({ animFrameCount: v })} style={{ ...styles.input, width: 50 }} min={2} max={32} integer fallback={8} />
              <label style={styles.label}>FPS</label>
              <NumericInput value={aiConfig.animFrameRate} onChange={(v) => setAIConfig({ animFrameRate: v })} style={{ ...styles.input, width: 50 }} min={1} max={30} integer fallback={8} />
            </Row>
            <Row>
              <label style={styles.label}>Context</label>
              <NumericInput value={aiConfig.animContextLength} onChange={(v) => setAIConfig({ animContextLength: v })} style={{ ...styles.input, width: 50 }} min={4} max={32} integer fallback={16} />
            </Row>
            <div style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>
              Generates all frames at once via temporal motion model. Requires AnimateDiff-Evolved + VHS custom nodes and --force-fp32 on Apple Silicon.
            </div>
          </>
        )}
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
        <div style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>
          Requires ComfyUI-BRIA_AI-REMBG or comfyui-rembg custom node.
        </div>
      </div>

      {/* Mode */}
      <div style={{ fontSize: 9, fontFamily: 'monospace', marginBottom: 4, color: !hasConceptImage ? '#666' : aiConfig.useAnimateDiff ? '#f8c860' : hasChibiImage ? '#90f8b8' : '#f890c8' }}>
        {!hasConceptImage ? 'Upload concept art first' : aiConfig.useAnimateDiff ? 'AnimateDiff mode (all frames)' : hasChibiImage ? 'Three-pass: Pose\u2192Chibi\u2192Pixelize' : 'IP-Adapter + OpenPose (single pass)'}
      </div>

      {/* Generate Animation */}
      <div style={styles.section}>
        <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#888' }}>
          Animation: <span style={{ color: '#ccc' }}>{animName}</span> ({frameCount} frames)
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{ ...styles.generateBtn, opacity: generating ? 0.5 : 1, marginTop: 0, flex: 1 }}
          >
            {generating ? 'Generating...' : 'Generate Animation'}
          </button>
          <button
            onClick={cancelGeneration}
            disabled={!generating}
            style={{ ...styles.cancelBtn, opacity: generating ? 1 : 0.3 }}
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Jobs (filtered to current animation) */}
      {generationJobs.filter((j) => j.animName === animName).length > 0 && (
        <div style={styles.section}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={styles.subTitle}>Jobs</div>
            <button onClick={clearCompletedJobs} style={styles.clearBtn}>Clear</button>
          </div>
          {generationJobs.filter((j) => j.animName === animName).map((job) => (
            <div key={job.id} style={styles.jobRow}>
              <span style={{ color: job.status === 'error' ? '#d88' : job.status === 'done' ? '#8d8' : '#aa8' }}>
                [{job.status}]
              </span>
              <span>{(job.frameIndex ?? -1) >= 0 ? `f${job.frameIndex}` : 'all'}</span>
              {job.seed != null && <span style={{ color: '#888', fontSize: 8, fontFamily: 'monospace' }}>seed:{job.seed}</span>}
              {job.error && <span style={{ color: '#d88', fontSize: 8 }}>{job.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>{children}</div>;
}

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
  sectionTitle: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#aaa',
    fontWeight: 600,
    marginBottom: 4,
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
  label: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#666',
    minWidth: 40,
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
  generateBtn: {
    background: '#1e3a6e',
    border: '1px solid #4a8af8',
    borderRadius: 4,
    color: '#90b8f8',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '6px 16px',
    cursor: 'pointer',
    fontWeight: 600,
    marginTop: 4,
    alignSelf: 'flex-start',
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
  jobRow: {
    display: 'flex',
    gap: 6,
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#aaa',
    padding: '1px 0',
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
};
