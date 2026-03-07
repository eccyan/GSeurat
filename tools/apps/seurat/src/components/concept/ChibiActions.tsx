import React, { useRef, useState, useEffect } from 'react';
import type { ChibiArt } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { ComfySettingsPanel, type ComfySettings } from './ComfySettingsPanel.js';

export function ChibiActions() {
  const manifest = useSeuratStore((s) => s.manifest);
  const saveChibi = useSeuratStore((s) => s.saveChibi);
  const aiConfig = useSeuratStore((s) => s.aiConfig);
  const chibiGenerating = useSeuratStore((s) => s.chibiGenerating);
  const chibiError = useSeuratStore((s) => s.chibiError);
  const generateChibiArt = useSeuratStore((s) => s.generateChibiArt);
  const uploadChibiImage = useSeuratStore((s) => s.uploadChibiImage);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stylePrompt, setStylePrompt] = useState('chibi, super deformed, 2-3 head body ratio, cute, simple features');
  const [negativePrompt, setNegativePrompt] = useState('realistic, photograph, 3d render');
  const [saving, setSaving] = useState(false);

  const [comfySettings, setComfySettings] = useState<ComfySettings>({
    checkpoint: '', steps: 20, cfg: 10, sampler: 'euler', seed: -1, denoise: 0.6, loras: [],
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
        steps: gs.steps ?? 20,
        cfg: gs.cfg ?? 10,
        sampler: gs.sampler ?? 'euler',
        seed: gs.seed ?? -1,
        denoise: gs.denoise ?? 0.6,
        loras: gs.loras ?? [],
      });
    }
  }, [manifest?.character_id]);

  if (!manifest) return null;

  const conceptApproved = manifest.concept.approved;
  const disabled = !conceptApproved;

  const handleSave = async (approved?: boolean) => {
    setSaving(true);
    const chibi: ChibiArt = {
      style_prompt: stylePrompt,
      negative_prompt: negativePrompt,
      reference_image: manifest.chibi?.reference_image || '',
      approved: approved ?? manifest.chibi?.approved ?? false,
    };
    await saveChibi(chibi);
    setSaving(false);
  };

  const handleGenerate = async () => {
    await handleSave();
    await generateChibiArt({
      steps: comfySettings.steps, cfg: comfySettings.cfg, sampler: comfySettings.sampler,
      seed: comfySettings.seed, loras: comfySettings.loras,
      checkpoint: comfySettings.checkpoint || undefined, denoise: comfySettings.denoise,
    });
  };

  return (
    <div style={styles.container}>
      <div style={styles.sectionTitle}>Chibi / Deformed</div>

      {disabled && (
        <div style={styles.disabledMsg}>Approve concept art first to enable chibi generation.</div>
      )}

      <label style={styles.label}>Style Prompt</label>
      <textarea
        value={stylePrompt}
        onChange={(e) => setStylePrompt(e.target.value)}
        rows={2}
        style={styles.textarea}
        disabled={disabled}
        placeholder="chibi, super deformed..."
      />

      <label style={styles.label}>Negative Prompt</label>
      <textarea
        value={negativePrompt}
        onChange={(e) => setNegativePrompt(e.target.value)}
        rows={2}
        style={styles.textarea}
        disabled={disabled}
        placeholder="realistic, photograph..."
      />

      <div style={styles.actions}>
        <button onClick={() => handleSave()} disabled={saving || disabled} style={styles.saveBtn}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        {manifest.chibi?.reference_image && !manifest.chibi?.approved && (
          <button onClick={() => handleSave(true)} disabled={saving || disabled} style={styles.approveBtn}>
            Approve
          </button>
        )}
      </div>

      <div style={styles.divider} />

      <ComfySettingsPanel
        label="Chibi"
        settings={comfySettings}
        onChange={setComfySettings}
        showDenoise
        disabled={disabled}
        savedSettings={manifest.chibi?.generation_settings}
      />

      <div style={styles.buttonRow}>
        <button
          onClick={handleGenerate}
          disabled={chibiGenerating || disabled}
          style={{ ...styles.generateBtn, opacity: chibiGenerating || disabled ? 0.5 : 1 }}
        >
          {chibiGenerating ? 'Generating...' : 'Generate Chibi'}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={chibiGenerating || disabled}
          style={{ ...styles.uploadBtn, opacity: disabled ? 0.5 : 1 }}
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
            if (file) { uploadChibiImage(file); e.target.value = ''; }
          }}
        />
      </div>

      {chibiGenerating && <div style={styles.progressText}>Sending to ComfyUI...</div>}
      {chibiError && <div style={styles.errorText}>{chibiError}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', gap: 4 },
  sectionTitle: { fontFamily: 'monospace', fontSize: 12, color: '#aaa', fontWeight: 600, marginBottom: 4 },
  disabledMsg: { fontFamily: 'monospace', fontSize: 9, color: '#886', background: '#2a2a1a', border: '1px solid #554422', borderRadius: 4, padding: '4px 6px' },
  label: { fontFamily: 'monospace', fontSize: 10, color: '#666', marginTop: 4 },
  textarea: { background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 4, color: '#ddd', fontFamily: 'monospace', fontSize: 11, padding: '6px 8px', resize: 'vertical' as const, outline: 'none' },
  actions: { display: 'flex', gap: 6, marginTop: 6 },
  saveBtn: { flex: 1, background: '#1e3a6e', border: '1px solid #4a8af8', borderRadius: 4, color: '#90b8f8', fontFamily: 'monospace', fontSize: 10, padding: '6px 12px', cursor: 'pointer', fontWeight: 600 },
  approveBtn: { flex: 1, background: '#1e3a2e', border: '1px solid #44aa44', borderRadius: 4, color: '#70d870', fontFamily: 'monospace', fontSize: 10, padding: '6px 12px', cursor: 'pointer', fontWeight: 600 },
  divider: { height: 1, background: '#2a2a3a', margin: '8px 0' },
  buttonRow: { display: 'flex', gap: 6 },
  generateBtn: { flex: 1, background: '#3a1e6e', border: '1px solid #8a4af8', borderRadius: 4, color: '#b890f8', fontFamily: 'monospace', fontSize: 10, padding: '8px 8px', cursor: 'pointer', fontWeight: 600, textAlign: 'center' },
  uploadBtn: { flex: 1, background: '#1e3a3a', border: '1px solid #4ac8c8', borderRadius: 4, color: '#90d8d8', fontFamily: 'monospace', fontSize: 10, padding: '8px 8px', cursor: 'pointer', fontWeight: 600, textAlign: 'center' },
  progressText: { fontFamily: 'monospace', fontSize: 9, color: '#8a4af8', textAlign: 'center' },
  errorText: { fontFamily: 'monospace', fontSize: 9, color: '#d88', background: '#2a1515', border: '1px solid #553333', borderRadius: 4, padding: '4px 6px' },
};
