import React, { useState } from 'react';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { SAMPLER_NAMES } from '../../lib/ai-generate.js';
import type { LoraConfig } from '../../store/types.js';

type GenerateScope = 'single' | 'row' | 'sheet_row' | 'all_pending';

interface Props {
  animName?: string;
}

export function GenerateActions({ animName: preselectedAnim }: Props) {
  const manifest = useSeuratStore((s) => s.manifest);
  const aiConfig = useSeuratStore((s) => s.aiConfig);
  const setAIConfig = useSeuratStore((s) => s.setAIConfig);
  const generationJobs = useSeuratStore((s) => s.generationJobs);
  const clearCompletedJobs = useSeuratStore((s) => s.clearCompletedJobs);
  const generateFrames = useSeuratStore((s) => s.generateFrames);
  const generateSheetRow = useSeuratStore((s) => s.generateSheetRow);
  const [scope, setScope] = useState<GenerateScope>(preselectedAnim ? 'row' : 'all_pending');
  const [selectedAnim, setSelectedAnim] = useState<string>(preselectedAnim ?? '');
  const [selectedFrame, setSelectedFrame] = useState(0);
  const [generating, setGenerating] = useState(false);

  if (!manifest) return null;

  const effectiveAnim = selectedAnim || preselectedAnim || manifest.animations[0]?.name || '';
  const hasConceptImage = manifest.concept.reference_images.length > 0;

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      if (scope === 'sheet_row') {
        await generateSheetRow(effectiveAnim);
      } else {
        await generateFrames(scope, effectiveAnim, selectedFrame);
      }
    } finally {
      setGenerating(false);
    }
  };

  const pendingCount = manifest.animations.reduce(
    (s, a) => s + a.frames.filter((f) => f.status === 'pending').length,
    0,
  );

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

      {/* Mode */}
      <div style={{ fontSize: 9, color: hasConceptImage ? '#4ac8c8' : '#666', fontFamily: 'monospace', marginBottom: 4 }}>
        {hasConceptImage ? 'img2img mode' : 'txt2img mode'}
      </div>

      {/* Scope */}
      <div style={styles.section}>
        <div style={styles.subTitle}>Scope</div>
        <Row>
          {(['single', 'row', 'sheet_row', 'all_pending'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              style={{
                ...styles.scopeBtn,
                background: scope === s ? '#1e2a42' : 'transparent',
                borderColor: scope === s ? (s === 'sheet_row' ? '#c8a04a' : '#4a8af8') : '#333',
                color: scope === s ? (s === 'sheet_row' ? '#e8c060' : '#90b8f8') : '#666',
              }}
            >
              {s === 'single' ? 'Single' : s === 'row' ? 'Row' : s === 'sheet_row' ? 'Sheet' : `All (${pendingCount})`}
            </button>
          ))}
        </Row>
        {scope === 'sheet_row' && (
          <div style={{ fontSize: 8, color: '#c8a04a', fontFamily: 'monospace' }}>
            Generates all frames as one wide image, then slices into individual frames.
          </div>
        )}

        {scope !== 'all_pending' && (
          <Row>
            <label style={styles.label}>Anim</label>
            <select value={effectiveAnim} onChange={(e) => setSelectedAnim(e.target.value)} style={styles.select}>
              {manifest.animations.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </Row>
        )}
        {scope === 'single' && (
          <Row>
            <label style={styles.label}>Frame</label>
            <input
              type="number"
              min={0}
              max={(manifest.animations.find((a) => a.name === effectiveAnim)?.frames.length ?? 1) - 1}
              value={selectedFrame}
              onChange={(e) => setSelectedFrame(parseInt(e.target.value) || 0)}
              style={{ ...styles.input, width: 50 }}
            />
          </Row>
        )}

        <button
          onClick={handleGenerate}
          disabled={generating}
          style={{ ...styles.generateBtn, opacity: generating ? 0.5 : 1 }}
        >
          {generating ? 'Generating...' : 'Generate'}
        </button>
      </div>

      {/* Jobs */}
      {generationJobs.length > 0 && (
        <div style={styles.section}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={styles.subTitle}>Jobs</div>
            <button onClick={clearCompletedJobs} style={styles.clearBtn}>Clear</button>
          </div>
          {generationJobs.map((job) => (
            <div key={job.id} style={styles.jobRow}>
              <span style={{ color: job.status === 'error' ? '#d88' : job.status === 'done' ? '#8d8' : '#aa8' }}>
                [{job.status}]
              </span>
              <span>{job.animName}/f{job.frameIndex}</span>
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
  scopeBtn: {
    border: '1px solid',
    borderRadius: 3,
    fontFamily: 'monospace',
    fontSize: 9,
    padding: '3px 8px',
    cursor: 'pointer',
    background: 'transparent',
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
