import React, { useRef, useState, useEffect } from 'react';
import type { ConceptArt, ViewDirection } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { ComfySettingsPanel, type ComfySettings } from './ComfySettingsPanel.js';
import { NumericInput } from '../NumericInput.js';

type PoseOption = 'all' | ViewDirection;

const POSE_OPTIONS: { value: PoseOption; label: string }[] = [
  { value: 'all',   label: 'All' },
  { value: 'front', label: 'Front' },
  { value: 'back',  label: 'Back' },
  { value: 'right', label: 'Right' },
  { value: 'left',  label: 'Left' },
];

const UPLOAD_OPTIONS: { value: 'concept' | ViewDirection; label: string }[] = [
  { value: 'concept', label: 'Concept' },
  { value: 'front',   label: 'Front' },
  { value: 'back',    label: 'Back' },
  { value: 'right',   label: 'Right' },
  { value: 'left',    label: 'Left' },
];

export function ConceptActions() {
  const manifest = useSeuratStore((s) => s.manifest);
  const saveConcept = useSeuratStore((s) => s.saveConcept);
  const aiConfig = useSeuratStore((s) => s.aiConfig);
  const setAIConfig = useSeuratStore((s) => s.setAIConfig);
  const conceptGenerating = useSeuratStore((s) => s.conceptGenerating);
  const conceptError = useSeuratStore((s) => s.conceptError);
  const hasConceptBase = useSeuratStore((s) => s.hasConceptBase);
  const generateConceptArt = useSeuratStore((s) => s.generateConceptArt);
  const cancelGeneration = useSeuratStore((s) => s.cancelGeneration);
  const uploadConceptImage = useSeuratStore((s) => s.uploadConceptImage);
  const uploadConceptImageForView = useSeuratStore((s) => s.uploadConceptImageForView);
  const conceptPoseGenerating = useSeuratStore((s) => s.conceptPoseGenerating);
  const conceptPoseError = useSeuratStore((s) => s.conceptPoseError);
  const conceptPoseProgress = useSeuratStore((s) => s.conceptPoseProgress);
  const generateConceptPoses = useSeuratStore((s) => s.generateConceptPoses);
  const detectingPose = useSeuratStore((s) => s.detectingPose);
  const detectConceptViewPoses = useSeuratStore((s) => s.detectConceptViewPoses);
  const detectedViewPoseUrls = useSeuratStore((s) => s.detectedViewPoseUrls);
  const conceptFileRef = useRef<HTMLInputElement>(null);
  const viewFileRef = useRef<HTMLInputElement>(null);

  const [poseDirection, setPoseDirection] = useState<PoseOption>('all');
  const [uploadTarget, setUploadTarget] = useState<'concept' | ViewDirection>('concept');
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

  const busy = conceptGenerating || conceptPoseGenerating;
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

  const handleGenerateConcept = async () => {
    const concept: ConceptArt = {
      ...manifest.concept,
      description,
      style_prompt: stylePrompt,
      negative_prompt: negativePrompt,
    };
    await saveConcept(concept);
    await generateConceptArt(comfyOverrides);
  };

  const handleGeneratePoses = async () => {
    const concept: ConceptArt = {
      ...manifest.concept,
      description,
      style_prompt: stylePrompt,
      negative_prompt: negativePrompt,
    };
    await saveConcept(concept);
    const views = poseDirection === 'all' ? undefined : [poseDirection as ViewDirection];
    await generateConceptPoses(views, comfyOverrides);
  };

  const handleUpload = () => {
    if (uploadTarget === 'concept') {
      conceptFileRef.current?.click();
    } else {
      viewFileRef.current?.click();
    }
  };

  const handleConceptFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadConceptImage(file);
    e.target.value = '';
  };

  const handleViewFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadConceptImageForView(file, uploadTarget as ViewDirection);
    e.target.value = '';
  };

  return (
    <div style={styles.container}>
      {/* ── Section 1: Identity Concept ── */}
      <div style={styles.sectionHeader}>Identity Concept</div>

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
      </div>

      {/* Generate Concept button */}
      <div style={styles.actionRow}>
        <button
          onClick={handleGenerateConcept}
          disabled={conceptGenerating || noPrompt}
          style={{ ...styles.conceptBtn, opacity: conceptGenerating || noPrompt ? 0.5 : 1 }}
        >
          {conceptGenerating ? 'Generating...' : 'Generate Concept'}
        </button>
        <button
          onClick={cancelGeneration}
          disabled={!conceptGenerating}
          style={{ ...styles.cancelBtn, opacity: conceptGenerating ? 1 : 0.3 }}
        >
          Cancel
        </button>
      </div>

      {conceptGenerating && conceptError?.includes('retrying') && (
        <div style={styles.progressText}>{conceptError}</div>
      )}
      {conceptError && !conceptError.includes('retrying') && (
        <div style={styles.errorText}>{conceptError}</div>
      )}

      {/* ── Divider ── */}
      <div style={styles.divider} />

      {/* ── Section 2: Directional Poses ── */}
      <div style={styles.sectionHeader}>Directional Poses</div>

      {!hasConceptBase && (
        <div style={styles.disabledHint}>Generate or upload a concept image first</div>
      )}

      {/* IP-Adapter / OpenPose settings */}
      <div style={styles.poseSettings}>
        <Row>
          <label style={styles.settingLabel}>IP Weight</label>
          <input type="range" min={0.1} max={1.0} step={0.05} value={aiConfig.ipAdapterWeight} onChange={(e) => setAIConfig({ ipAdapterWeight: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={styles.valLabel}>{aiConfig.ipAdapterWeight.toFixed(2)}</span>
        </Row>
        <Row>
          <label style={styles.settingLabel}>Pose Str</label>
          <input type="range" min={0.1} max={1.5} step={0.05} value={aiConfig.openPoseStrength} onChange={(e) => setAIConfig({ openPoseStrength: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={styles.valLabel}>{aiConfig.openPoseStrength.toFixed(2)}</span>
        </Row>
        <Row>
          <label style={styles.settingLabel}>IPA Preset</label>
          <select value={aiConfig.ipAdapterPreset} onChange={(e) => setAIConfig({ ipAdapterPreset: e.target.value })} style={styles.settingSelect}>
            {['LIGHT - SD1.5 only (low strength)', 'STANDARD (medium strength)', 'VIT-G (medium strength)', 'PLUS (high strength)', 'PLUS FACE (portraits)', 'FULL FACE - SD1.5 only (portraits stronger)'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Row>
      </div>

      {/* Generate Poses */}
      <div style={styles.actionRow}>
        <select
          value={poseDirection}
          onChange={(e) => setPoseDirection(e.target.value as PoseOption)}
          style={styles.dirSelect}
          disabled={!hasConceptBase}
        >
          {POSE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          onClick={handleGeneratePoses}
          disabled={!hasConceptBase || conceptPoseGenerating || noPrompt}
          style={{ ...styles.poseBtn, opacity: !hasConceptBase || conceptPoseGenerating || noPrompt ? 0.5 : 1 }}
        >
          {conceptPoseGenerating ? 'Generating...' : 'Generate Poses'}
        </button>
        <button
          onClick={cancelGeneration}
          disabled={!conceptPoseGenerating}
          style={{ ...styles.cancelBtn, opacity: conceptPoseGenerating ? 1 : 0.3 }}
        >
          Cancel
        </button>
      </div>

      {/* Detect poses from generated directional views */}
      {hasConceptBase && (
        <div style={styles.actionRow}>
          <button
            onClick={detectConceptViewPoses}
            disabled={detectingPose || conceptPoseGenerating}
            style={{ ...styles.detectBtn, opacity: detectingPose ? 0.5 : 1, flex: 1 }}
          >
            {detectingPose ? 'Detecting...' : 'Detect View Poses'}
          </button>
          {Object.values(detectedViewPoseUrls).some(Boolean) && (
            <span style={{ fontFamily: 'monospace', fontSize: 8, color: '#70b8d8' }}>
              {Object.values(detectedViewPoseUrls).filter(Boolean).length}/4 detected
            </span>
          )}
        </div>
      )}

      {/* Upload */}
      <div style={styles.actionRow}>
        <select
          value={uploadTarget}
          onChange={(e) => setUploadTarget(e.target.value as 'concept' | ViewDirection)}
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
          ref={conceptFileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={handleConceptFileChange}
        />
        <input
          ref={viewFileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={handleViewFileChange}
        />
      </div>

      {/* Progress / errors */}
      {conceptPoseGenerating && conceptPoseProgress && (
        <div style={styles.progressText}>{conceptPoseProgress}</div>
      )}
      {conceptPoseError && (
        <div style={styles.errorText}>{conceptPoseError}</div>
      )}
      {!conceptPoseGenerating && conceptPoseProgress && !conceptPoseError && (
        <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#70d870', textAlign: 'center' }}>{conceptPoseProgress}</div>
      )}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>{children}</div>;
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', gap: 4 },
  sectionHeader: { fontFamily: 'monospace', fontSize: 11, color: '#aaa', fontWeight: 600, marginTop: 6, marginBottom: 2 },
  label: { fontFamily: 'monospace', fontSize: 10, color: '#666', marginTop: 4 },
  textarea: { background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 4, color: '#ddd', fontFamily: 'monospace', fontSize: 11, padding: '6px 8px', resize: 'vertical' as const, outline: 'none' },
  actions: { display: 'flex', gap: 6, marginTop: 6 },
  saveBtn: { flex: 1, background: '#1e3a6e', border: '1px solid #4a8af8', borderRadius: 4, color: '#90b8f8', fontFamily: 'monospace', fontSize: 10, padding: '6px 12px', cursor: 'pointer', fontWeight: 600 },
  divider: { height: 1, background: '#2a2a3a', margin: '10px 0' },
  remBgSection: { background: '#12121e', border: '1px solid #2a2a3a', borderRadius: 4, padding: '6px 8px', display: 'flex', flexDirection: 'column' as const, gap: 2 },
  remBgInput: { flex: 1, background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 4, color: '#ddd', fontFamily: 'monospace', fontSize: 10, padding: '3px 6px', outline: 'none' },
  actionRow: { display: 'flex', gap: 4, alignItems: 'center', marginTop: 4 },
  dirSelect: { background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 4, color: '#ddd', fontFamily: 'monospace', fontSize: 10, padding: '6px 8px', outline: 'none' },
  conceptBtn: { flex: 1, background: '#1e3a2e', border: '1px solid #44aa44', borderRadius: 4, color: '#70d870', fontFamily: 'monospace', fontSize: 10, padding: '8px 8px', cursor: 'pointer', fontWeight: 600, textAlign: 'center' },
  poseBtn: { flex: 1, background: '#1e2e3a', border: '1px solid #4488cc', borderRadius: 4, color: '#70b8d8', fontFamily: 'monospace', fontSize: 10, padding: '8px 8px', cursor: 'pointer', fontWeight: 600, textAlign: 'center' },
  detectBtn: { background: '#2a2a3a', border: '1px solid #6a6a8a', borderRadius: 4, color: '#aaaacc', fontFamily: 'monospace', fontSize: 10, padding: '6px 8px', cursor: 'pointer', fontWeight: 600, textAlign: 'center' },
  cancelBtn: { background: '#2a1a1a', border: '1px solid #553333', borderRadius: 4, color: '#d88', fontFamily: 'monospace', fontSize: 10, padding: '8px 10px', cursor: 'pointer', fontWeight: 600 },
  uploadBtn: { flex: 1, background: '#1e3a3a', border: '1px solid #4ac8c8', borderRadius: 4, color: '#90d8d8', fontFamily: 'monospace', fontSize: 10, padding: '8px 8px', cursor: 'pointer', fontWeight: 600, textAlign: 'center' },
  progressText: { fontFamily: 'monospace', fontSize: 9, color: '#8a4af8', textAlign: 'center' },
  errorText: { fontFamily: 'monospace', fontSize: 9, color: '#d88', background: '#2a1515', border: '1px solid #553333', borderRadius: 4, padding: '4px 6px' },
  disabledHint: { fontFamily: 'monospace', fontSize: 9, color: '#886600', background: '#2a2510', border: '1px solid #554400', borderRadius: 4, padding: '4px 8px', textAlign: 'center' },
  poseSettings: { background: '#131324', border: '1px solid #2a2a3a', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column' as const, gap: 4 },
  settingLabel: { fontFamily: 'monospace', fontSize: 9, color: '#666', minWidth: 55 },
  settingSelect: { background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 3, color: '#ddd', fontFamily: 'monospace', fontSize: 10, padding: '3px 6px', outline: 'none', flex: 1 },
  valLabel: { fontSize: 9, color: '#888', fontFamily: 'monospace', minWidth: 30 },
};
