import React, { useRef, useState, useEffect } from 'react';
import type { PixelArt } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { ComfySettingsPanel, type ComfySettings } from './ComfySettingsPanel.js';

export function PixelActions() {
  const manifest = useSeuratStore((s) => s.manifest);
  const savePixel = useSeuratStore((s) => s.savePixel);
  const aiConfig = useSeuratStore((s) => s.aiConfig);
  const pixelGenerating = useSeuratStore((s) => s.pixelGenerating);
  const pixelError = useSeuratStore((s) => s.pixelError);
  const generatePixelArt = useSeuratStore((s) => s.generatePixelArt);
  const uploadPixelImage = useSeuratStore((s) => s.uploadPixelImage);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stylePrompt, setStylePrompt] = useState('pixel art, 8-bit, clean edges, retro game sprite');
  const [negativePrompt, setNegativePrompt] = useState('blurry, realistic, 3d render, smooth shading');
  const [saving, setSaving] = useState(false);

  const [comfySettings, setComfySettings] = useState<ComfySettings>({
    checkpoint: '', steps: 20, cfg: 10, sampler: 'euler', seed: -1, denoise: 0.55, loras: [],
  });

  useEffect(() => {
    setComfySettings((s) => ({ ...s, sampler: aiConfig.sampler }));
  }, [aiConfig.sampler]);

  useEffect(() => {
    if (!manifest?.pixel) return;
    setStylePrompt(manifest.pixel.style_prompt);
    setNegativePrompt(manifest.pixel.negative_prompt);
    const gs = manifest.pixel.generation_settings;
    if (gs) {
      setComfySettings({
        checkpoint: gs.checkpoint ?? '',
        steps: gs.steps ?? 20,
        cfg: gs.cfg ?? 10,
        sampler: gs.sampler ?? 'euler',
        seed: gs.seed ?? -1,
        denoise: gs.denoise ?? 0.55,
        loras: gs.loras ?? [],
      });
    }
  }, [manifest?.character_id]);

  if (!manifest) return null;

  const chibiApproved = manifest.chibi?.approved === true;
  const disabled = !chibiApproved;

  const handleSave = async (approved?: boolean) => {
    setSaving(true);
    const pixel: PixelArt = {
      style_prompt: stylePrompt,
      negative_prompt: negativePrompt,
      reference_image: manifest.pixel?.reference_image || '',
      approved: approved ?? manifest.pixel?.approved ?? false,
    };
    await savePixel(pixel);
    setSaving(false);
  };

  const handleGenerate = async () => {
    await handleSave();
    await generatePixelArt({
      steps: comfySettings.steps, cfg: comfySettings.cfg, sampler: comfySettings.sampler,
      seed: comfySettings.seed, loras: comfySettings.loras,
      checkpoint: comfySettings.checkpoint || undefined, denoise: comfySettings.denoise,
    });
  };

  return (
    <div style={styles.container}>
      <div style={styles.sectionTitle}>Pixel Art</div>

      {disabled && (
        <div style={styles.disabledMsg}>Approve chibi art first to enable pixel art generation.</div>
      )}

      <label style={styles.label}>Style Prompt</label>
      <textarea
        value={stylePrompt}
        onChange={(e) => setStylePrompt(e.target.value)}
        rows={2}
        style={styles.textarea}
        disabled={disabled}
        placeholder="pixel art, 8-bit..."
      />

      <label style={styles.label}>Negative Prompt</label>
      <textarea
        value={negativePrompt}
        onChange={(e) => setNegativePrompt(e.target.value)}
        rows={2}
        style={styles.textarea}
        disabled={disabled}
        placeholder="blurry, realistic..."
      />

      <div style={styles.actions}>
        <button onClick={() => handleSave()} disabled={saving || disabled} style={styles.saveBtn}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        {manifest.pixel?.reference_image && !manifest.pixel?.approved && (
          <button onClick={() => handleSave(true)} disabled={saving || disabled} style={styles.approveBtn}>
            Approve
          </button>
        )}
      </div>

      <div style={styles.divider} />

      <ComfySettingsPanel
        label="Pixel"
        settings={comfySettings}
        onChange={setComfySettings}
        showDenoise
        disabled={disabled}
        savedSettings={manifest.pixel?.generation_settings}
      />

      <div style={styles.buttonRow}>
        <button
          onClick={handleGenerate}
          disabled={pixelGenerating || disabled}
          style={{ ...styles.generateBtn, opacity: pixelGenerating || disabled ? 0.5 : 1 }}
        >
          {pixelGenerating ? 'Generating...' : 'Generate Pixel Art'}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={pixelGenerating || disabled}
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
            if (file) { uploadPixelImage(file); e.target.value = ''; }
          }}
        />
      </div>

      {pixelGenerating && <div style={styles.progressText}>Sending to ComfyUI...</div>}
      {pixelError && <div style={styles.errorText}>{pixelError}</div>}
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
