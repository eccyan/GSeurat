import React, { useState, useEffect } from 'react';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { SAMPLER_NAMES } from '../../lib/ai-generate.js';

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
  const availableCheckpoints = useSeuratStore((s) => s.availableCheckpoints);
  const refreshComfyModels = useSeuratStore((s) => s.refreshComfyModels);
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
          <input type="number" value={aiConfig.steps} onChange={(e) => setAIConfig({ steps: parseInt(e.target.value) || 20 })} style={{ ...styles.input, width: 50 }} />
          <label style={styles.label}>CFG</label>
          <input type="number" value={aiConfig.cfg} onChange={(e) => setAIConfig({ cfg: parseFloat(e.target.value) || 7 })} style={{ ...styles.input, width: 50 }} step={0.5} />
        </Row>
        <Row>
          <label style={styles.label}>Seed</label>
          <input type="number" value={aiConfig.seed} onChange={(e) => setAIConfig({ seed: parseInt(e.target.value) })} style={{ ...styles.input, width: 80 }} />
          <span style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>-1=rng</span>
        </Row>
        <Row>
          <label style={styles.label}>Sampler</label>
          <select value={aiConfig.sampler} onChange={(e) => setAIConfig({ sampler: e.target.value })} style={styles.select}>
            {SAMPLER_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Row>
        {/* Denoise only used in non-IP-Adapter modes (img2img / ControlNet) */}
        {!aiConfig.useIPAdapter && (
          <Row>
            <label style={styles.label}>Denoise</label>
            <input type="range" min={0.1} max={1.0} step={0.05} value={aiConfig.denoise} onChange={(e) => setAIConfig({ denoise: parseFloat(e.target.value) })} style={{ flex: 1 }} />
            <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>{aiConfig.denoise.toFixed(2)}</span>
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
            <input
              type="number"
              value={lora.weight}
              onChange={(e) => {
                const loras = [...aiConfig.loras];
                loras[i] = { ...loras[i], weight: parseFloat(e.target.value) || 0 };
                setAIConfig({ loras });
              }}
              style={{ ...styles.input, width: 40 }}
              step={0.1}
              min={0}
              max={2}
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
        </Row>
        <Row>
          <label style={styles.label}>Preset</label>
          <select value={aiConfig.ipAdapterPreset} onChange={(e) => setAIConfig({ ipAdapterPreset: e.target.value })} style={styles.select}>
            {['LIGHT - SD1.5 only (low strength)', 'STANDARD (medium strength)', 'VIT-G (medium strength)', 'PLUS (high strength)', 'PLUS FACE (portraits)', 'FULL FACE - SD1.5 only (portraits stronger)'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
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
        </Row>
        <Row>
          <label style={styles.label}>IPA Range</label>
          <input type="range" min={0.0} max={1.0} step={0.05} value={aiConfig.ipAdapterStartAt} onChange={(e) => setAIConfig({ ipAdapterStartAt: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>{aiConfig.ipAdapterStartAt.toFixed(2)}</span>
          <span style={{ fontSize: 9, color: '#666', fontFamily: 'monospace' }}>-</span>
          <input type="range" min={0.0} max={1.0} step={0.05} value={aiConfig.ipAdapterEndAt} onChange={(e) => setAIConfig({ ipAdapterEndAt: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>{aiConfig.ipAdapterEndAt.toFixed(2)}</span>
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
        </Row>
        <Row>
          <label style={styles.label}>Chibi Den</label>
          <input type="range" min={0.2} max={0.8} step={0.05} value={aiConfig.chibiDenoise} onChange={(e) => setAIConfig({ chibiDenoise: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>{aiConfig.chibiDenoise.toFixed(2)}</span>
        </Row>
        <div style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>
          Lower = closer to posed concept, higher = more chibi style.
        </div>
      </div>

      {/* Pixel Pass */}
      <div style={styles.section}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={styles.subTitle}>Pixel Pass</div>
          <label style={{ ...styles.label, minWidth: 'auto' }}>
            <input
              type="checkbox"
              checked={aiConfig.pixelPassEnabled}
              onChange={(e) => setAIConfig({ pixelPassEnabled: e.target.checked })}
            />
            {' '}Enable
          </label>
        </div>
        {aiConfig.pixelPassEnabled && (
          <Row>
            <label style={styles.label}>Pixel Den</label>
            <input type="range" min={0.1} max={0.7} step={0.05} value={aiConfig.pixelPassDenoise} onChange={(e) => setAIConfig({ pixelPassDenoise: parseFloat(e.target.value) })} style={{ flex: 1 }} />
            <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>{aiConfig.pixelPassDenoise.toFixed(2)}</span>
          </Row>
        )}
        <div style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>
          Pass 3 applies pixel art LoRA to chibi output. Uses LoRAs from the LoRA section above.
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
        <div style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>
          Generated at 512x512 then downscaled to sprite frame size via nearest-exact.
        </div>
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
              <input type="number" value={aiConfig.animFrameCount} onChange={(e) => setAIConfig({ animFrameCount: parseInt(e.target.value) || 8 })} style={{ ...styles.input, width: 50 }} min={2} max={32} />
              <label style={styles.label}>FPS</label>
              <input type="number" value={aiConfig.animFrameRate} onChange={(e) => setAIConfig({ animFrameRate: parseInt(e.target.value) || 8 })} style={{ ...styles.input, width: 50 }} min={1} max={30} />
            </Row>
            <Row>
              <label style={styles.label}>Context</label>
              <input type="number" value={aiConfig.animContextLength} onChange={(e) => setAIConfig({ animContextLength: parseInt(e.target.value) || 16 })} style={{ ...styles.input, width: 50 }} min={4} max={32} />
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
      <div style={{ fontSize: 9, fontFamily: 'monospace', marginBottom: 4, color: !hasConceptImage ? '#666' : aiConfig.useAnimateDiff ? '#f8c860' : (hasChibiImage && aiConfig.pixelPassEnabled) ? '#90f8b8' : hasChibiImage ? '#90f8b8' : '#f890c8' }}>
        {!hasConceptImage ? 'Upload concept art first' : aiConfig.useAnimateDiff ? 'AnimateDiff mode (all frames)' : (hasChibiImage && aiConfig.pixelPassEnabled) ? 'Three-pass: Pose\u2192Chibi\u2192Pixel' : hasChibiImage ? 'Two-pass: Pose\u2192Chibi' : 'IP-Adapter + OpenPose (single pass)'}
      </div>

      {/* Generate Animation */}
      <div style={styles.section}>
        <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#888' }}>
          Animation: <span style={{ color: '#ccc' }}>{animName}</span> ({frameCount} frames)
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          style={{ ...styles.generateBtn, opacity: generating ? 0.5 : 1 }}
        >
          {generating ? 'Generating...' : 'Generate Animation'}
        </button>
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
              <span>{job.frameIndex >= 0 ? `f${job.frameIndex}` : 'all'}</span>
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
