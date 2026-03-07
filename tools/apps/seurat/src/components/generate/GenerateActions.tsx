import React, { useState } from 'react';
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
  const [generating, setGenerating] = useState(false);

  if (!manifest) return null;

  const hasConceptImage = manifest.concept.reference_images.length > 0;
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
        <Row>
          <label style={styles.label}>Denoise</label>
          <input type="range" min={0.1} max={1.0} step={0.05} value={aiConfig.denoise} onChange={(e) => setAIConfig({ denoise: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={{ fontSize: 9, color: '#888', fontFamily: 'monospace' }}>{aiConfig.denoise.toFixed(2)}</span>
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
        <Row>
          <label style={{ ...styles.label, minWidth: 'auto' }}>
            <input
              type="checkbox"
              checked={aiConfig.useIPAdapter}
              onChange={(e) => setAIConfig({ useIPAdapter: e.target.checked })}
            />
            {' '}IP-Adapter + OpenPose
          </label>
        </Row>
        {aiConfig.useIPAdapter && (
          <>
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
            <div style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>
              Uses concept art for character consistency + pose skeletons for animation control. Generates per-frame.
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
      <div style={{ fontSize: 9, fontFamily: 'monospace', marginBottom: 4, color: !hasConceptImage ? '#666' : aiConfig.useIPAdapter ? '#f890c8' : aiConfig.controlNetModel ? '#c890f8' : '#4ac8c8' }}>
        {!hasConceptImage ? 'txt2img mode' : aiConfig.useIPAdapter ? 'IP-Adapter + OpenPose mode (per-frame)' : aiConfig.controlNetModel ? 'ControlNet + img2img mode' : 'img2img mode'}
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
};
