import React, { useRef, useState, useEffect } from 'react';
import type { ChibiArt, ViewDirection } from '@gseurat/asset-types';
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

export function ChibiActions() {
  const manifest = useSeuratStore((s) => s.manifest);
  const saveChibi = useSeuratStore((s) => s.saveChibi);
  const aiConfig = useSeuratStore((s) => s.aiConfig);
  const chibiGenerating = useSeuratStore((s) => s.chibiGenerating);
  const chibiError = useSeuratStore((s) => s.chibiError);
  const generateChibiArt = useSeuratStore((s) => s.generateChibiArt);
  const cancelGeneration = useSeuratStore((s) => s.cancelGeneration);
  const uploadChibiImageForView = useSeuratStore((s) => s.uploadChibiImageForView);
  const chibiViewsGenerating = useSeuratStore((s) => s.chibiViewsGenerating);
  const chibiViewsError = useSeuratStore((s) => s.chibiViewsError);
  const chibiViewsProgress = useSeuratStore((s) => s.chibiViewsProgress);
  const generateChibiViews = useSeuratStore((s) => s.generateChibiViews);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [genDirection, setGenDirection] = useState<GenerateOption>('all');
  const [uploadDirection, setUploadDirection] = useState<ViewDirection>('front');
  const [stylePrompt, setStylePrompt] = useState('chibi, super deformed, 2-3 head body ratio, cute, simple features');
  const [negativePrompt, setNegativePrompt] = useState('realistic, photograph, 3d render');
  const [saving, setSaving] = useState(false);

  const [ipAdapterWeight, setIpAdapterWeight] = useState(0.6);
  const [ipAdapterEndAt, setIpAdapterEndAt] = useState(0.7);

  const [comfySettings, setComfySettings] = useState<ComfySettings>({
    checkpoint: '', vae: '', steps: 20, cfg: 10, sampler: 'euler', scheduler: 'normal', seed: -1, denoise: 0.75, loras: [],
  });

  useEffect(() => {
    setComfySettings((s) => ({ ...s, sampler: aiConfig.sampler }));
  }, [aiConfig.sampler]);

  useEffect(() => {
    if (!manifest?.chibi) return;
    setStylePrompt(manifest.chibi.style_prompt);
    setNegativePrompt(manifest.chibi.negative_prompt);
    const gs = manifest.chibi.generation_settings;
    if (gs) {
      setComfySettings({
        checkpoint: gs.checkpoint ?? '',
        vae: gs.vae ?? '',
        steps: gs.steps ?? 20,
        cfg: gs.cfg ?? 10,
        sampler: gs.sampler ?? 'euler',
        scheduler: gs.scheduler ?? 'normal',
        seed: gs.seed ?? -1,
        denoise: gs.denoise ?? 0.75,
        loras: gs.loras ?? [],
      });
      setIpAdapterWeight(gs.ipAdapterWeight ?? 0.6);
      setIpAdapterEndAt(gs.ipAdapterEndAt ?? 0.7);
    }
  }, [manifest?.character_id]);

  if (!manifest) return null;

  const busy = chibiGenerating || chibiViewsGenerating;

  const comfyOverrides = {
    steps: comfySettings.steps, cfg: comfySettings.cfg, sampler: comfySettings.sampler,
    scheduler: comfySettings.scheduler || undefined, seed: comfySettings.seed,
    loras: comfySettings.loras, checkpoint: comfySettings.checkpoint || undefined,
    vae: comfySettings.vae || undefined, denoise: comfySettings.denoise,
    ipAdapterWeight, ipAdapterEndAt,
  };

  const handleSave = async () => {
    setSaving(true);
    const chibi: ChibiArt = {
      ...manifest.chibi,
      style_prompt: stylePrompt,
      negative_prompt: negativePrompt,
      reference_image: manifest.chibi?.reference_image || '',
    };
    await saveChibi(chibi);
    setSaving(false);
  };

  const handleGenerate = async () => {
    await handleSave();
    if (genDirection === 'all') {
      await generateChibiViews(comfyOverrides);
    } else {
      await generateChibiArt(genDirection as ViewDirection, comfyOverrides);
    }
  };

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadChibiImageForView(file, uploadDirection);
    e.target.value = '';
  };

  return (
    <div style={styles.container}>
      <label style={styles.label}>Style Prompt</label>
      <textarea
        value={stylePrompt}
        onChange={(e) => setStylePrompt(e.target.value)}
        rows={2}
        style={styles.textarea}
        placeholder="chibi, super deformed..."
      />

      <label style={styles.label}>Negative Prompt</label>
      <textarea
        value={negativePrompt}
        onChange={(e) => setNegativePrompt(e.target.value)}
        rows={2}
        style={styles.textarea}
        placeholder="realistic, photograph..."
      />

      <div style={styles.actions}>
        <button onClick={handleSave} disabled={saving} style={styles.saveBtn}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div style={styles.divider} />

      <ComfySettingsPanel
        label="Chibi"
        settings={comfySettings}
        onChange={setComfySettings}
        savedSettings={manifest.chibi?.generation_settings}
      />

      {/* IP-Adapter settings */}
      <div style={styles.ipSection}>
        <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#777', fontWeight: 600 }}>
          IP-Adapter (Identity)
        </span>
        <div style={styles.sliderRow}>
          <label style={styles.sliderLabel}>Weight</label>
          <input
            type="range" min={0.1} max={1.0} step={0.05} value={ipAdapterWeight}
            onChange={(e) => setIpAdapterWeight(parseFloat(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={styles.sliderValue}>{ipAdapterWeight.toFixed(2)}</span>
        </div>
        <div style={styles.sliderRow}>
          <label style={styles.sliderLabel}>End At</label>
          <input
            type="range" min={0.3} max={1.0} step={0.05} value={ipAdapterEndAt}
            onChange={(e) => setIpAdapterEndAt(parseFloat(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={styles.sliderValue}>{ipAdapterEndAt.toFixed(2)}</span>
        </div>
        <div style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>
          Lower weight = more chibi freedom, higher = more concept fidelity
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
          disabled={busy}
          style={{ ...styles.generateBtn, opacity: busy ? 0.5 : 1 }}
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

      {chibiGenerating && <div style={styles.progressText}>Sending to ComfyUI...</div>}
      {chibiViewsGenerating && chibiViewsProgress && (
        <div style={styles.progressText}>{chibiViewsProgress}</div>
      )}
      {chibiError && <div style={styles.errorText}>{chibiError}</div>}
      {chibiViewsError && <div style={styles.errorText}>{chibiViewsError}</div>}
      {!chibiViewsGenerating && chibiViewsProgress && !chibiViewsError && (
        <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#70d870', textAlign: 'center' }}>{chibiViewsProgress}</div>
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
  actionRow: { display: 'flex', gap: 4, alignItems: 'center', marginTop: 4 },
  dirSelect: { background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 4, color: '#ddd', fontFamily: 'monospace', fontSize: 10, padding: '6px 8px', outline: 'none' },
  generateBtn: { flex: 1, background: '#1e3a2e', border: '1px solid #44aa44', borderRadius: 4, color: '#70d870', fontFamily: 'monospace', fontSize: 10, padding: '8px 8px', cursor: 'pointer', fontWeight: 600, textAlign: 'center' },
  cancelBtn: { background: '#2a1a1a', border: '1px solid #553333', borderRadius: 4, color: '#d88', fontFamily: 'monospace', fontSize: 10, padding: '8px 10px', cursor: 'pointer', fontWeight: 600 },
  uploadBtn: { flex: 1, background: '#1e3a3a', border: '1px solid #4ac8c8', borderRadius: 4, color: '#90d8d8', fontFamily: 'monospace', fontSize: 10, padding: '8px 8px', cursor: 'pointer', fontWeight: 600, textAlign: 'center' },
  ipSection: { background: '#131324', border: '1px solid #2a2a3a', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column' as const, gap: 4, marginBottom: 6 },
  sliderRow: { display: 'flex', alignItems: 'center', gap: 6 },
  sliderLabel: { fontFamily: 'monospace', fontSize: 9, color: '#666', minWidth: 40 },
  sliderValue: { fontFamily: 'monospace', fontSize: 9, color: '#aaa', minWidth: 30 },
  progressText: { fontFamily: 'monospace', fontSize: 9, color: '#8a4af8', textAlign: 'center' },
  errorText: { fontFamily: 'monospace', fontSize: 9, color: '#d88', background: '#2a1515', border: '1px solid #553333', borderRadius: 4, padding: '4px 6px' },
};
