import React, { useState, useEffect } from 'react';
import type { ViewDirection } from '@vulkan-game-tools/asset-types';
import { VIEW_DIRECTIONS, DIRECTION_TO_VIEW } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { SAMPLER_NAMES } from '../../lib/ai-generate.js';
import { NumericInput } from '../NumericInput.js';

interface Props {
  animName: string;
}

const PASS_STEPS = [
  { key: 'pass1' as const, label: '1 Pose', color: '#4a8af8' },
  { key: 'pass2' as const, label: '2 Chibi', color: '#60c880' },
  { key: 'pass3' as const, label: '3 Pixel', color: '#70d870' },
];

export function PipelineControls({ animName }: Props) {
  const manifest = useSeuratStore((s) => s.manifest);
  const aiConfig = useSeuratStore((s) => s.aiConfig);
  const setAIConfig = useSeuratStore((s) => s.setAIConfig);
  const generatePass = useSeuratStore((s) => s.generatePass);
  const cancelGeneration = useSeuratStore((s) => s.cancelGeneration);
  const generationJobs = useSeuratStore((s) => s.generationJobs);
  const clearCompletedJobs = useSeuratStore((s) => s.clearCompletedJobs);
  const availableCheckpoints = useSeuratStore((s) => s.availableCheckpoints);
  const refreshComfyModels = useSeuratStore((s) => s.refreshComfyModels);
  const conceptViewUrls = useSeuratStore((s) => s.conceptViewUrls);
  const chibiViewUrls = useSeuratStore((s) => s.chibiViewUrls);
  const animRefOverride = useSeuratStore((s) => s.animRefOverride);
  const setAnimRefOverride = useSeuratStore((s) => s.setAnimRefOverride);

  const [generating, setGenerating] = useState<string | null>(null);
  const [ckptSearch, setCkptSearch] = useState('');
  const [ckptOpen, setCkptOpen] = useState(false);

  useEffect(() => {
    if (availableCheckpoints.length === 0) refreshComfyModels();
  }, []);

  if (!manifest) return null;

  const anim = manifest.animations.find((a) => a.name === animName);
  if (!anim) return null;

  const filteredCkpts = ckptSearch
    ? availableCheckpoints.filter((c) => c.toLowerCase().includes(ckptSearch.toLowerCase()))
    : availableCheckpoints;

  // Count frames at each stage
  const stageCounts = {
    pass1: anim.frames.filter((f) => f.pipeline_stage && ['pass1', 'pass1_edited', 'pass2', 'pass2_edited', 'pass3'].includes(f.pipeline_stage)).length,
    pass2: anim.frames.filter((f) => f.pipeline_stage && ['pass2', 'pass2_edited', 'pass3'].includes(f.pipeline_stage)).length,
    pass3: anim.frames.filter((f) => f.pipeline_stage === 'pass3').length,
  };
  const totalFrames = anim.frames.length;

  const handleRunPass = async (pass: 'pass1' | 'pass2' | 'pass3') => {
    setGenerating(pass);
    try {
      await generatePass(pass, animName);
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

  const animJobs = generationJobs.filter((j) => j.animName === animName);

  return (
    <div style={styles.container} data-testid="pipeline-controls">
      {/* Step indicator */}
      <div style={styles.stepIndicator} data-testid="pipeline-step-indicator">
        {PASS_STEPS.map((step, i) => (
          <React.Fragment key={step.key}>
            {i > 0 && <div style={styles.stepLine} />}
            <div style={{
              ...styles.stepCircle,
              borderColor: step.color,
              background: stageCounts[step.key] > 0 ? step.color + '33' : 'transparent',
            }}>
              <span style={{ color: step.color, fontWeight: 600 }}>{step.label}</span>
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* Pass 1: Pose Generation */}
      <div style={styles.section}>
        <div style={styles.subTitle}>Pass 1 — Pose Generation</div>
        <div style={styles.statusText}>{stageCounts.pass1}/{totalFrames} frames</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            data-testid="run-pass1-btn"
            onClick={() => handleRunPass('pass1')}
            disabled={!!generating}
            style={{ ...styles.passBtn, borderColor: '#4a8af8', color: '#90b8f8', opacity: generating ? 0.5 : 1, flex: 1 }}
          >
            {generating === 'pass1' ? 'Running...' : 'Run Pass 1 (all)'}
          </button>
        </div>
        <Row>
          <label style={styles.label}>IP Weight</label>
          <input type="range" min={0.1} max={1.0} step={0.05} value={aiConfig.ipAdapterWeight} onChange={(e) => setAIConfig({ ipAdapterWeight: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={styles.valueLabel}>{aiConfig.ipAdapterWeight.toFixed(2)}</span>
        </Row>
        <Row>
          <label style={styles.label}>Pose Str</label>
          <input type="range" min={0.1} max={1.5} step={0.05} value={aiConfig.openPoseStrength} onChange={(e) => setAIConfig({ openPoseStrength: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={styles.valueLabel}>{aiConfig.openPoseStrength.toFixed(2)}</span>
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
            disabled={!!generating || stageCounts.pass1 === 0}
            style={{ ...styles.passBtn, borderColor: '#60c880', color: '#90f8b8', opacity: (generating || stageCounts.pass1 === 0) ? 0.5 : 1, flex: 1 }}
          >
            {generating === 'pass2' ? 'Running...' : 'Run Pass 2 (all)'}
          </button>
        </div>
        <Row>
          <label style={styles.label}>Chibi Wt</label>
          <input type="range" min={0.1} max={1.0} step={0.05} value={aiConfig.chibiWeight} onChange={(e) => setAIConfig({ chibiWeight: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={styles.valueLabel}>{aiConfig.chibiWeight.toFixed(2)}</span>
        </Row>
        <Row>
          <label style={styles.label}>Denoise</label>
          <input type="range" min={0.2} max={0.8} step={0.05} value={aiConfig.chibiDenoise} onChange={(e) => setAIConfig({ chibiDenoise: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={styles.valueLabel}>{aiConfig.chibiDenoise.toFixed(2)}</span>
        </Row>
      </div>

      {/* Pass 3: Pixel + Downscale */}
      <div style={styles.section}>
        <div style={styles.subTitle}>Pass 3 — Pixel + Downscale</div>
        <div style={styles.statusText}>{stageCounts.pass3}/{totalFrames} frames</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            data-testid="run-pass3-btn"
            onClick={() => handleRunPass('pass3')}
            disabled={!!generating || stageCounts.pass2 === 0}
            style={{ ...styles.passBtn, borderColor: '#70d870', color: '#70d870', opacity: (generating || stageCounts.pass2 === 0) ? 0.5 : 1, flex: 1 }}
          >
            {generating === 'pass3' ? 'Running...' : 'Run Pass 3 (all)'}
          </button>
        </div>
        <Row>
          <label style={styles.label}>Pixel Den</label>
          <input type="range" min={0.1} max={0.7} step={0.05} value={aiConfig.pixelPassDenoise} onChange={(e) => setAIConfig({ pixelPassDenoise: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={styles.valueLabel}>{aiConfig.pixelPassDenoise.toFixed(2)}</span>
        </Row>
        <Row>
          <label style={styles.label}>Output</label>
          <span style={styles.valueLabel}>
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
          <label style={styles.label}>Steps</label>
          <NumericInput value={aiConfig.steps} onChange={(v) => setAIConfig({ steps: v })} integer min={1} max={100} fallback={20} style={{ ...styles.input, width: 50 }} />
          <label style={styles.label}>CFG</label>
          <NumericInput value={aiConfig.cfg} onChange={(v) => setAIConfig({ cfg: v })} min={1} max={30} step={0.5} fallback={7} style={{ ...styles.input, width: 50 }} />
        </Row>
        <Row>
          <label style={styles.label}>Seed</label>
          <NumericInput value={aiConfig.seed} onChange={(v) => setAIConfig({ seed: v })} integer min={-1} fallback={-1} style={{ ...styles.input, width: 80 }} />
          <span style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>-1=rng</span>
        </Row>
        <Row>
          <label style={styles.label}>Sampler</label>
          <select value={aiConfig.sampler} onChange={(e) => setAIConfig({ sampler: e.target.value })} style={styles.select}>
            {SAMPLER_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
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

      {/* Jobs */}
      {animJobs.length > 0 && (
        <div style={styles.section}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={styles.subTitle}>Jobs</div>
            <button onClick={clearCompletedJobs} style={styles.clearBtn}>Clear</button>
          </div>
          {animJobs.map((job) => (
            <div key={job.id} style={styles.jobRow}>
              <span style={{ color: job.status === 'error' ? '#d88' : job.status === 'done' ? '#8d8' : '#aa8' }}>
                [{job.status}]
              </span>
              <span>{job.pass ?? ''} f{job.frameIndex}</span>
              {job.seed != null && <span style={{ color: '#888', fontSize: 8 }}>seed:{job.seed}</span>}
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
  stepIndicator: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    padding: '8px 4px',
  },
  stepCircle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px 10px',
    borderRadius: 12,
    border: '2px solid',
    fontFamily: 'monospace',
    fontSize: 9,
  },
  stepLine: {
    width: 20,
    height: 2,
    background: '#3a3a5a',
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
  jobRow: {
    display: 'flex',
    gap: 6,
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#aaa',
    padding: '1px 0',
  },
};
