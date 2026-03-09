import React, { useRef, useState, useEffect } from 'react';
import type { ConceptArt, ViewDirection } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { ComfySettingsPanel, type ComfySettings } from './ComfySettingsPanel.js';

type GenerateOption = 'all' | ViewDirection;

const GENERATE_OPTIONS: { value: GenerateOption; label: string }[] = [
  { value: 'all',   label: 'All' },
  { value: 'front', label: 'Front' },
  { value: 'back',  label: 'Back' },
  { value: 'right', label: 'Right' },
  { value: 'left',  label: 'Left' },
];

const UPLOAD_OPTIONS: { value: ViewDirection; label: string }[] = [
  { value: 'front', label: 'Front' },
  { value: 'back',  label: 'Back' },
  { value: 'right', label: 'Right' },
  { value: 'left',  label: 'Left' },
];

export function ConceptActions() {
  const manifest = useSeuratStore((s) => s.manifest);
  const saveConcept = useSeuratStore((s) => s.saveConcept);
  const aiConfig = useSeuratStore((s) => s.aiConfig);
  const setAIConfig = useSeuratStore((s) => s.setAIConfig);
  const conceptGenerating = useSeuratStore((s) => s.conceptGenerating);
  const conceptError = useSeuratStore((s) => s.conceptError);
  const generateConceptArt = useSeuratStore((s) => s.generateConceptArt);
  const cancelGeneration = useSeuratStore((s) => s.cancelGeneration);
  const uploadConceptImageForView = useSeuratStore((s) => s.uploadConceptImageForView);
  const conceptViewsGenerating = useSeuratStore((s) => s.conceptViewsGenerating);
  const conceptViewsError = useSeuratStore((s) => s.conceptViewsError);
  const conceptViewsProgress = useSeuratStore((s) => s.conceptViewsProgress);
  const generateConceptViews = useSeuratStore((s) => s.generateConceptViews);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [genDirection, setGenDirection] = useState<GenerateOption>('all');
  const [uploadDirection, setUploadDirection] = useState<ViewDirection>('front');
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

  const busy = conceptGenerating || conceptViewsGenerating;
  const noPrompt = !description && !stylePrompt;

  const comfyOverrides = {
    steps: comfySettings.steps, cfg: comfySettings.cfg, sampler: comfySettings.sampler,
    scheduler: comfySettings.scheduler || undefined, seed: comfySettings.seed,
    loras: comfySettings.loras, checkpoint: comfySettings.checkpoint || undefined,
    vae: comfySettings.vae || undefined,
  };

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

  const handleGenerate = async () => {
    const concept: ConceptArt = {
      ...manifest.concept,
      description,
      style_prompt: stylePrompt,
      negative_prompt: negativePrompt,
    };
    await saveConcept(concept);
    if (genDirection === 'all') {
      await generateConceptViews(comfyOverrides);
    } else {
      await generateConceptArt(genDirection as ViewDirection, comfyOverrides);
    }
  };

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadConceptImageForView(file, uploadDirection);
    e.target.value = '';
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

      {/* Generate */}
      <div style={styles.actionRow}>
        <select
          value={genDirection}
          onChange={(e) => setGenDirection(e.target.value as GenerateOption)}
          style={styles.dirSelect}
        >
          {GENERATE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          onClick={handleGenerate}
          disabled={busy || noPrompt}
          style={{ ...styles.generateBtn, opacity: busy || noPrompt ? 0.5 : 1 }}
        >
          {busy ? 'Generating...' : 'Generate'}
        </button>
        <button
          onClick={cancelGeneration}
          disabled={!busy}
          style={{ ...styles.cancelBtn, opacity: busy ? 1 : 0.3 }}
        >
          Cancel
        </button>
      </div>

      {/* Upload */}
      <div style={styles.actionRow}>
        <select
          value={uploadDirection}
          onChange={(e) => setUploadDirection(e.target.value as ViewDirection)}
          style={styles.dirSelect}
        >
          {UPLOAD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          onClick={handleUpload}
          disabled={busy}
          style={{ ...styles.uploadBtn, opacity: busy ? 0.5 : 1 }}
        >
          Upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>

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
  label: { fontFamily: 'monospace', fontSize: 10, color: '#666', marginTop: 4 },
  textarea: { background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 4, color: '#ddd', fontFamily: 'monospace', fontSize: 11, padding: '6px 8px', resize: 'vertical' as const, outline: 'none' },
  actions: { display: 'flex', gap: 6, marginTop: 6 },
  saveBtn: { flex: 1, background: '#1e3a6e', border: '1px solid #4a8af8', borderRadius: 4, color: '#90b8f8', fontFamily: 'monospace', fontSize: 10, padding: '6px 12px', cursor: 'pointer', fontWeight: 600 },
  divider: { height: 1, background: '#2a2a3a', margin: '8px 0' },
  remBgSection: { background: '#12121e', border: '1px solid #2a2a3a', borderRadius: 4, padding: '6px 8px', display: 'flex', flexDirection: 'column' as const, gap: 2 },
  remBgInput: { flex: 1, background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 4, color: '#ddd', fontFamily: 'monospace', fontSize: 10, padding: '3px 6px', outline: 'none' },
  actionRow: { display: 'flex', gap: 4, alignItems: 'center', marginTop: 4 },
  dirSelect: { background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 4, color: '#ddd', fontFamily: 'monospace', fontSize: 10, padding: '6px 8px', outline: 'none' },
  generateBtn: { flex: 1, background: '#1e3a2e', border: '1px solid #44aa44', borderRadius: 4, color: '#70d870', fontFamily: 'monospace', fontSize: 10, padding: '8px 8px', cursor: 'pointer', fontWeight: 600, textAlign: 'center' },
  cancelBtn: { background: '#2a1a1a', border: '1px solid #553333', borderRadius: 4, color: '#d88', fontFamily: 'monospace', fontSize: 10, padding: '8px 10px', cursor: 'pointer', fontWeight: 600 },
  uploadBtn: { flex: 1, background: '#1e3a3a', border: '1px solid #4ac8c8', borderRadius: 4, color: '#90d8d8', fontFamily: 'monospace', fontSize: 10, padding: '8px 8px', cursor: 'pointer', fontWeight: 600, textAlign: 'center' },
  progressText: { fontFamily: 'monospace', fontSize: 9, color: '#8a4af8', textAlign: 'center' },
  errorText: { fontFamily: 'monospace', fontSize: 9, color: '#d88', background: '#2a1515', border: '1px solid #553333', borderRadius: 4, padding: '4px 6px' },
};
