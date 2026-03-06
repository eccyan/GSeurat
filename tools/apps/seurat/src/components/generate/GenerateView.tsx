import React, { useState } from 'react';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { SAMPLER_NAMES } from '../../lib/ai-generate.js';
import { buildComfyParams } from '../../lib/ai-generate.js';

type GenerateScope = 'single' | 'row' | 'all_pending';

export function GenerateView() {
  const manifest = useSeuratStore((s) => s.manifest);
  const aiConfig = useSeuratStore((s) => s.aiConfig);
  const setAIConfig = useSeuratStore((s) => s.setAIConfig);
  const generationJobs = useSeuratStore((s) => s.generationJobs);
  const clearCompletedJobs = useSeuratStore((s) => s.clearCompletedJobs);
  const [scope, setScope] = useState<GenerateScope>('row');
  const [selectedAnim, setSelectedAnim] = useState<string>('');
  const [selectedFrame, setSelectedFrame] = useState(0);

  if (!manifest) {
    return (
      <div style={{ padding: 24, color: '#555', fontFamily: 'monospace', fontSize: 12 }}>
        Select a character from the Dashboard.
      </div>
    );
  }

  const effectiveAnim = selectedAnim || manifest.animations[0]?.name || '';

  const handleGenerate = () => {
    const anim = manifest.animations.find((a) => a.name === effectiveAnim);
    if (!anim) return;

    if (scope === 'single') {
      const params = buildComfyParams(manifest, anim, selectedFrame, aiConfig);
      console.log('[Generate] Single frame:', params);
    } else if (scope === 'row') {
      for (let i = 0; i < anim.frames.length; i++) {
        const params = buildComfyParams(manifest, anim, i, aiConfig);
        console.log(`[Generate] Row frame ${i}:`, params);
      }
    } else {
      for (const a of manifest.animations) {
        for (const f of a.frames) {
          if (f.status === 'pending') {
            const params = buildComfyParams(manifest, a, f.index, aiConfig);
            console.log(`[Generate] Pending ${a.name}/${f.index}:`, params);
          }
        }
      }
    }
  };

  const pendingCount = manifest.animations.reduce(
    (s, a) => s + a.frames.filter((f) => f.status === 'pending').length,
    0,
  );

  return (
    <div style={styles.container}>
      <div style={styles.title}>AI Generation</div>

      {/* AI Config */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>ComfyUI Settings</div>
        <div style={styles.row}>
          <label style={styles.label}>URL</label>
          <input
            value={aiConfig.comfyUrl}
            onChange={(e) => setAIConfig({ comfyUrl: e.target.value })}
            style={styles.input}
          />
        </div>
        <div style={styles.row}>
          <label style={styles.label}>Steps</label>
          <input
            type="number"
            value={aiConfig.steps}
            onChange={(e) => setAIConfig({ steps: parseInt(e.target.value) || 20 })}
            style={{ ...styles.input, width: 60 }}
          />
          <label style={styles.label}>CFG</label>
          <input
            type="number"
            value={aiConfig.cfg}
            onChange={(e) => setAIConfig({ cfg: parseFloat(e.target.value) || 7 })}
            style={{ ...styles.input, width: 60 }}
            step={0.5}
          />
        </div>
        <div style={styles.row}>
          <label style={styles.label}>Seed</label>
          <input
            type="number"
            value={aiConfig.seed}
            onChange={(e) => setAIConfig({ seed: parseInt(e.target.value) })}
            style={{ ...styles.input, width: 100 }}
          />
          <span style={{ fontSize: 9, color: '#555', fontFamily: 'monospace' }}>-1 = random</span>
        </div>
        <div style={styles.row}>
          <label style={styles.label}>Sampler</label>
          <select
            value={aiConfig.sampler}
            onChange={(e) => setAIConfig({ sampler: e.target.value })}
            style={styles.select}
          >
            {SAMPLER_NAMES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Scope */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Generation Scope</div>
        <div style={styles.row}>
          {(['single', 'row', 'all_pending'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              style={{
                ...styles.scopeBtn,
                background: scope === s ? '#1e2a42' : 'transparent',
                borderColor: scope === s ? '#4a8af8' : '#333',
                color: scope === s ? '#90b8f8' : '#666',
              }}
            >
              {s === 'single' ? 'Single Frame' : s === 'row' ? 'Entire Row' : `All Pending (${pendingCount})`}
            </button>
          ))}
        </div>

        {scope !== 'all_pending' && (
          <div style={styles.row}>
            <label style={styles.label}>Animation</label>
            <select
              value={effectiveAnim}
              onChange={(e) => setSelectedAnim(e.target.value)}
              style={styles.select}
            >
              {manifest.animations.map((a) => (
                <option key={a.name} value={a.name}>{a.name}</option>
              ))}
            </select>
          </div>
        )}

        {scope === 'single' && (
          <div style={styles.row}>
            <label style={styles.label}>Frame</label>
            <input
              type="number"
              min={0}
              max={(manifest.animations.find((a) => a.name === effectiveAnim)?.frames.length ?? 1) - 1}
              value={selectedFrame}
              onChange={(e) => setSelectedFrame(parseInt(e.target.value) || 0)}
              style={{ ...styles.input, width: 60 }}
            />
          </div>
        )}

        <button onClick={handleGenerate} style={styles.generateBtn}>
          Generate
        </button>
      </div>

      {/* Job Queue */}
      {generationJobs.length > 0 && (
        <div style={styles.section}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={styles.sectionTitle}>Job Queue</div>
            <button onClick={clearCompletedJobs} style={styles.clearBtn}>Clear Done</button>
          </div>
          {generationJobs.map((job) => (
            <div key={job.id} style={styles.jobRow}>
              <span style={{ color: job.status === 'error' ? '#d88' : job.status === 'done' ? '#8d8' : '#aa8' }}>
                [{job.status}]
              </span>
              <span>{job.animName}/f{job.frameIndex}</span>
              {job.error && <span style={{ color: '#d88', fontSize: 9 }}>{job.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 24,
    maxWidth: 560,
    height: '100%',
    overflowY: 'auto',
  },
  title: {
    fontFamily: 'monospace',
    fontSize: 16,
    fontWeight: 700,
    color: '#ccc',
    marginBottom: 16,
  },
  section: {
    background: '#131324',
    border: '1px solid #2a2a3a',
    borderRadius: 6,
    padding: 12,
    marginBottom: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  sectionTitle: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#888',
    fontWeight: 600,
    marginBottom: 4,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  label: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#666',
    minWidth: 50,
  },
  input: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5a',
    borderRadius: 3,
    color: '#ddd',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '4px 8px',
    outline: 'none',
    flex: 1,
  },
  select: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5a',
    borderRadius: 3,
    color: '#ddd',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '4px 8px',
    outline: 'none',
  },
  scopeBtn: {
    border: '1px solid',
    borderRadius: 3,
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '4px 10px',
    cursor: 'pointer',
    background: 'transparent',
  },
  generateBtn: {
    background: '#1e3a6e',
    border: '1px solid #4a8af8',
    borderRadius: 4,
    color: '#90b8f8',
    fontFamily: 'monospace',
    fontSize: 12,
    padding: '8px 24px',
    cursor: 'pointer',
    fontWeight: 600,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  clearBtn: {
    background: '#2a2a3a',
    border: '1px solid #444',
    borderRadius: 3,
    color: '#888',
    fontFamily: 'monospace',
    fontSize: 9,
    padding: '2px 8px',
    cursor: 'pointer',
  },
  jobRow: {
    display: 'flex',
    gap: 8,
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#aaa',
    padding: '2px 0',
  },
};
