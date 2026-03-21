import React, { useState, useEffect, useCallback } from 'react';
import type { StageGenerationSettings } from '@gseurat/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { SAMPLER_NAMES } from '../../lib/ai-generate.js';
import { NumericInput } from '../NumericInput.js';

export interface ComfySettings {
  checkpoint: string;
  vae: string;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number;
  denoise: number;
  loras: { name: string; weight: number }[];
}

interface Props {
  label: string;
  settings: ComfySettings;
  onChange: (s: ComfySettings) => void;
  showDenoise?: boolean;
  disabled?: boolean;
  savedSettings?: StageGenerationSettings;
}

export function ComfySettingsPanel({ label, settings, onChange, showDenoise = false, disabled = false, savedSettings }: Props) {
  const aiConfig = useSeuratStore((s) => s.aiConfig);
  const availableCheckpoints = useSeuratStore((s) => s.availableCheckpoints);
  const availableLoras = useSeuratStore((s) => s.availableLoras);
  const availableVaes = useSeuratStore((s) => s.availableVaes);
  const availableSchedulers = useSeuratStore((s) => s.availableSchedulers);
  const refreshComfyModels = useSeuratStore((s) => s.refreshComfyModels);

  const [ckptSearch, setCkptSearch] = useState('');
  const [ckptOpen, setCkptOpen] = useState(false);
  const [vaeSearch, setVaeSearch] = useState('');
  const [vaeOpen, setVaeOpen] = useState(false);
  const [loraSearches, setLoraSearches] = useState<Record<number, string>>({});
  const [loraOpen, setLoraOpen] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (availableCheckpoints.length === 0) refreshComfyModels();
  }, []);

  const set = useCallback((partial: Partial<ComfySettings>) => {
    onChange({ ...settings, ...partial });
  }, [settings, onChange]);

  const filteredCkpts = ckptSearch
    ? availableCheckpoints.filter((c) => c.toLowerCase().includes(ckptSearch.toLowerCase()))
    : availableCheckpoints;

  const filteredVaes = vaeSearch
    ? availableVaes.filter((v) => v.toLowerCase().includes(vaeSearch.toLowerCase()))
    : availableVaes;

  const handleLoadSaved = () => {
    if (!savedSettings) return;
    onChange({
      checkpoint: savedSettings.checkpoint ?? settings.checkpoint,
      vae: savedSettings.vae ?? settings.vae,
      steps: savedSettings.steps ?? settings.steps,
      cfg: savedSettings.cfg ?? settings.cfg,
      sampler: savedSettings.sampler ?? settings.sampler,
      scheduler: savedSettings.scheduler ?? settings.scheduler,
      seed: savedSettings.seed ?? settings.seed,
      denoise: savedSettings.denoise ?? settings.denoise,
      loras: savedSettings.loras ?? settings.loras,
    });
  };

  return (
    <div style={styles.settingsSection}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#777', fontWeight: 600 }}>
          ComfyUI Settings ({label})
        </span>
        <button onClick={() => refreshComfyModels()} style={styles.miniBtn} title="Refresh model lists">
          ↻
        </button>
        {savedSettings && (
          <button onClick={handleLoadSaved} style={styles.miniBtn} title="Load last used settings">
            ← saved
          </button>
        )}
      </div>

      {/* Checkpoint */}
      <Row>
        <label style={styles.settingLabel}>Ckpt</label>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            value={settings.checkpoint}
            onChange={(e) => { set({ checkpoint: e.target.value }); setCkptSearch(e.target.value); }}
            onFocus={() => { setCkptOpen(true); setCkptSearch(''); }}
            onBlur={() => setTimeout(() => setCkptOpen(false), 200)}
            style={{ ...styles.settingInput, width: '100%' }}
            placeholder={aiConfig.checkpoint || 'v1-5-pruned-emaonly.safetensors'}
            disabled={disabled}
          />
          {ckptOpen && filteredCkpts.length > 0 && (
            <div style={styles.dropdown}>
              {filteredCkpts.slice(0, 15).map((c) => (
                <div
                  key={c}
                  style={styles.dropdownItem}
                  onMouseDown={(e) => { e.preventDefault(); set({ checkpoint: c }); setCkptOpen(false); }}
                >
                  {c}
                </div>
              ))}
              {filteredCkpts.length > 15 && (
                <div style={{ ...styles.dropdownItem, color: '#555' }}>...{filteredCkpts.length - 15} more</div>
              )}
            </div>
          )}
        </div>
      </Row>

      {/* VAE */}
      <Row>
        <label style={styles.settingLabel}>VAE</label>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            value={settings.vae}
            onChange={(e) => { set({ vae: e.target.value }); setVaeSearch(e.target.value); }}
            onFocus={() => { setVaeOpen(true); setVaeSearch(''); }}
            onBlur={() => setTimeout(() => setVaeOpen(false), 200)}
            style={{ ...styles.settingInput, width: '100%' }}
            placeholder="(use checkpoint VAE)"
            disabled={disabled}
          />
          {vaeOpen && filteredVaes.length > 0 && (
            <div style={styles.dropdown}>
              <div
                style={{ ...styles.dropdownItem, color: '#888', fontStyle: 'italic' }}
                onMouseDown={(e) => { e.preventDefault(); set({ vae: '' }); setVaeOpen(false); }}
              >
                (none — use checkpoint VAE)
              </div>
              {filteredVaes.slice(0, 15).map((v) => (
                <div
                  key={v}
                  style={styles.dropdownItem}
                  onMouseDown={(e) => { e.preventDefault(); set({ vae: v }); setVaeOpen(false); }}
                >
                  {v}
                </div>
              ))}
              {filteredVaes.length > 15 && (
                <div style={{ ...styles.dropdownItem, color: '#555' }}>...{filteredVaes.length - 15} more</div>
              )}
            </div>
          )}
        </div>
      </Row>

      <Row>
        <label style={styles.settingLabel}>Steps</label>
        <NumericInput value={settings.steps} onChange={(v) => set({ steps: v })} style={{ ...styles.settingInput, width: 50 }} min={1} max={150} integer fallback={20} disabled={disabled} />
        <label style={styles.settingLabel}>CFG</label>
        <NumericInput value={settings.cfg} onChange={(v) => set({ cfg: v })} style={{ ...styles.settingInput, width: 50 }} min={1} max={30} step={0.5} fallback={7} disabled={disabled} />
      </Row>
      <Row>
        <label style={styles.settingLabel}>Seed</label>
        <NumericInput value={settings.seed} onChange={(v) => set({ seed: v })} style={{ ...styles.settingInput, width: 80 }} integer fallback={-1} disabled={disabled} />
        <span style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>-1=rng</span>
      </Row>
      <Row>
        <label style={styles.settingLabel}>Sampler</label>
        <select value={settings.sampler} onChange={(e) => set({ sampler: e.target.value })} style={styles.settingSelect} disabled={disabled}>
          {SAMPLER_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Row>
      <Row>
        <label style={styles.settingLabel}>Scheduler</label>
        <select value={settings.scheduler} onChange={(e) => set({ scheduler: e.target.value })} style={styles.settingSelect} disabled={disabled}>
          {(availableSchedulers.length > 0 ? availableSchedulers : ['normal', 'karras', 'exponential', 'sgm_uniform']).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </Row>

      {showDenoise && (
        <Row>
          <label style={styles.settingLabel}>Denoise</label>
          <input
            type="range" min={0.3} max={0.9} step={0.05} value={settings.denoise}
            onChange={(e) => set({ denoise: parseFloat(e.target.value) })}
            style={{ flex: 1 }}
            disabled={disabled}
          />
          <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#aaa', minWidth: 30 }}>{settings.denoise.toFixed(2)}</span>
        </Row>
      )}

      {/* LoRAs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#777', fontWeight: 600 }}>LoRA</span>
        <button
          onClick={() => set({ loras: [...settings.loras, { name: '', weight: 0.8 }] })}
          style={styles.miniBtn}
          disabled={disabled}
        >
          +
        </button>
        {settings.loras.length === 0 && (
          <span style={{ fontSize: 8, color: '#555', fontFamily: 'monospace' }}>none (add to apply)</span>
        )}
      </div>
      {settings.loras.map((lora, i) => {
        const search = loraSearches[i] ?? '';
        const isOpen = loraOpen[i] ?? false;
        const filteredLoras = search
          ? availableLoras.filter((l) => l.toLowerCase().includes(search.toLowerCase()))
          : availableLoras;

        return (
          <Row key={i}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                value={lora.name}
                onChange={(e) => {
                  const u = [...settings.loras];
                  u[i] = { ...u[i], name: e.target.value };
                  set({ loras: u });
                  setLoraSearches({ ...loraSearches, [i]: e.target.value });
                }}
                onFocus={() => { setLoraOpen({ ...loraOpen, [i]: true }); setLoraSearches({ ...loraSearches, [i]: '' }); }}
                onBlur={() => setTimeout(() => setLoraOpen({ ...loraOpen, [i]: false }), 200)}
                style={{ ...styles.settingInput, width: '100%' }}
                placeholder="lora_name"
                disabled={disabled}
              />
              {isOpen && filteredLoras.length > 0 && (
                <div style={styles.dropdown}>
                  {filteredLoras.slice(0, 15).map((l) => (
                    <div
                      key={l}
                      style={styles.dropdownItem}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const u = [...settings.loras];
                        u[i] = { ...u[i], name: l };
                        set({ loras: u });
                        setLoraOpen({ ...loraOpen, [i]: false });
                      }}
                    >
                      {l}
                    </div>
                  ))}
                  {filteredLoras.length > 15 && (
                    <div style={{ ...styles.dropdownItem, color: '#555' }}>...{filteredLoras.length - 15} more</div>
                  )}
                </div>
              )}
            </div>
            <NumericInput
              value={lora.weight}
              onChange={(v) => {
                const u = [...settings.loras];
                u[i] = { ...u[i], weight: v };
                set({ loras: u });
              }}
              style={{ ...styles.settingInput, width: 55 }} step={0.1} min={0} max={2}
              fallback={0}
              disabled={disabled}
            />
            <button onClick={() => set({ loras: settings.loras.filter((_, j) => j !== i) })} style={styles.miniBtn} disabled={disabled}>x</button>
          </Row>
        );
      })}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>{children}</div>;
}

const styles: Record<string, React.CSSProperties> = {
  settingsSection: {
    background: '#131324',
    border: '1px solid #2a2a3a',
    borderRadius: 6,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginBottom: 6,
  },
  settingLabel: { fontFamily: 'monospace', fontSize: 9, color: '#666', minWidth: 40 },
  settingInput: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5a',
    borderRadius: 3,
    color: '#ddd',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '3px 6px',
    outline: 'none',
  },
  settingSelect: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5a',
    borderRadius: 3,
    color: '#ddd',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '3px 6px',
    outline: 'none',
  },
  miniBtn: {
    background: '#2a2a3a',
    border: '1px solid #444',
    borderRadius: 3,
    color: '#888',
    fontFamily: 'monospace',
    fontSize: 8,
    padding: '1px 6px',
    cursor: 'pointer',
  },
  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    right: 0,
    maxHeight: 200,
    overflowY: 'auto' as const,
    background: '#1a1a2e',
    border: '1px solid #4a4a6a',
    borderRadius: 3,
    zIndex: 100,
  },
  dropdownItem: {
    padding: '4px 6px',
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#ccc',
    cursor: 'pointer',
    borderBottom: '1px solid #2a2a3a',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
};
