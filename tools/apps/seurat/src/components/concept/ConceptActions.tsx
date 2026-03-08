import React, { useRef, useState, useEffect } from 'react';
import type { ConceptArt, ViewDirection } from '@vulkan-game-tools/asset-types';
import { VIEW_DIRECTIONS } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { ComfySettingsPanel, type ComfySettings } from './ComfySettingsPanel.js';

const VIEW_LABELS: Record<ViewDirection, string> = {
  front: 'Front',
  back: 'Back',
  right: 'Right',
  left: 'Left',
};

export function ConceptActions() {
  const manifest = useSeuratStore((s) => s.manifest);
  const saveConcept = useSeuratStore((s) => s.saveConcept);
  const aiConfig = useSeuratStore((s) => s.aiConfig);
  const setAIConfig = useSeuratStore((s) => s.setAIConfig);
  const conceptGenerating = useSeuratStore((s) => s.conceptGenerating);
  const conceptError = useSeuratStore((s) => s.conceptError);
  const uploadConceptImageForView = useSeuratStore((s) => s.uploadConceptImageForView);
  const conceptViewsGenerating = useSeuratStore((s) => s.conceptViewsGenerating);
  const conceptViewsError = useSeuratStore((s) => s.conceptViewsError);
  const conceptViewsProgress = useSeuratStore((s) => s.conceptViewsProgress);
  const generateConceptViews = useSeuratStore((s) => s.generateConceptViews);
  const fileInputRefs = useRef<Record<ViewDirection, HTMLInputElement | null>>({ front: null, back: null, right: null, left: null });

  const [description, setDescription] = useState('');
  const [stylePrompt, setStylePrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [saving, setSaving] = useState(false);

  const [comfySettings, setComfySettings] = useState<ComfySettings>({
    checkpoint: '', vae: '', steps: 20, cfg: 10, sampler: 'euler', scheduler: 'normal', seed: -1, denoise: 1.0, loras: [],
  });

  useEffect(() => {
    setComfySettings((s) => ({ ...s, sampler: aiConfig.sampler }));
  }, [aiConfig.sampler]);

  useEffect(() => {
    if (!manifest) return;
    setDescription(manifest.concept.description);
    setStylePrompt(manifest.concept.style_prompt);
    setNegativePrompt(manifest.concept.negative_prompt);
    // Load saved generation settings if available
    const gs = manifest.concept.generation_settings;
    if (gs) {
      setComfySettings({
        checkpoint: gs.checkpoint ?? '',
        vae: gs.vae ?? '',
        steps: gs.steps ?? 20,
        cfg: gs.cfg ?? 10,
        sampler: gs.sampler ?? 'euler',
        scheduler: gs.scheduler ?? 'normal',
        seed: gs.seed ?? -1,
        denoise: gs.denoise ?? 1.0,
        loras: gs.loras ?? [],
      });
    }
  }, [manifest?.character_id]);

  if (!manifest) return null;

  const handleSave = async () => {
    setSaving(true);
    const concept: ConceptArt = {
      ...manifest.concept,
      description,
      style_prompt: stylePrompt,
      negative_prompt: negativePrompt,
    };
    await saveConcept(concept);
    setSaving(false);
  };

  const handleGenerateAllViews = async () => {
    const concept: ConceptArt = {
      ...manifest.concept,
      description,
      style_prompt: stylePrompt,
      negative_prompt: negativePrompt,
    };
    await saveConcept(concept);
    await generateConceptViews({
      steps: comfySettings.steps, cfg: comfySettings.cfg, sampler: comfySettings.sampler,
      scheduler: comfySettings.scheduler || undefined, seed: comfySettings.seed,
      loras: comfySettings.loras, checkpoint: comfySettings.checkpoint || undefined,
      vae: comfySettings.vae || undefined,
    });
  };

  return (
    <div style={styles.container}>
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
        <button onClick={handleSave} disabled={saving} style={styles.saveBtn}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div style={styles.divider} />

      <ComfySettingsPanel
        label="Concept"
        settings={comfySettings}
        onChange={setComfySettings}
        savedSettings={manifest.concept.generation_settings}
      />

      {/* Background Removal */}
      <div style={styles.remBgSection}>
        <label style={{ ...styles.label, marginTop: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            checked={aiConfig.removeBackground}
            onChange={(e) => setAIConfig({ removeBackground: e.target.checked })}
          />
          Remove Background
        </label>
        {aiConfig.removeBackground && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <label style={{ ...styles.label, marginTop: 0, whiteSpace: 'nowrap' }}>Node</label>
            <input
              value={aiConfig.remBgNodeType}
              onChange={(e) => setAIConfig({ remBgNodeType: e.target.value })}
              style={styles.remBgInput}
              placeholder="BRIA_RMBG_Zho"
            />
          </div>
        )}
        <div style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>
          Requires ComfyUI-BRIA_AI-REMBG or comfyui-rembg custom node.
        </div>
      </div>

      <label style={styles.label}>Upload per Direction</label>
      <div style={styles.uploadGrid}>
        {VIEW_DIRECTIONS.map((view) => (
          <React.Fragment key={view}>
            <button
              onClick={() => fileInputRefs.current[view]?.click()}
              disabled={conceptGenerating || conceptViewsGenerating}
              style={{
                ...styles.uploadBtn,
                opacity: conceptGenerating || conceptViewsGenerating ? 0.5 : 1,
              }}
            >
              {VIEW_LABELS[view]}
            </button>
            <input
              ref={(el) => { fileInputRefs.current[view] = el; }}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  uploadConceptImageForView(file, view);
                  e.target.value = '';
                }
              }}
            />
          </React.Fragment>
        ))}
      </div>

      <button
        onClick={handleGenerateAllViews}
        disabled={conceptGenerating || conceptViewsGenerating || (!description && !stylePrompt)}
        style={{
          ...styles.generateAllBtn,
          opacity: conceptGenerating || conceptViewsGenerating || (!description && !stylePrompt) ? 0.5 : 1,
        }}
      >
        {conceptViewsGenerating ? 'Generating Views...' : 'Generate All 4 Views'}
      </button>

      {conceptGenerating && (
        <div style={styles.progressText}>
          {conceptError?.includes('retrying') ? conceptError : 'Sending to ComfyUI...'}
        </div>
      )}
      {conceptViewsGenerating && conceptViewsProgress && (
        <div style={styles.progressText}>{conceptViewsProgress}</div>
      )}
      {conceptError && !conceptError.includes('retrying') && (
        <div style={styles.errorText}>{conceptError}</div>
      )}
      {conceptViewsError && (
        <div style={styles.errorText}>{conceptViewsError}</div>
      )}
      {!conceptViewsGenerating && conceptViewsProgress && !conceptViewsError && (
        <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#70d870', textAlign: 'center' }}>{conceptViewsProgress}</div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', gap: 4 },
  sectionTitle: { fontFamily: 'monospace', fontSize: 12, color: '#aaa', fontWeight: 600, marginBottom: 4 },
  label: { fontFamily: 'monospace', fontSize: 10, color: '#666', marginTop: 4 },
  textarea: { background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 4, color: '#ddd', fontFamily: 'monospace', fontSize: 11, padding: '6px 8px', resize: 'vertical' as const, outline: 'none' },
  actions: { display: 'flex', gap: 6, marginTop: 6 },
  saveBtn: { flex: 1, background: '#1e3a6e', border: '1px solid #4a8af8', borderRadius: 4, color: '#90b8f8', fontFamily: 'monospace', fontSize: 10, padding: '6px 12px', cursor: 'pointer', fontWeight: 600 },
  approveBtn: { flex: 1, background: '#1e3a2e', border: '1px solid #44aa44', borderRadius: 4, color: '#70d870', fontFamily: 'monospace', fontSize: 10, padding: '6px 12px', cursor: 'pointer', fontWeight: 600 },
  divider: { height: 1, background: '#2a2a3a', margin: '8px 0' },
  uploadGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 },
  remBgSection: { background: '#12121e', border: '1px solid #2a2a3a', borderRadius: 4, padding: '6px 8px', display: 'flex', flexDirection: 'column' as const, gap: 2 },
  remBgInput: { flex: 1, background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 4, color: '#ddd', fontFamily: 'monospace', fontSize: 10, padding: '3px 6px', outline: 'none' },
  generateAllBtn: { width: '100%', background: '#1e3a2e', border: '1px solid #44aa44', borderRadius: 4, color: '#70d870', fontFamily: 'monospace', fontSize: 10, padding: '8px 8px', cursor: 'pointer', fontWeight: 600, textAlign: 'center' },
  uploadBtn: { flex: 1, background: '#1e3a3a', border: '1px solid #4ac8c8', borderRadius: 4, color: '#90d8d8', fontFamily: 'monospace', fontSize: 10, padding: '8px 8px', cursor: 'pointer', fontWeight: 600, textAlign: 'center' },
  progressText: { fontFamily: 'monospace', fontSize: 9, color: '#8a4af8', textAlign: 'center' },
  errorText: { fontFamily: 'monospace', fontSize: 9, color: '#d88', background: '#2a1515', border: '1px solid #553333', borderRadius: 4, padding: '4px 6px' },
};
