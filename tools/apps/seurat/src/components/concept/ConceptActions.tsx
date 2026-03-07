import React, { useRef, useState, useEffect } from 'react';
import type { ConceptArt } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';

export function ConceptActions() {
  const manifest = useSeuratStore((s) => s.manifest);
  const saveConcept = useSeuratStore((s) => s.saveConcept);
  const conceptGenerating = useSeuratStore((s) => s.conceptGenerating);
  const conceptError = useSeuratStore((s) => s.conceptError);
  const generateConceptArt = useSeuratStore((s) => s.generateConceptArt);
  const uploadConceptImage = useSeuratStore((s) => s.uploadConceptImage);
  const generateFrames = useSeuratStore((s) => s.generateFrames);
  const generationJobs = useSeuratStore((s) => s.generationJobs);
  const clearCompletedJobs = useSeuratStore((s) => s.clearCompletedJobs);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [generatingAll, setGeneratingAll] = useState(false);

  const [description, setDescription] = useState('');
  const [stylePrompt, setStylePrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!manifest) return;
    setDescription(manifest.concept.description);
    setStylePrompt(manifest.concept.style_prompt);
    setNegativePrompt(manifest.concept.negative_prompt);
  }, [manifest?.character_id]);

  if (!manifest) return null;

  const pendingCount = manifest.animations.reduce(
    (s, a) => s + a.frames.filter((f) => f.status === 'pending').length,
    0,
  );

  const handleSave = async (approved?: boolean) => {
    setSaving(true);
    const concept: ConceptArt = {
      ...manifest.concept,
      description,
      style_prompt: stylePrompt,
      negative_prompt: negativePrompt,
      approved: approved ?? manifest.concept.approved,
    };
    await saveConcept(concept);
    setSaving(false);
  };

  const handleGenerate = async () => {
    const concept: ConceptArt = {
      ...manifest.concept,
      description,
      style_prompt: stylePrompt,
      negative_prompt: negativePrompt,
    };
    await saveConcept(concept);
    await generateConceptArt();
  };

  return (
    <div style={styles.container}>
      <div style={styles.sectionTitle}>Concept Art</div>

      <label style={styles.label}>Description</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        style={styles.textarea}
        placeholder="Describe the character..."
      />

      <label style={styles.label}>Style Prompt</label>
      <textarea
        value={stylePrompt}
        onChange={(e) => setStylePrompt(e.target.value)}
        rows={2}
        style={styles.textarea}
        placeholder="pixel art, 128x128..."
      />

      <label style={styles.label}>Negative Prompt</label>
      <textarea
        value={negativePrompt}
        onChange={(e) => setNegativePrompt(e.target.value)}
        rows={2}
        style={styles.textarea}
        placeholder="blurry, realistic..."
      />

      <div style={styles.actions}>
        <button onClick={() => handleSave()} disabled={saving} style={styles.saveBtn}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        {!manifest.concept.approved && (
          <button onClick={() => handleSave(true)} disabled={saving} style={styles.approveBtn}>
            Approve
          </button>
        )}
      </div>

      <div style={styles.divider} />

      <div style={styles.buttonRow}>
        <button
          onClick={handleGenerate}
          disabled={conceptGenerating || (!description && !stylePrompt)}
          style={{
            ...styles.generateBtn,
            opacity: conceptGenerating || (!description && !stylePrompt) ? 0.5 : 1,
          }}
        >
          {conceptGenerating ? 'Generating...' : 'Generate via AI'}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={conceptGenerating}
          style={styles.uploadBtn}
        >
          Upload Image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              uploadConceptImage(file);
              e.target.value = '';
            }
          }}
        />
      </div>

      {conceptGenerating && (
        <div style={styles.progressText}>
          {conceptError?.includes('retrying') ? conceptError : 'Sending to ComfyUI...'}
        </div>
      )}
      {conceptError && !conceptError.includes('retrying') && (
        <div style={styles.errorText}>{conceptError}</div>
      )}

      <div style={styles.divider} />

      {/* Generate All Animations */}
      <div style={styles.sectionTitle}>Sprite Generation</div>
      <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#888', marginBottom: 4 }}>
        Generate all pending animation frames ({pendingCount} pending across {manifest.animations.length} animations)
      </div>
      <button
        onClick={async () => {
          setGeneratingAll(true);
          try { await generateFrames('all_pending'); } finally { setGeneratingAll(false); }
        }}
        disabled={generatingAll || pendingCount === 0}
        style={{ ...styles.generateAllBtn, opacity: generatingAll || pendingCount === 0 ? 0.5 : 1 }}
      >
        {generatingAll ? 'Generating...' : `Generate All Animations (${pendingCount})`}
      </button>

      {/* Jobs */}
      {generationJobs.length > 0 && (
        <div style={styles.jobsSection}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#777', fontWeight: 600 }}>Jobs</span>
            <button onClick={clearCompletedJobs} style={styles.clearJobsBtn}>Clear</button>
          </div>
          {generationJobs.map((job) => (
            <div key={job.id} style={styles.jobRow}>
              <span style={{ color: job.status === 'error' ? '#d88' : job.status === 'done' ? '#8d8' : '#aa8' }}>
                [{job.status}]
              </span>
              <span>{job.animName}{job.frameIndex >= 0 ? `/f${job.frameIndex}` : ''}</span>
              {job.error && <span style={{ color: '#d88', fontSize: 8 }}>{job.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  sectionTitle: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#aaa',
    fontWeight: 600,
    marginBottom: 4,
  },
  label: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#666',
    marginTop: 4,
  },
  textarea: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5a',
    borderRadius: 4,
    color: '#ddd',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '6px 8px',
    resize: 'vertical' as const,
    outline: 'none',
  },
  actions: {
    display: 'flex',
    gap: 6,
    marginTop: 6,
  },
  saveBtn: {
    flex: 1,
    background: '#1e3a6e',
    border: '1px solid #4a8af8',
    borderRadius: 4,
    color: '#90b8f8',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '6px 12px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  approveBtn: {
    flex: 1,
    background: '#1e3a2e',
    border: '1px solid #44aa44',
    borderRadius: 4,
    color: '#70d870',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '6px 12px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  divider: {
    height: 1,
    background: '#2a2a3a',
    margin: '8px 0',
  },
  buttonRow: {
    display: 'flex',
    gap: 6,
  },
  generateBtn: {
    flex: 1,
    background: '#3a1e6e',
    border: '1px solid #8a4af8',
    borderRadius: 4,
    color: '#b890f8',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '8px 8px',
    cursor: 'pointer',
    fontWeight: 600,
    textAlign: 'center',
  },
  uploadBtn: {
    flex: 1,
    background: '#1e3a3a',
    border: '1px solid #4ac8c8',
    borderRadius: 4,
    color: '#90d8d8',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '8px 8px',
    cursor: 'pointer',
    fontWeight: 600,
    textAlign: 'center',
  },
  progressText: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#8a4af8',
    textAlign: 'center',
  },
  errorText: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#d88',
    background: '#2a1515',
    border: '1px solid #553333',
    borderRadius: 4,
    padding: '4px 6px',
  },
  generateAllBtn: {
    background: '#1e3a6e',
    border: '1px solid #4a8af8',
    borderRadius: 4,
    color: '#90b8f8',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '8px 16px',
    cursor: 'pointer',
    fontWeight: 600,
    alignSelf: 'flex-start',
  },
  jobsSection: {
    background: '#131324',
    border: '1px solid #2a2a3a',
    borderRadius: 6,
    padding: 8,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    marginTop: 4,
  },
  clearJobsBtn: {
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
